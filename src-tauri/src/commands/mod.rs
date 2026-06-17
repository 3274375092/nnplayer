// commands 模块聚合。
// 业务代码按领域拆分到子模块。
// lib.rs 中 generate_handler! 必须用 commands::auth::xxx 全路径注册，
// pub use 仅供 lib.rs 直接调用非 command 函数（如 load_session_meta）。
//
// 重要：map_ncm_err / map_qq_err 已移至 error.rs，各子模块通过 crate::error::* 引用。

pub mod auth;
pub mod lyric;
pub mod music;
pub mod qq_auth;
pub mod qq_music;
pub mod shared;
pub mod user;
pub mod window_geom;

pub use auth::{clear_session_meta, load_session_meta, session_to_auth};
pub use qq_auth::{load_qq_session_meta, qq_session_to_token};