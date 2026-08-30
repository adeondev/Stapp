use livekit_api::access_token::Claims;

use super::*;
use crate::session::AppState;
use crate::storage::Db;
use crate::test_support::{TestDir, config};

#[test]
fn nome_da_sala_e_opaco_estavel_e_especifico() {
    let first = room_name("server-a", "dm:user-a:user-b");
    assert_eq!(first, room_name("server-a", "dm:user-a:user-b"));
    assert_ne!(first, room_name("server-b", "dm:user-a:user-b"));
    assert_ne!(first, room_name("server-a", "voz-a"));
    assert!(!first.contains("user-a"));
}

#[tokio::test]
async fn grant_fica_restrito_a_sala_fontes_e_sessao() {
    let dir = TestDir::new();
    let mut config = config(dir.database(), 10, 6);
    config.voice.backend = "livekit".into();
    config.voice.public_url = Some("ws://127.0.0.1:7880".into());
    config.voice.api_url = Some("http://127.0.0.1:7880".into());
    config.voice.api_key_env = "STAPP_TEST_LK_KEY".into();
    config.voice.api_secret_env = "STAPP_TEST_LK_SECRET".into();
    let db = Db::open(&config.storage.database).unwrap();
    let state = AppState::new(config, db).unwrap();
    let account = state
        .db
        .create_account("Daniel".into(), "daniel".into(), "hash".into())
        .unwrap();
    state
        .register_session("peer-random", &account)
        .await
        .unwrap();
    // SAFETY: este teste e o unico dono destes nomes exclusivos.
    unsafe {
        std::env::set_var("STAPP_TEST_LK_KEY", "devkey");
        std::env::set_var("STAPP_TEST_LK_SECRET", "secret-with-at-least-32-characters");
    }

    let grant = issue_grant(&state, &"peer-random".into(), "voz-a")
        .await
        .unwrap();
    let claims = Claims::from_unverified(grant.token.expose()).unwrap();
    assert_eq!(claims.sub, "peer-random");
    assert_eq!(
        claims.video.room,
        room_name(&state.db.server_id().unwrap(), "voz-a")
    );
    assert!(claims.video.room_join && claims.video.can_publish && claims.video.can_subscribe);
    assert!(!claims.video.can_publish_data);
    assert!(!claims.video.room_admin && !claims.video.room_record && !claims.video.ingress_admin);
    assert_eq!(
        claims.video.can_publish_sources,
        ["microphone", "camera", "screen_share", "screen_share_audio"]
    );
    assert!(claims.exp.saturating_sub(claims.nbf) <= 60);
}
