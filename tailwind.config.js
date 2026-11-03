/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{vue,js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--color-bg)",
        card: "var(--color-card)",
        "card-hover": "var(--color-card-hover)",
        hover: "var(--color-card-hover)",
        border: "var(--color-border)",
        "border-strong": "var(--color-border-strong)",
        text: {
          primary: "var(--color-text-primary)",
          secondary: "var(--color-text-secondary)",
          tertiary: "var(--color-text-tertiary)",
        },
        accent: "var(--color-accent)",
        "accent-secondary": "var(--color-accent-secondary)",
        "accent-subtle": "var(--color-accent-subtle)",
        "accent-on-subtle": "var(--color-accent-on-subtle)",
        glass: "var(--color-glass)",
        "surface-soft": "var(--color-surface-soft)",
        "surface-strong": "var(--color-surface-strong)",
        track: "var(--color-track)",
        thumb: "var(--color-thumb)",
      },
      borderRadius: {
        DEFAULT: "12px",
        card: "12px",
        btn: "10px",
      },
      backdropBlur: {
        lg: "16px",
        xl: "24px",
      },
      transitionProperty: {
        DEFAULT: "color, background-color, border-color, transform, opacity, box-shadow",
      },
      // 纸面只用 Raised / Floating 两个阴影 token（styles.css 的 --shadow-*），
      // 这里不再提供 Tailwind 默认黑色投影：旧 soft/card 两个条目没有任何消费者，
      // 其中 soft 是纯黑投影，会破坏 Two-Shadow Rule。
      keyframes: {
        // 播放中光环：只用 transform/opacity（合成层），不逐帧重绘 box-shadow。
        "play-ring": {
          "0%": { transform: "scale(0.85)", opacity: "0.5" },
          "75%, 100%": { transform: "scale(1.6)", opacity: "0" },
        },
        // 当前行/队列播放图标的呼吸：只动 opacity。
        "pulse-fade": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
        "fade-in-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "play-ring": "play-ring 2s ease-out infinite",
        "pulse-fade": "pulse-fade 2s ease-in-out infinite",
        "fade-in-up": "fade-in-up 0.35s ease-out",
      },
    },
  },
  plugins: [],
};
