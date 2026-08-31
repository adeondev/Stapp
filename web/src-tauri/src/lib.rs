mod desktop_permissions;
mod screen_capture;
mod screen_sources;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            #[cfg(windows)]
            if let Some(main) = app.get_webview_window("main") {
                desktop_permissions::install(&main)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            screen_sources::list_screen_sources,
            screen_sources::capture_screen_source_thumbnail,
            screen_capture::start_screen_capture,
            screen_capture::stop_screen_capture,
            screen_capture::validate_screen_audio_exclusion,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
