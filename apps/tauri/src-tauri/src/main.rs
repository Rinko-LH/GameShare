#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod process_audio;
mod signaling;
mod tunnel;
mod voice;

use serde_json::{json, Value};
use tauri::{
    webview::NewWindowResponse, Emitter, Manager, Url, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
use windows_sys::Win32::UI::Shell::ShellExecuteW;

fn local_page(url: &Url) -> bool {
    url.scheme() == "http"
        && (matches!((url.host_str(), url.port()), (Some("tauri.localhost"), None))
            || (tauri::is_dev() && url.host_str() == Some("127.0.0.1") && url.port() == Some(1420)))
}

fn open_link(url: Url) {
    if matches!(url.scheme(), "http" | "https") && !local_page(&url) {
        let target: Vec<u16> = url.as_str().encode_utf16().chain([0]).collect();
        unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                std::ptr::null(),
                target.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                1,
            );
        }
    }
}

fn require_main(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("只能由主窗口调用".into())
    }
}

fn tile_label(label: &str) -> bool {
    label
        .strip_prefix("tile-")
        .and_then(|id| id.parse::<u32>().ok())
        .is_some()
}

#[tauri::command]
async fn open_tile(
    window: WebviewWindow,
    label: String,
    title: String,
    slot: usize,
) -> Result<(), String> {
    require_main(&window)?;
    if !tile_label(&label) || slot >= 7 {
        return Err("无效的浮窗序号".into());
    }
    let app = window.app_handle();
    let url = WebviewUrl::App(format!("index.html?floatTile={label}").into());
    let tile = WebviewWindowBuilder::new(app, label, url)
        .on_navigation(local_page)
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .title(format!(
            "GameShare · {}",
            title.chars().take(48).collect::<String>()
        ))
        .inner_size(360.0, 225.0)
        .min_inner_size(220.0, 145.0)
        .decorations(false)
        .shadow(false)
        .background_color(tauri::window::Color(0, 0, 0, 255))
        .position(
            50.0 + 375.0 * (slot % 3) as f64,
            92.0 + 255.0 * (slot / 3) as f64,
        )
        .always_on_top(true)
        .focused(false)
        .minimizable(false)
        .skip_taskbar(true)
        .build()
        .map_err(|error| error.to_string())?;
    let _ = tile.set_always_on_top(true);
    Ok(())
}

#[tauri::command]
fn close_tile(window: WebviewWindow, label: String) -> Result<(), String> {
    require_main(&window)?;
    if !tile_label(&label) {
        return Err("无效的浮窗".into());
    }
    if let Some(tile) = window.app_handle().get_webview_window(&label) {
        tile.destroy().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn tile_signal(window: WebviewWindow, label: String, message: Value) -> Result<(), String> {
    if !tile_label(&label) {
        return Err("无效的浮窗".into());
    }
    let kind = message["kind"].as_str().unwrap_or("");
    let destination = match (window.label(), kind) {
        ("main", "offer" | "peer") => label.as_str(),
        (sender, "ready" | "answer" | "mute" | "volume") if sender == label => "main",
        _ => return Err("无效的浮窗消息方向".into()),
    };
    window
        .app_handle()
        .emit_to(
            destination,
            "tile-signal",
            json!({"label": label, "message": message}),
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn control_window(window: WebviewWindow, action: &str) -> Result<(), String> {
    require_main(&window)?;
    match action {
        "minimize" => window.minimize(),
        "toggle-maximize" => {
            if window.is_maximized().map_err(|error| error.to_string())? {
                window.unmaximize()
            } else {
                window.maximize()
            }
        }
        "drag" => window.start_dragging(),
        "close" => window.close(),
        _ => return Err("无效的窗口操作".into()),
    }
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn is_maximized(window: WebviewWindow) -> bool {
    window.label() == "main" && window.is_maximized().unwrap_or(false)
}

#[tauri::command]
fn app_info(window: WebviewWindow) -> Result<Value, String> {
    require_main(&window)?;
    let app = window.app_handle();
    let user_path = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    Ok(json!({
        "appVersion": app.package_info().version.to_string(),
        "platform": "win32", "arch": "x64", "userDataPath": user_path, "isDev": cfg!(debug_assertions)
    }))
}

fn main() {
    tauri::Builder::default()
        .manage(process_audio::ProcessAudio::default())
        .manage(signaling::Signaling::default())
        .manage(tunnel::Tunnel::default())
        .manage(voice::VoiceHotkey::default())
        .setup(|app| {
            let window = &app.config().app.windows[0];
            WebviewWindowBuilder::from_config(app, window)?
                .on_navigation(local_page)
                .on_new_window(|url, _| {
                    open_link(url);
                    NewWindowResponse::Deny
                })
                .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_tile,
            close_tile,
            tile_signal,
            control_window,
            is_maximized,
            app_info,
            signaling::set_signaling,
            signaling::signaling_status,
            tunnel::tunnel_status,
            tunnel::set_tunnel,
            voice::configure_voice_hotkey,
            process_audio::list_audio_applications,
            process_audio::start_application_audio,
            process_audio::read_application_audio,
            process_audio::stop_application_audio
        ])
        .on_page_load(|view, payload| {
            if view.label() == "main" && payload.event() == tauri::webview::PageLoadEvent::Started {
                view.state::<voice::VoiceHotkey>().reset();
                view.state::<process_audio::ProcessAudio>().reset();
            }
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::Destroyed if window.label() == "main" => {
                window.app_handle().exit(0)
            }
            tauri::WindowEvent::Destroyed if tile_label(window.label()) => {
                let _ = window
                    .app_handle()
                    .emit_to("main", "tile-closed", window.label());
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("无法启动 GameShare Tauri");
}
