use super::ssrf::*;
use super::*;

#[test]
fn ssrf_bloqueia_ips_privados_e_locais() {
    assert!(!is_safe_url("http://localhost:8787"));
    assert!(!is_safe_url("http://127.0.0.1:8787"));
    assert!(!is_safe_url("http://192.168.1.1"));
    assert!(!is_safe_url("http://10.0.0.1"));
    assert!(!is_safe_url("http://169.254.169.254/latest/meta-data"));
    assert!(!is_safe_url("http://[::1]/"));
    assert!(!is_safe_url("file:///etc/passwd"));
    assert!(!is_safe_url("ftp://exemplo.com"));
}

#[test]
fn ssrf_permite_urls_publicas() {
    assert!(is_safe_url("https://github.com"));
    assert!(is_safe_url("https://stapp.chat/about"));
    assert!(is_safe_url("http://8.8.8.8/dns"));
}

#[test]
fn extrai_primeira_url_valida() {
    let text = "veja este link https://github.com e teste";
    assert_eq!(extract_first_url(text), Some("https://github.com".to_string()));

    let ssrf_text = "olhe http://localhost:8787 aqui";
    assert_eq!(extract_first_url(ssrf_text), None);
}