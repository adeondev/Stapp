mod desktop_permissions;
mod screen_capture;
mod screen_sources;
mod updater;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Configurar ícone da bandeja do sistema (System Tray) com menu contextual
            let tray_icon_bytes =
                image::load_from_memory(include_bytes!("../icons/32x32.png"))?.into_rgba8();
            let (tray_w, tray_h) = tray_icon_bytes.dimensions();
            let tray_icon =
                tauri::image::Image::new_owned(tray_icon_bytes.into_raw(), tray_w, tray_h);

            let open_item =
                MenuItem::with_id(app, "open", "Abrir Stapp", true, None::<&str>)?;
            let mute_item =
                MenuItem::with_id(app, "mute", "Mutar Microfone", true, None::<&str>)?;
            let quit_item =
                MenuItem::with_id(app, "quit", "Sair Definitivamente", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&open_item, &mute_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(tray_icon)
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    "mute" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.emit("stapp:toggle-mute", ());
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::DoubleClick {
                        button: MouseButton::Left,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

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
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
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
