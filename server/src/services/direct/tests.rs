use super::*;
use crate::session::Target;
use crate::test_support::TestServer;

/// Junta os eventos que sairam no broadcast, com o destinatario.
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

#[tokio::test]
async fn a_mensagem_chega_so_nas_duas_pontas() {
    let server = TestServer::new(10, 4);
    let daniel = server.account("Daniel");
    let alice = server.account("Alice");
    let bob = server.account("Bob");
    server.state.register_session("d1", &daniel).await.unwrap();
    server.state.register_session("a1", &alice).await.unwrap();
    server.state.register_session("b1", &bob).await.unwrap();

    let mut events = server.state.subscribe();
    send(
        &server.state,
        "d1",
        alice.id.clone(),
        "  oi alice  ",
        Vec::new(),
        None,
    )
    .await;
    let entregues = coletar(&mut events);

    let destinos: Vec<&str> = entregues.iter().map(|(peer, _)| peer.as_str()).collect();
    assert!(
        destinos.contains(&"d1"),
        "o autor precisa ver a propria mensagem"
    );
    assert!(destinos.contains(&"a1"), "a destinataria precisa receber");
    assert!(
        !destinos.contains(&"b1"),
        "quem nao e da conversa nao pode receber"
    );
}

#[tokio::test]
async fn cada_lado_recebe_o_outro_como_dono_da_conversa() {
    let server = TestServer::new(10, 4);
    let daniel = server.account("Daniel");
    let alice = server.account("Alice");
    server.state.register_session("d1", &daniel).await.unwrap();
    server.state.register_session("a1", &alice).await.unwrap();

    let mut events = server.state.subscribe();
    send(
        &server.state,
        "d1",
        alice.id.clone(),
        "oi",
        Vec::new(),
        None,
    )
    .await;

    for (peer, msg) in coletar(&mut events) {
        let ServerMsg::DmNew {
            user_id, unread, ..
        } = msg
        else {
            continue;
        };
        match peer.as_str() {
            // Para o autor a conversa e "com a alice", e ele ja leu.
            "d1" => {
                assert_eq!(user_id, alice.id);
                assert_eq!(unread, 0);
            }
            // Para ela a conversa e "com o daniel", e tem uma nao lida.
            "a1" => {
                assert_eq!(user_id, daniel.id);
                assert_eq!(unread, 1);
            }
            outro => panic!("destinatario inesperado: {outro}"),
        }
    }
}

#[tokio::test]
async fn nao_lidas_acumulam_e_zeram_ao_abrir() {
    let server = TestServer::new(10, 4);
    let daniel = server.account("Daniel");
    let alice = server.account("Alice");
    server.state.register_session("d1", &daniel).await.unwrap();
    server.state.register_session("a1", &alice).await.unwrap();

    send(
        &server.state,
        "d1",
        alice.id.clone(),
        "uma",
        Vec::new(),
        None,
    )
    .await;
    send(
        &server.state,
        "d1",
        alice.id.clone(),
        "duas",
        Vec::new(),
        None,
    )
    .await;

    let conversa = conversation_id(&daniel.id, &alice.id);
    assert_eq!(
        server.state.db.direct_unread(&alice.id, &conversa).unwrap(),
        2
    );
    // O que voce mesmo escreveu nunca conta.
    assert_eq!(
        server
            .state
            .db
            .direct_unread(&daniel.id, &conversa)
            .unwrap(),
        0
    );

    open(&server.state, "a1", daniel.id.clone()).await;
    assert_eq!(
        server.state.db.direct_unread(&alice.id, &conversa).unwrap(),
        0
    );
}

#[tokio::test]
async fn conversa_offline_espera_no_historico() {
    let server = TestServer::new(10, 4);
    let daniel = server.account("Daniel");
    let alice = server.account("Alice");
    server.state.register_session("d1", &daniel).await.unwrap();
    // A alice nem conectou.

    send(
        &server.state,
        "d1",
        alice.id.clone(),
        "te procurei",
        Vec::new(),
        None,
    )
    .await;

    server.state.register_session("a1", &alice).await.unwrap();
    let mut events = server.state.subscribe();
    open(&server.state, "a1", daniel.id.clone()).await;

    let historico = coletar(&mut events)
        .into_iter()
        .find_map(|(_, msg)| match msg {
            ServerMsg::DmHistory { msgs, .. } => Some(msgs),
            _ => None,
        })
        .expect("historico");
    assert_eq!(historico.len(), 1);
    assert_eq!(historico[0].text, "te procurei");
}

#[tokio::test]
async fn a_lista_traz_com_quem_voce_falou_e_quantas_faltam_ler() {
    let server = TestServer::new(10, 4);
    let daniel = server.account("Daniel");
    let alice = server.account("Alice");
    server.state.register_session("d1", &daniel).await.unwrap();
    server.state.register_session("a1", &alice).await.unwrap();

    send(
        &server.state,
        "d1",
        alice.id.clone(),
        "primeira",
        Vec::new(),
        None,
    )
    .await;

    let mut events = server.state.subscribe();
    send_list(&server.state, "a1").await;

    let lista = coletar(&mut events)
        .into_iter()
        .find_map(|(_, msg)| match msg {
            ServerMsg::DmList { conversations } => Some(conversations),
            _ => None,
        })
        .expect("lista");
    assert_eq!(lista.len(), 1);
    assert_eq!(lista[0].user_id, daniel.id);
    assert_eq!(lista[0].unread, 1);
    assert_eq!(lista[0].last.as_ref().unwrap().text, "primeira");
}

#[tokio::test]
async fn recusa_conversa_consigo_mesmo_e_conta_inexistente() {
    let server = TestServer::new(10, 4);
    let daniel = server.account("Daniel");
    server.state.register_session("d1", &daniel).await.unwrap();

    let mut events = server.state.subscribe();
    send(
        &server.state,
        "d1",
        daniel.id.clone(),
        "eco",
        Vec::new(),
        None,
    )
    .await;
    send(
        &server.state,
        "d1",
        "nao-existe".to_string(),
        "oi",
        Vec::new(),
        None,
    )
    .await;

    let erros: Vec<_> = coletar(&mut events)
        .into_iter()
        .filter(|(_, msg)| matches!(msg, ServerMsg::Error { .. }))
        .collect();
    assert_eq!(erros.len(), 2);
}

#[tokio::test]
async fn o_diretorio_nao_inclui_voce_nem_conta_desativada() {
    let server = TestServer::new(10, 4);
    let daniel = server.account("Daniel");
    let alice = server.account("Alice");
    server.account("Bob");
    server.state.db.set_disabled("alice", true).unwrap();

    let lista = directory(&server.state, &daniel.id);
    let nomes: Vec<&str> = lista.iter().map(|e| e.username.as_str()).collect();
    assert_eq!(nomes, ["Bob"]);
    assert!(!lista.iter().any(|e| e.user_id == alice.id));
}

#[test]
fn o_id_da_conversa_independe_da_ordem() {
    assert_eq!(conversation_id("aaa", "bbb"), conversation_id("bbb", "aaa"));
    assert_ne!(conversation_id("aaa", "bbb"), conversation_id("aaa", "ccc"));
}

#[tokio::test]
async fn ler_numa_sessao_limpa_o_badge_das_outras() {
    let server = TestServer::new(10, 4);
    let daniel = server.account("Daniel");
    let alice = server.account("Alice");
    // A alice esta com o app aberto em dois lugares.
    server.state.register_session("a1", &alice).await.unwrap();
    server.state.register_session("a2", &alice).await.unwrap();
    server.state.register_session("d1", &daniel).await.unwrap();

    send(
        &server.state,
        "d1",
        alice.id.clone(),
        "olha isso",
        Vec::new(),
        None,
    )
    .await;

    let mut events = server.state.subscribe();
    // Ela le numa das abas.
    mark_read(&server.state, "a1", daniel.id.clone()).await;

    let avisadas: Vec<String> = coletar(&mut events)
        .into_iter()
        .filter(|(_, msg)| matches!(msg, ServerMsg::DmRead { .. }))
        .map(|(peer, _)| peer)
        .collect();
    assert!(avisadas.contains(&"a1".to_string()));
    assert!(
        avisadas.contains(&"a2".to_string()),
        "a outra aba dela precisa limpar o badge tambem: {avisadas:?}"
    );
    assert!(
        !avisadas.contains(&"d1".to_string()),
        "o daniel nao tem nada a ver com a leitura dela"
    );
}
