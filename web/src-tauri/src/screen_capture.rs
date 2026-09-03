use crate::screen_sources::{parse_source_id, scale_to_fit, SourceLocator};
use base64::Engine;
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
use tauri::ipc::Channel;

#[cfg(windows)]
use wasapi::{
    deinitialize, initialize_mta, AudioClient, Direction, SampleType, StreamMode, WaveFormat,
};

static NEXT_CAPTURE_ID: AtomicU32 = AtomicU32::new(1);
static CAPTURES: OnceLock<Mutex<HashMap<u32, CaptureSession>>> = OnceLock::new();

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
    Frame {
        capture_id: u32,
        width: u32,
        height: u32,
        jpeg_base64: String,
    },
    AudioFormat {
        capture_id: u32,
        sample_rate: u32,
        channels: u16,
    },
    AudioChunk {
        capture_id: u32,
        pcm_base64: String,
    },
    AudioUnavailable {
        capture_id: u32,
        reason: String,
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
    let process_id = std::process::id();
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
        process_id: std::process::id(),
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
    // elimina o seletor do navegador, mas fica limitado a 30 FPS. O
    // invariante e nunca abrir o picker do WebView2 no executavel.
    // FUTURE: trocar somente este produtor por frames nativos/WebCodecs;
    // a interface MediaStream consumida pelo VoiceTransport permanece.
    let frames_per_second = fps.clamp(5, 30);

    let video_channel = channel.clone();
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

fn capture_loop(
    capture_id: u32,
    locator: SourceLocator,
    max_width: u32,
    max_height: u32,
    fps: u32,
    channel: Channel<CaptureEvent>,
    stop: Arc<AtomicBool>,
) {
    let Some(source) = resolve_source(locator) else {
        let _ = channel.send(CaptureEvent::Ended {
            capture_id,
            reason: "a fonte selecionada desapareceu".to_string(),
        });
        return;
    };
    let interval = Duration::from_nanos(1_000_000_000 / u64::from(fps));
    let maximum_failures = fps.saturating_mul(2);
    let mut consecutive_failures = 0;

    while !stop.load(Ordering::Relaxed) {
        let started = Instant::now();
        let image = match &source {
            CaptureSource::Screen(screen) => screen.capture_image(),
            CaptureSource::Window(window) => window.capture_image(),
        };
        let image = match image {
            Ok(image) => {
                consecutive_failures = 0;
                image
            }
            Err(_) => {
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
        let (target_width, target_height) = scale_to_fit(width, height, max_width, max_height);
        let image = if (width, height) == (target_width, target_height) {
            image
        } else {
            image::imageops::resize(
                &image,
                target_width,
                target_height,
                image::imageops::FilterType::Triangle,
            )
        };
        let rgb = image::DynamicImage::ImageRgba8(image).into_rgb8();
        let mut jpeg = Vec::with_capacity((target_width * target_height) as usize);
        if image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 72)
            .encode(
                rgb.as_raw(),
                target_width,
                target_height,
                image::ExtendedColorType::Rgb8,
            )
            .is_err()
        {
            continue;
        }

        if channel
            .send(CaptureEvent::Frame {
                capture_id,
                width: target_width,
                height: target_height,
                jpeg_base64: base64::engine::general_purpose::STANDARD.encode(jpeg),
            })
            .is_err()
        {
            break;
        }

        let elapsed = started.elapsed();
        if elapsed < interval {
            thread::sleep(interval - elapsed);
        } else {
            thread::yield_now();
        }
    }
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
    make_audio_target(locator, selected_process_id, std::process::id())
}

#[cfg(windows)]
fn make_audio_target(
    locator: SourceLocator,
    selected_process_id: Option<u32>,
    own_process_id: u32,
) -> Result<AudioTarget, String> {
    match locator {
        // Excluir a arvore do Stapp evita reenviar as vozes da propria call.
        SourceLocator::Screen(_) => Ok(AudioTarget {
            process_id: own_process_id,
            include_tree: false,
        }),
        SourceLocator::Window(_) => {
            let process_id = selected_process_id
                .ok_or_else(|| "a janela selecionada desapareceu".to_string())?;
            if process_id == own_process_id {
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
                    pcm_base64: base64::engine::general_purpose::STANDARD.encode(chunk),
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

    let mut included = AudioClient::new_application_loopback_client(process_id, true)
        .map_err(|error| format!("controle de loopback indisponivel: {error}"))?;
    included
        .initialize_client(
            &format,
            &Direction::Capture,
            &StreamMode::EventsShared {
                autoconvert: true,
                buffer_duration_hns: 0,
            },
        )
        .map_err(|error| format!("controle de audio indisponivel: {error}"))?;
    let included_event = included
        .set_get_eventhandle()
        .map_err(|error| format!("evento de controle indisponivel: {error}"))?;
    let included_capture = included
        .get_audiocaptureclient()
        .map_err(|error| format!("captura de controle indisponivel: {error}"))?;

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
    let excluded_event = excluded
        .set_get_eventhandle()
        .map_err(|error| format!("evento de exclusao indisponivel: {error}"))?;
    let excluded_capture = excluded
        .get_audiocaptureclient()
        .map_err(|error| format!("capturador excluido indisponivel: {error}"))?;

    included
        .start_stream()
        .map_err(|error| format!("controle de audio nao iniciou: {error}"))?;
    if let Err(error) = excluded.start_stream() {
        let _ = included.stop_stream();
        return Err(format!("audio excluido nao iniciou: {error}"));
    }
    if channel.send(AudioValidationEvent::Ready).is_err() {
        let _ = included.stop_stream();
        let _ = excluded.stop_stream();
        return Err("a interface fechou durante a validacao de audio".to_string());
    }

    let mut included_pcm = VecDeque::new();
    let mut excluded_pcm = VecDeque::new();
    let deadline = Instant::now() + Duration::from_millis(1_200);
    while Instant::now() < deadline {
        read_available_pcm(&included_capture, &mut included_pcm)?;
        read_available_pcm(&excluded_capture, &mut excluded_pcm)?;
        let _ = included_event.wait_for_event(10);
        let _ = excluded_event.wait_for_event(0);
    }
    let _ = included.stop_stream();
    let _ = excluded.stop_stream();

    Ok((
        goertzel_level(&included_pcm, 48_000.0, 18_000.0, 2),
        goertzel_level(&excluded_pcm, 48_000.0, 18_000.0, 2),
    ))
}

#[cfg(windows)]
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
    let coefficient = 2.0 * (2.0 * std::f64::consts::PI * frequency / sample_rate).cos();
    let mut previous = 0.0;
    let mut before_previous = 0.0;
    for sample in &samples {
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
