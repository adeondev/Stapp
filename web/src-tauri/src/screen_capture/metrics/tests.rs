use super::*;

fn ms(value: u64) -> Duration {
    Duration::from_millis(value)
}

fn sample(capture: u64, encode: u64) -> FrameSample {
    FrameSample {
        capture: ms(capture),
        cursor: ms(1),
        resize: ms(2),
        encode: ms(encode),
        dispatch: ms(1),
        idle: ms(0),
        bytes: 100_000,
        width: 1920,
        height: 1080,
    }
}

#[test]
fn janela_vazia_nao_divide_por_zero() {
    let mut acumulador = MetricsAccumulator::default();
    let stats = acumulador.snapshot(WINDOW, 60);
    assert_eq!(stats, CaptureStats { target_fps: 60, ..CaptureStats::default() });
}

#[test]
fn milissegundos_sao_media_por_quadro_e_fps_e_por_segundo() {
    let mut acumulador = MetricsAccumulator::default();
    acumulador.record(sample(10, 20));
    acumulador.record(sample(20, 40));

    let stats = acumulador.snapshot(ms(1000), 60);
    assert_eq!(stats.frames, 2);
    assert_eq!(stats.fps, 2.0);
    assert_eq!(stats.capture_ms, 15.0);
    assert_eq!(stats.encode_ms, 30.0);
    assert_eq!(stats.cursor_ms, 1.0);
    // 200 KB em dois quadros dentro de uma janela de 1 s.
    assert_eq!(stats.bytes_per_second, 200_000.0);
}

#[test]
fn janela_mais_curta_que_um_segundo_ainda_extrapola_para_fps() {
    let mut acumulador = MetricsAccumulator::default();
    acumulador.record(sample(10, 20));
    // Meia janela com um quadro so equivale a 2 FPS, nao a 1.
    assert_eq!(acumulador.snapshot(ms(500), 60).fps, 2.0);
}

#[test]
fn total_do_quadro_e_a_soma_das_etapas() {
    let mut acumulador = MetricsAccumulator::default();
    acumulador.record(sample(10, 20));

    let stats = acumulador.snapshot(WINDOW, 30);
    assert_eq!(
        stats.frame_ms,
        stats.capture_ms + stats.cursor_ms + stats.resize_ms + stats.encode_ms + stats.dispatch_ms,
    );
    assert_eq!(stats.frame_ms, 34.0);
    // O ocioso fica fora da soma: ele e o que sobrou do orcamento, nao custo.
    assert_eq!(stats.idle_ms, 0.0);
}

#[test]
fn resolucao_e_a_do_ultimo_quadro_e_nao_uma_media() {
    let mut acumulador = MetricsAccumulator::default();
    acumulador.record(FrameSample { width: 1280, height: 720, ..sample(10, 10) });
    acumulador.record(FrameSample { width: 1920, height: 1080, ..sample(10, 10) });

    let stats = acumulador.snapshot(WINDOW, 30);
    assert_eq!((stats.width, stats.height), (1920, 1080));
}

#[test]
fn falhas_sao_contadas_sem_entrar_na_media_dos_quadros() {
    let mut acumulador = MetricsAccumulator::default();
    acumulador.record(sample(10, 20));
    acumulador.record_failure();
    acumulador.record_failure();

    let stats = acumulador.snapshot(WINDOW, 60);
    assert_eq!(stats.failures, 2);
    assert_eq!(stats.frames, 1);
    assert_eq!(stats.capture_ms, 10.0);
}

#[test]
fn a_janela_zera_depois_do_retrato() {
    let mut acumulador = MetricsAccumulator::default();
    acumulador.record(sample(10, 20));
    acumulador.record_failure();
    acumulador.snapshot(WINDOW, 60);

    let stats = acumulador.snapshot(WINDOW, 60);
    assert_eq!(stats.frames, 0);
    assert_eq!(stats.failures, 0);
    assert_eq!(stats.capture_ms, 0.0);
    assert_eq!(stats.bytes_per_second, 0.0);
}

#[test]
fn cada_volta_mede_so_a_propria_fatia() {
    let mut timer = FrameTimer::start();
    thread::sleep(ms(12));
    let primeira = timer.lap();
    thread::sleep(ms(12));
    let segunda = timer.lap();

    // Se `lap` medisse desde o inicio do quadro, a segunda incluiria a primeira
    // e a soma passaria do relogio. E exatamente isso que nao pode acontecer.
    assert!(primeira >= ms(10), "primeira volta curta demais: {primeira:?}");
    assert!(segunda >= ms(10), "segunda volta curta demais: {segunda:?}");
    assert!(
        primeira + segunda <= timer.total(),
        "as voltas somaram mais que o quadro: {primeira:?} + {segunda:?}",
    );
}
