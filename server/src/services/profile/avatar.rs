//! As imagens do perfil: o que chega, o que fica gravado.
//!
//! Serve avatar **e** banner. As duas passam pelo mesmo processo e mudam so na
//! forma do corte, que e o `Shape`.
//!
//! Tres coisas nao sao negociaveis aqui:
//!
//! - **a extensao nao vale nada.** Quem decide se e imagem e o decodificador,
//!   olhando os bytes. Um `.png` que na verdade e outra coisa nao passa.
//! - **grava sempre no mesmo formato e tamanho.** Entra PNG, JPEG ou WebP de
//!   qualquer dimensao; sai um WebP no tamanho fixo daquela forma. Sem isso o
//!   disco enche e o cliente teria que negociar formato.
//! - **o nome do arquivo e o user_id.** Uma conta tem no maximo um avatar e um
//!   banner, e subir de novo sobrescreve — nao existe lixo acumulando.

use std::io::Cursor;
use std::path::{Path, PathBuf};

use image::codecs::webp::WebPEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, ImageEncoder};

/// Avatar maior que isto nao ajuda ninguem e so ocupa disco.
const LADO: u32 = 256;
/// O banner do cartao de perfil. 8:3 e a proporcao que o cartao desenha; cortar
/// aqui, e nao no CSS, evita mandar pixel que ninguem vai ver.
const BANNER_LARGURA: u32 = 960;
const BANNER_ALTURA: u32 = 360;
const EXTENSAO: &str = "webp";

/// A forma final da imagem. E so isto que separa avatar de banner.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Shape {
    /// Quadrado de 256x256, para o avatar.
    Square,
    /// 960x360 (8:3), para o banner do perfil.
    Banner,
}

impl Shape {
    fn dimensoes(self) -> (u32, u32) {
        match self {
            Shape::Square => (LADO, LADO),
            Shape::Banner => (BANNER_LARGURA, BANNER_ALTURA),
        }
    }
}

#[derive(Debug)]
pub enum AvatarError {
    /// Os bytes nao sao uma imagem que sabemos ler.
    NaoEImagem,
    Io(std::io::Error),
}

impl std::fmt::Display for AvatarError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AvatarError::NaoEImagem => write!(f, "isso nao e uma imagem que eu saiba ler"),
            AvatarError::Io(erro) => write!(f, "nao consegui gravar a imagem: {erro}"),
        }
    }
}

const EXTENSAO_GIF: &str = "gif";

pub fn caminho(dir: &Path, user_id: &str) -> PathBuf {
    dir.join(format!("{user_id}.{EXTENSAO}"))
}

pub fn caminho_gif(dir: &Path, user_id: &str) -> PathBuf {
    dir.join(format!("{user_id}.{EXTENSAO_GIF}"))
}

/// A extensao que vai para o banco. Uma so, mas nomeada, para o dia em que
/// existir mais de um formato.
pub fn extensao() -> &'static str {
    EXTENSAO
}

pub fn is_gif(bytes: &[u8]) -> bool {
    image::guess_format(bytes).map(|fmt| fmt == image::ImageFormat::Gif).unwrap_or(false)
        || bytes.starts_with(b"GIF87a")
        || bytes.starts_with(b"GIF89a")
}

/// Processa a imagem: decodifica, corta no centro na proporcao da forma pedida,
/// redimensiona via Lanczos3 e codifica em WebP sem perdas. Puramente CPU.
pub fn process_shape(bytes: &[u8], shape: Shape) -> Result<Vec<u8>, AvatarError> {
    // `load_from_memory` adivinha o formato pelos proprios bytes.
    let imagem = image::load_from_memory(bytes).map_err(|_| AvatarError::NaoEImagem)?;
    let (largura, altura) = shape.dimensoes();
    let cortada = cortar_proporcao(imagem, largura, altura)
        .resize_exact(largura, altura, FilterType::Lanczos3);
    let rgba = cortada.to_rgba8();

    let mut saida = Vec::new();
    WebPEncoder::new_lossless(Cursor::new(&mut saida))
        .write_image(&rgba, largura, altura, image::ExtendedColorType::Rgba8)
        .map_err(|_| AvatarError::NaoEImagem)?;
    Ok(saida)
}

/// Versao sincrona para processamento direto ou testes.
pub fn store_shape_sync(
    dir: &Path,
    user_id: &str,
    bytes: &[u8],
    shape: Shape,
) -> Result<usize, AvatarError> {
    let gif = is_gif(bytes);
    let saida = process_shape(bytes, shape)?;
    std::fs::create_dir_all(dir).map_err(AvatarError::Io)?;
    // Sempre grava o primeiro frame estatico em WebP (avatar_static_url)
    std::fs::write(caminho(dir, user_id), &saida).map_err(AvatarError::Io)?;
    if gif {
        // Se for GIF animado, preserva os bytes originais (avatar_gif_url)
        std::fs::write(caminho_gif(dir, user_id), bytes).map_err(AvatarError::Io)?;
    } else {
        let _ = std::fs::remove_file(caminho_gif(dir, user_id));
    }
    Ok(saida.len())
}

/// Decodifica, corta, reduz e grava em WebP no pool de blocking do Tokio.
pub async fn store_shape(
    dir: &Path,
    user_id: &str,
    bytes: &[u8],
    shape: Shape,
) -> Result<usize, AvatarError> {
    let dir = dir.to_path_buf();
    let user_id = user_id.to_string();
    let bytes = bytes.to_vec();
    tokio::task::spawn_blocking(move || store_shape_sync(&dir, &user_id, &bytes, shape))
        .await
        .map_err(|_| {
            AvatarError::Io(std::io::Error::other("spawn_blocking falhou"))
        })?
}

pub async fn store(dir: &Path, user_id: &str, bytes: &[u8]) -> Result<usize, AvatarError> {
    store_shape(dir, user_id, bytes, Shape::Square).await
}

pub async fn remove(dir: &Path, user_id: &str) {
    // Sumir com um arquivo que ja nao existe nao e erro.
    let _ = tokio::fs::remove_file(caminho(dir, user_id)).await;
    let _ = tokio::fs::remove_file(caminho_gif(dir, user_id)).await;
}

pub async fn read(dir: &Path, user_id: &str) -> Option<Vec<u8>> {
    tokio::fs::read(caminho(dir, user_id)).await.ok()
}

pub async fn read_gif(dir: &Path, user_id: &str) -> Option<Vec<u8>> {
    tokio::fs::read(caminho_gif(dir, user_id)).await.ok()
}

/// O recorte central na proporcao pedida. Cortar antes de redimensionar e o que
/// evita a foto esticada — vale tanto para o quadrado do avatar quanto para o
/// 8:3 do banner.
fn cortar_proporcao(imagem: DynamicImage, alvo_l: u32, alvo_a: u32) -> DynamicImage {
    let (largura, altura) = (imagem.width(), imagem.height());
    if largura == 0 || altura == 0 {
        return imagem;
    }
    // Comparacao cruzada em u64: `largura * alvo_a` contra `altura * alvo_l`
    // decide quem sobra sem passar por ponto flutuante.
    let atual = u64::from(largura) * u64::from(alvo_a);
    let desejado = u64::from(altura) * u64::from(alvo_l);
    if atual == desejado {
        return imagem;
    }
    let (corte_l, corte_a) = if atual > desejado {
        // Larga demais: mantem a altura e corta as laterais.
        let l = (u64::from(altura) * u64::from(alvo_l) / u64::from(alvo_a)) as u32;
        (l.max(1).min(largura), altura)
    } else {
        // Alta demais: mantem a largura e corta em cima e embaixo.
        let a = (u64::from(largura) * u64::from(alvo_a) / u64::from(alvo_l)) as u32;
        (largura, a.max(1).min(altura))
    };
    imagem.crop_imm((largura - corte_l) / 2, (altura - corte_a) / 2, corte_l, corte_a)
}

#[cfg(test)]
mod tests;
