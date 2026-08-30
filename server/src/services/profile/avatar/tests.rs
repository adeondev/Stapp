use image::{Rgba, RgbaImage};

use super::*;
use crate::test_support::TestDir;

/// Uma imagem de verdade, com as duas metades de cores diferentes — assim da
/// para conferir de que lado o corte pegou.
fn png(largura: u32, altura: u32) -> Vec<u8> {
    let mut imagem = RgbaImage::new(largura, altura);
    for (x, _y, pixel) in imagem.enumerate_pixels_mut() {
        *pixel = if x < largura / 2 {
            Rgba([255, 0, 0, 255])
        } else {
            Rgba([0, 0, 255, 255])
        };
    }
    let mut bytes = Vec::new();
    image::DynamicImage::ImageRgba8(imagem)
        .write_to(&mut std::io::Cursor::new(&mut bytes), image::ImageFormat::Png)
        .unwrap();
    bytes
}

fn ler_gravado(dir: &std::path::Path, user_id: &str) -> image::DynamicImage {
    image::load_from_memory(&read(dir, user_id).expect("o arquivo tinha que existir")).unwrap()
}

#[test]
fn qualquer_tamanho_vira_um_quadrado_de_256() {
    let dir = TestDir::new();
    store(dir.path(), "u1", &png(800, 400)).unwrap();

    let gravada = ler_gravado(dir.path(), "u1");
    assert_eq!((gravada.width(), gravada.height()), (LADO, LADO));
}

#[test]
fn imagem_alta_e_cortada_no_centro_em_vez_de_esticada() {
    let dir = TestDir::new();
    // 100 de largura por 400 de altura: o corte deve pegar os 100x100 do meio,
    // que continuam metade vermelho e metade azul.
    store(dir.path(), "u1", &png(100, 400)).unwrap();

    let gravada = ler_gravado(dir.path(), "u1").to_rgba8();
    let esquerda = gravada.get_pixel(30, LADO / 2);
    let direita = gravada.get_pixel(LADO - 30, LADO / 2);
    assert!(esquerda[0] > 200 && esquerda[2] < 60, "esquerda vermelha: {esquerda:?}");
    assert!(direita[2] > 200 && direita[0] < 60, "direita azul: {direita:?}");
}

#[test]
fn o_que_nao_e_imagem_e_recusado() {
    let dir = TestDir::new();
    // Comeca com a assinatura de PNG mas o resto e lixo — nao basta parecer.
    let mentiroso = [b"\x89PNG\r\n\x1a\n".as_slice(), b"nao sou uma imagem"].concat();

    assert!(matches!(
        store(dir.path(), "u1", &mentiroso),
        Err(AvatarError::NaoEImagem)
    ));
    assert!(matches!(
        store(dir.path(), "u1", b"texto puro"),
        Err(AvatarError::NaoEImagem)
    ));
    assert!(read(dir.path(), "u1").is_none(), "nada pode ter sido gravado");
}

#[test]
fn grava_sempre_em_webp_qualquer_que_seja_a_entrada() {
    let dir = TestDir::new();
    store(dir.path(), "u1", &png(300, 300)).unwrap();

    let bytes = read(dir.path(), "u1").unwrap();
    assert_eq!(
        image::guess_format(&bytes).unwrap(),
        image::ImageFormat::WebP,
        "a entrada era PNG e a saida tem que ser WebP"
    );
    assert_eq!(caminho(dir.path(), "u1").extension().unwrap(), "webp");
}

#[test]
fn subir_de_novo_sobrescreve_em_vez_de_acumular() {
    let dir = TestDir::new();
    store(dir.path(), "u1", &png(300, 300)).unwrap();
    store(dir.path(), "u1", &png(120, 120)).unwrap();

    let arquivos: Vec<_> = std::fs::read_dir(dir.path())
        .unwrap()
        .filter_map(|entrada| entrada.ok())
        .filter(|entrada| entrada.path().extension().is_some_and(|ext| ext == "webp"))
        .collect();
    assert_eq!(arquivos.len(), 1, "uma conta tem no maximo um avatar");
}

#[test]
fn remover_apaga_e_nao_reclama_se_ja_nao_existe() {
    let dir = TestDir::new();
    store(dir.path(), "u1", &png(300, 300)).unwrap();
    remove(dir.path(), "u1");
    assert!(read(dir.path(), "u1").is_none());
    // Segunda vez nao pode explodir.
    remove(dir.path(), "u1");
}
