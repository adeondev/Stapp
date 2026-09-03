mod desktop_permissions;
mod screen_capture;
mod screen_sources;
mod updater;

#[cfg(windows)]
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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
                // Nao usar default_window_icon: o contexto gerado pode manter o
                // recurso padrao do Tauri mesmo quando o bundle do EXE ja tem o
                // icone certo. Este PNG fica embutido no binario e e aplicado a
                // propria janela, que e a fonte usada pela barra de tarefas.
                let icon = image::load_from_memory(include_bytes!("../icons/128x128.png"))?
                    .into_rgba8();
                let (width, height) = icon.dimensions();
                main.set_icon(tauri::image::Image::new_owned(
                    icon.into_raw(),
                    width,
                    height,
                ))?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            screen_sources::list_screen_sources,
            screen_sources::capture_screen_source_thumbnail,
            screen_capture::start_screen_capture,
            screen_capture::stop_screen_capture,
            screen_capture::validate_screen_audio_exclusion,
            updater::check_update_with_endpoint,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
