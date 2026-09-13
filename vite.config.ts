import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// Vite 配置：固定端口 + 关闭 host 检查（Tauri 桌面端需要）
export default defineConfig(async () => ({
  plugins: [vue()],

  // @/ 别名：与 tsconfig.json 的 paths 保持一致
  // （Vite 不会自动读 tsconfig.paths，必须在这里再声明一次）
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  // Tauri 在开发时会读取 1420 端口
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: process.env.TAURI_DEV_HOST || false,
    hmr: {
      protocol: "ws",
      host: "localhost",
      port: 1421,
    },
    watch: {
      // 防止 Vite 监听 src-tauri 目录造成 Rust 文件被频繁重建
      ignored: ["**/src-tauri/**"],
    },
  },

  // 在构建时预定义环境变量
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    // Tauri 使用 Chromium，请勿使用 ES2020 之前未支持的语法
    target: process.env.TAURI_ENV_PLATFORM == "windows" ? "chrome105" : "safari13",
    // Vite 8 基于 rolldown，默认压缩器已是 oxc。
    // 显式指定 "esbuild" 会失败：Vite 8 不再随包提供 esbuild，而 esbuild
    // 仅作为传递依赖时不会出现在全新安装中（CI 就是这么挂的）。
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
}));