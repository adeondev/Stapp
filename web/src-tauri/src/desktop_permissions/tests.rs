use super::*;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ, COREWEBVIEW2_PERMISSION_KIND_GEOLOCATION,
};

#[test]
fn autoriza_somente_microfone_e_camera() {
    assert!(is_stapp_media_permission(
        COREWEBVIEW2_PERMISSION_KIND_MICROPHONE
    ));
    assert!(is_stapp_media_permission(
        COREWEBVIEW2_PERMISSION_KIND_CAMERA
    ));
    assert!(!is_stapp_media_permission(
        COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ
    ));
    assert!(!is_stapp_media_permission(
        COREWEBVIEW2_PERMISSION_KIND_GEOLOCATION
    ));
}
