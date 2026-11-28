# 构建与测试

## 开发环境

- Windows 10 / 11 x64，安装 [Microsoft Edge WebView2 Evergreen Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)。
- Node.js 22.12 或更新版本。Tauri 集成脚本使用 Node.js 24。
- Rust 的 MSVC 工具链，目标为 `x86_64-pc-windows-msvc`。
- Visual Studio Build Tools 的「使用 C++ 的桌面开发」工作负载，包含 MSVC 和 Windows SDK。原生应用音频模块编译需要 SDK 中的 `audioclientactivationparams.h`。

从仓库根目录运行。

```powershell
npm ci
npm run dev:desktop
```

`dev.bat` 是同一个开发入口。Tauri 从 `127.0.0.1:1420` 的 Vite 开发服务加载 React 界面。需要在本机模拟多人房间时，使用[双开或三开](多开客户端.md)。

## 本机编译

```powershell
npm run build:desktop
```

`build-exe.bat` 执行同样的 `--no-bundle` 编译。默认测试文件位于 `.cache/tauri-target/x86_64-pc-windows-msvc/release/gameshare-tauri.exe`。设置 `CARGO_TARGET_DIR` 后，将此路径里的 `.cache/tauri-target` 换为指定目录。根目录的 `npm run build` 会同时编译独立 Node.js 信令服务。

```powershell
npm run typecheck
npm exec -- eslint apps/desktop/src apps/signaling/src packages apps/tauri/tests
node apps/tauri/tests/check-client.mjs .cache/tauri-target/x86_64-pc-windows-msvc/release/gameshare-tauri.exe
```

各项测试覆盖的功能及附加参数见 [Tauri 客户端说明](../apps/tauri/README.md)及[开发与回归检查](CONVENTIONS.md)。

## 运行已有便携包

在仓库旁的 `../release` 下解压相应便携包，保留其中的程序和随附文件。`run.bat` 在该目录中查找名称匹配 `GameShare-Tauri*.exe`、父目录名匹配 `*-tauri-*-portable*` 的程序，并启动最近修改的一份。也可直接启动解压后的程序。Cloudflare 自动隧道需要校验通过的 `cloudflared.exe`，组件来源和配置见 [Tauri 客户端说明](../apps/tauri/README.md)。

开发时使用前文的本机编译命令。正式分发时再制作发布包，发布产物放在仓库旁的 `../release`。Tauri 的 NSIS 安装器选项在 [tauri.conf.json](../apps/tauri/src-tauri/tauri.conf.json) 中，包含 WebView2 引导安装配置。使用 Cloudflare 的便携分发目录应提供匹配版本的组件及其许可文件。

## 常见环境问题

| 现象 | 排查 |
| --- | --- |
| 提示缺少 Tauri CLI | 在仓库根目录执行 `npm ci`。 |
| npm 在当前机器无法写入缓存 | 项目的 `.npmrc` 包含本机盘符缓存设置，可用 `npm ci --cache .cache/npm` 指定仓库内缓存。 |
| PowerShell 拦截 `npm.ps1` | 可以用 `npm.cmd` 执行同样的 npm 命令。 |
| 找不到 `node.exe` 或 Cargo | 检查 `PATH`。批处理入口也识别指向 Node.js 安装目录的 `GAMESHARE_NODE_DIR`，以及项目已有的 `.cache/tauri-toolchain` 本地工具链。 |
| 编译找不到 Windows 音频 API 头文件 | 检查 Windows SDK 和 C++ 工作负载，并确认 MSVC 工具链可用。 |

## Electron 兼容用途

Electron 源码和测试入口仍在仓库中。用 `npm run dev:electron` 启动旧客户端，或用 `npm run setup:electron` 为需要 Chromium 的历史回归脚本准备 Electron 运行时。旧版明确需要分发时，根目录的 `npm run build:electron:folder` 和 `npm run build:electron:exe` 分别生成目录版和安装器。Electron 的历史排障记录见[上游构建备忘](archive/upstream-electron/docs/BUILD-NOTES.md)。
