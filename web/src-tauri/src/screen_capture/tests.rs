use super::*;
use crate::screen_sources::scale_to_fit;

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
/// `scale_to_fit` + `simple_resize_rgba` e o `JpegEncoder` na qualidade 72.
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
            simple_resize_rgba(&imagem, destino_largura, destino_altura)
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

static TEST_ENV_MUTEX: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[test]
fn wgc_desabilita_com_variavel_de_ambiente_e_recusa_sessao() {
    let _guard = TEST_ENV_MUTEX.lock().unwrap();
    std::env::set_var("STAPP_FORCE_GDI_CAPTURE", "1");
    assert!(!wgc::is_wgc_supported());
    let res = wgc::WgcSession::new(SourceLocator::Screen(0));
    assert!(res.is_err());
    std::env::remove_var("STAPP_FORCE_GDI_CAPTURE");
}

#[test]
fn fallback_gdi_resolve_fonte_valida() {
    let Ok(monitors) = xcap::Monitor::all() else { return };
    let Some(monitor) = monitors.first() else { return };
    let Ok(id) = monitor.id() else { return };

    let locator = SourceLocator::Screen(id);
    let source = resolve_source(locator);
    assert!(source.is_some());
    if let Some(CaptureSource::Screen(screen)) = source {
        assert_eq!(screen.id().ok(), Some(id));
    } else {
        panic!("esperava CaptureSource::Screen");
    }
}

#[test]
fn wgc_ciclo_de_vida_encerra_e_recusa_quadros_apos_fechamento() {
    let _guard = TEST_ENV_MUTEX.lock().unwrap();
    if !wgc::is_wgc_supported() {
        return;
    }
    let Ok(monitors) = xcap::Monitor::all() else { return };
    let Some(monitor) = monitors.first() else { return };
    let Ok(id) = monitor.id() else { return };

    let session = wgc::WgcSession::new(SourceLocator::Screen(id));
    if let Ok(mut session) = session {
        let frame = session.next_frame(Duration::from_millis(1000), 1920, 1080, 60);
        assert!(frame.is_ok());
        session.close();
        let frame_after_close = session.next_frame(Duration::from_millis(50), 1920, 1080, 60);
        assert!(frame_after_close.is_err());
    }
}

#[test]
#[ignore]
fn linha_de_base_do_laco_wgc() {
    if !wgc::is_wgc_supported() {
        println!("WGC nao suportada nesta maquina");
        return;
    }
    medir_laco_wgc("wgc balanced 1080p", 1920, 1080);
}

fn medir_laco_wgc(rotulo: &str, largura_maxima: u32, altura_maxima: u32) {
    use super::metrics::{FrameSample, FrameTimer, MetricsAccumulator};

    const QUADROS: u32 = 60;

    let monitores = xcap::Monitor::all().expect("nenhum monitor disponivel");
    let primeiro = monitores.first().expect("nenhum monitor disponivel");
    let locator = SourceLocator::Screen(primeiro.id().expect("monitor sem id"));
    let mut session = wgc::WgcSession::new(locator).expect("falha criando sessao WGC");

    let mut acumulador = MetricsAccumulator::default();
    let inicio = Instant::now();
    for _ in 0..QUADROS {
        let mut timer = FrameTimer::start();
        let frame = session.next_frame(Duration::from_millis(500), largura_maxima, altura_maxima, 60);
        let captura = timer.lap();
        let Ok(Some(frame)) = frame else {
            acumulador.record_failure();
            continue;
        };

        let cursor = Duration::ZERO;
        let imagem = session.read_to_rgba().expect("falha ao ler rgba");
        let destino_largura = frame.width;
        let destino_altura = frame.height;
        let redimensionar = frame.resize_duration;

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

    let stats = acumulador.snapshot(inicio.elapsed(), 60);
    println!("\n== linha de base do laco WGC: {rotulo} ==");
    println!("{stats:#?}");
    println!(
        "teto do produtor WGC: {:.1} FPS | quadro: {:.2} ms (captura: {:.2} ms)",
        stats.fps, stats.frame_ms, stats.capture_ms
    );
}

#[cfg(windows)]
#[test]
fn calculo_de_destino_alinha_a_multiplos_de_dois_para_nv12() {
    use super::scaler::calculate_aligned_destination;

    // Resolucao de entrada impar e limites impares devem sair sempre pares
    let (w, h) = calculate_aligned_destination(1365, 767, 1920, 1080);
    assert_eq!(w % 2, 0, "largura deve ser par");
    assert_eq!(h % 2, 0, "altura deve ser par");
    assert_eq!((w, h), (1364, 766));

    // Resolucao padrao par mantem valores intactos
    let (w, h) = calculate_aligned_destination(1920, 1080, 1920, 1080);
    assert_eq!((w, h), (1920, 1080));

    // Reducao mantendo proporcao com saida par
    let (w, h) = calculate_aligned_destination(2560, 1440, 1920, 1080);
    assert_eq!((w, h), (1920, 1080));

    let (w, h) = calculate_aligned_destination(3840, 2160, 1280, 720);
    assert_eq!((w, h), (1280, 720));

    // Dimensoes extremas pequenas garantem no minimo 2x2 para NV12
    let (w, h) = calculate_aligned_destination(1, 1, 1920, 1080);
    assert_eq!((w, h), (2, 2));

    let (w, h) = calculate_aligned_destination(0, 0, 1920, 1080);
    assert_eq!((w, h), (2, 2));

    // Formato ultra-wide com reducao
    let (w, h) = calculate_aligned_destination(3440, 1440, 1920, 1080);
    assert_eq!(w % 2, 0);
    assert_eq!(h % 2, 0);
    assert!(w <= 1920);
    assert!(h <= 1080);

    // Orientacao vertical (ex.: monitor retrato)
    let (w, h) = calculate_aligned_destination(1080, 1920, 1280, 720);
    assert_eq!(w % 2, 0);
    assert_eq!(h % 2, 0);
    assert!(w <= 1280);
    assert!(h <= 720);
}

#[cfg(windows)]
#[test]
fn escalonador_lida_com_dimensoes_impares_de_janela() {
    use super::scaler::{D3D11VideoScaler, calculate_aligned_destination};
    use windows::Win32::Foundation::HMODULE;
    use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
    use windows::Win32::Graphics::Direct3D11::{
        D3D11CreateDevice, D3D11_BIND_RENDER_TARGET, D3D11_CREATE_DEVICE_BGRA_SUPPORT,
        D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT,
    };

    let mut d3d_device = None;
    let mut d3d_context = None;
    let hr = unsafe {
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut d3d_device),
            None,
            Some(&mut d3d_context),
        )
    };
    if hr.is_err() {
        return;
    }
    let device = d3d_device.unwrap();
    let context = d3d_context.unwrap();

    // Simula janela com tamanho impar (ex.: 1365 x 767) redimensionada para 1280 x 720
    let (dst_w, dst_h) = calculate_aligned_destination(1365, 767, 1280, 720);
    assert_eq!(dst_w % 2, 0);
    assert_eq!(dst_h % 2, 0);

    let mut scaler = D3D11VideoScaler::new(&device, &context, 1365, 767, dst_w, dst_h, 60)
        .expect("falha ao criar scaler com dimensoes impares de entrada");

    let in_desc = D3D11_TEXTURE2D_DESC {
        Width: 1365,
        Height: 767,
        MipLevels: 1,
        ArraySize: 1,
        Format: windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM,
        SampleDesc: windows::Win32::Graphics::Dxgi::Common::DXGI_SAMPLE_DESC {
            Count: 1,
            Quality: 0,
        },
        Usage: D3D11_USAGE_DEFAULT,
        BindFlags: D3D11_BIND_RENDER_TARGET.0 as u32,
        CPUAccessFlags: 0,
        MiscFlags: 0,
    };
    let mut input_texture = None;
    unsafe {
        device
            .CreateTexture2D(&in_desc, None, Some(&mut input_texture))
            .expect("falha criando textura BGRA impar");
    }
    let input_texture = input_texture.unwrap();

    let res = scaler.scale_nv12(&input_texture, 1365, 767, dst_w, dst_h, 60);
    assert!(res.is_ok(), "scale_nv12 falhou com entrada impar: {:?}", res.err());

    let rgba = scaler.read_to_rgba();
    assert!(rgba.is_ok(), "read_to_rgba falhou: {:?}", rgba.err());
    let img = rgba.unwrap();
    assert_eq!(img.dimensions(), (dst_w, dst_h));
}

#[test]
fn calculo_de_bitrate_adaptativo() {
    use super::compute_default_bitrate;

    let b_1080p60 = compute_default_bitrate(1920, 1080, 60);
    assert!(b_1080p60 >= 3_500_000 && b_1080p60 <= 5_000_000);

    let b_720p30 = compute_default_bitrate(1280, 720, 30);
    assert_eq!(b_720p30, 1_000_000); // Clamped ao minimo de 1 Mbps

    let b_4k60 = compute_default_bitrate(3840, 2160, 60);
    assert_eq!(b_4k60, 12_000_000); // Clamped ao maximo de 12 Mbps
}

#[test]
fn solicitacao_de_keyframe_para_sessao_inexistente_nao_entra_em_panico() {
    use super::request_screen_capture_keyframe;

    let res = request_screen_capture_keyframe(999_999);
    assert!(res.is_ok());
}

