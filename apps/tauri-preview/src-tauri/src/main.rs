#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const TILES: [&str; 3] = ["tile-0", "tile-1", "tile-2"];

fn require_main(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("Only the main window can manage the preview windows".into())
    }
}

#[tauri::command]
async fn open_tiles(window: WebviewWindow, run: u32) -> Result<(), String> {
    require_main(&window)?;
    let app = window.app_handle();
    for (index, label) in TILES.into_iter().enumerate() {
        let url = WebviewUrl::App(format!("tile.html?index={index}&run={run}").into());
        let result = WebviewWindowBuilder::new(app, label, url)
            .title(format!("GameShare · 测试画面 {}", index + 1))
            .inner_size(360.0, 248.0)
            .min_inner_size(220.0, 154.0)
            .position(40.0 + 72.0 * index as f64, 65.0 + 285.0 * index as f64)
            .always_on_top(true)
            .resizable(true)
            .skip_taskbar(true)
            .build();
        if let Err(error) = result {
            close_tiles_inner(app)?;
            return Err(error.to_string());
        }
    }
    Ok(())
}

fn close_tiles_inner(app: &AppHandle) -> Result<(), String> {
    let mut result = Ok(());
    for label in TILES {
        if let Some(tile) = app.get_webview_window(label) {
            if let Err(error) = tile.destroy() {
                result = Err(error.to_string());
            }
        }
    }
    result
}

#[tauri::command]
async fn close_tiles(window: WebviewWindow) -> Result<(), String> {
    require_main(&window)?;
    close_tiles_inner(window.app_handle())
}

#[tauri::command]
fn minimize_main(window: WebviewWindow) -> Result<(), String> {
    require_main(&window)?;
    window.minimize().map_err(|error| error.to_string())
}

#[tauri::command]
fn relay(
    window: WebviewWindow,
    index: usize,
    message: serde_json::Value,
) -> Result<(), String> {
    let label = TILES.get(index).ok_or("Invalid tile index")?;
    let kind = message.get("kind").and_then(serde_json::Value::as_str);
    let destination = match (window.label(), kind) {
        ("main", Some("offer")) => *label,
        (sender, Some("ready" | "answer")) if sender == *label => "main",
        _ => return Err("Invalid signaling direction".into()),
    };
    window
        .app_handle()
        .emit_to(destination, "preview-signal", message)
        .map_err(|error| error.to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![open_tiles, close_tiles, minimize_main, relay])
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::Destroyed if window.label() == "main" => {
                window.app_handle().exit(0);
            }
            tauri::WindowEvent::Destroyed => {
                if let Some(index) = TILES.iter().position(|label| *label == window.label()) {
                    let _ = window.app_handle().emit_to("main", "preview-tile-closed", index);
                }
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("Could not start GameShare Tauri Preview");
}
