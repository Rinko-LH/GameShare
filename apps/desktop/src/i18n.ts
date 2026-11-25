/**
 * 极简 i18n：零依赖（apps/desktop 的 dependencies 保持为空的约定），
 * 模块级单例 + useSyncExternalStore 订阅，用法与 ShareSession 的状态订阅同构。
 *
 * 语言存 localStorage（gs.lang），切换即广播重渲染。
 *
 * 边界：只管 **UI 静态文案**。日志（pushLog）是诊断记录，保持中文不进字典；
 * 邀请文本的人读行保持中文（收邀请的一方多半也是中文用户，且解析器兼容）。
 * 动态文案用 {name} 占位符 + fmt()。
 */

export type Lang = 'zh' | 'en';

const ZH = {
  'mic.mode': '发言模式',
  'mic.continuous': '持续发言',
  'mic.pushToTalk': '按住发言',
  'mic.closed': '麦克风已关闭',
  'mic.waiting': '待发言',
  'mic.transmitting': '正在发言',
  'mic.holdButton': '按住发言',
  'mic.hotkey': '全局快捷键',
  'mic.unbound': '未设置',
  'mic.setKey': '设置快捷键',
  'mic.changeKey': '修改快捷键',
  'mic.clearKey': '清除',
  'mic.saveKey': '保存',
  'mic.cancelKey': '取消',
  'mic.recordKey': '请按下单键或组合键，Esc 取消：',
  'mic.invalidKey': '不支持此按键或它属于保留组合，请换一个。',
  'mic.hotkeyUnavailable': '全局快捷键不可用，请使用界面按住发言按钮。',
  'mic.pttHint': '启用语音后，待发言时麦克风仍被占用；关闭麦克风才释放设备。快捷键也会传给游戏，请避免冲突。数字小键盘请开启 NumLock。',
  'share.quality': '画质',
  'share.quality.manual': '手动画质',
  'share.quality.auto': '自动',
  'share.quality.smooth': '流畅',
  'share.quality.standard': '标清',
  'share.quality.hd': '高清',
  'sidebar.controls': '操作设置',
  'sidebar.room': '房间连接',
  'sidebar.share': '屏幕共享',
  'sidebar.roomSummary': '{n} 人在线',
  'stage.noRoom': '尚未加入房间',
  'stage.noRoomHint': '在左侧创建或加入房间。',
  'view.fullscreen': '全屏模式',
  'view.mainViewHint': '画面共享区无边框全屏；点击悬浮退出按钮或按 Esc 退出',
  'view.exitFullscreen': '退出全屏',
  'view.opacity': '全部浮窗透明度',
  'view.floatingActive': '正在使用独立浮窗',
  'view.floatingCount': '当前显示 {n} 个成员画面浮窗',
  'view.floatingHint': '在主窗口统一调整浮窗透明度，在各浮窗内单独调整成员音量。主窗口保留控制，预览已隐藏；关闭浮窗模式可恢复主窗口预览。',
  'status.host.idle': '尚未创建房间',
  'status.host.creating': '正在创建房间',
  'status.host.waiting': '房间已创建 · 等待朋友',
  'status.host.joined': '朋友已加入',
  'status.host.failed': '创建房间失败',
  'status.host.disconnected': '房间连接已断开',
  'status.host.title': '房间创建和成员加入进度',
  'status.guest.prefix': '房间连接',
  'status.guest.idle': '未连接',
  'status.guest.connecting': '正在连接',
  'status.guest.connected': '已连接',
  'status.guest.failed': '连接失败',
  'status.guest.title': '到房主房间服务的连接状态；毫秒数是该连接的延迟，不是画面延迟',
  'ip.title': 'UU / 局域网连接',
  'ip.refresh': '刷新本机地址',
  'ip.hint': '双方先进入同一个 UU 云联机房间。共享端创建 IP 房间后选择屏幕；观看端输入共享端的虚拟 IP。',
  'ip.create': '创建 IP 共享房间',
  'ip.inviteAddress': '邀请使用的本机地址（请选择 UU IP）',
  'ip.remoteAddress': '对方的 UU / 局域网 IP',
  'ip.roomCode': '房间码（可选）',
  'ip.roomOptional': '仅一个 IP 房间时可留空',
  'ip.connect': '连接并加入',
  'ip.connecting': '正在连接…',
  'ip.needAddress': '请输入共享端的 UU / 局域网 IP',
  'ip.serverFailed': '本机服务启动失败，请检查 8080 端口',
  /* app / 顶栏 */
  'lang.toggle': 'EN',
  'lang.toggleTitle': '切换界面语言 / Switch UI language',

  /* 状态词 */
  'state.conn.idle': '未连接',
  'state.conn.connecting': '连接中',
  'state.conn.connected': '已连接',
  'state.conn.disconnected': '已断开',
  'state.link.new': '待建连',
  'state.link.connecting': '协商中',
  'state.link.connected': '已连接',
  'state.link.disconnected': '中断',
  'state.link.failed': '失败',
  'state.link.closed': '已关闭',

  /* 声音模式 */
  'audio.app': '仅此应用',
  'audio.app.title': '只共享所选窗口那个应用（及其子进程）的声音',
  'audio.system': '全部电脑',
  'audio.system.title': '共享整机声音，但排除本软件自己播放的语音',
  'audio.system.tauri.title': '共享整个屏幕时采集系统声音，可能包含其他应用和通知的声音',
  'share.modeTauriHint': '选择「整个屏幕」并勾选「共享系统音频」。',
  'audio.none': '无声',
  'audio.none.title': '只共享画面，不发送任何声音',
  'audio.tag.app': '应用声音',
  'audio.tag.system': '全部声音',
  'audio.tag.none': '无声音',
  'audio.withSound': '含声音',

  /* 连接区 */
  'conn.nickname': '昵称（选填）',

  /* 房间 */
  'room.title': '房间',
  'room.create': '创建房间',
  'room.copied': '已复制',
  'room.copyFailed': '复制失败，重试',
  'room.copyInvite': '复制邀请',
  'room.copyInviteTitle': '将邀请私发给要入房的朋友',
  'room.invitePreparing': '正在准备邀请网址…',
  'room.inviteUnavailable': '邀请地址不可用',
  'room.retryInvite': '重新准备邀请网址',
  'room.closeInvite': '关闭临时邀请网址',
  'room.leave': '离开房间',
  'room.memberSelf': '（我）',
  'room.tagHost': '房主',
  'room.tagSharing': '共享中',

  /* 本机信令 */

  /* 异地隧道 */

  /* 语音 */
  'mic.title': '语音',
  'mic.on': '关闭麦克风',
  'mic.off': '开启麦克风',
  'mic.hint': '默认关着。开了才会占用录音设备，关了会真的把设备释放掉。',

  /* 共享面板 */
  'share.title': '共享画面',
  'share.now': '正在共享：',
  'share.unknownSource': '未知源',
  'share.audioOff': '声音已关',
  'share.stop': '停止共享',
  'share.pickMore': '更换源',
  'share.pickDisplay': '选择窗口或屏幕',
  'share.pickAgain': '更换窗口或屏幕',
  'share.pickHide': '收起',
  'share.modeLabel': '声音模式：',
  'share.modeAria': '共享声音模式',
  'share.modeSwitchHint': '共享声音的三种正式状态。共享中切换 = 用同一个源按新模式重采（画面会闪一下）。屏幕源没有所属进程，选它会自动落回「全部电脑」。',
  'share.fpsLabel': '帧率：',
  'share.fpsUnit': '帧',
  'share.fpsAria': '共享帧率',
  'share.fpsTitle': '帧率越高画面越顺滑，需要的上行带宽也越大',
  'share.fpsSharingHint': '共享帧率：编码 maxFramerate 与采集端共同的上限。发送方本机设置，不走观看者请求；共享中切换即时生效（setParameters），不重协商。',
  'share.noSources': '没有可用的窗口或屏幕。',
  'share.needRoom': '进入房间后才能共享',
  'share.enumerate': '枚举窗口 / 屏幕',
  'share.testSource': '测试源',
  'share.testSourceTitle': '播放测试画面和测试音，用于检查共享效果，无需采集真实屏幕',

  /* 音频失败告警 */
  'audioFail.title': '无法捕获此应用声音。',
  'audioFail.toSystem': '改用全部电脑声音',
  'audioFail.keepSilent': '继续共享（无声音）',
  'audioFail.cancel': '取消共享',

  /* 源选择 */
  'source.screen': '屏幕',
  'source.window': '窗口',
  'source.current': '当前',
  'source.borderless': '无边框化',
  'source.borderlessRestore': '还原',
  'source.minimizeHint': '找不到窗口？还原窗口后刷新列表。',

  /* 日志 */
  'log.title': '诊断日志',
  'log.empty': '暂无日志',
  'log.report': '诊断报告',
  'log.copyReport': '复制诊断报告',
  'log.copied': '诊断报告已复制',
  'log.copyFailed': '复制失败，请重试。',

  /* 侧栏 resizer */
  'sidebar.expand': '展开侧栏',
  'sidebar.collapse': '收起侧栏',
  'sidebar.resizeTitle': '拖动调宽 · 点把手收起',

  /* 浮窗 */
  'float.mode': '浮窗模式',
  'float.hotkeyConflict': '快捷键冲突',
  'float.hotkeyTitle':
    '全屏游戏时按 {hotkey} 一键切换：窗口缩小、压在游戏上面、只留正在共享的画面。位置直接拖浮窗里的画面挪，大小拖右下角那个小三角；透明度在浮窗里的滑杆上调。只能压住无边框 / 窗口化全屏的游戏，独占全屏的要在游戏设置里改成无边框窗口化',
  'float.hotkeyTakenTitle': '快捷键被别的窗口占用了（同时开多个客户端时只有一个能拿到），这里点开关作用一样',
  'float.barGripTitle': '按住画面任意处拖动这个浮窗',
  'float.opacity': '透明度',
  'float.opacityTitle': '调低能让后面的游戏透出来，代价是共享画面也一起变淡',
  'float.split': '拆成 {n} 个小窗',
  'float.splitTitle':
    '每一路画面拆成一个独立小窗，各自拖动、各自缩放、各自置顶。窗数 = 总人数 − 1 = {n} 个（自己这一路本地预览就能看）。画面仍然由这个窗口搬给它们，所以它会收成一条贴底的控制条 —— 声音和房间码都在那条上。',
  'float.exit': '退出浮窗',
  'float.exitTitle': '回到正常界面（全局快捷键同效）',
  'float.gripTitle': '拖动改大小',
  'float.emptyNoShare': '还没有人在共享画面。',
  'float.emptyOnlyShared': '浮窗只摆正在共享的那几路。',
  'float.enterRoomHint': '进入房间后，这里显示其他玩家的画面。',

  /* 控制条 / 小球 */
  'bar.ballTitle': '单击展开控制条 · 按住可拖到别处',
  'bar.ballTiles': '{n} 个小窗',
  'bar.ballExpand': '展开',
  'bar.gripTitle': '按住这条，把控制窗拖到不挡视线的地方',
  'bar.collapse': '收起',
  'bar.collapseTitle': '把这条收成屏幕右下角的一颗小球 —— 画面不受影响，单击小球就展开',
  'bar.tilesInfo': '{n} 个小窗 · 按住这条挪本窗',
  'bar.opacity': '透明度',
  'bar.opacityTitle': '调低能让后面的游戏透出来，代价是画面也一起变淡',
  'bar.merge': '合并成一个窗口',
  'bar.mergeTitle': '把小窗收回来，恢复成一个窗口',
  'bar.exit': '退出浮窗',
  'bar.exitTitle': '回到正常界面（全局快捷键同效）',

  /* 窗口按钮 */
  'win.minimize': '最小化',
  'win.restore': '还原',
  'win.maximize': '最大化',
  'win.close': '关闭',

  /* 画面格 */
  'tile.waiting': '等待画面…',
  'tile.noStream': '未收到画面',
  'tile.tagLocal': '本地',
  'tile.tagNotSharing': '未共享',
  'tile.tagNoAudio': '无声音',
  'tile.restore': '还原',
  'tile.enlarge': '放大',
  'tile.enlargeTitle': '把这一路放大到主画面',
  'tile.volume': '音量',
  'tile.volumeTitle': '分开调这一路的语音音量与共享声音音量',
  'tile.voice': '语音',
  'tile.appAudio': '共享声',
  'tile.muted': '已静音',
  'tile.on': '开',
  'tile.muteVoiceTitle': '只静音他的麦克风，不影响共享声音',
  'tile.muteAppAudioTitle': '只静音他的共享声音，不影响语音',
  'tile.pathDetecting': '路径检测中',
  'tile.statsCollecting': '统计采集中…',
  'tile.localPreviewInfo': '本地预览 · 不经过网络传输',
  'tile.selfTitle': '{name}（本地预览）',

  /* 小窗（FloatTile） */
  'tileFloat.defaultPeer': '对端',
  'tileFloat.volumeTitle': '只调整你听到的这位成员的音量',
  'tileFloat.waiting': '等待画面…',
  'tileFloat.muted': '已静音',
  'tileFloat.live': '有声',
  'tileFloat.unmuteTitle': '取消静音这一路',
  'tileFloat.muteTitle': '静音这一路（只影响本机）',
  'tileFloat.gripTitle': '拖动改大小',
} as const;

export type I18nKey = keyof typeof ZH;

type Dict = Record<I18nKey, string>;

const EN: Dict = {
  'mic.mode': 'Voice mode',
  'mic.continuous': 'Continuous',
  'mic.pushToTalk': 'Push to talk',
  'mic.closed': 'Microphone off',
  'mic.waiting': 'Waiting to talk',
  'mic.transmitting': 'Transmitting voice',
  'mic.holdButton': 'Hold to talk',
  'mic.hotkey': 'Global hotkey',
  'mic.unbound': 'Not set',
  'mic.setKey': 'Set hotkey',
  'mic.changeKey': 'Change hotkey',
  'mic.clearKey': 'Clear',
  'mic.saveKey': 'Save',
  'mic.cancelKey': 'Cancel',
  'mic.recordKey': 'Press a key or combination; Esc cancels:',
  'mic.invalidKey': 'Unsupported key or reserved combination. Choose another.',
  'mic.hotkeyUnavailable': 'Global hotkey unavailable. Use the on-screen hold button.',
  'mic.pttHint': 'While voice is enabled, the microphone stays open in standby; turn it off to release the device. Keys also reach your game, so avoid conflicts. Enable NumLock for numpad keys.',
  'share.quality': 'Video quality',
  'share.quality.manual': 'Manual video quality',
  'share.quality.auto': 'Auto',
  'share.quality.smooth': 'Smooth',
  'share.quality.standard': 'SD',
  'share.quality.hd': 'HD',
  'view.fullscreen': 'Fullscreen',
  'view.mainViewHint': 'Show the shared screens in borderless fullscreen; use the floating exit button or press Esc to exit',
  'view.exitFullscreen': 'Exit fullscreen',
  'view.opacity': 'All floating windows opacity',
  'view.floatingActive': 'Independent floating windows are active',
  'view.floatingCount': '{n} shared views are open',
  'view.floatingHint': 'Adjust opacity in the main window and member volume in each floating window. The main window keeps its controls with previews hidden. Turn off floating mode to restore previews.',
  'status.host.idle': 'No room created',
  'status.host.creating': 'Creating room',
  'status.host.waiting': 'Room created · Waiting for friends',
  'status.host.joined': 'Friends joined',
  'status.host.failed': 'Room creation failed',
  'status.host.disconnected': 'Room connection lost',
  'status.host.title': 'Room creation and membership status',
  'status.guest.prefix': 'Room connection',
  'status.guest.idle': 'Not connected',
  'status.guest.connecting': 'Connecting',
  'status.guest.connected': 'Connected',
  'status.guest.failed': 'Connection failed',
  'status.guest.title': 'Connection to the host room service; latency does not measure video delay',
  'ip.title': 'UU / LAN connection',
  'ip.refresh': 'Refresh local addresses',
  'ip.hint': 'Join the same UU virtual LAN first. The host creates an IP room and selects a screen; viewers enter the host’s virtual IP.',
  'ip.create': 'Create IP sharing room',
  'ip.inviteAddress': 'Local invite address (select your UU IP)',
  'ip.remoteAddress': 'Host UU / LAN IP',
  'ip.roomCode': 'Room code (optional)',
  'ip.roomOptional': 'Leave empty for a single IP room',
  'ip.connect': 'Connect and join',
  'ip.connecting': 'Connecting…',
  'ip.needAddress': 'Enter the host UU / LAN IP',
  'ip.serverFailed': 'Local server failed to start; check port 8080',
  'lang.toggle': '中文',
  'lang.toggleTitle': '切换界面语言 / Switch UI language',

  'state.conn.idle': 'Disconnected',
  'state.conn.connecting': 'Connecting',
  'state.conn.connected': 'Connected',
  'state.conn.disconnected': 'Disconnected',
  'state.link.new': 'Pending',
  'state.link.connecting': 'Negotiating',
  'state.link.connected': 'Connected',
  'state.link.disconnected': 'Interrupted',
  'state.link.failed': 'Failed',
  'state.link.closed': 'Closed',

  'audio.app': 'This app',
  'audio.app.title': "Only share the audio of the selected window's app (and its child processes)",
  'audio.system': 'Whole PC',
  'audio.system.title': 'Share all system audio, excluding GameShare itself',
  'audio.system.tauri.title': 'Capture system audio when sharing a screen. This may include other apps and notifications.',
  'share.modeTauriHint': 'Select Entire Screen and enable system audio in the picker.',
  'audio.none': 'Muted',
  'audio.none.title': 'Share video only, no audio',
  'audio.tag.app': 'App audio',
  'audio.tag.system': 'System audio',
  'audio.tag.none': 'No audio',
  'audio.withSound': 'with audio',

  'conn.nickname': 'Nickname (optional)',

  'room.title': 'Room',
  'room.create': 'Create room',
  'room.copied': 'Copied',
  'room.copyFailed': 'Copy failed. Retry',
  'room.copyInvite': 'Copy invite',
  'room.copyInviteTitle': 'Send the invite privately to your friends',
  'room.invitePreparing': 'Preparing invite link…',
  'room.inviteUnavailable': 'Invite address unavailable',
  'room.retryInvite': 'Retry invite link',
  'room.closeInvite': 'Close temporary invite link',
  'room.leave': 'Leave room',
  'room.memberSelf': ' (me)',
  'room.tagHost': 'Host',
  'room.tagSharing': 'Sharing',



  'mic.title': 'Voice',
  'mic.on': 'Mute microphone',
  'mic.off': 'Unmute microphone',
  'mic.hint': 'Off by default. On: occupies the recording device. Off: releases it for real.',

  'share.title': 'Share screen',
  'share.now': 'Sharing: ',
  'share.unknownSource': 'unknown source',
  'share.audioOff': 'audio off',
  'share.stop': 'Stop sharing',
  'share.pickMore': 'Change source',
  'share.pickDisplay': 'Choose window or screen',
  'share.pickAgain': 'Change window or screen',
  'share.pickHide': 'Hide',
  'share.modeLabel': 'Audio mode:',
  'share.modeAria': 'Shared audio mode',
  'share.modeSwitchHint': 'Switching mid-share re-captures with the new mode (screen flashes once). Screen sources have no owning app, they fall back to "Whole PC".',
  'share.fpsLabel': 'FPS:',
  'share.fpsUnit': 'fps',
  'share.fpsAria': 'Shared frame rate',
  'share.fpsTitle': 'Higher FPS is smoother but needs more upload bandwidth',
  'share.fpsSharingHint': 'Shared FPS: the common cap of encoder and capture. Sender-side setting; takes effect instantly while sharing (setParameters), no renegotiation.',
  'share.noSources': 'No windows or screens available.',
  'share.needRoom': 'Join a room before sharing',
  'share.enumerate': 'Enumerate windows / screens',
  'share.testSource': 'Test source',
  'share.testSourceTitle': 'Use a synthetic animated source instead of real capture, for automated checks',

  'audioFail.title': 'Cannot capture this app\'s audio.',
  'audioFail.toSystem': 'Switch to whole-PC audio',
  'audioFail.keepSilent': 'Keep sharing (no audio)',
  'audioFail.cancel': 'Cancel sharing',

  'source.screen': 'Screen',
  'source.window': 'Window',
  'source.current': 'current',
  'source.borderless': 'Borderless',
  'source.borderlessRestore': 'Restore',
  'source.minimizeHint': 'Missing a window? Restore it and refresh the list.',

  'log.title': 'Diagnostic Logs',
  'log.empty': 'No logs yet',
  'log.report': 'Diagnostic report',
  'log.copyReport': 'Copy diagnostic report',
  'log.copied': 'Diagnostic report copied',
  'log.copyFailed': 'Copy failed. Try again.',

  'sidebar.controls': 'Controls',
  'sidebar.room': 'Room connection',
  'sidebar.share': 'Screen sharing',
  'sidebar.roomSummary': '{n} in room',
  'stage.noRoom': 'No room joined',
  'stage.noRoomHint': 'Create or join a room from the sidebar.',
  'sidebar.expand': 'Expand sidebar',
  'sidebar.collapse': 'Collapse sidebar',
  'sidebar.resizeTitle': 'Drag to resize · click the grip to collapse',

  'float.mode': 'Float overlay',
  'float.hotkeyConflict': 'Hotkey conflict',
  'float.hotkeyTitle':
    'Press {hotkey} in a fullscreen game: the window shrinks, stays above the game, only showing shared screens. Drag the picture to move it, drag the bottom-right grip to resize, adjust opacity on the slider. Works over borderless/windowed fullscreen only — exclusive fullscreen must be changed in the game settings',
  'float.hotkeyTakenTitle': 'The hotkey is taken by another window (only one client gets it when running multiple), the toggle here still works',
  'float.barGripTitle': 'Drag anywhere on the picture to move the overlay',
  'float.opacity': 'Opacity',
  'float.opacityTitle': 'Lower it to see the game behind — the shared picture fades too',
  'float.split': 'Split into {n} tiles',
  'float.splitTitle':
    'Each stream becomes its own always-on-top tile, draggable and resizable. Count = players − 1 = {n} (your own preview stays local). This window still feeds them the frames, so it collapses into a bottom bar — sound and room code live there.',
  'float.exit': 'Exit overlay',
  'float.exitTitle': 'Back to the normal UI (same as the global hotkey)',
  'float.gripTitle': 'Drag to resize',
  'float.emptyNoShare': 'Nobody is sharing yet.',
  'float.emptyOnlyShared': 'The overlay only shows actively shared streams.',
  'float.enterRoomHint': 'Join a room and other players\' screens will show up here.',

  'bar.ballTitle': 'Click to expand the control bar · hold to drag',
  'bar.ballTiles': '{n} tiles',
  'bar.ballExpand': 'Expand',
  'bar.gripTitle': 'Hold to drag this bar out of the way',
  'bar.collapse': 'Collapse',
  'bar.collapseTitle': 'Collapse this bar into a small ball at the bottom-right — sharing is unaffected; click the ball to expand',
  'bar.tilesInfo': '{n} tiles · hold to move this window',
  'bar.opacity': 'Opacity',
  'bar.opacityTitle': 'Lower it to see what\'s behind — the picture fades too',
  'bar.merge': 'Merge into one window',
  'bar.mergeTitle': 'Bring the tiles back into a single window',
  'bar.exit': 'Exit overlay',
  'bar.exitTitle': 'Back to the normal UI (same as the global hotkey)',

  'win.minimize': 'Minimize',
  'win.restore': 'Restore',
  'win.maximize': 'Maximize',
  'win.close': 'Close',

  'tile.waiting': 'Waiting for stream…',
  'tile.noStream': 'No stream received',
  'tile.tagLocal': 'Local',
  'tile.tagNotSharing': 'Not sharing',
  'tile.tagNoAudio': 'No audio',
  'tile.restore': 'Restore',
  'tile.enlarge': 'Enlarge',
  'tile.enlargeTitle': 'Enlarge this stream to the main stage',
  'tile.volume': 'Volume',
  'tile.volumeTitle': 'Adjust voice and app-audio volume for this stream separately',
  'tile.voice': 'Voice',
  'tile.appAudio': 'App audio',
  'tile.muted': 'Muted',
  'tile.on': 'on',
  'tile.muteVoiceTitle': 'Mute only their microphone, app audio unaffected',
  'tile.muteAppAudioTitle': 'Mute only their app audio, voice unaffected',
  'tile.pathDetecting': 'detecting path…',
  'tile.statsCollecting': 'gathering stats…',
  'tile.localPreviewInfo': 'Local preview · No network transmission',
  'tile.selfTitle': '{name} (local preview)',

  'tileFloat.defaultPeer': 'Peer',
  'tileFloat.volumeTitle': 'Adjust this member’s volume for your local playback only',
  'tileFloat.waiting': 'Waiting for stream…',
  'tileFloat.muted': 'Muted',
  'tileFloat.live': 'Sound on',
  'tileFloat.unmuteTitle': 'Unmute this stream',
  'tileFloat.muteTitle': 'Mute this stream (local only)',
  'tileFloat.gripTitle': 'Drag to resize',
};

const DICTS: Record<Lang, Dict> = { zh: ZH, en: EN };

let lang: Lang = (() => {
  const saved = window.localStorage.getItem('gs.lang');
  return saved === 'en' ? 'en' : 'zh';
})();

const listeners = new Set<() => void>();

export function getLang(): Lang {
  return lang;
}

export function setLang(next: Lang): void {
  if (next === lang) return;
  lang = next;
  window.localStorage.setItem('gs.lang', next);
  for (const l of listeners) l();
}

export function subscribeLang(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 取当前语言的文案。key 不存在时回落中文（迁移期兜底） */
export function t(key: I18nKey): string {
  return DICTS[lang][key] ?? ZH[key];
}

/** 带占位符的模板：fmt('{n} 个小窗', { n: 3 }) */
export function fmt(key: I18nKey, vars: Record<string, string | number>): string {
  return t(key).replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}
