use std::{
    collections::{HashMap, VecDeque},
    ffi::c_void,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

use serde::Serialize;
use tauri::{ipc::Response, State, WebviewWindow};
use tokio::sync::oneshot;
use windows_sys::{
    core::BOOL,
    Win32::{
        Foundation::{HWND, LPARAM},
        UI::WindowsAndMessaging::{
            EnumWindows, GetAncestor, GetWindow, GetWindowTextW, GetWindowThreadProcessId,
            IsWindowVisible, GA_ROOT, GW_OWNER,
        },
    },
};

const BYTES_PER_FRAME: usize = 4;
// 200 ms at 48 kHz. If the webview falls behind, keep the latest audio.
const BUFFER_LIMIT: usize = 9600 * BYTES_PER_FRAME;
const READ_LIMIT: usize = 2880 * BYTES_PER_FRAME;

extern "C" {
    fn gs_open_process_audio(pid: u32, capture: *mut *mut c_void) -> i32;
    fn gs_read_process_audio(
        capture: *mut c_void,
        output: *mut i16,
        capacity: u32,
        frames: *mut u32,
    ) -> i32;
    fn gs_close_process_audio(capture: *mut c_void);
}

#[derive(Serialize)]
pub struct AudioApplication {
    pid: u32,
    title: String,
}

fn application_for_shared_window(source: &str) -> Option<AudioApplication> {
    // Chromium's platform window label is window:<HWND>:0. Opaque picker session IDs
    // and Aura IDs do not identify a Win32 window.
    let handle = source.strip_prefix("window:")?.strip_suffix(":0")?;
    let handle = handle.parse::<usize>().ok().filter(|&handle| handle != 0)? as HWND;
    unsafe {
        if GetAncestor(handle, GA_ROOT) != handle || IsWindowVisible(handle) == 0 {
            return None;
        }
        let mut pid = 0;
        if GetWindowThreadProcessId(handle, &mut pid) == 0 || pid == 0 || pid == std::process::id() {
            return None;
        }
        let mut title = [0u16; 512];
        let len = GetWindowTextW(handle, title.as_mut_ptr(), title.len() as i32);
        Some(AudioApplication {
            pid,
            title: String::from_utf16_lossy(&title[..len as usize]),
        })
    }
}

fn audio_applications() -> Vec<AudioApplication> {
    unsafe extern "system" fn collect(window: HWND, data: LPARAM) -> BOOL {
        if IsWindowVisible(window) == 0 || !GetWindow(window, GW_OWNER).is_null() {
            return 1;
        }
        let mut pid = 0;
        GetWindowThreadProcessId(window, &mut pid);
        if pid == 0 || pid == std::process::id() {
            return 1;
        }
        let mut title = [0u16; 512];
        let len = GetWindowTextW(window, title.as_mut_ptr(), title.len() as i32);
        if len > 0 {
            let apps = &mut *(data as *mut Vec<AudioApplication>);
            let title = String::from_utf16_lossy(&title[..len as usize]);
            if !title.trim().is_empty() && !apps.iter().any(|app| app.pid == pid) {
                apps.push(AudioApplication { pid, title });
            }
        }
        1
    }

    let mut apps = Vec::<AudioApplication>::new();
    unsafe {
        EnumWindows(
            Some(collect),
            &mut apps as *mut Vec<AudioApplication> as LPARAM,
        )
    };
    apps.sort_by(|a, b| a.title.cmp(&b.title));
    apps
}

#[derive(Default)]
struct CaptureBuffer {
    pcm: VecDeque<u8>,
    ended: bool,
}

#[derive(Default)]
struct Capture {
    stopped: AtomicBool,
    buffer: Mutex<CaptureBuffer>,
}

impl Capture {
    fn record(&self, pid: u32, ready: oneshot::Sender<Result<(), String>>) {
        let mut handle = std::ptr::null_mut();
        let result = unsafe { gs_open_process_audio(pid, &mut handle) };
        if result < 0 {
            let _ = ready.send(Err(format!(
                "无法采集所选应用的声音 (0x{:08X})",
                result as u32
            )));
            return;
        }
        if ready.send(Ok(())).is_ok() {
            let mut pcm = vec![0i16; 48_000 * 2];
            while !self.stopped.load(Ordering::Relaxed) {
                let mut frames = 0;
                let result = unsafe {
                    gs_read_process_audio(
                        handle,
                        pcm.as_mut_ptr(),
                        (pcm.len() / 2) as u32,
                        &mut frames,
                    )
                };
                if result != 0 {
                    break;
                }
                if frames != 0 {
                    let mut buffer = self.buffer.lock().unwrap();
                    buffer.pcm.extend(
                        pcm[..frames as usize * 2]
                            .iter()
                            .flat_map(|sample| sample.to_le_bytes()),
                    );
                    let excess = buffer.pcm.len().saturating_sub(BUFFER_LIMIT);
                    buffer.pcm.drain(..excess);
                }
            }
        }
        unsafe { gs_close_process_audio(handle) };
        self.buffer.lock().unwrap().ended = true;
    }
}

#[derive(Default)]
pub struct ProcessAudio(Mutex<HashMap<u32, Arc<Capture>>>);

impl ProcessAudio {
    pub fn reset(&self) {
        for (_, capture) in self.0.lock().unwrap().drain() {
            capture.stopped.store(true, Ordering::Relaxed);
        }
    }

    fn stop(&self, capture_id: u32) {
        if let Some(capture) = self.0.lock().unwrap().remove(&capture_id) {
            capture.stopped.store(true, Ordering::Relaxed);
        }
    }
}

#[tauri::command]
pub fn list_audio_applications(window: WebviewWindow) -> Result<Vec<AudioApplication>, String> {
    super::require_main(&window)?;
    Ok(audio_applications())
}

#[tauri::command]
pub async fn start_application_audio(
    window: WebviewWindow,
    state: State<'_, ProcessAudio>,
    capture_id: u32,
    pid: Option<u32>,
    window_source: Option<String>,
) -> Result<AudioApplication, String> {
    super::require_main(&window)?;
    let application = match (pid, window_source) {
        (Some(pid), None) => audio_applications().into_iter().find(|app| app.pid == pid),
        (None, Some(source)) => application_for_shared_window(&source),
        _ => None,
    }
    .ok_or("无法找到所选窗口的音频应用，请重新选择。")?;
    let pid = application.pid;
    let capture = Arc::new(Capture::default());
    {
        let mut captures = state.0.lock().unwrap();
        if captures.contains_key(&capture_id) {
            return Err("应用音频采集已启动。".into());
        }
        captures.insert(capture_id, capture.clone());
    }
    let (ready, result) = oneshot::channel();
    let worker = capture.clone();
    tauri::async_runtime::spawn_blocking(move || worker.record(pid, ready));
    let result = result
        .await
        .unwrap_or_else(|_| Err("应用音频启动失败。".into()));
    if result.is_err() {
        let mut captures = state.0.lock().unwrap();
        if captures
            .get(&capture_id)
            .is_some_and(|current| Arc::ptr_eq(current, &capture))
        {
            captures.remove(&capture_id);
        }
    }
    result.map(|()| application)
}

#[tauri::command]
pub fn read_application_audio(
    window: WebviewWindow,
    state: State<'_, ProcessAudio>,
    capture_id: u32,
) -> Result<Response, String> {
    super::require_main(&window)?;
    let capture = state
        .0
        .lock()
        .unwrap()
        .get(&capture_id)
        .cloned()
        .ok_or("应用音频已停止。")?;
    let mut buffer = capture.buffer.lock().unwrap();
    if buffer.ended {
        return Err("应用音频已停止。".into());
    }
    let len = buffer.pcm.len().min(READ_LIMIT);
    Ok(Response::new(buffer.pcm.drain(..len).collect::<Vec<_>>()))
}

#[tauri::command]
pub fn stop_application_audio(
    window: WebviewWindow,
    state: State<'_, ProcessAudio>,
    capture_id: u32,
) -> Result<(), String> {
    super::require_main(&window)?;
    state.stop(capture_id);
    Ok(())
}
