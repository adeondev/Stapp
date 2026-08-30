use super::*;
use crate::session::Target;
use crate::test_support::TestServer;

fn perfis_anunciados(
    events: &mut tokio::sync::broadcast::Receiver<crate::session::Envelope>,
) -> Vec<(Target, Profile)> {
    let mut saida = Vec::new();
    while let Ok(envelope) = events.try_recv() {
        if let ServerMsg::UserProfile { profile } = envelope.msg {
            saida.push((envelope.target, profile));
        }
    }
    saida
}

#[tokio::test]
async fn conta_sem_perfil_ja_nasce_com_um() {
    let server = TestServer::new(10, 4);
    let daniel = server.account("Daniel");

    let perfil = server.state.db.profile_of(&daniel.id).unwrap().unwrap();
    // Sem escolher nada, o nome de exibicao e o proprio username.
    assert_eq!(perfil.display_name, "Daniel");
    assert_eq!(perfil.username, "Daniel");
    assert_eq!(perfil.accent, "blue");
    assert_eq!(perfil.bio, "");
    assert!(!perfil.has_avatar);
}

#[tokio::test]
async fn editar_grava_e_conta_para_todo_mundo() {
    let server = TestServer::new(10, 4);
    let daniel = server.account("Daniel");
    server.state.register_session("d1", &daniel).await.unwrap();
    let mut events = server.state.subscribe();

    update(
        &server.state,
        "d1",
        Some("  Deon da Silva  ".into()),
        Some("green".into()),
        Some("jogando desde sempre".into()),
    )
    .await;

    let anunciados = perfis_anunciados(&mut events);
    assert_eq!(anunciados.len(), 1);
    // Perfil e publico dentro do servidor: vai para todos, nao so para os amigos.
    assert!(matches!(anunciados[0].0, Target::All));

    let perfil = &anunciados[0].1;
    assert_eq!(perfil.display_name, "Deon da Silva");
    assert_eq!(perfil.accent, "green");
    assert_eq!(perfil.bio, "jogando desde sempre");
    // O username nao muda junto: ele e o login.
    assert_eq!(perfil.username, "Daniel");
}

#[tokio::test]
async fn campo_ausente_nao_mexe_no_que_ja_estava() {
    let server = TestServer::new(10, 4);
    let daniel = server.account("Daniel");
    server.state.register_session("d1", &daniel).await.unwrap();

    update(&server.state, "d1", Some("Deon".into()), Some("red".into()), None).await;
    // So a bio desta vez.
    update(&server.state, "d1", None, None, Some("mudei so a bio".into())).await;

    let perfil = server.state.db.profile_of(&daniel.id).unwrap().unwrap();
    assert_eq!(perfil.display_name, "Deon", "o nome tinha que continuar");
    assert_eq!(perfil.accent, "red", "a cor tinha que continuar");
    assert_eq!(perfil.bio, "mudei so a bio");
}

#[tokio::test]
async fn nome_vazio_volta_para_o_username() {
    let server = TestServer::new(10, 4);
    let daniel = server.account("Daniel");
    server.state.register_session("d1", &daniel).await.unwrap();

    update(&server.state, "d1", Some("Deon".into()), None, None).await;
    assert_eq!(
        server.state.db.profile_of(&daniel.id).unwrap().unwrap().display_name,
        "Deon"
    );

    // Vazio nao e "nao mexe": e apagar a escolha.
    update(&server.state, "d1", Some("   ".into()), None, None).await;
    assert_eq!(
        server.state.db.profile_of(&daniel.id).unwrap().unwrap().display_name,
        "Daniel"
    );
}

#[tokio::test]
async fn cor_fora_da_paleta_e_recusada_sem_gravar_nada() {
    let server = TestServer::new(10, 4);
    let daniel = server.account("Daniel");
    server.state.register_session("d1", &daniel).await.unwrap();
    let mut events = server.state.subscribe();

    update(
        &server.state,
        "d1",
        Some("Deon".into()),
        Some("rosa-choque".into()),
        None,
    )
    .await;

    let recusou = events
        .try_recv()
        .map(|envelope| matches!(envelope.msg, ServerMsg::Error { .. }))
        .unwrap_or(false);
    assert!(recusou);
    // E nada foi gravado, nem o nome que vinha junto.
    let perfil = server.state.db.profile_of(&daniel.id).unwrap().unwrap();
    assert_eq!(perfil.display_name, "Daniel");
    assert_eq!(perfil.accent, "blue");
}

#[tokio::test]
async fn texto_longo_demais_e_cortado_no_limite() {
    let server = TestServer::new(10, 4);
    let daniel = server.account("Daniel");
    server.state.register_session("d1", &daniel).await.unwrap();

    update(
        &server.state,
        "d1",
        Some("N".repeat(200)),
        None,
        Some("B".repeat(500)),
    )
    .await;

    let perfil = server.state.db.profile_of(&daniel.id).unwrap().unwrap();
    assert_eq!(perfil.display_name.chars().count(), MAX_DISPLAY_NAME);
    assert_eq!(perfil.bio.chars().count(), MAX_BIO);
}

#[tokio::test]
async fn a_lista_do_welcome_traz_todo_mundo_menos_conta_desativada() {
    let server = TestServer::new(10, 4);
    server.account("Daniel");
    server.account("Alice");
    server.account("Bob");
    server.state.db.set_disabled("bob", true).unwrap();

    let nomes: Vec<String> = all(&server.state)
        .into_iter()
        .map(|perfil| perfil.username)
        .collect();
    assert_eq!(nomes, ["Alice", "Daniel"]);
}
