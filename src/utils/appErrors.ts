// 错误人话层：把 Rust AppError（kind + message）与播放链路失败翻译成
// 「发生了什么 + 怎么恢复」的用户语言；后端原文只作为可折叠技术详情保留。
//
// 约束：
//   - 只做展示映射，不改后端错误类型、日志与重试/自动切歌逻辑；
//   - 未知错误不猜具体原因，统一归为「未知」并保留原文；
//   - 登录过期必须导向重新登录，而不是让用户反复点重试；
//   - 文案保持中文、平实，不出现后端前缀词（网络请求失败 / JSON 解析失败 / NCM API 错误）。

import type { PlaybackFailure } from "@/playback/playbackEngine";

/** 用户可理解的错误类别；用于选择图标/文案，不影响业务分支。 */
export type AppErrorCategory =
  | "network"
  | "api"
  | "json"
  | "auth"
  | "local"
  | "input"
  | "internal"
  | "source"
  | "media"
  | "unknown";

export interface UserFacingError {
  category: AppErrorCategory;
  /** 一句话说明发生了什么；可直接作为标题，不含歌曲名等上下文前缀。 */
  title: string;
  /** 恢复方式建议；空字符串表示没有更好的建议。 */
  hint: string;
  /** 是否可原地重试（登录过期时为 false）。 */
  retryable: boolean;
  /** 是否应引导用户重新登录。 */
  relogin: boolean;
  /** 可折叠的技术详情（后端原文）；空字符串表示没有更多信息。 */
  detail: string;
}

type ErrorCopy = Pick<
  UserFacingError,
  "category" | "title" | "hint" | "retryable" | "relogin"
>;

const NETWORK_COPY: ErrorCopy = {
  category: "network",
  title: "网络连接失败",
  hint: "检查网络连接后重试。",
  retryable: true,
  relogin: false,
};

const API_COPY: ErrorCopy = {
  category: "api",
  title: "音乐服务暂时不可用",
  hint: "稍后重试；如果一直失败，可展开技术详情反馈。",
  retryable: true,
  relogin: false,
};

const JSON_COPY: ErrorCopy = {
  category: "json",
  title: "无法识别服务器返回的数据",
  hint: "稍后重试；如果仍然失败，可展开技术详情反馈。",
  retryable: true,
  relogin: false,
};

const AUTH_COPY: ErrorCopy = {
  category: "auth",
  title: "登录已过期",
  hint: "请重新登录后继续。",
  retryable: false,
  relogin: true,
};

const LOCAL_COPY: ErrorCopy = {
  category: "local",
  title: "本地数据读写失败",
  hint: "稍后重试；如果持续失败，可展开技术详情查看原因。",
  retryable: true,
  relogin: false,
};

const INPUT_COPY: ErrorCopy = {
  category: "input",
  title: "填写的内容不符合要求",
  hint: "检查填写内容后重新提交。",
  retryable: false,
  relogin: false,
};

const INTERNAL_COPY: ErrorCopy = {
  category: "internal",
  title: "播放器内部出错",
  hint: "重试一次；如果仍然失败，可展开技术详情反馈。",
  retryable: true,
  relogin: false,
};

const SOURCE_COPY: ErrorCopy = {
  category: "source",
  title: "没有可用的播放源",
  hint: "这首歌暂时无法播放，可能是版权或会员限制；可以换一首试试。",
  retryable: true,
  relogin: false,
};

const MEDIA_COPY: ErrorCopy = {
  category: "media",
  title: "播放被中断",
  hint: "可能是网络波动或音频格式不受支持；重试会重新加载。",
  retryable: true,
  relogin: false,
};

const RISK_CONTROL_COPY: ErrorCopy = {
  category: "api",
  title: "网易云暂时限制了请求",
  // 通用语境（页内错误、全局提示都可能复用）：不含播放叙事，播放语境由
  // describePlaybackFailure 另行补「已暂停自动切歌」。
  hint: "网易云暂时拦截了这次请求；稍等几秒后重试通常可恢复。",
  retryable: true,
  relogin: false,
};

/** 引擎内部 kind（本地取址/媒体起播超时），不是后端 error kind。 */
const TIMEOUT_COPY: ErrorCopy = {
  category: "network",
  title: "加载超时",
  hint: "网络较慢或音频响应超时；重试会重新加载。",
  retryable: true,
  relogin: false,
};

const UNKNOWN_COPY: ErrorCopy = {
  category: "unknown",
  title: "操作没有完成",
  hint: "重试一次；如果仍然失败，可展开技术详情查看原因。",
  retryable: true,
  relogin: false,
};

/** 后端 kind → 用户语言；与 error.rs 的 9 个 kind 一一对应，另加播放链路分类。 */
function copyForKind(kind: string | null): ErrorCopy {
  switch (kind) {
    case "Network":
      return NETWORK_COPY;
    case "Ncm":
      return API_COPY;
    case "RiskControl":
      return RISK_CONTROL_COPY;
    // 引擎内部类别：本地取址/媒体起播超时，不是后端 kind。
    case "Timeout":
      return TIMEOUT_COPY;
    case "Json":
      return JSON_COPY;
    case "Unauthorized":
      return AUTH_COPY;
    case "Io":
    case "Store":
      return LOCAL_COPY;
    case "InvalidParam":
      return INPUT_COPY;
    case "Internal":
      return INTERNAL_COPY;
    case "NoSource":
      return SOURCE_COPY;
    case "Media":
      return MEDIA_COPY;
    default:
      return UNKNOWN_COPY;
  }
}

/** Rust error.rs 的固定前缀；即使只拿到已字符串化的错误也能识别类别。 */
const MESSAGE_PREFIXES: ReadonlyArray<{
  prefix: string;
  kind: string;
}> = [
  { prefix: "网络请求失败", kind: "Network" },
  { prefix: "JSON 解析失败", kind: "Json" },
  { prefix: "NCM API 错误", kind: "Ncm" },
  { prefix: "未登录或 Cookie 已过期", kind: "Unauthorized" },
  { prefix: "IO 错误", kind: "Io" },
  { prefix: "Store 插件错误", kind: "Store" },
  { prefix: "参数无效", kind: "InvalidParam" },
  { prefix: "内部错误", kind: "Internal" },
];

/** 没有 kind 时按报错原文推断类别；推断不出来就是 null（走未知文案）。 */
function inferKindFromMessage(message: string): string | null {
  if (!message) return null;
  // 风控（网易云 -460）的原文常含「网络环境存在风险」，还可能被包在
  // 「NCM API 错误」「网络请求失败」等通用前缀里。必须在通用前缀与「网络」
  // 关键词之前判定，否则真正的风控会被说成网络失败或通用接口错误。
  // 但只认风控专属措辞：通用「请稍后再试」在限流、维护、参数校验失败里都常见，
  // 单靠它会把普通错误说成「网易云限制了请求」，给出的恢复动作也就对不上。
  // 业务码按整词匹配，避免把 -4600、-4601 之类的其他码误当成 -460。
  if (
    /(?:^|\D)-460(?!\d)|风控|风险控制|网络环境存在风险|限制了请求/.test(message)
  ) {
    return "RiskControl";
  }
  for (const { prefix, kind } of MESSAGE_PREFIXES) {
    if (message.includes(prefix)) return kind;
  }
  // Tauri invoke / WebView 网络层的原生文本。
  if (
    /网络|超时|断网|离线|timeout|timed out|failed to fetch|network|connection|econn|dns|socket/i.test(
      message,
    )
  ) {
    return "Network";
  }
  if (/登录|登陆|未登录|cookie|unauthor|401|会话|session/i.test(message)) {
    return "Unauthorized";
  }
  if (/json|解析|parse/i.test(message)) {
    return "Json";
  }
  if (/ncm|api|接口|rate.?limit|429|服务端/i.test(message)) {
    return "Ncm";
  }
  if (/媒体|media|decode|解码|codec/i.test(message)) {
    return "Media";
  }
  return null;
}

/** 前端可能拿到字符串化的结构化错误（invoke 拒绝值的旧形态）。 */
function tryReadStructuredPayload(
  value: string,
): { kind: string | null; message: string } | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as { kind?: unknown; message?: unknown };
    if (typeof candidate.message !== "string") return null;
    return {
      kind:
        typeof candidate.kind === "string" && candidate.kind.trim()
          ? candidate.kind
          : null,
      message: candidate.message,
    };
  } catch {
    // 不是结构化 JSON，按普通文本处理。
    return null;
  }
}

function readErrorInput(error: unknown): { kind: string | null; message: string } {
  if (typeof error === "string") {
    return tryReadStructuredPayload(error) ?? { kind: null, message: error };
  }
  if (error && typeof error === "object") {
    const candidate = error as {
      kind?: unknown;
      message?: unknown;
      code?: unknown;
    };
    if (typeof candidate.kind === "string" && candidate.kind.trim()) {
      return {
        kind: candidate.kind,
        message:
          typeof candidate.message === "string" ? candidate.message.trim() : "",
      };
    }
    if (error instanceof Error) {
      return { kind: null, message: error.message.trim() };
    }
    if (typeof candidate.message === "string" && candidate.message.trim()) {
      return { kind: null, message: candidate.message.trim() };
    }
    // MediaError 等宿主对象只有数字 code；类别留给播放链路分类。
    if (typeof candidate.code === "number") {
      return { kind: "Media", message: "" };
    }
  }
  return { kind: null, message: "" };
}

function technicalDetail(kind: string | null, message: string): string {
  if (!message) return kind ? `错误类别：${kind}` : "";
  return kind ? `${kind} · ${message}` : message;
}

function buildError(copy: ErrorCopy, detail: string): UserFacingError {
  return { ...copy, detail };
}

function describeResolved(
  kind: string | null,
  message: string,
): UserFacingError {
  const resolvedKind = kind ?? inferKindFromMessage(message);
  return buildError(copyForKind(resolvedKind), technicalDetail(kind, message));
}

/**
 * 把任意错误来源（AppError 实例、已字符串化的 payload、Error、普通文本）映射成
 * 用户语言。这是页面内联错误与全局状态条共用的唯一入口。
 */
export function describeAppError(error: unknown): UserFacingError {
  const { kind, message } = readErrorInput(error);
  return describeResolved(kind, message);
}

/**
 * 登录页等表单里的本地校验文案（已经是用户语言），包装成同一个展示结构。
 * 不生成技术详情，避免把「请输入有效的手机号」当成错误原文展示。
 */
export function describeInputError(message: string): UserFacingError {
  return { ...INPUT_COPY, title: message, hint: "", detail: "" };
}

// =============== 登录页：把凭据/验证码/频率类失败说清楚 ===============
//
// 账号、验证码登录失败会以 AppError::Ncm 返回（如
// 「NCM API 错误: 登录失败 (code=501): 账号或密码错误」）。若直接走通用
// API 文案，用户会被告知「音乐服务暂时不可用 / 请稍后重试」——既误报原因，
// 又给出无用的恢复动作。这里在通用映射之上补一层登录语境。

export type LoginErrorContext = "account" | "phone" | "cookie";

const LOGIN_CREDENTIALS_COPY: ErrorCopy = {
  category: "input",
  title: "账号或密码不正确",
  hint: "检查邮箱或用户名与密码后重新登录。",
  retryable: false,
  relogin: false,
};

const LOGIN_CAPTCHA_COPY: ErrorCopy = {
  category: "input",
  title: "验证码不正确或已过期",
  hint: "请重新获取验证码后再试。",
  retryable: false,
  relogin: false,
};

const LOGIN_PHONE_COPY: ErrorCopy = {
  category: "input",
  title: "手机号格式不正确",
  hint: "检查 11 位手机号后重新获取验证码。",
  retryable: false,
  relogin: false,
};

const LOGIN_RATE_LIMIT_COPY: ErrorCopy = {
  category: "api",
  title: "登录尝试过于频繁",
  hint: "稍等几分钟再试；也可以换一种登录方式。",
  retryable: true,
  relogin: false,
};

const LOGIN_AUTH_COPY: ErrorCopy = {
  category: "auth",
  title: "登录信息已失效",
  hint: "请重新输入账号，或改用扫码登录。",
  retryable: false,
  relogin: false,
};

const LOGIN_COOKIE_COPY: ErrorCopy = {
  category: "input",
  title: "Cookie 登录没有成功",
  hint: "请从已登录网易云音乐的浏览器重新复制完整 Cookie，并确认包含 MUSIC_U。",
  retryable: false,
  relogin: false,
};

const LOGIN_SERVICE_COPY: ErrorCopy = {
  category: "api",
  title: "登录没有完成",
  hint: "音乐服务暂时没有响应，请稍后重试。",
  retryable: true,
  relogin: false,
};

/** 登录页的默认回退：Cookie 登录与账号/验证码登录的下一步不同。 */
function loginFallbackCopy(context: LoginErrorContext): ErrorCopy {
  return context === "cookie" ? LOGIN_COOKIE_COPY : LOGIN_SERVICE_COPY;
}

/**
 * 登录失败的专用映射：在通用错误层之上识别「凭据 / 验证码 / 手机号 /
 * 频率」等用户可自行修正的原因；登录页也不该出现「登录已过期」这种
 * 面向已登录界面的说法。
 */
export function describeLoginError(
  error: unknown,
  context: LoginErrorContext = "account",
): UserFacingError {
  const base = describeAppError(error);
  const text = base.detail;

  // 先认后端原文里的具体原因（Rust 会把服务端中文原样带进 message）。
  if (/手机号/.test(text)) return buildError(LOGIN_PHONE_COPY, base.detail);
  if (/验证码/.test(text)) return buildError(LOGIN_CAPTCHA_COPY, base.detail);
  if (/(密码|账号|帐户|用户名)/.test(text)) {
    return buildError(LOGIN_CREDENTIALS_COPY, base.detail);
  }
  if (/(频繁|限流|风控|操作过快|稍后再试)/.test(text)) {
    return buildError(LOGIN_RATE_LIMIT_COPY, base.detail);
  }

  // 服务端有时不带中文 message（实测 code=501 返回 "Unknown error"），
  // 只能按业务码兜底：501/502 都是账号或密码问题，509 是登录频繁。
  const code = /code=(\d+)/.exec(text)?.[1];
  if (context !== "cookie" && (code === "501" || code === "502")) {
    return buildError(LOGIN_CREDENTIALS_COPY, base.detail);
  }
  if (code === "509") {
    return buildError(LOGIN_RATE_LIMIT_COPY, base.detail);
  }

  // 网络层失败原样保留：换登录方式也解决不了断网。
  if (base.category === "network") return base;

  if (base.category === "auth") {
    return buildError(
      context === "cookie" ? LOGIN_COOKIE_COPY : LOGIN_AUTH_COPY,
      base.detail,
    );
  }
  if (base.category === "input") {
    return buildError(
      context === "cookie" ? LOGIN_COOKIE_COPY : LOGIN_CREDENTIALS_COPY,
      base.detail,
    );
  }
  return buildError(loginFallbackCopy(context), base.detail);
}

/**
 * 播放失败（装载失败 / 流中断 / 切档重载失败）的用户语言汇总。
 *
 * 引擎通报的是事实（见 PlaybackFailure）：
 *   - advancedToNext：失败后是否真的切到了下一首。只有为 true 才能说
 *     「已自动跳到下一首」；风控/网络/超时等会话级问题会让播放停在失败
 *     歌曲上，此时必须如实说「播放已停在当前歌曲」。
 *   - retryCount：通报前引擎已对同一首歌自动重试的次数，要在 hint 里说明，
 *     否则用户会以为第一次就失败。
 *   - stopped：连续失败达到上限、已停止自动切换；保留「连续 N 次」汇总并
 *     去重歌曲名，不再把最后一首当单曲失败。
 */
export function describePlaybackFailure(
  failure: PlaybackFailure,
): UserFacingError {
  const base = describeResolved(failure.kind, failure.message);
  // 流中断的原文常常没有可识别前缀（媒体元素只给 MediaError），按媒体链路解释。
  const cause =
    failure.stage === "stream" && base.category === "unknown"
      ? buildError(MEDIA_COPY, base.detail)
      : base;

  /** 自动重试是已经发生的事实，附在恢复建议末尾。 */
  const retryNote =
    failure.retryCount > 0 ? `（已自动重试 ${failure.retryCount} 次）` : "";
  /** 汇总通报跨多首歌：retryCount 只属于最后一首，不能读成累计重试数。 */
  const lastSongRetryNote =
    failure.retryCount > 0
      ? `（最后一首已自动重试 ${failure.retryCount} 次）`
      : "";

  if (failure.stopped) {
    // 单曲循环时同一首会被反复重试，按次计数并去重，避免《X》、《X》、《X》。
    const names = [...new Set(failure.recentSongNames)]
      .map((name) => `《${name}》`)
      .join("、");
    const facts = names ? `失败歌曲：${names}。` : "";
    return {
      ...cause,
      title: `连续 ${failure.failCount} 次播放失败，已停止自动切换`,
      hint: `${facts}${cause.hint}${lastSongRetryNote}`,
    };
  }

  if (failure.stage === "reload") {
    return {
      ...cause,
      title: `《${failure.songName}》切换音质失败：${cause.title}`,
      hint: `播放已停止。${cause.hint}${retryNote}`,
    };
  }

  // 只有引擎确实切到了下一首才说「已自动跳到下一首」；否则必须承认停住了，
  // 用户才知道要重试/换歌，而不是在等一首永远不会开始的歌。
  let stopNote = failure.advancedToNext
    ? "已自动跳到下一首。"
    : "播放已停在当前歌曲。";
  // 风控失败不切歌是引擎的主动保护（避免连续失败），这是播放语境的事实；
  // 通用的页内风控错误不含这句，由 RISK_CONTROL_COPY.hint 描述即可。
  if (!failure.advancedToNext && failure.kind === "RiskControl") {
    stopNote += "已暂停自动切歌，避免连续失败。";
  }
  return {
    ...cause,
    title: `《${failure.songName}》播放失败：${cause.title}`,
    hint: `${stopNote}${cause.hint}${retryNote}`,
  };
}
