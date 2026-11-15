// 背景 inert 的引用计数（纯逻辑，不接触 DOM）。
//
// 同一个目标（例如应用壳 #app）可能同时被多个模态持有：只有最后一个持有者
// 释放时才应该摘掉 inert 属性，否则「关闭较新的弹层」会把背景提前解禁。
// 这里只做「目标 → 持有者数量」的状态迁移；查询元素、写属性由
// useBackgroundInert 负责，所以该模块可以直接用 node --test 覆盖边界情况。

/** 每个目标当前的持有者数量；不存在的键等同于 0。 */
export type InertRefCounts<K> = Map<K, number>;

/**
 * 为每个目标登记一个持有者。
 * 返回本次从 0 变成 1、需要真正写入 inert 的目标（保持首次出现顺序，
 * 同一次调用里的重复目标只登记一次）。
 */
export function acquireInertRefs<K>(
  counts: InertRefCounts<K>,
  targets: Iterable<K>,
): K[] {
  const activated: K[] = [];
  const seen = new Set<K>();
  for (const target of targets) {
    if (seen.has(target)) continue;
    seen.add(target);
    const next = (counts.get(target) ?? 0) + 1;
    counts.set(target, next);
    if (next === 1) activated.push(target);
  }
  return activated;
}

/**
 * 释放每个目标的一个持有者。
 * 返回本次从 1 变成 0、需要真正摘掉 inert 的目标；未知目标（重复释放）忽略，
 * 计数不会变成负数，也不会误摘其它持有者仍持有的目标。
 */
export function releaseInertRefs<K>(
  counts: InertRefCounts<K>,
  targets: Iterable<K>,
): K[] {
  const released: K[] = [];
  const seen = new Set<K>();
  for (const target of targets) {
    if (seen.has(target)) continue;
    seen.add(target);
    const current = counts.get(target);
    if (current === undefined) continue;
    if (current <= 1) {
      counts.delete(target);
      released.push(target);
    } else {
      counts.set(target, current - 1);
    }
  }
  return released;
}
