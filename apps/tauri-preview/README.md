# GameShare Tauri 浮窗预览

这个独立实验用来验证 Windows WebView2 置顶浮窗。同一个主窗口的 Worker 生成三路 640 × 360、30 fps 的测试画面，每个浮窗通过各自的本机 WebRTC 连接接收一路视频。完整的房间、采集和语音功能见 [Tauri 主客户端](../tauri/README.md)。

## 编译和运行

按[构建指南](../../docs/BUILD-NOTES.md)准备工具链。在仓库根目录安装依赖，然后从预览目录调用仓库锁定的 Tauri CLI。

```powershell
npm ci
Set-Location apps/tauri-preview
node ../../node_modules/@tauri-apps/cli/tauri.js build --no-bundle --target x86_64-pc-windows-msvc
```

默认输出为 `src-tauri/target/x86_64-pc-windows-msvc/release/gameshare-tauri-preview.exe`。启动后点击「打开三路浮窗」，拖动或缩放各个窗口，再点击「最小化主窗口」观察三路画面是否继续播放。恢复主窗口后可关闭这批浮窗。

## 回归测试

在预览目录用 Node.js 24 运行，亦可传入已有 EXE 的绝对路径。

```powershell
node tests/check.mjs src-tauri/target/x86_64-pc-windows-msvc/release/gameshare-tauri-preview.exe
```

脚本用独立 WebView2 配置检查置顶、独立移动缩放、最小化、还原和关闭重开。主窗口最小化前、最小化期间及还原后，各路视频的采样帧率应至少达到 24 fps，最长帧间隔应小于 250 ms。
