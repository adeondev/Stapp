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
use tauri::ipc::Channel;

static NEXT_CAPTURE_ID: AtomicU32 = AtomicU32::new(1);
static CAPTURES: OnceLock<Mutex<HashMap<u32, CaptureSession>>> = OnceLock::new();

fn captures() -> &'static Mutex<HashMap<u32, CaptureSession>> {
    CAPTURES.get_or_init(|| Mutex::new(HashMap::new()))
}

struct CaptureSession {
    stop: Arc<AtomicBool>,
    thread: thread::JoinHandle<()>,
}

enum CaptureSource {
    Screen(xcap::Monitor),
    Window(xcap::Window),
}

#[derive(Serialize, Clone)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum CaptureEvent {
    Frame {
        capture_id: u32,
        width: u32,
        height: u32,
        jpeg_base64: String,
    },
    Ended {
        capture_id: u32,
        reason: String,
    },
}

#[tauri::command]
pub fn start_screen_capture(
    source_id: String,
    max_width: u32,
    max_height: u32,
    fps: u32,
    channel: Channel<CaptureEvent>,
) -> Result<u32, String> {
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

    let worker = thread::Builder::new()
        .name(format!("stapp-screen-capture-{capture_id}"))
        .spawn(move || {
            capture_loop(
                capture_id,
                locator,
                width,
                height,
                frames_per_second,
                channel,
                worker_stop,
            )
        })
        .map_err(|error| format!("nao foi possivel iniciar a captura: {error}"))?;

    captures()
        .lock()
        .map_err(|_| "estado de captura indisponivel".to_string())?
        .insert(
            capture_id,
            CaptureSession {
                stop,
                thread: worker,
            },
        );
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
    session
        .thread
        .join()
        .map_err(|_| "a captura terminou de forma inesperada".to_string())
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

fn resolve_source(locator: SourceLocator) -> Option<CaptureSource> {
    match locator {
        SourceLocator::Screen(id) => xcap::Monitor::all()
            .ok()?
            .into_iter()
            .find(|monitor| monitor.id() == id)
            .map(CaptureSource::Screen),
        SourceLocator::Window(id) => xcap::Window::all()
            .ok()?
            .into_iter()
            .find(|window| window.id() == id)
            .map(CaptureSource::Window),
    }
}
