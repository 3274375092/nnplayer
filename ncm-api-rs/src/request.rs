/// 请求模块 - 对应 Node.js 版本的 util/request.js
///
/// 核心功能：构造加密请求、Cookie 管理、UA 伪装
use crate::crypto;
use crate::error::{NcmError, Result};
use crate::util::config::*;
use crate::util::cookie::{cookie_obj_to_string, cookie_to_json};
use crate::util::device::{generate_device_id, generate_wnmcid, random_hex};
use crate::util::ip::generate_random_chinese_ip;

use reqwest::header::{HeaderMap, HeaderValue, COOKIE, REFERER, USER_AGENT};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::LazyLock;

/// 特殊状态码集合（视为 200）
static SPECIAL_STATUS_CODES: LazyLock<std::collections::HashSet<i64>> =
    LazyLock::new(|| [201, 302, 400, 502, 800, 801, 802, 803].into());

/// 全局设备 ID（进程生命周期内固定）
static DEVICE_ID: LazyLock<String> = LazyLock::new(generate_device_id);
/// 全局 WNMCID
static WNMCID: LazyLock<String> = LazyLock::new(generate_wnmcid);
/// Cookie Domain 移除正则（编译一次，全局复用）
static DOMAIN_REGEX: LazyLock<regex_lite::Regex> =
    LazyLock::new(|| regex_lite::Regex::new(r"\s*Domain=[^;]+;?").unwrap());

/// 安全创建 HeaderValue，无效字符会被过滤
fn header_value(s: &str) -> HeaderValue {
    HeaderValue::from_str(s).unwrap_or_else(|_| {
        // 过滤掉非 ASCII 可见字符
        let safe: String = s
            .chars()
            .filter(|c| c.is_ascii() && !c.is_ascii_control())
            .collect();
        HeaderValue::from_str(&safe).unwrap_or_else(|_| HeaderValue::from_static(""))
    })
}

/// 加密类型
#[derive(Debug, Clone, PartialEq, Default)]
pub enum CryptoType {
    Weapi,
    #[default]
    Eapi,
    Linuxapi,
    Api, // 明文
}

impl CryptoType {
    pub fn as_str(&self) -> &str {
        match self {
            CryptoType::Weapi => "weapi",
            CryptoType::Eapi => "eapi",
            CryptoType::Linuxapi => "linuxapi",
            CryptoType::Api => "api",
        }
    }
}

impl From<&str> for CryptoType {
    fn from(s: &str) -> Self {
        match s {
            "weapi" => CryptoType::Weapi,
            "linuxapi" => CryptoType::Linuxapi,
            "api" => CryptoType::Api,
            _ => CryptoType::Eapi,
        }
    }
}

/// 请求选项
#[derive(Debug, Clone, Default)]
pub struct RequestOption {
    pub crypto: CryptoType,
    pub cookie: Option<String>,
    pub ua: Option<String>,
    pub proxy: Option<String>,
    pub real_ip: Option<String>,
    pub random_cn_ip: bool,
    pub e_r: Option<bool>,
    pub domain: Option<String>,
    pub check_token: bool,
}

/// API 响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiResponse {
    pub status: i64,
    pub body: Value,
    #[serde(default)]
    pub cookie: Vec<String>,
}

/// 从响应体提取上游业务码：整数或可解析为整数的字符串。
///
/// 不能只在 100..600 内取值：风控码 -460 也必须在错误分类时保真，
/// 否则会被 `ApiResponse.status` 的合法性夹紧掩盖成 400。
fn business_code(body: &Value) -> Option<i64> {
    body.get("code").and_then(|code| {
        code.as_i64()
            .or_else(|| code.as_str().and_then(|raw| raw.parse().ok()))
    })
}

/// 由上游业务码与 HTTP 状态码推导 `ApiResponse.status`。
///
/// 保持既有语义：201/302/400/502/800-803 视为 200，其余不在 100..600
/// 的值夹紧到 400。错误分类使用 `business_code` 的原始值，不受夹紧影响。
fn response_status(raw_code: Option<i64>, http_status: i64) -> i64 {
    let mut status = raw_code.unwrap_or(http_status);
    if SPECIAL_STATUS_CODES.contains(&status) {
        status = 200;
    }
    if !(100..600).contains(&status) {
        status = 400;
    }
    status
}

/// 响应完全没给错误文案时的兜底文本。
const UNKNOWN_ERROR_MESSAGE: &str = "Unknown error";

/// 读取非空字符串字段；空串与纯空白都视为“上游没给文案”。
fn non_empty_message(value: Option<&Value>) -> Option<&str> {
    value
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty())
}

/// 提取错误文案：网易云不同接口混用 `msg` 与 `message`。
///
/// 风控响应（-460）只带 `message` 字段，只读 `msg` 会把真实中文文案丢掉；
/// 空串 / 纯空白的 `msg` 也不能遮住 `message` 里的真实文案。
fn error_message(body: &Value) -> String {
    non_empty_message(body.get("msg"))
        .or_else(|| non_empty_message(body.get("message")))
        .unwrap_or(UNKNOWN_ERROR_MESSAGE)
        .to_string()
}

/// 把非 200 响应收敛为 [`NcmError`]。
///
/// 分类优先使用上游原始业务码（例如 -460）；只有 body 完全没有业务码时
/// 才退回夹紧后的 `status`，让 301/400/503 等既有映射保持不变。
fn error_from_response(status: i64, raw_code: Option<i64>, body: &Value) -> NcmError {
    let code = raw_code.unwrap_or(status);
    let mut message = error_message(body);
    // 没有可用文案时按业务码决定兜底方式：
    // - -460：留空交给上层用业务码兜底（不能把 `Unknown error` 当上游文案）；
    // - 301：留空让 `from_api` 回落到「需要登录」默认文案；
    // - 其它错误（500/400/503 等）：保留既有 `Unknown error` 兜底展示。
    if message == UNKNOWN_ERROR_MESSAGE && (code == -460 || code == 301) {
        message.clear();
    }
    NcmError::from_api(code, message)
}

/// API 客户端
#[derive(Debug, Clone)]
pub struct ApiClient {
    pub(crate) client: reqwest::Client,
    cookie: Option<String>,
    anonymous_token: Option<String>,
    /// 自定义设备 ID，None 则使用全局默认值
    device_id: Option<String>,
}

impl ApiClient {
    /// 使用外部提供的 Client 创建 API 客户端
    pub fn new(cookie: Option<String>, client: reqwest::Client) -> Self {
        Self {
            client,
            cookie,
            anonymous_token: None,
            device_id: None,
        }
    }

    /// 设置 cookie
    pub fn set_cookie(&mut self, cookie: String) {
        self.cookie = Some(cookie);
    }

    /// 设置匿名 token
    pub fn set_anonymous_token(&mut self, token: String) {
        self.anonymous_token = Some(token);
    }

    /// 设置自定义设备 ID
    ///
    /// 不同客户端实例可使用不同设备 ID，避免共享全局 ID 触发风控
    pub fn set_device_id(&mut self, device_id: String) {
        self.device_id = Some(device_id);
    }

    /// 获取当前设备 ID（自定义优先，否则使用全局默认）
    pub(crate) fn get_device_id(&self) -> &str {
        self.device_id.as_deref().unwrap_or(&DEVICE_ID)
    }

    /// 发起 API 请求 - 核心方法
    pub async fn request(
        &self,
        uri: &str,
        data: Value,
        options: RequestOption,
    ) -> Result<ApiResponse> {
        let mut headers = HeaderMap::new();

        // IP 伪装
        let ip = options.real_ip.clone().or_else(|| {
            if options.random_cn_ip {
                Some(generate_random_chinese_ip())
            } else {
                None
            }
        });

        if let Some(ref ip) = ip {
            if let (Ok(real_ip), Ok(fwd)) = (HeaderValue::from_str(ip), HeaderValue::from_str(ip)) {
                headers.insert("X-Real-IP", real_ip);
                headers.insert("X-Forwarded-For", fwd);
            }
        }

        // Cookie 处理
        let cookie_str = options
            .cookie
            .as_deref()
            .or(self.cookie.as_deref())
            .unwrap_or("");
        let mut cookie_map = cookie_to_json(cookie_str);

        // 注入必要的 cookie 字段
        let ntes_nuid = random_hex(16);
        let os = get_os_config(cookie_map.get("os").map(|s| s.as_str()).unwrap_or("pc"));
        let now_ts = chrono::Utc::now().timestamp_millis().to_string();

        cookie_map
            .entry("__remember_me".to_string())
            .or_insert_with(|| "true".to_string());
        cookie_map
            .entry("ntes_kaola_ad".to_string())
            .or_insert_with(|| "1".to_string());
        cookie_map
            .entry("_ntes_nnid".to_string())
            .or_insert_with(|| format!("{},{}", ntes_nuid, now_ts));
        cookie_map
            .entry("_ntes_nuid".to_string())
            .or_insert(ntes_nuid);
        cookie_map
            .entry("WNMCID".to_string())
            .or_insert_with(|| WNMCID.clone());
        cookie_map
            .entry("WEVNSM".to_string())
            .or_insert_with(|| "1.0.0".to_string());
        cookie_map
            .entry("osver".to_string())
            .or_insert_with(|| os.osver.to_string());
        cookie_map
            .entry("deviceId".to_string())
            .or_insert_with(|| self.get_device_id().to_string());
        cookie_map
            .entry("os".to_string())
            .or_insert_with(|| os.os.to_string());
        cookie_map
            .entry("channel".to_string())
            .or_insert_with(|| os.channel.to_string());
        cookie_map
            .entry("appver".to_string())
            .or_insert_with(|| os.appver.to_string());

        // 非登录接口注入 NMTID
        if !uri.contains("login") {
            cookie_map
                .entry("NMTID".to_string())
                .or_insert_with(|| random_hex(8));
        }

        // 未登录时注入匿名 token
        if !cookie_map.contains_key("MUSIC_U") {
            if let Some(ref token) = self.anonymous_token {
                cookie_map
                    .entry("MUSIC_A".to_string())
                    .or_insert_with(|| token.clone());
            }
        }

        headers.insert(COOKIE, header_value(&cookie_obj_to_string(&cookie_map)));

        // 确定加密方式
        let crypto_type = if options.crypto == CryptoType::Eapi && !ENCRYPT {
            CryptoType::Api
        } else {
            options.crypto.clone()
        };

        let mut data = data;
        let url: String;
        let encrypt_data: HashMap<String, String>;
        let domain = options.domain.as_deref().unwrap_or("");

        let csrf_token = cookie_map.get("__csrf").cloned().unwrap_or_default();

        match crypto_type {
            CryptoType::Weapi => {
                let ref_domain = if domain.is_empty() { DOMAIN } else { domain };
                headers.insert(REFERER, header_value(ref_domain));
                let ua = options
                    .ua
                    .as_deref()
                    .unwrap_or_else(|| choose_user_agent("weapi", "pc"));
                headers.insert(USER_AGENT, header_value(ua));

                if !data.is_object() {
                    return Err(crate::error::NcmError::InvalidParam(
                        "request data must be a JSON object".into(),
                    ));
                }
                data["csrf_token"] = Value::String(csrf_token);
                encrypt_data = crypto::weapi(&data)?;
                let path = uri.strip_prefix("/api/").ok_or_else(|| {
                    crate::error::NcmError::InvalidParam("weapi URI must start with /api/".into())
                })?;
                url = format!("{}/weapi/{}", ref_domain, path);
            }
            CryptoType::Linuxapi => {
                let ua = options
                    .ua
                    .as_deref()
                    .unwrap_or_else(|| choose_user_agent("linuxapi", "linux"));
                headers.insert(USER_AGENT, header_value(ua));

                let ref_domain = if domain.is_empty() { DOMAIN } else { domain };
                let linux_data = serde_json::json!({
                    "method": "POST",
                    "url": format!("{}{}", ref_domain, uri),
                    "params": data,
                });
                encrypt_data = crypto::linuxapi(&linux_data)?;
                url = format!("{}/api/linux/forward", ref_domain);
            }
            CryptoType::Eapi | CryptoType::Api => {
                // 构造 eapi header cookie
                let now_secs = chrono::Utc::now().timestamp().to_string();
                let request_id = format!(
                    "{}_{:04}",
                    chrono::Utc::now().timestamp_millis(),
                    rand::random::<u16>() % 1000
                );

                let mut header_map: HashMap<String, String> = HashMap::new();
                header_map.insert(
                    "osver".to_string(),
                    cookie_map.get("osver").cloned().unwrap_or_default(),
                );
                header_map.insert(
                    "deviceId".to_string(),
                    cookie_map.get("deviceId").cloned().unwrap_or_default(),
                );
                header_map.insert(
                    "os".to_string(),
                    cookie_map.get("os").cloned().unwrap_or_default(),
                );
                header_map.insert(
                    "appver".to_string(),
                    cookie_map.get("appver").cloned().unwrap_or_default(),
                );
                header_map.insert(
                    "versioncode".to_string(),
                    cookie_map
                        .get("versioncode")
                        .cloned()
                        .unwrap_or_else(|| "140".to_string()),
                );
                header_map.insert(
                    "mobilename".to_string(),
                    cookie_map.get("mobilename").cloned().unwrap_or_default(),
                );
                header_map.insert(
                    "buildver".to_string(),
                    cookie_map
                        .get("buildver")
                        .cloned()
                        .unwrap_or_else(|| now_secs[..10].to_string()),
                );
                header_map.insert(
                    "resolution".to_string(),
                    cookie_map
                        .get("resolution")
                        .cloned()
                        .unwrap_or_else(|| "1920x1080".to_string()),
                );
                header_map.insert("__csrf".to_string(), csrf_token.clone());
                header_map.insert(
                    "channel".to_string(),
                    cookie_map.get("channel").cloned().unwrap_or_default(),
                );
                header_map.insert("requestId".to_string(), request_id);

                if options.check_token {
                    header_map.insert("X-antiCheatToken".to_string(), CHECK_TOKEN.to_string());
                }

                if let Some(music_u) = cookie_map.get("MUSIC_U") {
                    header_map.insert("MUSIC_U".to_string(), music_u.clone());
                }
                if let Some(music_a) = cookie_map.get("MUSIC_A") {
                    header_map.insert("MUSIC_A".to_string(), music_a.clone());
                }

                let header_cookie_str = header_map
                    .iter()
                    .map(|(k, v)| format!("{}={}", urlencoding::encode(k), urlencoding::encode(v)))
                    .collect::<Vec<_>>()
                    .join("; ");

                headers.insert(COOKIE, header_value(&header_cookie_str));

                let ua = options
                    .ua
                    .as_deref()
                    .unwrap_or_else(|| choose_user_agent("api", "iphone"));
                headers.insert(USER_AGENT, header_value(ua));

                let api_domain = if domain.is_empty() {
                    API_DOMAIN
                } else {
                    domain
                };

                if crypto_type == CryptoType::Eapi {
                    // 注入 header 和 e_r
                    let header_value = serde_json::to_value(&header_map)?;
                    if !data.is_object() {
                        return Err(crate::error::NcmError::InvalidParam(
                            "request data must be a JSON object".into(),
                        ));
                    }
                    data["header"] = header_value;

                    let e_r = options.e_r.unwrap_or(ENCRYPT_RESPONSE);
                    data["e_r"] = Value::Bool(e_r);

                    encrypt_data = crypto::eapi(uri, &data)?;
                    let path = uri.strip_prefix("/api/").ok_or_else(|| {
                        crate::error::NcmError::InvalidParam(
                            "eapi URI must start with /api/".into(),
                        )
                    })?;
                    url = format!("{}/eapi/{}", api_domain, path);
                } else {
                    // api 明文
                    encrypt_data = if let Value::Object(map) = &data {
                        map.iter()
                            .map(|(k, v)| {
                                (
                                    k.clone(),
                                    match v {
                                        Value::String(s) => s.clone(),
                                        _ => v.to_string(),
                                    },
                                )
                            })
                            .collect()
                    } else {
                        HashMap::new()
                    };
                    url = format!("{}{}", api_domain, uri);
                }
            }
        }

        // 构造 POST body
        let body = serde_urlencoded::to_string(&encrypt_data)
            .map_err(|e| NcmError::Unknown(e.to_string()))?;

        // 设置 Content-Type
        headers.insert(
            reqwest::header::CONTENT_TYPE,
            HeaderValue::from_static("application/x-www-form-urlencoded"),
        );

        if options.proxy.is_some() {
            return Err(NcmError::Unknown(
                "proxy is no longer supported, configure proxy in the Client upfront".to_string(),
            ));
        }

        let response = self
            .client
            .post(&url)
            .headers(headers)
            .body(body)
            .send()
            .await?;

        // 处理响应 cookie
        let resp_cookies: Vec<String> = response
            .headers()
            .get_all("set-cookie")
            .iter()
            .filter_map(|v| v.to_str().ok())
            .map(|s| {
                // 移除 Domain 属性
                DOMAIN_REGEX.replace_all(s, "").to_string()
            })
            .collect();

        // 解析响应体：e_r 必须与请求侧使用同一默认值，否则会把明文当密文解析
        let e_r = options.e_r.unwrap_or(ENCRYPT_RESPONSE);
        let status_code = response.status().as_u16() as i64;

        let body: Value = if crypto_type == CryptoType::Eapi && e_r {
            let bytes = response.bytes().await?;
            let hex_str = hex::encode_upper(&bytes);
            crypto::eapi_res_decrypt(&hex_str)
                .ok_or_else(|| NcmError::Crypto("failed to decrypt eapi response".to_string()))?
        } else {
            let text = response.text().await?;
            serde_json::from_str(&text).unwrap_or(Value::String(text))
        };

        // 原始业务码用于错误分类（-460 等风控码不能被夹紧成 400）；
        // ApiResponse.status 仍保持“特殊码视为 200 + 100..600 夹紧”的既有语义。
        let raw_code = business_code(&body);
        let status = response_status(raw_code, status_code);

        let answer = ApiResponse {
            status,
            body,
            cookie: resp_cookies,
        };

        if status == 200 {
            Ok(answer)
        } else {
            Err(error_from_response(status, raw_code, &answer.body))
        }
    }
}

#[cfg(test)]
mod crypto_default_tests {
    use super::*;

    /// 上游 `util/request.js` 对未指定 crypto 的模块取配置默认值：
    /// `APP_CONF.encrypt ? 'eapi' : 'api'`，而 `util/config.json` 是 `encrypt: true`。
    /// 也就是说"不显式传 crypto"必须解析成 **Eapi**；只有上游显式写
    /// `createOption(query, 'weapi')` 的模块才该用 Weapi。
    ///
    /// 这条断言是给 2026-09 那次批量修改立的护栏：当时把 123 处
    /// `CryptoType::default()` 机械改成了 `Weapi`，导致这些接口整体换到了
    /// weapi 通道（host、加密方式、header/e_r 注入全部不同）。
    #[test]
    fn unspecified_crypto_matches_upstream_default() {
        assert_eq!(CryptoType::default(), CryptoType::Eapi);
        assert_eq!(CryptoType::from(""), CryptoType::Eapi);
        assert!(
            ENCRYPT,
            "APP_CONF.encrypt 为 true，未指定 crypto 时必须是 eapi"
        );
    }
}

#[cfg(test)]
mod error_classification_tests {
    use super::*;
    use serde_json::json;

    fn risk_control_body() -> Value {
        json!({
            "code": -460,
            "message": "检测到您的网络环境存在风险，请稍后再试"
        })
    }

    /// 按 `request()` 的真实分类链路把响应体收敛为错误。
    fn error_for(body: &Value) -> NcmError {
        let raw_code = business_code(body);
        error_from_response(response_status(raw_code, 200), raw_code, body)
    }

    #[test]
    fn business_code_reads_negative_integer() {
        assert_eq!(business_code(&json!({ "code": -460 })), Some(-460));
    }

    #[test]
    fn business_code_parses_numeric_string() {
        assert_eq!(business_code(&json!({ "code": "-460" })), Some(-460));
    }

    #[test]
    fn business_code_ignores_missing_null_and_non_numeric() {
        assert_eq!(business_code(&json!({})), None);
        assert_eq!(business_code(&json!({ "code": null })), None);
        assert_eq!(business_code(&json!({ "code": "oops" })), None);
    }

    #[test]
    fn error_message_prefers_msg_over_message() {
        let body = json!({ "msg": "msg 文案", "message": "message 文案" });
        assert_eq!(error_message(&body), "msg 文案");
    }

    /// 风控响应只带 `message` 字段，文案必须保真，不能丢成 Unknown error。
    #[test]
    fn error_message_falls_back_to_message() {
        assert_eq!(
            error_message(&risk_control_body()),
            "检测到您的网络环境存在风险，请稍后再试"
        );
    }

    #[test]
    fn error_message_defaults_to_unknown() {
        assert_eq!(error_message(&json!({ "code": -460 })), "Unknown error");
        assert_eq!(
            error_message(&json!({ "code": -460, "msg": "", "message": "   " })),
            "Unknown error"
        );
    }

    /// 空的 `msg` 不能遮住 `message`：风控文案只带 `message` 时必须保真。
    #[test]
    fn error_message_skips_blank_msg_and_uses_message() {
        for blank in ["", "   "] {
            let body = json!({
                "code": -460,
                "msg": blank,
                "message": "检测到您的网络环境存在风险",
            });
            assert_eq!(error_message(&body), "检测到您的网络环境存在风险");
        }
    }

    #[test]
    fn response_status_clamps_risk_control_code_to_400() {
        assert_eq!(response_status(Some(-460), 200), 400);
    }

    #[test]
    fn response_status_keeps_legacy_special_codes_as_200() {
        for code in [201, 302, 400, 502, 800, 801, 802, 803] {
            assert_eq!(
                response_status(Some(code), 200),
                200,
                "特殊码 {code} 必须视为 200"
            );
        }
        // body 没有业务码时也按 HTTP 状态码走同一套特殊码语义。
        assert_eq!(response_status(None, 502), 200);
    }

    #[test]
    fn response_status_keeps_in_range_codes_and_http_fallback() {
        assert_eq!(response_status(Some(301), 200), 301);
        assert_eq!(response_status(Some(503), 200), 503);
        assert_eq!(response_status(None, 500), 500);
    }

    /// 端到端（纯函数层）复现真实响应：HTTP 200 + code -460 + message。
    #[test]
    fn risk_control_response_classifies_as_risk_control() {
        let body = risk_control_body();
        let raw_code = business_code(&body);
        let status = response_status(raw_code, 200);
        let error = error_from_response(status, raw_code, &body);
        match error {
            NcmError::RiskControl { code, msg } => {
                assert_eq!(code, -460);
                assert_eq!(msg, "检测到您的网络环境存在风险，请稍后再试");
            }
            other => panic!("-460 必须映射为 RiskControl，实际 {other:?}"),
        }
    }

    #[test]
    fn response_without_business_code_keeps_existing_mapping() {
        let body = json!({ "msg": "服务器开小差了" });
        let raw_code = business_code(&body);
        let status = response_status(raw_code, 500);
        let error = error_from_response(status, raw_code, &body);
        match error {
            NcmError::Api { code, msg } => {
                assert_eq!(code, 500);
                assert_eq!(msg, "服务器开小差了");
            }
            other => panic!("无业务码的 HTTP 500 应映射为 Api，实际 {other:?}"),
        }
    }

    /// -460 没有任何可用文案时 `msg` 必须留空：上层 `AppError::RiskControl` 会用
    /// 业务码兜底，不能把 `Unknown error` 哨兵当上游文案展示给用户。
    #[test]
    fn risk_control_without_message_leaves_msg_empty_for_upper_layer() {
        for body in [
            json!({ "code": -460 }),
            json!({ "code": -460, "msg": "" }),
            json!({ "code": -460, "msg": "   ", "message": "  " }),
        ] {
            match error_for(&body) {
                NcmError::RiskControl { code, msg } => {
                    assert_eq!(code, -460);
                    assert!(msg.is_empty(), "无文案时应留空交上层兜底，实际 msg={msg}");
                }
                other => panic!("-460 必须映射为 RiskControl，实际 {other:?}"),
            }
        }
    }

    /// 未知的越界业务码不再被夹成 400/InvalidParam：`ApiResponse.status` 仍按
    /// 既有语义夹紧，但错误分类必须保真原始码，便于前端按业务码诊断。
    #[test]
    fn out_of_range_unknown_code_is_preserved_in_error() {
        let body = json!({ "code": 10004, "msg": "未知业务码" });
        let raw_code = business_code(&body);
        assert_eq!(raw_code, Some(10004));
        let status = response_status(raw_code, 200);
        assert_eq!(status, 400, "status 仍按既有语义夹紧到 400");
        match error_from_response(status, raw_code, &body) {
            NcmError::Api { code, msg } => {
                assert_eq!(code, 10004, "错误分类必须保真原始业务码");
                assert_eq!(msg, "未知业务码");
            }
            other => panic!("未知越界码应保真为 Api，实际 {other:?}"),
        }
    }

    // ── 无可用文案时的兜底：301 默认文案不能被 `Unknown error` 哨兵顶掉 ──

    /// 301 没有任何可用文案时必须回落到 [`NcmError::from_api`] 的「需要登录」
    /// 默认：`Unknown error` 只是内部哨兵，不能变成 AuthRequired 的文案。
    #[test]
    fn auth_required_without_usable_message_keeps_default_copy() {
        for body in [
            json!({ "code": 301 }),
            json!({ "code": 301, "msg": "" }),
            json!({ "code": 301, "msg": "   " }),
            json!({ "code": 301, "message": "" }),
        ] {
            match error_for(&body) {
                NcmError::AuthRequired(message) => {
                    assert_eq!(message, "需要登录", "body={body}");
                }
                other => panic!("301 必须映射为 AuthRequired，实际 {other:?}"),
            }
        }
    }

    /// 空的 `msg` 不能遮住 `message`：301 也应优先使用真实上游文案。
    #[test]
    fn auth_required_uses_real_message_field_when_msg_blank() {
        let body = json!({ "code": 301, "msg": "", "message": "登录状态失效" });
        match error_for(&body) {
            NcmError::AuthRequired(message) => assert_eq!(message, "登录状态失效"),
            other => panic!("301 必须映射为 AuthRequired，实际 {other:?}"),
        }
    }

    /// 只有 301/-460 在无文案时留空兜底；其它错误必须保持既有 `Unknown error`
    /// 展示与分类，不能因为修复 301 而改变（500 无文案是既有行为基线）。
    #[test]
    fn missing_message_fallback_is_unchanged_for_non_auth_codes() {
        match error_for(&json!({ "code": 500 })) {
            NcmError::Api { code, msg } => {
                assert_eq!(code, 500);
                assert_eq!(msg, "Unknown error");
            }
            other => panic!("500 无文案应保留 Api/Unknown error，实际 {other:?}"),
        }
        match error_for(&json!({ "code": 400 })) {
            NcmError::InvalidParam(msg) => assert_eq!(msg, "Unknown error"),
            other => panic!("400 无文案应保留 InvalidParam/Unknown error，实际 {other:?}"),
        }
        match error_for(&json!({ "code": 503 })) {
            NcmError::RateLimited(msg) => assert_eq!(msg, "Unknown error"),
            other => panic!("503 无文案应保留 RateLimited/Unknown error，实际 {other:?}"),
        }
    }

    /// 非空上游文案（400/503）必须原样保留，不能被兜底逻辑改写。
    #[test]
    fn non_blank_message_is_preserved_for_invalid_param_and_rate_limit() {
        match error_for(&json!({ "code": 400, "msg": "参数错误" })) {
            NcmError::InvalidParam(msg) => assert_eq!(msg, "参数错误"),
            other => panic!("400 非空文案必须保留，实际 {other:?}"),
        }
        match error_for(&json!({ "code": 503, "msg": "请求过频" })) {
            NcmError::RateLimited(msg) => assert_eq!(msg, "请求过频"),
            other => panic!("503 非空文案必须保留，实际 {other:?}"),
        }
    }
}
