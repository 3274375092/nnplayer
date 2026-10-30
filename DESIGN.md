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
  lyric-plate: "rgba(0, 0, 0, 0.88)"
  amber-ambient: "#d79921"
  ochre-ambient: "#a95823"
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
    fontSize: "32px"
    fontWeight: 600
    lineHeight: 1.06
    letterSpacing: "0em"
  mono:
    fontFamily: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace'
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
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

系统的第二层是「会呼吸的纸」。播放时，封面调色板把背景从纸色轻微染成环境色，并把强调色重新推导为在这张新纸上仍然可读的深陶土；正文与结构色（`charcoal-ink` / `peat` / `ash`）始终不变。于是换歌时只有“光”在变：光可以更暖、更亮、更旧金，但不会变成绿或蓝；强调色的色相始终被收在暖色窗口（10°–55°，陶土≈20°、琥珀≈40°）内，绿/蓝/紫封面只能改变光的暖度与染色强度，不能取代品牌色相。纸和墨还是同一张纸、同一碟墨。这是这套系统里唯一的情绪表演，其余一切保持安静。

桌面歌词是唯一「离开纸面」的表面：透明窗口、白字叠半透明深色文字底板（`lyric-plate`），让歌词直接浮在任意壁纸上，只继承当前封面的强调色（高明度、向白色提亮，且同样收在暖色窗口内）。界面因此有两种观看距离：近处是书桌上的收音机，远处是墙上的字幕——主界面退后，歌词向前。

**Key Characteristics:**
- 暖纸底色 + 单一陶土强调色；强调面积小，出现位置固定（当前/主操作/播放）。
- 封面驱动的环境染色（始终暖、向陶土拉近），强调色收在暖色窗口；文字与结构色不变，对比度有硬下限。
- 近乎全平的层级：无边框，靠表面明度与两级暖阴影表达悬浮。
- 小字号、紧行距、系统字体；层级靠字重与色阶，不靠字号跨度。
- 复古手作的气质来自材质（纸、陶土、暖影），不来自纹理或拟物装饰。
- 桌面歌词透明、置顶、高对比（文字叠半透明深色底板），是唯一没有纸底的表面。

## Colors

调色板是一张暖纸加一撮陶土：中性色全部向黄红偏，强调色只有一种温度（陶土/琥珀橙），环境色从封面照片里提取——但提取出的色相会被折叠进暖色窗口并向陶土拉近，所以纸面与光始终暖，不会出现冷绿/冷蓝底；无封面时的静态兜底光也同为 amber/ochre 暖色。

### Primary
- **Burnt Terracotta** (#af3a03): 主强调色，陶土烧透的红。用于主按钮（播放全部、登录）、激活导航的文字与底色、当前歌曲行、播放按钮、音质菜单的“实际”标记、卡拉 OK 已唱字。默认值固定；播放时按封面重新派生色相，但必须保持“深陶土”的性格（色相收在 10°–55°暖色窗口内，明度落在 0.16–0.44，饱和度 0.48–0.76）。
- **Terracotta Wash** (rgba(175, 58, 3, 0.12)): 陶土的 12% 透明洗色，只用于“被选中/正在”的整块底色（激活导航、当前歌曲行、当前音质项、激活 Tab 的兜底），不叠加边框。洗色上的文字不直接用强调色，改用同色相压暗一档的 `--color-accent-on-subtle`（对洗色底 ≥4.6:1）。

### Secondary
- **Ember Orange** (#d65d0e): 次强调色，比主色更亮更橙。用于进度条已播段渐变的第二端、透明桌面歌词的默认强调色（黑底上更亮更易读）、音质降级箭头等“需要被注意但不主导”的元素。播放时它同样由封面色相派生，并被收进暖色窗口、与主强调色保持同一色相家族。

### Tertiary
- **Amber Ambient** (#d79921) / **Ochre Ambient** (#a95823): 在 Gruvbox 暖色血统上派生的辅助环境色，只出现在登录页背景的两团径向光晕与主题派生里。静态默认（无封面/未播放）也保持暖色家族：琥珀与深赭，登录页不出现冷青/冷蓝光晕；播放时派生的环境光色相会先折叠进暖色窗口、再向陶土拉近约 68%，即使封面是绿/蓝，光晕也不会变成冷色。它们不与主色竞争，也不用于任何文本。

### Neutral
- **Sunbaked Parchment** (#fbf1c7): 全局纸底（`--color-bg`）。播放时被封面轻微染色，但始终是浅纸，且永远暖于中性：染色后仍保持红 > 绿 > 蓝通道。
- **Parchment Card** (#f9f5d7) / **Parchment Deep** (#f2e5bc) / **Parchment Hover** (#ebdbb2): 纸的三档明度，用作卡片、背景渐变端点、悬停底。
- **Raised Paper** (#fcfbee): 比纸更亮一档的悬浮表面，用于播放条、歌词卡、登录面板、队列抽屉、弹层。
- **Charcoal Ink** (#282828): 主文字色，略带暖的炭黑，不纯黑。
- **Peat** (#504945) / **Ash** (#665c54): 二级与三级文字（艺人、辅助说明、时间）。
- **Ink Whisper** (rgba(40, 40, 40, 0.05)) / **Ink Veil** (rgba(40, 40, 40, 0.09)) / **Ink Track** (rgba(40, 40, 40, 0.16)): 用墨色透明度构造的三种表面（侧栏底、行悬停、进度槽），保证在任何封面染色的纸上都保持浅层级。
- **Scrollbar Stone** (#bdae93) / **Thumb Paper** (#f9f5d7): 滚动条轨道与滑块。

派生表面（由结构色计算，不新增色值，不要在别处重复定义）：
- `--color-bg` / `--color-bg-from` / `--color-bg-to`: 播放时由封面染色，但染色色相先折叠进暖色窗口并向陶土拉近约 68%，三档纸面始终保持暖调（红 > 绿 > 蓝）且对正文对比度 ≥ 4.65:1。
- `--color-canvas`: `color-mix(in srgb, var(--color-bg) 36%, #f6f7f6)` —— 应用最外层偏冷一档的纸灰，给内容区一点景深。
- `--color-glass`: `color-mix(in srgb, var(--color-bg) 94%, transparent)` —— 半透明纸面，用于需要透出底色的浮层。
- `--color-raised`: `color-mix(in srgb, var(--color-card) 42%, #fff)` —— 即上文的 Raised Paper。
- `--color-glow`: 暖色光晕（陶土-琥珀家族，来自收敛后的强调色），默认 14% 透明度，播放时升到 22%。
- `--color-accent-on-subtle`: 强调色文字叠在 `accent-subtle` 洗色上时的专用色（激活导航文字、队列“播放中/已暂停”徽标）。由强调色保持色相/饱和度、压暗明度得到，不换成正文墨色；对侧栏（surface-soft 叠 canvas）、窄窗侧栏浮层（纸色）与队列双层洗色三种真实合成底的对比度均 ≥ 4.6:1（实现按 4.65:1 推导，留渲染余量）。

**The Paper-First Rule.** 所有界面表面必须是浅纸，且必须是暖纸（封面染色后仍保持红 > 绿 > 蓝）；不允许整块深色面板，也不做深色模式（唯一例外是桌面歌词的半透明深色文字底板，见 Components）。深度只能通过纸的明度、墨的透明度和暖灰阴影产生，不能通过换到黑底。

**The Small Voice Rule.** 陶土红在任何一屏的覆盖面积不超过约 10–12%，只出现在“当前 / 主操作 / 播放”三类位置。它越少，越像一枚批注。

**The Quarry Rule.** 强调色可以被封面改变，但只允许在“深陶土”的色相/明度/饱和度窗口内重新推导：色相必须落在暖色窗口 10°–55°（陶土≈20°、琥珀≈40°）——封面是暖色时保留其色相，冷色圆弧（绿/蓝/紫）被连续折叠回暖色窗口，因此整站强调色始终属于陶土-琥珀家族；明度落在 0.16–0.44、饱和度 0.48–0.76。强调色对五个纸面（bg、bg-from、bg-to、card、card-hover）的对比度必须 ≥ 4.6:1；不达标就继续压暗明度，直到达标或触底 0.16。

**The No-Line Rule.** `--color-border`、`--color-border-strong`、`--color-ring` 全部解析为 `transparent`。不要用 1px 描边分区；分区靠表面色差、留白与阴影。少数历史分隔线因此不可见（例如音质菜单页脚的 `border-top`），新组件不要再依赖它们。

## Typography

**Display Font / Body Font:** 系统 UI 字体栈 `"Segoe UI Variable Text", "Segoe UI Variable", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif`。项目不分发 Inter；Windows 上实际是 Segoe UI Variable，中文回退到苹方/微软雅黑。复古感来自颜色与材质，不来自复古字体。

**Label/Mono Font:** 无独立标签字体；数字统一使用 `font-variant-numeric: tabular-nums`。技术详情、错误原文等代码式文本使用 `ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace`（`mono` 11px/1.5），只用于排障内容，不用于界面标签。

**Character:** 系统原生、安静、偏小。层级主要靠字重（450 → 500 → 600 → 650/680）与文字色（炭墨 / 泥炭 / 灰）建立，字号跨度刻意收窄；最大的字留给歌词与正在播放页。

### Hierarchy
- **Display** (650, 2.5rem/40px, 1.12): 正在播放页的歌曲标题，唯一允许超过 32px 的正文；最多两行、`text-wrap: balance`。
- **Headline** (680, 2rem/32px, 1.2): 页面标题（每日推荐）直接承担页头权重，不设 eyebrow/kicker；同组副标题 78% 墨色、日期 84% 墨色，装饰分隔符 45% 且 `aria-hidden`。
- **Title** (600, 1.5rem/24px, 1.3): 次级页面标题（我的歌单、搜索、歌单详情）。
- **Subtitle** (600, 1.25rem/20px, 1.3): 登录页标题等单点标题。
- **Section** (600, 1rem/16px, 1.4): 列表小标题（今日推荐、搜索结果、播放队列）、侧栏品牌字。
- **Body** (450–500, 14px/1.5): 全局正文、列表标题、控件标签。
- **Label** (500–600, 12px/1.5): 元信息、艺人、列表表头、按钮内的小标签。
- **Micro** (500, 11px/1.5, tabular-nums): 播放时间、音质短标签、提示文案、桌面歌词悬浮按钮。这是系统的“最小可读字号”，不要再往下。
- **Lyric Line** (500–600, 0.975rem/15.6px, 1.6): 歌词面板的当前行与上下文行；当前行实底 `charcoal-ink` + 600 + 8% accent 洗色（≥11.5:1），邻近/次近/远行依次 90%/80%/70% 墨色（最暗染色纸端点 8.93 / 6.64 / 4.95:1），hover 同实底；翻译行 70% 墨、当前行翻译实底。距离越远越淡但不再低于正文下限。
- **Desktop Lyric** (600, 32px 默认, 1.06): 透明桌面歌词，白字 95%（或用户主题色）叠半透明深色底板 `rgba(0, 0, 0, 0.88)`（1px 内嵌白 22% 描边 + 浮影）；字号由用户按 14–48px 调节。默认不透明度 0.95 下白字对底板约 13.2:1（100% 时约 15:1）；不透明度低于 0.5 属于用户主动降可见度，不保证该对比度。

**The Weight-Not-Size Rule.** 界面内的层级优先用字重与文字色解决；除页面标题、正在播放标题、桌面歌词外，字号不超过 14px（列表标题 14、元信息 11–12）。

**The Tabular Time Rule.** 一切时间、时长、数量（播放时间、总时长、歌曲数、音质码率）使用 `tabular-nums`，避免播放时数字横向抖动。

## Layout

桌面壳布局：左侧固定导航轨（折叠 64px / 展开 240px，宽度与内边距以 220ms 过渡）+ 右侧内容壳。播放条是内容壳内绝对定位的悬浮件，桌面端 780×76、距底部 12px；内容区为它预留 100px 的滚动安全空间（窄屏 76px）。普通页面的滚动视口止于播放条上方，正在播放页与登录页例外（占满高度）。

页面容器最大 1440px 并水平居中，桌面内边距 32/24px，窄屏 20/12px。主要列表页采用“内容 + 歌词卡”两栏：每日推荐 1.65fr / 0.9fr、间距 2rem，歌词卡 sticky；搜索与歌单详情 2fr / 1fr（歌词卡最小 280px）。歌曲列表使用固定列网格 `40px 44px 1fr 160px 72px`、gap 12px、行高 60px；超过 160 首切换虚拟滚动。歌曲列表以自身容器宽度为准：列表容器窄于 `34rem` 时隐藏专辑列（网格改为 `36px 40px 1fr 52px`），把宽度让给标题/艺人；SongList 的 `container-type: inline-size` 在 `SongList.vue`，列表容器查询优先于窗口宽度。歌单网格 `repeat(auto-fill, minmax(168px, 1fr))`，列间距 22px、行间距 28px。

响应式：桌面窗口默认 1200×800，最小 960×640；验收基线覆盖 **960×640 与 768×512 CSS 两档**（125% 缩放下 960×640 物理窗口的实际 CSS 视口为 768×512）。`768px` 以下侧栏收成 64px 图标轨道（可临时展开为 240px 浮层），内容单列堆叠，播放条降为 60px、隐藏音量但保留音质入口；`680px` 歌单网格降为 140px 最小列；`520px` 以下播放条只留封面、中央控制与图标化音质入口。正在播放页与每日推荐页额外使用容器查询（38rem / 44rem / 52rem），因为它们在窄内容壳里也要重排。

**The Floating Last Rule.** 播放条永远悬浮在内容之上、始终水平居中于内容壳（不是整个窗口），滚动内容从它下方经过；不要在页面里再放一条贴底的播放控件。

**The 60-Pixel Row Rule.** 歌曲行固定 60px（含 10px 纵向内边距与 40px 封面），虚拟滚动以它为行高单位；任何新列表若要与歌曲列表并列，沿用这个行高。

## Elevation & Depth

扁平-悬浮混合：内容层是平的，没有边框、没有常驻卡片投影；深度来自纸的明度差和两种暖灰阴影。阴影只属于“真的浮起来”的表面——播放条、队列抽屉、音质弹层、被抬起的歌词卡、正在播放页封面、登录面板、搜索遮罩。纸面阴影颜色是暖灰 `rgb(60 56 54)`，不是纯黑；透明度很低（6% / 12%），使悬浮物像纸片而不是玻璃。只有桌面歌词文字底板落在纸外，使用半透明黑与内嵌白高光（见 Components）。

### Shadow Vocabulary
- **Raised** (`box-shadow: 0 4px 16px rgb(60 56 54 / 6%)`): 常驻的轻浮起：页内歌词卡、正在播放页关闭按钮。
- **Floating** (`box-shadow: 0 12px 36px rgb(60 56 54 / 12%), 0 2px 6px rgb(60 56 54 / 5%)`): 真正漂浮的层：播放条、队列抽屉、音质菜单、登录面板、正在播放封面。
- **Accent Glow** (`0 8px 24px var(--color-glow)`；播放键为 `0 3px 10px var(--color-glow)`): 暖色光晕（陶土-琥珀家族，来自收敛后的强调色），只给强调色元素（登录选中 Tab、歌单封面的播放浮层、播放键）。
- **Scrim**: 队列抽屉与窄窗临时展开的侧栏浮层都用 `rgba(0, 0, 0, 0.20)` 压暗页面；折叠侧栏的搜索弹层用 `rgba(0, 0, 0, 0.60)` + 8px 背景模糊；桌面歌词文字底板用 `rgba(0, 0, 0, 0.88)`。遮罩、桌面歌词底板与窄窗侧栏浮层是这套系统里唯一允许的黑。

**The Flat-At-Rest Rule.** 静止的内容没有阴影。只有当元素在交互中“离开纸面”（悬停上浮、浮层、按下缩放）时，才允许加 Raised / Floating。唯一常驻例外是桌面歌词文字底板：它不在纸上，需要描边与浮影在任意壁纸上划出边界（见 Components）。

**The Two-Shadow Rule.** 纸面组件只使用 Raised 与 Floating 两个阴影 token；唯一例外是桌面歌词文字底板，它自带 1px 内嵌白 22% 描边与 `0 2px 10px rgb(0 0 0 / 32%)` 浮影（见 Components），因为它不落在纸上。不要再新增旧深色主题的黑色投影：歌单封面 hover 已统一为 Floating。

## Shapes

圆润、无棱角的几何：所有可见容器都有圆角，圆角随表面尺寸增大（控件 6px → 浮层 8px → 小面板 10px → 面板 12px → 歌单封面 18px → 胶囊/头像/播放键全圆）。没有硬边框；唯一的“线”是焦点环（2px 陶土描边，菜单内为 -2px 内嵌偏移）、桌面歌词的字体内描边与文字底板的 1px 内嵌白高光。播放键是 40px 的圆形陶土钮，是系统中唯一的高饱和圆形；歌曲缩略图统一 6px 圆角方形，歌单大封面统一 18px。

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
- **Disabled:** 文字按钮禁用时 50% 不透明度并保持 `cursor: default`；播放控制图标按钮沿用 28% 不透明度。

### Chips
- **Quality badge（播放条音质胶囊）:** 高 26px、999px 圆角、`ink-whisper` 底、`peat` 字，11px/500 带 13px 图标；展开时字变陶土；降级时显示实际档位并加一个 10px 的 `ember-orange` 向下箭头；实际档位未知时写「未知」，不用裸码率（如 `3338K`）充当档位短标签。
- **“实际”标记（音质菜单）:** 10px、999px、陶土 12% 底、陶土字，只标注服务端实际值，不与勾选重复；勾选表示「所选」档位。
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
- **窄窗:** `768px` 以下侧栏固定为 64px 图标轨道（logo、搜索、导航、队列、桌面歌词、展开按钮都保留），搜索走既有弹层；点展开临时变为 240px 浮层（20% 黑遮罩 + Floating 阴影，点遮罩收起），不写入折叠偏好；`769px` 以上回到 localStorage 的展开/折叠偏好。

### Player bar（签名组件）
- **Shape:** 780×76、8px 圆角、`raised-paper` 底、Floating 阴影；三段网格 `1fr clamp(236px, 44%, 320px) 1fr`，左右内边距 18px，间距 16px。
- **Left:** 48px 封面（6px 圆角，悬停上浮 1px，点击进入正在播放）+ 两行歌名/艺人（14px/500 与 12px），超长用 hover 才启动的跑马灯。
- **Center:** 播放模式 / 上一首 / 40px 圆形播放键 / 下一首；播放模式用等宽的不可见占位平衡，使播放键保持在内容壳中线。下方 4px 进度槽（`ink-track`）+ 陶土→琥珀渐变已播段 + 两端 11px 等宽时间。进度输入透明覆盖，悬停时出现 10px 纸色滑块与时间气泡；滑块用 Raised、气泡用 Floating。
- **Right:** 音质胶囊 + 可点击的静音按钮（15px 图标，`aria-pressed`，悬停/聚焦有纸面 hover 底）+ 4px 轨道滑块（陶土拇指）；音量区默认 72% 不透明度，悬停播放条或聚焦滑块时升到 100%。≤768px 隐藏音量、音质胶囊保留；≤520px 胶囊图标化（文字收起、图标与降级箭头仍在，点击仍展开菜单）。
- **States:** 加载时播放键内显示旋转 Loader；播放中播放键有 2s 的陶土脉冲光环；禁用按钮 28% 不透明度。

### Song row（签名组件）
- 60px 网格行：序号/播放图标（12px，hover 时序号淡出换成播放图标）、40px 封面缩略图（6px 圆角）、标题 14px + 艺人 12px、专辑 12px、时长 11px 等宽。
- 当前行整行铺 `terracotta-wash`，标题加 500 字重，序号位显示陶土播放图标或脉冲；其他行 hover 铺 `ink-veil`。

### Queue drawer
- 固定右侧 16px 的 380px 面板（最大 `100vw - 32px`）、8px 圆角、`raised-paper` + Floating 阴影，页面压暗 20%；头部 20px 内边距，行 36px 缩略图 + 两行文字 + 时长 + hover 才出现的删除按钮；空态是 40px 音符图标 + 一句灰字。统计显示「剩余 N 首 / 剩余时长」，时长用用户语言格式（`X 小时 Y 分` / `X 分 YY 秒`），不显示「124 分 51 秒」；「清空待播」只清当前曲之后的歌曲。

### Lyrics panel（歌词卡）
- **标题与元信息:** 「歌词」用 `peat`，右上歌曲名用 `ash`（12px）；不用低于 70% 的墨色 mix 承载文本。
- **行色阶:** 当前行 `charcoal-ink` 实底 + 600 + 8% accent 洗色；邻近行 90% 墨、次近 80%、远行 70%（动态染色纸最暗端点 `#f2e5bc` 上最差 8.93 / 6.64 / 4.95:1，raised 卡上 10.4 / 7.5 / 5.4:1）；hover 转实底炭墨。当前行逐字未唱字实底炭墨（≥11.5:1），已唱字用 accent。
- **翻译行:** 非当前 70% 墨色（≥4.95:1），当前行翻译实底炭墨；不再用 opacity 压暗。

### Desktop lyrics（签名组件）
- 独立透明窗口（默认 800×200 物理客户区，置顶、跳过任务栏），无背景、无边框；不透明度由用户按 0.2–1.0 控制。默认只显示当前行与翻译；用户可在工具条开启上一行/下一行（`showPrevNext` 默认关闭）。`store` 创建与 `setSize` 都显式请求 800×200（旧代码请求 120 会被 GTK 按内容最小高度撑到 200）；窗口内长行与垂直布局一律以组件内 ResizeObserver 读到的真实 CSS 视口为准（本机 125% 渲染下约为 640×160 CSS）。
- **可读底板:** 当前行（含翻译）、上一行、下一行、歌曲信息各叠半透明深色底板 `rgba(0, 0, 0, 0.88)`（当前行 12px、上下文/歌曲信息 6px 圆角；1px 内嵌白 22% 描边 + `0 2px 10px rgb(0 0 0/32%)` 浮影）；底板随内容层一起受用户不透明度控制，透明窗形态不变。白字对底板：当前行 15:1（100% 不透明度，默认 0.95 下约 13.2:1）、上一行 7.1:1、下一行 9.7:1、翻译 9.2:1（默认 0.95 下约 8.4:1）、歌曲信息 7.6:1。
- **连接态:** 窗口打开后先显示「正在连接桌面歌词…」；收到首帧 snapshot 后立即渲染歌词。超过约 2.5s 未就绪显示「歌词连接较慢，正在重试…」；监听注册失败/发送失败同样显示可见重试文案并在后台退避重试（首包 burst 0/300/900/1600/2400/3200ms、注册退避至 8s、静默 4s 后 watchdog 每 2s 一轮）。只有「已就绪且主窗无当前歌曲」时才显示「等待播放…」；就绪后不再回退到重试占位，避免暂停时闪烁。
- **当前行:** 32px 默认（可调 14–48px）、600、行高 1.06、白字 95%；有 YRC 时逐字双层 span 擦色（已唱暖色强调 → 未唱白 94%），无逐字时间戳不伪造进度。已唱强调色由封面强调色派生：只向白色提亮、保持色相（色相仍收在暖色窗口内），保证对底板 ≥5:1（默认不透明度 0.95 下 ≥4.6:1）。
- **上下文:** 上一行左上、下一行右下，字号 `clamp(11px, 42% × 当前字号, 16px)`，白色 62%（下一行 74%），最大宽度 42%；翻译行 38% 字号、72% 白。
- **悬浮工具条:** 顶部右侧、`rgba(0, 0, 0, 0.6)` + 12px 背景模糊 + 内嵌高光与 24px 浮影，20px 方形按钮、4px 圆角，文字白 90%（对工具条底 ≥5:1）；只在 hover/focus 时出现，出现时为内容让出右侧 300px。
- **长行处理:** 当前行与翻译放进受限测量容器（窗口可用宽度扣除左右安全区，`width/max-width:100%`、`box-sizing:border-box`），按真实可用宽度整体缩放；缩放锚点用 `left:50% + translateX(-50%) scale(s)` + `transform-origin:center` 强制对称居中，避免 WebKitGTK 下超宽 inline-block 从行盒左缘溢出、只裁右侧。14/28/48px、中日混排、含翻译时都不横向裁切或滚动，用户保存的字号不变。示例：24 全角字 @32px 在 800 CSS 视口 scale≈0.911、640 CSS 视口（800×200 物理 @125% 渲染）≈0.703。窗口大小、字号、行与逐字 token 变化都由 ResizeObserver + `nextTick` 重测。

### Global notice / Inline error（错误与状态）
- **全局状态条:** 纸面 `--color-raised` + Floating 阴影 + 8px 圆角；位于内容区底部、播放条上方（bottom = `--player-reserved-space` + 10px），宽 `min(780px, 100% - 24px)`；info 用常驻 `role=status`/`aria-live=polite` region，error 用常驻 `role=alert`/`assertive` region；不自动消失、用户手动关闭，多条时队列式折叠并提示剩余条数；关闭/执行动作后焦点归还（触发元素 → 播放条首个可用控件 → 内容区 `<main>`）。
- **页内错误:** 最高 40rem 的内联块，纸面 `--color-surface-soft` + 12px 圆角；标题 14px/600、提示 12px/1.5、技术详情用 `<details>` + `mono` 11px；重试用 `.btn btn-primary`，登录过期用 `.btn btn-ghost`「重新登录」；`role=alert`/assertive。页内错误属于当前页数据，全局状态条属于跨页/播放/会话事件，两者不互相替代。
- 两者只用既有纸面与文字 token，不新增颜色；文案必须是用户语言（见 PRODUCT「状态诚实」），后端原文只进可折叠技术详情。

### Progress / Slider
- 播放进度：4px 轨道（`ink-track`），已播段是陶土→琥珀的水平渐变，圆头；悬停出现 10px 纸色滑块与时间气泡。音量滑块：4px 轨道 + 13px 陶土拇指。

## Copy

界面文案遵循 PRODUCT.md 的中文、平实、不夸大语气；跨页面固定以下说法，不在相近概念之间换词：

- **状态三态：** 加载写「正在…」；没有内容写「尚未…」或「这里还没有…」；失败写「发生了什么」+「怎么恢复」，后端原文只进可展开的「技术详情」。
- **音质：** 「所选」是用户请求档位，「实际」是服务端下发档位；实际未知写「未知」，不猜档位、不用裸码率（如 `3338K`）替代档位。
- **播放与队列：** 没有当前歌曲时，短标签写「尚未播放」、完整空态写「还没有播放歌曲」；队列统计称「剩余 N 首 / 剩余时长」；只清当前曲之后的动作称「清空待播」。
- **桌面歌词：** 窗口开关状态写「已开启 / 已关闭」，按钮动作放在 title 与 aria-label；工具栏字号带单位（如 `32px`）。
- **空态：** 说明「为什么空」并给出下一步；正在播放的空态提供「浏览每日推荐 / 搜索歌曲」。

## Do's and Don'ts

### Do:
- **Do** 让背景永远是纸：浅底、暖中性、随封面轻微染色（染色色相向陶土拉近）；结构文字固定用 `charcoal-ink` / `peat` / `ash`。
- **Do** 把陶土红当批注用：主按钮、激活导航、当前行、播放键、已唱字；单屏面积 10–12% 以内。
- **Do** 用表面明度（`ink-whisper` / `ink-veil` / `raised-paper`）和两级暖阴影表达层级；边框保持透明。
- **Do** 用字重与文字色做层级，正文 14px、元信息 11–12px；时间、时长、数量用 `tabular-nums`。
- **Do** 让悬浮件真的浮起：播放条、抽屉、菜单、歌词卡用 Raised/Floating；静止内容保持平（桌面歌词底板是透明窗的常驻例外，见 Components）。
- **Do** 遵守派生对比度下限：强调色对五个纸面 ≥ 4.6:1，正文对染色纸 ≥ 4.65:1；强调色文字叠在 `accent-subtle` 洗色上时改用 `--color-accent-on-subtle`（对侧栏/队列洗色底 ≥4.6:1）；不达标就继续压暗或降低染色强度。
- **Do** 把歌词次级行/翻译当正文对待（对染色纸 ≥4.65:1）；桌面歌词文字必须落在足够深的底板上（白字对底板 ≥4.65:1、已唱强调色 ≥4.6:1），不要用半透明字直接叠壁纸制造层级。
- **Do** 尊重 `prefers-reduced-motion`：弹簧退化为直接定位，动画时长 0.01ms，播放键脉冲关闭。
- **Do** 保持焦点可见：2px 陶土 outline（菜单内 -2px 内嵌），不要只靠背景色区分。

### Don't:
- **Don't** 使用深色面板或深色模式作为内容表面；纸是第一位的（唯一例外是模态遮罩、桌面歌词的黑色描边与半透明文字底板）。
- **Don't** 从封面派生文字色；封面只影响背景染色与环境强调色。
- **Don't** 让封面色相带出暖色窗口：绿/蓝/紫封面只能改变背景与环境光的暖度，强调色必须仍是陶土-琥珀家族（10°–55°）。
- **Don't** 用 1px 边框、分隔线或描边分区；它们会解析成透明（音质菜单页脚就是现状）。
- **Don't** 复制旧深色主题的黑色投影；纸面只用 Raised / Floating / Accent Glow（桌面歌词底板的专属浮影除外，见 Components）。
- **Don't** 把界面字号推到 16px 以上（页面标题、正在播放标题、桌面歌词除外），也不要用渐变文字、霓虹色或调色板外的饱和色。
- **Don't** 给扁平内容加阴影或卡片堆叠；不要做通用后台仪表盘式的卡片网格。
- **Don't** 在没有逐字时间戳时伪造卡拉 OK 进度；状态诚实优先于动效。
- **Don't** 加入广告、运营位、社交或直播入口——这与产品定位冲突，也不属于这套视觉。
