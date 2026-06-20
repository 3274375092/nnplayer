/// <reference types="vite/client" />

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
  function md5(input: string | ArrayBuffer | Uint8Array): string;
  export default md5;
}