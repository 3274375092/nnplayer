import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// 两处「有界但昂贵」的动画预算（审计 #11 逐字卡拉 OK、#13 侧栏 220ms 过渡）
// 的源码契约守卫。单测环境没有 WebView，无法测帧；这里锁住的是实现方式本身：
//   #11 —— 逐字 span 由 KaraokeChar 子组件承载，props 走 1% 量化整数 pct，
//          由 Vue 的 props 相等性跳过未变化字符（不再每帧写满整行）。
//   #13 —— 侧栏过渡期间由 App provide 标志、SongList 同步 watcher 固定旧列策略，
//          用 container-type: normal + contain: layout paint 停掉逐帧重排，
//          过渡结束后只留一次重排；220ms DESIGN 时长不得被改掉。
// 任何一处退回「每帧全量写」或「逐帧容器查询」都会让这里的断言失败。

const [lyricPanel, app, sidebar, songList] = await Promise.all([
  readFile(new URL("../src/components/LyricPanel.vue", import.meta.url), "utf8"),
  readFile(new URL("../src/App.vue", import.meta.url), "utf8"),
  readFile(new URL("../src/components/Sidebar.vue", import.meta.url), "utf8"),
  readFile(new URL("../src/components/SongList.vue", import.meta.url), "utf8"),
]);

test("#11 逐字卡拉 OK 走量化 props 子组件，而不是每帧全量写 style", () => {
  // 子组件 + 量化函数。
  assert.match(lyricPanel, /const\s+KaraokeChar\s*=\s*defineComponent\(/);
  assert.match(
    lyricPanel,
    /function\s+charPct\([\s\S]*?Math\.round\(\s*progress\s*\*\s*100\s*\)/,
    "charPct 必须把进度量化成 1% 整数台阶",
  );
  // 模板把量化值作为 prop 传给子组件（这是 Vue props 相等性跳过的前提）。
  assert.match(lyricPanel, /:pct="charPct\(token\)"/);
  // 30fps 桶（33ms）保持不变：再快只是多写，再慢会看出擦色台阶。
  assert.match(
    lyricPanel,
    /now\s*-\s*lastKaraokePaint\s*>=\s*33/,
    "主窗卡拉 OK 仍是 33ms 桶",
  );
});

test("#13 侧栏过渡期间固定旧列策略，结束后只重排一次", () => {
  // Sidebar 发出过渡开始/结束事件（220ms DESIGN 时长），并尊重 reduced-motion。
  assert.match(sidebar, /\(e:\s*"width-transition-start"\)/);
  assert.match(sidebar, /\(e:\s*"width-transition-end"\)/);
  assert.match(sidebar, /220/, "220ms 过渡时长不得改动");
  assert.match(sidebar, /prefers-reduced-motion|reducedMotion/);

  // App 维护并 provide 过渡标志，并接到 Sidebar 的事件上。
  const keyLiteral = /nnplayer\.sidebarTransitioning/;
  assert.match(app, keyLiteral);
  assert.match(app, /provide\(\s*SIDEBAR_TRANSITION_KEY/);
  assert.match(app, /@width-transition-start=/);
  assert.match(app, /@width-transition-end=/);
  assert.match(songList, keyLiteral, "SongList 必须读取同一个 provide key");

  // SongList 在 DOM 更新前同步量旧宽度，然后固定列策略。
  assert.match(songList, /flush:\s*"sync"/);
  assert.match(songList, /song-list-root--pinned-wide/);
  assert.match(songList, /song-list-root--pinned-narrow/);
  assert.match(
    songList,
    /pinned-wide[\s\S]{0,400}?contain:\s*layout paint;[\s\S]{0,200}?container-type:\s*normal;/,
    "pinned 状态必须用 contain: layout paint + container-type: normal 冻结重排",
  );
  // 阈值必须与列表容器查询的 34rem（544px）一致，否则过渡中途仍会翻列。
  assert.match(songList, /34\s*\*\s*16|544/);
});
