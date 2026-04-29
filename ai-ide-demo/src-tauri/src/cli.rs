use clap::{Parser, Subcommand};
use std::io::{self, BufRead, Write};
use std::path::PathBuf;
use std::process::Command as ProcessCommand;
use std::time::Duration;

#[derive(Parser)]
#[command(
    name = "ai-ide-cli",
    about = "AI IDE - 智能开发助手",
    version = "1.0.0"
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand)]
pub enum Commands {
    /// 初始化工作区
    Init {
        #[arg(default_value = ".")]
        path: PathBuf,
    },
    /// AI 对话（流式输出）
    Chat {
        #[arg(last = true)]
        message: Vec<String>,
    },
    /// 检测项目类型
    Detect {
        #[arg(default_value = ".")]
        path: PathBuf,
    },
    /// Git 状态
    Status {
        #[arg(default_value = ".")]
        path: PathBuf,
    },
    /// 执行外部程序
    Run {
        program: String,
        args: Vec<String>,
    },
    /// 打开桌面窗口并定位文件
    Edit {
        file: PathBuf,
        #[arg(long)]
        line: Option<usize>,
    },
    /// 交互式 REPL 模式
    Repl,
    /// 检查环境
    Check,
}

pub fn run() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Init { path } => {
            cmd_init(&path)?;
        }
        Commands::Chat { message } => {
            cmd_chat(message.join(" "))?;
        }
        Commands::Detect { path } => {
            cmd_detect(&path)?;
        }
        Commands::Status { path } => {
            cmd_status(&path)?;
        }
        Commands::Run { program, args } => {
            cmd_run(&program, &args)?;
        }
        Commands::Edit { file, line } => {
            cmd_edit(file, line)?;
        }
        Commands::Repl => {
            cmd_repl()?;
        }
        Commands::Check => {
            cmd_check()?;
        }
    }

    Ok(())
}

fn cmd_init(path: &PathBuf) -> Result<(), Box<dyn std::error::Error>> {
    use std::fs;

    let config_path = path.join(".ai-ide");
    let config_file = config_path.join("config.toml");

    if config_file.exists() {
        println!("工作区已初始化");
        return Ok(());
    }

    fs::create_dir_all(&config_path)?;

    let default_config = r#"# AI IDE 工作区配置
version = "1.0"

[ai]
model = "deepseek-chat"
"#;

    fs::write(&config_file, default_config)?;

    println!("✅ 工作区初始化完成: {}", config_path.display());
    Ok(())
}

fn cmd_chat(message: String) -> Result<(), Box<dyn std::error::Error>> {
    let api_key = std::env::var("DEEPSEEK_API_KEY")
        .expect("请设置 DEEPSEEK_API_KEY 环境变量");

    let system_prompt = "你是一个专业的开发者助手。用户会发送指令，你需要直接回复代码或解决方案。";

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()?;

    let request_body = serde_json::json!({
        "model": "deepseek-chat",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": message}
        ]
    });

    let response = client
        .post("https://api.deepseek.com/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()?
        .error_for_status()?;

    let json: serde_json::Value = response.json()?;

    let content = json["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("");

    println!("{}", content);

    Ok(())
}

fn cmd_detect(path: &PathBuf) -> Result<(), Box<dyn std::error::Error>> {
    let p = path.as_path();

    println!("🔍 检测项目: {}", p.display());
    println!("---");

    if p.join("project.godot").exists() {
        println!("🎮 Godot 项目");
    }

    if p.join(".git").exists() {
        println!("📦 Git 仓库");
    }

    if p.join("Cargo.toml").exists() {
        println!("🦀 Rust 项目");
    }

    if p.join("package.json").exists() {
        println!("📦 Node.js 项目");
    }

    if p.join("pyproject.toml").exists() || p.join("setup.py").exists() {
        println!("🐍 Python 项目");
    }

    Ok(())
}

fn cmd_status(path: &PathBuf) -> Result<(), Box<dyn std::error::Error>> {
    let repo = path;

    if !repo.join(".git").exists() {
        println!("❌ 不是 Git 仓库");
        return Ok(());
    }

    let branch = String::from_utf8_lossy(
        &std::process::Command::new("git")
            .args(["branch", "--show-current"])
            .current_dir(repo)
            .output()?
            .stdout
    ).trim().to_string();

    println!("🌿 分支: {}", branch);

    let output = std::process::Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(repo)
        .output()?;

    let changes = String::from_utf8_lossy(&output.stdout);
    let lines: Vec<&str> = changes.lines().collect();

    if lines.is_empty() {
        println!("✅ 工作区干净");
    } else {
        println!("📝 {} 个文件有更改", lines.len());
    }

    Ok(())
}

fn cmd_run(program: &str, args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let output = ProcessCommand::new(program)
        .args(args)
        .output()?;

    io::stdout().write_all(&output.stdout)?;
    io::stderr().write_all(&output.stderr)?;

    std::process::exit(output.status.code().unwrap_or(1));
}

fn cmd_edit(file: PathBuf, line: Option<usize>) -> Result<(), Box<dyn std::error::Error>> {
    let file_path = file.to_string_lossy();

    if !file.exists() {
        eprintln!("❌ 文件不存在: {}", file_path);
        return Ok(());
    }

    println!("📝 打开文件: {}", file_path);
    if let Some(l) = line {
        println!("   定位行号: {}", l);
    }

    #[cfg(target_os = "macos")]
    {
        let mut cmd = ProcessCommand::new("open");
        if let Some(l) = line {
            cmd.arg("-a").arg("Visual Studio Code").arg("--goto")
               .arg(format!("{}:{}", file_path, l));
        } else {
            cmd.arg("-a").arg("Visual Studio Code").arg(&*file_path);
        }
        cmd.spawn()?;
    }

    #[cfg(target_os = "linux")]
    {
        let mut cmd = ProcessCommand::new("code");
        if let Some(l) = line {
            cmd.arg("--goto").arg(format!("{}:{}", file_path, l));
        } else {
            cmd.arg(&*file_path);
        }
        cmd.spawn()?;
    }

    #[cfg(target_os = "windows")]
    {
        let mut cmd = ProcessCommand::new("code");
        if let Some(l) = line {
            cmd.arg("--goto").arg(format!("{}:{}", file_path, l));
        } else {
            cmd.arg(&*file_path);
        }
        cmd.spawn()?;
    }

    Ok(())
}

fn cmd_repl() -> Result<(), Box<dyn std::error::Error>> {
    println!("🤖 AI IDE REPL - 交互式对话模式");
    println!("输入消息开始对话，输入 'exit' 或 'quit' 退出");
    println!("---");

    let stdin = io::stdin();
    let mut input = String::new();

    let api_key = std::env::var("DEEPSEEK_API_KEY")
        .expect("请设置 DEEPSEEK_API_KEY 环境变量");

    let system_prompt = "你是一个专业的开发者助手。用户会发送指令，你需要直接回复代码或解决方案。保持对话简洁。";

    let mut messages = vec![
        serde_json::json!({"role": "system", "content": system_prompt}),
    ];

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()?;

    loop {
        print!("\n> ");
        io::stdout().flush()?;

        input.clear();
        let read_result = stdin.lock().read_line(&mut input);
        if read_result.is_err() || input.trim().is_empty() {
            continue;
        }

        let input = input.trim().to_string();
        if input == "exit" || input == "quit" {
            println!("👋 再见!");
            break;
        }

        messages.push(serde_json::json!({"role": "user", "content": input}));

        let request_body = serde_json::json!({
            "model": "deepseek-chat",
            "messages": messages.clone()
        });

        print!("🤖 ");

        let response = client
            .post("https://api.deepseek.com/chat/completions")
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&request_body)
            .send()?
            .error_for_status()?;

        let json: serde_json::Value = response.json()?;

        let assistant_message = json["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("");

        println!("{}", assistant_message);

        messages.push(serde_json::json!({"role": "assistant", "content": assistant_message}));
    }

    Ok(())
}

fn cmd_check() -> Result<(), Box<dyn std::error::Error>> {
    println!("🔧 检查环境...\n");

    let node_version = std::process::Command::new("node").arg("--version").output()?;
    println!("✅ Node.js: {}", String::from_utf8_lossy(&node_version.stdout).trim());

    let npm_version = std::process::Command::new("npm").arg("--version").output()?;
    println!("✅ npm: {}", String::from_utf8_lossy(&npm_version.stdout).trim());

    let rustc_version = std::process::Command::new("rustc").arg("--version").output()?;
    println!("✅ Rust: {}", String::from_utf8_lossy(&rustc_version.stdout).trim());

    let cargo_version = std::process::Command::new("cargo").arg("--version").output()?;
    println!("✅ Cargo: {}", String::from_utf8_lossy(&cargo_version.stdout).trim());

    match std::process::Command::new("godot").arg("--version").output() {
        Ok(o) => {
            let godot_version = String::from_utf8_lossy(&o.stdout).trim().to_string();
            println!("✅ Godot: {}", godot_version);
        }
        Err(_) => {
            println!("⚠️  Godot: 未安装 (可选)");
        }
    }

    if std::env::var("DEEPSEEK_API_KEY").is_ok() {
        println!("✅ DEEPSEEK_API_KEY: 已设置");
    } else {
        println!("⚠️  DEEPSEEK_API_KEY: 未设置 (必填)");
    }

    Ok(())
}