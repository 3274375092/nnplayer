export default {
  plugins: {
    // Tailwind 4 的 PostCSS 插件已独立成包；autoprefixer 不再需要
    // （v4 通过 Lightning CSS 自行处理厂商前缀）
    "@tailwindcss/postcss": {},
  },
};