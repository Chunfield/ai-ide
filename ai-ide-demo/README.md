# AI IDE - Godot Assistant

一个现代化的 AI 驱动的代码编辑器，专为 Godot 游戏开发而设计，同时也支持通用编程任务。

## 功能特性

### 🎨 代码编辑
- 基于 Monaco Editor 的强大代码编辑体验
- 支持多语言语法高亮
- 智能代码补全
- 内联编辑功能：选中代码后可直接让 AI 改写

### 💬 AI 对话助手
- 侧边栏实时对话界面
- 支持 @ 文件上下文引用
- 思维过程展开/折叠
- 流式输出显示
- 命令支持：`/new` 新建文件、`/clear` 清除对话、`/preview` 切换预览

### 📁 文件管理
- 可视化文件树
- 多文件批量操作
- 文件差异对比 (Diff)
- 多文件变更预览 (Multi-Diff)

### 👁️ 实时预览
- HTML 文件实时预览
- 可调节面板宽度
- 响应式布局

### ⚙️ 设置管理
- API 配置
- 主题设置
- 编辑器偏好设置

## 技术栈

- **前端框架**: React 18 + TypeScript
- **构建工具**: Vite
- **桌面应用**: Tauri 2
- **代码编辑**: Monaco Editor
- **状态管理**: Zustand
- **样式**: Tailwind CSS
- **AI 集成**: DeepSeek API

## 开始使用

### 环境要求

- Node.js 18+
- Rust 1.77+
- npm / pnpm / yarn

### 安装依赖

```bash
cd ai-ide-demo
npm install
```

### 开发模式

```bash
npm run tauri dev
```

### 构建发布

```bash
npm run tauri build
```

## 快捷键

| 功能 | 快捷键 |
|------|--------|
| 新建文件 | `/new` |
| 清除对话 | `/clear` |
| 切换预览 | `/preview` |
| 内联编辑 | 选中代码后点击编辑按钮 |

## 版本历史

### v1.1.0
- ✨ 全新升级的 Monaco Editor 集成
- ✨ Inline Edit 内联编辑功能
- ✨ Multi-Diff 多文件变更预览
- ✨ 文件上下文引用 (@文件)
- 🎨 UI 优化与细节改进
- 🐛 问题修复与稳定性提升

### v1.0.0
- 初始版本发布
- 基础代码编辑功能
- AI 对话助手
- HTML 预览功能
- 文件树管理

## License

MIT
