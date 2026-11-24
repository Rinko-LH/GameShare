use serde::{Deserialize, Serialize};
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{async_runtime::JoinHandle, Emitter, State, WebviewWindow};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;

#[derive(Deserialize)]
pub struct Binding {
    key: u16,
    ctrl: bool,
    alt: bool,
    shift: bool,
}

impl Binding {
    fn valid(&self) -> bool {
        let supported = matches!(self.key,
            0x14 | 0x20..=0x28 | 0x2d..=0x2e | 0x30..=0x39 | 0x41..=0x5a |
            0x60..=0x6b | 0x6d..=0x7b);
        supported
            && !(self.alt && self.key == 0x73)
            && !(self.ctrl && self.alt && matches!(self.key, 0x2e | 0x47))
    }
}

#[derive(Clone, Serialize)]
pub struct VoiceStatus {
    pressed: bool,
    error: Option<&'static str>,
    revision: u32,
}

#[derive(Default)]
struct VoiceState {
    revision: u32,
    task: Option<JoinHandle<()>>,
}

#[derive(Default)]
pub struct VoiceHotkey(Mutex<VoiceState>);

impl VoiceHotkey {
    pub fn reset(&self) {
        if let Some(task) = self.0.lock().unwrap().task.take() {
            task.abort();
        }
    }
}

fn down(key: u16) -> bool {
    // 只取 Windows 返回值的高位，查询当前按下状态，无需注册全局键盘钩子。
    unsafe { GetAsyncKeyState(i32::from(key)) < 0 }
}

async fn observe(window: WebviewWindow, binding: Binding, mut status: VoiceStatus) {
    let mut armed = false;
    let mut last = Instant::now();
    loop {
        let elapsed = last.elapsed();
        last = Instant::now();
        if elapsed >= Duration::from_millis(250) {
            armed = false;
        }
        let primary = down(binding.key);
        let ctrl = down(0x11);
        let alt = down(0x12);
        let shift = down(0x10);
        let pressed = if armed {
            primary
                && ctrl == binding.ctrl
                && alt == binding.alt
                && shift == binding.shift
                && !down(0x5b)
                && !down(0x5c)
        } else {
            armed = !(primary
                || (binding.ctrl && ctrl)
                || (binding.alt && alt)
                || (binding.shift && shift));
            false
        };
        if status.pressed != pressed {
            status.pressed = pressed;
            let _ = window.emit_to("main", "voice-hotkey", &status);
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

#[tauri::command]
pub fn configure_voice_hotkey(
    window: WebviewWindow,
    hotkey: State<'_, VoiceHotkey>,
    active: bool,
    binding: Option<Binding>,
) -> Result<VoiceStatus, String> {
    super::require_main(&window)?;
    let mut state = hotkey.0.lock().unwrap();
    if let Some(task) = state.task.take() {
        task.abort();
    }
    state.revision = state.revision.wrapping_add(1);
    let mut status = VoiceStatus {
        pressed: false,
        error: None,
        revision: state.revision,
    };
    if let Some(binding) = binding {
        if !binding.valid() {
            status.error = Some("无效或保留的快捷键");
        } else if active {
            state.task = Some(tauri::async_runtime::spawn(observe(
                window,
                binding,
                status.clone(),
            )));
        }
    }
    Ok(status)
}
