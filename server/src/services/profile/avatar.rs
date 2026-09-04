//! A imagem do avatar: o que chega, o que fica gravado.
//!
//! Tres coisas nao sao negociaveis aqui:
//!
//! - **a extensao nao vale nada.** Quem decide se e imagem e o decodificador,
//!   olhando os bytes. Um `.png` que na verdade e outra coisa nao passa.
//! - **grava sempre no mesmo formato e tamanho.** Entra PNG, JPEG ou WebP de
//!   qualquer dimensao; sai um WebP de 256x256. Sem isso o disco enche e o
//!   cliente teria que negociar formato.
//! - **o nome do arquivo e o user_id.** Uma conta tem no maximo um avatar, e
//!   subir de novo sobrescreve — nao existe lixo acumulando.

use std::io::Cursor;
use std::path::{Path, PathBuf};

use image::codecs::webp::WebPEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, ImageEncoder};

/// Avatar maior que isto nao ajuda ninguem e so ocupa disco.
const LADO: u32 = 256;
const EXTENSAO: &str = "webp";

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
            AvatarError::Io(erro) => write!(f, "nao consegui gravar o avatar: {erro}"),
        }
    }
}

pub fn caminho(dir: &Path, user_id: &str) -> PathBuf {
    dir.join(format!("{user_id}.{EXTENSAO}"))
}

/// A extensao que vai para o banco. Uma so, mas nomeada, para o dia em que
/// existir mais de um formato.
pub fn extensao() -> &'static str {
    EXTENSAO
}

/// Processa a imagem: decodifica, corta quadrado no centro, redimensiona via Lanczos3
/// e codifica em WebP sem perdas. Operacao puramente de CPU.
pub fn process_image(bytes: &[u8]) -> Result<Vec<u8>, AvatarError> {
    // `load_from_memory` adivinha o formato pelos proprios bytes.
    let imagem = image::load_from_memory(bytes).map_err(|_| AvatarError::NaoEImagem)?;
    let quadrada = cortar_quadrado(imagem).resize_exact(LADO, LADO, FilterType::Lanczos3);
    let rgba = quadrada.to_rgba8();

    let mut saida = Vec::new();
    WebPEncoder::new_lossless(Cursor::new(&mut saida))
        .write_image(&rgba, LADO, LADO, image::ExtendedColorType::Rgba8)
        .map_err(|_| AvatarError::NaoEImagem)?;
    Ok(saida)
}

/// Versao sincrona para processamento direto ou testes.
pub fn store_sync(dir: &Path, user_id: &str, bytes: &[u8]) -> Result<usize, AvatarError> {
    let saida = process_image(bytes)?;
    std::fs::create_dir_all(dir).map_err(AvatarError::Io)?;
    std::fs::write(caminho(dir, user_id), &saida).map_err(AvatarError::Io)?;
    Ok(saida.len())
}

/// Decodifica, corta quadrado, reduz via Lanczos3 e grava em WebP no pool de blocking do Tokio.
pub async fn store(dir: &Path, user_id: &str, bytes: &[u8]) -> Result<usize, AvatarError> {
    let dir = dir.to_path_buf();
    let user_id = user_id.to_string();
    let bytes = bytes.to_vec();
    tokio::task::spawn_blocking(move || store_sync(&dir, &user_id, &bytes))
        .await
        .map_err(|_| AvatarError::Io(std::io::Error::new(std::io::ErrorKind::Other, "spawn_blocking falhou")))?
}

pub async fn remove(dir: &Path, user_id: &str) {
    // Sumir com um arquivo que ja nao existe nao e erro.
    let _ = tokio::fs::remove_file(caminho(dir, user_id)).await;
}

pub async fn read(dir: &Path, user_id: &str) -> Option<Vec<u8>> {
    tokio::fs::read(caminho(dir, user_id)).await.ok()
}

/// O quadrado central. Cortar antes de redimensionar evita a foto esticada.
fn cortar_quadrado(imagem: DynamicImage) -> DynamicImage {
    let (largura, altura) = (imagem.width(), imagem.height());
    if largura == altura {
        return imagem;
    }
    let lado = largura.min(altura);
    imagem.crop_imm((largura - lado) / 2, (altura - lado) / 2, lado, lado)
}

#[cfg(test)]
mod tests;
