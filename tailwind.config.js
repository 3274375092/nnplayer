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
        ring: "var(--color-ring)",
        text: {
          primary: "var(--color-text-primary)",
          secondary: "var(--color-text-secondary)",
          tertiary: "var(--color-text-tertiary)",
        },
        accent: "var(--color-accent)",
        "accent-secondary": "var(--color-accent-secondary)",
        "accent-subtle": "var(--color-accent-subtle)",
      },
      borderRadius: {
        DEFAULT: "12px",
        card: "12px",
        btn: "10px",
      },
      boxShadow: {
        soft: "0 2px 8px rgba(0, 0, 0, 0.2)",
        card: "0 4px 20px var(--color-shadow)",
      },
      backdropBlur: {
        lg: "16px",
        xl: "24px",
      },
      transitionProperty: {
        DEFAULT: "color, background-color, border-color, transform, opacity, box-shadow",
      },
      keyframes: {
        "spin-slow": {
          from: { transform: "rotate(0deg)" },
          to: { transform: "rotate(360deg)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-400px 0" },
          "100%": { backgroundPosition: "400px 0" },
        },
        "play-pulse": {
          "0%, 100%": { boxShadow: "0 0 0 0 var(--color-accent-subtle)" },
          "50%": { boxShadow: "0 0 0 10px transparent" },
        },
        "cover-glow": {
          "0%, 100%": { opacity: "0.5" },
          "50%": { opacity: "1" },
        },
        "fade-in-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "spin-slow": "spin-slow 8s linear infinite",
        shimmer: "shimmer 1.6s linear infinite",
        "play-pulse": "play-pulse 2s ease-in-out infinite",
        "cover-glow": "cover-glow 2.5s ease-in-out infinite",
        "fade-in-up": "fade-in-up 0.35s ease-out",
      },
    },
  },
  plugins: [],
};
