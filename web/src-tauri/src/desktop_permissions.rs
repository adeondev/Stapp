#[cfg(windows)]
use webview2_com::{
    Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_KIND_CAMERA,
        COREWEBVIEW2_PERMISSION_KIND_MICROPHONE, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
    },
    PermissionRequestedEventHandler,
};

#[cfg(windows)]
pub fn install(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    window.with_webview(|platform| {
        let controller = platform.controller();
        let webview = match unsafe { controller.CoreWebView2() } {
            Ok(webview) => webview,
            Err(error) => {
                log::error!("nao foi possivel acessar o WebView2: {error}");
                return;
            }
        };

        let handler = PermissionRequestedEventHandler::create(Box::new(|_, args| {
            let Some(args) = args else {
                return Ok(());
            };
            let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
            unsafe { args.PermissionKind(&mut kind)? };
            if is_stapp_media_permission(kind) {
                // O executavel e o host confiavel da UI local. O Windows ainda
                // preserva a permissao global de privacidade do dispositivo;
                // removemos apenas o popup generico do tauri.localhost.
                unsafe { args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)? };
            }
            Ok(())
        }));

        let mut token = 0_i64;
        if let Err(error) = unsafe { webview.add_PermissionRequested(&handler, &mut token) } {
            log::error!("nao foi possivel instalar as permissoes de midia: {error}");
        }
    })
}

#[cfg(windows)]
fn is_stapp_media_permission(kind: COREWEBVIEW2_PERMISSION_KIND) -> bool {
    kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE || kind == COREWEBVIEW2_PERMISSION_KIND_CAMERA
}

#[cfg(all(test, windows))]
mod tests;
