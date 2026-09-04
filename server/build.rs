use std::path::Path;

fn main() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".into());
    let dist_dir = Path::new(&manifest_dir).join("../web/dist");
    if !dist_dir.exists() {
        let _ = std::fs::create_dir_all(&dist_dir);
    }
    let index_path = dist_dir.join("index.html");
    if !index_path.exists() {
        let _ = std::fs::write(
            &index_path,
            "<!DOCTYPE html><html><body>Stapp web client is not built. Run 'pnpm --dir web build'.</body></html>",
        );
    }
}
