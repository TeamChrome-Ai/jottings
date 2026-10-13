use axum::{http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::json;

#[derive(Debug)]
pub struct ApiError { pub status: u16, pub message: String }
impl ApiError {
    pub fn new(status: u16, m: impl Into<String>) -> Self { Self { status, message: m.into() } }
    pub fn bad(m: impl Into<String>) -> Self { Self::new(400, m) }
    pub fn not_found(m: impl Into<String>) -> Self { Self::new(404, m) }
    pub fn forbidden(m: impl Into<String>) -> Self { Self::new(403, m) }
    pub fn internal(m: impl Into<String>) -> Self { Self::new(500, m) }
}
impl From<rusqlite::Error> for ApiError { fn from(e: rusqlite::Error) -> Self { tracing::error!("sqlite: {e}"); Self::internal("database error") } }
impl From<r2d2::Error> for ApiError { fn from(e: r2d2::Error) -> Self { tracing::error!("pool: {e}"); Self::internal("database busy") } }
impl From<anyhow::Error> for ApiError { fn from(e: anyhow::Error) -> Self { tracing::error!("{e:#}"); Self::internal("server error") } }
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let code = StatusCode::from_u16(self.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        (code, Json(json!({ "error": self.message }))).into_response()
    }
}
pub type ApiResult<T> = Result<T, ApiError>;
