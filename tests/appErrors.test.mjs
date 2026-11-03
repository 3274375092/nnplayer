// appErrors 错误映射契约测试：只校验「用户语言 + 恢复动作 + 可折叠技术详情」，
// 不依赖 Vue / Tauri / 路由运行时（transpile 后以 data URL 加载纯 TS 模块）。

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function compile(relativePath) {
  const sourceUrl = new URL(relativePath, import.meta.url);
  const source = await readFile(sourceUrl, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: sourceUrl.pathname,
  }).outputText;
  return `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
}

const appErrorsUrl = await compile("../src/utils/appErrors.ts");
const {
  describeAppError,
  describePlaybackFailure,
  describeInputError,
  describeLoginError,
} = await import(appErrorsUrl);

/** 模拟 useNcmApi.AppError：保留后端 kind 的 Error 实例。 */
function backendError(kind, message) {
  return Object.assign(new Error(message), { name: "AppError", kind });
}

/** 引擎 PlaybackFailure 的最小构造器（与 playbackEngine.ts 字段保持一致）。 */
function playbackFailure(overrides = {}) {
  return {
    revision: 1,
    songId: 7,
    songName: "晴天",
    stage: "load",
    kind: null,
    message: "",
    failCount: 1,
    stopped: false,
    recentSongNames: [],
    wasPlaying: true,
    ...overrides,
  };
}

// =============== describeAppError：后端 kind → 用户语言 ===============

test("Network kind：检查网络 + 可重试，原文只进技术详情", () => {
  const described = describeAppError(
    backendError("Network", "网络请求失败: 连接被拒绝"),
  );
  assert.equal(described.category, "network");
  assert.equal(described.title, "网络连接失败");
  assert.match(described.hint, /检查网络连接后重试/);
  assert.equal(described.retryable, true);
  assert.equal(described.relogin, false);
  assert.equal(described.detail, "Network · 网络请求失败: 连接被拒绝");
});

test("Ncm kind：接口暂时不可用，不直接展示后端原文", () => {
  const described = describeAppError(backendError("Ncm", "NCM API 错误: 503"));
  assert.equal(described.category, "api");
  assert.equal(described.title, "音乐服务暂时不可用");
  assert.equal(described.retryable, true);
  // 用户可见标题不包含后端前缀。
  assert.doesNotMatch(described.title, /NCM API|Ncm/);
  assert.match(described.detail, /NCM API 错误: 503/);
});

test("Json kind：解析失败归为数据问题且可重试", () => {
  const described = describeAppError(
    backendError("Json", "JSON 解析失败: expected value"),
  );
  assert.equal(described.category, "json");
  assert.equal(described.title, "无法识别服务器返回的数据");
  assert.equal(described.retryable, true);
});

test("Unauthorized kind：登录已过期，动作是重新登录而不是重试", () => {
  const described = describeAppError(
    backendError("Unauthorized", "未登录或 Cookie 已过期"),
  );
  assert.equal(described.category, "auth");
  assert.equal(described.title, "登录已过期");
  assert.match(described.hint, /重新登录/);
  assert.equal(described.relogin, true);
  assert.equal(described.retryable, false);
});

test("Io / Store / Internal 等 kind 落到本地/内部人话，不显示 kind 原文", () => {
  const io = describeAppError(backendError("Io", "IO 错误: 文件被占用"));
  assert.equal(io.category, "local");
  assert.equal(io.title, "本地数据读写失败");
  assert.doesNotMatch(io.title, /IO 错误/);

  const store = describeAppError(
    backendError("Store", "Store 插件错误: 写入失败"),
  );
  assert.equal(store.category, "local");

  const internal = describeAppError(
    backendError("Internal", "内部错误: 未知异常"),
  );
  assert.equal(internal.category, "internal");
  assert.equal(internal.title, "播放器内部出错");
});

test("未知错误：不臆测原因，保留原文详情", () => {
  const described = describeAppError(new Error("某个意外失败"));
  assert.equal(described.category, "unknown");
  assert.equal(described.title, "操作没有完成");
  assert.equal(described.retryable, true);
  assert.equal(described.relogin, false);
  assert.equal(described.detail, "某个意外失败");
});

test("无 kind 的字符串按 Rust 固定前缀回退归类", () => {
  const network = describeAppError("网络请求失败: timeout");
  assert.equal(network.category, "network");
  assert.match(network.title, /网络/);
  assert.equal(network.detail, "网络请求失败: timeout");

  const auth = describeAppError("未登录或 Cookie 已过期");
  assert.equal(auth.category, "auth");
  assert.equal(auth.relogin, true);

  const json = describeAppError("JSON 解析失败: unexpected token");
  assert.equal(json.category, "json");
});

test("字符串化的结构化 payload 与原生 fetch 文本也能识别", () => {
  const payload = describeAppError(
    JSON.stringify({ kind: "Network", message: "网络请求失败: reset" }),
  );
  assert.equal(payload.category, "network");
  assert.equal(payload.title, "网络连接失败");

  const fetchText = describeAppError(new Error("Failed to fetch"));
  assert.equal(fetchText.category, "network");
});

test("空输入不抛错，归为未知并可重试", () => {
  for (const empty of [undefined, null, ""]) {
    const described = describeAppError(empty);
    assert.equal(described.title, "操作没有完成");
    assert.equal(described.detail, "");
    assert.equal(described.retryable, true);
  }
});

test("表单本地校验文案原样展示，不生成技术详情", () => {
  const described = describeInputError("请输入有效的 11 位手机号");
  assert.equal(described.title, "请输入有效的 11 位手机号");
  assert.equal(described.hint, "");
  assert.equal(described.detail, "");
  assert.equal(described.retryable, false);
});

// =============== describeLoginError：登录页专用映射 ===============

test("登录凭据错误：说清账号/密码问题，不误报服务不可用", () => {
  const described = describeLoginError(
    backendError("Ncm", "NCM API 错误: 登录失败 (code=501): 账号或密码错误"),
    "account",
  );
  assert.equal(described.title, "账号或密码不正确");
  assert.doesNotMatch(described.title, /服务|稍后重试/);
  assert.match(described.hint, /检查邮箱或用户名与密码/);
  assert.equal(described.retryable, false);
  assert.match(described.detail, /code=501/);
});

test("登录凭据错误：服务端只给业务码（无中文 message）也能识别", () => {
  // 实测 code=501 的原文是 "API error (code=501): Unknown error"。
  const described = describeLoginError(
    backendError("Ncm", "NCM API 错误: API error (code=501): Unknown error"),
    "account",
  );
  assert.equal(described.title, "账号或密码不正确");
  assert.equal(described.retryable, false);
  assert.match(described.detail, /Unknown error/);
});

test("登录频繁：业务码 509 也归为稍后再试", () => {
  const described = describeLoginError(
    backendError("Ncm", "NCM API 错误: 登录失败 (code=509): Unknown error"),
    "account",
  );
  assert.equal(described.title, "登录尝试过于频繁");
  assert.equal(described.retryable, true);
});

test("登录验证码错误：恢复动作是重新获取验证码", () => {
  const described = describeLoginError(
    backendError("Ncm", "NCM API 错误: 登录失败 (code=502): 验证码错误"),
    "phone",
  );
  assert.equal(described.title, "验证码不正确或已过期");
  assert.match(described.hint, /重新获取验证码/);
  assert.equal(described.retryable, false);
});

test("登录手机号错误：指出手机号格式问题", () => {
  const described = describeLoginError(
    backendError("InvalidParam", "参数无效: 手机号或验证码无效"),
    "phone",
  );
  assert.equal(described.title, "手机号格式不正确");
  assert.match(described.hint, /11 位手机号/);
});

test("登录频繁：建议稍后再试或换一种登录方式", () => {
  const described = describeLoginError(
    backendError("Ncm", "NCM API 错误: 登录失败 (code=503): 操作频繁"),
    "account",
  );
  assert.equal(described.title, "登录尝试过于频繁");
  assert.match(described.hint, /稍等几分钟|换一种登录方式/);
  assert.equal(described.retryable, true);
});

test("登录页不出现「登录已过期」：auth 类失败按登录语境改写", () => {
  const described = describeLoginError(
    backendError("Unauthorized", "未登录或 Cookie 已过期"),
    "account",
  );
  assert.equal(described.title, "登录信息已失效");
  assert.doesNotMatch(described.title, /登录已过期/);
  assert.equal(described.relogin, false);
  assert.match(described.detail, /Cookie 已过期/);
});

test("Cookie 登录失败：恢复动作是重新复制完整 Cookie", () => {
  const described = describeLoginError(
    backendError("Unauthorized", "未登录或 Cookie 已过期"),
    "cookie",
  );
  assert.equal(described.title, "Cookie 登录没有成功");
  assert.match(described.hint, /MUSIC_U/);
  assert.equal(described.retryable, false);
});

test("登录网络失败：沿用网络文案，不建议换登录方式", () => {
  const described = describeLoginError(
    backendError("Network", "网络请求失败: 连接被拒绝"),
    "account",
  );
  assert.equal(described.title, "网络连接失败");
  assert.equal(described.category, "network");
});

test("无法识别的登录失败：不猜原因，给出登录语境回退", () => {
  const described = describeLoginError(
    backendError("Internal", "内部错误: 未知异常"),
    "account",
  );
  assert.equal(described.title, "登录没有完成");
  assert.match(described.detail, /内部错误/);
});

// =============== describePlaybackFailure：播放链路失败 ===============

test("播放装载失败：标题带歌名 + 原因类别，并说明已自动跳到下一首", () => {
  const described = describePlaybackFailure(
    playbackFailure({
      kind: "Network",
      message: "网络请求失败: 连接被拒绝",
    }),
  );
  assert.equal(described.title, "《晴天》播放失败：网络连接失败");
  assert.match(described.hint, /^已自动跳到下一首。/);
  assert.match(described.hint, /检查网络连接后重试/);
  assert.equal(described.retryable, true);
  assert.equal(described.relogin, false);
  assert.equal(described.detail, "Network · 网络请求失败: 连接被拒绝");
});

test("连续 3 次停止：按次汇总、去重歌曲名，不重复同一首", () => {
  const described = describePlaybackFailure(
    playbackFailure({
      songId: 3,
      songName: "S3",
      kind: "Ncm",
      message: "NCM API 错误: 服务器错误",
      failCount: 3,
      stopped: true,
      recentSongNames: ["S1", "S1", "S1"],
    }),
  );
  assert.equal(described.title, "连续 3 次播放失败，已停止自动切换");
  assert.match(described.hint, /《S1》。/);
  assert.doesNotMatch(described.hint, /《S1》、《S1》/);
  assert.doesNotMatch(described.title, /晴|S3/); // 汇总不再把最后一首当单曲失败
  assert.equal(described.retryable, true);
});

test("切档重载失败：说明播放已停止，仍可重试", () => {
  const described = describePlaybackFailure(
    playbackFailure({
      stage: "reload",
      kind: "Network",
      message: "网络请求失败: 断网",
      wasPlaying: true,
    }),
  );
  assert.equal(described.title, "《晴天》切换音质失败：网络连接失败");
  assert.match(described.hint, /^播放已停止。/);
  assert.equal(described.retryable, true);
});

test("流中断没有可识别 kind 时按媒体链路解释", () => {
  const described = describePlaybackFailure(
    playbackFailure({ stage: "stream", kind: null, message: "" }),
  );
  assert.equal(described.category, "media");
  assert.equal(described.title, "《晴天》播放失败：播放被中断");
  assert.equal(described.retryable, true);
});

test("播放链路里的 Media / NoSource 分类", () => {
  const media = describePlaybackFailure(
    playbackFailure({
      stage: "stream",
      kind: "Media",
      message: "媒体网络错误（MEDIA_ERR_NETWORK）",
    }),
  );
  assert.equal(media.category, "media");
  assert.equal(media.title, "《晴天》播放失败：播放被中断");

  const noSource = describePlaybackFailure(
    playbackFailure({
      kind: "NoSource",
      message: "该歌曲暂无可用播放源",
    }),
  );
  assert.equal(noSource.category, "source");
  assert.equal(noSource.title, "《晴天》播放失败：没有可用的播放源");
  assert.equal(noSource.retryable, true);
});

test("播放失败里的登录过期：引导重新登录而不是反复重试", () => {
  const described = describePlaybackFailure(
    playbackFailure({
      kind: "Unauthorized",
      message: "未登录或 Cookie 已过期",
    }),
  );
  assert.equal(described.title, "《晴天》播放失败：登录已过期");
  assert.equal(described.relogin, true);
  assert.equal(described.retryable, false);
  assert.match(described.detail, /未登录或 Cookie 已过期/);
});

test("未知播放失败：不猜测原因，归为未知且保留详情", () => {
  const described = describePlaybackFailure(
    playbackFailure({ kind: null, message: "某个底层异常" }),
  );
  assert.equal(described.title, "《晴天》播放失败：操作没有完成");
  assert.equal(described.detail, "某个底层异常");
});
