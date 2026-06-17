// commands 模块聚合。
// 业务代码按领域拆分到子模块。
// lib.rs 中 generate_handler! 必须用 commands::auth::xxx 全路径注册，
// pub use 仅供 lib.rs 直接调用非 command 函数（如 load_session_meta）。
//
// 重要：map_ncm_err 已移至 error.rs，各子模块通过 crate::error::map_ncm_err 引用。

pub mod audio;
pub mod auth;
pub mod local_music;
pub mod lyric;
pub mod music;
pub mod user;
pub mod window_geom;

pub use auth::{clear_session_meta, load_session_meta, session_to_auth};