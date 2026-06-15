// commands 模块聚合。
// 业务代码按领域拆分到子模块，对外通过 use re-export 暴露。
// 该模式使得 lib.rs 中的 invoke_handler 注册保持简洁。
//
// 重要：auth 模块里的 map_ncm_err 是私有辅助函数，
// music/user 子模块通过 crate::commands::auth::map_ncm_err 路径引用。

pub mod auth;
pub mod music;
pub mod user;

// 暴露给 lib.rs 的命令函数
pub use auth::{
    get_auth_state, login_qr_check, login_qr_key, login_send_captcha, login_with_account,
    login_with_captcha, logout, save_cookie, clear_session_meta, load_session_meta,
};
pub use music::{get_daily_recommend, get_song_url, search_songs};
pub use user::{get_playlist_detail, get_user_playlists};