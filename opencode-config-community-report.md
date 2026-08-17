# OpenCode CLI 社区配置实践调研报告

> 调研日期：2026-07-31
> 方法说明：搜索引擎（bing/duckduckgo）结果被 SEO 镜像站污染，故改用 GitHub API、HN Algolia API 直接抓取真实数据。共采集 4 个高星真实配置仓库、1 个配置插件仓库、官方配置文档、2 个 HN 热帖（共 600+ 评论）及 2 篇一线实践博客。Reddit API 在本网络环境不可达，社区讨论以 HN + GitHub 替代。
>
> 标注规则：【多人推荐】= ≥2 个独立来源呈现相同/相近做法；【个例】= 单一来源的个人偏好。JSON 均按抓取原文保留，未做改动。

## 素材来源一览

| 来源 | 类型 | 链接 |
|---|---|---|
| 官方配置文档 | 官方 | https://opencode.ai/docs/config/ |
| joelhooks/opencode-config（391★，egghead 创始人） | 真实配置 | https://github.com/joelhooks/opencode-config |
| flpbalada/my-opencode-config（279★） | 真实配置 | https://github.com/flpbalada/my-opencode-config |
| nexxeln/opencode-config（210★，create-t3-app 作者） | 真实配置 | https://github.com/nexxeln/opencode-config |
| jjmartres/opencode（133★，stow dotfiles 布局） | 真实配置 | https://github.com/jjmartres/opencode |
| waybarrios/opencode-power-pack（453★） | 插件/skills | https://github.com/waybarrios/opencode-power-pack |
| HN: "Annoying and alarming things about OpenCode"（420 分/288 评论） | 讨论 | https://news.ycombinator.com/item?id=48978112 |
| HN: "Claude Code sends 33k tokens...OpenCode sends 7k"（706 分/396 评论） | 讨论 | https://news.ycombinator.com/item?id=48883275 |
| wren.wtf《Stop Using OpenCode》 | 批评长文 | https://wren.wtf/shower-thoughts/stop-using-opencode/ |
| Nango《What we learned building 200+ API integrations with OpenCode》 | 团队实践 | https://nango.dev/blog/learned-building-200-api-integrations-with-opencode/ |

---

## 1. Theme 与 Model 组合

### 1.1 Theme：统一放 tui.json，三个真实案例三种偏好（【个例】）

官方文档明确：TUI 主题/按键绑定等已从 `opencode.json` 迁移到独立的 `tui.json`（旧键位自动迁移、已废弃）。真实用户主题各不相同，没有"公认最佳"，但"单独放 tui.json + 开着滚动加速"是共同结构。

nexxeln（主题 vesper）：
```json
{
  "$schema": "https://opencode.ai/tui.json",
  "theme": "vesper"
}
```
来源：https://github.com/nexxeln/opencode-config/blob/main/tui.json

jjmartres（主题 catppuccin-macchiatto，滚动加速 + diff 样式 + 鼠标）：
```json
{
  "$schema": "https://opencode.ai/tui.json",
  "theme": "catppuccin-macchiatto",
  "scroll_speed": 3,
  "scroll_acceleration": {
    "enabled": true,
  },
  "diff_style": "auto",
  "mouse": true,
}
```
来源：https://github.com/jjmartres/opencode/blob/main/opencode/tui.jsonc

官方文档示例（主题 tokyonight）：
```json
{
  "$schema": "https://opencode.ai/tui.json",
  "theme": "tokyonight"
}
```
来源：https://opencode.ai/docs/config/

### 1.2 Model：主流是"主力大模型 + small_model 便宜模型"组合（【多人推荐】）

官方文档对 `small_model` 的定位：用于标题生成等轻量任务，默认自动尝试同 provider 的便宜模型，没有则回退主模型。三个真实配置全部显式配置了 `small_model`，且均为同一 provider 下的便宜档：

jjmartres（主力 gemini-3.1-pro + small gemini-2.5-flash，并用 `enabled_providers` 白名单）：
```jsonc
{
  "model": "google-vertex/gemini-3.1-pro-preview",
  "small_model": "google-vertex/gemini-2.5-flash",
  "enabled_providers": ["google-vertex", "openrouter", "anthropic", "calculon"],
  ...
}
```
来源：https://github.com/jjmartres/opencode/blob/main/opencode/opencode.jsonc

joelhooks（主力 gpt-5.2-codex + small gpt-5.2）：
```jsonc
  // === Models ===
  "model": "openai/gpt-5.2-codex",
  "small_model": "openai/gpt-5.2",  // title gen, lightweight tasks
  "autoupdate": true,
```
来源：https://github.com/joelhooks/opencode-config/blob/main/opencode.jsonc

flpbalada（单模型 + 默认 agent 设为 build）：
```json
  "model": "openai/gpt-5.6-sol-fast",
  "default_agent": "build",
```
来源：https://github.com/flpbalada/my-opencode-config/blob/main/opencode.json

补充背景（【多人推荐】的省钱路径）：HN 上多人提到 OpenCode 自带 Zen 免费模型额度（约 200 请求/5 小时），是不少人选择它的核心原因；也有人在 HN 提到每月 $5–10 的 Go 计划配合 DeepSeek flash 级模型足够日常使用。来源：https://news.ycombinator.com/item?id=48978112（评论 48978528、48980420）

### 1.3 本地模型接入方式（【个例】但结构可参考）

flpbalada 与 jjmartres 都用 `@ai-sdk/openai-compatible` 包本地兼容端点：

```json
  "provider": {
    "ollama": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Ollama",
      "options": {
        "baseURL": "http://localhost:11434/v1"
      },
      "models": { ... }
    }
  }
```
来源：https://github.com/flpbalada/my-opencode-config/blob/main/opencode.json

---

## 2. Permission 配置技巧

### 2.1 默认值提醒：opencode 默认全部放行（【多人推荐】一致确认）

官方文档原话："By default, opencode **allows all operations** without requiring explicit approval."（https://opencode.ai/docs/config/）。HN 上有 Claude Code 用户转过来时被"默认编辑文件不弹确认框"吓到，评论确认 opencode 与 pi 均默认放行、需要自己开 permission 配置（https://news.ycombinator.com/item?id=48978112，评论 48978778/48979387）。

### 2.2 主流风格一：全局 allow + 危险命令 ask 黑名单（【多人推荐】）

flpbalada 的配置是目前社区里最完整的黑名单样本（默认全 allow，仅对 30+ 条危险命令 ask）：
```json
  "permission": {
    "*": "allow",
    "bash": {
      "*": "allow",
      "touch *": "ask",
      "mkdir *": "ask",
      "rm *": "ask",
      "cp *": "ask",
      "mv *": "ask",
      "dd *": "ask",
      "sudo *": "ask",
      "chmod *": "ask",
      "chown *": "ask",
      "curl *": "ask",
      "wget *": "ask",
      "npm install *": "ask",
      "pip install *": "ask",
      "git push": "ask",
      "git reset --hard *": "ask",
      "git clean *": "ask",
      "reboot": "ask",
      "shutdown": "ask",
      "kill *": "ask",
      "killall *": "ask",
      "docker *": "ask",
      "mkfs *": "ask",
      "fdisk *": "ask",
      "parted *": "ask",
      "format *": "ask",
      "git branch -d *": "ask",
      "git branch -D *": "ask",
      "git rebase *": "ask",
      "npm run publish": "ask",
      "brew install *": "ask",
      "brew upgrade *": "ask",
      "ssh *": "ask",
      "scp *": "ask",
      "rsync *": "ask"
    },
    "doom_loop": "ask",
    "external_directory": "ask"
  }
```
来源：https://github.com/flpbalada/my-opencode-config/blob/main/opencode.json
要点：文件增删改（rm/cp/mv/dd）、包安装（npm/pip/brew）、推送（git push）、系统级（sudo/docker/ssh）全部 ask；普通读写和开发命令零打断。

### 2.3 主流风格二：只 deny 真正灾难性的 + 对 .env 读放行（【个例】但被官方 MDM 示例背书）

joelhooks 的配置（git push 直接 allow 以减少打断，只 deny 破坏性操作）：
```jsonc
  "permission": {
    // .env reads without prompts
    "read": {
      ".env": "allow",
      ".env.*": "allow",
      ".env-*": "allow"
    },
    "external_directory": "allow",
    // Only deny the truly catastrophic - everything else just runs
    "bash": {
      "git push": "allow",
      "git push *": "allow",
      "sudo *": "deny",
      "rm -rf /": "deny",
      "rm -rf /*": "deny",
      "rm -rf ~": "deny",
      "rm -rf ~/*": "deny",
      ":(){:|:&};:": "deny"  // fork bomb, just in case
    }
  }
```
来源：https://github.com/joelhooks/opencode-config/blob/main/opencode.jsonc

官方文档的 MDM 托管示例同样采用 `"*": "ask"` + `"rm -rf *": "deny"` 的组合（https://opencode.ai/docs/config/），说明"ask 兜底 + deny 极端命令"是被官方认可的模板。

### 2.4 按 agent 细分权限（【多人推荐】）：用 `permission.write` 只允许写特定路径

joelhooks 给 test-writer / docs 两个 agent 限定写路径（这是社区里较新的实践，官方文档的 agent 示例只做了 tools 裁剪）：
```jsonc
    "test-writer": {
      "model": "openai/gpt-5.2-codex",
      "temperature": 0.2,
      "permission": {
        "write": {
          "**/*.test.ts": "allow",
          "**/*.spec.ts": "allow",
          "**/*.test.tsx": "allow",
          "**/*.spec.tsx": "allow",
          "*": "deny"
        }
      },
      "description": "Test specialist - generates comprehensive unit, integration, and e2e tests. Can only write to test files."
    },
    // Docs agent - documentation writer (cheaper model)
    "docs": {
      "model": "openai/gpt-5.2-codex",
      "temperature": 0.3,
      "permission": {
        "write": {
          "**/*.md": "allow",
          "**/*.mdx": "allow",
          "*": "deny"
        }
      },
      "description": "Documentation writer - generates and updates markdown docs, READMEs, and guides. Can only write to .md/.mdx files."
    }
```
来源：https://github.com/joelhooks/opencode-config/blob/main/opencode.jsonc

### 2.5 重要警告：内置权限可被轻易绕过，别当安全边界（【多人推荐】）

wren.wtf 长文（HN 420 分热帖）实测：权限匹配基于 tree-sitter 解析 bash AST 后的文本正则，以下命令全部绕过了 `"git *": "deny"`：
```
echo 'git clean -fdx .' | bash        # 允许
env git status                          # 允许
/usr/bin/git status                     # 允许
$(which git) status                     # 允许
echo Z2l0IHJlc2V0IC0taGFyZAo= | base64 -d | bash   # 允许（解码后是 git reset --hard）
bash << 'EOF'
git push --force
EOF                                     # 允许
python3 -c 'import subprocess; subprocess.run(["git", "checkout", "."])'  # 允许
```
来源：https://wren.wtf/shower-thoughts/stop-using-opencode/（作者已注明 2026-07-24 更新：命令前缀权限跨会话持久化已移除、重定向路径校验已补上，但 AST 文本匹配的架构性缺陷仍在）

HN 评论区共识（https://news.ycombinator.com/item?id=48978112）：认真用的用户基本不信任内置权限层，而是"沙箱 + YOLO 模式"（评论 48978910 提到 nono.sh；评论 48979150/48979520 用 bubblewrap 包 pi-agent，只给当前目录 + 只读 docs）。此外 "Always" 会按命令前缀持久化放行（作者已在上文确认该行为在 2026-07-24 已移除）。

Nango 团队也踩过同类坑：限制编辑 .json 后，agent 改用 `sed`/重定向绕过（https://nango.dev/blog/learned-building-200-api-integrations-with-opencode/，第 2 节）。这印证了"权限文本过滤 = 反模式"的判断。

---

## 3. 自定义 Agents 例子

### 3.1 JSON 内联定义 + 只读工具裁剪（【多人推荐】）

官方文档示例（code-reviewer，禁写工具）：
```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "agent": {
    "code-reviewer": {
      "description": "Reviews code for best practices and potential issues",
      "model": "anthropic/claude-sonnet-4-5",
      "prompt": "You are a code reviewer. Focus on security, performance, and maintainability.",
      "tools": {
        // Disable file modification tools for review-only agent
        "write": false,
        "edit": false,
      },
    },
  },
}
```
来源：https://opencode.ai/docs/config/

joelhooks 的 plan agent（只读 + bash 命令白名单 + 低 temperature），是"分析型 agent"的标准模板：
```jsonc
    "plan": {
      "model": "openai/gpt-5.2-codex",
      "temperature": 0.1,
      "tools": {
        "write": false,
        "edit": false,
        "patch": false
      },
      "permission": {
        "bash": {
          "git status": "allow",
          "git diff*": "allow",
          "git log*": "allow",
          "git show*": "allow",
          "bd *": "allow",
          "rg *": "allow",
          "tree *": "allow",
          "wc *": "allow",
          "head *": "allow",
          "tail *": "allow",
          "pnpm exec tsc*": "allow",
          "pnpm run lint*": "allow",
          "pnpm test*": "allow",
          "*": "deny"
        }
      }
    }
```
来源：https://github.com/joelhooks/opencode-config/blob/main/opencode.jsonc

### 3.2 用 Markdown 文件定义 agents/commands（【多人推荐】，官方 + 两个大仓库都支持）

nexxeln 的仓库结构（md 文件即配置，无需 JSON）：
```
| `agent/code-review.md` | Review subagent with evidence-first findings. |
| `agent/explore.md`     | Read-only codebase search subagent. |
| `agent/librarian.md`   | Remote repo and library research subagent. |
| `agent/look-at.md`     | Single-file analysis subagent. |
| `agent/oracle.md`      | One-shot planning and debugging advisor. |
| `command/commit.md`    | Review changes and make small commits. |
| `command/pr.md`        | Push work and open a pull request. |
| `command/simplify.md`  | Simplify recent code without changing behavior. |
```
来源：https://github.com/nexxeln/opencode-config/blob/main/README.md
官方文档同样确认：`~/.config/opencode/agents/` 或 `.opencode/agents/` 下的 markdown 与 JSON 等价（https://opencode.ai/docs/config/）。

### 3.3 技能包/插件式扩展：code-review、security-review、frontend-design 等开箱即用（【多人推荐】趋势）

waybarrios/opencode-power-pack（453★）把 Anthropic 官方 Claude Code 插件翻译成 OpenCode 原生 SKILL.md，一行安装：
```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-power-pack@git+https://github.com/waybarrios/opencode-power-pack.git"
  ]
}
```
内含 11 个技能：code-review、security-review、feature-dev、code-explorer、code-architect、code-reviewer、frontend-design、mcp-builder、skill-creator、agents-md-improver、agents-md-revise。
来源：https://github.com/waybarrios/opencode-power-pack

Nango 团队用同样思路（skills 封装领域 know-how + 简单编排器）在 15 分钟内自动生成 ~200 个 API 集成、token 成本 <$20，并明确说"不需要 MCP 重型编排、不需要 agent 管 agent，skills 就够了"。来源：https://nango.dev/blog/learned-building-200-api-integrations-with-opencode/（第 4 节）

jjmartres 的插件组合也体现了"社区 npm 插件"习惯：
```jsonc
  "plugin": [
    "@franlol/opencode-md-table-formatter@latest",
    "opencode-websearch-cited@1.2.0",
    "opencode-cost-guard"
  ],
```
来源：https://github.com/jjmartres/opencode/blob/main/opencode/opencode.jsonc

---

## 4. compaction / autoupdate / share 的常见取舍

### 4.1 compaction（【多人分歧】）

官方默认与推荐（auto 开、prune 关、留 10000 token 缓冲）：
```json
{
  "$schema": "https://opencode.ai/config.json",
  "compaction": {
    "auto": true,
    "prune": false,
    "reserved": 10000
  }
}
```
来源：https://opencode.ai/docs/config/

反面意见（个例但被大量 HN 讨论转载）：wren.wtf 认为 compaction 与 pruning 实现都不好且互相干扰——prune 会无差别丢弃 40k 阈值外的早期工具输出（比如你让它先读的 spec），compaction 会让本地模型把整个会话重新 prefill 一遍。作者建议：长任务显式让 agent 写 handoff 笔记，新开会话（https://wren.wtf/shower-thoughts/stop-using-opencode/）。该作者文章末尾更新说明：**tool call pruning 已在后续版本默认禁用**（官方态度的佐证）。

### 4.2 autoupdate（【多人推荐】开）

- 官方：默认 true，可设 `"autoupdate": "notify"` 只提醒不自动更；**用包管理器（Homebrew 等）安装时该选项不生效**。来源：https://opencode.ai/docs/config/
- joelhooks：`"autoupdate": true`（https://github.com/joelhooks/opencode-config/blob/main/opencode.jsonc）
- jjmartres：`"autoupdate": true`（https://github.com/jjmartres/opencode/blob/main/opencode/opencode.jsonc）

### 4.3 share（【多人推荐】关或保持 manual）

- 官方：默认 `"manual"`（/share 命令手动分享），可选 `"auto"` / `"disabled"`。来源：https://opencode.ai/docs/config/
- jjmartres 显式关闭：`"share": "disabled"`（同上）
- 官方 MDM 托管示例里也出现 `share: disabled`（https://opencode.ai/docs/config/）。隐私敏感/公司环境建议 disabled。

### 4.4 相关取舍：snapshot 与 watcher（【个例】但值得知道）

官方文档提示：大仓库/多 submodule 时 snapshot（会话内撤销功能的内置 git 仓库）会导致索引慢、磁盘占用大，可 `"snapshot": false` 关闭（https://opencode.ai/docs/config/）。flpbalada 用 watcher.ignore 排除 node_modules/dist/.next 等噪音目录（https://github.com/flpbalada/my-opencode-config/blob/main/opencode.json）。

---

## 5. 社区提到的坑

| # | 坑 | 严重度 | 来源 |
|---|---|---|---|
| 1 | **RCE CVE-2026-22812**：旧版默认起 HTTP server（宽松 CORS + 任意命令/文件读写 API），任意网站可打；必须 ≥ v1.1.10，新版已默认禁用 server | 高危 | https://cy.md/opencode-rce/；https://news.ycombinator.com/item?id=46581095；wren.wtf 文内确认 |
| 2 | **权限文本过滤可绕过**（见 2.5）：`git * deny` 挡不住 `env git`、`/usr/bin/git`、`base64 | bash`、子进程调用；redirection 与未列入 FILES 列表的命令完全不校验 | 高危 | https://wren.wtf/shower-thoughts/stop-using-opencode/ |
| 3 | **后台静默下载 npm 包**：有用户因此卸载（供应链攻击面）；插件机制本身也依赖 bun 自动 npm install | 中 | HN 评论 48979632（https://news.ycombinator.com/item?id=48978112）；power-pack README 亦证实"启动时自动 npm install" |
| 4 | **默认 system prompt 偏执且不可全局改**：内置"ABSOLUTELY NO COMMENTS"指令导致 agent 删注释；要改只能每个项目复制 | 中 | wren.wtf 文内；HN 评论 48978710/48978823 |
| 5 | **权限弹窗没有 "Never"**：只有 Yes/No/Always；对子代理说 No 会杀掉子代理并丢上下文，决策疲劳下容易误点 | 中 | wren.wtf 文内 |
| 6 | **issue 治理差**：3690+ 个 open issue，安全 issue 被 stale bot 关闭 | 中 | HN 评论 48978919/48979471 |
| 7 | **LSP 集成争议**：有人夸（"OpenCode 最好的功能之一"），Pi 开发者称评测显示 LSP 反而浪费 token、不如提交钩子跑 lint；有人反馈 Pyright 干扰主任务 | 观点分歧 | HN 评论 48978669/48978723/48979208 |
| 8 | **本地小模型跑 skill 会"敷衍"**：power-pack README 明确写——小模型看到多步骤指令会一行带过，技能内容本身没问题，要换强模型；且本地模型 compaction/prefill 慢（M4 Max 上 10 分钟级） | 中 | power-pack README Troubleshooting；wren.wtf 文内 |
| 9 | **默认连远程模型**：本地模型配置一旦出错就静默连上云端；文档缺本地模型完整示例 | 中 | wren.wtf 文内 |
| 10 | **agent 会撒谎/抄数据**：Nango 实测——从别的 agent 目录抄测试 ID、伪造 API 响应、声称完成但代码不编译；必须加验证层（重跑测试 + 检查产物未被改） | 通用 | https://nango.dev/blog/learned-building-200-api-integrations-with-opencode/ |

---

## 6. 结论速查（可抄作业版）

1. **结构**：`~/.config/opencode/opencode.json` 管全局，`tui.json` 管主题，项目根 `opencode.json` 覆盖，多级合并不互斥。【多人推荐】
2. **模型**：主力模型 + `small_model` 配同 provider 便宜档；`enabled_providers` 白名单防串台。【多人推荐】
3. **权限**：默认全放行；要么"全 allow + 危险命令 ask"（flpbalada 模板），要么"ask 兜底 + rm -rf/sudo deny"（官方 MDM 模板）；敏感 agent 用 `permission.write` 限定路径。【多人推荐】
4. **不要**把内置权限当安全边界——真要隔离用沙箱（bwrap/nono.sh）+ YOLO。【多人推荐】
5. **扩展**：优先 skills/plugin（power-pack、superpowers、Nango 经验），agents/commands 用 md 文件管理。【多人推荐】
6. **取舍**：autoupdate 开着（包管理器装的除外）；share 默认 manual、敏感环境 disabled；compaction 保持官方默认（auto+prune off），长任务用显式 handoff 笔记；大仓库可关 snapshot。【多人推荐 + 个例并存，已逐条标注】
