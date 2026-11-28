# 参与贡献

GameShare 的主客户端运行在 Windows x64 上，使用 Tauri 和 WebView2。了解源码布局和房间、媒体链路的实现，可读[架构说明](docs/ARCHITECTURE.md)。

## 报告问题

通过 Issues 报告时，请附上 GameShare 版本、Windows 版本、重现步骤和预期行为。连接问题还请说明双方是否在同一网络、使用的信令模式，以及是进不了房间，还是入房后收不到画面或声音。分享日志或截图前请遮盖房间邀请、个人网络地址和中继凭据。

## 开发与提交

1. 从[构建与测试指南](docs/BUILD-NOTES.md)配置环境并启动 Tauri。
2. 在自己的分支提交改动。涉及共享、语音和连接的行为，可以用[双开或三开](docs/多开客户端.md)复现。
3. 运行 `npm run typecheck`，再按[开发与回归检查](docs/CONVENTIONS.md)选择对应的 ESLint 范围和专项检查。
4. 在 PR 中说明用户能观察到的变化、测试环境和测试结果。涉及 Windows 采集、快捷键、浮窗或异地网络时，请注明实机验证的范围。

连接模式和故障排查见[连接选项](docs/CONNECTION-OPTIONS.md)与[跨网络测试](docs/REMOTE-TESTING.md)。上游 Electron 版本的[贡献说明](docs/archive/upstream-electron/CONTRIBUTING.md)随原始文档保留。
