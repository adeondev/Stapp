pub mod crawler;
pub mod ssrf;
#[cfg(test)]
mod tests;

pub use crawler::{CrawlJob, CrawlTarget, LinkPreviewCrawler};

use crate::protocol::UrlPreview;
use reqwest::Client;
use scraper::{Html, Selector};
use std::time::Duration;

pub fn extract_first_url(text: &str) -> Option<String> {
    for word in text.split_whitespace() {
        if (word.starts_with("http://") || word.starts_with("https://")) && ssrf::is_safe_url(word)
        {
            return Some(word.to_string());
        }
    }
    None
}

/// Executa o scraping da URL informada instanciando um cliente efemero (para testes).
#[allow(dead_code)]
pub async fn scrape_metadata(target_url: &str) -> Option<UrlPreview> {
    let client = Client::builder()
        .timeout(Duration::from_secs(5))
        .user_agent("StappBot/1.0 (+https://stapp.chat)")
        .build()
        .ok()?;
    scrape_metadata_with_client(&client, target_url).await
}

/// Executa o scraping da URL informada reutilizando o cliente HTTP configurado.
pub async fn scrape_metadata_with_client(client: &Client, target_url: &str) -> Option<UrlPreview> {
    if !ssrf::is_safe_url(target_url) {
        return None;
    }

    let response = client.get(target_url).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }

    // Limita o corpo do HTML lido em 512KB para proteção contra zip-bombs/excesso de memória
    let bytes = response.bytes().await.ok()?;
    let slice = if bytes.len() > 512 * 1024 {
        &bytes[..512 * 1024]
    } else {
        &bytes[..]
    };
    let html_text = String::from_utf8_lossy(slice);

    let document = Html::parse_document(&html_text);

    let title = extract_tag(&document, "meta[property='og:title']", "content")
        .or_else(|| extract_tag(&document, "meta[name='twitter:title']", "content"))
        .or_else(|| extract_text(&document, "title"));

    let description = extract_tag(&document, "meta[property='og:description']", "content")
        .or_else(|| extract_tag(&document, "meta[name='description']", "content"))
        .or_else(|| extract_tag(&document, "meta[name='twitter:description']", "content"));

    let image = extract_tag(&document, "meta[property='og:image']", "content")
        .or_else(|| extract_tag(&document, "meta[name='twitter:image']", "content"));

    let site_name = extract_tag(&document, "meta[property='og:site_name']", "content");

    if title.is_none() && description.is_none() {
        return None;
    }

    Some(UrlPreview {
        url: target_url.to_string(),
        title,
        description,
        image,
        site_name,
    })
}

fn extract_tag(document: &Html, selector_str: &str, attr: &str) -> Option<String> {
    let selector = Selector::parse(selector_str).ok()?;
    let element = document.select(&selector).next()?;
    let value = element.value().attr(attr)?.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn extract_text(document: &Html, selector_str: &str) -> Option<String> {
    let selector = Selector::parse(selector_str).ok()?;
    let element = document.select(&selector).next()?;
    let text: String = element.text().collect::<Vec<_>>().join(" ");
    let text = text.trim();
    if text.is_empty() {
        None
    } else {
        Some(text.to_string())
    }
}
