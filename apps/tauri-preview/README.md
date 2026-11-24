# GameShare Tauri 技术预览

此预览用三个本机 WebRTC 连接检验 Tauri 和 WebView2 Evergreen 的独立置顶窗口。主窗口的 Worker 生成三路 640 × 360、30 fps 的动态测试视频。每个浮窗用自己的 WebView2 实例解码和显示一路视频。

## 使用

1. 安装并打开 GameShare Tauri Preview。
2. 点击「打开三路浮窗」，等到三个小窗显示各自的测试视频。
3. 分别拖动标题栏、拉动窗口边缘并调整大小。点击「最小化主窗口」，观察三路画面和各自的帧率。
4. 从任务栏恢复主窗口。点击「关闭全部浮窗」结束测试。

当前范围是本机视频链路和窗口验证。GameShare 房间、真实游戏采集、应用声音、语音和异地隧道由 Electron 版本提供。

## 构建

使用带 MSVC 工具链和 Windows SDK 的 Windows x64 环境。在此目录运行 `npx --yes @tauri-apps/cli@2.12.6 build --target x86_64-pc-windows-msvc --bundles nsis`。安装器复用系统 WebView2，并在缺少 Evergreen Runtime 的机器上下载微软 Bootstrapper。

## 回归测试

使用 Node.js 24 运行 `node tests/check.mjs <gameshare-tauri-preview.exe 的路径>`。测试使用独立 WebView2 配置，通过 Windows 窗口状态确认置顶、最小化、还原和独立移动缩放。每路视频在主窗口最小化前、最小化期间和还原后均须达到至少 24 fps，最长帧间隔须小于 250 ms。
