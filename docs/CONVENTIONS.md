# 开发与回归检查

按改动选择检查范围。从仓库根目录运行下列 npm 命令，Tauri 工具链与桌面集成测试见[构建与测试指南](BUILD-NOTES.md)。

| 改动范围 | 检查 |
| --- | --- |
| TypeScript、React 或工作区依赖 | `npm run typecheck`，再对改动的源码运行 ESLint。 |
| 房间、成员、信令转发 | `npm run smoke` 检查 Node.js 信令。协议改动同时检查 Rust 服务，并运行 [Tauri 集成测试](../apps/tauri/README.md#集成测试)。 |
| 邀请、IP 与连接策略 | `npm run check:connection-modes`、`npm run check:signaling-origin`、`npm run check:reachability`。再用[跨网络测试](REMOTE-TESTING.md)核对实际使用的网络。 |
| WebRTC 协商与媒体角色 | `npm run smoke:p2p`、`npm run check:media-tracks`。用双向共享检查两端都能收发，并用 Tauri 集成测试覆盖主客户端。 |
| 画质、码率、诊断面板 | `npm run check:peer-stats`，以及 [Tauri 集成测试](../apps/tauri/README.md#集成测试)中的画质与接收暂停场景。 |
| 麦克风和按住说话 | `npm run check:voice-ptt`。全局热键、失焦、松键和关闭麦克风等场景用 Tauri 实机核对。 |
| 选源、应用音频、浮窗 | 运行 [Tauri 集成测试](../apps/tauri/README.md#集成测试)，使用真实窗口验证选源和应用音频。浮窗检查置顶、主窗最小化、静音和退出清理。 |
| Node.js 信令工厂的 TURN 凭据 | `npm run check:turn`。真实中继需要用两台设备观察选中的候选对。 |

`smoke:p2p`、`check:media-tracks`、`check:voice-ptt` 等浏览器验收依赖 Electron 测试运行时，可通过 `npm run setup:electron` 初始化。它们用于共享代码的回归，涉及 WebView2 或 Windows 原生行为时请补充 Tauri 验证。

主客户端与信令的 ESLint 命令见[构建与测试指南](BUILD-NOTES.md#本机编译)。根目录的 `npm run lint` 会同时扫描已编译的 Tauri 前端和浮窗预览脚本，在这些目录中会报告浏览器全局变量等问题。可以用 `npm exec -- eslint <路径>` 检查本次改动涉及的其他源码目录。

## 实现约定

- 将共享协议类型放在 [packages/protocol](../packages/protocol/src/index.ts)。变更信令事件时，同步检查 [Node.js](../apps/signaling/src/signaling-server.ts) 与 [Rust](../apps/tauri/src-tauri/src/signaling.rs) 的处理。
- 保持视频、语音、共享声音的轨道顺序与 MID 映射。停止共享或暂停接收时，检查语音轨继续工作。
- 区分静音播放和暂停接收。静音、音量仅影响本机播放，暂停接收会调整共享轨的协商方向。
- 校验画质时一起记录采集尺寸、发送约束、实际解码尺寸与帧率。受限网络和编码器适应会改变最终输出。
- 在 PR 中记录使用的运行时、已运行的检查和实机验证范围。涉及打包时，遵循[仓库发布约定](../AGENTS.md)。

旧版 Electron 的分场景故障记录见[上游开发约定](archive/upstream-electron/docs/CONVENTIONS.md)。
