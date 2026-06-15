// 全局错误类型。
// 严格遵循规范：
//   1. 严禁 unwrap()/expect()（本文件除外，本文件仅做类型定义）
//   2. 业务逻辑必须返回 Result<T, AppError>
//   3. 实现 From<X> 自动转换，避免上层反复 map_err
//
// 通过实现 serde::Serialize，将错误序列化到前端时直接展示 message 字段。

use serde::{Serialize, Serializer};

/// 应用统一错误枚举。
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("NCM API 错误: {0}")]
    Ncm(String),

    #[error("网络请求失败: {0}")]
    Network(#[from] reqwest::Error),

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

    #[error("内部错误: {0}")]
    Internal(String),
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