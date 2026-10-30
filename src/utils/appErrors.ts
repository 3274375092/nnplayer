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

const UNKNOWN_COPY: ErrorCopy = {
  category: "unknown",
  title: "操作没有完成",
  hint: "重试一次；如果仍然失败，可展开技术详情查看原因。",
  retryable: true,
  relogin: false,
};

/** 后端 kind → 用户语言；与 error.rs 的 8 个 kind 一一对应，另加播放链路分类。 */
function copyForKind(kind: string | null): ErrorCopy {
  switch (kind) {
    case "Network":
      return NETWORK_COPY;
    case "Ncm":
      return API_COPY;
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

/**
 * 播放失败（装载失败 / 流中断 / 切档重载失败）的用户语言汇总。
 *
 * 连续失败达到引擎上限时不再展示单曲标题，而给出「连续 N 首失败、已停止
 * 自动切换」的汇总，并列出失败歌曲名，保证停止原因可见。
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

  if (failure.stopped) {
    const names = failure.recentSongNames
      .map((name) => `《${name}》`)
      .join("、");
    return {
      ...cause,
      title: `连续 ${failure.failCount} 首播放失败，已停止自动切换`,
      hint: names ? `失败歌曲：${names}。${cause.hint}` : cause.hint,
    };
  }

  if (failure.stage === "reload") {
    return {
      ...cause,
      title: `《${failure.songName}》切换音质失败：${cause.title}`,
      hint: `播放已停止。${cause.hint}`,
    };
  }

  return {
    ...cause,
    title: `《${failure.songName}》播放失败：${cause.title}`,
  };
}
