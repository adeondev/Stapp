use std::net::IpAddr;
use tokio::net::lookup_host;
use url::Url;

/// Valida se uma URL é segura para requisição de scraping pelo servidor,
/// impedindo ataques de SSRF (Server-Side Request Forgery).
///
/// Esta é a peneira **sintática**: ela não resolve DNS, então um domínio só
/// passa por não ser textualmente local. Um nome público com registro A
/// apontando para a rede interna passa aqui de propósito — quem fecha essa
/// porta é [`resolves_to_public_ip_only`], que roda antes de cada conexão.
/// Use esta função onde não dá para esperar por DNS (varredura de mensagens);
/// nunca a use sozinha como autorização para conectar.
pub fn is_safe_url(raw_url: &str) -> bool {
    let Ok(parsed) = Url::parse(raw_url) else {
        return false;
    };

    // Apenas esquemas HTTP e HTTPS são permitidos
    match parsed.scheme() {
        "http" | "https" => {}
        _ => return false,
    }

    let Some(host) = parsed.host() else {
        return false;
    };

    match host {
        url::Host::Ipv4(v4) => is_public_ip(&IpAddr::V4(v4)),
        url::Host::Ipv6(v6) => is_public_ip(&IpAddr::V6(v6)),
        url::Host::Domain(domain) => {
            let host_lower = domain.to_lowercase();
            if host_lower == "localhost"
                || host_lower.ends_with(".local")
                || host_lower.ends_with(".internal")
            {
                return false;
            }
            true
        }
    }
}

/// Domínios conhecidos e autorizados para renderização de players e embeds interativos em iframe.
pub const ALLOWED_EMBED_DOMAINS: &[&str] = &[
    "youtube.com",
    "www.youtube.com",
    "youtube-nocookie.com",
    "www.youtube-nocookie.com",
    "youtu.be",
    "vimeo.com",
    "player.vimeo.com",
    "twitch.tv",
    "player.twitch.tv",
    "soundcloud.com",
    "w.soundcloud.com",
    "streamable.com",
    "dailymotion.com",
    "www.dailymotion.com",
];

/// Valida rigorosamente se uma URL de embed é segura para renderização em iframe,
/// exigindo protocolo HTTPS estrito, porta padrão, ausência de credenciais e host autorizado,
/// prevenindo ataques de SSRF ou injeção de iframes locais/internos.
pub fn is_safe_embed_url(raw_url: &str) -> bool {
    let Ok(parsed) = Url::parse(raw_url) else {
        return false;
    };

    if parsed.scheme() != "https" {
        return false;
    }

    if !parsed.username().is_empty() || parsed.password().is_some() {
        return false;
    }

    if let Some(port) = parsed.port() {
        if port != 443 {
            return false;
        }
    }

    let Some(host_str) = parsed.host_str() else {
        return false;
    };

    let host_lower = host_str.to_lowercase();
    if host_lower == "localhost"
        || host_lower.ends_with(".local")
        || host_lower.ends_with(".internal")
        || host_lower.ends_with(".lan")
    {
        return false;
    }

    if !is_safe_url(raw_url) {
        return false;
    }

    ALLOWED_EMBED_DOMAINS.iter().any(|&domain| {
        host_lower == domain || host_lower.ends_with(&format!(".{domain}"))
    })
}

/// Resolve o host da URL e exige que **todos** os endereços retornados sejam
/// públicos. É esta função, e não [`is_safe_url`], que autoriza uma conexão.
///
/// Sem ela bastava um registro A de um domínio público apontando para
/// `127.0.0.1`, `169.254.169.254` ou a LAN de quem hospeda: o servidor buscava
/// a página interna e devolvia `<title>` e `og:description` por broadcast para
/// todo mundo do servidor — SSRF com canal de retorno.
///
/// PROTOTYPE: entre esta checagem e o `connect` do reqwest existe uma janela de
/// TOCTOU — um resolvedor hostil pode devolver um IP público aqui e um privado
/// no momento da conexão (DNS rebinding). Fechar isso exige resolver uma vez e
/// conectar num socket já vinculado ao endereço validado, o que hoje pede um
/// `Resolve` customizado no reqwest. O invariante que não pode ser quebrado é
/// que nenhuma conexão de crawler saia sem passar por aqui.
/// FUTURE: trocar por um `reqwest::dns::Resolve` que valide e fixe o endereço,
/// eliminando a janela em vez de estreitá-la.
pub async fn resolves_to_public_ip_only(raw_url: &str) -> bool {
    let Ok(parsed) = Url::parse(raw_url) else {
        return false;
    };

    let Some(host) = parsed.host() else {
        return false;
    };

    // Literais de IP não passam pelo resolvedor: valida direto.
    match host {
        url::Host::Ipv4(v4) => return is_public_ip(&IpAddr::V4(v4)),
        url::Host::Ipv6(v6) => return is_public_ip(&IpAddr::V6(v6)),
        url::Host::Domain(_) => {}
    }

    let Some(host_str) = parsed.host_str() else {
        return false;
    };
    let port = parsed.port_or_known_default().unwrap_or(80);

    let Ok(addrs) = lookup_host((host_str, port)).await else {
        return false;
    };

    all_addrs_public(addrs.map(|addr| addr.ip()))
}

/// Exige que todo endereço resolvido seja público, e que exista pelo menos um.
///
/// A checagem é sobre **todos** os endereços de propósito: um host que resolve
/// para um IP público e um privado ao mesmo tempo continua sendo um caminho
/// para a rede interna, porque quem escolhe a qual conectar é o sistema.
pub fn all_addrs_public(addrs: impl IntoIterator<Item = IpAddr>) -> bool {
    let mut resolved_any = false;
    for ip in addrs {
        resolved_any = true;
        if !is_public_ip(&ip) {
            return false;
        }
    }
    resolved_any
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

            let octets = v4.octets();
            // "Este host, nesta rede" (0.0.0.0/8) — 0.x.y.z alcanca a maquina local.
            if octets[0] == 0 {
                return false;
            }
            // CGNAT 100.64.0.0/10 — faixa de Tailscale, citada no CLAUDE.md.
            if octets[0] == 100 && (64..=127).contains(&octets[1]) {
                return false;
            }
            // 26.0.0.0/8 — usada pelo Radmin VPN nas implantacoes deste projeto.
            if octets[0] == 26 {
                return false;
            }
            // IETF Protocol Assignments 192.0.0.0/24.
            if octets[0] == 192 && octets[1] == 0 && octets[2] == 0 {
                return false;
            }
            // Benchmarking 198.18.0.0/15.
            if octets[0] == 198 && (octets[1] == 18 || octets[1] == 19) {
                return false;
            }
            // Multicast 224.0.0.0/4 e reservado 240.0.0.0/4 (broadcast incluso).
            if octets[0] >= 224 {
                return false;
            }
            true
        }
        IpAddr::V6(v6) => {
            if v6.is_loopback() || v6.is_unspecified() || v6.is_multicast() {
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
