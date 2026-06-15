/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{vue,js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // === UI 规范颜色（柔和米黄体系）===
        bg: "#FAFCE4",          // 主背景
        card: "#F5F7E1",        // 卡片 / 侧边栏
        hover: "#EEF0D8",       // 悬浮态
        text: {
          primary: "#373737",  // 主要文字
          secondary: "#8C8C8C",// 次要文字
        },
        accent: "#E85D3A",      // 强调色 / 激活态
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
    },
  },
  plugins: [],
};