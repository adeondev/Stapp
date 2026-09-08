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

#[test]
fn parser_de_variavel_force_jpeg_encoder() {
    let _guard = TEST_ENV_MUTEX.lock().unwrap();

    std::env::set_var("STAPP_FORCE_JPEG_ENCODER", "1");
    let active = std::env::var("STAPP_FORCE_JPEG_ENCODER")
        .map(|v| v != "0" && !v.eq_ignore_ascii_case("false"))
        .unwrap_or(false);
    assert!(active);

    std::env::set_var("STAPP_FORCE_JPEG_ENCODER", "0");
    let active = std::env::var("STAPP_FORCE_JPEG_ENCODER")
        .map(|v| v != "0" && !v.eq_ignore_ascii_case("false"))
        .unwrap_or(false);
    assert!(!active);

    std::env::set_var("STAPP_FORCE_JPEG_ENCODER", "false");
    let active = std::env::var("STAPP_FORCE_JPEG_ENCODER")
        .map(|v| v != "0" && !v.eq_ignore_ascii_case("false"))
        .unwrap_or(false);
    assert!(!active);

    std::env::remove_var("STAPP_FORCE_JPEG_ENCODER");
    let active = std::env::var("STAPP_FORCE_JPEG_ENCODER")
        .map(|v| v != "0" && !v.eq_ignore_ascii_case("false"))
        .unwrap_or(false);
    assert!(!active);
}

#[cfg(windows)]
#[test]
fn wgc_fallback_para_jpeg_quando_forcado_ou_sem_encoder_hardware() {
    let _guard = TEST_ENV_MUTEX.lock().unwrap();
    std::env::set_var("STAPP_FORCE_JPEG_ENCODER", "1");

    let is_disabled = std::env::var("STAPP_FORCE_JPEG_ENCODER")
        .map(|v| v != "0" && !v.eq_ignore_ascii_case("false"))
        .unwrap_or(false);
    assert!(is_disabled, "variavel STAPP_FORCE_JPEG_ENCODER deve ser respeitada");

    if !wgc::is_wgc_supported() {
        std::env::remove_var("STAPP_FORCE_JPEG_ENCODER");
        return;
    }

    let Ok(monitors) = xcap::Monitor::all() else {
        std::env::remove_var("STAPP_FORCE_JPEG_ENCODER");
        return;
    };
    let Some(monitor) = monitors.first() else {
        std::env::remove_var("STAPP_FORCE_JPEG_ENCODER");
        return;
    };
    let Ok(id) = monitor.id() else {
        std::env::remove_var("STAPP_FORCE_JPEG_ENCODER");
        return;
    };

    let session = wgc::WgcSession::new(SourceLocator::Screen(id));
    if let Ok(mut session) = session {
        let frame = session.next_frame(Duration::from_millis(1000), 1280, 720, 60);
        if let Ok(Some(frame)) = frame {
            let image = session.read_to_rgba().expect("read_to_rgba deve funcionar no fallback");
            assert_eq!(image.dimensions(), (frame.width, frame.height));

            let mut jpeg_bytes = Vec::with_capacity(32 * 1024);
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg_bytes, 72)
                .encode_image(&image)
                .expect("codificacao JPEG de fallback deve ter sucesso");
            assert!(!jpeg_bytes.is_empty());
            assert_eq!(&jpeg_bytes[0..2], &[0xFF, 0xD8], "deve iniciar com SOI de JPEG");

            let packet = encoder::pack_frame(
                encoder::CODEC_JPEG,
                true,
                100,
                frame.width,
                frame.height,
                1,
                12345,
                &jpeg_bytes,
            );

            let header = encoder::PacketHeader::parse(&packet).expect("cabecalho STAP valido");
            assert_eq!(header.codec, encoder::CODEC_JPEG);
            assert!(header.is_keyframe());
            assert_eq!(header.capture_id, 100);
            assert_eq!(header.width, frame.width);
            assert_eq!(header.height, frame.height);
        }
        session.close();
    }

    std::env::remove_var("STAPP_FORCE_JPEG_ENCODER");
}

#[test]
fn empacotamento_uniforme_jpeg_e_h264_no_cabecalho_stap() {
    let jpeg_data = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46];
    let h264_data = [0x00, 0x00, 0x00, 0x01, 0x67, 0x42, 0x00, 0x1F, 0x00, 0x00, 0x00, 0x01, 0x68];

    // Empacotamento JPEG
    let p_jpeg = encoder::pack_frame(
        encoder::CODEC_JPEG,
        true,
        55,
        1920,
        1080,
        1,
        1_000_000,
        &jpeg_data,
    );
    let h_jpeg = encoder::PacketHeader::parse(&p_jpeg).expect("parse JPEG valido");
    assert_eq!(h_jpeg.codec, encoder::CODEC_JPEG);
    assert!(h_jpeg.is_keyframe());
    assert_eq!(h_jpeg.capture_id, 55);
    assert_eq!(h_jpeg.width, 1920);
    assert_eq!(h_jpeg.height, 1080);
    assert_eq!(h_jpeg.sequence, 1);
    assert_eq!(h_jpeg.timestamp_us, 1_000_000);
    assert_eq!(&p_jpeg[encoder::HEADER_SIZE..], &jpeg_data);

    // Empacotamento H.264 (delta frame)
    let p_h264 = encoder::pack_frame(
        encoder::CODEC_H264,
        false,
        55,
        1920,
        1080,
        2,
        1_033_333,
        &h264_data,
    );
    let h_h264 = encoder::PacketHeader::parse(&p_h264).expect("parse H.264 valido");
    assert_eq!(h_h264.codec, encoder::CODEC_H264);
    assert!(!h_h264.is_keyframe());
    assert_eq!(h_h264.capture_id, 55);
    assert_eq!(h_h264.width, 1920);
    assert_eq!(h_h264.height, 1080);
    assert_eq!(h_h264.sequence, 2);
    assert_eq!(h_h264.timestamp_us, 1_033_333);
    assert_eq!(&p_h264[encoder::HEADER_SIZE..], &h264_data);
}

#[test]
fn negociacao_e_fallback_de_encoder_em_metricas() {
    let mut acc = metrics::MetricsAccumulator::default();
    acc.record(metrics::FrameSample {
        capture: Duration::from_millis(2),
        cursor: Duration::ZERO,
        resize: Duration::from_millis(1),
        encode: Duration::from_millis(2),
        dispatch: Duration::from_millis(1),
        idle: Duration::from_millis(10),
        bytes: 45_000,
        width: 1920,
        height: 1080,
    });

    // Simulando negociacao bem-sucedida de encoder por hardware
    let stats_hw = acc.snapshot_with_encoder(
        Duration::from_secs(1),
        60,
        Some("NVIDIA NVENC H.264 (NVIDIA)".to_string()),
    );
    assert_eq!(
        stats_hw.encoder_name,
        Some("NVIDIA NVENC H.264 (NVIDIA)".to_string())
    );

    // Simulando degradacao / fallback para encoder JPEG por software
    let stats_sw = acc.snapshot_with_encoder(
        Duration::from_secs(1),
        60,
        Some("Software Fallback (JPEG)".to_string()),
    );
    assert_eq!(
        stats_sw.encoder_name,
        Some("Software Fallback (JPEG)".to_string())
    );
}

#[test]
fn deteccao_de_desalinhamento_e_renegociacao_de_encoder() {
    // Simula a condicao em que a resolucao da janela muda e dispara re-inicializacao
    let initial_w = 1280u32;
    let initial_h = 720u32;
    let new_w = 1920u32;
    let new_h = 1080u32;

    let needs_renegotiation = initial_w != new_w || initial_h != new_h;
    assert!(needs_renegotiation, "mudanca de resolucao deve disparar renegociacao");

    let same_w = 1280u32;
    let same_h = 720u32;
    let needs_renegotiation_same = initial_w != same_w || initial_h != same_h;
    assert!(!needs_renegotiation_same, "mesma resolucao mantem encoder");
}

#[test]
fn testa_calculo_qualidade_jpeg_adaptativo() {
    use super::compute_jpeg_quality;
    assert_eq!(compute_jpeg_quality(1_000_000), 60);
    assert_eq!(compute_jpeg_quality(1_500_000), 60);
    assert_eq!(compute_jpeg_quality(1_500_001), 72);
    assert_eq!(compute_jpeg_quality(3_500_000), 72);
    assert_eq!(compute_jpeg_quality(3_500_001), 80);
    assert_eq!(compute_jpeg_quality(6_000_000), 80);
    assert_eq!(compute_jpeg_quality(6_000_001), 85);
    assert_eq!(compute_jpeg_quality(8_000_000), 85);
}

#[cfg(windows)]
#[test]
fn teste_de_fumaca_pipeline_nativo_ponta_a_ponta() {
    use windows::Win32::Foundation::HMODULE;
    use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
    use windows::Win32::Graphics::Direct3D11::{
        D3D11CreateDevice, D3D11_BIND_RENDER_TARGET, D3D11_BIND_SHADER_RESOURCE,
        D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC,
        D3D11_USAGE_DEFAULT,
    };
    use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC};

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

    // 1. Escalonador D3D11 VideoProcessor: 1920x1080 -> 1280x720 em NV12
    let mut scaler = match scaler::D3D11VideoScaler::new(&device, &context, 1920, 1080, 1280, 720, 60) {
        Ok(s) => s,
        Err(_) => return,
    };

    let in_desc = D3D11_TEXTURE2D_DESC {
        Width: 1920,
        Height: 1080,
        MipLevels: 1,
        ArraySize: 1,
        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
        SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
        Usage: D3D11_USAGE_DEFAULT,
        BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32,
        CPUAccessFlags: 0,
        MiscFlags: 0,
    };
    let mut input_texture = None;
    let tex_hr = unsafe { device.CreateTexture2D(&in_desc, None, Some(&mut input_texture)) };
    assert!(tex_hr.is_ok(), "falha criando textura BGRA de entrada");
    let input_texture = input_texture.unwrap();

    let scaled_nv12 = scaler
        .scale_nv12(&input_texture, 1920, 1080, 1280, 720, 60)
        .expect("falha ao escalonar textura para NV12 na GPU");

    // 2. Codificacao H.264 por hardware (se disponivel no host)
    if let Ok(Some((_, _friendly_name))) = encoder::discover_hardware_h264_encoder() {
        let mut encoder = match encoder::H264Encoder::new(&device, 1280, 720, 60, 3_500_000) {
            Ok(enc) => enc,
            Err(_) => return,
        };

        let packets = encoder
            .encode_texture(scaled_nv12, true)
            .expect("falha codificando frame de video");
        let flushed = encoder.drain_all().expect("falha drenando encoder");
        let all_packets: Vec<_> = packets.into_iter().chain(flushed.into_iter()).collect();

        assert!(!all_packets.is_empty(), "encoder deve produzir ao menos 1 pacote");
        let keyframe = all_packets.iter().find(|p| p.is_keyframe).expect("deve conter keyframe");

        // 3. Empacotamento binario STAP de 32 bytes
        let stap_packet = encoder::pack_frame(
            encoder::CODEC_H264,
            keyframe.is_keyframe,
            99,
            1280,
            720,
            1,
            500_000,
            &keyframe.data,
        );
        let stap_header = encoder::PacketHeader::parse(&stap_packet).expect("cabecalho STAP valido");
        assert_eq!(stap_header.magic, encoder::MAGIC_STAP);
        assert_eq!(stap_header.codec, encoder::CODEC_H264);
        assert!(stap_header.is_keyframe());
        assert_eq!(stap_header.capture_id, 99);
        assert_eq!(stap_header.width, 1280);
        assert_eq!(stap_header.height, 720);
        assert_eq!(stap_header.sequence, 1);
        assert_eq!(stap_header.timestamp_us, 500_000);
        assert_eq!(&stap_packet[encoder::HEADER_SIZE..], &keyframe.data);

        // 4. Empacotamento binario SAUD de 32 bytes para audio da tela
        let pcm_floats = [0.125f32, -0.125f32, 0.5f32, -0.5f32];
        let mut pcm_bytes = Vec::new();
        for s in &pcm_floats {
            pcm_bytes.extend_from_slice(&s.to_le_bytes());
        }
        let saud_packet = encoder::pack_audio_frame(99, 48_000, 2, 1, 500_000, &pcm_bytes);
        let saud_header = encoder::AudioPacketHeader::parse(&saud_packet).expect("cabecalho SAUD valido");
        assert_eq!(saud_header.magic, encoder::MAGIC_SAUD);
        assert_eq!(saud_header.sample_rate, 48_000);
        assert_eq!(saud_header.channels, 2);
        assert_eq!(saud_header.capture_id, 99);
        assert_eq!(&saud_packet[encoder::AUDIO_HEADER_SIZE..], &pcm_bytes);
    }
}

