# 阶段 B：CLI 入口

**目标：** 实现独立的命令行工具 `ai-ide-cli`，复用 Rust 后端核心逻辑，支持交互式 REPL 和批处理命令。

**前置条件：** 阶段 A 完成

---

## B.1 任务清单

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

---

## B.2 CLI 框架设计

### B-1: 添加 clap 依赖

```toml
# src-tauri/Cargo.toml

[dependencies]
# 现有依赖...
clap = { version = "4.5", features = ["derive", "cargo"] }
tokio = { version = "1", features = ["full"] }
reqwest = { version = "0.12", features = ["json", "stream"] }
```

### B-2: CLI 命令定义

```rust
// src-tauri/src/cli.rs

use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser)]
#[command(
    name = "ai-ide-cli",
    about = "AI IDE - 智能开发助手",
    version,
    author = "Your Name"
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,

    /// 启用详细输出
    #[arg(short, long, global = true)]
    pub verbose: bool,

    /// 配置文件路径
    #[arg(short, long, global = true, default_value = "~/.ai-ide/config.toml")]
    pub config: PathBuf,
}

#[derive(Subcommand)]
pub enum Commands {
    /// 初始化新工作区
    Init {
        /// 工作区路径
        #[arg(default_value = ".")]
        path: PathBuf,

        /// 强制初始化（覆盖现有配置）
        #[arg(short, long)]
        force: bool,
    },

    /// 与 AI 对话
    Chat {
        /// 对话消息
        #[arg(last = true)]
        message: Vec<String>,

        /// 非流式输出（适用于脚本）
        #[arg(short, long)]
        no_stream: bool,
    },

    /// 在编辑器中打开文件
    Edit {
        /// 文件路径（可选，打开工作区根目录）
        #[arg(default_value = ".")]
        path: PathBuf,

        /// 跳转到指定行
        #[arg(short, long)]
        line: Option<u32>,

        /// 跳转到指定列
        #[arg(short, long)]
        column: Option<u32>,
    },

    /// 运行命令或脚本
    Run {
        /// 要运行的命令
        command: String,

        /// 命令参数
        args: Vec<String>,

        /// 工作目录
        #[arg(short, long)]
        cwd: Option<PathBuf>,
    },

    /// 检查环境
    Check {
        /// 检查项目（默认检查工作区）
        #[arg(default_value = ".")]
        path: PathBuf,
    },

    /// 进入交互式 REPL 模式
    Repl,
}

impl Cli {
    pub fn parse_and_run() -> Result<(), Box<dyn std::error::Error>> {
        let cli = Cli::parse();

        if cli.verbose {
            println!("[DEBUG] Config: {:?}", cli.config);
        }

        match &cli.command {
            Commands::Init { path, force } => {
                Self::cmd_init(path, *force)?;
            }
            Commands::Chat { message, no_stream } => {
                Self::cmd_chat(message.join(" "), *no_stream)?;
            }
            Commands::Edit { path, line, column } => {
                Self::cmd_edit(path, *line, *column)?;
            }
            Commands::Run { command, args, cwd } => {
                Self::cmd_run(command, args, cwd.as_ref())?;
            }
            Commands::Check { path } => {
                Self::cmd_check(path)?;
            }
            Commands::Repl => {
                Self::cmd_repl()?;
            }
        }

        Ok(())
    }

    // ... 具体实现见下方
}
```

---

## B-3: init 子命令实现

```rust
/// 初始化工作区
fn cmd_init(path: &PathBuf, force: bool) -> Result<(), Box<dyn std::error::Error>> {
    use std::fs;

    let config_path = path.join(".ai-ide");
    let config_file = config_path.join("config.toml");

    if config_file.exists() && !force {
        println!("工作区已初始化（使用 --force 重新初始化）");
        return Ok(());
    }

    fs::create_dir_all(&config_path)?;

    let default_config = r#"# AI IDE 工作区配置
version = "1.0"

[workspace]
# 工作区根目录（相对于 .ai-ide 所在目录）
root = "."

[ai]
# DeepSeek API Key（建议使用环境变量 DEEPSEEK_API_KEY）
# api_key = "your-api-key-here"
model = "deepseek-chat"

[editor]
# 默认编辑器设置
font_size = 14
tab_size = 4

[godot]
# Godot 引擎路径
path = "godot"
"#;

    fs::write(&config_file, default_config)?;

    println!("✅ 工作区初始化完成: {}", config_path.display());
    println!("请编辑 {} 配置你的 AI API Key", config_file.display());

    Ok(())
}
```

---

## B-4: chat 子命令实现（流式）

```rust
/// 与 AI 对话
fn cmd_chat(message: String, no_stream: bool) -> Result<(), Box<dyn std::error::Error>> {
    use futures_util::StreamExt;

    let api_key = std::env::var("DEEPSEEK_API_KEY")
        .expect("请设置 DEEPSEEK_API_KEY 环境变量");

    let system_prompt = r#"你是一个专业的网页开发助手。用户会发送指令，你需要直接回复代码或解决方案。"#;

    let client = reqwest::Client::new();
    let request_body = serde_json::json!({
        "model": "deepseek-chat",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": message}
        ],
        "stream": !no_stream
    });

    if no_stream {
        // 非流式模式
        let response = client
            .post("https://api.deepseek.com/chat/completions")
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&request_body)
            .send()?
            .error_for_status()?
            .json::<serde_json::Value>()?;

        let content = response["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("");
        println!("{}", content);
    } else {
        // 流式模式
        let mut request = request_body.clone();
        request["stream"] = serde_json::json!(true);

        let mut stream = client
            .post("https://api.deepseek.com/chat/completions")
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()?
            .error_for_status();

        let mut stream = stream?.bytes_stream();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            let text = String::from_utf8_lossy(&chunk);

            // 解析 SSE 格式
            for line in text.lines() {
                if line.starts_with("data: ") {
                    let data = &line[6..];
                    if data == "[DONE]" {
                        println!();
                        return Ok(());
                    }
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                        if let Some(content) = parsed["choices"][0]["delta"]["content"].as_str() {
                            print!("{}", content);
                            std::io::stdout().flush()?;
                        }
                    }
                }
            }
        }
        println!();
    }

    Ok(())
}
```

---

## B-5: edit 子命令实现

```rust
/// 打开编辑器窗口
fn cmd_edit(path: &PathBuf, line: Option<u32>, column: Option<u32>) -> Result<(), Box<dyn std::error::Error>> {
    use std::env;

    // 查找桌面端应用
    #[cfg(target_os = "macos")]
    let app_path = "ai-ide.app";

    #[cfg(target_os = "windows")]
    let app_path = "ai-ide.exe";

    #[cfg(target_os = "linux")]
    let app_path = "ai-ide";

    // 通过环境变量传递打开参数
    let mut open_path = path.clone();
    if path.to_string_lossy() == "." {
        open_path = env::current_dir()?;
    }

    let mut cmd = std::process::Command::new("open"); // macOS
    #[cfg(target_os = "macos")]
    {
        cmd.arg("-a")
           .arg(app_path)
           .arg("--args")
           .arg(format!("--open-file={}", open_path.display()));
        if let (Some(l), Some(c)) = (line, column) {
            cmd.arg(format!("--line={}", l));
            cmd.arg(format!("--column={}", c));
        }
    }

    #[cfg(target_os = "windows")]
    {
        cmd = std::process::Command::new(app_path);
        cmd.arg(format!("--open-file={}", open_path.display()));
        if let (Some(l), Some(c)) = (line, column) {
            cmd.arg(format!("--line={}", l));
            cmd.arg(format!("--column={}", c));
        }
    }

    // 启动桌面应用
    cmd.spawn()?;
    println!("已在编辑器中打开: {}", open_path.display());

    Ok(())
}
```

---

## B-6: run 子命令实现

```rust
/// 运行外部命令
fn cmd_run(command: &str, args: &[String], cwd: Option<&PathBuf>) -> Result<(), Box<dyn std::error::Error>> {
    use std::io::Write;

    let mut cmd = std::process::Command::new(command);
    cmd.args(args);

    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }

    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn()?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // 并发输出 stdout 和 stderr
    let stdout_handle = stdout.map(|s| {
        std::thread::spawn(move || {
            let mut s = s;
            let mut buf = [0u8; 8192];
            while let Ok(n) = s.read(&mut buf) {
                if n == 0 { break; }
                std::io::stdout().write_all(&buf[..n]).ok();
            }
        })
    });

    let stderr_handle = stderr.map(|s| {
        std::thread::spawn(move || {
            let mut s = s;
            let mut buf = [0u8; 8192];
            while let Ok(n) = s.read(&mut buf) {
                if n == 0 { break; }
                std::io::stderr().write_all(&buf[..n]).ok();
            }
        })
    });

    let status = child.wait()?;

    if let Some(h) = stdout_handle {
        h.join().ok();
    }
    if let Some(h) = stderr_handle {
        h.join().ok();
    }

    if !status.success() {
        std::process::exit(status.code().unwrap_or(1));
    }

    Ok(())
}
```

---

## B-7: REPL 交互模式

```rust
/// 交互式 REPL
fn cmd_repl() -> Result<(), Box<dyn std::error::Error>> {
    use rustyline::Editor;

    let mut rl = Editor::<()>::new()?;
    let history_file = dirs::config_dir()
        .map(|p| p.join("ai-ide").join("repl_history"))
        .unwrap_or_default();

    if let Some(parent) = history_file.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    rl.load_history(&history_file).ok();

    println!("🤖 AI IDE REPL - 输入 !help 获取帮助，输入 !exit 退出");
    println!("─────────────────────────────────────────────────");

    loop {
        let readline = rl.readline(">>> ");
        match readline {
            Ok(line) => {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }

                // 处理特殊命令
                if line == "!exit" || line == "!quit" {
                    println!("再见！");
                    break;
                }

                if line == "!help" {
                    println!("可用命令:");
                    println!("  !exit, !quit  - 退出 REPL");
                    println!("  !clear       - 清屏");
                    println!("  !history     - 查看历史");
                    continue;
                }

                if line == "!clear" {
                    print!("\x1B[2J\x1B[1;1H");
                    continue;
                }

                rl.add_history_entry(line)?;

                // 调用 chat
                if let Err(e) = Self::cmd_chat(line.to_string(), false) {
                    eprintln!("错误: {}", e);
                }
            }
            Err(_) => break,
        }
    }

    rl.save_history(&history_file).ok();
    Ok(())
}
```

---

## B-8: 双入口 main.rs

```rust
// src-tauri/src/main.rs

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // 检查是否为 CLI 模式（无窗口）
    let args: Vec<String> = std::env::args().collect();

    if args.len() > 1 && !args[1].starts_with("-") {
        // CLI 模式
        // 跳过应用自身路径，处理子命令
        let cli_args: Vec<&str> = args[1..].iter().map(|s| s.as_str()).collect();
        // 使用 clap 解析（需单独处理）
        ai_ide_cli::run(cli_args);
    } else {
        // 窗口模式 - 调用现有入口
        app_lib::run();
    }
}

// 更好的方案：分离 CLI 和窗口的 Cargo target
```

### 推荐：分离 Cargo profile

```toml
# src-tauri/Cargo.toml

[[bin]]
name = "ai-ide"
path = "src/main.rs"

[[bin]]
name = "ai-ide-cli"
path = "src/cli_main.rs"
```

```rust
// src-tauri/src/cli_main.rs - CLI 入口

fn main() {
    ai_ide_cli::run();
}
```

---

## B-3 验收标准

- [ ] `ai-ide-cli --help` 显示完整帮助
- [ ] `ai-ide-cli init ./my-project` 创建工作区
- [ ] `ai-ide-cli chat "帮我写一个 Hello World"` 流式输出
- [ ] `ai-ide-cli edit ./src/main.rs --line 10` 打开桌面窗口
- [ ] `ai-ide-cli run godot -- --version` 执行外部命令
- [ ] `ai-ide-cli repl` 进入交互模式
- [ ] CLI 和桌面端共用同一 Rust 核心

---

## 预计改动文件

| 文件 | 改动说明 |
|------|----------|
| `src-tauri/Cargo.toml` | 新增 clap, tokio, reqwest 依赖 |
| `src-tauri/src/main.rs` | 改为双入口判断 |
| `src-tauri/src/cli.rs` | 新增，所有 CLI 命令实现 |
| `src-tauri/src/cli_main.rs` | 新增，CLI 专用入口 |
| `.ai-ide/config.toml` | 工作区配置文件 |

---

## 下一阶段

[阶段 C：功能增强](./C_功能增强.md)
