/**
 * 歌词行的语言判定。
 *
 * 界面语言固定为 zh-CN，但曲库里有大量英文、日文（含假名混排）歌词。
 * 没有 lang 时屏幕阅读器会用中文语音朗读所有歌词；给歌词行补 lang 才能让
 * 读屏按正确的发音规则朗读（WCAG 3.1.2 Language of Parts）。
 *
 * 只做「按主文字系统」的保守判断：命中假名 → ja；谚文 → ko；汉字（无假名）
 * → zh；拉丁字母 → en；其余（纯符号/数字）返回 undefined，让元素继承文档语言。
 */
export function langForLyric(text: string | null | undefined): string | undefined {
  const value = (text ?? "").trim();
  if (!value) return undefined;

  // 平假名 / 片假名（含半角片假名与假名扩展）
  if (/[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9f]/.test(value)) return "ja";
  // 谚文（韩文音节与字母）
  if (/[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/.test(value)) return "ko";
  // 汉字（中文 / 日文汉字）：无假名时按中文处理
  if (/[\u3400-\u9fff\uf900-\ufaff]/.test(value)) return "zh";
  // 拉丁字母为主的歌词（英文等）
  if (/[A-Za-z]/.test(value)) return "en";
  return undefined;
}
