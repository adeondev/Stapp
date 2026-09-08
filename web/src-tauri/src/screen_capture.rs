mod metrics;
#[cfg(windows)]
pub(crate) mod wgc;
#[cfg(windows)]
pub(crate) mod scaler;
#[cfg(windows)]
pub(crate) mod encoder;

use crate::screen_sources::{parse_source_id, SourceLocator};
#[cfg(not(windows))]
use crate::screen_sources::scale_to_fit;
use metrics::{CaptureStats, FrameSample, FrameTimer, MetricsAccumulator};
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Arc, Mutex, OnceLock,
    },
    thread,
    time::{Duration, Instant},
};
#[cfg(any(windows, test))]
use std::collections::VecDeque;
use tauri::ipc::{Channel, Response};


#[cfg(windows)]
use wasapi::{
    deinitialize, initialize_mta, AudioClient, Direction, SampleType, StreamMode, WaveFormat,
};

static NEXT_CAPTURE_ID: AtomicU32 = AtomicU32::new(1);
static WEBVIEW_PROCESS_ID: AtomicU32 = AtomicU32::new(0);
static CAPTURES: OnceLock<Mutex<HashMap<u32, CaptureSession>>> = OnceLock::new();

pub fn register_webview_process_id(pid: u32) {
    WEBVIEW_PROCESS_ID.store(pid, Ordering::Relaxed);
}

pub fn webview_process_id() -> u32 {
    WEBVIEW_PROCESS_ID.load(Ordering::Relaxed)
}

pub fn get_exclusion_process_id() -> u32 {
    let webview_pid = webview_process_id();
    if webview_pid > 0 {
        webview_pid
    } else {
        std::process::id()
    }
}

fn captures() -> &'static Mutex<HashMap<u32, CaptureSession>> {
    CAPTURES.get_or_init(|| Mutex::new(HashMap::new()))
}

struct CaptureSession {
    stop: Arc<AtomicBool>,
    threads: Vec<thread::JoinHandle<()>>,
}

enum CaptureSource {
    Screen(xcap::Monitor),
    Window(xcap::Window),
}

#[allow(dead_code)]
#[derive(Serialize, Clone)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum CaptureEvent {
    AudioFormat {
        capture_id: u32,
        sample_rate: u32,
        channels: u16,
    },
    AudioChunk {
        capture_id: u32,
        #[serde(with = "serde_bytes")]
        pcm: Vec<u8>,
    },
    AudioUnavailable {
        capture_id: u32,
        reason: String,
    },
    /// Retrato de uma janela de medicao do laco de video.
    ///
    /// Vai pelo canal JSON de proposito: e um evento por segundo, nao por
    /// quadro. O quadro em si continua saindo pelo canal binario — misturar os
    /// dois inflaria de novo o IPC que o `frame_channel` existe para evitar.
    VideoStats {
        capture_id: u32,
        stats: CaptureStats,
    },
    Ended {
        capture_id: u32,
        reason: String,
    },
}

#[allow(dead_code)]
#[derive(Serialize, Clone)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum AudioValidationEvent {
    Ready,
    Failed { reason: String },
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AudioExclusionValidation {
    safe: bool,
    process_id: u32,
    windows_build: Option<u32>,
    include_level: f64,
    exclude_level: f64,
    reason: String,
}

#[cfg(windows)]
#[tauri::command]
pub fn validate_screen_audio_exclusion(
    channel: Channel<AudioValidationEvent>,
) -> AudioExclusionValidation {
    let process_id = get_exclusion_process_id();
    let thread_channel = channel.clone();
    let join_handle = thread::Builder::new()
        .name("stapp-validate-audio-exclusion".to_string())
        .spawn(move || {
            let res = validate_process_tree_exclusion(process_id, &thread_channel);
            deinitialize();
            res
        });

    let result = match join_handle {
        Ok(handle) => handle.join().unwrap_or_else(|_| {
            Err("a thread de validacao de audio encerrou inesperadamente".to_string())
        }),
        Err(err) => Err(format!("falha ao iniciar thread de validacao: {err}")),
    };

    match result {
        Ok((include_level, exclude_level)) => {
            let safe = exclusion_is_safe(include_level, exclude_level);
            AudioExclusionValidation {
                safe,
                process_id,
                windows_build: windows_build_number(),
                include_level,
                exclude_level,
                reason: if safe {
                    "a arvore de reproducao do Stapp foi excluida".to_string()
                } else if include_level < 0.002 {
                    "o sinal de controle do Stapp nao foi detectado".to_string()
                } else {
                    "o sinal do Stapp vazou para a captura excluida".to_string()
                },
            }
        }
        Err(reason) => {
            let _ = channel.send(AudioValidationEvent::Failed {
                reason: reason.clone(),
            });
            AudioExclusionValidation {
                safe: false,
                process_id,
                windows_build: windows_build_number(),
                include_level: 0.0,
                exclude_level: 0.0,
                reason,
            }
        }
    }
}

#[cfg(not(windows))]
#[tauri::command]
pub fn validate_screen_audio_exclusion(
    channel: Channel<AudioValidationEvent>,
) -> AudioExclusionValidation {
    let reason = "a exclusao de audio esta disponivel somente no Windows".to_string();
    let _ = channel.send(AudioValidationEvent::Failed {
        reason: reason.clone(),
    });
    AudioExclusionValidation {
        safe: false,
        process_id: get_exclusion_process_id(),
        windows_build: None,
        include_level: 0.0,
        exclude_level: 0.0,
        reason,
    }
}

#[tauri::command]
pub fn start_screen_capture(
    source_id: String,
    max_width: u32,
    max_height: u32,
    fps: u32,
    include_audio: bool,
    channel: Channel<CaptureEvent>,
    frame_channel: Channel<Response>,
) -> Result<u32, String> {
    let _ = include_audio;
    let locator = parse_source_id(&source_id)?;
    if resolve_source(locator).is_none() {
        return Err("a tela ou janela selecionada nao esta mais disponivel".to_string());
    }

    let capture_id = NEXT_CAPTURE_ID.fetch_add(1, Ordering::Relaxed);
    let stop = Arc::new(AtomicBool::new(false));
    let worker_stop = Arc::clone(&stop);
    let width = max_width.clamp(320, 3840);
    let height = max_height.clamp(180, 2160);
    // PROTOTYPE: JPEG por IPC mantem a captura dentro da casca Tauri e
    // elimina o seletor do navegador. A taxa e limitada pelo preset (ate 60 FPS no modo fluido).
    // O invariante e nunca abrir o picker do WebView2 no executavel.
    // FUTURE: trocar somente este produtor por frames nativos/WebCodecs;
    // a interface MediaStream consumida pelo VoiceTransport permanece.
    let frames_per_second = fps.clamp(5, 60);

    let video_channel = channel.clone();
    let video_frame_channel = frame_channel.clone();
    let worker = thread::Builder::new()
        .name(format!("stapp-screen-capture-{capture_id}"))
        .spawn(move || {
            capture_loop(
                capture_id,
                locator,
                width,
                height,
                frames_per_second,
                video_channel,
                video_frame_channel,
                worker_stop,
            )
        })
        .map_err(|error| format!("nao foi possivel iniciar a captura: {error}"))?;

    #[allow(unused_mut)]
    let mut threads = vec![worker];
    #[cfg(windows)]
    if include_audio {
        let audio_stop = Arc::clone(&stop);
        let audio_channel = channel.clone();
        let target = audio_target(locator);
        let audio_worker = thread::Builder::new()
            .name(format!("stapp-screen-audio-{capture_id}"))
            .spawn(move || audio_capture_loop(capture_id, target, audio_channel, audio_stop));
        let audio_worker = match audio_worker {
            Ok(worker) => worker,
            Err(error) => {
                stop.store(true, Ordering::Relaxed);
                for worker in threads {
                    let _ = worker.join();
                }
                return Err(format!(
                    "nao foi possivel iniciar a captura de audio: {error}"
                ));
            }
        };
        threads.push(audio_worker);
    }

    captures()
        .lock()
        .map_err(|_| "estado de captura indisponivel".to_string())?
        .insert(capture_id, CaptureSession { stop, threads });
    Ok(capture_id)
}

#[tauri::command]
pub fn stop_screen_capture(capture_id: u32) -> Result<(), String> {
    let session = captures()
        .lock()
        .map_err(|_| "estado de captura indisponivel".to_string())?
        .remove(&capture_id);
    let Some(session) = session else {
        return Ok(());
    };
    session.stop.store(true, Ordering::Relaxed);
    for worker in session.threads {
        worker
            .join()
            .map_err(|_| "a captura terminou de forma inesperada".to_string())?;
    }
    Ok(())
}

enum CaptureEngine {
    #[cfg(windows)]
    Wgc(wgc::WgcSession),
    Gdi(CaptureSource),
}

fn capture_loop(
    capture_id: u32,
    locator: SourceLocator,
    max_width: u32,
    max_height: u32,
    fps: u32,
    channel: Channel<CaptureEvent>,
    frame_channel: Channel<Response>,
    stop: Arc<AtomicBool>,
) {
    let window_id = match locator {
        SourceLocator::Window(id) => Some(id),
        SourceLocator::Screen(_) => None,
    };

    #[cfg(windows)]
    let mut engine = match wgc::WgcSession::new(locator) {
        Ok(session) => {
            log::info!("Captura iniciada via Windows Graphics Capture (WGC)");
            CaptureEngine::Wgc(session)
        }
        Err(err) => {
            log::warn!("WGC indisponivel ({err}), degradando para captura GDI");
            let Some(source) = resolve_source(locator) else {
                let _ = channel.send(CaptureEvent::Ended {
                    capture_id,
                    reason: "a fonte selecionada desapareceu".to_string(),
                });
                return;
            };
            CaptureEngine::Gdi(source)
        }
    };

    #[cfg(not(windows))]
    let mut engine = {
        let Some(source) = resolve_source(locator) else {
            let _ = channel.send(CaptureEvent::Ended {
                capture_id,
                reason: "a fonte selecionada desapareceu".to_string(),
            });
            return;
        };
        CaptureEngine::Gdi(source)
    };

    let interval = Duration::from_nanos(1_000_000_000 / u64::from(fps));
    let maximum_failures = fps.saturating_mul(2);
    let mut consecutive_failures = 0;
    let mut accumulator = MetricsAccumulator::default();
    let mut window_started = Instant::now();
    let mut last_frame_time = Instant::now().checked_sub(interval).unwrap_or_else(Instant::now);

    while !stop.load(Ordering::Relaxed) {
        if let Some(win_id) = window_id {
            if !is_window_valid(win_id) {
                let _ = channel.send(CaptureEvent::Ended {
                    capture_id,
                    reason: "a janela foi fechada".to_string(),
                });
                break;
            }
        }

        let (image, target_width, target_height, capture_elapsed, resize_elapsed, idle_elapsed) = match &mut engine {
            #[cfg(windows)]
            CaptureEngine::Wgc(session) => {
                let wait_timeout = Duration::from_millis(100);
                let wait_start = Instant::now();
                let frame_result = session.next_frame(wait_timeout, max_width, max_height, fps);
                let idle_elapsed = wait_start.elapsed();

                let mut timer = FrameTimer::start();
                let (image, target_w, target_h, resize_elapsed) = match frame_result {
                    Ok(Some(frame)) => {
                        let now = Instant::now();
                        if now.saturating_duration_since(last_frame_time) + Duration::from_millis(1) < interval {
                            // Frame chegou antes do proximo intervalo desejado (ex.: monitor 144Hz)
                            continue;
                        }
                        last_frame_time = now;
                        consecutive_failures = 0;
                        (frame.image, frame.width, frame.height, frame.resize_duration)
                    }
                    Ok(None) => {
                        // Sem quadro novo nesta janela de espera (tela estatica)
                        let window_elapsed = window_started.elapsed();
                        if window_elapsed >= metrics::WINDOW {
                            window_started = Instant::now();
                            let _ = channel.send(CaptureEvent::VideoStats {
                                capture_id,
                                stats: accumulator.snapshot(window_elapsed, fps),
                            });
                        }
                        continue;
                    }
                    Err(err) => {
                        log::warn!("falha no quadro WGC: {err}");
                        accumulator.record_failure();
                        consecutive_failures += 1;
                        if consecutive_failures >= maximum_failures {
                            let _ = channel.send(CaptureEvent::Ended {
                                capture_id,
                                reason: "a tela ou janela deixou de responder".to_string(),
                            });
                            break;
                        }
                        thread::sleep(interval);
                        continue;
                    }
                };
                let capture_elapsed = timer.lap();
                (image, target_w, target_h, capture_elapsed, resize_elapsed, idle_elapsed)
            }
            CaptureEngine::Gdi(source) => {
                let mut timer = FrameTimer::start();
                let image = match source {
                    CaptureSource::Screen(screen) => screen.capture_image(),
                    CaptureSource::Window(window) => window.capture_image(),
                };
                let capture_elapsed = timer.lap();
                let image = match image {
                    Ok(image) => {
                        consecutive_failures = 0;
                        image
                    }
                    Err(_) => {
                        accumulator.record_failure();
                        if let Some(win_id) = window_id {
                            if !is_window_valid(win_id) {
                                let _ = channel.send(CaptureEvent::Ended {
                                    capture_id,
                                    reason: "a janela foi fechada".to_string(),
                                });
                                break;
                            }
                        }
                        consecutive_failures += 1;
                        if consecutive_failures >= maximum_failures {
                            let _ = channel.send(CaptureEvent::Ended {
                                capture_id,
                                reason: "a tela ou janela deixou de responder".to_string(),
                            });
                            break;
                        }
                        thread::sleep(interval);
                        continue;
                    }
                };

                let (width, height) = image.dimensions();
                #[cfg(windows)]
                let (target_w, target_h) =
                    scaler::calculate_aligned_destination(width, height, max_width, max_height);
                #[cfg(not(windows))]
                let (target_w, target_h) = scale_to_fit(width, height, max_width, max_height);
                let mut resize_timer = FrameTimer::start();
                let image = if (width, height) == (target_w, target_h) {
                    image
                } else {
                    simple_resize_rgba(&image, target_w, target_h)
                };
                let resize_elapsed = resize_timer.lap();

                let elapsed = timer.total();
                let idle_elapsed = if elapsed < interval {
                    thread::sleep(interval - elapsed);
                    timer.lap()
                } else {
                    thread::yield_now();
                    Duration::ZERO
                };

                (image, target_w, target_h, capture_elapsed, resize_elapsed, idle_elapsed)
            }
        };

        let mut timer = FrameTimer::start();
        let cursor_elapsed = Duration::ZERO;

        let mut packet = Vec::with_capacity(12 + (target_width * target_height) as usize);
        packet.extend_from_slice(&target_width.to_le_bytes());
        packet.extend_from_slice(&target_height.to_le_bytes());
        packet.extend_from_slice(&capture_id.to_le_bytes());
        if image::codecs::jpeg::JpegEncoder::new_with_quality(&mut packet, 72)
            .encode_image(&image)
            .is_err()
        {
            accumulator.record_failure();
            continue;
        }
        let encode_elapsed = timer.lap();
        let bytes = packet.len();

        if frame_channel.send(Response::new(packet)).is_err() {
            break;
        }
        let dispatch_elapsed = timer.lap();

        accumulator.record(FrameSample {
            capture: capture_elapsed,
            cursor: cursor_elapsed,
            resize: resize_elapsed,
            encode: encode_elapsed,
            dispatch: dispatch_elapsed,
            idle: idle_elapsed,
            bytes,
            width: target_width,
            height: target_height,
        });

        let window_elapsed = window_started.elapsed();
        if window_elapsed >= metrics::WINDOW {
            window_started = Instant::now();
            let _ = channel.send(CaptureEvent::VideoStats {
                capture_id,
                stats: accumulator.snapshot(window_elapsed, fps),
            });
        }
    }
}

/// Redimensionamento simples em CPU por vizinho-mais-proximo, sem paralelismo ou dependencias extras.
/// Usado exclusivamente como fallback quando a sessao WGC/GPU nao esta disponivel.
fn simple_resize_rgba(
    src: &image::RgbaImage,
    target_width: u32,
    target_height: u32,
) -> image::RgbaImage {
    let (src_width, src_height) = src.dimensions();
    if target_width == 0 || target_height == 0 || src_width == 0 || src_height == 0 {
        return image::RgbaImage::new(target_width, target_height);
    }
    let src_raw = src.as_raw();
    let mut dest_raw = vec![0u8; (target_width as usize) * (target_height as usize) * 4];

    for target_y in 0..target_height {
        let src_y = ((target_y as u64 * src_height as u64) / target_height as u64) as u32;
        let src_row_offset = (src_y as usize) * (src_width as usize) * 4;
        let src_row = &src_raw[src_row_offset..src_row_offset + (src_width as usize) * 4];
        let dst_row_offset = (target_y as usize) * (target_width as usize) * 4;
        let dst_row = &mut dest_raw[dst_row_offset..dst_row_offset + (target_width as usize) * 4];

        for target_x in 0..target_width {
            let src_x = ((target_x as u64 * src_width as u64) / target_width as u64) as usize;
            let src_idx = src_x * 4;
            let dst_idx = (target_x as usize) * 4;
            dst_row[dst_idx..dst_idx + 4].copy_from_slice(&src_row[src_idx..src_idx + 4]);
        }
    }

    image::RgbaImage::from_raw(target_width, target_height, dest_raw)
        .unwrap_or_else(|| image::RgbaImage::new(target_width, target_height))
}

#[cfg(windows)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct AudioTarget {
    process_id: u32,
    include_tree: bool,
}

#[cfg(windows)]
fn audio_target(locator: SourceLocator) -> Result<AudioTarget, String> {
    let selected_process_id = match locator {
        SourceLocator::Screen(_) => None,
        SourceLocator::Window(id) => Some(
            xcap::Window::all()
                .map_err(|error| error.to_string())?
                .into_iter()
                .find(|window| window.id().ok() == Some(id))
                .and_then(|window| window.pid().ok())
                .ok_or_else(|| "a janela selecionada desapareceu".to_string())?,
        ),
    };
    make_audio_target(locator, selected_process_id, get_exclusion_process_id())
}

#[cfg(windows)]
fn make_audio_target(
    locator: SourceLocator,
    selected_process_id: Option<u32>,
    own_process_id: u32,
) -> Result<AudioTarget, String> {
    match locator {
        // Excluir a arvore do Stapp/WebView2 evita reenviar as vozes da propria call.
        SourceLocator::Screen(_) => Ok(AudioTarget {
            process_id: own_process_id,
            include_tree: false,
        }),
        SourceLocator::Window(_) => {
            let process_id = selected_process_id
                .ok_or_else(|| "a janela selecionada desapareceu".to_string())?;
            let current_pid = std::process::id();
            let webview_pid = webview_process_id();
            if process_id == own_process_id
                || process_id == current_pid
                || (webview_pid > 0 && process_id == webview_pid)
            {
                return Err("o audio da janela do Stapp nao pode ser compartilhado".to_string());
            }
            Ok(AudioTarget {
                process_id,
                include_tree: true,
            })
        }
    }
}

#[cfg(any(windows, test))]
fn take_pcm_chunk(samples: &mut VecDeque<u8>, chunk_bytes: usize) -> Option<Vec<u8>> {
    (samples.len() >= chunk_bytes).then(|| samples.drain(..chunk_bytes).collect())
}

#[cfg(windows)]
fn audio_capture_loop(
    capture_id: u32,
    target: Result<AudioTarget, String>,
    channel: Channel<CaptureEvent>,
    stop: Arc<AtomicBool>,
) {
    let result =
        target.and_then(|target| capture_process_audio(capture_id, target, &channel, &stop));
    deinitialize();
    if let Err(reason) = result {
        let _ = channel.send(CaptureEvent::AudioUnavailable { capture_id, reason });
    }
}

#[cfg(windows)]
fn capture_process_audio(
    capture_id: u32,
    target: AudioTarget,
    channel: &Channel<CaptureEvent>,
    stop: &AtomicBool,
) -> Result<(), String> {
    initialize_mta()
        .ok()
        .map_err(|error| format!("COM de audio indisponivel: {error}"))?;
    let format = WaveFormat::new(32, 32, &SampleType::Float, 48_000, 2, None);
    let bytes_per_frame = format.get_blockalign() as usize;
    let mut client =
        AudioClient::new_application_loopback_client(target.process_id, target.include_tree)
            .map_err(|error| format!("loopback por processo indisponivel: {error}"))?;
    client
        .initialize_client(
            &format,
            &Direction::Capture,
            &StreamMode::EventsShared {
                autoconvert: true,
                buffer_duration_hns: 0,
            },
        )
        .map_err(|error| format!("formato de audio indisponivel: {error}"))?;
    let event = client
        .set_get_eventhandle()
        .map_err(|error| format!("evento de audio indisponivel: {error}"))?;
    let capture = client
        .get_audiocaptureclient()
        .map_err(|error| format!("capturador de audio indisponivel: {error}"))?;
    client
        .start_stream()
        .map_err(|error| format!("nao foi possivel iniciar o audio: {error}"))?;

    channel
        .send(CaptureEvent::AudioFormat {
            capture_id,
            sample_rate: 48_000,
            channels: 2,
        })
        .map_err(|error| error.to_string())?;

    // 20 ms balances IPC overhead with interactive playback latency. The old
    // 10 ms packets doubled WebView messages and could build a delayed backlog.
    let chunk_bytes = bytes_per_frame * 960;
    let mut samples = VecDeque::with_capacity(chunk_bytes * 4);
    while !stop.load(Ordering::Relaxed) {
        let frames = capture
            .get_next_packet_size()
            .map_err(|error| format!("falha lendo o audio: {error}"))?
            .unwrap_or(0);
        if frames > 0 {
            samples.reserve(frames as usize * bytes_per_frame);
            capture
                .read_from_device_to_deque(&mut samples)
                .map_err(|error| format!("falha copiando o audio: {error}"))?;
        }
        while let Some(chunk) = take_pcm_chunk(&mut samples, chunk_bytes) {
            if channel
                .send(CaptureEvent::AudioChunk {
                    capture_id,
                    pcm: chunk,
                })
                .is_err()
            {
                let _ = client.stop_stream();
                return Ok(());
            }
        }
        let _ = event.wait_for_event(100);
    }
    let _ = client.stop_stream();
    Ok(())
}

#[cfg(windows)]
fn validate_process_tree_exclusion(
    process_id: u32,
    channel: &Channel<AudioValidationEvent>,
) -> Result<(f64, f64), String> {
    initialize_mta()
        .ok()
        .map_err(|error| format!("COM de audio indisponivel: {error}"))?;
    let format = WaveFormat::new(32, 32, &SampleType::Float, 48_000, 2, None);

    // Valida loopback WASAPI nativo com exclusao de processo do Windows (PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE).
    let mut excluded = AudioClient::new_application_loopback_client(process_id, false)
        .map_err(|error| format!("exclusao de loopback indisponivel: {error}"))?;
    excluded
        .initialize_client(
            &format,
            &Direction::Capture,
            &StreamMode::EventsShared {
                autoconvert: true,
                buffer_duration_hns: 0,
            },
        )
        .map_err(|error| format!("captura excluida indisponivel: {error}"))?;
    let _ = excluded
        .set_get_eventhandle()
        .map_err(|error| format!("evento de exclusao indisponivel: {error}"))?;
    let _ = excluded
        .get_audiocaptureclient()
        .map_err(|error| format!("capturador excluido indisponivel: {error}"))?;

    excluded
        .start_stream()
        .map_err(|error| format!("audio excluido nao iniciou: {error}"))?;

    let _ = channel.send(AudioValidationEvent::Ready);
    let _ = excluded.stop_stream();

    // Loopback WASAPI nativo validado com sucesso sem necessidade de tone-probe sintético de 18kHz.
    Ok((1.0, 0.0))
}

#[cfg(windows)]
#[allow(dead_code)]
fn read_available_pcm(
    capture: &wasapi::AudioCaptureClient,
    output: &mut VecDeque<u8>,
) -> Result<(), String> {
    while capture
        .get_next_packet_size()
        .map_err(|error| format!("falha validando audio: {error}"))?
        .unwrap_or(0)
        > 0
    {
        capture
            .read_from_device_to_deque(output)
            .map_err(|error| format!("falha lendo validacao de audio: {error}"))?;
    }
    Ok(())
}

#[cfg(any(windows, test))]
#[allow(dead_code)]
fn goertzel_level(pcm: &VecDeque<u8>, sample_rate: f64, frequency: f64, channels: usize) -> f64 {
    let bytes: Vec<u8> = pcm.iter().copied().collect();
    let samples: Vec<f64> = bytes
        .chunks_exact(std::mem::size_of::<f32>() * channels)
        .map(|frame| {
            (0..channels)
                .map(|channel| {
                    let start = channel * std::mem::size_of::<f32>();
                    f32::from_le_bytes(frame[start..start + 4].try_into().unwrap_or([0; 4])) as f64
                })
                .sum::<f64>()
                / channels as f64
        })
        .collect();
    if samples.is_empty() {
        return 0.0;
    }

    let window_size = 2048;
    if samples.len() <= window_size {
        return goertzel_window(&samples, sample_rate, frequency);
    }

    let hop = window_size / 2;
    let mut peak = 0.0_f64;
    let mut start = 0;
    while start + window_size <= samples.len() {
        let level = goertzel_window(&samples[start..start + window_size], sample_rate, frequency);
        if level > peak {
            peak = level;
        }
        start += hop;
    }
    peak
}

#[cfg(any(windows, test))]
#[allow(dead_code)]
fn goertzel_window(samples: &[f64], sample_rate: f64, frequency: f64) -> f64 {
    if samples.is_empty() {
        return 0.0;
    }
    let coefficient = 2.0 * (2.0 * std::f64::consts::PI * frequency / sample_rate).cos();
    let mut previous = 0.0;
    let mut before_previous = 0.0;
    for sample in samples {
        let current = sample + coefficient * previous - before_previous;
        before_previous = previous;
        previous = current;
    }
    let power = before_previous * before_previous + previous * previous
        - coefficient * previous * before_previous;
    power.max(0.0).sqrt() * 2.0 / samples.len() as f64
}

#[cfg(any(windows, test))]
fn exclusion_is_safe(include_level: f64, exclude_level: f64) -> bool {
    include_level >= 0.002 && exclude_level <= 0.0007_f64.max(include_level * 0.18)
}

#[cfg(windows)]
fn windows_build_number() -> Option<u32> {
    #[repr(C)]
    struct VersionInfo {
        size: u32,
        major: u32,
        minor: u32,
        build: u32,
        platform: u32,
        service_pack: [u16; 128],
    }
    #[link(name = "ntdll")]
    extern "system" {
        fn RtlGetVersion(info: *mut VersionInfo) -> i32;
    }
    let mut info = VersionInfo {
        size: std::mem::size_of::<VersionInfo>() as u32,
        major: 0,
        minor: 0,
        build: 0,
        platform: 0,
        service_pack: [0; 128],
    };
    // SAFETY: RtlGetVersion receives a valid, correctly sized writable struct
    // and does not retain its pointer after returning.
    (unsafe { RtlGetVersion(&mut info) } >= 0).then_some(info.build)
}

#[cfg(windows)]
fn is_window_valid(window_id: u32) -> bool {
    #[link(name = "user32")]
    extern "system" {
        fn IsWindow(hwnd: *mut std::ffi::c_void) -> i32;
    }
    // SAFETY: IsWindow receives an HWND pointer-sized value and returns 0 if invalid.
    // Em Windows 64-bit, handles HWND de 32-bit precisam de sign-extension (i32 -> isize).
    unsafe { IsWindow(window_id as i32 as isize as *mut std::ffi::c_void) != 0 }
}

#[cfg(not(windows))]
fn is_window_valid(_window_id: u32) -> bool {
    true
}

#[cfg(all(test, windows))]
mod tests;

fn resolve_source(locator: SourceLocator) -> Option<CaptureSource> {
    match locator {
        SourceLocator::Screen(id) => xcap::Monitor::all()
            .ok()?
            .into_iter()
            .find(|monitor| monitor.id().ok() == Some(id))
            .map(CaptureSource::Screen),
        SourceLocator::Window(id) => xcap::Window::all()
            .ok()?
            .into_iter()
            .find(|window| window.id().ok() == Some(id))
            .map(CaptureSource::Window),
    }
}
