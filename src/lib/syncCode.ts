import { CONSTANTS } from './constants';

const CHARS = CONSTANTS.SYNC_CODE_CHARS;
const LEN = CONSTANTS.SYNC_CODE_LENGTH;

export function generateSyncCode(): string {
  const bytes = new Uint8Array(LEN);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < LEN; i++) {
    out += CHARS[bytes[i]! % CHARS.length];
  }
  return out;
}

export function formatSyncCode(code: string): string {
  const cleaned = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return cleaned.match(/.{1,4}/g)?.join('-') ?? cleaned;
}

export function normalizeSyncCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidSyncCode(code: string): boolean {
  if (code.length !== LEN) return false;
  for (const ch of code) {
    if (!CHARS.includes(ch)) return false;
  }
  return true;
}
