import { normalizeConnectionMode, type ConnectionMode, type MediaPolicy } from './connection-modes';
import { normalizeSignalingAddress } from '@game-share/shared';
import { configFromLegacyMode, parseConnectionConfig, type ConnectionConfig } from './connection-config';

export interface Invitation {
  server?: string;
  room?: string;
  mode?: ConnectionMode;
  mediaPolicy?: MediaPolicy;
  signaling?: 'ip' | 'cloudflare';
  error?: string;
  config?: ConnectionConfig;
}

export function createInvitation(server: string, room: string, config: ConnectionConfig): string {
  const parsed = parseConnectionConfig(config);
  if (!parsed || !server.trim() || !/^[A-Z0-9]{6}$/i.test(room)) throw new Error('房间配置或邀请地址无效。');
  return `GS3.${btoa(JSON.stringify({ server: normalizeSignalingAddress(server), room: room.toUpperCase(), ...parsed }))}`;
}

export function resolveInvitationConfig(invite: Invitation, fallback: ConnectionConfig): ConnectionConfig {
  if (invite.config) return { ...invite.config };
  const legacy = configFromLegacyMode(invite.mode);
  const config = legacy ?? { ...fallback, ...(invite.mediaPolicy ? { mediaPolicy: invite.mediaPolicy } : {}) };
  if (invite.mode === 'mixed') config.signaling = invite.signaling === 'cloudflare' ? 'cloudflare' : 'external';
  return config as ConnectionConfig;
}

export function parseInvitation(raw: string): Invitation | null {
  const text = raw.trim();
  if (!text) return null;
  // Experimental mixed invitations use GS2 without a GS1 fallback, preventing
  // older clients from silently ignoring the media selection requirement.
  if (/GS(?:[4-9]|\d{2,})\./.test(text)) return { error: '此邀请需要更新版本的客户端。' };
  if (/GS3\./.test(text)) {
    const token = text.match(/GS3\.([A-Za-z0-9+/=]+)/);
    try {
      if (!token) throw new Error('missing token');
      const obj = JSON.parse(atob(token[1])) as Record<string, unknown>;
      const config = parseConnectionConfig(obj);
      if (!config) return { error: '邀请的信令方式或音视频策略不受支持，请更新客户端或让房主重发邀请。' };
      if (typeof obj.server !== 'string' || !obj.server.trim() || typeof obj.room !== 'string' || !/^[A-Z0-9]{6}$/i.test(obj.room)) return { error: '邀请缺少有效的房间地址或房间码，请让房主重新复制。' };
      return { server: normalizeSignalingAddress(obj.server), room: obj.room.toUpperCase(), config };
    } catch { return { error: '邀请已损坏或地址无效，请复制完整的 GS3 邀请重新加入。' }; }
  }
  const version = /GS2\./.test(text) ? 2 : 1;
  const token = text.match(version === 2 ? /GS2\.([A-Za-z0-9+/=]+)/ : /GS1\.([A-Za-z0-9+/=]+)/);
  if (!token && /GS[12]\./.test(text)) return { error: '邀请已损坏，请重新复制。' };
  if (token) {
    try {
      const value: unknown = JSON.parse(atob(token[1]));
      if (!value || typeof value !== 'object') return { error: '邀请格式无效。' };
      const obj = value as Record<string, unknown>;
      const mode = normalizeConnectionMode(obj.mode);
      if (obj.mode !== undefined && !mode) return { error: '邀请使用了未知连接模式，请更新客户端。' };
      if (obj.mediaPolicy === 'selected-ip') return { error: '当前版本尚未支持严格媒体 IP 绑定，无法加入混合模式。' };
      if (mode === 'mixed') {
        if (version !== 2 || obj.mediaPolicy !== 'selected-ip-experimental' || (obj.signaling !== 'ip' && obj.signaling !== 'cloudflare')) return { error: '混合模式需要新版 GS2 实验邀请，请让房主重新复制邀请。' };
        return { server: typeof obj.server === 'string' ? obj.server : undefined, room: typeof obj.room === 'string' ? obj.room.toUpperCase() : undefined, mode, mediaPolicy: 'selected-ip-experimental', signaling: obj.signaling };
      }
      if (version === 2) return { error: '不支持此新版邀请的媒体策略，请更新客户端。' };
      if (obj.mediaPolicy !== undefined && obj.mediaPolicy !== 'local-auto' && obj.mediaPolicy !== 'internet-auto') return { error: '邀请使用了未知媒体策略，请更新客户端。' };
      if (mode && obj.mediaPolicy && (mode === 'lan') !== (obj.mediaPolicy === 'local-auto')) return { error: '邀请中的连接模式与媒体策略不一致。' };
      const server = typeof obj.server === 'string' ? obj.server : undefined;
      const room = typeof obj.room === 'string' ? obj.room.toUpperCase() : undefined;
      return { server, room, mode: mode ?? undefined, mediaPolicy: obj.mediaPolicy as MediaPolicy | undefined };
    } catch { return { error: '邀请已损坏，请复制完整的邀请重新加入。' }; }
  }
  const server = text.match(/信令地址[：:]\s*(\S+)/)?.[1];
  const room = text.match(/房间码[：:]\s*([A-Za-z0-9]{6})/)?.[1]?.toUpperCase();
  if (server && room) return { server, room };
  const url = text.match(/https?:\/\/[^\s，,；;）)]+/)?.[0];
  const bareRoom = text.match(/\b([A-Z0-9]{6})\b/)?.[1];
  return url && bareRoom ? { server: url, room: bareRoom } : null;
}
