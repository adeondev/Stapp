use super::*;
use crate::session::Target;
use crate::test_support::TestServer;

fn coletar(
    events: &mut tokio::sync::broadcast::Receiver<crate::session::Envelope>,
) -> Vec<(String, ServerMsg)> {
    let mut saida = Vec::new();
    while let Ok(envelope) = events.try_recv() {
        if let Target::Peer(peer) = envelope.target {
            saida.push((peer, envelope.msg));
        }
    }
    saida
}

/// Daniel em "d1", Alice em "a1", os dois conectados.
async fn dupla() -> (TestServer, crate::storage::Account, crate::storage::Account) {
    let server = TestServer::new(10, 4);
    let daniel = server.account("Daniel");
    let alice = server.account("Alice");
    server.state.register_session("d1", &daniel).await.unwrap();
    server.state.register_session("a1", &alice).await.unwrap();
    (server, daniel, alice)
}

#[tokio::test]
async fn ligar_toca_do_outro_lado_e_confirma_para_quem_ligou() {
    let (server, _daniel, alice) = dupla().await;
    let mut events = server.state.subscribe();

    start(&server.state, "d1", alice.id.clone()).await;

    let eventos = coletar(&mut events);
    let tocou = eventos.iter().any(|(peer, msg)| {
        peer == "a1" && matches!(msg, ServerMsg::CallIncoming { username, .. } if username == "Daniel")
    });
    let confirmou = eventos
        .iter()
        .any(|(peer, msg)| peer == "d1" && matches!(msg, ServerMsg::CallRinging { .. }));
    assert!(tocou, "tinha que tocar para a alice");
    assert!(confirmou, "quem ligou precisa saber que esta tocando");
}

#[tokio::test]
async fn atender_manda_os_dois_para_o_mesmo_canal() {
    let (server, daniel, alice) = dupla().await;
    start(&server.state, "d1", alice.id.clone()).await;

    let mut events = server.state.subscribe();
    accept(&server.state, "a1", daniel.id.clone()).await;

    let canais: Vec<String> = coletar(&mut events)
        .into_iter()
        .filter_map(|(_, msg)| match msg {
            ServerMsg::CallAccepted { channel, .. } => Some(channel),
            _ => None,
        })
        .collect();
    assert_eq!(canais.len(), 2, "os dois lados precisam ser avisados");
    assert_eq!(canais[0], canais[1], "e no mesmo canal");
    assert_eq!(canais[0], voice::direct_channel(&daniel.id, &alice.id));
}

#[tokio::test]
async fn recusar_avisa_os_dois_e_deixa_rastro_na_conversa() {
    let (server, daniel, alice) = dupla().await;
    start(&server.state, "d1", alice.id.clone()).await;

    let mut events = server.state.subscribe();
    decline(&server.state, "a1", daniel.id.clone()).await;

    let eventos = coletar(&mut events);
    let encerrados: Vec<&str> = eventos
        .iter()
        .filter(|(_, msg)| {
            matches!(
                msg,
                ServerMsg::CallEnded {
                    reason: CallEndReason::Declined,
                    ..
                }
            )
        })
        .map(|(peer, _)| peer.as_str())
        .collect();
    assert!(encerrados.contains(&"d1") && encerrados.contains(&"a1"), "{encerrados:?}");

    let conversa = conversation_id(&daniel.id, &alice.id);
    let historico = server.state.db.direct_history(&conversa, 10).unwrap();
    assert_eq!(historico.len(), 1);
    assert_eq!(historico[0].kind, DirectMessageKind::Call);
    assert_eq!(historico[0].text, "chamada recusada");
}

#[tokio::test]
async fn ligar_para_quem_esta_offline_nem_toca() {
    let server = TestServer::new(10, 4);
    let daniel = server.account("Daniel");
    let alice = server.account("Alice");
    server.state.register_session("d1", &daniel).await.unwrap();
    // A alice tem conta, mas nao esta conectada.

    let mut events = server.state.subscribe();
    start(&server.state, "d1", alice.id.clone()).await;

    let eventos = coletar(&mut events);
    assert!(eventos.iter().any(|(peer, msg)| peer == "d1"
        && matches!(
            msg,
            ServerMsg::CallEnded {
                reason: CallEndReason::Offline,
                ..
            }
        )));
    // Nao chegou a tocar, entao nao vira linha na conversa.
    let conversa = conversation_id(&daniel.id, &alice.id);
    assert!(server.state.db.direct_history(&conversa, 10).unwrap().is_empty());
}

#[tokio::test]
async fn quem_ja_esta_tocando_aparece_ocupado() {
    let (server, daniel, alice) = dupla().await;
    let bob = server.account("Bob");
    server.state.register_session("b1", &bob).await.unwrap();

    start(&server.state, "d1", alice.id.clone()).await;

    let mut events = server.state.subscribe();
    // Bob tenta ligar para a alice, que ja esta com o telefone tocando.
    start(&server.state, "b1", alice.id.clone()).await;

    assert!(coletar(&mut events).iter().any(|(peer, msg)| peer == "b1"
        && matches!(
            msg,
            ServerMsg::CallEnded {
                reason: CallEndReason::Busy,
                ..
            }
        )));
    // E a chamada original continua de pe.
    assert!(server.state.take_call(&daniel.id, &alice.id).await.is_some());
}

#[tokio::test]
async fn so_quem_recebeu_pode_atender() {
    let (server, _daniel, alice) = dupla().await;
    start(&server.state, "d1", alice.id.clone()).await;

    let mut events = server.state.subscribe();
    // Quem ligou tentando "atender" a propria chamada nao faz nada.
    accept(&server.state, "d1", alice.id.clone()).await;

    assert!(
        !coletar(&mut events)
            .iter()
            .any(|(_, msg)| matches!(msg, ServerMsg::CallAccepted { .. })),
        "quem ligou nao atende a propria chamada"
    );
}

#[tokio::test]
async fn cair_com_o_telefone_tocando_encerra_a_chamada() {
    let (server, daniel, alice) = dupla().await;
    start(&server.state, "d1", alice.id.clone()).await;

    let mut events = server.state.subscribe();
    // Quem ligou fechou o app.
    drop_for(&server.state, &daniel.id).await;

    assert!(coletar(&mut events).iter().any(|(peer, msg)| peer == "a1"
        && matches!(
            msg,
            ServerMsg::CallEnded {
                reason: CallEndReason::Canceled,
                ..
            }
        )));
    assert!(server.state.take_call(&daniel.id, &alice.id).await.is_none());
}

#[tokio::test]
async fn toca_mesmo_com_a_pessoa_ja_numa_sala_de_voz() {
    let (server, daniel, alice) = dupla().await;
    // A alice esta conversando na sala com os outros.
    voice::join(&server.state, &"a1".to_string(), "voz-a").await;

    let mut events = server.state.subscribe();
    start(&server.state, "d1", alice.id.clone()).await;
    assert!(
        coletar(&mut events)
            .iter()
            .any(|(peer, msg)| peer == "a1" && matches!(msg, ServerMsg::CallIncoming { .. })),
        "estar na sala nao pode impedir o toque"
    );

    // Ao atender, entrar no canal da conversa tira ela da sala sozinho.
    accept(&server.state, "a1", daniel.id.clone()).await;
    let canal = voice::direct_channel(&daniel.id, &alice.id);
    voice::join(&server.state, &"a1".to_string(), &canal).await;

    assert!(
        server.state.peers_in_voice("voz-a").await.is_empty(),
        "ela nao pode ficar nas duas"
    );
    assert_eq!(server.state.peers_in_voice(&canal).await, vec!["a1"]);
}
