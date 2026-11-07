export type VoiceMode = 'continuous' | 'push-to-talk';
export interface VoiceBinding { code: string; ctrl: boolean; alt: boolean; shift: boolean }
export interface VoicePreferences { mode: VoiceMode; binding: VoiceBinding | null }
export interface VoiceHotkeyStatus { pressed: boolean; error: string | null; revision: number }
export interface VoiceHotkeyConfig { active: boolean; binding: VoiceBinding | null }
export const VOICE_STORAGE_KEY = 'gs.voiceSettings';

const keys: Record<string, number> = {
  Space: 0x20, CapsLock: 0x14, ArrowLeft: 0x25, ArrowUp: 0x26, ArrowRight: 0x27, ArrowDown: 0x28,
  PageUp: 0x21, PageDown: 0x22, End: 0x23, Home: 0x24, Insert: 0x2d, Delete: 0x2e,
  NumpadMultiply: 0x6a, NumpadAdd: 0x6b, NumpadSubtract: 0x6d, NumpadDecimal: 0x6e, NumpadDivide: 0x6f,
};
for (let i = 0; i < 26; i++) keys[`Key${String.fromCharCode(65 + i)}`] = 65 + i;
for (let i = 0; i < 10; i++) { keys[`Digit${i}`] = 48 + i; keys[`Numpad${i}`] = 96 + i; }
for (let i = 1; i <= 12; i++) keys[`F${i}`] = 111 + i;
export function bindingVirtualKey(binding: VoiceBinding): number { return keys[binding.code]; }
export function normalizeVoiceBinding(value: unknown): VoiceBinding | null {
  if (!value || typeof value !== 'object') return null;
  const b = value as Record<string, unknown>;
  if (typeof b.code !== 'string' || !Object.hasOwn(keys, b.code) ||
      typeof b.ctrl !== 'boolean' || typeof b.alt !== 'boolean' || typeof b.shift !== 'boolean') return null;
  if ((b.alt && b.code === 'F4') || (b.ctrl && b.alt && (b.code === 'Delete' || b.code === 'KeyG'))) return null;
  return { code: b.code, ctrl: b.ctrl, alt: b.alt, shift: b.shift };
}
export function bindingFromEvent(event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): VoiceBinding | null {
  return event.metaKey ? null : normalizeVoiceBinding({ code: event.code, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey });
}
export function describeVoiceBinding(binding: VoiceBinding | null): string {
  if (!binding) return '—';
  const code = binding.code.replace(/^Key|^Digit/, '').replace(/^Numpad/, 'Num ');
  return [...(binding.ctrl ? ['Ctrl'] : []), ...(binding.alt ? ['Alt'] : []), ...(binding.shift ? ['Shift'] : []), code].join(' + ');
}
export function readVoicePreferences(): VoicePreferences {
  try {
    const value = JSON.parse(window.localStorage.getItem(VOICE_STORAGE_KEY) ?? 'null');
    return { mode: value?.mode === 'push-to-talk' ? 'push-to-talk' : 'continuous', binding: normalizeVoiceBinding(value?.binding) };
  } catch { return { mode: 'continuous', binding: null }; }
}
export function saveVoicePreferences(value: VoicePreferences): void {
  try { window.localStorage.setItem(VOICE_STORAGE_KEY, JSON.stringify(value)); } catch { /* 存储不可用不阻止语音 */ }
}

/** 重新启用或换键后必须先释放整组按键；只读取当前状态，不拦截输入。 */
export class VoiceHoldDetector {
  #armed = false;
  sample(binding: VoiceBinding, down: (vk: number) => boolean): boolean {
    const primary = down(bindingVirtualKey(binding));
    const ctrl = down(0x11), alt = down(0x12), shift = down(0x10);
    if (!this.#armed) {
      if (!primary && !(binding.ctrl && ctrl) && !(binding.alt && alt) && !(binding.shift && shift)) this.#armed = true;
      return false;
    }
    return primary && ctrl === binding.ctrl && alt === binding.alt && shift === binding.shift && !down(0x5b) && !down(0x5c);
  }
}
