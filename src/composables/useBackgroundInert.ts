// 模态打开时把背景应用壳标记为 inert。
//
// 队列抽屉、关于弹层、窄窗侧栏浮层与折叠态搜索弹层都会限制键盘焦点，
// 但读屏浏览模式仍可能走进背景页面。四个实现都各自重复了焦点陷阱/初始焦点/
// Escape/焦点归还，却都漏了背景 inert（评审 P2）。这里用一个共享钩子统一处理，
// 支持同一时刻多个浮层叠加时的引用计数（计数逻辑在 utils/inertCounter.ts，可单测）。
//
// 目标选择器按模态的挂载位置传入：
//   - Teleport 到 body 的对话框/抽屉（关于弹层、队列抽屉、折叠态搜索弹层）：
//     整棵应用壳（#app）都不可达；
//   - 仍留在应用树里的窄窗侧栏浮层：只 inert 内容壳，侧栏自身仍可交互；
//   - 队列抽屉的遮罩和面板都让开常驻播放条（DESIGN Queue drawer）：
//     keepInteractive 让播放条子树保持可操作，同时其余背景内容仍不可达。
import { onScopeDispose, watch } from "vue";
import {
  acquireInertRefs,
  releaseInertRefs,
  type InertRefCounts,
} from "@/utils/inertCounter";

export interface BackgroundInertOptions {
  /** 需要标记为 inert 的子树选择器；默认整棵应用壳（`#app`）。 */
  targets?: readonly string[];
  /** `targets` 内部仍需保持交互的子树选择器（例如队列抽屉打开时的播放条）。 */
  keepInteractive?: readonly string[];
}

/** 同一个 DOM 元素被多个模态同时持有时的全局引用计数。 */
const inertRefs: InertRefCounts<Element> = new Map();

const DEFAULT_TARGETS: readonly string[] = ["#app"];

function setInert(element: Element, inert: boolean): void {
  // 只用 inert：Chromium/WebKit 会把 inert 子树移出 tab 序与无障碍树；
  // 再叠加 aria-hidden 会在打开瞬间（焦点尚未移进对话框时）被浏览器
  // 拒绝并打印控制台警告，因此不重复声明。
  if (inert) {
    element.setAttribute("inert", "");
  } else {
    element.removeAttribute("inert");
  }
}

/**
 * 把选择器展开成真正要 inert 的元素。
 * 若某个目标子树包含 keepInteractive 元素（例如应用壳里的播放条），就沿着
 * “包含例外”的那条链下探一层，把不含例外的兄弟子树作为 inert 目标；例外
 * 子树及其后代保持可交互，其余背景内容照旧从 tab 序与无障碍树中移除。
 */
function resolveInertTargets(
  targets: readonly string[],
  keepInteractive: readonly string[],
): Element[] {
  if (typeof document === "undefined") return [];
  const exceptions = keepInteractive.flatMap((selector) =>
    Array.from(document.querySelectorAll(selector)),
  );
  const resolved: Element[] = [];
  const visited = new Set<Element>();

  function visit(element: Element): void {
    // 例外本身：连同它的后代都保持可交互。
    if (exceptions.includes(element)) return;
    // 例外在这个子树里：不能整个 inert，只处理它的兄弟子树。
    if (exceptions.some((exception) => element.contains(exception))) {
      for (const child of Array.from(element.children)) visit(child);
      return;
    }
    if (visited.has(element)) return;
    visited.add(element);
    resolved.push(element);
  }

  for (const selector of targets) {
    for (const element of document.querySelectorAll(selector)) visit(element);
  }
  return resolved;
}

/**
 * 在 `isActive` 为真期间把 `options.targets` 指向的元素标记为 inert
 * （`keepInteractive` 指向的子树除外）。同一目标被多个模态同时持有时
 * 按引用计数释放，不会提前解禁。
 */
export function useBackgroundInert(
  isActive: () => boolean,
  options: BackgroundInertOptions = {},
): void {
  const targets = options.targets ?? DEFAULT_TARGETS;
  const keepInteractive = options.keepInteractive ?? [];
  /** 本实例当前持有的元素：释放时只归还自己登记过的计数。 */
  const held = new Set<Element>();

  function acquire(): void {
    const resolved = resolveInertTargets(targets, keepInteractive);
    const fresh = resolved.filter((element) => !held.has(element));
    for (const element of fresh) held.add(element);
    for (const element of acquireInertRefs(inertRefs, fresh)) {
      setInert(element, true);
    }
  }

  function release(): void {
    const released = Array.from(held);
    held.clear();
    for (const element of releaseInertRefs(inertRefs, released)) {
      setInert(element, false);
    }
  }

  watch(isActive, (active) => (active ? acquire() : release()), {
    immediate: true,
  });

  onScopeDispose(release);
}
