//! Medicao por etapa do laco de captura de tela.
//!
//! PROTOTYPE: hoje um quadro atravessa captura GDI -> sobreposicao do cursor ->
//! redimensionamento em CPU -> JPEG -> IPC, e nenhuma dessas etapas dizia
//! quanto custava. Sem numero por etapa, "a transmissao esta lenta" nao aponta
//! para lugar nenhum e cada troca de subsistema vira aposta. O invariante e que
//! medir nao pode custar caro: um `Instant` por etapa e somas em `Duration`,
//! sem alocacao e sem I/O dentro do laco — o envio acontece uma vez por janela.
//! FUTURE: quando a captura virar WGC + encoder por hardware, as etapas mudam
//! de nome, mas a forma (acumular no laco, publicar por janela) permanece.

use serde::Serialize;
#[cfg(test)]
use std::thread;
use std::time::{Duration, Instant};

/// Janela de agregacao: curta o bastante para acompanhar a transmissao ao vivo
/// e longa o bastante para a media nao tremer a cada quadro fora da curva.
pub const WINDOW: Duration = Duration::from_secs(1);

/// Cronometro de etapas de um unico quadro.
///
/// `lap` e um *volta*, nao um *decorrido desde o inicio*: se cada etapa medisse
/// a partir do comeco do quadro, a soma das etapas contaria o mesmo tempo
/// varias vezes e o total nao fecharia com o relogio.
pub struct FrameTimer {
    start: Instant,
    last: Instant,
}

impl FrameTimer {
    pub fn start() -> Self {
        let now = Instant::now();
        Self {
            start: now,
            last: now,
        }
    }

    /// Fecha a etapa corrente, devolve a duracao dela e rearma para a proxima.
    pub fn lap(&mut self) -> Duration {
        let now = Instant::now();
        let elapsed = now.saturating_duration_since(self.last);
        self.last = now;
        elapsed
    }

    /// Tempo decorrido desde o inicio do quadro. E ele que alimenta o pacer.
    pub fn total(&self) -> Duration {
        self.start.elapsed()
    }
}

/// Uma passada completa do laco, com cada etapa ja cronometrada.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct FrameSample {
    pub capture: Duration,
    pub cursor: Duration,
    pub resize: Duration,
    pub encode: Duration,
    pub dispatch: Duration,
    /// O que sobrou do orcamento do quadro e virou espera. Zero aqui significa
    /// laco saturado: o produtor ja nao alcanca a taxa pedida.
    pub idle: Duration,
    pub bytes: usize,
    pub width: u32,
    pub height: u32,
}

/// Retrato de uma janela, do jeito que atravessa o IPC e chega no diagnostico.
///
/// Tudo em milissegundos *por quadro* (media da janela), menos `fps`,
/// `bytes_per_second` e os contadores — que sao da janela inteira.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct CaptureStats {
    pub fps: f64,
    pub target_fps: u32,
    pub frames: u32,
    pub failures: u32,
    pub capture_ms: f64,
    pub cursor_ms: f64,
    pub resize_ms: f64,
    pub encode_ms: f64,
    pub dispatch_ms: f64,
    /// Soma das etapas acima: o custo real de produzir um quadro.
    pub frame_ms: f64,
    pub idle_ms: f64,
    pub bytes_per_second: f64,
    pub width: u32,
    pub height: u32,
    pub encoder_name: Option<String>,
}

/// Acumulador puro: so aritmetica, sem relogio proprio.
///
/// Quem e dono do relogio da janela e o laco de captura. Deixar o `Instant`
/// aqui dentro tornaria o teste dependente de tempo real para nada — a conta
/// que precisa de cobertura e a media, nao o `Instant::now()`.
#[derive(Debug, Default)]
pub struct MetricsAccumulator {
    frames: u32,
    failures: u32,
    bytes: u64,
    capture: Duration,
    cursor: Duration,
    resize: Duration,
    encode: Duration,
    dispatch: Duration,
    idle: Duration,
    width: u32,
    height: u32,
}

impl MetricsAccumulator {
    pub fn record(&mut self, sample: FrameSample) {
        self.frames = self.frames.saturating_add(1);
        self.bytes = self.bytes.saturating_add(sample.bytes as u64);
        self.capture += sample.capture;
        self.cursor += sample.cursor;
        self.resize += sample.resize;
        self.encode += sample.encode;
        self.dispatch += sample.dispatch;
        self.idle += sample.idle;
        // A resolucao e a do ultimo quadro, nao uma media: ela muda em degrau
        // (a fonte mudou de tamanho), e a media entre dois degraus nao existe
        // como resolucao de verdade.
        self.width = sample.width;
        self.height = sample.height;
    }

    pub fn record_failure(&mut self) {
        self.failures = self.failures.saturating_add(1);
    }

    /// Fecha a janela: devolve o retrato e zera o acumulador.
    pub fn snapshot(&mut self, window: Duration, target_fps: u32) -> CaptureStats {
        self.snapshot_with_encoder(window, target_fps, None)
    }

    /// Fecha a janela incluindo a identificacao do codificador de video ativo.
    pub fn snapshot_with_encoder(
        &mut self,
        window: Duration,
        target_fps: u32,
        encoder_name: Option<String>,
    ) -> CaptureStats {
        let seconds = window.as_secs_f64();
        let per_frame = |total: Duration| {
            if self.frames == 0 {
                0.0
            } else {
                round2(total.as_secs_f64() * 1000.0 / f64::from(self.frames))
            }
        };
        let per_second = |value: f64| if seconds > 0.0 { round2(value / seconds) } else { 0.0 };

        let stats = CaptureStats {
            fps: per_second(f64::from(self.frames)),
            target_fps,
            frames: self.frames,
            failures: self.failures,
            capture_ms: per_frame(self.capture),
            cursor_ms: per_frame(self.cursor),
            resize_ms: per_frame(self.resize),
            encode_ms: per_frame(self.encode),
            dispatch_ms: per_frame(self.dispatch),
            frame_ms: per_frame(
                self.capture + self.cursor + self.resize + self.encode + self.dispatch,
            ),
            idle_ms: per_frame(self.idle),
            bytes_per_second: per_second(self.bytes as f64),
            width: self.width,
            height: self.height,
            encoder_name,
        };
        *self = Self::default();
        stats
    }
}

fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

#[cfg(test)]
mod tests;
