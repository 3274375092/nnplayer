# Cow 重构说明（commit 3f32689）

> 2026-08-17 · `refactor(rust): use Cow to avoid needless string allocations`
> 改动范围：20 个文件，+66 / -44。`ncm-api-rs` 7 个测试、`src-tauri` 62 个测试全部通过，clippy 无警告。

## 一句话总结

把"每次都分配新 String"的几处热路径改成 `std::borrow::Cow`：能借用就借用，只有真正需要拥有时才分配。返回值、序列化结果与之前完全一致，只是少了不必要的堆分配。

---

## 1. `Query::get_or`（ncm-api-rs/src/api/mod.rs）— 最大的一块

### 改了哪

```rust
// 改前：无论参数是否存在，必然分配一次
pub fn get_or(&self, key: &str, default: &str) -> String {
    self.params.get(key).cloned()
        .unwrap_or_else(|| default.to_string())
}

// 改后：两种情况都是借用，零分配
pub fn get_or<'a>(&'a self, key: &str, default: &'a str) -> Cow<'a, str> {
    match self.params.get(key) {
        Some(v) => Cow::Borrowed(v.as_str()),   // 借用 Query 里的参数
        None    => Cow::Borrowed(default),      // 借用静态默认值
    }
}
```

### 为什么改

`get_or` 是全库被调用最多的辅助函数（600+ 处、覆盖全部 ~280 个 API 方法文件）。每个接口方法构造请求体时都会调它好几次，**每次调用都产生一次堆分配**：

- 参数已设置 → `cloned()` 克隆整个 String
- 参数未设置 → `default.to_string()` 重新造一个

### 改完后会发生什么

- **零分配**：无论走哪条分支都不再分配。按一个接口方法平均 5~10 次 `get_or` 算，每次 NCM API 请求省 5~10 次堆分配。
- **调用点几乎全自动兼容**，因为 `Cow<str>` 会自动"扮演" `&str`：
  - `json!(query.get_or(...))` → `Cow` 实现 `Serialize`
  - `format!(... {})` → `Cow` 实现 `Display`
  - `.parse::<i64>()` → deref 到 `str` 后正常调用
  - `== "1"` 比较 → `Cow` 实现 `PartialEq<&str>`
- **必须跟着改的调用点**（编译错误暴露，全部已修）：
  - `artist_new_mv.rs` / `artist_new_song.rs`：默认值是临时 String（`chrono` 时间戳），借用不能逃逸语句 → 补 `.into_owned()`
  - 13 个文件共 15 处 `.as_str()` → `.as_ref()`：`Cow` 上没有 `.as_str()`，会解析到 unstable 的 `str::as_str`
  - `comment_new.rs`：`match` 分支里混了 `String` 和 `Cow` → 补 `.into_owned()`
  - `avatar_upload.rs`：`reqwest` header 不接受 `&Cow` → 改 `img_mimetype.as_ref()`

---

## 2. `AppState::response_message`（src-tauri/src/state.rs）

### 改了哪

```rust
// 改前：每次 to_string() 分配一次
pub fn response_message(resp: &ApiResponse) -> String { ... .to_string() }

// 改后：借用响应体，或借用静态 "Unknown error"
pub fn response_message(resp: &ApiResponse) -> Cow<'_, str> { ... }
```

### 为什么改

这个函数在**每条错误路径**上都会被调用（`ensure_business_success`、登录失败、歌单读取失败等），原来每次都把响应体里的 `msg` 复制成新 String，纯粹为了拼进 `format!` 或返回给前端。

### 改完后会发生什么

- 错误路径不再分配；`format!("...: {}", response_message(resp))` 直接格式化借用内容。
- **附带修复了 `login_qr_check` 的双重分配**：

```rust
// 改前：分支各自 .to_string()，最后 message.to_string() 又复制一次 → 两次分配
message: message.to_string(),
// 改后：分支返回 Cow::Borrowed 静态串，最后只 into_owned() 一次
message: message.into_owned(),
```

- 测试里的 `assert_eq!(response_message(&resp), "密码错误")` 自动兼容（`Cow` 实现 `PartialEq<&str>`）。

---

## 3. `AppState::cookie`（src-tauri/src/state.rs）

### 改了哪

```rust
// 改前
pub async fn cookie(&self) -> String {
    self.auth.lock().await.cookie.clone().unwrap_or_default()
}
// 改后
pub async fn cookie(&self) -> Cow<'static, str> {
    self.auth.lock().await.cookie.clone()
        .map(Cow::Owned)
        .unwrap_or(Cow::Borrowed(""))
}
```

### 为什么改

每个业务命令（搜索、每日推荐、歌词、歌单……）都要拿 cookie 拼进请求。未登录时原来会造一个空 `String`，随后 `Query::cookie(&str)` 再把它克隆进 `Query`，白白分配；改后借用 `""` 静态串，`Query::cookie` 得到的空串克隆不触发堆分配（空 String 不占堆）。

### 改完后会发生什么

- 7 个调用点（`music.rs` ×4、`user.rs` ×2、`lyric.rs` ×1）**一行未改**：`&cookie` 传 `&str` 参数时 deref 自动转换。
- 有 cookie 时行为不变（仍是 1 次克隆，因为要跨锁返回）。

---

## 4. `normalize_avatar_url`（src-tauri/src/commands/auth.rs）

### 改了哪

```rust
// 改前：完整 URL 也要 s.to_string() 复制一遍
pub fn normalize_avatar_url(raw: &str) -> Option<String> { ... Some(s.to_string()) ... }
// 改后：完整 URL 零拷贝借用，只有 //xxx、/xxx、相对路径才构造
pub fn normalize_avatar_url(raw: &str) -> Option<Cow<'_, str>> {
    // "https://..." → Cow::Borrowed(s)   ← 最常见情况，不再分配
    // "//p1..."     → Cow::Owned(format!("https://{rest}"))
    // ...
}
```

### 为什么改

登录和启动恢复会话时都会规整头像 URL。绝大多数情况 NCM 返回的就是完整 `https://` URL，原来的实现却每次无条件 `to_string()` 复制一遍；还导致后续 `auth.avatar_url`、`LoginResult` 各再克隆一次。

### 改完后会发生什么

- 完整 URL 情况零分配；只有需要补 scheme 时才 `Owned`。
- 调用点适配（已改）：
  - `extract_profile`：返回元组第三项类型变为 `Option<Cow<'_, str>>`
  - `finalize_login` / `save_cookie`：写入 `auth.avatar_url`（`Option<String>`）和 `LoginResult` 时 `.map(|c| c.into_owned())`
  - `lib.rs::restore_session`：`.or_else(|| record.avatar_url.clone().map(Cow::Owned))` 后统一 `.map(|c| c.into_owned())`

---

## 改完后整体会发生什么

| 观察点 | 结果 |
|---|---|
| 对外行为 | **完全不变**：返回值、JSON 序列化、错误 message 与改前一致 |
| 性能 | 每次 NCM API 请求省 5~10 次堆分配；错误路径、登录/恢复会话路径不再做多余复制 |
| 编译 | `Query::get_or` 返回类型是破坏性变更（`String` → `Cow<'_, str>`），本仓库全部调用点已适配；仓库外的使用者若需要 owned 结果，用 `.into_owned()` 即可 |
| 测试 | `ncm-api-rs` 7 个、`src-tauri` 62 个全部通过；clippy 零警告 |
| 前置条件 | `str::as_str` 是 unstable API，所以对 `Cow` 取 `&str` 要用 `.as_ref()` / `&*x` 而不是 `.as_str()` |

## 为什么这些地方没改

- **`models.rs` 的 DTO**（`Song` / `Playlist` / `LyricResult` 等）：数据源是 `serde_json::Value`（本身 owned），且 `Song` 要活得比 HTTP 响应长；用 `Cow` 只会引入 lifetime 噪音，零收益。
- **`Query.params`**（`HashMap<String, String>`）、**`merge_cookie`**、**`SessionRecord`**：要么存储结构本身必须 owned，要么需要跨作用域存活 / 写盘，`Cow` 不适用。

## 备注：未提交的附带修复

跑测试时发现 `load_session_meta_with_corrupt_files_returns_none` 偶发失败——两个文件夹具测试并行写同一个 `session.toml` 的**既有竞态**（与本次改动无关，单独跑必过）。已在工作区加了 `SESSION_FILE_LOCK` 串行化修复，该修复与仓库其他未提交的 WIP 一起保留在 `src-tauri/src/commands/auth.rs` 中，提交 WIP 时会一并带上。
