/// <reference types="vite/client" />

/** 构建时由 vite.config.ts 从 package.json 注入的版本号。 */
declare const __APP_VERSION__: string;

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

declare module "blueimp-md5" {
  /**
   * 计算字符串的 MD5 摘要（小写 hex 形式）。
   * 默认实现与 Node.js crypto / 浏览器 spark-md5 一致。
   */
  function md5(input: string, key?: string, raw?: boolean): string;
  export default md5;
}
