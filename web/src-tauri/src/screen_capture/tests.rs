use super::*;

#[test]
fn tela_exclui_a_arvore_do_stapp() {
    assert_eq!(
        make_audio_target(SourceLocator::Screen(7), None, 42),
        Ok(AudioTarget {
            process_id: 42,
            include_tree: false,
        }),
    );
}

#[test]
fn janela_inclui_somente_a_arvore_escolhida_e_recusa_o_stapp() {
    assert_eq!(
        make_audio_target(SourceLocator::Window(7), Some(88), 42),
        Ok(AudioTarget {
            process_id: 88,
            include_tree: true,
        }),
    );
    assert!(make_audio_target(SourceLocator::Window(7), Some(42), 42).is_err());
    assert!(make_audio_target(SourceLocator::Window(7), None, 42).is_err());
}

#[test]
fn exclusao_usa_o_pid_do_webview_quando_registrado() {
    register_webview_process_id(9999);
    assert_eq!(get_exclusion_process_id(), 9999);
    register_webview_process_id(0);
    assert_eq!(get_exclusion_process_id(), std::process::id());
}

#[test]
fn janela_recusa_o_pid_do_webview_registrado() {
    register_webview_process_id(777);
    assert!(make_audio_target(SourceLocator::Window(7), Some(777), 42).is_err());
    register_webview_process_id(0);
}

#[test]
fn janela_invalida_retorna_falso() {
    assert!(!is_window_valid(0));
}

#[test]
fn pcm_so_sai_em_blocos_completos_e_preserva_o_restante() {
    let mut samples = VecDeque::from(vec![1, 2, 3, 4, 5, 6]);
    assert_eq!(take_pcm_chunk(&mut samples, 4), Some(vec![1, 2, 3, 4]));
    assert_eq!(take_pcm_chunk(&mut samples, 4), None);
    assert_eq!(samples, VecDeque::from(vec![5, 6]));
}

#[test]
fn validacao_de_exclusao_falha_fechada() {
    assert!(exclusion_is_safe(0.02, 0.0002));
    assert!(!exclusion_is_safe(0.0, 0.0));
    assert!(!exclusion_is_safe(0.02, 0.01));
}

#[test]
fn detector_encontra_o_probe_de_dezoito_khz() {
    let mut pcm = VecDeque::new();
    for index in 0..4_800 {
        let sample = (2.0 * std::f64::consts::PI * 18_000.0 * index as f64 / 48_000.0).sin()
            as f32
            * 0.02;
        pcm.extend(sample.to_le_bytes());
        pcm.extend(sample.to_le_bytes());
    }
    assert!(goertzel_level(&pcm, 48_000.0, 18_000.0, 2) > 0.01);
}

#[test]
fn detector_encontra_o_probe_mesmo_com_silencio_em_volta() {
    let mut pcm = VecDeque::new();
    // 500ms de silencio inicial
    pcm.resize(24_000 * 8, 0);
    // 400ms de tom 18kHz a amplitude 0.02
    for index in 0..19_200 {
        let sample = (2.0 * std::f64::consts::PI * 18_000.0 * index as f64 / 48_000.0).sin()
            as f32
            * 0.02;
        pcm.extend(sample.to_le_bytes());
        pcm.extend(sample.to_le_bytes());
    }
    // 500ms de silencio final
    pcm.resize(pcm.len() + 24_000 * 8, 0);
    assert!(goertzel_level(&pcm, 48_000.0, 18_000.0, 2) > 0.01);
}

/// Regua da linha de base do pipeline legado, para comparar com os proximos
/// passos da auditoria de performance.
///
/// Ignorado por padrao: depende da tela real da maquina e o numero varia com o
/// hardware, entao nao serve como assercao — serve como medicao. Roda com
/// `cargo test --lib -- --ignored --nocapture linha_de_base`.
///
/// Exercita as funcoes do `capture_loop` legado: `capture_image`,
/// `scale_to_fit` + `parallel_resize_rgba` e o `JpegEncoder` na qualidade 72.
/// O cursor e composto pela WGC (custo zero nesta medicao).
#[test]
#[ignore]
fn linha_de_base_do_laco_legado() {
    // Duas passadas: a primeira no tamanho nativo da tela (numa tela 1080p o
    // preset `balanced` nao redimensiona nada) e a segunda reduzindo, que e o
    // unico jeito de a etapa de resize aparecer na conta.
    medir_laco_legado("balanced 1080p", 1920, 1080);
    medir_laco_legado("fluid 720p (com reducao)", 1280, 720);
}

fn medir_laco_legado(rotulo: &str, largura_maxima: u32, altura_maxima: u32) {
    use super::metrics::{FrameSample, FrameTimer, MetricsAccumulator};

    const QUADROS: u32 = 120;

    let monitores = xcap::Monitor::all().expect("nenhum monitor disponivel");
    let primeiro = monitores.first().expect("nenhum monitor disponivel");
    let locator = SourceLocator::Screen(primeiro.id().expect("monitor sem id"));
    let source = resolve_source(locator).expect("monitor sumiu entre listar e resolver");

    let mut acumulador = MetricsAccumulator::default();
    let inicio = Instant::now();
    for _ in 0..QUADROS {
        let mut timer = FrameTimer::start();
        let imagem = match &source {
            CaptureSource::Screen(screen) => screen.capture_image(),
            CaptureSource::Window(window) => window.capture_image(),
        };
        let captura = timer.lap();
        let Ok(imagem) = imagem else {
            acumulador.record_failure();
            continue;
        };

        let cursor = Duration::ZERO;

        let (largura, altura) = imagem.dimensions();
        let (destino_largura, destino_altura) =
            scale_to_fit(largura, altura, largura_maxima, altura_maxima);
        let imagem = if (largura, altura) == (destino_largura, destino_altura) {
            imagem
        } else {
            parallel_resize_rgba(&imagem, destino_largura, destino_altura)
        };
        let redimensionar = timer.lap();

        let mut pacote = Vec::with_capacity(12 + (destino_largura * destino_altura) as usize);
        pacote.extend_from_slice(&destino_largura.to_le_bytes());
        pacote.extend_from_slice(&destino_altura.to_le_bytes());
        pacote.extend_from_slice(&1u32.to_le_bytes());
        if image::codecs::jpeg::JpegEncoder::new_with_quality(&mut pacote, 72)
            .encode_image(&imagem)
            .is_err()
        {
            acumulador.record_failure();
            continue;
        }
        let comprimir = timer.lap();

        acumulador.record(FrameSample {
            capture: captura,
            cursor,
            resize: redimensionar,
            encode: comprimir,
            dispatch: Duration::ZERO,
            idle: Duration::ZERO,
            bytes: pacote.len(),
            width: destino_largura,
            height: destino_altura,
        });
    }

    // Sem pacer: a janela e o tempo que o laco levou para produzir os quadros,
    // entao o `fps` que sai daqui e o **teto** do produtor legado, e nao a taxa
    // que ele entregaria depois de dormir ate o proximo intervalo.
    let stats = acumulador.snapshot(inicio.elapsed(), 60);
    println!("\n== linha de base do laco legado: {rotulo} ==");
    println!("{stats:#?}");
    println!(
        "teto do produtor: {:.1} FPS | orcamento de 60 FPS: 16.67 ms | quadro: {:.2} ms",
        stats.fps, stats.frame_ms,
    );
}
