# 参考：AI IDE 精简版 Demo 方案（历史文档）

说明：
- 本文档为早期“最小 Demo 范围”定义，用于回溯。
- 当前阶段化执行清单以 [00_阶段总览.md](file:///Users/goumomo/Desktop/Project/ai-ide/.trae/documents/00_阶段总览.md) 与各阶段文档为准。

---

# AI IDE 精简版 Demo 方案

## 核心功能
让 AI 快速生成代码（如生成一个 HTML 页面），编辑器 + AI 对话，简化所有非核心功能。

---

## 技术栈

| 层级 | 技术选型 | 说明 |
|------|----------|------|
| **桌面框架** | Tauri 2.0 | 轻量、跨平台，未来可无缝转桌面 |
| **前端框架** | React 18 + TypeScript | 生态成熟，方便后续扩展 |
| **编辑器** | CodeMirror 6 | 轻量可定制，支持远程开发 |
| **AI 集成** | OpenAI API / Claude API | REST API 调用，模型可切换 |
| **样式** | Tailwind CSS | 快速开发 |
| **状态管理** | Zustand | 轻量级状态管理 |
| **构建工具** | Vite | 快 |

**为什么选 Tauri 而不是 Electron？**
- 体积小（~10MB vs ~150MB）
- 性能好（Rust 后端）
- 未来接入 Godot 更方便（Rust + C++）

---

## 实现功能（Demo 版）

### 1. 代码编辑器
- 基本的代码编辑（文本输入）
- 语法高亮（HTML/CSS/JS）
- 行号显示
- 撤销/重做

### 2. AI 对话面板
- 简单的 Chat 输入框
- AI 回复展示（Markdown 渲染）
- 代码块可复制

### 3. AI 生成代码
- 输入需求 → AI 生成代码 → 自动插入编辑器
- 一个按钮：「用 AI 生成 HTML 页面」→ 5 秒生成带样式的完整页面

### 4. 基础 UI
- 左右分栏：左侧编辑器，右侧 AI 对话
- 顶部简单工具栏

---

## 实施步骤

**Day 1：环境搭建**
- [ ] 初始化 Tauri + React + Vite 项目
- [ ] 集成 CodeMirror 6 编辑器
- [ ] 基础 UI 布局

**Day 2：AI 功能**
- [ ] 接入 OpenAI API
- [ ] Chat 对话功能
- [ ] 代码生成并插入编辑器

**Day 3：完善体验**
- [ ] 样式美化
- [ ] 快捷键支持
- [ ] 错误处理

---

## 项目结构

```
ai-ide/
├── src/                    # React 前端
│   ├── components/
│   │   ├── Editor.tsx      # CodeMirror 编辑器
│   │   ├── ChatPanel.tsx   # AI 对话面板
│   │   └── Toolbar.tsx     # 工具栏
│   ├── hooks/
│   │   └── useAI.ts        # AI API 调用
│   ├── App.tsx
│   └── main.tsx
├── src-tauri/              # Tauri 后端（Rust）
│   ├── src/main.rs
│   └── Cargo.toml
├── index.html
└── package.json
```

---

## 后续扩展（Godot 集成）

- Godot 项目识别（project.godot）
- GDScript 语法高亮
- Godot 引擎 IPC 通信
- 场景文件预览

---

## 预计 Demo 效果

用户打开应用 → 左侧编辑器，右侧 AI 对话 → 对 AI 说「帮我写一个 Todo 列表页面」→ AI 生成完整 HTML+CSS+JS 代码并插入编辑器 → 用户可以直接看到效果。

