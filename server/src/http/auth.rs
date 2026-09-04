use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::{ConnectInfo, DefaultBodyLimit, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};

use crate::auth::{LoginError, RegisterError, refresh_id};
use crate::protocol::{ApiError, AuthErrorCode, AuthRequest, AuthSession, now_ms};
use crate::session::AppState;

const CLIENT_HEADER: &str = "stapp-web-v2";

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/login", post(login).options(preflight))
        .route("/register", post(register).options(preflight))
        .route("/refresh", post(refresh).options(preflight))
        .route("/logout", post(logout).options(preflight))
        .layer(DefaultBodyLimit::max(16 * 1024))
}

async fn login(
    State(state): State<Arc<AppState>>,
    ConnectInfo(origin): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(request): Json<AuthRequest>,
) -> Response {
    let context = match validate_request(&state, &headers) {
        Ok(context) => context,
        Err(response) => return response,
    };
    if let Some(response) = rate_limit(&state, origin.ip(), &context) {
        return response;
    }
    if !state.config.auth.allows_plaintext_from(origin.ip()) {
        return api_error(
            StatusCode::FORBIDDEN,
            AuthErrorCode::SecureTransportRequired,
            "use HTTPS para autenticar de fora das redes confiaveis deste servidor",
            None,
            &context,
        );
    }

    match state
        .auth
        .login(&state.db, &request.username, request.password)
        .await
    {
        Ok(account) => authenticated(&state, account, request.remember, &context).await,
        Err(LoginError::RateLimited(wait)) => api_error(
            StatusCode::TOO_MANY_REQUESTS,
            AuthErrorCode::RateLimited,
            "muitas tentativas; aguarde um pouco",
            Some(wait.as_millis().min(u64::MAX as u128) as u64),
            &context,
        ),
        Err(LoginError::InvalidCredentials) => api_error(
            StatusCode::UNAUTHORIZED,
            AuthErrorCode::InvalidCredentials,
            "username ou senha incorretos",
            None,
            &context,
        ),
        Err(LoginError::Internal(error)) => {
            tracing::error!(%error, "falha autenticando conta por HTTP");
            api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                AuthErrorCode::InvalidCredentials,
                "nao foi possivel autenticar",
                None,
                &context,
            )
        }
    }
}

async fn register(
    State(state): State<Arc<AppState>>,
    ConnectInfo(origin): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(request): Json<AuthRequest>,
) -> Response {
    let context = match validate_request(&state, &headers) {
        Ok(context) => context,
        Err(response) => return response,
    };
    if let Some(response) = rate_limit(&state, origin.ip(), &context) {
        return response;
    }
    if !state.config.auth.allows_plaintext_from(origin.ip()) {
        return api_error(
            StatusCode::FORBIDDEN,
            AuthErrorCode::SecureTransportRequired,
            "use HTTPS para autenticar de fora das redes confiaveis deste servidor",
            None,
            &context,
        );
    }
    if !state.config.auth.allow_registration {
        return api_error(
            StatusCode::FORBIDDEN,
            AuthErrorCode::RegistrationDisabled,
            "este servidor nao permite criar contas pelo aplicativo",
            None,
            &context,
        );
    }

    match state
        .auth
        .register(&state.db, origin.ip(), &request.username, request.password)
        .await
    {
        Ok(account) => authenticated(&state, account, request.remember, &context).await,
        Err(RegisterError::InvalidUsername) => api_error(
            StatusCode::BAD_REQUEST,
            AuthErrorCode::InvalidUsername,
            "use de 3 a 24 letras, numeros, ponto, hifen ou sublinhado",
            None,
            &context,
        ),
        Err(RegisterError::InvalidPassword) => api_error(
            StatusCode::BAD_REQUEST,
            AuthErrorCode::InvalidPassword,
            "a senha precisa ter entre 12 e 128 caracteres",
            None,
            &context,
        ),
        Err(RegisterError::UsernameUnavailable) => api_error(
            StatusCode::CONFLICT,
            AuthErrorCode::UsernameUnavailable,
            "esse username ja esta em uso",
            None,
            &context,
        ),
        Err(RegisterError::RateLimited(wait)) => api_error(
            StatusCode::TOO_MANY_REQUESTS,
            AuthErrorCode::RateLimited,
            "muitas tentativas; aguarde um pouco",
            Some(wait.as_millis().min(u64::MAX as u128) as u64),
            &context,
        ),
        Err(RegisterError::Internal(error)) => {
            tracing::error!(%error, "falha registrando conta por HTTP");
            api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                AuthErrorCode::InvalidCredentials,
                "nao foi possivel criar a conta",
                None,
                &context,
            )
        }
    }
}

async fn refresh(
    State(state): State<Arc<AppState>>,
    ConnectInfo(origin): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Response {
    let context = match validate_request(&state, &headers) {
        Ok(context) => context,
        Err(response) => return response,
    };
    if let Some(response) = rate_limit(&state, origin.ip(), &context) {
        return response;
    }
    let Some(raw) = refresh_cookie(&state, &headers) else {
        return api_error(
            StatusCode::UNAUTHORIZED,
            AuthErrorCode::InvalidCredentials,
            "sessao expirada",
            None,
            &context,
        );
    };

    match state.auth.tokens.rotate_refresh(&state.db, &raw).await {
        Ok(Some((account, refresh))) => {
            let access = state.auth.tokens.issue_access(&account);
            let cookie = set_cookie(
                &state,
                &refresh.token,
                refresh.remember,
                refresh.expires_at,
                &context,
            );
            success(access.token, access.expires_at, Some(cookie), &context)
        }
        Ok(None) => api_error(
            StatusCode::UNAUTHORIZED,
            AuthErrorCode::InvalidCredentials,
            "sessao expirada",
            None,
            &context,
        ),
        Err(error) => {
            tracing::error!(%error, "falha renovando sessao");
            api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                AuthErrorCode::InvalidCredentials,
                "nao foi possivel renovar a sessao",
                None,
                &context,
            )
        }
    }
}

async fn logout(
    State(state): State<Arc<AppState>>,
    ConnectInfo(origin): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Response {
    let context = match validate_request(&state, &headers) {
        Ok(context) => context,
        Err(response) => return response,
    };
    if let Some(response) = rate_limit(&state, origin.ip(), &context) {
        return response;
    }
    if let Some(raw) = refresh_cookie(&state, &headers) {
        if let Some(id) = refresh_id(&raw) {
            if let Err(error) = state.db.revoke_refresh_session(id).await {
                tracing::error!(%error, "falha revogando sessao");
            }
        }
    }
    let mut response = StatusCode::NO_CONTENT.into_response();
    attach_common_headers(&mut response, &context);
    if let Ok(value) = HeaderValue::from_str(&clear_cookie(&state, &context)) {
        response.headers_mut().insert(header::SET_COOKIE, value);
    }
    response
}

async fn preflight(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let context = match origin_context(&state, &headers) {
        Some(context) => context,
        None => return StatusCode::FORBIDDEN.into_response(),
    };
    let mut response = StatusCode::NO_CONTENT.into_response();
    attach_common_headers(&mut response, &context);
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("POST, OPTIONS"),
    );
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("content-type, x-stapp-client"),
    );
    response
}

async fn authenticated(
    state: &AppState,
    account: crate::storage::Account,
    remember: bool,
    context: &OriginContext,
) -> Response {
    let access = state.auth.tokens.issue_access(&account);
    match state
        .auth
        .tokens
        .create_refresh(&state.db, &account, remember)
        .await
    {
        Ok(refresh) => success(
            access.token,
            access.expires_at,
            Some(set_cookie(
                state,
                &refresh.token,
                refresh.remember,
                refresh.expires_at,
                context,
            )),
            context,
        ),
        Err(error) => {
            tracing::error!(%error, "falha criando sessao persistente");
            api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                AuthErrorCode::InvalidCredentials,
                "nao foi possivel abrir a sessao",
                None,
                context,
            )
        }
    }
}

fn success(
    token: String,
    expires_at: i64,
    cookie: Option<String>,
    context: &OriginContext,
) -> Response {
    let mut response = Json(AuthSession {
        access_token: token,
        access_expires_at: expires_at,
    })
    .into_response();
    attach_common_headers(&mut response, context);
    if let Some(cookie) = cookie.and_then(|value| HeaderValue::from_str(&value).ok()) {
        response.headers_mut().insert(header::SET_COOKIE, cookie);
    }
    response
}

fn api_error(
    status: StatusCode,
    code: AuthErrorCode,
    message: &str,
    retry_after_ms: Option<u64>,
    context: &OriginContext,
) -> Response {
    let mut response = (
        status,
        Json(ApiError {
            code,
            message: message.to_string(),
            retry_after_ms,
        }),
    )
        .into_response();
    attach_common_headers(&mut response, context);
    response
}

#[derive(Clone)]
pub(super) struct OriginContext {
    origin: Option<String>,
    cross_site: bool,
}

fn validate_request(state: &AppState, headers: &HeaderMap) -> Result<OriginContext, Response> {
    let Some(context) = origin_context(state, headers) else {
        return Err(StatusCode::FORBIDDEN.into_response());
    };
    let client = headers
        .get("x-stapp-client")
        .and_then(|value| value.to_str().ok());
    if client != Some(CLIENT_HEADER) {
        return Err(StatusCode::FORBIDDEN.into_response());
    }
    let json = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| {
            value.eq_ignore_ascii_case("application/json")
                || value.to_ascii_lowercase().starts_with("application/json;")
        });
    if !json {
        return Err(StatusCode::UNSUPPORTED_MEDIA_TYPE.into_response());
    }
    Ok(context)
}

fn rate_limit(
    state: &AppState,
    origin: std::net::IpAddr,
    context: &OriginContext,
) -> Option<Response> {
    state.auth.http_wait(origin).map(|wait| {
        api_error(
            StatusCode::TOO_MANY_REQUESTS,
            AuthErrorCode::RateLimited,
            "muitas requisicoes; aguarde um pouco",
            Some(wait.as_millis().min(u64::MAX as u128) as u64),
            context,
        )
    })
}

pub(super) fn origin_context(state: &AppState, headers: &HeaderMap) -> Option<OriginContext> {
    let origin = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let Some(origin_value) = origin.as_deref() else {
        return Some(OriginContext {
            origin: None,
            cross_site: false,
        });
    };
    let host = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok());
    let same_site = host.is_some_and(|host| authority(origin_value) == Some(host));
    let is_dev_loopback = origin_value.starts_with("http://localhost:")
        || origin_value.starts_with("http://127.0.0.1:")
        || origin_value.starts_with("http://[::1]:");
    let built_in = matches!(
        origin_value,
        "http://tauri.localhost"
            | "https://tauri.localhost"
            | "tauri://localhost"
            | "http://localhost"
            | "http://127.0.0.1"
    ) || is_dev_loopback;
    let configured = state
        .config
        .auth
        .allowed_origins
        .iter()
        .any(|allowed| allowed == origin_value);
    (same_site || built_in || configured).then_some(OriginContext {
        origin,
        cross_site: !same_site,
    })
}

fn authority(origin: &str) -> Option<&str> {
    origin.split_once("://")?.1.split('/').next()
}

pub(super) fn attach_common_headers(response: &mut Response, context: &OriginContext) {
    response
        .headers_mut()
        .insert(header::VARY, HeaderValue::from_static("Origin"));
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_CREDENTIALS,
        HeaderValue::from_static("true"),
    );
    if let Some(origin) = context
        .origin
        .as_deref()
        .and_then(|value| HeaderValue::from_str(value).ok())
    {
        response
            .headers_mut()
            .insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
    }
    response.headers_mut().insert(
        HeaderName::from_static("x-content-type-options"),
        HeaderValue::from_static("nosniff"),
    );
    response.headers_mut().insert(
        HeaderName::from_static("cache-control"),
        HeaderValue::from_static("no-store"),
    );
}

fn cookie_name(state: &AppState) -> String {
    let id = state.db.server_id().unwrap_or_else(|_| "unknown".into());
    format!("__Secure-stapp-refresh-{}", id.replace('-', ""))
}

fn refresh_cookie(state: &AppState, headers: &HeaderMap) -> Option<String> {
    let wanted = cookie_name(state);
    headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .filter_map(|entry| entry.trim().split_once('='))
        .find_map(|(name, value)| (name == wanted).then(|| value.to_string()))
}

fn set_cookie(
    state: &AppState,
    token: &str,
    remember: bool,
    expires_at: i64,
    context: &OriginContext,
) -> String {
    let mut cookie = format!(
        "{}={token}; Path=/auth; HttpOnly; Secure; {}",
        cookie_name(state),
        same_site_attributes(context)
    );
    if remember {
        let seconds = ((expires_at - now_ms()) / 1000).max(0);
        cookie.push_str(&format!("; Max-Age={seconds}"));
    }
    cookie
}

fn clear_cookie(state: &AppState, context: &OriginContext) -> String {
    format!(
        "{}=; Path=/auth; HttpOnly; Secure; {}; Max-Age=0",
        cookie_name(state),
        same_site_attributes(context)
    )
}

fn same_site_attributes(context: &OriginContext) -> &'static str {
    if context.cross_site {
        "SameSite=None; Partitioned"
    } else {
        "SameSite=Strict"
    }
}
