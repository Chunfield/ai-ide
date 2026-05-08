---
name: "project-manager"
description: "基于桌面端CLI迁移文档管理项目生命周期。当用户询问项目状态、任务、阶段或需要跟踪项目进度时调用。"
---

# 项目管理器

此技能帮助管理 ai-ide 项目，基于桌面端 CLI 迁移规划文档。

## 技能更新流程

当 skill 有版本更新或功能更新时，必须遵循以下流程：

### 更新流程

| 步骤 | 阶段 | 说明 |
|------|------|------|
| 1 | 本地开发 | 在本地修改 SKILL.md |
| 2 | 本地调试 | 使用 Trae IDE 测试功能是否正常 |
| 3 | 本地验证 | 确认修改符合预期 |
| 4 | 发包 | 验证通过后再提交/发包 |

### 本地调试步骤

1. **修改 SKILL.md**
   - 更新 `.trae/skills/project-manager/SKILL.md` 中的内容
   - 确保 frontmatter 的 name 和 description 正确

2. **本地测试**
   - 在 Trae IDE 中唤起 skill 进行测试
   - 测试新功能是否符合预期
   - 验证描述是否准确

3. **调试命令**
   ```bash
   # 查看 skill 目录结构
   ls -la .trae/skills/project-manager/

   # 验证 SKILL.md 格式
   cat .trae/skills/project-manager/SKILL.md
   ```

4. **发包条件**
   - [ ] 本地调试通过
   - [ ] 功能符合预期描述
   - [ ] SKILL.md 格式正确
   - [ ] description 准确描述功能和使用时机

### 常用 skill 操作

| 操作 | 命令 | 说明 |
|------|------|------|
| 查看 skill | `.trae/skills/<skill-name>/SKILL.md` | skill 配置文件 |
| 测试 skill | 在 Trae IDE 中触发 skill | 验证功能 |
| 更新 skill | 直接编辑 SKILL.md | 遵循调试流程 |

## 项目概述

将 `ai-ide-demo` 从纯 Web 应用迁移为 **Tauri 桌面应用 + CLI 工具**。

### 技术选型

| 层次 | 技术 | 理由 |
|------|------|
| 桌面框架 | Tauri 2.x | 体积小(~8MB)、安全、前端完全复用、CLI 嵌入式 |
| 前端 | React 18 + Vite + TypeScript | 现有代码零改动 |
| 状态管理 | Zustand | 现有代码零改动 |
| 终端/子进程 | Rust std::process + tauri-plugin-shell | 嵌入式、无独立进程开销 |
| CLI 参数解析 | clap | Rust 官方主流、体验好 |
| 文件系统 | Rust std::fs + #[tauri::command] | 自定义控制、跨平台兼容 |
| AI API | 现有 useAI.ts | 零改动 |

## 可用阶段

| 阶段 | 主题 | 状态 | 文档 |
|------|------|------|------|
| 阶段 A | Rust 后端扩展（不改前端） | 待开始 | [A_Rust后端扩展.md](../documents/桌面端_CCLI迁移规划_详细文档/A_Rust后端扩展.md) |
| 阶段 B | CLI 入口（复用后端核心） | 待开始 | [B_CLI入口.md](../documents/桌面端_CCLI迁移规划_详细文档/B_CLI入口.md) |
| 阶段 C | 功能增强（可选） | 待开始 | [C_功能增强.md](../documents/桌面端_CCLI迁移规划_详细文档/C_功能增强.md) |
| 阶段 D | 打包与分发 | 待开始 | [D_打包分发.md](../documents/桌面端_CCLI迁移规划_详细文档/D_打包分发.md) |

## 阶段 A：Rust 后端扩展

**目标：** 在不修改前端代码的前提下，通过 Rust 后端扩展文件系统、子进程管理等原生能力。

### 任务清单

| 任务ID | 功能 | 实现方式 | 优先级 |
|--------|------|----------|--------|
| A-1 | 工作区文件读取 | Rust `std::fs` + `#[tauri::command]` | P0 |
| A-2 | 工作区文件写入 | Rust `std::fs` + `#[tauri::command]` | P0 |
| A-3 | 工作区文件列表 | Rust `std::fs::read_dir` | P0 |
| A-4 | 工作区文件搜索 | Rust `std::fs` 遍历 + 匹配 | P0 |
| A-5 | 子进程管理 | `tauri-plugin-shell` 或 Rust `std::process::Command` | P1 |
| A-6 | 全局快捷键 | `tauri-plugin-global-shortcut` | P2 |
| A-7 | 系统托盘 | `tauri-plugin-tray` | P2 |

### 验收标准

- [ ] `invoke('read_workspace_file')` 能读取真实文件系统文件
- [ ] `invoke('write_workspace_file')` 能写入文件并创建目录
- [ ] `invoke('list_workspace_files')` 返回正确文件列表
- [ ] `invoke('search_in_workspace')` 能搜索文件内容
- [ ] `invoke('run_command')` 能执行外部命令
- [ ] 现有 Web UI 功能不受影响

## 阶段 B：CLI 入口

**目标：** 实现独立的命令行工具 `ai-ide-cli`，复用 Rust 后端核心逻辑，支持交互式 REPL 和批处理命令。

**前置条件：** 阶段 A 完成

### 任务清单

| 任务ID | 功能 | 实现方式 | 优先级 |
|--------|------|----------|--------|
| B-1 | CLI 框架搭建 | clap 命令解析 | P0 |
| B-2 | 双入口支持 | main.rs 判断运行模式 | P0 |
| B-3 | init 子命令 | 创建工作区配置 | P0 |
| B-4 | chat 子命令 | 流式 AI 对话 | P0 |
| B-5 | edit 子命令 | 打开桌面窗口并定位文件 | P1 |
| B-6 | run 子命令 | 执行外部程序 | P1 |
| B-7 | REPL 交互模式 | 交互式对话 | P1 |
| B-8 | 配置文件支持 | ~/.ai-ide/config.toml | P2 |

### CLI 子命令

```bash
ai-ide-cli --help
ai-ide-cli init ./my-project
ai-ide-cli chat "帮我写一个 Hello World"
ai-ide-cli edit ./src/main.rs --line 10
ai-ide-cli run godot -- --version
ai-ide-cli check
ai-ide-cli repl
```

### 验收标准

- [ ] `ai-ide-cli --help` 显示完整帮助
- [ ] `ai-ide-cli init ./my-project` 创建工作区
- [ ] `ai-ide-cli chat "帮我写一个 Hello World"` 流式输出
- [ ] `ai-ide-cli edit ./src/main.rs --line 10` 打开桌面窗口
- [ ] `ai-ide-cli run godot -- --version` 执行外部命令
- [ ] `ai-ide-cli repl` 进入交互模式
- [ ] CLI 和桌面端共用同一 Rust 核心

## 阶段 C：功能增强

**目标：** 在完成桌面端和 CLI 基础功能后，提供可选的高级功能扩展。

**前置条件：** 阶段 A + B 完成

### 任务清单

| 任务ID | 功能 | 实现方式 | 优先级 |
|--------|------|----------|--------|
| C-1 | 内置 LSP 支持 | 子进程调用 godot-lsp / typescript-language-server | P1 |
| C-2 | 多工作区管理 | Rust 侧管理工作区列表 | P1 |
| C-3 | 云端配置同步 | 读写 ~/.ai-ide/ 配置 | P2 |
| C-4 | Git 集成 | git 命令封装 | P2 |
| C-5 | Godot 专项适配 | GDScript 高亮 + 引擎控制 | P2 |

### 验收标准

- [ ] LSP 服务器能正常启动并提供补全
- [ ] 多工作区切换正常
- [ ] Git 状态显示正确
- [ ] Godot 项目能正常检测和运行

## 阶段 D：打包与分发

**目标：** 配置 Tauri 打包选项，产出各平台安装包，建立分发流程。

**前置条件：** 阶段 A + B 完成

### 任务清单

| 任务ID | 功能 | 实现方式 | 优先级 |
|--------|------|----------|--------|
| D-1 | macOS 打包 | tauri build + codesign | P0 |
| D-2 | Windows 打包 | tauri build + signtool | P1 |
| D-3 | Linux 打包 | tauri build | P1 |
| D-4 | 自动更新 | tauri-plugin-updater | P2 |
| D-5 | CI/CD 配置 | GitHub Actions | P2 |

### 构建命令

```bash
# 桌面端开发
npm run tauri dev

# 完整构建
npm run tauri build
```

### 验收标准

- [ ] `npm run tauri build` 无错误完成
- [ ] macOS .app 双击可启动
- [ ] macOS .dmg 安装正常
- [ ] Windows .exe 双击可启动
- [ ] Windows .msi 安装正常
- [ ] Linux .AppImage 可执行
- [ ] Linux .deb 安装正常
- [ ] 所有平台的 AI 对话功能正常
- [ ] 文件系统操作（读写）正常
- [ ] 外部命令执行（godot等）正常

## 整体验收标准

- [ ] 桌面窗口运行正常，所有现有功能（Inline Edit、AI 补全、Diff 审核）保留
- [ ] `ai-ide-cli --help` 显示可用命令
- [ ] `ai-ide-cli chat "hello"` 能流式输出 AI 响应
- [ ] `ai-ide-cli run godot --version` 能调用外部进程
- [ ] `npm run tauri build` 产出各平台安装包
- [ ] macOS `.app` 双击可运行
- [ ] Windows `.exe` 双击可运行

## 目录结构

```
ai-ide-demo/
├── src/                          # React 前端
│   ├── components/               # UI 组件
│   ├── hooks/useAI.ts            # AI 对话逻辑
│   ├── store/                    # Zustand 状态
│   └── inlineEdit/               # Inline 编辑
├── src-tauri/                    # Tauri 后端
│   ├── src/
│   │   ├── lib.rs               # Tauri commands
│   │   ├── cli.rs               # CLI 命令
│   │   └── main.rs              # 入口
│   ├── Cargo.toml
│   └── tauri.conf.json
└── dist/                         # 构建产物
```

## 环境变量

| 变量 | 说明 | 必需 |
|------|------|------|
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 | 是 |
| `RUST_LOG` | Rust 日志级别 | 否 |
| `TAURI_DEBUG` | 启用调试模式 | 否 |

## 使用方法

- 询问当前项目状态：例如 "现在项目进展到哪里了？"
- 检查阶段完成进度：例如 "阶段 A 完成了吗？"
- 获取任务详情：例如 "阶段 B 有哪些任务？"
- 跟踪验收标准：例如 "整体验收标准完成了几个？"
- 更新 skill 时：遵循本地调试 -> 验证通过后再发包的流程