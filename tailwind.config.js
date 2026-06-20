/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{vue,js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // === UI 规范颜色（柔和米黄体系）===
        // CSS 变量驱动：阶段1 主题色切换时由 stores/theme.ts 改写 :root
        // 默认值在 src/styles.css 的 :root 块里定义
        bg: "var(--color-bg)",
        card: "var(--color-card)",
        hover: "var(--color-hover)",
        text: {
          primary: "var(--color-text-primary)",
          secondary: "var(--color-text-secondary)",
        },
        accent: "var(--color-accent)",
      },
      borderRadius: {
        // 大圆角
        DEFAULT: "12px",
        card: "12px",
        btn: "10px",
      },
      boxShadow: {
        // 轻阴影
        soft: "0 2px 8px rgba(55, 55, 55, 0.06)",
        card: "0 4px 16px rgba(55, 55, 55, 0.08)",
      },
      backdropBlur: {
        lg: "16px",
      },
      transitionProperty: {
        // 让过渡更平滑
        DEFAULT: "color, background-color, border-color, transform, opacity",
      },
      keyframes: {
        // 阶段4：播放栏封面旋转
        "spin-slow": {
          from: { transform: "rotate(0deg)" },
          to: { transform: "rotate(360deg)" },
        },
        // 阶段4：骨架屏微光闪烁
        shimmer: {
          "0%": { backgroundPosition: "-400px 0" },
          "100%": { backgroundPosition: "400px 0" },
        },
      },
      animation: {
        "spin-slow": "spin-slow 8s linear infinite",
        shimmer: "shimmer 1.6s linear infinite",
      },
    },
  },
  plugins: [],
};