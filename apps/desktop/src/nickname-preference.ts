const NICKNAME_STORAGE_KEY = 'gs.nickname';

export function readNicknamePreference(): string {
  try {
    return window.localStorage.getItem(NICKNAME_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveNicknamePreference(nickname: string): void {
  const value = nickname.trim();
  if (!value) return;
  try {
    window.localStorage.setItem(NICKNAME_STORAGE_KEY, value);
  } catch { /* 存储不可用时仍可正常进房。 */ }
}
