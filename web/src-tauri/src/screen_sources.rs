use base64::Engine;
use image::{ImageBuffer, ImageEncoder, Rgba};
use serde::Serialize;

const THUMBNAIL_WIDTH: u32 = 320;
const THUMBNAIL_HEIGHT: u32 = 180;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SourceLocator {
    Screen(u32),
    Window(u32),
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenSource {
    id: String,
    name: String,
    kind: &'static str,
    width: u32,
    height: u32,
}

#[tauri::command]
pub fn list_screen_sources() -> Vec<ScreenSource> {
    let mut sources = Vec::new();

    if let Ok(monitors) = xcap::Monitor::all() {
        for (index, monitor) in monitors.into_iter().enumerate() {
            let monitor_name = monitor.name().unwrap_or_default();
            let name = if monitor_name.trim().is_empty() {
                format!("Tela {}", index + 1)
            } else {
                monitor_name
            };
            sources.push(ScreenSource {
                id: format!("screen:{}:0", monitor.id().unwrap_or(0)),
                name,
                kind: "screen",
                width: monitor.width().unwrap_or(0),
                height: monitor.height().unwrap_or(0),
            });
        }
    }

    if let Ok(windows) = xcap::Window::all() {
        for window in windows.into_iter().filter(is_shareable_window) {
            let title = window.title().unwrap_or_default().trim().to_string();
            sources.push(ScreenSource {
                id: format!("window:{}:0", window.id().unwrap_or(0)),
                name: title,
                kind: "window",
                width: window.width().unwrap_or(0),
                height: window.height().unwrap_or(0),
            });
        }
    }

    sources
}

#[tauri::command]
pub fn capture_screen_source_thumbnail(source_id: String) -> Result<Option<String>, String> {
    let image = match parse_source_id(&source_id)? {
        SourceLocator::Screen(id) => xcap::Monitor::all()
            .map_err(|error| error.to_string())?
            .into_iter()
            .find(|monitor| monitor.id().ok() == Some(id))
            .and_then(|monitor| monitor.capture_image().ok()),
        SourceLocator::Window(id) => xcap::Window::all()
            .map_err(|error| error.to_string())?
            .into_iter()
            .find(|window| window.id().ok() == Some(id))
            .and_then(|window| window.capture_image().ok()),
    };

    Ok(image.and_then(encode_thumbnail))
}

pub(crate) fn parse_source_id(source_id: &str) -> Result<SourceLocator, String> {
    let (kind, rest) = source_id
        .split_once(':')
        .ok_or_else(|| "fonte de captura invalida".to_string())?;
    let raw_id = rest
        .strip_suffix(":0")
        .ok_or_else(|| "fonte de captura invalida".to_string())?;
    let id = raw_id
        .parse::<u32>()
        .map_err(|_| "id de captura invalido".to_string())?;

    match kind {
        "screen" => Ok(SourceLocator::Screen(id)),
        "window" => Ok(SourceLocator::Window(id)),
        _ => Err("tipo de fonte de captura desconhecido".to_string()),
    }
}

fn is_shareable_window(window: &xcap::Window) -> bool {
    !window.is_minimized().unwrap_or(false)
        && window.width().unwrap_or(0) >= 80
        && window.height().unwrap_or(0) >= 60
        && !window.title().unwrap_or_default().trim().is_empty()
}

fn encode_thumbnail(source: ImageBuffer<Rgba<u8>, Vec<u8>>) -> Option<String> {
    let (width, height) = source.dimensions();
    let (target_width, target_height) =
        scale_to_fit(width, height, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
    if target_width == 0 || target_height == 0 {
        return None;
    }

    let scaled = if (target_width, target_height) == (width, height) {
        source
    } else {
        image::imageops::resize(
            &source,
            target_width,
            target_height,
            image::imageops::FilterType::Triangle,
        )
    };
    let mut png = Vec::new();
    image::codecs::png::PngEncoder::new_with_quality(
        &mut png,
        image::codecs::png::CompressionType::Fast,
        image::codecs::png::FilterType::Adaptive,
    )
    .write_image(
        scaled.as_raw(),
        scaled.width(),
        scaled.height(),
        image::ExtendedColorType::Rgba8,
    )
    .ok()?;
    Some(base64::engine::general_purpose::STANDARD.encode(png))
}

pub(crate) fn scale_to_fit(width: u32, height: u32, max_width: u32, max_height: u32) -> (u32, u32) {
    if width == 0 || height == 0 {
        return (0, 0);
    }
    let scale = (max_width as f64 / width as f64)
        .min(max_height as f64 / height as f64)
        .min(1.0);
    (
        ((width as f64 * scale).round() as u32).max(1),
        ((height as f64 * scale).round() as u32).max(1),
    )
}

#[cfg(test)]
mod tests;
