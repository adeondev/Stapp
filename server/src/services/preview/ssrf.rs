use std::net::IpAddr;
use url::Url;

/// Valida se uma URL é segura para requisição de scraping pelo servidor,
/// impedindo ataques de SSRF (Server-Side Request Forgery).
pub fn is_safe_url(raw_url: &str) -> bool {
    let Ok(parsed) = Url::parse(raw_url) else {
        return false;
    };

    // Apenas esquemas HTTP e HTTPS são permitidos
    match parsed.scheme() {
        "http" | "https" => {}
        _ => return false,
    }

    let Some(host_str) = parsed.host_str() else {
        return false;
    };

    // Bloqueia nomes locais comuns
    let host_lower = host_str.to_lowercase();
    if host_lower == "localhost" || host_lower.ends_with(".local") || host_lower.ends_with(".internal") {
        return false;
    }

    // Se o host já for um IP direto, valida faixas proibidas
    if let Ok(ip) = host_str.parse::<IpAddr>() {
        return is_public_ip(&ip);
    }

    true
}

/// Retorna false se o IP for loopback, privado (RFC 1918), link-local ou reservado.
pub fn is_public_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            // Loopback 127.0.0.0/8
            if v4.is_loopback() {
                return false;
            }
            // Link-local / Cloud metadata (169.254.0.0/16)
            if v4.is_link_local() {
                return false;
            }
            // Privados RFC 1918: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
            if v4.is_private() {
                return false;
            }
            // Broadcast
            if v4.is_broadcast() {
                return false;
            }
            // 0.0.0.0
            if v4.is_unspecified() {
                return false;
            }
            true
        }
        IpAddr::V6(v6) => {
            if v6.is_loopback() || v6.is_unspecified() {
                return false;
            }
            // Unique Local Address (fc00::/7)
            let segments = v6.segments();
            if (segments[0] & 0xfe00) == 0xfc00 {
                return false;
            }
            // Link-local (fe80::/10)
            if (segments[0] & 0xffc0) == 0xfe80 {
                return false;
            }
            // Mapeamento IPv4 em IPv6 (::ffff:127.0.0.1)
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_public_ip(&IpAddr::V4(v4));
            }
            true
        }
    }
}