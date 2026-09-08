use std::path::Path;

fn main() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".into());
    let dist_dir = Path::new(&manifest_dir).join("../web/dist");
    if !dist_dir.exists() {
        let _ = std::fs::create_dir_all(&dist_dir);
    }
    let index_path = dist_dir.join("index.html");
    if !index_path.exists() {
        // O placeholder existe para o build do Rust nao depender do build do Node.
        // Mas ele produz um binario que compila, sobe e responde 200 servindo uma
        // pagina vazia: indistinguivel de um servidor saudavel para um healthcheck.
        // O aviso e o que separa "esqueci de buildar a SPA" de um bug de verdade.
        // A marca do texto e lida de volta por http::assets::is_placeholder_html —
        // mexeu aqui, mexe la.
        println!(
            "cargo:warning=web/dist nao encontrado: o binario vai embutir um index.html de aviso no lugar do cliente web. Rode 'pnpm --dir web build' antes."
        );
        let _ = std::fs::write(
            &index_path,
            "<!DOCTYPE html><html><body>Stapp web client is not built. Run 'pnpm --dir web build'.</body></html>",
        );
    }
}
