// 全局非阻塞状态条的通知队列（GlobalNotice.vue 消费）。
//
// 约定：
//   - 同 id 的提示原地更新并排到队尾：同一次失败（如播放失败）只占一个位置，
//     不会因为自动跳歌连续失败而堆叠成一列；
//   - 一次只展示最新一条，其余保留在队列里并在状态条上提示「另有 N 条」，
//     关闭当前条目后会自动露出上一条——错误不会因为被新提示盖住而静默消失；
//   - 关闭只能由用户触发（没有自动消失定时器），避免失败被定时器静默吞掉；
//   - 可选的 onDismiss 用来把「用户已确认」同步回产生方（如 player store 的
//     失败记录），本 store 不依赖任何业务 store。

import { defineStore } from "pinia";
import { computed, ref } from "vue";

export type NoticeTone = "error" | "info";

export interface NoticeAction {
  /** 按钮文案，如「重试」「重新登录」。 */
  label: string;
  /** 点击动作；可以是异步，但 store 不追踪其结果。 */
  run: () => void;
}

export interface AppNotice {
  /** 稳定去重键；相同 id 的提示原地更新。 */
  id: string;
  tone: NoticeTone;
  /** 一句话说明发生了什么（用户语言，不含后端前缀）。 */
  title: string;
  /** 恢复方式建议或补充说明。 */
  hint?: string;
  /** 可折叠技术详情（后端原文）。 */
  detail?: string;
  /** 主动作，如重试失败歌曲 / 重新登录。 */
  action?: NoticeAction;
  /** 用户关闭提示时回调；抛错不得阻止关闭。 */
  onDismiss?: () => void;
}

export const useNoticeStore = defineStore("notice", () => {
  /** 队列按追加顺序保存；最后一条为当前展示的通知。 */
  const notices = ref<AppNotice[]>([]);

  const current = computed<AppNotice | null>(() => {
    return notices.value.length > 0
      ? (notices.value[notices.value.length - 1] ?? null)
      : null;
  });

  /** 当前条目之后还有多少条被折叠保留的提示。 */
  const pendingCount = computed(() => Math.max(0, notices.value.length - 1));

  /** 追加或更新一条通知；同 id 时替换旧内容并排到最新。 */
  function push(notice: AppNotice) {
    const next = notices.value.filter((item) => item.id !== notice.id);
    next.push(notice);
    notices.value = next;
  }

  /** 关闭指定通知；先触发 onDismiss（若存在），异常不影响关闭本身。 */
  function dismiss(id: string) {
    const target = notices.value.find((item) => item.id === id);
    if (!target) return;
    notices.value = notices.value.filter((item) => item.id !== id);
    try {
      target.onDismiss?.();
    } catch (error) {
      // 关闭动作失败不应把已关闭的提示留在界面上。
      console.warn("[notice] onDismiss 回调失败", error);
    }
  }

  /** 清空全部通知（仅用于账号切换等明确的全量重置场景）。 */
  function clear() {
    notices.value = [];
  }

  return { notices, current, pendingCount, push, dismiss, clear };
});
