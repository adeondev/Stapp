use super::*;
use crate::test_support::TestServer;

#[tokio::test]
async fn pedido_aceite_privacidade_e_bloqueio_controlam_dm() {
    let server = TestServer::new(10, 4).await;
    let daniel = server.account("Daniel").await;
    let alice = server.account("Alice").await;
    server
        .state
        .db
        .set_allow_member_dms(&alice.id, false)
        .await
        .unwrap();
    assert!(!server.state.db.can_direct(&daniel.id, &alice.id).await.unwrap());

    server.state.register_session("d1", &daniel).await.unwrap();
    server.state.register_session("a1", &alice).await.unwrap();
    request(&server.state, "d1", alice.id.clone()).await;
    accept(&server.state, "a1", daniel.id.clone()).await;
    assert!(server.state.db.can_direct(&daniel.id, &alice.id).await.unwrap());

    block(&server.state, "a1", daniel.id.clone()).await;
    assert!(!server.state.db.can_direct(&daniel.id, &alice.id).await.unwrap());
}
