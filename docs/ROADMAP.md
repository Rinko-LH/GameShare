# GameShare 项目现状

当前源码中的应用版本为 1.7.0，Windows Tauri 客户端是默认开发与构建目标。房间服务、屏幕共享、按应用采音和多视图观看均已有实现。Linux、macOS 和浏览器客户端暂未作为发布目标。

| 范围 | 当前实现 |
| --- | --- |
| 房间 | 内置 Rust 信令，可通过 IP、Cloudflare 临时网址或自备公网映射发出邀请，房间上限 8 人 |
| 画面和语音 | WebRTC Mesh，支持窗口或屏幕共享、应用声音、麦克风和按住说话 |
| 观看 | 放大、网格、无边框全屏、独立置顶浮窗，以及每位成员的语音和共享声音控制 |
| 网络 | 自动协商和实验性的指定媒体 IP。客户端可使用兼容信令服务提供的 TURN 凭据 |
| 开发验证 | Tauri 多实例集成测试、信令冒烟测试，以及保留的 Electron 回归脚本 |

多人房间的实际体验取决于各端的上行带宽、编码能力和网络路径。跨网连通性、不同 Windows 设备上的按应用采音，以及不同游戏的窗口捕获效果，都适合用真实设备分别验证。 [跨网测试说明](REMOTE-TESTING.md) · [构建与验证](BUILD-NOTES.md)

发布记录以 [GitHub Releases](https://github.com/Rinko-LH/GameShare/releases) 为准。原 Electron 版的里程碑和测试记录见 [上游路线图](archive/upstream-electron/docs/ROADMAP.md)。
