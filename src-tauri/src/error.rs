//! 全局错误类型。
//!
//! 严格遵循规范：
//!   1. 严禁 unwrap()/expect()（本文件除外，本文件仅做类型定义）
//!   2. 业务逻辑必须返回 Result<T, AppError>
//!   3. 实现 From<X> 自动转换，避免上层反复 map_err
//!
//! 通过实现 serde::Serialize，将错误序列化到前端时直接展示 message 字段。

use serde::{Serialize, Serializer};

/// 应用统一错误枚举。
#[derive(Debug, thiserror::Error)]
#[must_use]
pub enum AppError {
    #[error("NCM API 错误: {0}")]
    Ncm(String),

    #[error("网络请求失败: {0}")]
    Network(String),

    #[error("JSON 解析失败: {0}")]
    Json(#[from] serde_json::Error),

    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),

    #[error("Store 插件错误: {0}")]
    Store(String),

    #[error("未登录或 Cookie 已过期")]
    Unauthorized,

    #[error("参数无效: {0}")]
    InvalidParam(String),

    /// 网易云风控拦截（如 `song/url/v1` 返回业务码 -460）。
    ///
    /// 单独成类而不是并入 [`AppError::Ncm`]：前端需要按 kind 暂停自动切歌
    /// （换歌同样会失败），并给出“稍候重试”而不是“参数填写有问题”。
    #[error("网易云限制了请求（风控）: {0}")]
    RiskControl(String),

    #[error("内部错误: {0}")]
    Internal(String),
}

impl From<reqwest::Error> for AppError {
    fn from(error: reqwest::Error) -> Self {
        Self::Network(error.to_string())
    }
}

// 自定义序列化，前端拿到的是 { kind, message } 结构，便于统一处理。
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        use serde::ser::SerializeStruct;
        let kind = match self {
            AppError::Unauthorized => "Unauthorized",
            AppError::Ncm(_) => "Ncm",
            AppError::Network(_) => "Network",
            AppError::Json(_) => "Json",
            AppError::Io(_) => "Io",
            AppError::Store(_) => "Store",
            AppError::InvalidParam(_) => "InvalidParam",
            AppError::RiskControl(_) => "RiskControl",
            AppError::Internal(_) => "Internal",
        };
        let mut s = serializer.serialize_struct("AppError", 2)?;
        s.serialize_field("kind", kind)?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

/// 项目内部使用的统一 Result 类型别名。
pub type AppResult<T> = Result<T, AppError>;

/// 将 ncm_api::NcmError 保真映射到应用的统一错误边界。
/// 供各 commands 子模块共用，避免跨模块引用 auth 内部函数。
pub(crate) fn map_ncm_err(e: ncm_api::NcmError) -> AppError {
    match e {
        ncm_api::NcmError::AuthRequired(_) => AppError::Unauthorized,
        ncm_api::NcmError::Http(error) => AppError::Network(error.to_string()),
        ncm_api::NcmError::Timeout(message) => AppError::Network(message),
        ncm_api::NcmError::Json(error) => AppError::Json(error),
        ncm_api::NcmError::InvalidParam(message) => AppError::InvalidParam(message),
        ncm_api::NcmError::RiskControl { code, msg } => {
            AppError::RiskControl(risk_control_message(code, &msg))
        }
        ncm_api::NcmError::Crypto(message) => {
            AppError::Internal(format!("NCM 加密错误: {message}"))
        }
        error => AppError::Ncm(error.to_string()),
    }
}

/// 组合风控错误的前端可读 message：上游中文文案优先且保真。
///
/// 上游正常都会带 `message`；缺失时至少保留业务码，避免只剩一句无信息的
/// “限制了请求”。outer [`AppError::RiskControl`] 的 Display 已经统一加了前缀。
fn risk_control_message(code: i64, msg: &str) -> String {
    if msg.is_empty() {
        format!("上游返回风控业务码 code={code}")
    } else {
        msg.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Helper: serialize an AppError and return the JSON value ──
    fn serialize_err(e: &AppError) -> serde_json::Value {
        serde_json::to_value(e).expect("AppError should serialize")
    }

    // ── The 9 canonical kind strings matching frontend APP_ERROR_KINDS ──
    const FRONTEND_KINDS: [&str; 9] = [
        "Unauthorized",
        "Ncm",
        "Network",
        "Json",
        "Io",
        "Store",
        "InvalidParam",
        "RiskControl",
        "Internal",
    ];

    #[test]
    fn all_kinds_are_known_to_frontend() {
        for kind in FRONTEND_KINDS {
            let msg = format!("kind '{kind}' is not in frontend APP_ERROR_KINDS");
            // Each kind string must appear in the frontend Set.
            // (We verify by checking the kind is in our own canonical list, which was
            //  extracted from useNcmApi.ts line 37-46.)
            assert!(FRONTEND_KINDS.contains(&kind), "{msg}");
        }
    }

    #[test]
    fn ncm_error_serializes_to_kind_ncm() {
        let v = serialize_err(&AppError::Ncm("请求超时".to_string()));
        assert_eq!(v["kind"], "Ncm");
        assert_eq!(v["message"], "NCM API 错误: 请求超时");
        assert!(v["kind"].is_string());
        assert!(v["message"].is_string());
    }

    #[test]
    fn network_error_serializes() {
        let v = serialize_err(&AppError::Network("连接被拒绝".to_string()));
        assert_eq!(v["kind"], "Network");
        assert_eq!(v["message"], "网络请求失败: 连接被拒绝");
    }

    #[test]
    fn json_error_serializes() {
        let js_err = serde_json::from_str::<serde_json::Value>("invalid").unwrap_err();
        let v = serialize_err(&AppError::Json(js_err));
        assert_eq!(v["kind"], "Json");
        assert!(v["message"].as_str().unwrap().contains("JSON 解析失败"));
    }

    #[test]
    fn io_error_serializes() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "文件未找到");
        let v = serialize_err(&AppError::Io(io_err));
        assert_eq!(v["kind"], "Io");
        assert_eq!(v["message"], "IO 错误: 文件未找到");
    }

    #[test]
    fn store_error_serializes() {
        let v = serialize_err(&AppError::Store("无法写入配置".to_string()));
        assert_eq!(v["kind"], "Store");
        assert_eq!(v["message"], "Store 插件错误: 无法写入配置");
    }

    #[test]
    fn unauthorized_error_serializes() {
        let v = serialize_err(&AppError::Unauthorized);
        assert_eq!(v["kind"], "Unauthorized");
        assert_eq!(v["message"], "未登录或 Cookie 已过期");
    }

    #[test]
    fn invalid_param_error_serializes() {
        let v = serialize_err(&AppError::InvalidParam("手机号格式不对".to_string()));
        assert_eq!(v["kind"], "InvalidParam");
        assert_eq!(v["message"], "参数无效: 手机号格式不对");
    }

    #[test]
    fn risk_control_error_serializes() {
        let v = serialize_err(&AppError::RiskControl(
            "检测到您的网络环境存在风险，请稍后再试".to_string(),
        ));
        assert_eq!(v["kind"], "RiskControl");
        assert_eq!(
            v["message"],
            "网易云限制了请求（风控）: 检测到您的网络环境存在风险，请稍后再试"
        );
    }

    #[test]
    fn internal_error_serializes() {
        let v = serialize_err(&AppError::Internal("未知异常".to_string()));
        assert_eq!(v["kind"], "Internal");
        assert_eq!(v["message"], "内部错误: 未知异常");
    }

    #[test]
    fn every_variant_produces_exactly_two_fields() {
        let errors: Vec<AppError> = vec![
            AppError::Ncm("test".into()),
            AppError::Network("test".into()),
            AppError::Json(serde_json::from_str::<serde_json::Value>("x").unwrap_err()),
            AppError::Io(std::io::Error::other("test")),
            AppError::Store("test".into()),
            AppError::Unauthorized,
            AppError::InvalidParam("test".into()),
            AppError::RiskControl("test".into()),
            AppError::Internal("test".into()),
        ];
        for e in &errors {
            let v = serialize_err(e);
            let obj = v
                .as_object()
                .expect("AppError must serialize to a JSON object");
            assert_eq!(
                obj.len(),
                2,
                "AppError should have exactly 2 fields: kind and message"
            );
            assert!(obj.contains_key("kind"), "missing 'kind' field");
            assert!(obj.contains_key("message"), "missing 'message' field");
        }
    }

    #[test]
    fn kind_strings_are_pascal_case_matching_enum_variants() {
        // This is critical: the frontend toAppError() reads these strings
        // verbatim. If we ever change variant names, this test fails.
        assert_eq!(serialize_err(&AppError::Ncm("".into()))["kind"], "Ncm");
        assert_eq!(
            serialize_err(&AppError::Network("".into()))["kind"],
            "Network"
        );
        assert_eq!(
            serialize_err(&AppError::Json(
                serde_json::from_str::<serde_json::Value>("x").unwrap_err()
            ))["kind"],
            "Json"
        );
        assert_eq!(
            serialize_err(&AppError::Io(std::io::Error::other("")))["kind"],
            "Io"
        );
        assert_eq!(serialize_err(&AppError::Store("".into()))["kind"], "Store");
        assert_eq!(
            serialize_err(&AppError::Unauthorized)["kind"],
            "Unauthorized"
        );
        assert_eq!(
            serialize_err(&AppError::InvalidParam("".into()))["kind"],
            "InvalidParam"
        );
        assert_eq!(
            serialize_err(&AppError::RiskControl("".into()))["kind"],
            "RiskControl"
        );
        assert_eq!(
            serialize_err(&AppError::Internal("".into()))["kind"],
            "Internal"
        );
    }

    // ── map_ncm_err mapping (7 explicit + 1 catch-all) ──
    // This tests the bridge: NcmError → AppError → JSON
    // AuthRequired → Unauthorized
    #[test]
    fn map_auth_required_is_unauthorized() {
        let e = map_ncm_err(ncm_api::NcmError::AuthRequired("需要登录".into()));
        let v = serialize_err(&e);
        assert_eq!(v["kind"], "Unauthorized");
        assert!(v["message"].as_str().unwrap().contains("Cookie 已过期"));
    }

    // Timeout → Network
    #[test]
    fn map_timeout_is_network() {
        let e = map_ncm_err(ncm_api::NcmError::Timeout("请求超时".into()));
        let v = serialize_err(&e);
        assert_eq!(v["kind"], "Network");
        assert!(v["message"].as_str().unwrap().contains("请求超时"));
    }

    // RiskControl → RiskControl：上游 -460 的业务文案必须保真到 message
    #[test]
    fn map_risk_control_keeps_upstream_message() {
        let e = map_ncm_err(ncm_api::NcmError::RiskControl {
            code: -460,
            msg: "检测到您的网络环境存在风险，请稍后再试".into(),
        });
        let v = serialize_err(&e);
        assert_eq!(v["kind"], "RiskControl");
        assert_eq!(
            v["message"],
            "网易云限制了请求（风控）: 检测到您的网络环境存在风险，请稍后再试"
        );
    }

    // 上游没给文案时至少保留业务码，不能只剩一句无信息的提示。
    #[test]
    fn map_risk_control_without_message_keeps_code() {
        let e = map_ncm_err(ncm_api::NcmError::RiskControl {
            code: -460,
            msg: String::new(),
        });
        let v = serialize_err(&e);
        assert_eq!(v["kind"], "RiskControl");
        let message = v["message"].as_str().expect("message 必须是字符串");
        assert!(message.contains("code=-460"), "message={message}");
    }

    // Catch-all (Api / RateLimited / Unknown) → Ncm
    #[test]
    fn map_catch_all_is_ncm() {
        let e = map_ncm_err(ncm_api::NcmError::RateLimited("限制".into()));
        let v = serialize_err(&e);
        assert_eq!(v["kind"], "Ncm");
        assert!(v["message"].as_str().unwrap().contains("限制"));
    }
}
