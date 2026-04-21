# 阶段 D：打包与分发

**目标：** 配置 Tauri 打包选项，产出各平台安装包，建立分发流程。

**前置条件：** 阶段 A + B 完成

---

## D.1 任务清单

| 任务ID | 功能 | 实现方式 | 优先级 |
|--------|------|----------|--------|
| D-1 | macOS 打包 | tauri build + codesign | P0 |
| D-2 | Windows 打包 | tauri build + signtool | P1 |
| D-3 | Linux 打包 | tauri build | P1 |
| D-4 | 自动更新 | tauri-plugin-updater | P2 |
| D-5 | CI/CD 配置 | GitHub Actions | P2 |

---

## D-2 tauri.conf.json 配置

```json
// src-tauri/tauri.conf.json

{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "AI IDE",
  "version": "1.0.0",
  "identifier": "com.aiide.app",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:5173",
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build"
  },
  "app": {
    "windows": [
      {
        "title": "AI IDE",
        "width": 1200,
        "height": 800,
        "minWidth": 800,
        "minHeight": 600,
        "center": true,
        "resizable": true,
        "fullscreen": false,
        "decorations": true
      }
    ],
    "security": {
      "csp": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://api.deepseek.com https://*; img-src 'self' data: blob:;"
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "category": "public.app-category.developer-tools",
    "shortDescription": "AI-powered Code Editor",
    "longDescription": "A modern IDE with AI assistance for web development",
    "macOS": {
      "minimumSystemVersion": "10.15",
      "entitlements": null,
      "exceptionDomain": "",
      "frameworks": [],
      "providerShortName": null,
      "signingIdentity": null
    },
    "windows": {
      "certificateThumbprint": null,
      "digestAlgorithm": "sha256",
      "timestampUrl": "",
      "wix": null,
      "nsis": {
        "displayLanguageSelector": false,
        "installerIcon": "icons/icon.ico",
        "headerImage": null,
        "sidebarImage": null
      }
    },
    "linux": {
      "appimage": {
        "bundleMediaFramework": false
      },
      "deb": {
        "depends": []
      }
    }
  },
  "plugins": {
    "shell": {
      "open": true,
      "scope": [
        {
          "name": "godot",
          "cmd": "godot",
          "args": true
        },
        {
          "name": "git",
          "cmd": "git",
          "args": true
        },
        {
          "name": "npm",
          "cmd": "npm",
          "args": true
        },
        {
          "name": "node",
          "cmd": "node",
          "args": true
        }
      ]
    }
  }
}
```

---

## D-3 macOS 代码签名

### 签名配置

```bash
# macOS 需要 Apple Developer 证书
# 1. 在 Apple Developer Portal 创建证书
# 2. 导入到钥匙串
# 3. 配置 tauri.conf.json

# 签名身份（从钥匙串获取）
TAURI_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"

# 或使用 ad-hoc 签名（仅限开发）
# identifier = null
```

### 常用签名命令

```bash
# 检查证书
security find-identity -v -p codesigning

# 手动签名（可选，tauri build 会自动处理）
codesign -s "Developer ID Application: Your Name (TEAMID)" \
  --options runtime \
  --entitlements src-tauri/entitlements.plist \
  path/to/app.app

# 验证签名
codesign -dvvv path/to/app.app
```

### entitlements.plist

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
    <key>com.apple.security.network.client</key>
    <true/>
    <key>com.apple.security.network.server</key>
    <true/>
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>
</dict>
</plist>
```

---

## D-4 Windows 打包

### NSIS 安装包

```json
// tauri.conf.json windows.nsis 配置
{
  "displayLanguageSelector": true,
  "installerIcon": "icons/icon.ico",
  "languages": ["SimpChinese", "English"],
  "license": null,
  "headerImage": null,
  "sidebarImage": null
}
```

### 创建安装包

```bash
npm run tauri build

# 输出：
# src-tauri/target/release/bundle/nsis/AI-IDE-1.0.0-setup.exe
# src-tauri/target/release/bundle/msi/AI-IDE-1.0.0.msi
```

### Windows 代码签名

```bash
# 使用 signtool.exe
# 1. 从 Windows SDK 安装 signtool
# 2. 使用代码签名证书签名

signtool sign /f certificate.pfx /p password /tr http://timestamp.digicert.com /td sha256 /fd sha256 \
  AI-IDE-1.0.0-setup.exe
```

---

## D-5 Linux 打包

### 各发行版支持

| 格式 | 工具 | 说明 |
|------|------|------|
| .deb | dpkg | Debian/Ubuntu |
| .rpm | rpm | Fedora/RHEL |
| .AppImage | - | 通用格式 |
| .tar.gz | - | 免安装 |

### 配置

```json
// tauri.conf.json linux 配置
{
  "linux": {
    "appimage": {
      "bundleMediaFramework": false
    },
    "deb": {
      "depends": ["libwebkit2gtk-4.1-0", "libgtk-3-0"],
      "section": "devel"
    },
    "rpm": {
      "depends": ["webkit2gtk4.1", "gtk3"]
    }
  }
}
```

### 构建命令

```bash
# 构建所有 Linux 目标
npm run tauri build -- --target universal-linux

# 或指定目标
npm run tauri build -- --target deb
npm run tauri build -- --target rpm
npm run tauri build -- --target appimage
```

---

## D-6 自动更新

### 配置 updater 插件

```json
// tauri.conf.json
{
  "plugins": {
    "updater": {
      "pubkey": "YOUR_PUBLIC_KEY",
      "endpoints": [
        "https://releases.yourdomain.com/{{target}}/{{arch}}/{{current_version}}"
      ],
      "windows": {
        "installMode": "passive"
      }
    }
  }
}
```

### Cargo.toml 添加插件

```toml
# src-tauri/Cargo.toml
[dependencies]
tauri-plugin-updater = "2"
```

### Rust 代码集成

```rust
// src-tauri/src/lib.rs

use tauri_plugin_updater::UpdaterExt;

tauri::Builder::default()
    .plugin(tauri_plugin_updater::Builder::new().build())
    .setup(|app| {
        #[cfg(not(debug_assertions))]
        {
            let handle = app.handle().clone();
            app.handle().plugin(
                tauri_plugin_updater::Builder::new()
                    .build(),
            )?;

            // 检查更新
            if let Some(update) = handle.updater()?.check().await? {
                println!("发现新版本: {}", update.version);
                // 显示更新对话框
            }
        }
        Ok(())
    })
```

---

## D-7 CI/CD 配置

### GitHub Actions

```yaml
# .github/workflows/release.yml

name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    permissions:
      contents: write
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: 'macos-latest'
            args: '--target aarch64-apple-darwin'
          - platform: 'macos-latest'
            args: '--target x86_64-apple-darwin'
          - platform: 'ubuntu-22.04'
            args: ''
          - platform: 'windows-latest'
            args: ''

    runs-on: ${{ matrix.platform }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: '**/node_modules'

      - name: Install dependencies
        run: npm ci

      - name: Setup Rust
        uses: dtolnay/rust-action@stable
        with:
          targets: ${{ matrix.platform == 'macos-latest' && 'aarch64-apple-darwin,x86_64-apple-darwin' || '' }}

      - name: Build
        run: npm run tauri build ${{ matrix.args }}
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # macOS 签名
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          # Windows 签名
          windows_certificate: ${{ secrets.WINDOWS_CERTIFICATE }}

      - name: Upload artifacts
        uses: actions/upload-release-asset@v1
        with:
          upload_url: ${{ env.UPLOAD_URL }}
          asset_path: src-tauri/target/release/bundle/${{ matrix.platform }}
          asset_name: ${{ matrix.platform }}
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## D-8 打包验证清单

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

---

## D-3 文件变更总结

| 文件 | 改动说明 |
|------|----------|
| `src-tauri/tauri.conf.json` | 配置打包选项、签名、插件 |
| `src-tauri/entitlements.plist` | 新增，macOS 权限配置 |
| `.github/workflows/release.yml` | 新增，CI/CD 配置 |
| `src-tauri/Cargo.toml` | 添加 updater 插件依赖 |

---

## 迁移完成

完成以上四个阶段后，AI IDE 项目将具备：

- ✅ 完整的 Tauri 桌面端
- ✅ 功能完整的 CLI 工具
- ✅ 原生文件系统访问
- ✅ 外部进程管理
- ✅ 多平台打包分发
- ✅ 可选的 LSP/Git/Godot 集成
