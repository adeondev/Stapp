use axum::Router;
use axum::body::Body;
use axum::extract::{DefaultBodyLimit, Json, Multipart, Path, Query, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch, post};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::SeekFrom;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio_util::io::ReaderStream;
use uuid::Uuid;

use super::auth::{OriginContext, attach_common_headers, origin_context};
use crate::config::ChannelKind;
use crate::protocol::now_ms;
use crate::session::AppState;
use crate::storage::attachments::NewAttachment;
use crate::storage::{Account, conversation_id};

const ORPHAN_TTL_MS: i64 = 24 * 60 * 60 * 1000;
const TICKET_TTL_MS: i64 = 10 * 60 * 1000;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", post(upload).options(preflight))
        .route("/{id}", patch(update).delete(remove).options(preflight))
        .route("/{id}/ticket", post(ticket).options(preflight))
        .route("/{id}/content", get(content))
        // Adaptador por uma versao para clientes anteriores ao upload mediado.
        .route("/presign", post(presign).options(preflight))
        .route("/confirm", post(confirm).options(preflight))
        .route("/files/{*key}", get(serve_legacy_file))
        .layer(DefaultBodyLimit::max(22 * 1024 * 1024))
}

#[derive(Serialize)]
struct UploadResponse {
    attachment_id: String,
    filename: String,
    content_type: String,
    size_bytes: usize,
    checksum_sha256: String,
}

async fn upload(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Response {
    let Some(context) = origin_context(&state, &headers) else {
        return StatusCode::FORBIDDEN.into_response();
    };
    let Some(account) = authenticate(&state, &headers).await else {
        return respond(StatusCode::UNAUTHORIZED, "sessao expirada", &context);
    };
    cleanup_expired_orphans(&state).await;

    let mut scope_kind = None;
    let mut scope_id = None;
    let mut uploaded = None;

    loop {
        let field = match multipart.next_field().await {
            Ok(Some(field)) => field,
            Ok(None) => break,
            Err(error) => {
                tracing::warn!(%error, "multipart invalido");
                return respond(
                    StatusCode::BAD_REQUEST,
                    "upload multipart invalido",
                    &context,
                );
            }
        };
        match field.name().unwrap_or_default() {
            "scope_kind" => scope_kind = field.text().await.ok(),
            "scope_id" => scope_id = field.text().await.ok(),
            "file" if uploaded.is_none() => {
                let filename = match safe_filename(field.file_name().unwrap_or("arquivo")) {
                    Ok(value) => value,
                    Err(message) => return respond(StatusCode::BAD_REQUEST, message, &context),
                };
                let declared_type = field
                    .content_type()
                    .unwrap_or("application/octet-stream")
                    .to_string();
                let temporary = state.media.temporary_path();
                let result =
                    write_upload(field, &temporary, state.config.limits.max_upload_bytes()).await;
                match result {
                    Ok((size, checksum, head)) => {
                        uploaded = Some((filename, declared_type, temporary, size, checksum, head));
                    }
                    Err(error) => {
                        let _ = tokio::fs::remove_file(&temporary).await;
                        return respond(StatusCode::BAD_REQUEST, &error, &context);
                    }
                }
            }
            _ => {}
        }
    }

    let Some((filename, declared_type, temporary, size, checksum, head)) = uploaded else {
        return respond(StatusCode::BAD_REQUEST, "campo file ausente", &context);
    };
    let (scope_kind, scope_id) =
        match normalize_scope(&state, &account, scope_kind.as_deref(), scope_id.as_deref()).await {
            Ok(scope) => scope,
            Err(message) => {
                let _ = tokio::fs::remove_file(&temporary).await;
                return respond(StatusCode::BAD_REQUEST, message, &context);
            }
        };
    let content_type = match validated_content_type(&filename, &declared_type, &head) {
        Ok(value) => value,
        Err(message) => {
            let _ = tokio::fs::remove_file(&temporary).await;
            return respond(StatusCode::BAD_REQUEST, message, &context);
        }
    };

    let id = Uuid::new_v4().to_string();
    let storage_key = id.clone();
    if let Err(error) = state
        .media
        .commit_upload(&temporary, &storage_key, &content_type, &checksum)
        .await
    {
        let _ = tokio::fs::remove_file(&temporary).await;
        tracing::error!(%error, "falha finalizando anexo");
        return respond(
            StatusCode::SERVICE_UNAVAILABLE,
            "storage indisponivel",
            &context,
        );
    }

    let now = now_ms();
    let record = NewAttachment {
        id: &id,
        user_id: &account.id,
        filename: &filename,
        content_type: &content_type,
        size_bytes: size,
        storage_key: &storage_key,
        checksum_sha256: &checksum,
        backend: state.media.backend_name(),
        created_at: now,
        expires_at: now + ORPHAN_TTL_MS,
        scope_kind: &scope_kind,
        scope_id: &scope_id,
    };
    if let Err(error) = state.db.insert_ready_attachment(&record).await {
        let _ = state.media.delete_object(&storage_key).await;
        tracing::error!(%error, "falha registrando anexo");
        return respond(
            StatusCode::INTERNAL_SERVER_ERROR,
            "erro ao registrar anexo",
            &context,
        );
    }

    let mut response = (
        StatusCode::CREATED,
        Json(UploadResponse {
            attachment_id: id,
            filename,
            content_type,
            size_bytes: size,
            checksum_sha256: checksum,
        }),
    )
        .into_response();
    attach_common_headers(&mut response, &context);
    response
}

async fn cleanup_expired_orphans(state: &AppState) {
    let now = now_ms();
    let expired = match state.db.expired_orphan_attachments(now).await {
        Ok(value) => value,
        Err(error) => {
            tracing::warn!(%error, "falha listando anexos orfaos");
            return;
        }
    };
    for (id, key) in expired {
        match state.media.delete_object(&key).await {
            Ok(()) => {
                if let Err(error) = state.db.delete_expired_orphan_attachment(&id, now).await {
                    tracing::warn!(%error, %id, "falha removendo registro de anexo orfao");
                }
            }
            Err(error) => tracing::warn!(%error, %id, "falha removendo objeto de anexo orfao"),
        }
    }
}

async fn write_upload(
    mut field: axum::extract::multipart::Field<'_>,
    temporary: &std::path::Path,
    max_bytes: usize,
) -> Result<(usize, String, Vec<u8>), String> {
    let mut file = tokio::fs::File::create(temporary)
        .await
        .map_err(|_| "storage indisponivel".to_string())?;
    let mut size = 0usize;
    let mut hash = Sha256::new();
    let mut head = Vec::with_capacity(512);
    while let Some(chunk) = field
        .chunk()
        .await
        .map_err(|_| "conexao interrompida".to_string())?
    {
        size = size.saturating_add(chunk.len());
        if size > max_bytes {
            return Err(format!(
                "arquivo excede o limite de {}MB",
                max_bytes / 1024 / 1024
            ));
        }
        if head.len() < 512 {
            let amount = (512 - head.len()).min(chunk.len());
            head.extend_from_slice(&chunk[..amount]);
        }
        hash.update(&chunk);
        file.write_all(&chunk)
            .await
            .map_err(|_| "storage indisponivel".to_string())?;
    }
    file.flush()
        .await
        .map_err(|_| "storage indisponivel".to_string())?;
    if size == 0 {
        return Err("o arquivo esta vazio".into());
    }
    Ok((size, hex::encode(hash.finalize()), head))
}

fn safe_filename(raw: &str) -> Result<String, &'static str> {
    let normalized = raw.replace('\\', "/");
    let name = normalized.rsplit('/').next().unwrap_or_default().trim();
    if name.is_empty() || name.len() > 255 || name.chars().any(char::is_control) {
        return Err("nome de arquivo invalido");
    }
    Ok(name.to_string())
}

fn validated_content_type(
    filename: &str,
    declared: &str,
    head: &[u8],
) -> Result<String, &'static str> {
    let extension = filename
        .rsplit('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    const BLOCKED: &[&str] = &[
        "exe", "dll", "msi", "com", "scr", "bat", "cmd", "ps1", "jar",
    ];
    if BLOCKED.contains(&extension.as_str())
        || head.starts_with(b"MZ")
        || head.starts_with(b"\x7fELF")
    {
        return Err("arquivos executaveis nao sao permitidos");
    }

    let detected = infer::get(head).map(|kind| kind.mime_type());
    if declared.starts_with("image/") && !detected.is_some_and(|mime| mime.starts_with("image/")) {
        return Err("a assinatura do arquivo nao corresponde a uma imagem");
    }
    if declared.starts_with("audio/") || declared.starts_with("video/") {
        if let Some(actual) = detected {
            let compatible = actual.starts_with("audio/")
                || actual.starts_with("video/")
                || actual == "application/ogg";
            if !compatible {
                return Err("a assinatura do arquivo nao corresponde a midia informada");
            }
        }
        // MediaRecorder usa audio/webm, enquanto a assinatura EBML costuma ser
        // classificada genericamente como video/webm. Preservar o tipo declarado
        // e necessario para o player de nota de voz.
        return Ok(declared.to_string());
    }
    Ok(detected.unwrap_or("application/octet-stream").to_string())
}

async fn normalize_scope(
    state: &AppState,
    account: &Account,
    kind: Option<&str>,
    id: Option<&str>,
) -> Result<(String, String), &'static str> {
    let (Some(kind), Some(id)) = (kind, id) else {
        return Err("destino do anexo ausente");
    };
    match kind {
        "channel" if matches!(state.config.channel(id), Some(ch) if ch.kind == ChannelKind::Text) => {
            Ok((kind.into(), id.into()))
        }
        "direct"
            if state.db.account_by_id(id).await.ok().flatten().is_some()
                && state
                    .db
                    .can_direct(&account.id, &id.to_string())
                    .await
                    .unwrap_or(false) =>
        {
            Ok((kind.into(), conversation_id(&account.id, id)))
        }
        _ => Err("destino do anexo invalido"),
    }
}

#[derive(Deserialize)]
struct MetadataRequest {
    filename: Option<String>,
    description: Option<String>,
    duration_ms: Option<u64>,
    waveform: Option<Vec<u8>>,
    width: Option<u32>,
    height: Option<u32>,
}

async fn update(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(payload): Json<MetadataRequest>,
) -> Response {
    let Some(context) = origin_context(&state, &headers) else {
        return StatusCode::FORBIDDEN.into_response();
    };
    let Some(account) = authenticate(&state, &headers).await else {
        return respond(StatusCode::UNAUTHORIZED, "sessao expirada", &context);
    };
    let filename = match payload.filename.as_deref().map(safe_filename).transpose() {
        Ok(value) => value,
        Err(message) => return respond(StatusCode::BAD_REQUEST, message, &context),
    };
    let description_set = payload.description.is_some();
    let description = payload
        .description
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty());
    if description.is_some_and(|value| value.chars().count() > 1024) {
        return respond(
            StatusCode::BAD_REQUEST,
            "texto alternativo muito longo",
            &context,
        );
    }
    if payload
        .duration_ms
        .is_some_and(|value| value > 20 * 60 * 1_000)
        || payload
            .waveform
            .as_ref()
            .is_some_and(|value| value.len() > 64)
        || payload
            .waveform
            .as_ref()
            .is_some_and(|value| value.iter().any(|sample| *sample > 100))
    {
        return respond(
            StatusCode::BAD_REQUEST,
            "metadados de midia invalidos",
            &context,
        );
    }
    match state
        .db
        .update_attachment_metadata(
            &id,
            &account.id,
            filename.as_deref(),
            description_set,
            description,
            payload.duration_ms,
            payload.waveform.as_deref(),
            payload.width,
            payload.height,
        )
        .await
    {
        Ok(true) => respond(StatusCode::NO_CONTENT, "", &context),
        Ok(false) => respond(StatusCode::NOT_FOUND, "anexo nao encontrado", &context),
        Err(error) => {
            tracing::error!(%error, "falha atualizando anexo");
            respond(
                StatusCode::INTERNAL_SERVER_ERROR,
                "erro ao atualizar anexo",
                &context,
            )
        }
    }
}

async fn remove(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    let Some(context) = origin_context(&state, &headers) else {
        return StatusCode::FORBIDDEN.into_response();
    };
    let Some(account) = authenticate(&state, &headers).await else {
        return respond(StatusCode::UNAUTHORIZED, "sessao expirada", &context);
    };
    match state.db.delete_orphan_attachment(&id, &account.id).await {
        Ok(Some(key)) => {
            if let Err(error) = state.media.delete_object(&key).await {
                tracing::warn!(%error, %key, "objeto orfao nao foi removido")
            }
            respond(StatusCode::NO_CONTENT, "", &context)
        }
        Ok(None) => respond(StatusCode::NOT_FOUND, "anexo nao encontrado", &context),
        Err(error) => {
            tracing::error!(%error, "falha removendo anexo");
            respond(
                StatusCode::INTERNAL_SERVER_ERROR,
                "erro ao remover anexo",
                &context,
            )
        }
    }
}

#[derive(Serialize)]
struct TicketResponse {
    content_url: String,
    expires_at: i64,
}

async fn ticket(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    let Some(context) = origin_context(&state, &headers) else {
        return StatusCode::FORBIDDEN.into_response();
    };
    let Some(account) = authenticate(&state, &headers).await else {
        return respond(StatusCode::UNAUTHORIZED, "sessao expirada", &context);
    };
    let token = Uuid::new_v4().to_string();
    let expires_at = now_ms() + TICKET_TTL_MS;
    match state
        .db
        .create_attachment_ticket(&id, &account.id, &token, expires_at)
        .await
    {
        Ok(true) => {
            let mut response = (
                StatusCode::OK,
                Json(TicketResponse {
                    content_url: format!("/attachments/{id}/content?ticket={token}"),
                    expires_at,
                }),
            )
                .into_response();
            attach_common_headers(&mut response, &context);
            response
        }
        Ok(false) => respond(StatusCode::NOT_FOUND, "anexo nao encontrado", &context),
        Err(error) => {
            tracing::error!(%error, "falha emitindo ticket");
            respond(
                StatusCode::INTERNAL_SERVER_ERROR,
                "erro ao emitir acesso",
                &context,
            )
        }
    }
}

#[derive(Deserialize)]
struct ContentQuery {
    ticket: String,
}

async fn content(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(query): Query<ContentQuery>,
    headers: HeaderMap,
) -> Response {
    let record = match state.db.attachment_by_ticket(&query.ticket, now_ms()).await {
        Ok(Some(record)) if record.id == id => record,
        _ => return StatusCode::NOT_FOUND.into_response(),
    };
    let range = headers
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok());

    match state.media.open_object_file(&record.storage_key).await {
        Ok(file) => streamed_ranged_response(&record, file, range).await,
        Err(_) => match state.media.get_object_bytes(&record.storage_key).await {
            Ok(bytes) => ranged_response(&record, bytes, range),
            Err(error) => {
                tracing::warn!(%error, "conteudo de anexo ausente");
                StatusCode::NOT_FOUND.into_response()
            }
        },
    }
}

async fn streamed_ranged_response(
    record: &crate::storage::attachments::AttachmentRecord,
    mut file: tokio::fs::File,
    range: Option<&str>,
) -> Response {
    let total = match file.metadata().await {
        Ok(meta) => meta.len() as usize,
        Err(error) => {
            tracing::error!(%error, "falha lendo metadados de anexo");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };
    let parsed = range.and_then(|raw| parse_range(raw, total));
    let (status, start, end) = parsed.map_or(
        (StatusCode::OK, 0, total.saturating_sub(1)),
        |(start, end)| (StatusCode::PARTIAL_CONTENT, start, end),
    );
    let content_length = if total == 0 { 0 } else { end - start + 1 };
    let body = if total == 0 {
        Body::empty()
    } else {
        if let Err(error) = file.seek(SeekFrom::Start(start as u64)).await {
            tracing::error!(%error, "falha buscando deslocamento do anexo");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
        let stream = ReaderStream::new(file.take(content_length as u64));
        Body::from_stream(stream)
    };
    let mut response = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, &record.content_type)
        .header(header::CONTENT_LENGTH, content_length)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CACHE_CONTROL, "private, max-age=600")
        .header(header::CONTENT_DISPOSITION, content_disposition(record))
        .body(body)
        .unwrap();
    if status == StatusCode::PARTIAL_CONTENT {
        response.headers_mut().insert(
            header::CONTENT_RANGE,
            HeaderValue::from_str(&format!("bytes {start}-{end}/{total}")).unwrap(),
        );
    }
    response.headers_mut().insert(
        HeaderName::from_static("cross-origin-resource-policy"),
        HeaderValue::from_static("cross-origin"),
    );
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    response
}

fn ranged_response(
    record: &crate::storage::attachments::AttachmentRecord,
    bytes: Vec<u8>,
    range: Option<&str>,
) -> Response {
    let total = bytes.len();
    let parsed = range.and_then(|raw| parse_range(raw, total));
    let (status, start, end) = parsed.map_or(
        (StatusCode::OK, 0, total.saturating_sub(1)),
        |(start, end)| (StatusCode::PARTIAL_CONTENT, start, end),
    );
    let body = if total == 0 {
        Vec::new()
    } else {
        bytes[start..=end].to_vec()
    };
    let mut response = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, &record.content_type)
        .header(header::CONTENT_LENGTH, body.len())
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CACHE_CONTROL, "private, max-age=600")
        .header(header::CONTENT_DISPOSITION, content_disposition(record))
        .body(Body::from(body))
        .unwrap();
    if status == StatusCode::PARTIAL_CONTENT {
        response.headers_mut().insert(
            header::CONTENT_RANGE,
            HeaderValue::from_str(&format!("bytes {start}-{end}/{total}")).unwrap(),
        );
    }
    response.headers_mut().insert(
        HeaderName::from_static("cross-origin-resource-policy"),
        HeaderValue::from_static("cross-origin"),
    );
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    response
}

fn parse_range(raw: &str, total: usize) -> Option<(usize, usize)> {
    let spec = raw.strip_prefix("bytes=")?;
    if spec.contains(',') || total == 0 {
        return None;
    }
    let (start, end) = spec.split_once('-')?;
    if start.is_empty() {
        let suffix = end.parse::<usize>().ok()?.min(total);
        return Some((total - suffix, total - 1));
    }
    let start = start.parse::<usize>().ok()?;
    if start >= total {
        return None;
    }
    let end = if end.is_empty() {
        total - 1
    } else {
        end.parse::<usize>().ok()?.min(total - 1)
    };
    (start <= end).then_some((start, end))
}

fn content_disposition(record: &crate::storage::attachments::AttachmentRecord) -> String {
    let previewable = matches!(
        record.content_type.as_str(),
        "image/png" | "image/jpeg" | "image/webp" | "image/gif" | "image/avif"
    ) || record.content_type.starts_with("audio/")
        || record.content_type.starts_with("video/");
    let mode = if previewable { "inline" } else { "attachment" };
    let escaped = record.filename.replace(['\r', '\n', '"'], "_");
    format!("{mode}; filename=\"{escaped}\"")
}

#[derive(Deserialize)]
struct PresignRequest {
    filename: String,
    content_type: String,
    size_bytes: usize,
}
#[derive(Serialize)]
struct PresignResponse {
    attachment_id: String,
    upload_url: String,
    download_url: String,
    s3_key: String,
}

async fn presign(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<PresignRequest>,
) -> Response {
    let Some(context) = origin_context(&state, &headers) else {
        return StatusCode::FORBIDDEN.into_response();
    };
    let Some(account) = authenticate(&state, &headers).await else {
        return respond(StatusCode::UNAUTHORIZED, "sessao expirada", &context);
    };
    if payload.size_bytes > state.config.limits.max_upload_bytes() {
        return respond(StatusCode::BAD_REQUEST, "arquivo excede o limite", &context);
    }
    match state
        .media
        .generate_presigned_upload(&account.id, &payload.filename, &payload.content_type)
        .await
    {
        Ok(value) => {
            let mut response = (
                StatusCode::OK,
                Json(PresignResponse {
                    attachment_id: value.attachment_id,
                    upload_url: value.upload_url,
                    download_url: format!("/attachments/files/{}", value.s3_key),
                    s3_key: value.s3_key,
                }),
            )
                .into_response();
            attach_common_headers(&mut response, &context);
            response
        }
        Err(_) => respond(
            StatusCode::GONE,
            "atualize o Stapp para enviar anexos",
            &context,
        ),
    }
}

#[derive(Deserialize)]
struct ConfirmRequest {
    attachment_id: String,
    filename: String,
    content_type: String,
    size_bytes: usize,
    s3_key: String,
}

async fn confirm(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<ConfirmRequest>,
) -> Response {
    let Some(context) = origin_context(&state, &headers) else {
        return StatusCode::FORBIDDEN.into_response();
    };
    let Some(account) = authenticate(&state, &headers).await else {
        return respond(StatusCode::UNAUTHORIZED, "sessao expirada", &context);
    };
    if !state.media.object_exists(&payload.s3_key).await {
        return respond(
            StatusCode::CONFLICT,
            "o arquivo nao chegou ao storage",
            &context,
        );
    }
    match state
        .db
        .insert_attachment(
            &payload.attachment_id,
            &account.id,
            &payload.filename,
            &payload.content_type,
            payload.size_bytes,
            &payload.s3_key,
            now_ms(),
        )
        .await
    {
        Ok(()) => respond(StatusCode::NO_CONTENT, "", &context),
        Err(error) => {
            tracing::error!(%error, "confirmacao antiga falhou");
            respond(
                StatusCode::INTERNAL_SERVER_ERROR,
                "erro ao confirmar anexo",
                &context,
            )
        }
    }
}

async fn serve_legacy_file(
    State(state): State<Arc<AppState>>,
    Path(key): Path<String>,
) -> Response {
    // O backend local e sempre privado e so sai por ticket. Esta excecao
    // transitoria existe exclusivamente para objetos S3 criados por EXEs antigos.
    if state.media.backend_name() != "s3" {
        return StatusCode::GONE.into_response();
    }
    match state.media.get_object_bytes(&key).await {
        Ok(bytes) => (
            [
                (header::CONTENT_TYPE, "application/octet-stream"),
                (header::CACHE_CONTROL, "private, max-age=600"),
            ],
            bytes,
        )
            .into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn preflight(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let Some(context) = origin_context(&state, &headers) else {
        return StatusCode::FORBIDDEN.into_response();
    };
    let mut response = StatusCode::NO_CONTENT.into_response();
    attach_common_headers(&mut response, &context);
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, PATCH, DELETE, OPTIONS"),
    );
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("authorization, content-type, range"),
    );
    response
}

fn respond(status: StatusCode, body: &str, context: &OriginContext) -> Response {
    let mut response = if body.is_empty() {
        status.into_response()
    } else {
        (status, body.to_string()).into_response()
    };
    attach_common_headers(&mut response, context);
    response
}

async fn authenticate(state: &AppState, headers: &HeaderMap) -> Option<Account> {
    let raw = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    state
        .auth
        .tokens
        .verify_access(&state.db, raw.strip_prefix("Bearer ")?)
        .await
}

#[cfg(test)]
mod tests {
    use super::{parse_range, safe_filename, validated_content_type};

    #[test]
    fn path_traversal_vira_apenas_nome() {
        assert_eq!(safe_filename("../../foto.png").unwrap(), "foto.png");
        assert_eq!(safe_filename("..\\..\\voz.webm").unwrap(), "voz.webm");
    }

    #[test]
    fn executavel_disfarcado_e_bloqueado() {
        assert!(validated_content_type("foto.png", "image/png", b"MZfake").is_err());
    }

    #[test]
    fn interpreta_range_unico() {
        assert_eq!(parse_range("bytes=2-5", 10), Some((2, 5)));
        assert_eq!(parse_range("bytes=-3", 10), Some((7, 9)));
        assert_eq!(parse_range("bytes=8-", 10), Some((8, 9)));
    }
}
