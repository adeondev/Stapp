use tokio::sync::broadcast::error::TryRecvError;

use super::*;
use crate::session::Target;
use crate::test_support::TestServer;

#[tokio::test]
async fn sends_roster_before_announcing_a_voice_join() {
    let server = TestServer::new(10, 4);
    let first = "first".to_string();
    let second = "second".to_string();
    let first_account = server.account("First");
    let second_account = server.account("Second");
    server
        .state
        .register_session(&first, &first_account)
        .await
        .unwrap();
    server
        .state
        .register_session(&second, &second_account)
        .await
        .unwrap();
    let mut events = server.state.subscribe();

    join(&server.state, &first, "voz-a").await;
    let first_roster = events.try_recv().unwrap();
    let first_joined = events.try_recv().unwrap();
    assert!(matches!(first_roster.target, Target::Peer(ref id) if id == &first));
    assert!(matches!(
        first_roster.msg,
        ServerMsg::VoiceRoster { ref peers, .. } if peers.is_empty()
    ));
    assert!(matches!(first_joined.target, Target::Except(ref id) if id == &first));
    assert!(matches!(
        first_joined.msg,
        ServerMsg::VoiceJoined { ref peer } if peer.peer_id == first
    ));

    join(&server.state, &second, "voz-a").await;
    let second_roster = events.try_recv().unwrap();
    let second_joined = events.try_recv().unwrap();
    assert!(matches!(
        second_roster.msg,
        ServerMsg::VoiceRoster { ref peers, .. }
            if peers.len() == 1 && peers[0].peer_id == first
    ));
    assert!(matches!(second_joined.target, Target::Except(ref id) if id == &second));
    assert!(matches!(
        second_joined.msg,
        ServerMsg::VoiceJoined { ref peer } if peer.peer_id == second
    ));
}

#[tokio::test]
async fn relays_signaling_only_inside_the_same_voice_channel() {
    let server = TestServer::new(10, 4);
    let first = "first".to_string();
    let second = "second".to_string();
    let first_account = server.account("First");
    let second_account = server.account("Second");
    server
        .state
        .register_session(&first, &first_account)
        .await
        .unwrap();
    server
        .state
        .register_session(&second, &second_account)
        .await
        .unwrap();
    server.state.join_voice(&first, "voz-a", 4).await.unwrap();
    server.state.join_voice(&second, "voz-b", 4).await.unwrap();
    let mut events = server.state.subscribe();

    relay(
        &server.state,
        &first,
        &second,
        serde_json::json!({ "kind": "blocked" }),
    )
    .await;
    assert!(matches!(events.try_recv(), Err(TryRecvError::Empty)));

    server.state.join_voice(&second, "voz-a", 4).await.unwrap();
    relay(
        &server.state,
        &first,
        &second,
        serde_json::json!({ "kind": "allowed" }),
    )
    .await;

    let event = events.try_recv().unwrap();
    assert!(matches!(event.target, Target::Peer(ref id) if id == &second));
    assert!(matches!(
        event.msg,
        ServerMsg::RtcSignal { ref from, ref payload }
            if from == &first && payload["kind"] == "allowed"
    ));
}

#[test]
fn o_canal_de_uma_conversa_e_o_mesmo_dos_dois_lados() {
    let a = "aaa".to_string();
    let b = "bbb".to_string();
    assert_eq!(direct_channel(&a, &b), direct_channel(&b, &a));
    assert_eq!(direct_participants(&direct_channel(&a, &b)), Some((a, b)));
    // Uma sala normal nao e confundida com conversa.
    assert_eq!(direct_participants("voz-a"), None);
    assert_eq!(direct_participants("dm:"), None);
}

#[tokio::test]
async fn a_call_de_uma_conversa_nao_vaza_para_terceiros() {
    let server = TestServer::new(10, 4);
    let daniel = server.account("Daniel");
    let alice = server.account("Alice");
    let bob = server.account("Bob");
    server.state.register_session("d1", &daniel).await.unwrap();
    server.state.register_session("a1", &alice).await.unwrap();
    server.state.register_session("b1", &bob).await.unwrap();

    let canal = direct_channel(&daniel.id, &alice.id);
    let mut events = server.state.subscribe();

    join(&server.state, &"d1".to_string(), &canal).await;
    join(&server.state, &"a1".to_string(), &canal).await;

    let mut viu_bob = false;
    while let Ok(envelope) = events.try_recv() {
        match (&envelope.target, &envelope.msg) {
            // Um Target::All num evento de voz ja seria o vazamento.
            (Target::All, ServerMsg::VoiceJoined { .. })
            | (Target::All, ServerMsg::VoiceLeft { .. }) => {
                panic!("evento de call direta saiu em broadcast")
            }
            (Target::Peer(peer), ServerMsg::VoiceJoined { .. }) if peer == "b1" => viu_bob = true,
            _ => {}
        }
    }
    assert!(!viu_bob, "o bob nao pode saber que os dois estao em call");

    // Sair tambem so conta para os dois.
    let mut events = server.state.subscribe();
    leave(&server.state, &"a1".to_string()).await;
    while let Ok(envelope) = events.try_recv() {
        if let (Target::Peer(peer), ServerMsg::VoiceLeft { .. }) = (&envelope.target, &envelope.msg)
        {
            assert_ne!(peer, "b1", "o bob nao precisa saber que ela saiu");
        }
        assert!(
            !matches!(envelope.target, Target::All),
            "saida de call direta nao vai em broadcast"
        );
    }
}

#[tokio::test]
async fn ninguem_entra_na_conversa_de_voz_dos_outros() {
    let server = TestServer::new(10, 4);
    let daniel = server.account("Daniel");
    let alice = server.account("Alice");
    let bob = server.account("Bob");
    server.state.register_session("b1", &bob).await.unwrap();

    let canal = direct_channel(&daniel.id, &alice.id);
    let mut events = server.state.subscribe();
    join(&server.state, &"b1".to_string(), &canal).await;

    let recusou = events
        .try_recv()
        .ok()
        .map(|envelope| matches!(envelope.msg, ServerMsg::Error { .. }))
        .unwrap_or(false);
    assert!(
        recusou,
        "entrar na call de conversa alheia tem que ser recusado"
    );
    assert!(server.state.peers_in_voice(&canal).await.is_empty());
}
