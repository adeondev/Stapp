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
    server.state.join_voice(&first, "voz-a").await.unwrap();
    server.state.join_voice(&second, "voz-b").await.unwrap();
    let mut events = server.state.subscribe();

    relay(
        &server.state,
        &first,
        &second,
        serde_json::json!({ "kind": "blocked" }),
    )
    .await;
    assert!(matches!(events.try_recv(), Err(TryRecvError::Empty)));

    server.state.join_voice(&second, "voz-a").await.unwrap();
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
