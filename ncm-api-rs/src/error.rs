/// 错误类型定义
use thiserror::Error;

#[derive(Error, Debug)]
pub enum NcmError {
    /// HTTP 请求失败（网络错误、DNS 解析失败等）
    #[error("HTTP request failed: {0}")]
    Http(#[from] reqwest::Error),

    /// API 业务错误（网易云返回非 200 状态码）
    #[error("API error (code={code}): {msg}")]
    Api { code: i64, msg: String },

    /// 需要登录（API 返回 301）
    #[error("Authentication required: {0}")]
    AuthRequired(String),

    /// 参数错误（缺少必要参数或格式不正确）
    #[error("Invalid parameter: {0}")]
    InvalidParam(String),

    /// 加密/解密错误
    #[error("Crypto error: {0}")]
    Crypto(String),

    /// JSON 序列化/反序列化错误
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    /// 请求超时
    #[error("Request timeout: {0}")]
    Timeout(String),

    /// 触发风控/限流（API 返回 503 或 IP 高频）
    #[error("Rate limited: {0}")]
    RateLimited(String),

    /// 触发上游风控（如 `song/url/v1` 返回业务码 -460）
    ///
    /// 与 [`NcmError::RateLimited`] 区分：这里是网易云判定“网络环境存在风险”
    /// 的服务端拦截，通常需要退避一段时间，而不是请求频率过高即可重试。
    ///
    /// `msg` 为空表示上游没有提供可读文案，调用方应使用 `code` 自行兜底，
    /// 而不是展示 `Unknown error` 之类的占位文本。
    #[error("Risk control (code={code}): {msg}")]
    RiskControl { code: i64, msg: String },

    /// 其他错误
    #[error("{0}")]
    Unknown(String),
}

impl NcmError {
    /// 从 API 状态码和消息构造合适的错误类型
    pub fn from_api(code: i64, msg: String) -> Self {
        match code {
            301 => NcmError::AuthRequired(if msg.is_empty() {
                "需要登录".to_string()
            } else {
                msg
            }),
            400 => NcmError::InvalidParam(msg),
            503 => NcmError::RateLimited(msg),
            -460 => NcmError::RiskControl { code, msg },
            _ => NcmError::Api { code, msg },
        }
    }
}

pub type Result<T> = std::result::Result<T, NcmError>;

#[cfg(test)]
mod tests {
    use super::*;

    /// 上游 `song/url/v1` 在超清母带等档位返回 HTTP 200 + `{"code":-460}`；
    /// 该业务码必须独立分类，不能被状态码归一逻辑夹成 400。
    #[test]
    fn from_api_maps_460_to_risk_control_and_keeps_message() {
        let message = "检测到您的网络环境存在风险，请稍后再试";
        match NcmError::from_api(-460, message.to_string()) {
            NcmError::RiskControl { code, msg } => {
                assert_eq!(code, -460);
                assert_eq!(msg, message);
            }
            other => panic!("-460 必须映射为 RiskControl，实际 {other:?}"),
        }
    }

    #[test]
    fn risk_control_display_keeps_code_and_message() {
        let error = NcmError::from_api(-460, "检测到您的网络环境存在风险，请稍后再试".to_string());
        let display = error.to_string();
        assert!(display.contains("Risk control"), "display={display}");
        assert!(display.contains("-460"), "display={display}");
        assert!(
            display.contains("检测到您的网络环境存在风险"),
            "display={display}"
        );
    }

    /// 新增风控码不能改变既有 301/400/503 映射契约。
    #[test]
    fn from_api_keeps_existing_mappings() {
        assert!(matches!(
            NcmError::from_api(301, "需要登录".to_string()),
            NcmError::AuthRequired(_)
        ));
        assert!(matches!(
            NcmError::from_api(400, "参数错误".to_string()),
            NcmError::InvalidParam(_)
        ));
        assert!(matches!(
            NcmError::from_api(503, "请求过频".to_string()),
            NcmError::RateLimited(_)
        ));
        assert!(matches!(
            NcmError::from_api(500, "服务异常".to_string()),
            NcmError::Api { code: 500, .. }
        ));
    }

    #[test]
    fn from_api_auth_required_defaults_when_message_empty() {
        match NcmError::from_api(301, String::new()) {
            NcmError::AuthRequired(msg) => assert_eq!(msg, "需要登录"),
            other => panic!("301 必须映射为 AuthRequired，实际 {other:?}"),
        }
    }
}
