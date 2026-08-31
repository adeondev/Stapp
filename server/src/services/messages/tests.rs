use super::*;
use crate::protocol::ServerMsg;
use crate::services::{chat, direct};
use crate::session::{Envelope, Target};
use crate::test_support::TestServer;

#[test]
fn limpa_controle_e_apara_as_pontas() {
    assert_eq!(clean_text("  oi\0\nmundo  ").unwrap(), "oi\nmundo");
    assert_eq!(clean_text("\0\r\t"), None);
    assert_eq!(clean_text("   "), None);
}

#[test]
fn nao_corta_mais_o_texto_por_conta_propria() {
    // Cortar em silencio era o comportamento antigo. Agora `clean_text` so
    // limpa; quem passa do teto e recusado com aviso, nao truncado.
    let texto = "a".repeat(5000);
    assert_eq!(clean_text(&texto).unwrap().len(), 5000);
}

#[test]
fn o_teto_conta_caracteres_e_nao_bytes() {
    // Quatro emojis sao 16 bytes, mas quem escreveu digitou quatro coisas.
    let texto = "😀😀😀😀";
    assert!(texto.len() > 4);
    assert!(fits(texto, 4));
    assert!(!fits(texto, 3));
}

#[test]
fn os_limites_do_cliente_saem_da_config() {
    let server = TestServer::new(10, 4);
    let limites = client_limits(&server.state);

    assert_eq!(
        limites.max_upload_bytes,
        server.state.config.limits.max_upload_mb * 1024 * 1024
    );
    assert_eq!(
        limites.max_text_chars,
        server.state.config.limits.max_text_chars
    );
}

/// Esvazia a fila e devolve tudo o que saiu, com o alvo de cada evento.
fn drenar(events: &mut tokio::sync::broadcast::Receiver<Envelope>) -> Vec<Envelope> {
    let mut saida = Vec::new();
    while let Ok(envelope) = events.try_recv() {
        saida.push(envelope);
    }
    saida
}

/// Manda uma mensagem no canal e devolve o id dela.
async fn mandar_no_canal(server: &TestServer, peer: &str, texto: &str) -> String {
    chat::send(&server.state, peer, "geral".into(), texto, Vec::new(), None).await;
    server.state.db.history("geral", 1).unwrap()[0].id.clone()
}

#[tokio::test]
async fn editar_marca_a_hora_e_reemite_a_mensagem_inteira() {
    let server = TestServer::new(10, 4);
    let daniel = server.account("Daniel");
    server
        .state
        .register_session("peer", &daniel)
        .await
        .unwrap();
    let id = mandar_no_canal(&server, "peer", "mensagem com erro").await;

    let mut events = server.state.subscribe();
    edit(&server.state, "peer", id.clone(), "mensagem corrigida").await;

    let eventos = drenar(&mut events);
    let atualizacao = eventos
        .iter()
        .find(|e| matches!(e.msg, ServerMsg::ChatUpdated { .. }))
        .expect("faltou o chat.updated");
    assert!(matches!(atualizacao.target, Target::All));
    match &atualizacao.msg {
        ServerMsg::ChatUpdated { channel, msg } => {
            assert_eq!(channel, "geral");
            assert_eq!(msg.text, "mensagem corrigida");
            // A marca de editada e o que a tela usa para escrever "(editado)".
            assert!(msg.edited_at.is_some());
        }
        outro => panic!("evento inesperado: {outro:?}"),
    }
}

/// PROTOTYPE: nao existe moderador. Este teste e o que segura a concessao — se
/// um dia aparecer, ele muda de proposito, nao por acidente.
#[tokio::test]
async fn ninguem_edita_nem_apaga_mensagem_dos_outros() {
    let server = TestServer::new(10, 4);
    let daniel = server.account("Daniel");
    let alice = server.account("Alice");
    server
        .state
        .register_session("peer-daniel", &daniel)
        .await
        .unwrap();
    server
        .state
        .register_session("peer-alice", &alice)
        .await
        .unwrap();
    let id = mandar_no_canal(&server, "peer-daniel", "texto do daniel").await;

    let mut events = server.state.subscribe();
    edit(&server.state, "peer-alice", id.clone(), "invadido").await;
    delete(&server.state, "peer-alice", id.clone()).await;

    let eventos = drenar(&mut events);
    // So o aviso de recusa, e so para quem tentou.
    assert!(
        eventos
            .iter()
            .all(|e| matches!(e.msg, ServerMsg::Error { .. }))
    );
    assert!(
        eventos
            .iter()
            .all(|e| matches!(&e.target, Target::Peer(p) if p == "peer-alice"))
    );
    assert_eq!(
        server.state.db.history("geral", 10).unwrap()[0].text,
        "texto do daniel"
    );
}

#[tokio::test]
async fn apagar_no_canal_avisa_todo_mundo_e_some_do_historico() {
    let server = TestServer::new(10, 4);
    let daniel = server.account("Daniel");
    server
        .state
        .register_session("peer", &daniel)
        .await
        .unwrap();
    let id = mandar_no_canal(&server, "peer", "erro meu").await;

    let mut events = server.state.subscribe();
    delete(&server.state, "peer", id.clone()).await;

    let eventos = drenar(&mut events);
    match &eventos[0].msg {
        ServerMsg::ChatDeleted {
            channel,
            message_id,
        } => {
            assert_eq!(channel, "geral");
            assert_eq!(*message_id, id);
        }
        outro => panic!("evento inesperado: {outro:?}"),
    }
    assert!(matches!(eventos[0].target, Target::All));
    assert!(server.state.db.history("geral", 10).unwrap().is_empty());
}

#[tokio::test]
async fn reagir_alterna_e_o_payload_e_igual_para_todo_mundo() {
    let server = TestServer::new(10, 4);
    let daniel = server.account("Daniel");
    let alice = server.account("Alice");
    server
        .state
        .register_session("peer-daniel", &daniel)
        .await
        .unwrap();
    server
        .state
        .register_session("peer-alice", &alice)
        .await
        .unwrap();
    let id = mandar_no_canal(&server, "peer-daniel", "vale um joinha").await;

    let mut events = server.state.subscribe();
    react(&server.state, "peer-alice", id.clone(), "👍".into()).await;

    let eventos = drenar(&mut events);
    match &eventos[0].msg {
        ServerMsg::ChatUpdated { msg, .. } => {
            assert_eq!(msg.reactions.len(), 1);
            assert_eq!(msg.reactions[0].emoji, "👍");
            // Vai o user_id, nunca o perfil: quem reagiu se resolve no cliente.
            assert_eq!(msg.reactions[0].users, vec![alice.id.clone()]);
        }
        outro => panic!("evento inesperado: {outro:?}"),
    }
    // O evento e um so, por broadcast: nao existe payload por espectador. E o
    // que garante que ninguem receba um "reacted_by_me" errado.
    assert!(matches!(eventos[0].target, Target::All));

    react(&server.state, "peer-alice", id.clone(), "👍".into()).await;
    assert!(
        server
            .state
            .db
            .reactions_of_message(&id)
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn reacao_vazia_ou_gigante_e_recusada() {
    let server = TestServer::new(10, 4);
    let daniel = server.account("Daniel");
    server
        .state
        .register_session("peer", &daniel)
        .await
        .unwrap();
    let id = mandar_no_canal(&server, "peer", "oi").await;

    react(&server.state, "peer", id.clone(), "   ".into()).await;
    react(&server.state, "peer", id.clone(), "a".repeat(50)).await;

    assert!(
        server
            .state
            .db
            .reactions_of_message(&id)
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn editar_e_apagar_em_conversa_nunca_vao_por_broadcast() {
    let server = TestServer::new(10, 4);
    let daniel = server.account("Daniel");
    let alice = server.account("Alice");
    let bob = server.account("Bob");
    for (peer, conta) in [
        ("peer-daniel", &daniel),
        ("peer-alice", &alice),
        ("peer-bob", &bob),
    ] {
        server.state.register_session(peer, conta).await.unwrap();
    }

    direct::send(
        &server.state,
        "peer-daniel",
        alice.id.clone(),
        "so entre nos",
        Vec::new(),
        None,
    )
    .await;
    let conversa = crate::storage::conversation_id(&daniel.id, &alice.id);
    let id = server.state.db.direct_history(&conversa, 1).unwrap()[0]
        .id
        .clone();

    let mut events = server.state.subscribe();
    edit(&server.state, "peer-daniel", id.clone(), "corrigido").await;
    delete(&server.state, "peer-daniel", id.clone()).await;

    let eventos = drenar(&mut events);
    // Contar para o servidor inteiro que uma mensagem foi editada ja revelaria
    // quem conversa com quem — e a regra dura do CLAUDE.md.
    assert!(
        !eventos.iter().any(|e| matches!(e.target, Target::All)),
        "evento de conversa nao pode sair por broadcast"
    );
    assert!(
        !eventos
            .iter()
            .any(|e| matches!(&e.target, Target::Peer(p) if p == "peer-bob")),
        "quem nao e da conversa nao pode receber nada"
    );

    let atualizacao = eventos
        .iter()
        .find_map(|e| match (&e.target, &e.msg) {
            (Target::Peer(p), ServerMsg::DmUpdated { user_id, .. }) if p == "peer-daniel" => {
                Some(user_id.clone())
            }
            _ => None,
        })
        .expect("faltou o dm.updated para quem editou");
    // Cada lado recebe a OUTRA pessoa como dono da conversa.
    assert_eq!(atualizacao, alice.id);

    assert!(
        eventos
            .iter()
            .any(|e| matches!(&e.msg, ServerMsg::DmDeleted { .. }))
    );
    assert!(
        server
            .state
            .db
            .direct_history(&conversa, 10)
            .unwrap()
            .is_empty()
    );
}

/// Sem esta guarda bastaria adivinhar um UUID para reagir na conversa dos
/// outros — e, de quebra, passar a receber os eventos dela.
#[tokio::test]
async fn estranho_nao_reage_em_conversa_alheia() {
    let server = TestServer::new(10, 4);
    let daniel = server.account("Daniel");
    let alice = server.account("Alice");
    let bob = server.account("Bob");
    for (peer, conta) in [
        ("peer-daniel", &daniel),
        ("peer-alice", &alice),
        ("peer-bob", &bob),
    ] {
        server.state.register_session(peer, conta).await.unwrap();
    }

    direct::send(
        &server.state,
        "peer-daniel",
        alice.id.clone(),
        "so entre nos",
        Vec::new(),
        None,
    )
    .await;
    let conversa = crate::storage::conversation_id(&daniel.id, &alice.id);
    let id = server.state.db.direct_history(&conversa, 1).unwrap()[0]
        .id
        .clone();

    let mut events = server.state.subscribe();
    react(&server.state, "peer-bob", id.clone(), "👀".into()).await;

    let eventos = drenar(&mut events);
    assert!(
        server
            .state
            .db
            .reactions_of_message(&id)
            .unwrap()
            .is_empty()
    );
    assert!(
        eventos
            .iter()
            .all(|e| matches!(e.msg, ServerMsg::Error { .. })),
        "so pode ter saido a recusa"
    );
}

#[tokio::test]
async fn editar_para_vazio_e_recusado_em_vez_de_apagar() {
    let server = TestServer::new(10, 4);
    let daniel = server.account("Daniel");
    server
        .state
        .register_session("peer", &daniel)
        .await
        .unwrap();
    let id = mandar_no_canal(&server, "peer", "conteudo").await;

    edit(&server.state, "peer", id.clone(), "   ").await;

    // Apagar e uma decisao explicita; esvaziar o texto nao e atalho para ela.
    assert_eq!(
        server.state.db.history("geral", 10).unwrap()[0].text,
        "conteudo"
    );
}

#[tokio::test]
async fn responder_id_de_outro_escopo_e_ignorado() {
    let server = TestServer::new(10, 4);
    let daniel = server.account("Daniel");
    let alice = server.account("Alice");
    server
        .state
        .register_session("peer-daniel", &daniel)
        .await
        .unwrap();
    server
        .state
        .register_session("peer-alice", &alice)
        .await
        .unwrap();

    direct::send(
        &server.state,
        "peer-daniel",
        alice.id.clone(),
        "segredo da conversa",
        Vec::new(),
        None,
    )
    .await;
    let conversa = crate::storage::conversation_id(&daniel.id, &alice.id);
    let id_da_dm = server.state.db.direct_history(&conversa, 1).unwrap()[0]
        .id
        .clone();

    // Responder o id da DM dentro do canal publico. Sem a guarda, a previa
    // levaria o texto da conversa para todo mundo do servidor.
    chat::send(
        &server.state,
        "peer-daniel",
        "geral".into(),
        "olha isso",
        Vec::new(),
        Some(id_da_dm),
    )
    .await;

    let publicada = &server.state.db.history("geral", 1).unwrap()[0];
    assert!(publicada.reply_to.is_none());
}

#[tokio::test]
async fn mencao_resolve_username_e_ignora_quem_nao_existe() {
    let server = TestServer::new(10, 4);
    let daniel = server.account("Daniel");
    let alice = server.account("Alice");

    let citadas = mentions::resolve(&server.state, "oi @alice e @ninguem, tudo bem @Daniel?");

    // Case-insensitive, na ordem em que aparecem, sem repetir.
    assert_eq!(citadas.user_ids, vec![alice.id.clone(), daniel.id.clone()]);
    assert!(!citadas.everyone);
}

#[tokio::test]
async fn everyone_e_reservado_mesmo_com_conta_de_mesmo_nome() {
    let server = TestServer::new(10, 4);
    server.account("everyone");

    let citadas = mentions::resolve(&server.state, "atencao @everyone");

    assert!(citadas.everyone);
    assert!(
        citadas.user_ids.is_empty(),
        "@everyone nunca vira citacao de uma conta"
    );
}

#[tokio::test]
async fn mencao_nao_reescreve_o_texto_e_a_edicao_recalcula() {
    let server = TestServer::new(10, 4);
    let daniel = server.account("Daniel");
    let alice = server.account("Alice");
    server
        .state
        .register_session("peer", &daniel)
        .await
        .unwrap();

    let id = mandar_no_canal(&server, "peer", "fala @alice").await;
    let msg = &server.state.db.history("geral", 1).unwrap()[0];
    // O texto guardado continua exatamente o que foi digitado: nao existe
    // formato de marcacao para o cliente decodificar.
    assert_eq!(msg.text, "fala @alice");
    assert_eq!(msg.mentions, vec![alice.id.clone()]);

    edit(&server.state, "peer", id, "deixa pra la").await;
    let msg = &server.state.db.history("geral", 1).unwrap()[0];
    assert!(msg.mentions.is_empty(), "tirar o @ tira a citacao junto");
}
