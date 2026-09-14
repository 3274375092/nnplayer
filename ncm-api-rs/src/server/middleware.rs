/// 中间件配置 - CORS 和限流
use axum::http::{HeaderValue, Method};
use tower_http::cors::{AllowOrigin, Any, CorsLayer};

/// 创建 CORS 中间件层
///
/// - `origin`: 允许的 Origin，None 表示允许所有
pub fn cors_layer(origin: Option<&str>) -> CorsLayer {
    let layer = CorsLayer::new()
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers(Any)
        .allow_credentials(false);

    match origin {
        Some(o) => {
            if let Ok(val) = o.parse::<HeaderValue>() {
                layer
                    .allow_credentials(true)
                    .allow_origin(AllowOrigin::exact(val))
            } else {
                tracing::warn!("Invalid CORS origin configuration; denying cross-origin requests");
                layer.allow_origin(AllowOrigin::list(Vec::<HeaderValue>::new()))
            }
        }
        None => layer.allow_origin(Any),
    }
}

// ============================================================
//  简易限流中间件
// ============================================================

use axum::extract::ConnectInfo;
use axum::http::{Request, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use serde_json::json;
use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

/// 限流器内部状态
#[derive(Default)]
struct LimiterState {
    /// IP -> (请求计数, 窗口起始时间)
    entries: HashMap<String, (u64, Instant)>,
    /// 上一次全量清理过期条目的时间
    last_sweep: Option<Instant>,
}

/// 限流器状态
#[derive(Clone)]
pub struct RateLimiter {
    state: Arc<Mutex<LimiterState>>,
    /// 时间窗口内最大请求数
    max_requests: u64,
    /// 时间窗口（秒）
    window_secs: u64,
}

impl RateLimiter {
    /// 创建限流器
    ///
    /// - `max_requests`: 时间窗口内允许的最大请求数
    /// - `window_secs`: 时间窗口秒数
    pub fn new(max_requests: u64, window_secs: u64) -> Self {
        Self {
            state: Arc::new(Mutex::new(LimiterState::default())),
            max_requests,
            window_secs,
        }
    }

    /// 检查是否允许请求，返回 true 表示放行
    async fn check(&self, ip: &str) -> bool {
        let mut state = self.state.lock().await;
        let now = Instant::now();
        let window = Duration::from_secs(self.window_secs);

        // 每个窗口最多做一次全量清理；否则条目只在同一 IP 再次出现时才重置，
        // 大量不同来源 IP 会让 HashMap 无限增长（内存耗尽型 DoS）。
        let need_sweep = match state.last_sweep {
            None => true,
            Some(last) => now.duration_since(last) >= window,
        };
        if need_sweep {
            state
                .entries
                .retain(|_, (_, started)| now.duration_since(*started) < window);
            state.last_sweep = Some(now);
        }

        let entry = state.entries.entry(ip.to_string()).or_insert((0, now));

        // 窗口过期，重置计数
        if now.duration_since(entry.1) >= window {
            entry.0 = 0;
            entry.1 = now;
        }

        entry.0 += 1;
        entry.0 <= self.max_requests
    }
}

/// 直连方是否为本机/内网地址（即受信任的反向代理）
fn is_trusted_proxy(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_loopback() || v4.is_private() || v4.is_link_local(),
        IpAddr::V6(v6) => v6.is_loopback() || v6.is_unique_local() || v6.is_unicast_link_local(),
    }
}

/// 限流中间件处理函数
///
/// 用法：
/// ```ignore
/// let limiter = RateLimiter::new(120, 60); // 每分钟 120 次
/// app.layer(axum::middleware::from_fn_with_state(limiter, rate_limit_middleware))
/// ```
pub async fn rate_limit_middleware(
    axum::extract::State(limiter): axum::extract::State<RateLimiter>,
    req: Request<axum::body::Body>,
    next: Next,
) -> Response {
    let peer = req
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ci| ci.0);

    // 只取第一个非空条目：空 header 不能短路掉 ConnectInfo 回退
    let forwarded = req
        .headers()
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').map(|p| p.trim()).find(|p| !p.is_empty()))
        .map(|s| s.to_string());

    // X-Forwarded-For 可被客户端伪造，只有直连方是受信任代理时才采信，
    // 否则攻击者可以不断变换该头绕过限流。
    let ip = match (peer, forwarded) {
        (Some(addr), Some(fwd)) if is_trusted_proxy(&addr.ip()) => fwd,
        (Some(addr), _) => addr.ip().to_string(),
        (None, Some(fwd)) => fwd,
        (None, None) => "unknown".to_string(),
    };

    if !limiter.check(&ip).await {
        tracing::warn!("Rate limited: {}", ip);
        return (
            StatusCode::TOO_MANY_REQUESTS,
            axum::Json(json!({
                "code": 429,
                "msg": "Too many requests, please slow down",
            })),
        )
            .into_response();
    }

    next.run(req).await
}
