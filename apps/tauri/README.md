# GameShare Tauri Windows 客户端

复用 GameShare 的 React 界面、邀请格式和 WebRTC 会话。Tauri 创建独立置顶窗口并运行兼容现有 Socket.IO 房间协议的 Rust 信令服务。小窗用本机 WebRTC 接收器显示远端视频，声音由主窗口播放。

## 构建和验证

在仓库根目录安装 npm 依赖。需要 Windows x64、Rust MSVC、Windows SDK 和 WebView2 Evergreen。

在此目录构建测试可执行文件：

```powershell
npx --yes @tauri-apps/cli@2.12.6 build --target x86_64-pc-windows-msvc --no-bundle
```

默认输出在 `src-tauri/target/x86_64-pc-windows-msvc/release/gameshare-tauri.exe`。WebView2 Evergreen 已安装的机器可直接运行该 EXE。

用 Node.js 24 运行集成测试：

```powershell
node tests/check-client.mjs src-tauri/target/x86_64-pc-windows-msvc/release/gameshare-tauri.exe
```

测试使用独立用户目录，创建房间、用邀请加入、发送三路测试源，并检查浮窗身份、静音、最小化期间播放和窗口清理。可追加 `--cloudflare` 改用短时公网测试入口，验证创建临时网址、复制邀请、从公网入房和关闭隧道。可用 `--electron=<旧版 GameShare.exe 的路径>` 将第三个发送者换成 Electron。追加 `--window-capture` 可将第一路替换为实际窗口采集。此模式需要在 WebView2 共享面板中手动选中终端提示的测试窗口。

## Cloudflare 自动隧道

选择「Cloudflare 自动隧道」并创建房间，或在高级连接设置开启内置信令后打开隧道。免安装 ZIP 随附 Cloudflare 官方 Windows x64 版 `cloudflared.exe`，与 GameShare 主程序放在同一目录。开启时会校验组件的 SHA-256，再启动本地副本。构建产物用于开发时，可以把同版本组件放到测试 EXE 旁边，或用 `GAMESHARE_CLOUDFLARED` 指定该文件。

信令通过临时入口连通后可复制邀请。关闭隧道、关掉内置信令或退出客户端时，会结束对应的 cloudflared 进程。隧道仅用于房间信令。

## 当前范围

- 通过 Cloudflare 临时入口、IP 或自备入口创建房间，并可加入现有服务上的房间。使用浏览器共享面板选择屏幕或窗口，接收并独立显示队友画面。
- 麦克风和 Windows 全局按住发言沿用现有界面。窗口声音取决于 WebView2 是否为所选窗口返回音轨。按进程隔离采音、整机混音采集和外部游戏窗口无边框化仍走 Electron。
- 签发 TURN 凭据、浮窗透明度、浮窗位置持久化和浮窗全局切换键尚未迁移。来自既有信令服务器的邀请及 TURN 配置继续由原 WebRTC 会话处理。
- Electron 和 Tauri 使用独立的应用数据目录，首次打开 Tauri 时需重新设置客户端偏好。
