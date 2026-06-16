// 弹簧物理滚动 composable。
// 参考 ZeroBit-Player lib/components/spring_list_view.dart 的 SpringSimulation：
//   F = -k * (x - target) - c * v
//   a = F / m
// Verlet 积分半隐式欧拉。
//
// 设计要点：
// 1. dt 限制：tab 切换后回归页面时，rAF 的 t 跨度会很大，导致一次大跳。clamp 到 0.064s (= ~16fps 帧)
// 2. 收敛条件：|位移| < 0.1 且 |速度| < 0.1 时停止 rAF，节能
// 3. target 是 ref：变化时 lastT 重置（让 dt 从 0 开始算，避免一上来就大跳）
// 4. onBeforeUnmount 清理 rAF
// 5. prefers-reduced-motion 时退化为直接同步：调用方根据 reducedMotion 自己用 ref.value 替代

import {
  onBeforeUnmount,
  ref,
  watch,
  type Ref,
} from "vue";

export interface SpringOptions {
  stiffness?: number;
  damping?: number;
  mass?: number;
}

const DEFAULTS: Required<SpringOptions> = {
  stiffness: 170,
  damping: 26,
  mass: 1,
};

export function useSpringValue(
  target: Ref<number>,
  opts: SpringOptions = {},
) {
  const o = { ...DEFAULTS, ...opts };
  const value = ref(target.value);
  let velocity = 0;

  let raf = 0;
  let lastT = 0;

  function tick(t: number) {
    if (!lastT) lastT = t;
    const dt = Math.min(0.064, (t - lastT) / 1000);
    lastT = t;
    const force =
      -o.stiffness * (value.value - target.value) -
      o.damping * velocity;
    const accel = force / o.mass;
    velocity += accel * dt;
    value.value += velocity * dt;
    if (
      Math.abs(value.value - target.value) < 0.1 &&
      Math.abs(velocity) < 0.1
    ) {
      value.value = target.value;
      velocity = 0;
      raf = 0;
      return;
    }
    raf = requestAnimationFrame(tick);
  }

  watch(target, () => {
    lastT = 0; // 重置 lastT，下一帧 dt 从 0 开始
    if (!raf) raf = requestAnimationFrame(tick);
  });

  onBeforeUnmount(() => {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  });

  return {
    value,
    stop: () => {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
  };
}
