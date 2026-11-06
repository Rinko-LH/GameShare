import { normalizeConnectionMode, type ConnectionMode, type MediaPolicy } from './connection-modes';

export interface Invitation {
  server?: string;
  room?: string;
  mode?: ConnectionMode;
  mediaPolicy?: MediaPolicy;
  signaling?: 'ip' | 'cloudflare';
  error?: string;
}

export function parseInvitation(raw: string): Invitation | null {
  const text = raw.trim();
  if (!text) return null;
  // Experimental mixed invitations use GS2 without a GS1 fallback, preventing
  // older clients from silently ignoring the media selection requirement.
  if (/GS[3-9]\./.test(text)) return { error: '此邀请需要更新版本的客户端。' };
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
