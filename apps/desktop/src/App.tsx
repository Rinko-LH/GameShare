import { VIDEO_QUALITY_PRESETS, readVideoQuality, saveVideoQuality, type VideoQualityPreset } from './video-resolution';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import type { PeerInfo } from '@game-share/protocol';
import { DEFAULT_SIGNALING_URL, normalizeSignalingAddress, remoteAudioAudience } from '@game-share/shared';

import type {
  AudioCaptureMode,
  CaptureSourceInfo,
  EmbeddedServerStatus,
  FloatTilesStatus,
  FloatWindowStatus,
  TunnelStatus,
} from './types/global';
import type { LinkStats, RemoteTracks } from './rtc/types';
import { formatBitrate } from './rtc/stats';
import type { LinkDiagnosis } from './rtc/PeerLink';
import { startFloatTilePump } from './media/float-tile-pump';
import { ShareSession } from './session/ShareSession';
import { ConnectionPanel } from './ConnectionPanel';
import { ApplicationAudioPicker } from './ApplicationAudioPicker';
import { VoicePanel, useVoiceHotkey } from './VoicePanel';
import { readVoicePreferences } from './voice-settings';
import { readConnectionConfig, saveConnectionConfig, type ConnectionConfig } from './connection-config';
import { createInvitation, resolveInvitationConfig, parseInvitation } from './invitations';
import { getLang, setLang, subscribeLang, t as lookup, fmt } from './i18n';
import type { I18nKey } from './i18n';

/** 语言切换的订阅：lang 变化触发重渲染，文案经 t() 取当前语言的值 */
const useI18n = (): typeof lookup => {
  useSyncExternalStore(subscribeLang, getLang);
  return lookup;
};

/* 状态文案存 i18n key，使用处经 t() 取当前语言 */
const LINK_LABEL: Record<string, I18nKey> = {
  new: 'state.link.new',
  connecting: 'state.link.connecting',
  connected: 'state.link.connected',
  disconnected: 'state.link.disconnected',
  failed: 'state.link.failed',
  closed: 'state.link.closed',
};

type TileVariant = 'grid' | 'main' | 'thumb';

/**
 * 缩略格上的诊断短标签。
 *
 * 只有两格宽，最多两个字 —— 完整结论走 `title` 悬停。
 * 别在这里塞说明文字：168x95 的格子里那只会挤成一坨。
 */
const DIAG_SHORT: Partial<Record<LinkDiagnosis['kind'], string>> = {
  punching: '…',
  'needs-turn': '阻',
  'needs-stun': '障',
  exhausted: '阻',
};

/** 悬停提示：结论 + 补充 + 候选构成（有任何一段就带上，不留空壳） */
function DIAG_TITLE(d: LinkDiagnosis): string {
  return [d.summary, d.detail, d.candidates].filter(Boolean).join(' · ');
}

/**
 * 每个远端用户的**分轨**音量偏好：语音与应用（共享）声音各自独立。
 *
 * 两条轨性质不同 —— 语音是通信处理过的（AEC/NS/AGC），应用声音是原样回环 ——
 * 听的人也经常只想关掉其中一个（游戏声吵，但队友说话要听清）。
 * 音量只作用于本机 `<audio>` 元素，不发信令、不影响别人。
 */
interface PeerAudioPref {
  masterVol: number;
  masterMuted: boolean;
  voiceVol: number;
  voiceMuted: boolean;
  appVol: number;
  appMuted: boolean;
}

const DEFAULT_PEER_AUDIO: PeerAudioPref = {
  masterVol: 1,
  masterMuted: false,
  voiceVol: 1,
  voiceMuted: false,
  appVol: 1,
  appMuted: false,
};

/** 共享声音的三种正式状态（任务书口径）；`loopback` 是调试模式，不进界面 */
const UI_AUDIO_MODES: Array<{ mode: AudioCaptureMode; label: I18nKey; title: I18nKey }> = [
  { mode: 'application', label: 'audio.app', title: 'audio.app.title' },
  { mode: 'system', label: 'audio.system', title: 'audio.system.title' },
  { mode: 'none', label: 'audio.none', title: 'audio.none.title' },
];

/** 模式在状态 tag 里的短名 */
const AUDIO_MODE_LABEL: Partial<Record<AudioCaptureMode, I18nKey>> = {
  application: 'audio.tag.app',
  system: 'audio.tag.system',
  none: 'audio.tag.none',
};

/**
 * 可选共享帧率。这是发送方本机设置（帧率是采集源的全局属性，与观看者无关），
 * 发送端独立应用帧率与用户分辨率，不受观看布局影响。
 */
const UI_FPS_OPTIONS: readonly number[] = [30, 60, 120];
const [AUTO_VIDEO_QUALITY, ...MANUAL_VIDEO_QUALITIES] = VIDEO_QUALITY_PRESETS;

/** 帧率偏好的 localStorage 键；跨会话记住用户选过哪一档 */
const SHARE_FPS_STORAGE_KEY = 'gs.shareFps';
const MIN_SIDEBAR_WIDTH = 252;
const MAX_SIDEBAR_WIDTH = 480;

export default function App() {
  const [session] = useState(() => new ShareSession());
  const [videoQuality, setVideoQuality] = useState(readVideoQuality);
  const [voiceBinding, setVoiceBinding] = useState(() => readVoicePreferences().binding);
  const [voiceRecording, setVoiceRecording] = useState(false);
  const voiceHotkeyError = useVoiceHotkey(session, voiceBinding, voiceRecording);
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const t = useI18n();

  const isTauri = window.gameShare?.runtime === 'tauri';
  const [connectionConfig, setConnectionConfig] = useState<ConnectionConfig>(readConnectionConfig);
  const [selectedMediaIp, setSelectedMediaIp] = useState('');
  const [pendingInvitation, setPendingInvitation] = useState('');
  const [connectionRole, setConnectionRole] = useState<'host' | 'guest'>('host');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [creatingRoom, setCreatingRoom] = useState(false);

  const [serverUrl, setServerUrl] = useState(DEFAULT_SIGNALING_URL);
  const [selectedInviteAddress, setSelectedInviteAddress] = useState<string | null>(null);
  const [nickname, setNickname] = useState('');
  const [busy, setBusy] = useState(false);

  const [sources, setSources] = useState<CaptureSourceInfo[]>([]);
  const [sourceError, setSourceError] = useState<string | null>(null);
  /** 共享中也要能换源，这个开关控制换源面板的显隐 */
  const [pickerOpen, setPickerOpen] = useState(false);
  /** 当前正在共享的源 id，用来在列表里标出「当前」；停止共享后由下面的 effect 统一清掉 */
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, LinkStats>>({});
  const [embeddedServer, setEmbeddedServer] = useState<EmbeddedServerStatus | null>(null);
  /** Cloudflare 模式创建房间时准备临时邀请网址。 */
  const [tunnel, setTunnel] = useState<TunnelStatus | null>(null);
  const [tunnelBusy, setTunnelBusy] = useState(false);
  /**
   * 浮窗模式。全屏玩游戏时用 —— 快捷键那一步由主进程全局注册，
   * 这里只负责显示状态、调透明度，并给一个鼠标点得到的地方。
   *
   * 界面精简（藏侧栏、藏顶栏、只留正在共享的画面）这一半在渲染层做；
   * 窗口尺寸 / 置顶 / 透明度那一半在主进程做（见 electron/window-mode.ts）。
   */
  const [floatWindow, setFloatWindow] = useState<FloatWindowStatus | null>(null);
  const [floatBusy, setFloatBusy] = useState(false);

  /**
   * 浮窗的**拆分**模式：每一路远端画面变成一个独立小窗（窗数 = 总人数 − 1）。
   *
   * 权威状态在 `floatWindow.tilesEnabled`（主进程说了算），这里的 `tiles` 只用来
   * 显示「现在开着几个窗」。**注意它俩不能互相推导**：退出浮窗时主进程会把小窗
   * 一起收掉，两条状态得分别同步。
   */
  const [tiles, setTiles] = useState<FloatTilesStatus | null>(null);

  /** 主窗口画面区，用于切换全屏。 */
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageFullscreen, setStageFullscreen] = useState(false);
  const [fullscreenExitVisible, setFullscreenExitVisible] = useState(false);
  const fullscreenExitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showFullscreenExit = useCallback(() => {
    if (fullscreenExitTimer.current) clearTimeout(fullscreenExitTimer.current);
    setFullscreenExitVisible(true);
    fullscreenExitTimer.current = setTimeout(() => setFullscreenExitVisible(false), 2000);
  }, []);
  useEffect(() => {
    if (stageFullscreen) showFullscreenExit();
    else setFullscreenExitVisible(false);
    return () => { if (fullscreenExitTimer.current) clearTimeout(fullscreenExitTimer.current); };
  }, [stageFullscreen, showFullscreenExit]);

  useEffect(() => {
    const syncFullscreen = (): void => {
      setStageFullscreen(document.fullscreenElement === stageRef.current);
    };
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  const exitStageFullscreen = async (): Promise<void> => {
    if (document.fullscreenElement) await document.exitFullscreen();
  };

  const logDialog = useRef<HTMLDialogElement>(null);
  const [logCopyStatus, setLogCopyStatus] = useState<'copying' | 'copied' | 'failed'>();
  const [sidePage, setSidePage] = useState<'room' | 'share'>('room');
  const bodyRef = useRef<HTMLElement>(null);
  const sidebarContentRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    bodyRef.current?.scrollTo(0, 0);
    sidebarContentRef.current?.scrollTo(0, 0);
  }, [sidePage]);

  /**
   * 左侧栏宽度与收起状态（localStorage 记忆：gs.sidebarWidth / gs.sidebarCollapsed）。
   *
   * 可在侧栏与画面之间拖动调整。顶栏按钮切换显示。
   */
  const [sideWidth, setSideWidth] = useState(isTauri ? 300 : 320);
  const [sideCollapsed, setSideCollapsed] = useState(false);
  const pendingSidebarFocus = useRef(false);
  const openSidebarPage = (page: 'room' | 'share') => {
    if (!sideCollapsed && sidePage === page) {
      document.getElementById(`sidebar-tab-${page}`)?.focus();
      return;
    }
    pendingSidebarFocus.current = true;
    if (sideCollapsed) {
      setSideCollapsed(false);
      window.localStorage.setItem('gs.sidebarCollapsed', '0');
    }
    setSidePage(page);
  };
  useEffect(() => {
    if (!pendingSidebarFocus.current || sideCollapsed) return;
    pendingSidebarFocus.current = false;
    document.getElementById(`sidebar-tab-${sidePage}`)?.focus();
  }, [sideCollapsed, sidePage]);
  useEffect(() => {
    const w = Number(window.localStorage.getItem('gs.sidebarWidth'));
    if (Number.isFinite(w) && w >= MIN_SIDEBAR_WIDTH && w <= MAX_SIDEBAR_WIDTH) setSideWidth(w);
    setSideCollapsed(window.localStorage.getItem('gs.sidebarCollapsed') === '1');
  }, []);
  const applySideWidth = useCallback((w: number) => {
    const next = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(w)));
    setSideWidth(next);
    window.localStorage.setItem('gs.sidebarWidth', String(next));
  }, []);
  const toggleSideCollapsed = useCallback(() => {
    setSideCollapsed((v) => {
      window.localStorage.setItem('gs.sidebarCollapsed', v ? '0' : '1');
      return !v;
    });
  }, []);
  /** 拖拽调宽：按下锁基准（起点 + 起始宽度），move 算差值 —— setBounds 异步的教训同源 */
  const sideDragRef = useRef<{ startX: number; startW: number } | null>(null);
  const [sideDragging, setSideDragging] = useState(false);
  const onResizerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 || !e.isPrimary) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      sideDragRef.current = {
        startX: e.clientX,
        startW: document.getElementById('workspace-controls')?.clientWidth ?? sideWidth,
      };
      setSideDragging(true);
    },
    [sideWidth],
  );
  const onResizerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = sideDragRef.current;
    if (!d || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    applySideWidth(d.startW + (e.clientX - d.startX));
  }, [applySideWidth]);
  const onResizerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!sideDragRef.current) return;
    sideDragRef.current = null;
    setSideDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  /**
   * 被静音的远端 peerId 集合。默认全不静音。
   *
   * 注意语义：这是**本机不听**这一路的声音，不影响对方、也不影响别人。
   * 之所以按「人」而不是按「窗口」静音，是因为 Windows 的 loopback 采的
   * 是整机混音 —— 一路共享里本来就只有一个人的全部声音，分不出来。
   */

  /**
   * 远端分轨音量偏好（peerId → 偏好）。没出现的 peer 用 `DEFAULT_PEER_AUDIO`。
   *
   * 与 `mutedPeers` 的关系：`mutedPeers` 现在只服务浮窗小窗的一键静音
   * （那里面放不下两根滑杆）；常规网格里用这份细粒度偏好。
   */
  const [peerAudio, setPeerAudio] = useState<Record<string, PeerAudioPref>>({});
  /** 音量小面板当前展开在哪一个 tile 上；null = 全收起 */
  const [volPanelPeer, setVolPanelPeer] = useState<string | null>(null);

  /**
   * 共享声音的模式选择。**正式默认是「仅此应用声音」**（applicationLoopback:<pid>）——
   * 选中的是窗口就用它；屏幕源没有所属进程，那种源上这个选项不可用、落回「全部电脑」。
   * 这个选择在共享中也可以改，改了就按换源流程重采（画面会闪一下，语义最干净）。
   */
  const [audioModeChoice, setAudioModeChoice] = useState<AudioCaptureMode>('application');

  /** 被放大到主画面的那一路；null 表示网格布局 */
  const [focusedPeerId, setFocusedPeerId] = useState<string | null>(null);

  const {
    connection,
    room,
    links,
    remoteStreams,
    remoteTracks,
    remoteSharing,
    sharing,
    captureLabel,
    shareFps,
    hasAudio,
    appAudioEnabled,
    audioApplication,
    audioMode,
    audioFailure,
    micEnabled,
  } = state;
  const connected = connection.state === 'connected';
  const inRoom = room !== null;
  useEffect(() => {
    setSidePage(inRoom ? 'share' : 'room');
  }, [inRoom]);

  // 房主看实际房间进度；后台服务启动不等于已经创建房间。
  const headerStatus = connectionRole === 'host'
    ? room
      ? !connected
        ? { tone: 'disconnected', label: t('status.host.disconnected'), detail: connection.detail }
        : room.peers.length > 0
          ? { tone: 'connected', label: t('status.host.joined'), detail: '' }
          : { tone: 'connected', label: t('status.host.waiting'), detail: '' }
      : creatingRoom
        ? { tone: 'connecting', label: t('status.host.creating'), detail: '' }
        : connectionError
          ? { tone: 'disconnected', label: t('status.host.failed'), detail: connectionError }
          : { tone: 'idle', label: t('status.host.idle'), detail: '' }
    : connected
      ? { tone: 'connected', label: t('status.guest.connected'), detail: '' }
      : connection.state === 'connecting' || busy
        ? { tone: 'connecting', label: t('status.guest.connecting'), detail: '' }
        : connectionError || connection.state === 'disconnected'
          ? { tone: 'disconnected', label: t('status.guest.failed'), detail: connectionError ?? connection.detail }
          : { tone: 'idle', label: t('status.guest.idle'), detail: '' };

  const changeConnectionRole = (role: 'host' | 'guest') => {
    if (inRoom || busy || connection.state === 'connecting') return;
    session.disconnect();
    setConnectionError(null);
    setConnectionRole(role);
    setPendingInvitation('');
    setSelectedMediaIp('');
  };

  /** 内置隧道就绪后的邀请入口；媒体策略单独配置。 */
  const tunnelUrl = tunnel?.state === 'running' ? tunnel.url : null;

  /** 本机候选只用于邀请地址选择，不能代替朋友侧的可达性验证。 */
  const publicServerUrls = [...(embeddedServer?.publicV4Urls ?? []), ...(embeddedServer?.publicV6Urls ?? [])];
  const directServerUrls = [...new Set([...(embeddedServer?.lanUrls ?? []), ...publicServerUrls])];
  const defaultDirectAddress = isTauri || directServerUrls.length === 1 ? directServerUrls[0] ?? null : null;
  const inviteAddress = inRoom && !/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(serverUrl) ? serverUrl
    : connectionConfig.signaling === 'cloudflare' ? tunnelUrl
    : selectedInviteAddress ?? (connectionConfig.signaling === 'ip' ? defaultDirectAddress : null);
  const validInviteAddress = (() => {
    if (!inviteAddress) return null;
    try { return normalizeSignalingAddress(inviteAddress); } catch { return null; }
  })();
  const inviteNeedsAttention = inRoom && connectionRole === 'host' && !validInviteAddress;
  const cloudInvite = connectionConfig.signaling === 'cloudflare';
  const inviteCanRetry = cloudInvite && (tunnel?.state === 'failed' || tunnel?.state === 'stopped');
  const roomConnectionError = connectionError || (!connected ? connection.detail : inviteCanRetry ? tunnel?.detail : null);

  /* ---------------- 内置信令服务器 ---------------- */

  useEffect(() => {
    const api = window.gameShare?.server;
    // 纯浏览器里跑渲染层（vite 直开）时没有 preload，整块不显示
    if (!api) return undefined;

    let alive = true;
    void api.getStatus().then((status) => {
      if (alive) setEmbeddedServer(status);
    });
    // 端口被占用、启停这些变化由主进程推过来，不做轮询
    const unsubscribe = api.onStatus((status) => setEmbeddedServer(status));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  /* ---------------- 异地访问隧道 ---------------- */

  useEffect(() => {
    const api = window.gameShare?.tunnel;
    // 纯浏览器里跑渲染层（vite 直开）时没有 preload，整块不显示
    if (!api) return undefined;

    let alive = true;
    void api.getStatus().then((status) => {
      if (alive) setTunnel(status);
    });
    // 隧道地址由主进程解析出来后再推过来，这里不做轮询
    const unsubscribe = api.onStatus((status) => setTunnel(status));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  const handleToggleTunnel = useCallback(async (enabled: boolean): Promise<void> => {
    const api = window.gameShare?.tunnel;
    if (!api) return;
    setTunnelBusy(true);
    try {
      setTunnel(await api.setEnabled(enabled));
    } catch (err) {
      const message = ShareSession.describeError(err);
      setConnectionError(message);
      session.pushLog(message);
    } finally {
      setTunnelBusy(false);
    }
  }, [session]);

  const changeConnectionConfig = (config: ConnectionConfig) => {
    if (inRoom || busy || connection.state === 'connecting') return;
    session.disconnect();
    session.configureMediaIp(null);
    if (config.signaling !== connectionConfig.signaling) {
      setSelectedInviteAddress(null);
      if (config.signaling !== 'cloudflare' && tunnel?.enabled) void handleToggleTunnel(false);
    }
    if (config.mediaPolicy !== connectionConfig.mediaPolicy) setSelectedMediaIp('');
    setConnectionConfig(config);
    saveConnectionConfig(config);
    setConnectionError(null);
    setServerUrl(DEFAULT_SIGNALING_URL);
  };

  const readInvitationSelection = (text: string) => {
    setPendingInvitation(text);
    setConnectionError(null);
    const invite = parseInvitation(text);
    if (!invite || invite.error || !invite.server || !invite.room) return;
    const config = resolveInvitationConfig(invite, connectionConfig);
    if (config.signaling !== connectionConfig.signaling || config.mediaPolicy !== connectionConfig.mediaPolicy) changeConnectionConfig(config);
  };

  useEffect(() => {
    if (!isTauri || inRoom || busy || connection.state === 'connecting' || connectionConfig.mediaPolicy !== 'selected-ip-experimental') return;
    const addresses = embeddedServer?.mediaAddresses;
    if (!addresses) return;
    setSelectedMediaIp(current => addresses.some(item => item.address === current) ? current : addresses[0]?.address ?? '');
  }, [isTauri, inRoom, busy, connection.state, connectionConfig.mediaPolicy, embeddedServer]);

  useEffect(() => {
    if (connectionConfig.mediaPolicy !== 'selected-ip-experimental' || !inRoom || !selectedMediaIp) return;
    let alive = true;
    const tick = async () => {
      try {
        const status = await window.gameShare?.server.getStatus();
        if (!alive || !status) return;
        setEmbeddedServer(status);
        if (!status.mediaAddresses.some(item => item.address === selectedMediaIp)) session.stopMediaForAddress(`所选媒体 IP ${selectedMediaIp} 已失效，媒体已停止。`);
      } catch { /* A failed status read is not proof the adapter disappeared. */ }
    };
    void tick();
    const timer = setInterval(() => void tick(), 2000);
    return () => { alive = false; clearInterval(timer); };
  }, [connectionConfig.mediaPolicy, inRoom, selectedMediaIp, session]);

  /* ---------------- 浮窗模式 ---------------- */

  useEffect(() => {
    const api = window.gameShare?.windowMode;
    if (!api) return undefined;

    let alive = true;
    void api.getStatus().then((status) => {
      if (alive) setFloatWindow(status);
    });
    // 快捷键是主进程里处理的，切完必须由它推回来 ——
    // 否则用键盘切过了，界面上的开关还停在旧状态
    const unsubscribe = api.onStatus((status) => setFloatWindow(status));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  const isFloat = floatWindow?.enabled === true;

  useEffect(() => {
    if (!isFloat) return;
    setSideCollapsed(false);
    window.localStorage.setItem('gs.sidebarCollapsed', '0');
  }, [isFloat]);

  const handleMainView = async () => {
    setFloatBusy(true);
    try {
      if (isFloat && window.gameShare?.windowMode) setFloatWindow(await window.gameShare.windowMode.setEnabled(false));
      if (document.fullscreenElement) await exitStageFullscreen();
      else await stageRef.current?.requestFullscreen();
    } catch (err) {
      session.pushLog(ShareSession.describeError(err));
    } finally { setFloatBusy(false); }
  };

  const handleToggleFloat = useCallback(async (enabled: boolean): Promise<void> => {
    const api = window.gameShare?.windowMode;
    if (!api) return;
    setFloatBusy(true);
    try {
      setFloatWindow(await api.setEnabled(enabled));
    } finally {
      setFloatBusy(false);
    }
  }, []);

  /**
   * 透明度滑杆。拖动会连续触发，主进程那边攒着写盘，
   * 所以这里刻意不做防抖 —— 防抖会让滑杆拖起来发黏。
   */
  const handleOpacity = useCallback(async (value: number): Promise<void> => {
    const api = window.gameShare?.windowMode;
    if (!api) return;
    setFloatWindow(await api.setOpacity(value));
  }, []);

  /**
   * 复制一条完整的邀请信息。
   *
   * 地址和房间码分两次复制，对方就得在两个格子里各填一次；合成一条文本发过去，
   * 对面照着填完就能进 —— 少一次「你等一下我看下地址」的往返。
   */
  const [inviteCopyStatus, setInviteCopyStatus] = useState<'copied' | 'failed' | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  /**
   * 把一段文本写进系统剪贴板，成功为 true。
   *
   * 走主进程的 `clipboard` 模块（`clipboard:write-text`），**不要图省事换成
   * 渲染层的 `navigator.clipboard.writeText`** —— 实测两条都堵死：
   *   1. 主进程的权限白名单只放行 media / display-capture，剪贴板写入权限会被
   *      直接拒掉，抛 `NotAllowedError: Write permission denied`，而这里要是
   *      只 catch 成一行日志，按钮就变成「看着能点、按下去没反应」；
   *   2. 放开白名单也救不了浮窗模式 —— 那边窗口 `setFocusable(false)`，
   *      写入会改成抛 `Document is not focused`，而浮窗恰恰是最想复制房间码的场景。
   * 主进程那条路既不看权限也不看焦点，两种模式都覆盖。实测见 `scripts/_probe-clipboard.cjs`。
   */
  const writeClipboard = useCallback(async (text: string): Promise<boolean> => {
    const api = window.gameShare?.clipboard;
    if (!api) return false;
    try {
      return await api.writeText(text);
    } catch {
      return false;
    }
  }, []);

  const copyInvite = useCallback(async (): Promise<void> => {
    if (!room || !validInviteAddress) return;
    const code = createInvitation(validInviteAddress, room.roomCode, connectionConfig);
    const text = [
      '一起玩 GameShare！选择“加入房间”，粘贴下面的完整邀请。信令和音视频配置会自动读取；如需媒体 IP，请选择你自己电脑的地址，再点“连接并加入”：',
      code,
    ].join('\n');
    const copied = await writeClipboard(text);
    setInviteCopyStatus(copied ? 'copied' : 'failed');
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setInviteCopyStatus(null), 2000);
    if (copied) {
      session.pushLog('邀请已复制：朋友选择“加入房间”并粘贴，配置自动读取，必要时再选择自己的媒体 IP');
    } else {
      session.pushLog('邀请复制失败，请重试');
    }
  }, [room, validInviteAddress, connectionConfig, session, writeClipboard]);

  // All invitation entry points share policy validation before opening any connection.
  const joinModeInvitation = useCallback(async (text: string) => {
    if (inRoom) throw new Error('请先离开当前房间，再加入邀请。');
    const invite = parseInvitation(text);
    if (invite?.error) throw new Error(invite.error);
    if (!invite?.server || !invite.room) throw new Error('未识别到完整邀请，请粘贴整段 GS3 / GS1 / GS2 邀请。');
    const config = resolveInvitationConfig(invite, connectionConfig);
    const target = normalizeSignalingAddress(invite.server);
    setPendingInvitation(text);
    setConnectionRole('guest');
    setConnectionConfig(config);
    saveConnectionConfig(config);
    setServerUrl(target);
    setConnectionError(null);
    if (!invite.config && !invite.mode && !invite.mediaPolicy) session.pushLog('旧邀请未携带连接策略，将沿用当前配置，请确认与房主一致。');
    const selected = config.mediaPolicy === 'selected-ip-experimental';
    if (selected) {
      const status = await window.gameShare?.server.getStatus();
      if (!selectedMediaIp || !status?.mediaAddresses.some(item => item.address === selectedMediaIp)) throw new Error('请先选择你自己电脑上有效的媒体 IP，再点击加入。');
    }
    session.configureMediaIp(selected ? selectedMediaIp : null);
    await session.connectAndWait(target, config.mediaPolicy !== 'internet-auto');
    await session.joinRoom(invite.room, nickname);
  }, [inRoom, connectionConfig, session, nickname, selectedMediaIp]);

  /* ---------------- 链路统计轮询 ---------------- */

  useEffect(() => {
    if (!inRoom) {
      setStats({});
      return;
    }

    let cancelled = false;
    const tick = async (): Promise<void> => {
      const mesh = session.mesh;
      if (!mesh) return;
      const next: Record<string, LinkStats> = {};
      await Promise.all(
        mesh.peerIds.map(async (peerId) => {
          const link = mesh.getLink(peerId);
          if (!link) return;
          next[peerId] = await link.readStats();
        }),
      );
      if (!cancelled) setStats(next);
    };

    void tick();
    const timer = setInterval(() => void tick(), 1_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [inRoom, session, room?.peers.length]);

  /* ---------------- 操作 ---------------- */

  const run = useCallback(
    async (fn: () => Promise<unknown>): Promise<void> => {
      setBusy(true);
      try {
        await fn();
      } catch (err) {
        session.pushLog(`操作失败：${ShareSession.describeError(err)}`);
      } finally {
        setBusy(false);
      }
    },
    [session],
  );

  const refreshSources = useCallback(async () => {
    setSourceError(null);
    try {
      const list = await session.capture.listSources();
      // 桌面本身放最前面，多数情况下用户要共享的是整屏
      setSources([...list].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'screen' ? -1 : 1)));
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : String(err));
    }
  }, [session]);

  // 无边框化能力（FFI 链）：取不到能力时整个按钮不显示 —— 静态断言只看源码，
  // 真实可见性必须由主进程说了算
  const [borderlessAvailable, setBorderlessAvailable] = useState(false);
  useEffect(() => {
    let alive = true;
    void session.capture
      .borderlessAvailable()
      .then((ok) => {
        if (alive) setBorderlessAvailable(ok);
      })
      .catch(() => {
        /* 取不到就当不可用，按钮不出现 */
      });
    return () => {
      alive = false;
    };
  }, [session]);

  /** 强制无边框化 / 还原。结果与失败原因都进日志面板（失败原因只有主进程知道） */
  const toggleBorderless = useCallback(
    async (sourceId: string) => {
      try {
        const r = await session.capture.toggleBorderless(sourceId);
        session.pushLog(r.message);
        // 主进程的 map 是唯一事实源；这里只做乐观同步，让按钮立刻换文案，
        // 下次枚举会以列表返回的 borderless 字段为准
        setSources((prev) =>
          prev.map((s) => (s.id === sourceId ? { ...s, borderless: r.applied } : s)),
        );
      } catch (err) {
        session.pushLog(`无边框化失败：${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [session],
  );

  // 停止共享的入口不止一个（手动停、被共享的窗口被关掉、换源失败），
  // 与其在每个入口各清一遍 activeSourceId，不如让 sharing 变 false 时统一收口。
  useEffect(() => {
    if (!sharing) setActiveSourceId(null);
  }, [sharing]);

  const pickSource = useCallback(
    async (sourceId: string) => {
      setBusy(true);
      setSourceError(null);
      try {
        if (isTauri) {
          await session.startShare({ sourceId });
        } else {
          const src = sources.find((s) => s.id === sourceId);
          const mode = src?.kind === 'screen' && audioModeChoice === 'application' ? 'system' : audioModeChoice;
          if (mode !== audioModeChoice) setAudioModeChoice(mode);
          await session.startShare({ sourceId, audioMode: mode });
        }
        if (session.getState().sharing) setActiveSourceId(sourceId);
        setPickerOpen(false);
      } catch (err) {
        // 保持面板打开，让用户能立刻改选另一个源。
        // 换源失败时共享还留着（画面没断），文案要跟首次失败区分开。
        const kept = session.getState().sharing;
        setSourceError(
          (kept ? '切换失败，已保留原共享：' : '') +
            (err instanceof Error ? err.message : String(err)),
        );
      } finally {
        setBusy(false);
      }
    },
    [session, sources, audioModeChoice, isTauri],
  );

  /** 共享中改音频模式 = 按换源流程用同一个源重采（画面会闪一下，但语义最干净） */
  const changeAudioMode = useCallback(
    (mode: AudioCaptureMode) => {
      setAudioModeChoice(mode);
      if (!activeSourceId) return;
      setBusy(true);
      void session
        .startShare({ sourceId: activeSourceId, audioMode: mode })
        .catch(() => undefined)
        .finally(() => setBusy(false));
    },
    [session, activeSourceId],
  );

  /** 用户在音频失败告警里点了「继续无声共享」：确认当前状态，收起告警 */
  const dismissAudioFailure = useCallback((): void => {
    session.acknowledgeAudioFailure();
  }, [session]);

  /* ---- 共享帧率 ---- */

  useEffect(() => {
    session.setVideoResolution(videoQuality.height);
    session.setVideoBitrateLimit(videoQuality.bitrateLimit);
  }, [session, videoQuality]);

  const changeVideoQuality = (preset: VideoQualityPreset) => {
    setVideoQuality(preset);
    saveVideoQuality(preset);
  };

  // 上次会话选过的帧率：挂载时读回一次。非法值 / 缺失一律保持默认 30。
  // 必须在进房前就落到 session 上 —— 「先改偏好后进房」的时序由 #syncMesh 兜底。
  useEffect(() => {
    const raw = window.localStorage.getItem(SHARE_FPS_STORAGE_KEY);
    const fps = Number(raw);
    if ((UI_FPS_OPTIONS as readonly number[]).includes(fps)) session.setShareFps(fps);
  }, [session]);

  /** 切帧率偏好：立即生效（共享中 setParameters，未共享只记偏好），并跨会话记住 */
  const changeShareFps = useCallback(
    (fps: number): void => {
      window.localStorage.setItem(SHARE_FPS_STORAGE_KEY, String(fps));
      session.setShareFps(fps);
    },
    [session],
  );

  const toggleSourcePicker = useCallback(async () => {
    if (pickerOpen) {
      setPickerOpen(false);
      return;
    }
    setPickerOpen(true);
    // 打开时重新枚举：共享期间目标窗口可能刚开或刚关
    await refreshSources();
  }, [pickerOpen, refreshSources]);

  const members: PeerInfo[] = room ? [room.self, ...room.peers] : [];
  const remotePeers = useMemo(() => (room ? room.peers : []), [room]);
  // 按实际渲染的画面数量排网格；不足一行的格子留空。
  const gridTileCount = remotePeers.length + (sharing ? 1 : 0);
  const gridColumns = Math.max(1, Math.ceil(Math.sqrt(gridTileCount)));
  const gridRows = Math.max(1, Math.ceil(gridTileCount / gridColumns));

  /* ---------------- 静音 ---------------- */

  const toggleMute = useCallback((peerId: string): void => {
    setPeerAudio((prev) => {
      const pref = prev[peerId] ?? DEFAULT_PEER_AUDIO;
      return { ...prev, [peerId]: { ...pref, masterMuted: !pref.masterMuted } };
    });
  }, []);

  /** 远端这一路到底有没有声音 —— 没有就不显示静音按钮，免得按了没反应 */
  const peerHasAudio = useCallback(
    (peerId: string): boolean => {
      const stream = remoteStreams[peerId];
      return Boolean(stream && stream.getAudioTracks().some((t) => t.readyState === 'live'));
    },
    [remoteStreams],
  );

  /** 读某人的分轨偏好（没设置过就给默认值） */
  const peerAudioOf = useCallback(
    (peerId: string): PeerAudioPref => peerAudio[peerId] ?? DEFAULT_PEER_AUDIO,
    [peerAudio],
  );

  /** 改某人的分轨偏好（函数式更新，滑杆拖动时不会互相踩） */
  const setPeerAudioOf = useCallback((peerId: string, patch: Partial<PeerAudioPref>): void => {
    setPeerAudio((prev) => ({
      ...prev,
      [peerId]: { ...(prev[peerId] ?? DEFAULT_PEER_AUDIO), ...patch },
    }));
  }, []);

  /* ---------------- 放大 ---------------- */

  /**
   * 双击放大规则（对应 ARCHITECTURE.md 4.10）：
   * - 双击任意远端画面进入单路主画面，其余收进底部缩略条
   * - 再双击主画面或按 Esc 恢复网格；双击缩略图切换主画面
   * - 同时只允许放大一路；本地预览不可放大（看自己没有意义）
   * - 画质联动见下面的 effect
   */
  const toggleFocus = useCallback((peerId: string): void => {
    setFocusedPeerId((prev) => (prev === peerId ? null : peerId));
  }, []);

  // 被放大的那个人离开房间 → 自动退回网格，否则主画面会永久空着
  useEffect(() => {
    if (focusedPeerId && !remotePeers.some((p) => p.peerId === focusedPeerId)) {
      setFocusedPeerId(null);
    }
  }, [focusedPeerId, remotePeers]);

  useEffect(() => {
    if (!focusedPeerId) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !document.fullscreenElement && !stageFullscreen) setFocusedPeerId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusedPeerId, stageFullscreen]);

  /* ---------------- 渲染 ---------------- */

  const qualityControl = <div className="share-setting quality-control" role="group" aria-label={t('share.quality')} data-video-quality={videoQuality.id}>
    <span className="share-setting__label">{t('share.quality')}</span>
    <div className="settings-options quality-control__options segmented-control">
      <button type="button" className="btn settings-option--divider-after" data-video-quality-auto
        aria-pressed={videoQuality.id === 'auto'} onClick={() => changeVideoQuality(AUTO_VIDEO_QUALITY)}>
        {t('share.quality.auto')}
      </button>
      {MANUAL_VIDEO_QUALITIES.map(preset => (
        <button type="button" className="btn" key={preset.id} data-video-quality-preset={preset.id}
          aria-pressed={videoQuality.id === preset.id} onClick={() => changeVideoQuality(preset)}>
          {t(`share.quality.${preset.id}`)}
        </button>
      ))}
    </div>
  </div>;

  // 共享状态下这套列表要能反复用（initial 选源 / 共享中换源）。
  const sourceList = sources.length > 0 && (
    <>
      <ul className="sources">
        {sources.map((source) => {
          const active = sharing && source.id === activeSourceId;
          return (
            <li key={source.id} className="source">
              <div className="source__row">
                <button
                  type="button"
                  className={active ? 'source__btn source__btn--active' : 'source__btn'}
                  onClick={() => void pickSource(source.id)}
                  disabled={busy}
                >
                  {source.thumbnail ? (
                    <img className="source__thumb" src={source.thumbnail} alt="" />
                  ) : (
                    <span className="source__thumb source__thumb--empty" />
                  )}
                  <span className="source__name">
                    <span className={`tag tag--${source.kind}`}>
                      {source.kind === 'screen' ? t('source.screen') : t('source.window')}
                    </span>
                    {source.name}
                    {active && <span className="tag tag--live">{t('source.current')}</span>}
                  </span>
                </button>
                {/*
                  强制无边框化：只对窗口源提供。有些游戏不支持无边框窗口化、
                  独占全屏又抓不到 —— 这颗按钮替用户完成他们不会设的窗口调整。
                  toggle 语义，还原入口就是同一个按钮（主进程的 map 是唯一事实源）。
                */}
                {borderlessAvailable && source.kind === 'window' && (
                  <button
                    type="button"
                    className={source.borderless ? 'source__bless source__bless--on' : 'source__bless'}
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleBorderless(source.id);
                    }}
                    disabled={busy}
                    title={
                      source.borderless
                        ? '还原这个窗口的边框和原始位置'
                        : '去边框并铺满显示器 —— 游戏不支持无边框窗口化时用；再点一次还原'
                    }
                  >
                    {source.borderless ? t('source.borderlessRestore') : t('source.borderless')}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {/* 这条是实测出来的：Chromium 枚举窗口时会跳过已最小化的窗口，
          连列表都不给，用户只会看到「明明开着却找不到」。
          最小化的窗口 Windows 层面也抓不到，所以只能这么提示。
          注意别把判据说成「全屏」—— 实测全屏（无边框）照样能抓，
          被盖住也能抓，只有最小化是死路。 */}
      <p className="hint hint--dim">{t('source.minimizeHint')}</p>
    </>
  );

  const renderSelfTile = (variant: TileVariant) => (
    <VideoTile
      key="self"
      peerId={room?.self.peerId ?? 'self'}
      title={fmt('tile.selfTitle', { name: room?.self.nickname ?? t('tileFloat.defaultPeer') })}
      stream={session.capture.stream}
      linkState="connected"
      stats={null}
      self
      sharing
      // 自己这一路必须恒定静音：本机同时播放自己的系统声音会变成双份回声
      //（VideoTile 内部对 self 直接静 video，不需要额外属性）
      hasAudio={hasAudio}
      variant={variant}
    />
  );

  const renderRemoteTile = (peer: PeerInfo, variant: TileVariant) => (
    <VideoTile
      key={peer.peerId}
      peerId={peer.peerId}
      title={peer.nickname}
      stream={remoteStreams[peer.peerId] ?? null}
      linkState={links[peer.peerId]?.state ?? 'new'}
      detail={links[peer.peerId]?.detail}
      diagnosis={links[peer.peerId]?.diagnosis}
      stats={stats[peer.peerId] ?? null}
      remoteSharing={Boolean(remoteSharing[peer.peerId])}
      localMediaExpected={sharing || micEnabled}
      /**
       * 远端三条轨按角色传下去。
       *
       * 这样播放层就不必再去 `stream.getAudioTracks()` 按下标猜哪条是语音 ——
       * 下标顺序在轨道增删后会变，角色不会。
       */
      tracks={remoteTracks[peer.peerId] ?? null}
      hasAudio={peerHasAudio(peer.peerId)}
      audioPref={peerAudioOf(peer.peerId)}
      onAudioPref={(patch) => setPeerAudioOf(peer.peerId, patch)}
      volOpen={volPanelPeer === peer.peerId}
      onToggleVolPanel={() => setVolPanelPeer((v) => (v === peer.peerId ? null : peer.peerId))}
      focused={focusedPeerId === peer.peerId}
      onToggleFocus={() => toggleFocus(peer.peerId)}
      variant={variant}
    />
  );

  /**
   * 浮窗模式下只摆**正在共享**的那几路。
   *
   * 浮窗的卖点是「小、不挡游戏」，没在共享的格子空占一块地方等于白占；
   * 常规模式照旧显示全部成员（那时要看的是「谁在线」）。
   */
  const floatPeers = useMemo(
    () => (isFloat ? remotePeers.filter((peer) => remoteSharing[peer.peerId]) : []),
    [isFloat, remotePeers, remoteSharing],
  );


  /* ------------------------------------------------------------------ *
   * 独立浮窗：每一路正在共享的远端画面对应一个可独立拖动的小窗
   *
   * 窗数是**总人数 − 1**（自己那一路本地预览就能看，不必再为它开一个窗）。
   * 窗口本身由主进程创建和摆放（见 `electron/float-tiles.ts`），渲染层只做两件事：
   *
   *   1. 告诉主进程「对端有谁」—— 顺序即位置，小窗按序号对号入座；
   *   2. **当帧泵**：小窗拿不到媒体轨道（`MediaStreamTrack` 不是可转移对象，
   *      过不了进程边界，实测见 float-tiles.ts 顶部），由主窗口从远端视频轨道
   *      读取帧，缩放成 `ImageBitmap` 后经 MessagePort 发送给浮窗。
   *
   * 主窗口播放音频并传送视频帧，独立小窗显示接收到的视频帧。
   * 主窗口关闭时必须关闭全部小窗；离房或停止共享时按清单清理。
   * ------------------------------------------------------------------ */

  /**
   * 拆分是否正在生效。
   *
   * 判据取 `floatTiles` 自己的状态，而不是 `FloatWindowStatus.tilesEnabled`：
   * 后者是主进程在重播浮窗状态时顺带带出来的一份拷贝，而前者每次变化都会推、
   * 还随状态带着小窗清单 —— 界面只认完整的那一份就够了。
   */
  const splitActive = isFloat && tiles?.enabled === true;

  /**
   * 小窗清单的最新值，给帧泵里的循环读。
   *
   * 刻意不进帧泵的 effect 依赖：主进程每次广播都会新建一个数组对象，
   * 直接依赖它等于让每次无关的广播都重建一轮帧泵。
   */
  const tilesRef = useRef<FloatTilesStatus | null>(null);
  tilesRef.current = tiles;

  /**
   * 小窗清单的「身份」：序号 + 对端。
   *
   * 内容没变时它的值就不变 —— 这才是帧泵该重建的判据（换了对端 / 多了一个 / 少了一个）。
   */
  const tileKey = splitActive
    ? (tiles?.tiles ?? []).map((tile) => `${tile.index}:${tile.peerId}`).join('|')
    : '';

  /**
   * 帧泵用的两张表。
   *
   * 全部放 ref 不放 state：帧泵每帧都要读它们，而它们的变化（小窗被拖大改尺寸、
   * 通道被重建）来得频繁、又完全不影响界面 —— 进 state 只是白白重渲染整个客户端。
   *
   * - `tilePortsRef`：每个小窗一条 `MessagePort`（按序号记）。**`ImageBitmap` 只有
   *   走 MessagePort 的 transfer list 才能零拷贝搬过去**，`ipcRenderer` 的结构化
   *   克隆搬不了 DOM 对象。
   * - `tileSizeRef`：小窗客户区的像素尺寸，帧泵按它缩放。
   */
  const tilePortsRef = useRef<Map<number, MessagePort>>(new Map());
  const tileSizeRef = useRef<Map<number, { width: number; height: number }>>(new Map());

  /**
   * 通道比小窗清单晚到 —— 小窗得先把页面加载起来，主进程才会建通道。
   * 这个计数器就是「新通道到了」的信号，用来把帧泵叫醒。
   */
  const [tileEpoch, setTileEpoch] = useState(0);

  /**
   * 订阅小窗状态与画面通道。
   *
   * 必须订阅而不是只读一次：小窗是**主进程**开的，用户还能直接把它关掉
   * （或者被系统收掉），不跟着走的话界面会一直显示「开着 3 个窗」而实际只剩 1 个。
   */
  useEffect(() => {
    const api = window.gameShare?.floatTiles;
    if (!api) return undefined;

    let alive = true;
    void api.getStatus().then((status) => {
      if (alive) setTiles(status);
    });
    const offStatus = api.onStatus((status) => setTiles(status));
    const offPort = api.onTilePort((port, meta) => {
      tilePortsRef.current.set(meta.index, port);
      setTileEpoch((n) => n + 1);
    });

    return () => {
      alive = false;
      offStatus();
      offPort();
    };
  }, []);

  /**
   * 小窗尺寸。只写 ref、不进 state —— 拖动小窗时这个事件是连续的，
   * 进 state 等于每拖一下就重渲染整个客户端，而界面上根本不显示这个数字。
   */
  useEffect(() => {
    const api = window.gameShare?.floatTiles;
    if (!api) return undefined;
    return api.onTileSize((info) => {
      tileSizeRef.current.set(info.index, { width: info.width, height: info.height });
    });
  }, []);

  /**
   * 小窗上按了「静音这一路」。
   *
   * 小窗里**没有声音**（音轨同样过不去），它只是个开关 —— 真正切的是主窗口里
   * 那个 `<video>.muted`。静音是**纯本机状态**、不发信令，这条与单窗口时一致。
   */
  useEffect(() => {
    const api = window.gameShare?.floatTiles;
    if (!api) return undefined;
    return api.onToggleMuteRequest((peerId) => toggleMute(peerId));
  }, [toggleMute]);

  useEffect(() => window.gameShare?.floatTiles.onVolumeRequest?.(({ peerId, volume }) => {
    setPeerAudio((prev) => ({ ...prev, [peerId]: { ...(prev[peerId] ?? DEFAULT_PEER_AUDIO), masterVol: volume } }));
  }), []);

  /** 要报给主进程的对端清单：顺序即位置，静音状态一起带上（小窗上的按钮照着它显示） */
  const tilePeersPayload = useCallback(
    (): Array<{ peerId: string; name: string; muted: boolean; volume: number }> =>
      floatPeers.map((peer) => ({
        peerId: peer.peerId,
        name: peer.nickname,
        muted: peerAudioOf(peer.peerId).masterMuted,
        volume: peerAudioOf(peer.peerId).masterVol,
      })),
    [floatPeers, peerAudioOf],
  );

  /**
   * 对端清单或静音状态一变就整轮重报。
   *
   * 主进程那边是**幂等对齐**：多了就建、少了就关、同一个位置换了人只换内容不重建窗口
   * （重建会丢掉用户拖出来的位置）。所以这里可以放心地每次重报一遍。
   */
  useEffect(() => {
    if (!splitActive) return;
    const api = window.gameShare?.floatTiles;
    if (!api) return;
    void api.syncPeers(inRoom ? tilePeersPayload() : []).then(setTiles)
      .catch(error => session.pushLog(ShareSession.describeError(error)));
  }, [splitActive, inRoom, tilePeersPayload, session]);

  useEffect(() => {
    const update = window.gameShare?.floatTiles.setVideoTracks;
    if (!update) return;
    const tracks = new Map<string, MediaStreamTrack>();
    for (const [peerId, stream] of Object.entries(remoteStreams)) {
      if (!remoteSharing[peerId]) continue;
      const track = stream.getVideoTracks()[0];
      if (track) tracks.set(peerId, track);
    }
    update(tracks);
  }, [remoteStreams, remoteSharing]);

  // 浮窗只消费远端视频轨道，主窗口的播放元素不参与取帧。
  useEffect(() => {
    if (isTauri || !splitActive) return undefined;
    const list = tilesRef.current?.tiles ?? [];
    const stops: Array<() => void> = [];

    for (const tile of list) {
      const track = remoteStreams[tile.peerId]?.getVideoTracks()[0];
      const port = tilePortsRef.current.get(tile.index);
      if (!track || !port) continue;

      /**
       * 端口必须是**真端口**。
       *
       * `MessagePort` 过不了 `contextBridge`：主窗口的 `contextIsolation` 一旦被改回 true，
       * 交到这里的就变成一个**没有方法的空普通对象** —— 而判空是过不去的（空对象是真值），
       * 之后每一帧都在 `postMessage` 上抛 TypeError、又被下面的 catch 吃掉，
       * 表现就是「小窗全黑、控制台一句话都没有」。2026-09-17 实测就是这么踩了一整轮，
       * 所以这里显式认一次：认出来就写进日志，别再让它静默失效。
       */
      if (typeof port.postMessage !== 'function') {
        session.pushLog(
          `第 ${tile.index + 1} 路画面的通道不可用（拿到的端口没有 postMessage）—— 那个小窗会一直停在「等待画面」。多半是主窗口的 contextIsolation 被打开了`,
        );
        continue;
      }

      const getSize = () =>
        tileSizeRef.current.get(tile.index) ??
        (tile.width > 0 && tile.height > 0 ? tile : undefined);
      const onError = (error: unknown) => {
        session.pushLog(`第 ${tile.index + 1} 路浮窗取帧失败：${String(error)}`);
      };
      try {
        stops.push(startFloatTilePump(track, port, getSize, onError));
      } catch (error) {
        onError(error);
      }
    }

    return () => {
      for (const stop of stops) stop();
    };
  }, [isTauri, splitActive, tileKey, tileEpoch, remoteStreams, session]);

  /**
   * 窗口是否最大化 —— 只用来决定顶栏那个按钮画「□」还是「❐」。
   *
   * 主窗口是 `frame: false` 的，最大化/还原也是我们自己发的（顶栏那个按钮），
   * 但**双击顶栏拖动区同样会最大化** —— 那是系统行为，不经过我们的按钮。
   * 所以这个值只能听主进程回报，自己记的话图标立刻就说反话。
   */
  const [winMaximized, setWinMaximized] = useState(false);
  useEffect(() => window.gameShare?.windowControl?.onMaximized(setWinMaximized), []);

  /**
   * 副标题的版本号：从主进程读（app.getVersion() = package.json 的 version）。
   * **别再写死在副标题里** —— v1.0 定稿时就是写死的「V0.1」忘了改，用户看到
   * 的版本和实际发布的对不上。读不到（vite 直开、无 preload）就留空不显示。
   */
  const [appVersion, setAppVersion] = useState('');
  useEffect(() => {
    let alive = true;
    window.gameShare?.getAppInfo().then((info) => {
      if (alive) setAppVersion(info.appVersion);
    });
    return () => {
      alive = false;
    };
  }, []);

  const copyLogReport = async (): Promise<void> => {
    setLogCopyStatus('copying');
    const report = [
      `GameShare${appVersion ? ` V${appVersion}` : ''} · ${t('log.report')}`,
      new Date().toISOString(),
      '',
      ...state.logs,
    ].join('\n');
    setLogCopyStatus(await writeClipboard(report) ? 'copied' : 'failed');
  };

  return (
    <div className={`app${isTauri ? ' app--tauri' : ''}${isFloat ? ' app--tiles' : ''}`}>
      {/*
        远端语音 / 应用声音的播放器。

        位置在**最外层、所有分支之外** —— 它一旦被放进某个条件分支里，
        就会跟着那个分支的过滤条件一起消失（这正是它当初被塞进 tile 的后果：
        浮窗按 `remoteSharing` 过滤格子 ⇒ 开麦但没共享的人听不见）。
        声音是「房间里有没有人说话」，与「界面上摆几格画面」是两件事。
      */}
      <RemoteAudioOutlet
        peers={remotePeers}
        tracks={remoteTracks}
        prefOf={peerAudioOf}
        remoteSharing={remoteSharing}
        selfPeerId={room?.self.peerId}
      />
      <header className="app__header">
        <div className="app__header-left">
          <button
            className="sidebar-toggle"
            type="button"
            aria-expanded={!sideCollapsed}
            aria-controls="workspace-controls"
            onClick={toggleSideCollapsed}
          >
            <span className="sidebar-toggle__icon" aria-hidden="true" />
            {t(sideCollapsed ? 'sidebar.expand' : 'sidebar.collapse')}
          </button>
        </div>

        <div className="app__header-right">
          <div className="app__title"
            onPointerDown={isTauri ? (event) => {
              if (event.button === 0) window.gameShare?.windowControl.startDragging?.();
            } : undefined}
            onDoubleClick={isTauri ? () => window.gameShare?.windowControl.toggleMaximize() : undefined}>
            <h1>GameShare</h1>
            {appVersion && <p className="app__subtitle">V{appVersion}</p>}
          </div>

          <div className="header-actions header-actions--utility">
            <button
              className="header-action"
              type="button"
              aria-haspopup="dialog"
              onClick={() => {
                if (logCopyStatus !== 'copying') setLogCopyStatus(undefined);
                logDialog.current?.showModal();
              }}
            >
              <svg className="header-action__icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <rect x="3.5" y="2" width="9" height="12" rx="1.5" />
                <path d="M6 6h4M6 8.5h4M6 11h2.5" />
              </svg>
              {t('log.title')}
            </button>
            {/* 中英切换：只切界面文案，房间/共享等功能不受影响 */}
            <button
              type="button"
              className="header-action"
              onClick={() => setLang(getLang() === 'zh' ? 'en' : 'zh')}
              title={t('lang.toggleTitle')}
            >
              <svg className="header-action__icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <circle cx="8" cy="8" r="5.75" />
                <ellipse cx="8" cy="8" rx="2.5" ry="5.75" />
                <path d="M2.25 8h11.5" />
              </svg>
              {t('lang.toggle')}
            </button>
          </div>

          {floatWindow && <div className="header-actions header-actions--views">
            {/* 浮窗模式：全屏游戏时用。快捷键在主进程里全局注册，这里只管显示状态。
                多开客户端时快捷键只有一个窗口抢得到，抢不到就如实标出来 ——
                否则用户按了没反应，只会以为是软件坏了。
                主窗口一直保留完整控制界面，只有独立小窗置顶。 */}
            <button
              type="button"
              className="header-action"
              data-float-toggle
              aria-pressed={floatWindow.enabled}
              disabled={floatBusy}
              onClick={() => void handleToggleFloat(!floatWindow.enabled)}
              title={
                floatWindow.hotkeyAvailable
                  ? fmt('float.hotkeyTitle', {
                      hotkey: floatWindow.hotkey.replace('Control+Alt+', 'Ctrl+Alt+'),
                    })
                  : isTauri ? undefined : t('float.hotkeyTakenTitle')
              }
            >
              <span>{t('float.mode')}</span>
              {floatWindow.hotkeyAvailable ? (
                <span className="tag">{floatWindow.hotkey.replace('Control+Alt+', 'Ctrl+Alt+')}</span>
              ) : (
                !isTauri && <span className="tag tag--warn">{t('float.hotkeyConflict')}</span>
              )}
            </button>
            <button type="button" className="header-action" aria-pressed={stageFullscreen} title={t('view.mainViewHint')} disabled={floatBusy} onClick={() => void handleMainView()}>{t('view.fullscreen')}</button>
          </div>}

          <div className={`status status--${headerStatus.tone}`} title={headerStatus.detail || (connectionRole === 'host' ? t('status.host.title') : t('status.guest.title'))}>
            <span className="status__dot" aria-hidden="true" />
            <span>{connectionRole === 'host' ? headerStatus.label : `${t('status.guest.prefix')} · ${headerStatus.label}`}</span>
            {connectionRole === 'guest' && connected && connection.rttMs !== null && <span className="status__rtt">{connection.rttMs} ms</span>}
          </div>

          {/* 窗口按钮。主窗口是 `frame: false` 的（见 electron/main.ts 里 frame 那段：
              原生标题栏在浮窗模式下拖不动，索性整个去掉），所以这三格得自己画。 */}
          <div className="winctl">
            <button
              type="button"
              className="winctl__btn"
              onClick={() => window.gameShare?.windowControl?.minimize()}
              title={t('win.minimize')}
            >
              <span className="winctl__glyph winctl__glyph--min" />
            </button>
            <button
              type="button"
              className="winctl__btn"
              onClick={() => window.gameShare?.windowControl?.toggleMaximize()}
              title={winMaximized ? t('win.restore') : t('win.maximize')}
            >
              <span
                className={`winctl__glyph ${winMaximized ? 'winctl__glyph--restore' : 'winctl__glyph--max'}`}
              />
            </button>
            <button
              type="button"
              className="winctl__btn winctl__btn--close"
              onClick={() => window.gameShare?.windowControl?.close()}
              title={t('win.close')}
            >
              <span className="winctl__glyph winctl__glyph--close" />
            </button>
          </div>
        </div>
      </header>

      <dialog ref={logDialog} className="log-dialog" aria-labelledby="log-dialog-title">
        <div className="log-dialog__header">
          <h2 id="log-dialog-title">{t('log.title')}</h2>
          <button
            type="button"
            className="btn btn--tiny"
            disabled={state.logs.length === 0 || logCopyStatus === 'copying'}
            onClick={() => void copyLogReport()}
          >
            {t('log.copyReport')}
          </button>
          <button type="button" className="btn btn--tiny" onClick={() => logDialog.current?.close()}>
            {t('win.close')}
          </button>
        </div>
        <div className="logs" tabIndex={0} role="region" aria-labelledby="log-dialog-title">
          {state.logs.length === 0 ? (
            <p className="hint hint--dim">{t('log.empty')}</p>
          ) : (
            state.logs.map((line, i) => (
              <div key={`${i}-${line}`} className="logs__line">{line}</div>
            ))
          )}
        </div>
        <p role="status" className={`hint${logCopyStatus === 'failed' ? ' hint--warn' : ''}`}>
          {logCopyStatus === 'copied' && t('log.copied')}
          {logCopyStatus === 'failed' && t('log.copyFailed')}
        </p>
      </dialog>

      <main
        className={`app__body${sideCollapsed ? ' app__body--side-collapsed' : isTauri ? ' app__body--side-framed' : ''}`}
        ref={bodyRef}
        style={{ '--sidebar-width': `${sideWidth}px`, '--sidebar-min-width': `${MIN_SIDEBAR_WIDTH}px` } as React.CSSProperties}
      >
        <aside className="app__side" id="workspace-controls" aria-label={t('sidebar.controls')} hidden={sideCollapsed}>
          <div className="sidebar-header">
            <div className="sidebar-tabs segmented-control" role="tablist" aria-label={t('sidebar.controls')}>
              {(['room', 'share'] as const).map((page) => <button key={page} id={`sidebar-tab-${page}`} type="button" role="tab" tabIndex={sidePage === page ? 0 : -1} aria-selected={sidePage === page} aria-controls={`sidebar-page-${page}`} className="btn btn--ghost" onClick={() => setSidePage(page)} onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === 'Home' ? 'room' : event.key === 'End' ? 'share' : page === 'room' ? 'share' : 'room';
                setSidePage(next);
                document.getElementById(`sidebar-tab-${next}`)?.focus();
              }}>
                {t(page === 'room' ? 'sidebar.room' : 'sidebar.share')}
              </button>)}
            </div>
            {inRoom && <div className="sidebar-summary">
              <span role="status">{connected ? fmt('sidebar.roomSummary', { n: members.length }) : t('status.host.disconnected')}</span>
              <button type="button" className="btn btn--tiny" onClick={() => void copyInvite()} disabled={!validInviteAddress || !connected} title={t('room.copyInviteTitle')}>
                {t(inviteCopyStatus === 'copied' ? 'room.copied' : inviteCopyStatus === 'failed' ? 'room.copyFailed' : 'room.copyInvite')}
              </button>
            </div>}
            {inviteNeedsAttention && <div className="sidebar-warning">
              <span role="status">{t(cloudInvite && !inviteCanRetry ? 'room.invitePreparing' : 'room.inviteUnavailable')}</span>
              {inviteCanRetry && <button type="button" className="btn btn--tiny" disabled={busy || tunnelBusy} onClick={() => { setConnectionError(null); void handleToggleTunnel(true); }}>
                {t('room.retryInvite')}
              </button>}
            </div>}
          </div>
          <div className="sidebar-content" ref={sidebarContentRef}>
          {isFloat && floatWindow && !isTauri && <section className="panel panel--tight">
            <h2>{t('float.mode')}</h2>
            <label className="view-opacity"><span>{t('view.opacity')}</span>
              <input aria-label={t('view.opacity')} type="range" min={Math.round(floatWindow.minOpacity * 100)} max={100} step={5} value={Math.round(floatWindow.opacity * 100)} onChange={(e) => void handleOpacity(Number(e.target.value) / 100)} />
              <span>{Math.round(floatWindow.opacity * 100)}%</span>
            </label>
          </section>}

          <div id="sidebar-page-room" className="sidebar-page" role="tabpanel" aria-labelledby="sidebar-tab-room" hidden={sidePage !== 'room'}>
          <ConnectionPanel config={connectionConfig} onConfig={changeConnectionConfig} mediaIp={selectedMediaIp} onMediaIp={setSelectedMediaIp} initialInvitation={pendingInvitation} onInvitation={readInvitationSelection} role={connectionRole} onRoleChange={changeConnectionRole} connectionError={connectionError ?? connection.detail} onConnectionError={setConnectionError} onCreatingRoom={setCreatingRoom} session={session} nickname={nickname} onNickname={setNickname} disabled={connection.state === 'connecting'}
            joined={inRoom} busy={busy || tunnelBusy} server={embeddedServer} tunnel={tunnel} inviteAddress={inviteAddress}
            onInviteAddress={setSelectedInviteAddress} onServerUrl={setServerUrl} onBusy={setBusy} onServer={setEmbeddedServer} onTunnel={setTunnel} onJoinInvitation={joinModeInvitation} />
          {!inRoom && tunnel?.enabled && (tunnel.state === 'starting' || tunnel.state === 'running') && <button type="button" className="btn btn--ghost" disabled={busy || tunnelBusy} onClick={() => void handleToggleTunnel(false)}>
            {t('room.closeInvite')}
          </button>}
          {room && <section className="panel panel--tight">
            <h2>{t('room.title')}</h2>

            <div className="roomcode">
              <span className="roomcode__value">{room.roomCode}</span>
            </div>

            <ul className="members">
              {members.map((peer) => {
                const isSelf = peer.peerId === room.self.peerId;
                const link = links[peer.peerId];
                return (
                  <li key={peer.peerId} className="member">
                    <span className="member__name">
                      {peer.nickname}
                      {isSelf && <span className="member__self">{t('room.memberSelf')}</span>}
                    </span>
                    <span className="member__tags">
                      {peer.isHost && <span className="tag tag--host">{t('room.tagHost')}</span>}
                      {isSelf && sharing && <span className="tag tag--live">{t('room.tagSharing')}</span>}
                      {!isSelf && (
                        <span className={`tag tag--link tag--link-${link?.state ?? 'new'}`}>
                          {t(LINK_LABEL[link?.state ?? 'new'])}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
            {roomConnectionError && <p className="hint hint--warn" role="alert">{roomConnectionError}</p>}

            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => void run(() => session.leaveRoom())}
              disabled={busy}
            >
              {t('room.leave')}
            </button>
          </section>}

          </div>
          <div id="sidebar-page-share" className="sidebar-page" role="tabpanel" aria-labelledby="sidebar-tab-share" hidden={sidePage !== 'share'}>
          {inRoom && <section className="panel panel--tight share-source">
            <h2>{t('share.title')}</h2>

            {sharing ? (
              <>
                <p className="hint">
                  {t('share.now')}
                  {captureLabel ?? t('share.unknownSource')}
                  <span className={appAudioEnabled ? 'tag tag--live' : 'tag'}>
                    {appAudioEnabled
                      ? t(isTauri && !audioMode ? 'audio.withSound' : AUDIO_MODE_LABEL[audioMode ?? 'none'] ?? 'audio.withSound')
                      : t(isTauri || audioMode === 'none' ? 'audio.tag.none' : 'share.audioOff')}
                  </span>
                </p>

                {/* 音频采集失败 → 三选项显式处理，绝不静默降级也不自动换模式。
                    「继续无声」收起告警；换模式与停止走各自完整流程。 */}
                {isTauri && audioFailure && <p className="hint hint--warn" role="status">{t('share.windowAudioBlocked')}</p>}
                {!isTauri && audioFailure && (
                  <div className="audio-failure" role="alert">
                    <p className="audio-failure__title">{t('audioFail.title')}</p>
                    <p className="hint hint--dim">{audioFailure.message}</p>
                    <div className="row">
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        onClick={() => changeAudioMode('system')}
                      >
                        {t('audioFail.toSystem')}
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={dismissAudioFailure}
                      >
                        {t('audioFail.keepSilent')}
                      </button>
                      <button
                        type="button"
                        className="btn btn--danger"
                        onClick={() => {
                          setPickerOpen(false);
                          session.stopShare();
                        }}
                      >
                        {t('audioFail.cancel')}
                      </button>
                    </div>
                  </div>
                )}

                <div className="row share-actions">
                  <button
                    type="button"
                    className="btn btn--danger"
                    onClick={() => {
                      setPickerOpen(false);
                      session.stopShare();
                    }}
                  >
                    {t('share.stop')}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => void (isTauri ? pickSource('webview-display') : toggleSourcePicker())}
                    disabled={busy}
                  >
                    {isTauri ? t('share.pickAgain') : pickerOpen ? t('share.pickHide') : t('share.pickMore')}
                  </button>
                </div>

                {(pickerOpen || isTauri) && sourceError && <p className="hint hint--warn">{sourceError}</p>}
                {isTauri && <ApplicationAudioPicker active={audioApplication} muted={!appAudioEnabled} disabled={busy}
                  onSelect={app => session.selectApplicationAudio(app.pid)}
                  onToggleMute={() => session.setAppAudioEnabled(!appAudioEnabled)} />}
                {pickerOpen && sourceList}
                {pickerOpen && sources.length === 0 && !sourceError && (
                  <p className="hint hint--dim">{t('share.noSources')}</p>
                )}
              </>
            ) : (
              <>
                <div className="row share-actions">
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => void (isTauri ? pickSource('webview-display') : refreshSources())}
                    disabled={busy}
                  >
                    {isTauri ? t('share.pickDisplay') : t('share.enumerate')}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--shrink"
                    onClick={() =>
                      void run(async () => {
                        setActiveSourceId(null);
                        await session.startShare({ testPattern: true, label: 'TEST' });
                      })
                    }
                    disabled={busy}
                    title={t('share.testSourceTitle')}
                  >
                    {t('share.testSource')}
                  </button>
                </div>

                {sourceError && <p className="hint hint--warn">{sourceError}</p>}
                {sourceList}
              </>
            )}
          </section>}

            <div className="sharing-preferences">
              <section className="panel panel--tight share-settings">
                <h2>{t('share.settings')}</h2>
                {!isTauri && <div className="share-setting" role="group" aria-label={t('share.modeAria')}>
                  <span className="share-setting__label">{t('share.modeAria')}</span>
                  <div className="settings-options settings-options--three">
                    {UI_AUDIO_MODES.map(({ mode, label, title }) => (
                      <button
                        key={mode}
                        type="button"
                        className={mode === 'system' ? 'btn settings-option--divider-after' : 'btn'}
                        disabled={sharing && busy}
                        onClick={() => sharing ? changeAudioMode(mode) : setAudioModeChoice(mode)}
                        aria-pressed={audioModeChoice === mode}
                        title={t(title)}
                      >
                        {t(label)}
                      </button>
                    ))}
                  </div>
                </div>}

                {/* 未共享时也可预设帧率：只记偏好，startShare 时应用 */}
                <div className="share-setting" role="group" aria-label={t('share.fpsAria')}>
                  <span className="share-setting__label">{t('share.fpsAria')}</span>
                  <div className="settings-options settings-options--three segmented-control">
                    {UI_FPS_OPTIONS.map((fps) => (
                      <button
                        key={fps}
                        type="button"
                        className="btn"
                        onClick={() => changeShareFps(fps)}
                        aria-pressed={shareFps === fps}
                        title={t('share.fpsTitle')}
                      >
                        {fps} {t('share.fpsUnit')}
                      </button>
                    ))}
                  </div>
                </div>

                {qualityControl}
              </section>
              <VoicePanel session={session} busy={busy} visible={!sideCollapsed && sidePage === 'share'} run={run} binding={voiceBinding} setBinding={setVoiceBinding} recording={voiceRecording} setRecording={setVoiceRecording} error={voiceHotkeyError} />
            </div>
          </div>
          </div>
        </aside>

        {!sideCollapsed && <div
          className={`app__resizer${sideDragging ? ' app__resizer--dragging' : ''}`}
          role="separator"
          tabIndex={0}
          aria-label={t('sidebar.resize')}
          aria-controls="workspace-controls"
          aria-orientation="vertical"
          aria-valuemin={MIN_SIDEBAR_WIDTH}
          aria-valuemax={MAX_SIDEBAR_WIDTH}
          aria-valuenow={sideWidth}
          title={t('sidebar.resizeTitle')}
          onPointerDown={onResizerDown}
          onPointerMove={onResizerMove}
          onPointerUp={onResizerUp}
          onPointerCancel={onResizerUp}
          onLostPointerCapture={onResizerUp}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            const width = document.getElementById('workspace-controls')?.clientWidth ?? sideWidth;
            applySideWidth(width + (event.key === 'ArrowLeft' ? -16 : 16));
          }}
        />}

        {/* 浮窗里整块画面区就是**拖动区**：窗口是 `setFocusable(false)` 的，标题栏拖动
            与边框缩放都会先激活窗口、在非激活窗口上都不成立，所以只能自绘（见 float-drag.ts）。
            常规模式刻意不挂 —— 那时原生边框拖得动，挂了反而会吃掉画面区里的文字选择。
            收起成小球时换成 `ballDragProps`：同样是拖动，但多了一条「没动过就算点一下」
            （整块都是拖动区，没法在上面另挖一个按钮出来）。 */}
        <div
          className={`app__stage${isFloat ? " stage--tiles" : ""}`}
          ref={stageRef}
          role="region"
          aria-label={t('stage.title')}
          onPointerMove={event => {
            if (stageFullscreen && event.clientY - event.currentTarget.getBoundingClientRect().top <= 64) showFullscreenExit();
          }}
        >
          {stageFullscreen && (
            <button type="button" className={`stage__exit-fullscreen btn${fullscreenExitVisible ? '' : ' stage__exit-fullscreen--hidden'}`} onClick={() => void exitStageFullscreen()}>
              {t('view.exitFullscreen')} · Esc
            </button>
          )}
          {isFloat && inRoom && <div className="tiles-control-notice">
            <h2>{t('view.floatingActive')}</h2>
            <p>{fmt('view.floatingCount', { n: tiles?.tiles.length ?? 0 })}</p>
            <p className="hint">{t('view.floatingHint')}</p>
          </div>}
          {!inRoom || (!isFloat && gridTileCount === 0) ? (
            <div className="stage__empty">
              <div className="stage__empty-art" aria-hidden="true" />
              <h2>{t(inRoom ? 'stage.noShare' : 'stage.title')}</h2>
              <p>{t(inRoom ? 'stage.noShareHint' : 'stage.noRoomHint')}</p>
              {(sideCollapsed || (inRoom && sidePage !== 'share')) && (
                <button type="button" className="btn" onClick={() => openSidebarPage(inRoom ? 'share' : 'room')}>
                  {t(inRoom ? 'stage.openShare' : 'stage.openRoom')}
                </button>
              )}
            </div>
          ) : focusedPeerId ? (
            <div className="stage stage--focused">
              <div className="stage__main">
                {remotePeers.filter((p) => p.peerId === focusedPeerId).map((p) => renderRemoteTile(p, 'main'))}
              </div>
              <div className="stage__strip">
                {sharing && renderSelfTile('thumb')}
                {remotePeers
                  .filter((p) => p.peerId !== focusedPeerId)
                  .map((p) => renderRemoteTile(p, 'thumb'))}
              </div>
            </div>
          ) : (
            <div className="grid" style={{
              gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${gridRows}, minmax(0, 1fr))`,
            }}>
              {sharing && renderSelfTile('grid')}
              {remotePeers.map((peer) => renderRemoteTile(peer, 'grid'))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 单路画面
 * ------------------------------------------------------------------ */

interface VideoTileProps {
  peerId: string;
  title: string;
  stream: MediaStream | null;
  linkState: string;
  detail?: string;
  /**
   * 归因结论。**这是「为什么连不上」第一次出现在界面上** ——
   * 此前只有日志面板里有，而它默认收起，于是 1.3.2 加的「只能 TURN」这种
   * 可行动结论用户根本看不见（用户从日志面板默认收起这条就已经吃过亏）。
   *
   * undefined 表示「还没有诊断」（链路刚建、state 还没填上），
   * 此时不显示任何条 —— 别拿 undefined 当默认值渲染出一句「正在连接」。
   */
  diagnosis?: LinkDiagnosis;
  stats: LinkStats | null;
  self?: boolean;
  sharing?: boolean;
  remoteSharing?: boolean;
  localMediaExpected?: boolean;
  /**
   * 远端三条轨按角色。有它之后播放层就不必再 `stream.getAudioTracks()` 按下标猜
   * 哪条是语音 —— 下标会随轨道增删漂移，角色不会。
   */
  tracks?: RemoteTracks | null;
  hasAudio?: boolean;
  /**
   * 分轨音量偏好（语音 / 共享声音各自独立）。不传 = 本地预览，不渲染音量控件。
   *
   * 「同一个 peer 不挂重复播放器」由结构保证：两条角色音轨各对应**一个**
   * `<audio>` 元素（ref 复用），轨道对象变化只换 `srcObject`，不另起元素。
   */
  audioPref?: PeerAudioPref;
  onAudioPref?: (patch: Partial<PeerAudioPref>) => void;
  /** 音量小面板是否展开（同一时刻只允许一个 tile 展开，由 App 层管） */
  volOpen?: boolean;
  onToggleVolPanel?: () => void;
  focused?: boolean;
  onToggleFocus?: () => void;
  variant: TileVariant;
}

function VideoTile({
  title,
  stream,
  linkState,
  detail,
  diagnosis,
  stats,
  self,
  remoteSharing,
  localMediaExpected,
  tracks,
  hasAudio,
  audioPref,
  onAudioPref,
  volOpen,
  onToggleVolPanel,
  focused,
  onToggleFocus,
  variant,
}: VideoTileProps) {
  const t = useI18n();
  const ref = useRef<HTMLVideoElement | null>(null);
  const [hasFrames, setHasFrames] = useState(false);

  const voiceTrack = tracks?.voice ?? null;
  const appAudioTrack = tracks?.appAudio ?? null;

  /**
   * 语音与应用声音**各接各的 `<audio>`，不混进 `<video>`**（播放器在下面的
   * `RemoteAudioOutlet`）。这里只留一个判断：这个 tile 自己要不要恒静。
   *
   * 交给 `<video>` 一条整流就等于在播放层又把两条轨合成了一路，角色信息当场丢失，
   * 之后想单独静音 / 调音量只能回去猜下标 —— 那正是这轮改造要根除的东西。
   * 分开接之后「哪条是语音」一路保留到播放端。
   *
   * 没有角色表时（本地预览，以及 ontrack 还没到的那一小段）退回老行为：
   * 由 `<video>` 直接播整条流，至少保证「听得见」。
   */

  // A WebRTC receiver can keep its track and last decoded frame after the sender stops.
  const playbackStream = self || remoteSharing ? stream : null;
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (video.srcObject !== playbackStream) {
      video.srcObject = playbackStream;
      setHasFrames(false);
    }
    if (playbackStream) void video.play().catch(() => undefined);
  }, [playbackStream]);

  /**
   * 两条角色音轨的播放**不在这个组件里** —— 见文件末尾的 `RemoteAudioOutlet`。
   *
   * 曾经把 `<audio>` 挂在 tile 里，于是「声音」依赖「格子存在」：
   * 浮窗只摆正在共享的那几格（`floatPeers` 按 `remoteSharing` 过滤），
   * 而 `voice` 轨与 `sharing` 是**解耦**的（`stopShare` 明确不摘 voice），
   * 于是「开着麦但没共享画面」的人在浮窗里**完全听不见** —— 而那正是
   * 浮窗的主场景（边打游戏边听队友）。
   *
   * `<video>` 自己的静音仍归这里管：有没有角色音轨决定它要不要恒静
   * （不静就会同一路播两遍）。
   */
  const noRoleAudio = voiceTrack === null && appAudioTrack === null;
  const bothMuted = Boolean(audioPref && (audioPref.masterMuted || (audioPref.voiceMuted && audioPref.appMuted)));
  useEffect(() => {
    if (ref.current) ref.current.muted = self ? true : !noRoleAudio || bothMuted;
  }, [self, noRoleAudio, bothMuted]);

  // 等真正解出画面再撤掉占位层，否则会出现「显示已连接但一片黑」
  const markFrames = useCallback(() => setHasFrames(true), []);

  const inbound = stats?.inbound ?? null;
  const route = stats?.route ?? null;
  const compact = variant === 'thumb';
  const mediaExpected = Boolean(localMediaExpected || remoteSharing || (voiceTrack && !voiceTrack.muted) || (appAudioTrack && !appAudioTrack.muted));

  return (
    <div
      className={`tile tile--${linkState}${focused ? ' tile--focused' : ''}${
        onToggleFocus ? ' tile--clickable' : ''
      }`}
      onDoubleClick={onToggleFocus}
    >
      {/*
        有角色音轨时把 video 元素静掉，声音交给 `RemoteAudioOutlet` 的两条 audio
        —— 不静的话同一路声音会被播两遍，听感上是一个极短的叠音。
      */}
      <video
        ref={ref}
        className="tile__video"
        hidden={!playbackStream}
        autoPlay
        playsInline
        muted={!noRoleAudio || bothMuted}
        onLoadedData={markFrames}
        onPlaying={markFrames}
      />

      {/*
        两条角色音轨**不在这个 tile 里** —— 播放器见文件末尾的 `RemoteAudioOutlet`。
        音量控件仍留在这里：它是「谁的声音要调」的入口，与格子在不在无关；
        而真正出声的元素必须在所有分支之外，否则浮窗会把它一起过滤掉。
      */}
      {/*
        这里**曾经**挂两条 `<audio>`（语音 / 应用声音各一条）。
        现在它们搬到了文件末尾的 `RemoteAudioOutlet` —— 按 peerId 渲染，
        不再依附于「格子是否存在」。原因见 `RemoteAudioOutlet` 的注释。
      */}

      {(!playbackStream || !hasFrames) && (
        <div className="tile__placeholder">
          <span>{stream ? t('tile.waiting') : t('tile.noStream')}</span>
        </div>
      )}

      {/*
        归因条：只在该说的时候说。
        - `ok` 不显示（牌子本身已经写着「已连接」，多一行是噪音）
        - `connecting` 不显示（那是正常状态，不必解释）
        - 其余四种是「有问题或正在努力」，必须让用户看见
      */}
      {mediaExpected && diagnosis && diagnosis.kind !== 'ok' && diagnosis.kind !== 'connecting' && !compact && (
        <div
          className={`tile__diag tile__diag--${diagnosis.kind}`}
          title={DIAG_TITLE(diagnosis)}
        >
          <span className="tile__diagtext">{diagnosis.summary}</span>
          {diagnosis.detail && <span className="tile__diagdetail">{diagnosis.detail}</span>}
          {/* 候选构成是判据本身（有 srflx/relay 与否决定归到 needs-turn 还是 needs-stun），
              值得占一行给用户看：他自己就能判断「我这边的网络到底通没通」。 */}
          {diagnosis.candidates && <span className="tile__diagcand">{diagnosis.candidates}</span>}
        </div>
      )}

      <div className="tile__header">
        <span className="tile__title">{title}</span>
        {/* 放大不能只留双击：窗口刚被激活时第一次点击会被系统吞掉，
            双击就变成了「点了没反应」。给一个看得见的按钮，
            规则也从「得知道有这回事」变成「一眼能看见」。 */}
        {!compact && onToggleFocus && (
          <button
            type="button"
            className={focused ? 'tile__act tile__act--on' : 'tile__act'}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFocus();
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            title={focused ? t('tile.restore') : t('tile.enlargeTitle')}
          >
            {focused ? t('tile.restore') : t('tile.enlarge')}
          </button>
        )}
        {!compact && !self && onToggleVolPanel && (voiceTrack || appAudioTrack) && (
          <div className="tile__volwrap">
            <button
              type="button"
              className={volOpen ? 'tile__act tile__act--on' : 'tile__act'}
              onClick={(e) => {
                e.stopPropagation();
                onToggleVolPanel();
              }}
              onDoubleClick={(e) => e.stopPropagation()}
              title={t('tile.volumeTitle')}
              aria-label={t('tile.volumeTitle')}
              aria-expanded={Boolean(volOpen)}
            >
              {t('tile.volume')}
            </button>
            {volOpen && audioPref && onAudioPref && (
              <div className="tile__volpanel" onClick={(e) => e.stopPropagation()}>
                {voiceTrack && (
                  <label className="tile__volrow">
                    <span>{t('tile.voice')}</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={audioPref.voiceVol}
                      onChange={(e) => onAudioPref({ voiceVol: Number(e.target.value) })}
                    />
                    <button
                      type="button"
                      className={audioPref.voiceMuted ? 'tile__act tile__voldown' : 'tile__act'}
                      onClick={() => onAudioPref({ voiceMuted: !audioPref.voiceMuted })}
                      title={t('tile.muteVoiceTitle')}
                    >
                      {audioPref.voiceMuted ? t('tile.muted') : t('tile.on')}
                    </button>
                  </label>
                )}
                {appAudioTrack && (
                  <label className="tile__volrow">
                    <span>{t('tile.appAudio')}</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={audioPref.appVol}
                      onChange={(e) => onAudioPref({ appVol: Number(e.target.value) })}
                    />
                    <button
                      type="button"
                      className={audioPref.appMuted ? 'tile__act tile__voldown' : 'tile__act'}
                      onClick={() => onAudioPref({ appMuted: !audioPref.appMuted })}
                      title={t('tile.muteAppAudioTitle')}
                    >
                      {audioPref.appMuted ? t('tile.muted') : t('tile.on')}
                    </button>
                  </label>
                )}
              </div>
            )}
          </div>
        )}
        {/*
          缩略格只有 168x95，放不下一行说明 —— 但「为什么别人黑屏」这个问题
          不能只在放大后才答。给一个红点，鼠标悬停出完整结论。
          省略号而不是完整文字：缩略格里三个字也挤不下。
        */}
        {compact && mediaExpected && diagnosis && diagnosis.kind !== 'ok' && diagnosis.kind !== 'connecting' && (
          <span
            className={`tile__diagdot tile__diagdot--${diagnosis.kind}`}
            title={DIAG_TITLE(diagnosis)}
          >
            {DIAG_SHORT[diagnosis.kind] ?? '!'}
          </span>
        )}
      </div>

      {!compact && (
        <div className="tile__footer">
          <div className="tile__statuses">
            {self ? <span className="tile__status">{t('tile.tagLocal')}</span> : <>
              <span className={`tile__status tile__status--${mediaExpected ? linkState : 'new'}`}>
                <span className="tile__status-dot" aria-hidden="true" />
                {!mediaExpected ? '等待共享' : `音视频 · ${LINK_LABEL[linkState] ? t(LINK_LABEL[linkState]) : linkState}`}
              </span>
              {!remoteSharing && <span className="tile__status">{t('tile.tagNotSharing')}</span>}
              {hasAudio === false && <span className="tile__status">{t('tile.tagNoAudio')}</span>}
            </>}
          </div>
          {!self && route && <details className="hint tile__route-details">
            <summary>音视频实际路径：{route.relay ? 'TURN 中继' : '端点连接'}</summary>
            <span>本地：{route.localAddress ?? '未提供'} → 远端：{route.remoteAddress ?? '未提供'}（{route.protocol}）</span>
          </details>}
          <div className="tile__metrics">
          {self ? (
            <span className="hint hint--dim">{t('tile.localPreviewInfo')}</span>
          ) : inbound ? (
            <>
              <span>
                {inbound.frameHeight > 0 ? `${inbound.frameHeight}p` : '—'}
              </span>
              <span>{inbound.framesPerSecond} fps</span>
              <span title={inbound.bitrateBps === null ? t('tile.statsCollecting') : undefined}>{formatBitrate(inbound.bitrateBps)}</span>
              <span className={route?.relay ? 'tile__route--relay' : undefined}>
                {route
                  ? route.relay
                    ? `TURN(${route.localType})`
                    : `P2P(${route.localType})`
                  : t('tile.pathDetecting')}
              </span>
              {route?.currentRoundTripTime != null && <span>{route.currentRoundTripTime} ms</span>}
            </>
          ) : (
            <span className="hint hint--dim">{!mediaExpected ? '等待共享画面或开启语音' : detail || t('tile.statsCollecting')}</span>
          )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 远端角色音轨的播放器 —— 语音与应用声音各一路，**按 peerId 渲染**。
 *
 * --- 为什么必须住在 tile 外面 ---
 *
 * 原来这两条 `<audio>` 挂在 `VideoTile` 里，于是「能不能听见」取决于
 * 「格子在不在」。而这两件事是**解耦**的：
 *
 *   · 画面格子：浮窗下只摆**正在共享**的那几路（`floatPeers` 按 `remoteSharing` 过滤）
 *   · 语音轨：与 `sharing` 无关（`stopShare` 明确只摘 video + appAudio，不摘 voice）
 *
 * 两者一拼，结论是：**开着麦但没共享画面的人，在浮窗里完全听不见。**
 * 而「边打游戏边听队友」正是浮窗的主场景 —— 这是功能缺失，不是提示缺失。
 *
 * 常规模式为什么没暴露这个 bug：那里按**成员列表**渲染全部格子，
 * 不看 `remoteSharing`，所以每人都有格子、都有播放器。浮窗是唯一会过滤的分支。
 *
 * --- 拆开之后要守住的三件事 ---
 *
 * 1. **一个 peer 一对元素，不因格子重挂而重建**。音量面板开关、放大/还原、
 *    浮窗/常规切换都会让 tile 重新挂载；元素重建就会中断正在播的声音
 *    （`srcObject` 重新赋值 ⇒ 重新走一遍缓冲）。所以这里以 `peerId` 为 key，
 *    key 不变则元素不变。
 * 2. **静音 / 音量只切本机属性**，不发信令 —— 与原先行为一致。
 * 3. **没有轨道时元素不渲染**。`srcObject` 挂 null 是另一回事：
 *    留着空元素会让人以为「有声音但听不到」。
 */
function RemoteAudioOutlet({
  peers,
  tracks,
  prefOf,
  remoteSharing,
  selfPeerId,
}: {
  /** 房间里的远端成员（不含自己） */
  peers: readonly PeerInfo[];
  /** peerId → 三条轨 */
  tracks: Record<string, RemoteTracks | undefined>;
  /** 取某人的分轨音量偏好 */
  prefOf: (peerId: string) => PeerAudioPref;
  /** peerId → 此刻在不在共享画面。**只用于展示，不参与判据** */
  remoteSharing: Record<string, boolean>;
  /** 自己的 peerId */
  selfPeerId: string | undefined;
}) {
  /**
   * 「该给谁放声音」交给纯函数判据（`packages/shared/src/voice-audience.ts`），
   * 不在这里 inline 过滤 —— 这个 bug 的形态就是「过滤条件写错」，
   * 而过滤条件一旦摊进 JSX 就没人能独立验它。
   */
  const audience = remoteAudioAudience(
    peers.map((peer) => ({
      peerId: peer.peerId,
      sharing: Boolean(remoteSharing[peer.peerId]),
      tracks: tracks[peer.peerId] ?? null,
    })),
    selfPeerId ?? '',
  );

  return (
    <>
      {audience.map((peerId) => (
        <RemoteAudioPair
          key={peerId}
          tracks={tracks[peerId] ?? null}
          pref={prefOf(peerId)}
        />
      ))}
    </>
  );
}

/**
 * 单个 peer 的两条角色音轨。
 *
 * 拆成独立组件是为了让 `key` 挂在 peerId 上：父组件重渲染时
 * React 按 key 复用同一个实例，`<audio>` 元素因此不会被拆掉重建。
 */
function RemoteAudioPair({
  tracks,
  pref,
}: {
  tracks: RemoteTracks | null;
  pref: PeerAudioPref;
}) {
  const voiceRef = useRef<HTMLAudioElement | null>(null);
  const appAudioRef = useRef<HTMLAudioElement | null>(null);

  const voiceTrack = tracks?.voice ?? null;
  const appAudioTrack = tracks?.appAudio ?? null;
  const voiceStream = useMemo(
    () => (voiceTrack ? new MediaStream([voiceTrack]) : null),
    [voiceTrack],
  );
  const appAudioStream = useMemo(
    () => (appAudioTrack ? new MediaStream([appAudioTrack]) : null),
    [appAudioTrack],
  );

  /**
   * 轨道变化只换 `srcObject`，不新起元素 —— 元素是同一个，
   * 所以换源期间不会把正在播的声音打断成一段空白。
   */
  useEffect(() => {
    const pairs: Array<[HTMLAudioElement | null, MediaStream | null, boolean, number]> = [
      [voiceRef.current, voiceStream, pref.masterMuted || pref.voiceMuted, pref.voiceVol * pref.masterVol],
      [appAudioRef.current, appAudioStream, pref.masterMuted || pref.appMuted, pref.appVol * pref.masterVol],
    ];
    for (const [el, nextStream, muted, volume] of pairs) {
      if (!el) continue;
      if (el.srcObject !== nextStream) el.srcObject = nextStream;
      el.muted = muted;
      el.volume = volume;
      if (nextStream) void el.play().catch(() => undefined);
    }
  }, [voiceStream, appAudioStream, pref]);

  return (
    <>
      {voiceStream && <audio ref={voiceRef} autoPlay playsInline />}
      {appAudioStream && <audio ref={appAudioRef} autoPlay playsInline />}
    </>
  );
}

