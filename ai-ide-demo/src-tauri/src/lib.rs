mod cli;
mod features;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::process::Command as ProcessCommand;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};
use walkdir::WalkDir;

#[derive(Serialize, Deserialize)]
pub struct FileEntry {
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<u64>,
}

#[derive(Serialize, Deserialize)]
pub struct SearchHit {
    pub path: String,
    pub line: usize,
    pub preview: String,
}

#[derive(Serialize, Deserialize)]
pub struct CommandResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

#[tauri::command]
fn read_workspace_file(workspace_path: String, relative_path: String) -> Result<String, String> {
    let full_path = Path::new(&workspace_path).join(&relative_path);
    fs::read_to_string(&full_path)
        .map_err(|e| format!("读取文件失败 {}: {}", relative_path, e))
}

#[tauri::command]
fn write_workspace_file(workspace_path: String, relative_path: String, content: String) -> Result<(), String> {
    let full_path = Path::new(&workspace_path).join(&relative_path);
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("创建目录失败: {}", e))?;
    }
    fs::write(&full_path, content)
        .map_err(|e| format!("写入文件失败 {}: {}", relative_path, e))
}

#[tauri::command]
fn list_workspace_files(
    workspace_path: String,
    prefix: Option<String>,
) -> Result<Vec<FileEntry>, String> {
    let root = Path::new(&workspace_path);
    if !root.exists() {
        return Err("工作区不存在".to_string());
    }

    let mut entries = Vec::new();

    for entry in WalkDir::new(root)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        let relative = path.strip_prefix(root).unwrap_or(path);
        let relative_str = relative.to_string_lossy().replace('\\', "/");

        if let Some(ref pf) = prefix {
            if !relative_str.starts_with(pf) && !relative_str.starts_with(&pf[1..]) {
                continue;
            }
        }

        if relative_str.starts_with('.') || relative_str.contains("/.") {
            continue;
        }

        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        entries.push(FileEntry {
            path: format!("/{}", relative_str),
            is_dir: metadata.is_dir(),
            size: metadata.len(),
            modified: metadata.modified().ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs()),
        });
    }

    entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(entries)
}

#[tauri::command]
fn search_in_workspace(
    workspace_path: String,
    query: String,
    max_matches: Option<usize>,
) -> Result<Vec<SearchHit>, String> {
    let root = Path::new(&workspace_path);
    if !root.exists() {
        return Err("工作区不存在".to_string());
    }

    let max = max_matches.unwrap_or(50);
    let mut hits = Vec::new();

    for entry in WalkDir::new(root)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path.is_dir() {
            continue;
        }

        let relative_str = path.strip_prefix(root).unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");

        if relative_str.starts_with('.') || relative_str.contains("/.") {
            continue;
        }

        let content = match fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        for (line_num, line) in content.lines().enumerate() {
            if line.contains(&query) {
                hits.push(SearchHit {
                    path: relative_str.clone(),
                    line: line_num + 1,
                    preview: line.chars().take(240).collect(),
                });
                if hits.len() >= max {
                    return Ok(hits);
                }
            }
        }
    }

    Ok(hits)
}

#[tauri::command]
fn run_command(cmd: String, args: Vec<String>, cwd: Option<String>) -> Result<CommandResult, String> {
    let mut command = ProcessCommand::new(&cmd);
    command.args(&args);

    if let Some(cwd_path) = cwd {
        command.current_dir(cwd_path);
    }

    match command.output() {
        Ok(output) => {
            Ok(CommandResult {
                success: output.status.success(),
                stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                exit_code: output.status.code(),
            })
        }
        Err(e) => Err(format!("执行命令失败: {}", e)),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let show_item = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
            let hide_item = MenuItem::with_id(app, "hide", "隐藏窗口", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&show_item, &hide_item, &quit_item])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("AI IDE - Godot Assistant")
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "hide" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.hide();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_workspace_file,
            write_workspace_file,
            list_workspace_files,
            search_in_workspace,
            run_command,
            features::detect_godot_project,
            features::get_godot_version,
            features::run_godot,
            features::git_status,
            features::git_log,
            features::add_workspace,
            features::get_recent_workspaces,
            features::get_workspace_list,
            features::remove_workspace,
            features::detect_workspace_type,
            features::detect_language_server,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}