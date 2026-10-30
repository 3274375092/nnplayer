---
name: nnplayer
description: "The Warm Desk Radio：晒纸、泥炭与陶土焦橙组成的网易云音乐桌面播放器视觉系统。"
colors:
  burnt-terracotta: "#af3a03"
  ember-orange: "#d65d0e"
  terracotta-wash: "rgba(175, 58, 3, 0.12)"
  on-terracotta: "#fbf1c7"
  sunbaked-parchment: "#fbf1c7"
  parchment-card: "#f9f5d7"
  parchment-deep: "#f2e5bc"
  parchment-hover: "#ebdbb2"
  raised-paper: "#fcfbee"
  charcoal-ink: "#282828"
  peat: "#504945"
  ash: "#665c54"
  ink-whisper: "rgba(40, 40, 40, 0.05)"
  ink-veil: "rgba(40, 40, 40, 0.09)"
  ink-track: "rgba(40, 40, 40, 0.16)"
  amber-ambient: "#d79921"
  teal-ambient: "#458588"
  scrollbar-stone: "#bdae93"
  thumb-paper: "#f9f5d7"
typography:
  display:
    fontFamily: 'Segoe UI Variable Text, Segoe UI Variable, Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif'
    fontSize: "2.5rem"
    fontWeight: 650
    lineHeight: 1.12
    letterSpacing: "0em"
  headline:
    fontFamily: 'Segoe UI Variable Text, Segoe UI Variable, Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif'
    fontSize: "2rem"
    fontWeight: 680
    lineHeight: 1.2
    letterSpacing: "0em"
  title:
    fontFamily: 'Segoe UI Variable Text, Segoe UI Variable, Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif'
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0em"
  subtitle:
    fontFamily: 'Segoe UI Variable Text, Segoe UI Variable, Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif'
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0em"
  section:
    fontFamily: 'Segoe UI Variable Text, Segoe UI Variable, Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif'
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0em"
  body:
    fontFamily: 'Segoe UI Variable Text, Segoe UI Variable, Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif'
    fontSize: "14px"
    fontWeight: 450
    lineHeight: 1.5
    letterSpacing: "0em"
  label:
    fontFamily: 'Segoe UI Variable Text, Segoe UI Variable, Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif'
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "0em"
  micro:
    fontFamily: 'Segoe UI Variable Text, Segoe UI Variable, Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif'
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "0em"
    fontFeature: "tnum"
  lyric:
    fontFamily: 'Segoe UI Variable Text, Segoe UI Variable, Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif'
    fontSize: "0.975rem"
    fontWeight: 500
    lineHeight: 1.6
    letterSpacing: "0em"
  desktop-lyric:
    fontFamily: 'Segoe UI Variable Text, Segoe UI Variable, Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif'
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.06
    letterSpacing: "0em"
rounded:
  control: "6px"
  floating: "8px"
  btn: "10px"
  panel: "12px"
  cover: "18px"
  pill: "999px"
spacing:
  micro: "2px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
  section: "48px"
components:
  button-primary:
    backgroundColor: "{colors.burnt-terracotta}"
    textColor: "{colors.on-terracotta}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
    typography: "{typography.body}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.charcoal-ink}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
    typography: "{typography.body}"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.peat}"
    rounded: "{rounded.control}"
    width: "36px"
    height: "36px"
  play-button:
    backgroundColor: "{colors.burnt-terracotta}"
    textColor: "{colors.on-terracotta}"
    rounded: "{rounded.pill}"
    width: "40px"
    height: "40px"
  input:
    backgroundColor: "{colors.ink-whisper}"
    textColor: "{colors.charcoal-ink}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    typography: "{typography.body}"
  song-row:
    backgroundColor: "transparent"
    textColor: "{colors.charcoal-ink}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
    height: "60px"
  playlist-tile:
    backgroundColor: "transparent"
    textColor: "{colors.charcoal-ink}"
    rounded: "{rounded.cover}"
    width: "168px"
  lyric-card:
    backgroundColor: "{colors.raised-paper}"
    textColor: "{colors.charcoal-ink}"
    rounded: "{rounded.floating}"
    padding: "16px"
    typography: "{typography.lyric}"
  player-bar:
    backgroundColor: "{colors.raised-paper}"
    textColor: "{colors.charcoal-ink}"
    rounded: "{rounded.floating}"
    padding: "0px 18px"
    width: "780px"
    height: "76px"
  quality-chip:
    backgroundColor: "{colors.ink-whisper}"
    textColor: "{colors.peat}"
    rounded: "{rounded.pill}"
    padding: "0px 9px"
    height: "26px"
    typography: "{typography.micro}"
  queue-drawer:
    backgroundColor: "{colors.raised-paper}"
    textColor: "{colors.charcoal-ink}"
    rounded: "{rounded.floating}"
    width: "380px"
---

# Design System: nnplayer

## Overview

**Creative North Star: "The Warm Desk Radio"**

nnplayer 的界面像一台放在书桌上的暖灯收音机：底色是晒过的纸（`sunbaked-parchment`），文字是泥炭与炭墨，强调色是烧透的陶土（`burnt-terracotta`）。它复古、手作、略带怀旧，但不靠拟物取胜——没有木纹、皮革或旋钮，复古感只来自三样东西：Gruvbox Light 的纸色血统、当前专辑封面派生出的环境光、以及像纸片一样浮起来的控件。颜色被压到很低的存在感，材质感靠暖灰阴影与纸的明度差，而不是纹理。

系统的第二层是「会呼吸的纸」。播放时，封面调色板把背景从纸色轻微染成环境色（暖橙、冷蓝、旧金），并把强调色重新推导为在这张新纸上仍然可读的深陶土；正文与结构色（`charcoal-ink` / `peat` / `ash`）始终不变。于是换歌时只有“光”在变，纸和墨还是同一张纸、同一碟墨。这是这套系统里唯一的情绪表演，其余一切保持安静。

桌面歌词是唯一「离开纸面」的表面：透明窗口、白字黑描边，让歌词直接浮在桌面上，只继承当前封面的强调色。界面因此有两种观看距离：近处是书桌上的收音机，远处是墙上的字幕——主界面退后，歌词向前。

**Key Characteristics:**
- 暖纸底色 + 单一陶土强调色；强调面积小，出现位置固定（当前/主操作/播放）。
- 封面驱动的环境染色，但文字与结构色不变，对比度有硬下限。
- 近乎全平的层级：无边框，靠表面明度与两级暖阴影表达悬浮。
- 小字号、紧行距、系统字体；层级靠字重与色阶，不靠字号跨度。
- 复古手作的气质来自材质（纸、陶土、暖影），不来自纹理或拟物装饰。
- 桌面歌词透明、置顶、高对比，是唯一没有纸底的表面。

## Colors

调色板是一张暖纸加一撮陶土：中性色全部向黄红偏，强调色只有一种温度（陶土/琥珀橙），环境色从封面照片里提取。

### Primary
- **Burnt Terracotta** (#af3a03): 主强调色，陶土烧透的红。用于主按钮（播放全部、登录）、激活导航的文字与底色、当前歌曲行、播放按钮、音质菜单的“当前”标记、卡拉 OK 已唱字。默认值固定；播放时按封面重新派生，但必须保持“深陶土”的性格（明度落在 0.16–0.44，饱和度 0.48–0.76）。
- **Terracotta Wash** (rgba(175, 58, 3, 0.12)): 陶土的 12% 透明洗色，只用于“被选中/正在”的整块底色（激活导航、当前歌曲行、当前音质项、激活 Tab 的兜底），不叠加边框。

### Secondary
- **Ember Orange** (#d65d0e): 次强调色，比主色更亮更橙。用于进度条已播段渐变的第二端、透明桌面歌词的默认强调色（黑底上更亮更易读）、音质降级箭头等“需要被注意但不主导”的元素。

### Tertiary
- **Amber Ambient** (#d79921) / **Teal Ambient** (#458588): 从 Gruvbox 继承的辅助环境色，只出现在登录页背景的两团径向光晕与主题派生里。它们不与主色竞争，也不用于任何文本。

### Neutral
- **Sunbaked Parchment** (#fbf1c7): 全局纸底（`--color-bg`）。播放时被封面轻微染色，但始终是浅纸。
- **Parchment Card** (#f9f5d7) / **Parchment Deep** (#f2e5bc) / **Parchment Hover** (#ebdbb2): 纸的三档明度，用作卡片、背景渐变端点、悬停底。
- **Raised Paper** (#fcfbee): 比纸更亮一档的悬浮表面，用于播放条、歌词卡、登录面板、队列抽屉、弹层。
- **Charcoal Ink** (#282828): 主文字色，略带暖的炭黑，不纯黑。
- **Peat** (#504945) / **Ash** (#665c54): 二级与三级文字（艺人、辅助说明、时间）。
- **Ink Whisper** (rgba(40, 40, 40, 0.05)) / **Ink Veil** (rgba(40, 40, 40, 0.09)) / **Ink Track** (rgba(40, 40, 40, 0.16)): 用墨色透明度构造的三种表面（侧栏底、行悬停、进度槽），保证在任何封面染色的纸上都保持浅层级。
- **Scrollbar Stone** (#bdae93) / **Thumb Paper** (#f9f5d7): 滚动条轨道与滑块。

派生表面（由结构色计算，不新增色值，不要在别处重复定义）：
- `--color-canvas`: `color-mix(in srgb, var(--color-bg) 36%, #f6f7f6)` —— 应用最外层偏冷一档的纸灰，给内容区一点景深。
- `--color-glass`: `color-mix(in srgb, var(--color-bg) 94%, transparent)` —— 半透明纸面，用于需要透出底色的浮层。
- `--color-raised`: `color-mix(in srgb, var(--color-card) 42%, #fff)` —— 即上文的 Raised Paper。
- `--color-glow`: 陶土色的光晕，默认 14% 透明度，播放时升到 22%。

**The Paper-First Rule.** 所有界面表面必须是浅纸；不允许整块深色面板，也不做深色模式。深度只能通过纸的明度、墨的透明度和暖灰阴影产生，不能通过换到黑底。

**The Small Voice Rule.** 陶土红在任何一屏的覆盖面积不超过约 10–12%，只出现在“当前 / 主操作 / 播放”三类位置。它越少，越像一枚批注。

**The Quarry Rule.** 强调色可以被封面改变，但只允许在“深陶土”的明度/饱和度窗口内重新推导：强调色对五个纸面（bg、bg-from、bg-to、card、card-hover）的对比度必须 ≥ 4.6:1；不达标就继续压暗明度，直到达标或触底 0.16。

**The No-Line Rule.** `--color-border`、`--color-border-strong`、`--color-ring` 全部解析为 `transparent`。不要用 1px 描边分区；分区靠表面色差、留白与阴影。少数历史分隔线因此不可见（例如音质菜单页脚的 `border-top`），新组件不要再依赖它们。

## Typography

**Display Font / Body Font:** 系统 UI 字体栈 `"Segoe UI Variable Text", "Segoe UI Variable", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif`。项目不分发 Inter；Windows 上实际是 Segoe UI Variable，中文回退到苹方/微软雅黑。复古感来自颜色与材质，不来自复古字体。

**Label/Mono Font:** 无独立标签字体；数字统一使用 `font-variant-numeric: tabular-nums`。

**Character:** 系统原生、安静、偏小。层级主要靠字重（450 → 500 → 600 → 650/680）与文字色（炭墨 / 泥炭 / 灰）建立，字号跨度刻意收窄；最大的字留给歌词与正在播放页。

### Hierarchy
- **Display** (650, 2.5rem/40px, 1.12): 正在播放页的歌曲标题，唯一允许超过 32px 的正文；最多两行、`text-wrap: balance`。
- **Headline** (680, 2rem/32px, 1.2): 页面标题（每日推荐），上方配 10.9px/600 的 eyebrow（48% 墨色）。
- **Title** (600, 1.5rem/24px, 1.3): 次级页面标题（我的歌单、搜索、歌单详情）。
- **Subtitle** (600, 1.25rem/20px, 1.3): 登录页标题等单点标题。
- **Section** (600, 1rem/16px, 1.4): 列表小标题（今日推荐、搜索结果、播放队列）、侧栏品牌字。
- **Body** (450–500, 14px/1.5): 全局正文、列表标题、控件标签。
- **Label** (500–600, 12px/1.5): 元信息、艺人、列表表头、按钮内的小标签。
- **Micro** (500, 11px/1.5, tabular-nums): 播放时间、音质短标签、提示文案、桌面歌词悬浮按钮。这是系统的“最小可读字号”，不要再往下。
- **Lyric Line** (500–600, 0.975rem/15.6px, 1.6): 歌词面板的当前行与上下文行；距离越远越淡（见 Components）。
- **Desktop Lyric** (600, 28px 默认, 1.06): 透明桌面歌词，白字 + 0.55px 黑色描边 + 双层黑阴影；字号由用户按 14–48px 调节。

**The Weight-Not-Size Rule.** 界面内的层级优先用字重与文字色解决；除页面标题、正在播放标题、桌面歌词外，字号不超过 14px（列表标题 14、元信息 11–12）。

**The Tabular Time Rule.** 一切时间、时长、数量（播放时间、总时长、歌曲数、音质码率）使用 `tabular-nums`，避免播放时数字横向抖动。

## Layout

桌面壳布局：左侧固定导航轨（折叠 64px / 展开 240px，宽度与内边距以 220ms 过渡）+ 右侧内容壳。播放条是内容壳内绝对定位的悬浮件，桌面端 780×76、距底部 12px；内容区为它预留 100px 的滚动安全空间（窄屏 76px）。普通页面的滚动视口止于播放条上方，正在播放页与登录页例外（占满高度）。

页面容器最大 1440px 并水平居中，桌面内边距 32/24px，窄屏 20/12px。主要列表页采用“内容 + 歌词卡”两栏：每日推荐 1.65fr / 0.9fr、间距 2rem，歌词卡 sticky；搜索与歌单详情 2fr / 1fr（歌词卡最小 280px）。歌曲列表使用固定列网格 `40px 44px 1fr 160px 72px`、gap 12px、行高 60px；超过 160 首切换虚拟滚动。歌单网格 `repeat(auto-fill, minmax(168px, 1fr))`，列间距 22px、行间距 28px。

响应式：桌面窗口默认 1200×800，最小 960×640；`768px` 断点收起侧栏、单列堆叠、播放条 60px；`680px` 歌单网格降为 140px 最小列；`520px` 播放条只剩封面与中央控制。正在播放页与每日推荐页额外使用容器查询（38rem / 44rem / 52rem），因为它们在窄内容壳里也要重排。

**The Floating Last Rule.** 播放条永远悬浮在内容之上、始终水平居中于内容壳（不是整个窗口），滚动内容从它下方经过；不要在页面里再放一条贴底的播放控件。

**The 60-Pixel Row Rule.** 歌曲行固定 60px（含 10px 纵向内边距与 40px 封面），虚拟滚动以它为行高单位；任何新列表若要与歌曲列表并列，沿用这个行高。

## Elevation & Depth

扁平-悬浮混合：内容层是平的，没有边框、没有常驻卡片投影；深度来自纸的明度差和两种暖灰阴影。阴影只属于“真的浮起来”的表面——播放条、队列抽屉、音质弹层、被抬起的歌词卡、正在播放页封面、登录面板、搜索遮罩。阴影颜色是暖灰 `rgb(60 56 54)`，不是纯黑；透明度很低（6% / 12%），使悬浮物像纸片而不是玻璃。

### Shadow Vocabulary
- **Raised** (`box-shadow: 0 4px 16px rgb(60 56 54 / 6%)`): 常驻的轻浮起：页内歌词卡、正在播放页关闭按钮。
- **Floating** (`box-shadow: 0 12px 36px rgb(60 56 54 / 12%), 0 2px 6px rgb(60 56 54 / 5%)`): 真正漂浮的层：播放条、队列抽屉、音质菜单、登录面板、正在播放封面。
- **Accent Glow** (`0 8px 24px var(--color-glow)`；播放键为 `0 3px 10px var(--color-glow)`): 陶土色光晕，只给强调色元素（登录选中 Tab、歌单封面的播放浮层、播放键）。
- **Scrim**: 队列抽屉用 `rgba(0, 0, 0, 0.20)` 压暗页面；折叠侧栏的搜索弹层用 `rgba(0, 0, 0, 0.60)` + 8px 背景模糊。遮罩是这套系统里唯一允许的黑。

**The Flat-At-Rest Rule.** 静止的内容没有阴影。只有当元素在交互中“离开纸面”（悬停上浮、浮层、按下缩放）时，才允许加 Raised / Floating。

**The Two-Shadow Rule.** 新组件只使用 Raised 与 Floating 两个阴影 token。仓库里残留的旧深色主题阴影（如歌单封面悬停的 `0 18px 38px rgba(0, 0, 0, 0.38)`）是历史例外，不要复制到新代码。

## Shapes

圆润、无棱角的几何：所有可见容器都有圆角，圆角随表面尺寸增大（控件 6px → 浮层 8px → 小面板 10px → 面板 12px → 歌单封面 18px → 胶囊/头像/播放键全圆）。没有硬边框；唯一的“线”是焦点环（2px 陶土描边，菜单内为 -2px 内嵌偏移）和桌面歌词的字体内描边。播放键是 40px 的圆形陶土钮，是系统中唯一的高饱和圆形；歌曲缩略图统一 6px 圆角方形，歌单大封面统一 18px。

歌词视口用上下渐隐遮罩（`linear-gradient`：0% 透明 → 12% 实 → 88% 实 → 100% 透明）裁切滚动边缘，让歌词像从纸里浮现，而不是被硬切。

**The Nested Rounding Rule.** 圆角随层级走：外层浮层 8/12px，内层行与按钮 6px，缩略图 6px，胶囊 999px；不要把大圆角套在小圆角外面。

**The Soft Square Rule.** 封面永远是圆角方形（缩略图 6px、歌单大封面 18px）；只有头像、播放键、音量滑块拇指是正圆。不要让封面变正圆或加白边。

## Components

### Buttons
克制的实体感：无边框、无阴影，颜色即层级；按下缩 3%，悬停最多上移 1px。
- **Shape:** 6px 圆角，内边距 8px 16px，14px/500。
- **Primary:** 陶土底 + 纸色字；每屏最多一个主操作（播放全部、登录）；hover 不变色，`:active` 缩放 0.97。
- **Ghost:** 透明底、炭墨字；hover 用 `parchment-hover` 底，`:active` 缩放 0.97；用于次要操作与取消。
- **Icon buttons（播放控制）:** 36×36、6px 圆角、透明底、`peat` 色图标；hover 用 `ink-whisper` 底并上移 1px，active 缩 0.95。播放/暂停是 40px 圆形陶土钮，带陶土光晕，hover 放大 1.045，禁用时 28% 不透明度。
- **Focus:** 2px 陶土 `outline`，偏移 2px（菜单项用 -2px 内嵌），确保 forced-colors 下仍可见。

### Chips
- **Quality badge（播放条音质胶囊）:** 高 26px、999px 圆角、`ink-whisper` 底、`peat` 字，11px/500 带 13px 图标；展开时字变陶土；降级时显示实际档位并加一个 10px 的 `ember-orange` 向下箭头。
- **“当前”标记（音质菜单）:** 10px、999px、陶土 12% 底、陶土字，只标注服务端实际值，不与勾选重复。
- **Segmented tabs（登录方式）:** 外层 12px 圆角 `ink-whisper` 容器 + 内层 8px 圆角按钮；选中用陶土实底 + 纸色字 + 陶土光晕。

### Cards / Containers
- **Corner Style:** 浮层 8px；面板 12px；歌词卡 8px。
- **Background:** 页内歌词卡用 `raised-paper`；普通内容卡片保持透明，靠留白与列表分组，不做卡片堆叠。
- **Shadow Strategy:** 只对悬浮卡用 Raised；见 Elevation。
- **Border:** 无；`--color-border` 是透明 token。
- **Internal Padding:** 卡片 16–32px；歌词卡 16px；播放条左右 18px。

### Inputs / Fields
- **Style:** `ink-whisper` 底、6px 圆角、12px × 8px 内边距、无边框，占位符 `ash`。
- **Focus:** 底色切到更亮的 `raised-paper`，并出现 2px 陶土 outline（偏移 1px）；不要用 box-shadow 做焦点。
- **Error:** 陶土色小字紧贴控件下方，错误文字不使用 placeholder 替代（登录失败即显示陶土小字）。

### Navigation
- **Sidebar rail:** 折叠 64px（只留图标）/ 展开 240px（品牌字 + 搜索框 + 文字导航）；底色 `ink-whisper`，宽度与内边距 220ms 过渡。
- **Item:** 48px 高、6px 圆角、14px；默认 `peat` 字、透明底；hover `parchment-hover` 底 + 炭墨字；激活为陶土字 + 陶土洗色底 + 500 字重。图标 18px、1.75 描边（Lucide）。
- **底部操作:** 40px 高、12px 圆角；折叠态的搜索按钮是 40×40、12px 圆角、`parchment-hover` 底的图标块。
- **窄窗:** 768px 以下侧栏整体隐藏，控制交给系统媒体键与托盘（桌面应用的使用场景），不额外引入抽屉导航。

### Player bar（签名组件）
- **Shape:** 780×76、8px 圆角、`raised-paper` 底、Floating 阴影；三段网格 `1fr clamp(236px, 44%, 320px) 1fr`，左右内边距 18px，间距 16px。
- **Left:** 48px 封面（6px 圆角，悬停上浮 1px，点击进入正在播放）+ 两行歌名/艺人（14px/500 与 12px），超长用 hover 才启动的跑马灯。
- **Center:** 播放模式 / 上一首 / 40px 圆形播放键 / 下一首；下方 4px 进度槽（`ink-track`）+ 陶土→琥珀渐变已播段 + 两端 11px 等宽时间。进度输入透明覆盖，悬停时出现 10px 纸色滑块与时间气泡。
- **Right:** 音质胶囊 + 15px 音量图标 + 4px 轨道滑块（陶土拇指）；音量区默认 72% 不透明度，悬停播放条或聚焦滑块时升到 100%。
- **States:** 加载时播放键内显示旋转 Loader；播放中播放键有 2s 的陶土脉冲光环；禁用按钮 28% 不透明度。

### Song row（签名组件）
- 60px 网格行：序号/播放图标（12px，hover 时序号淡出换成播放图标）、40px 封面缩略图（6px 圆角）、标题 14px + 艺人 12px、专辑 12px、时长 11px 等宽。
- 当前行整行铺 `terracotta-wash`，标题加 500 字重，序号位显示陶土播放图标或脉冲；其他行 hover 铺 `ink-veil`。

### Queue drawer
- 固定右侧 16px 的 380px 面板（最大 `100vw - 32px`）、8px 圆角、`raised-paper` + Floating 阴影，页面压暗 20%；头部 20px 内边距，行 36px 缩略图 + 两行文字 + 时长 + hover 才出现的删除按钮；空态是 40px 音符图标 + 一句灰字。

### Desktop lyrics（签名组件）
- 独立透明窗口（默认 800×200，置顶、跳过任务栏），无背景、无边框；不透明度由用户按 0.2–1.0 控制。
- **当前行:** 28px 默认（可调 14–48px）、600、行高 1.06、白字 95%，黑色 0.55px 描边 + 双层黑阴影；有 YRC 时逐字双层 span 擦色（已唱陶土 → 未唱白），没有逐字时间戳时不伪造进度。
- **上下文:** 上一行左上、下一行右下，字号 `clamp(11px, 42% × 当前字号, 16px)`，白色 62–74%，最大宽度 42%；翻译行 38% 字号、72% 白。
- **悬浮工具条:** 顶部右侧、`rgba(0, 0, 0, 0.6)` + 12px 背景模糊 + 内嵌高光与 24px 浮影，20px 方形按钮、4px 圆角；只在 hover/focus 时出现，出现时为内容让出右侧 300px。
- **长行处理:** 当前行与翻译按可用宽度整体缩放（transform），永不横向滚动，用户保存的字号不变。

### Progress / Slider
- 播放进度：4px 轨道（`ink-track`），已播段是陶土→琥珀的水平渐变，圆头；悬停出现 10px 纸色滑块与时间气泡。音量滑块：4px 轨道 + 13px 陶土拇指。

## Do's and Don'ts

### Do:
- **Do** 让背景永远是纸：浅底、暖中性、随封面轻微染色；结构文字固定用 `charcoal-ink` / `peat` / `ash`。
- **Do** 把陶土红当批注用：主按钮、激活导航、当前行、播放键、已唱字；单屏面积 10–12% 以内。
- **Do** 用表面明度（`ink-whisper` / `ink-veil` / `raised-paper`）和两级暖阴影表达层级；边框保持透明。
- **Do** 用字重与文字色做层级，正文 14px、元信息 11–12px；时间、时长、数量用 `tabular-nums`。
- **Do** 让悬浮件真的浮起：播放条、抽屉、菜单、歌词卡用 Raised/Floating；静止内容保持平。
- **Do** 遵守派生对比度下限：强调色对五个纸面 ≥ 4.6:1，正文对染色纸 ≥ 4.65:1；不达标就继续压暗或降低染色强度。
- **Do** 尊重 `prefers-reduced-motion`：弹簧退化为直接定位，动画时长 0.01ms，播放键脉冲关闭。
- **Do** 保持焦点可见：2px 陶土 outline（菜单内 -2px 内嵌），不要只靠背景色区分。

### Don't:
- **Don't** 使用深色面板或深色模式作为内容表面；纸是第一位的（唯一例外是模态遮罩与桌面歌词的黑色描边）。
- **Don't** 从封面派生文字色；封面只影响背景染色与环境强调色。
- **Don't** 用 1px 边框、分隔线或描边分区；它们会解析成透明（音质菜单页脚就是现状）。
- **Don't** 复制旧深色主题的黑色投影（如 `0 18px 38px rgba(0, 0, 0, 0.38)`）；只用 Raised / Floating / Accent Glow。
- **Don't** 把界面字号推到 16px 以上（页面标题、正在播放标题、桌面歌词除外），也不要用渐变文字、霓虹色或调色板外的饱和色。
- **Don't** 给扁平内容加阴影或卡片堆叠；不要做通用后台仪表盘式的卡片网格。
- **Don't** 在没有逐字时间戳时伪造卡拉 OK 进度；状态诚实优先于动效。
- **Don't** 加入广告、运营位、社交或直播入口——这与产品定位冲突，也不属于这套视觉。
