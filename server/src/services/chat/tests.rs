use super::*;
use crate::session::Target;
use crate::test_support::TestServer;

#[tokio::test]
async fn sanitizes_persists_and_broadcasts_a_message() {
    let server = TestServer::new(10, 4);
    let account = server.account("Daniel");
    server
        .state
        .register_session("peer", &account)
        .await
        .unwrap();
    let mut events = server.state.subscribe();

    send(&server.state, "peer", "geral".into(), "  oi\0\nmundo  ", Vec::new(), None).await;

    let event = events.try_recv().unwrap();
    assert!(matches!(event.target, Target::All));
    match event.msg {
        ServerMsg::ChatNew { channel, msg } => {
            assert_eq!(channel, "geral");
            assert_eq!(msg.author_id, account.id);
            assert_eq!(msg.author_username, "Daniel");
            assert_eq!(msg.text, "oi\nmundo");
        }
        other => panic!("evento inesperado: {other:?}"),
    }

    let history = server.state.db.history("geral", 10).unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].text, "oi\nmundo");
}

#[tokio::test]
async fn rejects_non_text_channels() {
    let server = TestServer::new(10, 4);
    let account = server.account("Daniel");
    server
        .state
        .register_session("peer", &account)
        .await
        .unwrap();
    let mut events = server.state.subscribe();

    send(&server.state, "peer", "voz-a".into(), "nao deveria entrar", Vec::new(), None).await;

    let event = events.try_recv().unwrap();
    assert!(matches!(event.target, Target::Peer(ref id) if id == "peer"));
    assert!(matches!(event.msg, ServerMsg::Error { .. }));
    assert!(server.state.db.history("voz-a", 10).unwrap().is_empty());
}

#[tokio::test]
async fn sends_history_only_to_the_requested_peer() {
    let server = TestServer::new(10, 4);
    let account = server.account("Daniel");
    server
        .state
        .register_session("peer", &account)
        .await
        .unwrap();
    send(&server.state, "peer", "geral".into(), "mensagem", Vec::new(), None).await;
    let mut events = server.state.subscribe();

    send_history(&server.state, "peer");

    let event = events.try_recv().unwrap();
    assert!(matches!(event.target, Target::Peer(ref id) if id == "peer"));
    match event.msg {
        ServerMsg::ChatHistory { channel, msgs } => {
            assert_eq!(channel, "geral");
            assert_eq!(msgs.len(), 1);
            assert_eq!(msgs[0].text, "mensagem");
        }
        other => panic!("evento inesperado: {other:?}"),
    }
}

/// Antes o servidor cortava em 2000 caracteres **em silencio**: a pessoa via a
/// propria mensagem chegar truncada sem nenhum aviso. Agora o teto sai da
/// config e passar dele e recusa com motivo, so para quem mandou.
#[tokio::test]
async fn texto_acima_do_teto_e_recusado_em_vez_de_cortado() {
    let server = TestServer::new(10, 4);
    let account = server.account("Daniel");
    server
        .state
        .register_session("peer", &account)
        .await
        .unwrap();
    let mut events = server.state.subscribe();

    let teto = server.state.config.limits.max_text_chars;
    let texto = "a".repeat(teto + 1);
    send(&server.state, "peer", "geral".into(), &texto, Vec::new(), None).await;

    let event = events.try_recv().unwrap();
    assert!(matches!(event.target, Target::Peer(ref p) if p == "peer"));
    match event.msg {
        ServerMsg::Error { message } => assert!(message.contains(&teto.to_string())),
        other => panic!("evento inesperado: {other:?}"),
    }
    assert!(server.state.db.history("geral", 10).unwrap().is_empty());
}

/// Exatamente no teto ainda passa — o limite e inclusivo.
#[tokio::test]
async fn texto_no_teto_exato_ainda_passa() {
    let server = TestServer::new(10, 4);
    let account = server.account("Daniel");
    server
        .state
        .register_session("peer", &account)
        .await
        .unwrap();

    let teto = server.state.config.limits.max_text_chars;
    send(
        &server.state,
        "peer",
        "geral".into(),
        &"a".repeat(teto),
        Vec::new(),
        None,
    )
    .await;

    assert_eq!(server.state.db.history("geral", 10).unwrap().len(), 1);
}

#[tokio::test]
async fn envia_mensagem_sem_texto_se_houver_anexos() {
    let server = TestServer::new(10, 4);
    let account = server.account("Daniel");
    server
        .state
        .register_session("peer", &account)
        .await
        .unwrap();

    // Insere um anexo no banco para teste
    server
        .state
        .db
        .insert_attachment(
            "att-1",
            &account.id,
            "imagem.png",
            "image/png",
            1024,
            "uploads/att-1.png",
            crate::protocol::now_ms(),
        )
        .unwrap();

    let mut events = server.state.subscribe();
    send(&server.state, "peer", "geral".into(), "", vec!["att-1".into()], None).await;

    let event = events.try_recv().unwrap();
    match event.msg {
        ServerMsg::ChatNew { channel, msg } => {
            assert_eq!(channel, "geral");
            assert_eq!(msg.text, "");
            assert_eq!(msg.attachments.len(), 1);
            assert_eq!(msg.attachments[0].id, "att-1");
        }
        other => panic!("evento inesperado: {other:?}"),
    }
}
