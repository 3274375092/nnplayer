// 卡拉 OK 当前行按词分组（纯函数，零依赖）。
//
// 背景：逐字擦色把每个字符渲染成 display:inline-block 的 .lyric-char，原子内联
// 盒子之间天然允许断行，父级的 word-break: normal / overflow-wrap: break-word
// 管不到兄弟盒子之间的断点，于是 "for you" 会被拆成 "for y / ou"。
//
// 这里先把 token 分组成词，渲染层再按组决定是否包一层不可断的词级 wrapper：
//   - 西文 / 数字 / 标点（含词内标点，如 "you,"）连成一个整体：整词不可断；
//   - 空白 token 合并成组，渲染为普通文本空格，作为词间断点（保留原有空格）；
//   - CJK（汉字 / 假名 / 谚文 / 注音）没有空格分词，逐字成组，中文日文仍按字换行。
//
// 分组只改变渲染分组，不重排、不丢 token：所有组按原顺序拼接后与输入逐 token 相等，
// 所以每个字符的擦色进度仍然由它自己的 token 驱动（时间轴精度不变）。
// tests/karaokeWords.test.mjs 会直接转译执行本文件，勿在此 import 任何依赖。

export interface KaraokeTokenLike {
  readonly char: string;
}

export interface KaraokeWordGroup<T extends KaraokeTokenLike> {
  /** 组内 token（保持原顺序；逐字擦色仍逐 token 渲染）。 */
  readonly tokens: readonly T[];
  /** true：西文词，渲染时用不可断行的词级 wrapper 包住整组。 */
  readonly nowrap: boolean;
  /** true：纯空白组，渲染为普通文本空格（词间断点，不参与擦色）。 */
  readonly isSpace: boolean;
}

/** 允许逐字换行的文字：无空格分词的 CJK 写系统。 */
const CJK_CHAR =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}]/u;

/** 是否不含可见字符（空白 token，空字符串也算）。 */
function isBlankToken(token: KaraokeTokenLike): boolean {
  return token.char.trim() === "";
}

/** 按首码位判定 CJK：单字成组，组与组之间允许换行。 */
function isCjkToken(token: KaraokeTokenLike): boolean {
  const first = token.char.codePointAt(0);
  if (first === undefined) return false;
  return CJK_CHAR.test(String.fromCodePoint(first));
}

/**
 * 把卡拉 OK 逐字 token 分组成词。
 *
 * 输出顺序与输入一致，所有 token 恰好出现一次；空输入返回空数组。
 */
export function groupKaraokeTokensIntoWords<T extends KaraokeTokenLike>(
  tokens: readonly T[],
): KaraokeWordGroup<T>[] {
  const groups: KaraokeWordGroup<T>[] = [];
  let word: T[] = [];
  let spaces: T[] = [];

  function flushWord() {
    if (word.length === 0) return;
    groups.push({ tokens: word, nowrap: true, isSpace: false });
    word = [];
  }

  function flushSpaces() {
    if (spaces.length === 0) return;
    groups.push({ tokens: spaces, nowrap: false, isSpace: true });
    spaces = [];
  }

  for (const token of tokens) {
    if (isBlankToken(token)) {
      flushWord();
      spaces.push(token);
    } else if (isCjkToken(token)) {
      // CJK 不并入西文词：一个字一组，长中文行仍按字换行。
      flushWord();
      flushSpaces();
      groups.push({ tokens: [token], nowrap: false, isSpace: false });
    } else {
      flushSpaces();
      word.push(token);
    }
  }
  flushWord();
  flushSpaces();
  return groups;
}
