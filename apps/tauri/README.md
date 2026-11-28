# GameShare Tauri 客户端

这是 GameShare 的主客户端。界面和 WebRTC 会话位于 [apps/desktop/src](../desktop/src/App.tsx)，由 Tauri 和 WebView2 运行。Rust 后端提供本机信令、Windows 原生浮窗、应用音频、全局按住说话及 Cloudflare 临时隧道。

在仓库根目录安装依赖后运行 `npm run dev:desktop`。环境配置、编译输出和常见问题见[构建与测试指南](../../docs/BUILD-NOTES.md)。

## 采集与观看

使用 WebView2 的共享面板选择窗口或屏幕。窗口共享会尝试自动采集窗口所在应用的声音。自动采集失败时画面继续发送，也可在共享期间通过「选择音频应用」手动指定要传输的应用。画面、麦克风语音与应用音频分别走独立轨道。

按应用采音依赖 Windows 的进程回环 API。有此需求时建议使用 Windows 11。参见 [Microsoft 的 API 要求](https://learn.microsoft.com/en-us/windows/win32/api/audioclientactivationparams/ns-audioclientactivationparams-audioclient_process_loopback_params)。

观看者可使用放大布局、网格、全屏或独立浮窗。同伴的语音与共享声音可以分别调整音量。暂停接收一位同伴的共享会同时暂停该路画面和共享声音，语音继续播放。浮窗的本机链路和房间媒体链路见[架构说明](../../docs/ARCHITECTURE.md)。

Tauri 和 Electron 的本机应用数据各自保存。连接旧客户端时，先核对邀请格式和实际需要的功能，见[连接选项](../../docs/CONNECTION-OPTIONS.md)。

## Cloudflare 临时网址

使用 `cloudflared` 官方 [2026.11.2 Windows x64 版本](https://github.com/cloudflare/cloudflared/releases/tag/2026.11.2)。从 Assets 取 `cloudflared-windows-amd64.exe`，改名为 `cloudflared.exe`。开发时可放在仓库根目录的 `tools/` 下，由开发入口定位，也可用 `GAMESHARE_CLOUDFLARED` 指向该文件。直接启动测试 EXE 时，可将组件放在程序旁，或在启动环境中设置同一个变量。

客户端会校验组件的大小和 SHA-256，再启动本地副本。建房时选择「Cloudflare」，等临时入口就绪后复制邀请。重开隧道后使用新邀请。结束时可以在离房后关闭临时网址，或者退出客户端。

## 集成测试

用 Node.js 24 在仓库根目录运行，确认测试可占用本机信令端口 `8080`，且系统有可用的非回环网络接口。

```powershell
npm run build:desktop
node apps/tauri/tests/check-client.mjs .cache/tauri-target/x86_64-pc-windows-msvc/release/gameshare-tauri.exe
```

脚本使用独立 WebView2 配置，创建房间、用邀请加入、发送三路测试源，并检查布局、画质、语音与接收暂停、浮窗身份、主窗最小化期间的播放及窗口清理。可在 EXE 路径之后追加测试选项。

| 选项 | 用途 |
| --- | --- |
| `--window-capture` | 用真实窗口替代第一路测试源。按终端提示在 WebView2 共享面板中手动选择测试窗口。 |
| `--cloudflare` | 临时创建公网入口，验证邀请、入房和关闭隧道。需要匹配的 `cloudflared.exe`。 |
| `"--electron=<旧版 GameShare.exe 的路径>"` | 用 Electron 替代第三个发送者验证旧客户端互通。 |
| `--screenshots` | 将测试画面写入 `.cache/tauri-client-check/` 下本次测试的目录。 |
| `--dev` | 验证已编译的开发版 EXE。运行前保持端口 `1420` 上的 Vite 开发服务运行。 |
