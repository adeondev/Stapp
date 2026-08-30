use super::*;

#[test]
fn interpreta_ids_de_tela_e_janela() {
    assert_eq!(
        parse_source_id("screen:12:0"),
        Ok(SourceLocator::Screen(12))
    );
    assert_eq!(
        parse_source_id("window:99:0"),
        Ok(SourceLocator::Window(99))
    );
    assert!(parse_source_id("camera:1:0").is_err());
    assert!(parse_source_id("screen:x:0").is_err());
}

#[test]
fn reduz_sem_deformar_e_nunca_amplia() {
    assert_eq!(scale_to_fit(1920, 1080, 1280, 720), (1280, 720));
    assert_eq!(scale_to_fit(2560, 1080, 1280, 720), (1280, 540));
    assert_eq!(scale_to_fit(640, 360, 1280, 720), (640, 360));
    assert_eq!(scale_to_fit(0, 0, 1280, 720), (0, 0));
}
