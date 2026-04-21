# 桌面端 + CLI 迁移计划

## 1. 目标

将现有的 `ai-ide-demo`（浏览器端 Web 应用）迁移为可在**桌面**（macOS / Windows / Linux）和**命令行**使用的原生应用。

---

## 2. 可选技术栈

| 技术栈 | 底层语言 | WebView | 体积（macOS） | CLI 方式 | 迁移成本 | 推荐度 |
|--------|----------|---------|---------------|----------|----------|--------|
| **Tauri** | Rust | 系统 WebView | ~8 MB | 嵌入式（Rust 直接调用） | ★（几乎为零） | ⭐⭐⭐⭐⭐ |
| **Electron** | Node.js | Chromium | ~150 MB | 独立子进程 | ★★（中等） | ⭐⭐⭐ |
| **Neutralino** | C++ | 系统 WebView | ~2 MB | 独立子进程 | ★★（低） | ⭐⭐ |
| **Flutter** | Dart | 自有渲染 | ~20 MB | Platform Channel | ★★★★★（几乎全部重写） | ⭐ |
| **Capacitor** | JavaScript | 系统 WebView | ~30 MB | 独立进程 | ★（极低） | ⭐⭐ |

> **结论**：**继续使用 Tauri** 是最优选择——当前项目已是 Tauri + React + Vite，只需扩展 Rust 后端即可。

---

## 3. 架构设计

### 3.1 目标架构

```
┌─────────────────────────────────────────────┐
│                 用户界面层                   │
│  ┌─────────────┐  ┌─────────────────────┐  │
│  │  桌面窗口   │  │     命令行 CLI       │  │
│  │  (WebView)  │  │  (Rust 主二进制)    │  │
│  └──────┬──────┘  └──────────┬──────────┘  │
│         │                    │              │
│  ┌──────▼────────────────────▼──────────┐  │
│  │          Tauri IPC Bridge             │  │
│  └──────┬────────────────────┬──────────┘  │
│         │                    │              │
│  ┌──────▼──────┐  ┌──────────▼──────────┐  │
│  │  Web 前端   │  │   Rust 后端核心      │  │
│  │  (React/    │  │  · 文件系统读写      │  │
│  │   Vite)    │  │  · 子进程/终端       │  │
│  │            │  │  · LSP 协议          │  │
│  │  复用现有   │  │  · AI API 代理       │  │
│  │  全部代码   │  │  · 工作区管理        │  │
│  └────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────┘
```

### 3.2 两种入口

| 入口 | 说明 |
|------|------|
| **桌面窗口** | Tauri 默认的 `index.html` 渲染（现有 Web UI） |
| **命令行 CLI** | Rust 二进制直接接收命令参数（`ai-ide-cli <command>`） |

两者共用**同一个 Rust 后端核心**，只是前端展示不同。

---

## 4. 迁移路径（分阶段）

### 阶段 A：Rust 后端扩展（不改前端）

| 功能 | 实现方式 | 预计改动文件 |
|------|----------|-------------|
| 工作区文件操作（读/写/列表/搜索） | Rust `std::fs` + `#[tauri::command]` | `src-tauri/src/lib.rs` |
| 子进程管理（运行 godot / git / npm 等） | `tauri-plugin-shell` 或 Rust `std::process::Command` | `src-tauri/src/lib.rs` |
| 全局快捷键注册 | `tauri-plugin-global-shortcut` | `src-tauri/src/lib.rs` |
| 系统托盘（可选） | `tauri-plugin-tray` | `src-tauri/src/lib.rs` |
| 窗口管理（置顶/透明/分屏） | `@tauri-apps/api/window` | 少量前端代码 |

### 阶段 B：CLI 入口（复用后端核心）

| 功能 | 实现方式 |
|------|----------|
| 命令行参数解析 | Rust `clap` 或 `structopt` |
| 交互式 REPL | Rust readline / `rustyline` |
| 输出格式化 | `ansi_term` / `colored` |
| 配置文件 | `~/.ai-ide/config.toml` |

```rust
// CLI 示例命令
// ai-ide-cli init <project_path>    → 初始化工作区
// ai-ide-cli run <script>          → 运行 Godot 脚本
// ai-ide-cli edit <file>           → 打开编辑器窗口并定位文件
// ai-ide-cli chat "帮我写个按钮"   → 命令行 AI 对话（直接输出文本）
```

### 阶段 C：功能增强（可选）

| 功能 | 说明 |
|------|------|
| 内置 LSP 支持 | 通过子进程调用 `godot-lsp` 或 `typescript-language-server` |
| 多工作区 | Rust 侧管理工作区列表 |
| 云端同步 | 读写 `~/.ai-ide/` 配置 |

---

## 5. 关键实现细节

### 5.1 复用现有前端

```
ai-ide-demo/src/   ← 完全保留，不需要修改
ai-ide-demo/src-tauri/  ← 新增 Rust 后端逻辑
```

前端通过 Tauri IPC (`invoke`) 调用 Rust 命令：

```typescript
// 现有代码（useAI.ts）中的 executeTool 改为 Tauri 调用
import { invoke } from '@tauri-apps/api/tauri';

// 替代 Node.js 的 fs 操作
const content: string = await invoke('read_workspace_file', { path: '/web/index.html' });
```

### 5.2 插件推荐

| 插件 | 用途 |
|------|------|
| `@tauri-apps/plugin-shell` | 运行外部命令（godot, git） |
| `@tauri-apps/plugin-fs` | 文件系统操作（可选，已有 Rust 实现） |
| `@tauri-apps/plugin-global-shortcut` | 全局快捷键 |
| `@tauri-apps/plugin-dialog` | 原生文件选择/保存对话框 |
| `@tauri-apps/plugin-clipboard-manager` | 剪贴板 |

### 5.3 打包配置

```json
// src-tauri/tauri.conf.json
{
  "productName": "AI IDE",
  "identifier": "com.aiide.app",
  "build": {
    "frontendDist": "../../dist"
  },
  "app": {
    "windows": [{ "title": "AI IDE", "width": 1200, "height": 800 }],
    "security": {
      "csp": "default-src 'self'; connect-src 'self' https://api.deepseek.com"
    }
  },
  "bundle": {
    "targets": "all",
    "category": "public.app-category.developer-tools"
  }
}
```

---

## 6. 详细任务拆分

### T-A1：Rust 文件操作命令

- [ ] `#[tauri::command] read_workspace_file(path: String) -> Result<String, String>`
- [ ] `#[tauri::command] write_workspace_file(path: String, content: String) -> Result<(), String>`
- [ ] `#[tauri::command] list_workspace_files() -> Result<Vec<FileEntry>, String>`
- [ ] `#[tauri::command] search_in_workspace(query: String) -> Result<Vec<SearchHit>, String>`
- [ ] 配置 `tauri.conf.json` 的 `devtools: true`

### T-A2：Rust 子进程管理

- [ ] `#[tauri::command] spawn_process(cmd: String, args: Vec<String>, cwd: String) -> Result<u32, String>`
- [ ] `#[tauri::command] kill_process(pid: u32) -> Result<(), String>`
- [ ] `tauri-plugin-shell` 集成（已有基础）

### T-A3：前端适配（invoke 替代 Node.js）

- [ ] `src/hooks/useAI.ts` 中的 `executeTool` 改为 `invoke Rust command`
- [ ] `src/inlineEdit/editorSelection.ts` 保留（不涉及文件系统）
- [ ] `src/store/workspaceStore.ts` 改用 Rust 侧数据源（可选）

### T-B1：CLI 框架

- [ ] 新增 `src-tauri/src/cli.rs`（clap 命令定义）
- [ ] `src-tauri/src/main.rs` 改为支持 CLI 和窗口两种入口
- [ ] 实现 `ai-ide-cli init / run / edit / chat` 子命令

### T-B2：CLI REPL 模式

- [ ] 交互式 AI 对话（输出流式文本）
- [ ] 非流式快速命令（如 `ai-ide-cli check`）

### T-C1：打包与签名

- [ ] `npm run tauri build` 配置
- [ ] macOS 代码签名（可选）
- [ ] Windows 安装包（.exe / .msi）
- [ ] Linux 包（.deb / .AppImage）

---

## 7. 验收标准

- [ ] 桌面窗口运行正常，所有现有功能（Inline Edit、AI 补全、Diff 审核）保留
- [ ] `ai-ide-cli --help` 显示可用命令
- [ ] `ai-ide-cli chat "hello"` 能流式输出 AI 响应
- [ ] `ai-ide-cli run godot --version` 能调用外部进程
- [ ] `npm run tauri build` 产出各平台安装包
- [ ] macOS `.app` 双击可运行
- [ ] Windows `.exe` 双击可运行

---

## 8. 技术栈总结

| 层次 | 选用技术 | 理由 |
|------|----------|------|
| 桌面框架 | **Tauri 2.x** | 体积小、安全、前端完全复用、CLI 可嵌入式 |
| 前端 | **React 18 + Vite** | 现有代码零改动 |
| 状态管理 | **Zustand** | 现有代码零改动 |
| 终端/子进程 | **Rust std::process** + `tauri-plugin-shell` | 嵌入式、无独立进程开销 |
| CLI 参数解析 | **clap** | Rust 官方、体验好 |
| 文件系统 | **Rust std::fs** + `#[tauri::command]` | 自定义控制、跨平台 |
| AI API | **现有 useAI.ts** | 零改动 |

---

## 9. 参考资料

- [Tauri 2.x 官方文档](https://v2.tauri.app/)
- [Tauri 插件列表](https://v2.tauri.app/plugins/)
- [Rust clap 使用指南](https://docs.rs/clap/latest/clap/)
- [tauri-plugin-shell](https://v2.tauri.app/reference/plugins/shell/)
