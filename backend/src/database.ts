import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import {
  calculateEntryImpact,
  compareLedgerDates,
  type CompanyRecord,
  type CurrencyOptionRecord,
  type CustomerRecord,
  type DeductionRecord,
  type EntryType,
  type LedgerEntryRecord,
  type MetalItemRecord,
  type PickupRecord,
  type UnitOptionRecord,
  type YardOptionRecord,
} from './accounting.ts';

const CANARY_PLAINTEXT = 'ADM-SQLCIPHER-AES256-VERIFIED-V1';
const SALT_NAMESPACE = 'accounts-dues-manager-usb-salt-v1';

export interface AuthStatus {
  isConfigured: boolean;
  hintQuestion: string;
  hintAnswer: string;
  hasRecoveryCodes?: boolean;
}

export interface AppState {
  version: string;
  currentCurrency: string;
  currencies: string[];
  language: string;
  yards: string[];
  defaultYard: string;
  customers: CustomerRecord[];
  authStatus: AuthStatus;
  dbStatus: {
    journalMode: string;
    encrypted: boolean;
    dataVersion?: number;
    lastSync: string;
  };
}

function deriveKey(passphrase: string): Buffer {
  return crypto.scryptSync(passphrase, SALT_NAMESPACE, 32);
}

export function encryptPayload(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptPayload(ciphertext: string, key: Buffer): string {
  try {
    const parts = ciphertext.split(':');
    if (parts.length !== 3) {
      throw new Error('Malformed encrypted payload');
    }
    const iv = Buffer.from(parts[0], 'base64');
    const authTag = Buffer.from(parts[1], 'base64');
    const encrypted = Buffer.from(parts[2], 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    const err = new Error('Invalid encryption key or corrupted ciphertext') as Error & {
      code?: string;
    };
    err.code = 'ERR_INVALID_ENCRYPTION_KEY';
    throw err;
  }
}

export function generateRecoveryCodes(count = 4): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(4).toString('hex').toUpperCase();
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}`);
  }
  return codes;
}

export interface EncryptedKeyPayload {
  iv: string;
  authTag: string;
  ciphertext: string;
}

export interface RecoveryKeyEnvelope {
  codeHash: string;
  salt: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

export interface MasterKeyEnvelope {
  version: number;
  isConfigured: boolean;
  kdf: 'scrypt';
  kdfParams: { N: number; r: number; p: number };
  passwordSalt: string;
  passwordWrappedKey: EncryptedKeyPayload;
  recoveryEnvelopes: RecoveryKeyEnvelope[];
  hintQuestion?: string;
  createdAt: string;
  updatedAt: string;
}

export function normalizeRecoveryCode(code: string): string {
  return (code || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export function deriveKeyFromPasscode(
  passcode: string,
  salt: Buffer | string,
  params: { N: number; r: number; p: number } = { N: 16384, r: 8, p: 1 }
): Buffer {
  const saltBuf = typeof salt === 'string' ? Buffer.from(salt, 'base64') : salt;
  return crypto.scryptSync(passcode, saltBuf, 32, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: 64 * 1024 * 1024,
  });
}

export function wrapMasterKeyWithPassword(
  masterKey: Buffer | string,
  passcode: string,
  salt?: Buffer | string
): { salt: string; wrapped: EncryptedKeyPayload } {
  const keyBuf =
    typeof masterKey === 'string'
      ? /^[0-9a-fA-F]{64}$/.test(masterKey)
        ? Buffer.from(masterKey, 'hex')
        : Buffer.from(masterKey, 'utf8')
      : masterKey;
  const saltBuf = salt
    ? typeof salt === 'string'
      ? Buffer.from(salt, 'base64')
      : salt
    : crypto.randomBytes(16);
  const kek = deriveKeyFromPasscode(passcode, saltBuf);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', kek, iv);
  const ciphertext = Buffer.concat([cipher.update(keyBuf), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    salt: saltBuf.toString('base64'),
    wrapped: {
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    },
  };
}

export function unwrapMasterKeyWithPassword(
  wrapped: EncryptedKeyPayload,
  passcode: string,
  salt: string,
  kdfParams: { N: number; r: number; p: number } = { N: 16384, r: 8, p: 1 }
): Buffer {
  try {
    const kek = deriveKeyFromPasscode(passcode, salt, kdfParams);
    const iv = Buffer.from(wrapped.iv, 'base64');
    const authTag = Buffer.from(wrapped.authTag, 'base64');
    const ciphertext = Buffer.from(wrapped.ciphertext, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', kek, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted;
  } catch {
    const err = new Error('Incorrect supervisor password') as Error & { code?: string };
    err.code = 'ERR_INCORRECT_PASSWORD';
    throw err;
  }
}

export function wrapMasterKeyWithRecoveryCode(
  masterKey: Buffer | string,
  recoveryCode: string
): RecoveryKeyEnvelope {
  const normalized = normalizeRecoveryCode(recoveryCode);
  const codeHash = crypto.createHash('sha256').update(normalized).digest('hex');
  const salt = crypto.randomBytes(16);
  const kek = deriveKeyFromPasscode(normalized, salt);
  const keyBuf =
    typeof masterKey === 'string'
      ? /^[0-9a-fA-F]{64}$/.test(masterKey)
        ? Buffer.from(masterKey, 'hex')
        : Buffer.from(masterKey, 'utf8')
      : masterKey;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', kek, iv);
  const ciphertext = Buffer.concat([cipher.update(keyBuf), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    codeHash,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export function unwrapMasterKeyWithRecoveryCode(
  envelopes: RecoveryKeyEnvelope[],
  recoveryCode: string
): { masterKey: Buffer; matchedIndex: number } {
  const normalized = normalizeRecoveryCode(recoveryCode);
  if (!normalized) {
    throw new Error('Invalid or already used recovery code');
  }
  const codeHash = crypto.createHash('sha256').update(normalized).digest('hex');
  const idx = envelopes.findIndex((env) => env.codeHash === codeHash);
  if (idx === -1) {
    throw new Error('Invalid or already used recovery code');
  }
  const env = envelopes[idx];
  try {
    const kek = deriveKeyFromPasscode(normalized, env.salt);
    const iv = Buffer.from(env.iv, 'base64');
    const authTag = Buffer.from(env.authTag, 'base64');
    const ciphertext = Buffer.from(env.ciphertext, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', kek, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return { masterKey: decrypted, matchedIndex: idx };
  } catch {
    throw new Error('Invalid or already used recovery code');
  }
}

export function createKeyEnvelope(
  masterKey: Buffer | string,
  passcode: string,
  recoveryCodes: string[] = [],
  hintQuestion?: string
): MasterKeyEnvelope {
  const { salt, wrapped } = wrapMasterKeyWithPassword(masterKey, passcode);
  const recoveryEnvelopes = recoveryCodes.map((code) =>
    wrapMasterKeyWithRecoveryCode(masterKey, code)
  );
  const now = new Date().toISOString();
  return {
    version: 1,
    isConfigured: true,
    kdf: 'scrypt',
    kdfParams: { N: 16384, r: 8, p: 1 },
    passwordSalt: salt,
    passwordWrappedKey: wrapped,
    recoveryEnvelopes,
    hintQuestion: hintQuestion || '',
    createdAt: now,
    updatedAt: now,
  };
}

export function saveKeyEnvelope(filePath: string, envelope: MasterKeyEnvelope): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(envelope, null, 2), { mode: 0o600 });
}

export function loadKeyEnvelope(filePath: string): MasterKeyEnvelope | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 1) {
      return parsed as MasterKeyEnvelope;
    }
    return null;
  } catch {
    return null;
  }
}

interface LockoutState {
  failedCount: number;
  lockoutUntil: number;
}
const lockoutMap = new Map<string, LockoutState>();
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 5 * 60 * 1000; // 5 minutes

export function getAuthLockoutStatus(rootDir?: string): { locked: boolean; remainingSeconds: number } {
  const key = rootDir || 'default';
  const state = lockoutMap.get(key);
  if (!state) return { locked: false, remainingSeconds: 0 };
  const now = Date.now();
  if (now < state.lockoutUntil) {
    const remainingSeconds = Math.ceil((state.lockoutUntil - now) / 1000);
    return { locked: true, remainingSeconds };
  }
  if (state.lockoutUntil > 0 && now >= state.lockoutUntil) {
    lockoutMap.delete(key);
  }
  return { locked: false, remainingSeconds: 0 };
}

export function recordFailedUnlockAttempt(rootDir?: string): {
  locked: boolean;
  remainingSeconds: number;
  attemptsRemaining: number;
} {
  const key = rootDir || 'default';
  const state = lockoutMap.get(key) || { failedCount: 0, lockoutUntil: 0 };
  state.failedCount++;
  if (state.failedCount >= MAX_FAILED_ATTEMPTS) {
    state.lockoutUntil = Date.now() + LOCKOUT_DURATION_MS;
    lockoutMap.set(key, state);
    return {
      locked: true,
      remainingSeconds: Math.ceil(LOCKOUT_DURATION_MS / 1000),
      attemptsRemaining: 0,
    };
  }
  lockoutMap.set(key, state);
  return {
    locked: false,
    remainingSeconds: 0,
    attemptsRemaining: MAX_FAILED_ATTEMPTS - state.failedCount,
  };
}

export function resetFailedUnlockAttempts(rootDir?: string): void {
  const key = rootDir || 'default';
  lockoutMap.delete(key);
}

export const TWELVE_HOURS_SECONDS = 12 * 60 * 60; // 43,200 seconds
export const TWELVE_HOURS_MS = TWELVE_HOURS_SECONDS * 1000; // 43,200,000 ms

export interface BrowserSession {
  token: string;
  createdAt: number;
  expiresAt: number;
  masterKeyHex?: string;
  rootDir?: string;
}

const browserSessions = new Map<string, BrowserSession>();

export function createBrowserSession(
  masterKeyHex?: string,
  rootDir?: string,
  durationMs = TWELVE_HOURS_MS
): BrowserSession {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const session: BrowserSession = {
    token,
    createdAt: now,
    expiresAt: now + durationMs,
    masterKeyHex: masterKeyHex || sessionMasterKey || undefined,
    rootDir,
  };
  browserSessions.set(token, session);
  return session;
}

export function validateBrowserSession(
  token: string | null | undefined,
  rootDir?: string
): { valid: boolean; session?: BrowserSession; reason?: string } {
  if (!token) {
    return { valid: false, reason: 'missing_token' };
  }
  const session = browserSessions.get(token);
  if (!session) {
    return { valid: false, reason: 'not_found' };
  }
  if (Date.now() >= session.expiresAt) {
    browserSessions.delete(token);
    return { valid: false, reason: 'expired' };
  }
  if (session.masterKeyHex && !sessionMasterKey) {
    sessionMasterKey = session.masterKeyHex;
  }
  return { valid: true, session };
}

export function destroyBrowserSession(token: string | null | undefined): void {
  if (token) {
    browserSessions.delete(token);
  }
}

export function clearAllBrowserSessions(): void {
  browserSessions.clear();
}

export function expireBrowserSessionForTesting(token: string): void {
  const session = browserSessions.get(token);
  if (session) {
    session.expiresAt = Date.now() - 1000;
  }
}

export function extractSessionTokenFromHeaders(
  headers?: Record<string, string | string[] | undefined> | Headers
): string | null {
  if (!headers) return null;

  let cookieHeader: string | undefined;
  if ('get' in headers && typeof (headers as Headers).get === 'function') {
    cookieHeader = (headers as Headers).get('cookie') || undefined;
  } else {
    const raw =
      (headers as Record<string, string | string[] | undefined>)['cookie'] ||
      (headers as Record<string, string | string[] | undefined>)['Cookie'];
    cookieHeader = Array.isArray(raw) ? raw.join('; ') : raw;
  }

  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)adm_session_token=([^;]+)/);
    if (match && match[1]) {
      return decodeURIComponent(match[1].trim());
    }
  }

  let authHeader: string | undefined;
  if ('get' in headers && typeof (headers as Headers).get === 'function') {
    authHeader = (headers as Headers).get('authorization') || undefined;
  } else {
    const raw =
      (headers as Record<string, string | string[] | undefined>)['authorization'] ||
      (headers as Record<string, string | string[] | undefined>)['Authorization'];
    authHeader = Array.isArray(raw) ? raw[0] : raw;
  }

  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }

  let xHeader: string | undefined;
  if ('get' in headers && typeof (headers as Headers).get === 'function') {
    xHeader = (headers as Headers).get('x-session-token') || undefined;
  } else {
    const raw =
      (headers as Record<string, string | string[] | undefined>)['x-session-token'] ||
      (headers as Record<string, string | string[] | undefined>)['X-Session-Token'];
    xHeader = Array.isArray(raw) ? raw[0] : raw;
  }

  if (xHeader) {
    return xHeader.trim();
  }

  return null;
}

export function buildSessionCookieHeader(token: string, maxAge = TWELVE_HOURS_SECONDS): string {
  return `adm_session_token=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; SameSite=Strict; HttpOnly`;
}

export function buildClearSessionCookieHeader(): string {
  return 'adm_session_token=; Path=/; Max-Age=0; SameSite=Strict; HttpOnly';
}

let sessionMasterKey: string | null = null;

export function setSessionMasterKey(key: string | null): void {
  sessionMasterKey = key;
}

export function getSessionMasterKey(): string | null {
  return sessionMasterKey;
}

export function clearSessionMasterKey(): void {
  sessionMasterKey = null;
  if (activeInstance) {
    try {
      activeInstance.close();
    } catch {}
    activeInstance = null;
  }
}

export function isDatabaseLocked(rootDir?: string): boolean {
  if (sessionMasterKey) return false;
  if (process.env.ADM_ENCRYPTION_KEY) return false;
  const { envelopeFile } = resolvePortablePaths(rootDir);
  const envelope = loadKeyEnvelope(envelopeFile);
  return Boolean(envelope && envelope.isConfigured);
}

export function unlockWithPasscode(
  passcode: string,
  rootDir?: string
): {
  ok: boolean;
  error?: string;
  attemptsRemaining?: number;
  lockout?: boolean;
  remainingSeconds?: number;
} {
  const lockout = getAuthLockoutStatus(rootDir);
  if (lockout.locked) {
    return {
      ok: false,
      error: `Too many failed attempts. Security lockout active. Please wait ${lockout.remainingSeconds} seconds.`,
      lockout: true,
      remainingSeconds: lockout.remainingSeconds,
    };
  }

  const { envelopeFile } = resolvePortablePaths(rootDir);
  const envelope = loadKeyEnvelope(envelopeFile);
  if (!envelope || !envelope.isConfigured) {
    return { ok: true };
  }

  try {
    const masterKeyBuf = unwrapMasterKeyWithPassword(
      envelope.passwordWrappedKey,
      passcode,
      envelope.passwordSalt,
      envelope.kdfParams
    );
    resetFailedUnlockAttempts(rootDir);
    const keyHex = masterKeyBuf.toString('hex');
    setSessionMasterKey(keyHex);
    try {
      const activeDb = getLedgerDatabase(rootDir);
      if (activeDb.getAppState().authStatus.isConfigured === false) {
        activeDb.runInTransaction(() => {
          (activeDb as unknown as { setMetaEncrypted: (k: string, v: string) => void }).setMetaEncrypted('passcodeConfigured', 'true');
          (activeDb as unknown as { setMetaEncrypted: (k: string, v: string) => void }).setMetaEncrypted('passcode', passcode);
          if (envelope.hintQuestion) {
            (activeDb as unknown as { setMetaEncrypted: (k: string, v: string) => void }).setMetaEncrypted('hintQuestion', envelope.hintQuestion);
          }
        });
      }
    } catch {}
    return { ok: true };
  } catch {
    const failed = recordFailedUnlockAttempt(rootDir);
    if (failed.locked) {
      return {
        ok: false,
        error: `Too many failed attempts. System locked for ${failed.remainingSeconds} seconds.`,
        lockout: true,
        remainingSeconds: failed.remainingSeconds,
        attemptsRemaining: 0,
      };
    }
    return {
      ok: false,
      error: 'Incorrect supervisor password',
      attemptsRemaining: failed.attemptsRemaining,
    };
  }
}

export function unlockWithRecoveryCode(
  recoveryCode: string,
  newPasscode: string,
  confirmPasscode?: string,
  rootDir?: string
): {
  ok: boolean;
  remainingRecoveryCodes?: string[];
  newCode?: string;
  error?: string;
} {
  const cleanNewPass = (newPasscode || '').trim();
  if (!cleanNewPass) {
    return { ok: false, error: 'New password cannot be empty' };
  }
  if (confirmPasscode !== undefined && cleanNewPass !== confirmPasscode.trim()) {
    return { ok: false, error: 'Passwords do not match' };
  }

  const { envelopeFile, keyFile } = resolvePortablePaths(rootDir);
  const envelope = loadKeyEnvelope(envelopeFile);
  if (!envelope || !envelope.isConfigured) {
    return { ok: false, error: 'Key envelope is not configured' };
  }

  try {
    const { masterKey, matchedIndex } = unwrapMasterKeyWithRecoveryCode(
      envelope.recoveryEnvelopes,
      recoveryCode
    );

    const replacementCode = generateRecoveryCodes(1)[0];
    const newRecEnvelope = wrapMasterKeyWithRecoveryCode(masterKey, replacementCode);
    envelope.recoveryEnvelopes.splice(matchedIndex, 1, newRecEnvelope);

    const { salt, wrapped } = wrapMasterKeyWithPassword(masterKey, cleanNewPass);
    envelope.passwordSalt = salt;
    envelope.passwordWrappedKey = wrapped;
    envelope.updatedAt = new Date().toISOString();
    saveKeyEnvelope(envelopeFile, envelope);

    if (fs.existsSync(keyFile)) {
      try {
        fs.unlinkSync(keyFile);
      } catch {}
    }

    resetFailedUnlockAttempts(rootDir);
    const keyHex = masterKey.toString('hex');
    setSessionMasterKey(keyHex);

    try {
      const activeDb = getLedgerDatabase(rootDir);
      activeDb.runInTransaction(() => {
        (activeDb as unknown as { setMetaEncrypted: (k: string, v: string) => void }).setMetaEncrypted('passcodeConfigured', 'true');
        (activeDb as unknown as { setMetaEncrypted: (k: string, v: string) => void }).setMetaEncrypted('passcode', cleanNewPass);
      });
    } catch {}

    return {
      ok: true,
      newCode: replacementCode,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Invalid or already used recovery code',
    };
  }
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function encodeXmlEntities(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function colLettersToIndex(letters: string): number {
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return idx - 1;
}

export function extractZipEntries(zipBuf: Buffer): Map<string, string> {
  const files = new Map<string, string>();

  // Locate End of Central Directory (EOCD) signature 0x06054b50 from end of buffer
  let eocdOffset = -1;
  for (let i = zipBuf.length - 22; i >= 0; i--) {
    if (zipBuf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset !== -1) {
    const totalEntries = zipBuf.readUInt16LE(eocdOffset + 10);
    let cdOffset = zipBuf.readUInt32LE(eocdOffset + 16);

    for (let e = 0; e < totalEntries && cdOffset < zipBuf.length; e++) {
      if (zipBuf.readUInt32LE(cdOffset) !== 0x02014b50) break;
      const compressionMethod = zipBuf.readUInt16LE(cdOffset + 10);
      const compressedSize = zipBuf.readUInt32LE(cdOffset + 20);
      const fileNameLen = zipBuf.readUInt16LE(cdOffset + 28);
      const extraLen = zipBuf.readUInt16LE(cdOffset + 30);
      const commentLen = zipBuf.readUInt16LE(cdOffset + 32);
      const localHeaderOffset = zipBuf.readUInt32LE(cdOffset + 42);
      const fileName = zipBuf.toString('utf8', cdOffset + 46, cdOffset + 46 + fileNameLen);

      if (localHeaderOffset + 30 <= zipBuf.length && zipBuf.readUInt32LE(localHeaderOffset) === 0x04034b50) {
        const localNameLen = zipBuf.readUInt16LE(localHeaderOffset + 26);
        const localExtraLen = zipBuf.readUInt16LE(localHeaderOffset + 28);
        const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
        const rawSlice = zipBuf.subarray(dataStart, dataStart + compressedSize);
        if (compressionMethod === 0) {
          files.set(fileName, rawSlice.toString('utf8'));
        } else if (compressionMethod === 8) {
          files.set(fileName, zlib.inflateRawSync(rawSlice).toString('utf8'));
        }
      }

      cdOffset += 46 + fileNameLen + extraLen + commentLen;
    }
    return files;
  }

  // Fallback: scan local file headers sequentially
  let offset = 0;
  while (offset + 30 <= zipBuf.length) {
    if (zipBuf.readUInt32LE(offset) !== 0x04034b50) break;
    const compressionMethod = zipBuf.readUInt16LE(offset + 8);
    const compressedSize = zipBuf.readUInt32LE(offset + 18);
    const fileNameLen = zipBuf.readUInt16LE(offset + 26);
    const extraLen = zipBuf.readUInt16LE(offset + 28);
    const fileName = zipBuf.toString('utf8', offset + 30, offset + 30 + fileNameLen);
    const dataStart = offset + 30 + fileNameLen + extraLen;
    const rawSlice = zipBuf.subarray(dataStart, dataStart + compressedSize);
    if (compressionMethod === 0) {
      files.set(fileName, rawSlice.toString('utf8'));
    } else if (compressionMethod === 8) {
      files.set(fileName, zlib.inflateRawSync(rawSlice).toString('utf8'));
    }
    offset = dataStart + compressedSize;
  }
  return files;
}

export function parseXlsxBuffer(zipBuf: Buffer): string[][] {
  const entries = extractZipEntries(zipBuf);
  const sharedStrings: string[] = [];

  const ssXml = entries.get('xl/sharedStrings.xml');
  if (ssXml) {
    const siMatches = ssXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g);
    for (const m of siMatches) {
      const tMatches = m[1].matchAll(/<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/g);
      let text = '';
      for (const tm of tMatches) {
        text += decodeXmlEntities(tm[1]);
      }
      sharedStrings.push(text);
    }
  }

  // Find first worksheet
  let sheetXml = entries.get('xl/worksheets/sheet1.xml');
  if (!sheetXml) {
    for (const [k, v] of entries.entries()) {
      if (k.startsWith('xl/worksheets/sheet') && k.endsWith('.xml')) {
        sheetXml = v;
        break;
      }
    }
  }
  if (!sheetXml) return [];

  const rows: string[][] = [];
  const rowMatches = sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g);
  for (const rm of rowMatches) {
    const rowCells: string[] = [];
    let nextColIdx = 0;
    const cellMatches = rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g);
    for (const cm of cellMatches) {
      const attrs = cm[1];
      const inner = cm[2] || '';
      const refMatch = attrs.match(/\br="([A-Z]+)\d+"/);
      const colIdx = refMatch ? colLettersToIndex(refMatch[1]) : nextColIdx;
      const typeMatch = attrs.match(/\bt="([^"]+)"/);
      const cellType = typeMatch ? typeMatch[1] : '';

      let val = '';
      if (cellType === 'inlineStr') {
        const tMatch = inner.match(/<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/);
        val = tMatch ? decodeXmlEntities(tMatch[1]) : '';
      } else {
        const vMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
        const rawV = vMatch ? vMatch[1].trim() : '';
        if (cellType === 's') {
          const ssIdx = parseInt(rawV, 10);
          val = sharedStrings[ssIdx] ?? '';
        } else {
          val = decodeXmlEntities(rawV);
        }
      }

      while (rowCells.length < colIdx) {
        rowCells.push('');
      }
      rowCells[colIdx] = val;
      nextColIdx = colIdx + 1;
    }
    if (rowCells.some((c) => c.trim().length > 0)) {
      rows.push(rowCells);
    }
  }
  return rows;
}

function createZipFromEntries(entries: Record<string, string | Buffer>): Buffer {
  const localHeaders: Buffer[] = [];
  const cdHeaders: Buffer[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const dataBuf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const compressed = zlib.deflateRawSync(dataBuf);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(8, 8); // deflate
    lh.writeUInt32LE(compressed.length, 18);
    lh.writeUInt32LE(dataBuf.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0, 8);
    cdh.writeUInt16LE(8, 10);
    cdh.writeUInt32LE(compressed.length, 20);
    cdh.writeUInt32LE(dataBuf.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30);
    cdh.writeUInt16LE(0, 32);
    cdh.writeUInt16LE(0, 34);
    cdh.writeUInt16LE(0, 36);
    cdh.writeUInt32LE(0, 38);
    cdh.writeUInt32LE(offset, 42);

    localHeaders.push(lh, nameBuf, compressed);
    cdHeaders.push(cdh, nameBuf);
    offset += 30 + nameBuf.length + compressed.length;
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const b of cdHeaders) cdSize += b.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, ...cdHeaders, eocd]);
}

export function excelSerialToDate(val: unknown, fallbackDate: string): string {
  if (val === undefined || val === null || val === '') return fallbackDate;
  const num = typeof val === 'number' ? val : parseFloat(String(val).trim());
  if (!Number.isNaN(num) && num > 10000 && num < 80000) {
    const utcDays = Math.floor(num - 25569);
    const dateObj = new Date(utcDays * 86400 * 1000);
    return dateObj.toISOString().slice(0, 10);
  }
  const str = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(str)) {
    const d = new Date(str);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return fallbackDate;
}

export function parseXlsxCustomerAccounts(
  zipBuf: Buffer,
  fallbackYard: string = 'North Yard'
): CustomerRecord[] {
  const entries = extractZipEntries(zipBuf);
  const sharedStrings: string[] = [];

  const ssXml = entries.get('xl/sharedStrings.xml');
  if (ssXml) {
    const siMatches = ssXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g);
    for (const m of siMatches) {
      const tMatches = m[1].matchAll(/<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/g);
      let text = '';
      for (const tm of tMatches) {
        text += decodeXmlEntities(tm[1]);
      }
      sharedStrings.push(text);
    }
  }

  const wbXml = entries.get('xl/workbook.xml');
  if (!wbXml) return [];

  // Parse workbook relationships if present
  const relMap = new Map<string, string>();
  const relsXml = entries.get('xl/_rels/workbook.xml.rels');
  if (relsXml) {
    const relMatches = relsXml.matchAll(/<Relationship\b([^>]*)\/?>/g);
    for (const rm of relMatches) {
      const attrs = rm[1];
      const idM = attrs.match(/\bId="([^"]+)"/);
      const targetM = attrs.match(/\bTarget="([^"]+)"/);
      if (idM && targetM) {
        const targetClean = targetM[1].replace(/^\/?xl\//, '').replace(/^worksheets\//, '');
        relMap.set(idM[1], targetClean);
      }
    }
  }

  // Parse sheets
  interface SheetMeta {
    name: string;
    target: string;
  }
  const sheetMetas: SheetMeta[] = [];
  const sheetMatches = wbXml.matchAll(/<sheet\b([^>]*)\/?>/g);
  for (const sm of sheetMatches) {
    const attrs = sm[1];
    const nameM = attrs.match(/\bname="([^"]+)"/);
    const idM = attrs.match(/\bsheetId="([^"]+)"/);
    const rIdM = attrs.match(/\br:id="([^"]+)"/);
    if (nameM) {
      const sheetName = decodeXmlEntities(nameM[1]).trim();
      const rId = rIdM ? rIdM[1] : '';
      const sheetId = idM ? idM[1] : String(sheetMetas.length + 1);
      const target = (rId ? relMap.get(rId) : null) || `sheet${sheetId}.xml`;
      sheetMetas.push({ name: sheetName, target });
    }
  }

  if (sheetMetas.length === 0) return [];

  const customers: CustomerRecord[] = [];
  let seq = 1001;

  for (const meta of sheetMetas) {
    const isTemplateName = meta.name.toLowerCase() === 'template';

    const sheetPath = `xl/worksheets/${meta.target}`;
    let sheetXml = entries.get(sheetPath);
    if (!sheetXml) {
      for (const [k, v] of entries.entries()) {
        if (k.endsWith(meta.target)) {
          sheetXml = v;
          break;
        }
      }
    }
    if (!sheetXml) continue;

    // Parse cells into rows: rowNum -> { colIndex -> value }
    const rowMap = new Map<number, Map<number, string>>();
    const rowMatches = sheetXml.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g);
    for (const rm of rowMatches) {
      const rowNum = parseInt(rm[1], 10);
      const colMap = new Map<number, string>();
      const cellMatches = rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g);
      for (const cm of cellMatches) {
        const attrs = cm[1];
        const inner = cm[2] || '';
        const refMatch = attrs.match(/\br="([A-Z]+)\d+"/);
        if (!refMatch) continue;
        const colIdx = colLettersToIndex(refMatch[1]);
        const typeMatch = attrs.match(/\bt="([^"]+)"/);
        const cellType = typeMatch ? typeMatch[1] : '';

        let val = '';
        if (cellType === 'inlineStr') {
          const tMatch = inner.match(/<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/);
          val = tMatch ? decodeXmlEntities(tMatch[1]) : '';
        } else {
          const vMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
          const rawV = vMatch ? vMatch[1].trim() : '';
          if (cellType === 's') {
            const ssIdx = parseInt(rawV, 10);
            val = sharedStrings[ssIdx] ?? '';
          } else {
            val = decodeXmlEntities(rawV);
          }
        }
        colMap.set(colIdx, val);
      }
      rowMap.set(rowNum, colMap);
    }

    let dateCol = 0;
    let totalCol = 1;
    let paidCol = 3;
    let notesCol = 4;

    const row1 = rowMap.get(1);
    if (row1) {
      for (const [colIdx, rawVal] of row1.entries()) {
        const lower = rawVal.toLowerCase().trim();
        if (lower.includes('date')) {
          dateCol = colIdx;
        } else if (
          lower === 'total' ||
          lower.includes('unpaid') ||
          lower.includes('invoice') ||
          lower.includes('need to pay')
        ) {
          totalCol = colIdx;
        } else if (lower === 'paid' && !lower.includes('type')) {
          paidCol = colIdx;
        } else if (lower.includes('note') || lower.includes('memo') || lower.includes('ref')) {
          notesCol = colIdx;
        }
      }
    }

    const ledgerEntries: LedgerEntryRecord[] = [];
    const sortedRowNums = Array.from(rowMap.keys()).sort((a, b) => a - b);
    let runningBal = 0;
    let previousDate = new Date().toISOString().slice(0, 10);
    let customerNote = '';

    for (const rNum of sortedRowNums) {
      if (rNum === 1) continue; // Skip header
      const row = rowMap.get(rNum);
      if (!row) continue;

      const rawDate = row.get(dateCol) ?? '';
      const rawTotal = row.get(totalCol) ?? '';
      const rawPaid = row.get(paidCol) ?? '';
      const rawNotes = row.get(notesCol) ?? '';

      const totalNum = Math.round((parseFloat(String(rawTotal).replace(/[^0-9.-]/g, '')) || 0) * 100) / 100;
      const paidNum = Math.round((parseFloat(String(rawPaid).replace(/[^0-9.-]/g, '')) || 0) * 100) / 100;
      const notesClean = String(rawNotes || '').trim();
      const hasDate = Boolean(rawDate && String(rawDate).trim());

      if (totalNum === 0 && paidNum === 0 && !notesClean && !hasDate) {
        continue;
      }

      if (hasDate) {
        previousDate = excelSerialToDate(rawDate, previousDate);
      }
      const entryDate = previousDate;

      if (!customerNote && notesClean) {
        customerNote = notesClean;
      }

      runningBal = Math.round((runningBal + totalNum - paidNum) * 100) / 100;

      ledgerEntries.push({
        date: entryDate,
        invoice: totalNum,
        paid: paidNum,
        method: paidNum > 0 ? 'Cash' : (totalNum > 0 ? 'Unpaid Due' : 'Cash'),
        yard: fallbackYard,
        memo:
          notesClean ||
          (paidNum > 0 ? 'Cash paid to customer' : (totalNum > 0 ? 'Unpaid amount added' : '')),
        runningBalance: runningBal,
        currency: 'USD ($)',
      });
    }

    if (isTemplateName && ledgerEntries.length === 0 && runningBal === 0) {
      continue;
    }

    const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
    if (ledgerEntries.length === 0) {
      ledgerEntries.push({
        date: now.slice(0, 10),
        invoice: 0,
        paid: 0,
        method: 'Unpaid Due',
        yard: fallbackYard,
        memo: 'Opening balance',
        runningBalance: 0,
        currency: 'USD ($)',
      });
    }

    const lastDate = ledgerEntries[ledgerEntries.length - 1]?.date || now;
    const lastUpdate = lastDate.length === 10 ? `${lastDate} 00:00` : lastDate;

    customers.push({
      id: `CUST-${seq++}`,
      name: meta.name,
      defaultYard: fallbackYard,
      balance: runningBal,
      lastUpdate,
      phone: customerNote,
      notes: customerNote,
      ledger: ledgerEntries,
    });
  }

  return customers;
}

export function parseCsvRows(csvText: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let insideQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];
    const nextCh = csvText[i + 1];

    if (insideQuotes) {
      if (ch === '"') {
        if (nextCh === '"') {
          currentCell += '"';
          i++;
        } else {
          insideQuotes = false;
        }
      } else {
        currentCell += ch;
      }
    } else {
      if (ch === '"') {
        insideQuotes = true;
      } else if (ch === ',') {
        currentRow.push(currentCell.trim());
        currentCell = '';
      } else if (ch === '\n') {
        currentRow.push(currentCell.trim());
        rows.push(currentRow);
        currentRow = [];
        currentCell = '';
      } else if (ch === '\r') {
        // Skip carriage return
      } else {
        currentCell += ch;
      }
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    rows.push(currentRow);
  }

  return rows.filter((r) => r.some((cell) => cell.length > 0));
}

export function parseCsvCustomerAccounts(
  csvText: string,
  fallbackYard: string = 'North Yard',
  defaultCustomerName?: string
): CustomerRecord[] {
  const rows = parseCsvRows(csvText);
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => (h || '').trim().toLowerCase());
  const custCol = header.findIndex(
    (h) => h === 'customer' || h === 'name' || (h.includes('customer') && !h.includes('id')) || h.includes('client')
  );
  const dateCol = header.findIndex((h) => h.includes('date'));
  const totalCol = header.findIndex(
    (h) => h === 'total' || h.includes('unpaid') || h.includes('invoice') || h.includes('need to pay')
  );
  const paidTypeCol = header.findIndex(
    (h) => h.includes('paid type') || h.includes('payment type') || h.includes('pay type')
  );
  const paidCol = header.findIndex(
    (h, idx) => idx !== paidTypeCol && (h === 'paid' || h.includes('paid') || h.includes('payment'))
  );
  const notesCol = header.findIndex(
    (h) => h.includes('note') || h.includes('memo') || h.includes('ref') || h.includes('comment')
  );

  const customerRowsMap = new Map<string, string[][]>();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0 || row.every((c) => !c.trim())) continue;
    let name = '';
    if (custCol !== -1 && row[custCol]) {
      name = row[custCol].trim();
    } else if (defaultCustomerName) {
      name = defaultCustomerName.trim();
    }
    if (!name) continue;

    if (!customerRowsMap.has(name)) {
      customerRowsMap.set(name, []);
    }
    customerRowsMap.get(name)!.push(row);
  }

  const customers: CustomerRecord[] = [];
  let seq = 1001;

  for (const [custName, cRows] of customerRowsMap.entries()) {
    let runningBal = 0;
    let previousDate = new Date().toISOString().slice(0, 10);
    let customerNote = '';
    const ledgerEntries: LedgerEntryRecord[] = [];

    for (const row of cRows) {
      const rawDate = dateCol !== -1 ? row[dateCol] ?? '' : '';
      const rawTotal = totalCol !== -1 ? row[totalCol] ?? '' : '';
      const rawPaid = paidCol !== -1 ? row[paidCol] ?? '' : '';
      const rawNotes = notesCol !== -1 ? row[notesCol] ?? '' : '';

      const totalNum = Math.round((parseFloat(String(rawTotal).replace(/[^0-9.-]/g, '')) || 0) * 100) / 100;
      const paidNum = Math.round((parseFloat(String(rawPaid).replace(/[^0-9.-]/g, '')) || 0) * 100) / 100;
      const notesClean = String(rawNotes || '').trim();
      const hasDate = Boolean(rawDate && String(rawDate).trim());

      if (cRows.length > 1 && totalNum === 0 && paidNum === 0 && !notesClean && !hasDate) {
        continue;
      }

      if (hasDate) {
        previousDate = excelSerialToDate(rawDate, previousDate);
      }
      const entryDate = previousDate;

      if (!customerNote && notesClean) {
        customerNote = notesClean;
      }

      runningBal = Math.round((runningBal + totalNum - paidNum) * 100) / 100;

      ledgerEntries.push({
        date: entryDate,
        invoice: totalNum,
        paid: paidNum,
        method: paidNum > 0 ? 'Cash' : (totalNum > 0 ? 'Unpaid Due' : 'Cash'),
        yard: fallbackYard,
        memo:
          notesClean ||
          (paidNum > 0 ? 'Cash paid to customer' : (totalNum > 0 ? 'Unpaid amount added' : 'Opening balance')),
        runningBalance: runningBal,
        currency: 'USD ($)',
      });
    }

    const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
    if (ledgerEntries.length === 0) {
      ledgerEntries.push({
        date: now.slice(0, 10),
        invoice: 0,
        paid: 0,
        method: 'Unpaid Due',
        yard: fallbackYard,
        memo: 'Opening balance',
        runningBalance: 0,
        currency: 'USD ($)',
      });
    }

    const lastDate = ledgerEntries[ledgerEntries.length - 1]?.date || now;
    const lastUpdate = lastDate.length === 10 ? `${lastDate} 00:00` : lastDate;
    const customerId = `CUST-${seq++}`;

    customers.push({
      id: customerId,
      name: custName,
      defaultYard: fallbackYard,
      balance: runningBal,
      lastUpdate,
      phone: customerNote,
      notes: customerNote,
      ledger: ledgerEntries,
    });
  }

  return customers;
}

function unescapePgCopyField(val: string): string | null {
  if (val === '\\N') return null;
  return val
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\');
}

function parseSqlValueTokens(tupleBody: string): Array<string | null> {
  const values: Array<string | null> = [];
  let i = 0;
  const n = tupleBody.length;

  while (i < n) {
    while (i < n && /\s/.test(tupleBody[i])) i++;
    if (i >= n) break;

    if (tupleBody[i] === "'") {
      i++;
      let strVal = '';
      while (i < n) {
        if (tupleBody[i] === "'" && tupleBody[i + 1] === "'") {
          strVal += "'";
          i += 2;
        } else if (tupleBody[i] === '\\' && i + 1 < n) {
          const next = tupleBody[i + 1];
          if (next === 'n') strVal += '\n';
          else if (next === 'r') strVal += '\r';
          else if (next === 't') strVal += '\t';
          else strVal += next;
          i += 2;
        } else if (tupleBody[i] === "'") {
          i++;
          break;
        } else {
          strVal += tupleBody[i++];
        }
      }
      values.push(strVal);
      while (i < n && tupleBody[i] !== ',') i++;
      if (tupleBody[i] === ',') i++;
    } else {
      const start = i;
      while (i < n && tupleBody[i] !== ',') i++;
      const rawToken = tupleBody.slice(start, i).trim();
      if (tupleBody[i] === ',') i++;
      if (rawToken.toUpperCase() === 'NULL') {
        values.push(null);
      } else {
        values.push(rawToken);
      }
    }
  }
  return values;
}

export function isSqlDumpContent(content: string, fileName?: string): boolean {
  if (fileName && fileName.toLowerCase().endsWith('.sql')) {
    return true;
  }
  const head = content.slice(0, 4000);
  return (
    /COPY\s+(?:public\.)?[a-zA-Z0-9_]+\s*\(/i.test(head) ||
    /INSERT\s+INTO\s+(?:public\.)?[a-zA-Z0-9_]+/i.test(head) ||
    head.includes('PostgreSQL database dump') ||
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?[a-zA-Z0-9_]+/i.test(head)
  );
}

export function parseSqlDumpDataset(sqlText: string): {
  companies: CompanyRecord[];
  pickups: PickupRecord[];
  deductions: DeductionRecord[];
  yards: YardOptionRecord[];
  currencies: CurrencyOptionRecord[];
  units: UnitOptionRecord[];
} {
  const tableRows: Record<string, Array<Record<string, string | null>>> = {
    companies: [],
    pickups: [],
    metal_items: [],
    deductions: [],
    yard_options: [],
    currency_options: [],
    unit_options: [],
  };

  const normalizeTableName = (rawName: string): string => {
    const clean = rawName
      .replace(/^public\./i, '')
      .replace(/["`]/g, '')
      .trim()
      .toLowerCase();
    if (clean === 'yards') return 'yard_options';
    if (clean === 'currencies') return 'currency_options';
    if (clean === 'units') return 'unit_options';
    return clean;
  };

  // 1. Parse PostgreSQL COPY blocks: COPY public.<table> (<cols>) FROM stdin; ... \.
  const copyRegex = /COPY\s+([^\s(]+)\s*\(([^)]+)\)\s+FROM\s+stdin\s*;([\s\S]*?)^\s*\\?\.\s*$/gim;
  let copyMatch: RegExpExecArray | null;
  while ((copyMatch = copyRegex.exec(sqlText)) !== null) {
    const tableName = normalizeTableName(copyMatch[1]);
    if (!tableRows[tableName]) continue;
    const cols = copyMatch[2].split(',').map((c) => c.replace(/["`]/g, '').trim().toLowerCase());
    const bodyLines = copyMatch[3].split(/\r?\n/);
    for (const line of bodyLines) {
      if (!line || !line.trim()) continue;
      const parts = line.split('\t');
      const rowObj: Record<string, string | null> = {};
      cols.forEach((col, idx) => {
        rowObj[col] = idx < parts.length ? unescapePgCopyField(parts[idx]) : null;
      });
      tableRows[tableName].push(rowObj);
    }
  }

  // 2. Parse SQL INSERT INTO statements: INSERT INTO [public.]<table> [(<cols>)] VALUES (...), (...);
  const insertRegex = /INSERT\s+INTO\s+([^\s(]+)\s*(?:\(([^)]+)\))?\s*VALUES\s*([\s\S]*?);/gi;
  let insertMatch: RegExpExecArray | null;
  const defaultColsByTable: Record<string, string[]> = {
    companies: ['id', 'name'],
    pickups: ['id', 'company_id', 'date', 'yard', 'notes', 'deduction', 'total_amount', 'currency'],
    metal_items: ['id', 'pickup_id', 'metal_name', 'net_weight', 'price_per_unit', 'total', 'weight_unit'],
    deductions: ['id', 'company_id', 'date', 'amount', 'notes', 'currency'],
    yard_options: ['id', 'name'],
    currency_options: ['id', 'code', 'symbol', 'label'],
    unit_options: ['id', 'value', 'label'],
  };

  while ((insertMatch = insertRegex.exec(sqlText)) !== null) {
    const tableName = normalizeTableName(insertMatch[1]);
    if (!tableRows[tableName]) continue;
    const cols = insertMatch[2]
      ? insertMatch[2].split(',').map((c) => c.replace(/["`]/g, '').trim().toLowerCase())
      : defaultColsByTable[tableName] || [];
    const valuesSection = insertMatch[3];
    const tupleRegex = /\(([^()]*)\)/g;
    let tupleMatch: RegExpExecArray | null;
    while ((tupleMatch = tupleRegex.exec(valuesSection)) !== null) {
      const vals = parseSqlValueTokens(tupleMatch[1]);
      if (vals.length === 0) continue;
      const rowObj: Record<string, string | null> = {};
      cols.forEach((col, idx) => {
        rowObj[col] = idx < vals.length ? vals[idx] : null;
      });
      tableRows[tableName].push(rowObj);
    }
  }

  const companies: CompanyRecord[] = tableRows.companies
    .map((r, idx) => ({
      id: Number(r.id) || idx + 1,
      name: String(r.name ?? '').trim(),
    }))
    .filter((c) => c.name.length > 0);

  const metalsByPickupId = new Map<number, MetalItemRecord[]>();
  for (const [idx, r] of tableRows.metal_items.entries()) {
    const id = Number(r.id) || idx + 1;
    const pickupId = Number(r.pickup_id) || 0;
    if (!pickupId) continue;
    const netWeight = Number(r.net_weight) || 0;
    const pricePerUnit = Number(r.price_per_unit) || 0;
    const rawTotal = r.total !== null && r.total !== undefined && r.total !== '' ? Number(r.total) : netWeight * pricePerUnit;
    const computedTotal = Math.round((Number.isFinite(rawTotal) ? rawTotal : netWeight * pricePerUnit) * 1e6) / 1e6;
    const metalItem: MetalItemRecord = {
      id,
      pickup_id: pickupId,
      metal_name: String(r.metal_name ?? '').trim(),
      net_weight: netWeight,
      weight_unit: String(r.weight_unit || 'kg').trim() || 'kg',
      price_per_unit: pricePerUnit,
      total: Math.abs(computedTotal) < 1e-9 ? 0 : computedTotal,
    };
    if (!metalsByPickupId.has(pickupId)) {
      metalsByPickupId.set(pickupId, []);
    }
    metalsByPickupId.get(pickupId)!.push(metalItem);
  }

  for (const list of metalsByPickupId.values()) {
    list.sort((a, b) => a.id - b.id);
  }

  const pickups: PickupRecord[] = tableRows.pickups.map((r, idx) => {
    const id = Number(r.id) || idx + 1;
    const companyId = Number(r.company_id) || 1;
    const metals = metalsByPickupId.get(id) || [];
    const deduction = Math.round((Number(r.deduction) || 0) * 1e6) / 1e6;
    const sumMetals = metals.reduce((acc, m) => acc + m.total, 0);
    const rawTotalAmount =
      r.total_amount !== null && r.total_amount !== undefined && r.total_amount !== ''
        ? Number(r.total_amount)
        : sumMetals - deduction;
    const computedTotalAmount = Math.round((Number.isFinite(rawTotalAmount) ? rawTotalAmount : sumMetals - deduction) * 1e6) / 1e6;

    return {
      id,
      company_id: companyId,
      date: String(r.date || '2025-01-01').slice(0, 10),
      yard: String(r.yard ?? '').trim(),
      notes: String(r.notes ?? '').trim(),
      deduction: Math.abs(deduction) < 1e-9 ? 0 : deduction,
      total_amount: Math.abs(computedTotalAmount) < 1e-9 ? 0 : computedTotalAmount,
      currency: String(r.currency || 'AUD$').trim() || 'AUD$',
      metals,
    };
  });

  const deductions: DeductionRecord[] = tableRows.deductions.map((r, idx) => {
    const amt = Math.round(Math.abs(Number(r.amount) || 0) * 1e6) / 1e6;
    return {
      id: Number(r.id) || idx + 1,
      company_id: Number(r.company_id) || 1,
      date: String(r.date || '2025-01-01').slice(0, 10),
      amount: amt < 1e-9 ? 0 : amt,
      notes: String(r.notes ?? '').trim(),
      currency: String(r.currency || 'AUD$').trim() || 'AUD$',
    };
  });

  const yards: YardOptionRecord[] = tableRows.yard_options
    .map((r, idx) => ({
      id: Number(r.id) || idx + 1,
      name: String(r.name ?? '').trim(),
    }))
    .filter((y) => y.name.length > 0);

  if (yards.length === 0) {
    const discoveredYards = new Set<string>();
    for (const p of pickups) {
      const firstLine = (p.yard || '').split(/\r?\n/)[0].trim();
      if (firstLine && firstLine.length <= 50) {
        discoveredYards.add(firstLine);
      }
    }
    if (discoveredYards.size === 0) {
      discoveredYards.add('Wetherill Park');
      discoveredYards.add('Minchinbury');
    }
    let yId = 1;
    for (const name of discoveredYards) {
      yards.push({ id: yId++, name });
    }
  }

  const currencies: CurrencyOptionRecord[] = tableRows.currency_options
    .map((r, idx) => {
      const code = String(r.code ?? '').trim().toUpperCase();
      const symbol = String(r.symbol ?? '$').trim();
      const label = String(r.label || `${code}${symbol}`).trim();
      return {
        id: Number(r.id) || idx + 1,
        code,
        symbol,
        label,
      };
    })
    .filter((c) => c.code.length > 0);

  if (currencies.length === 0) {
    currencies.push({ id: 1, code: 'AUD', symbol: '$', label: 'AUD$' });
  }

  const units: UnitOptionRecord[] = tableRows.unit_options
    .map((r, idx) => {
      const val = String(r.value ?? '').trim();
      const label = String(r.label || val).trim();
      return {
        id: Number(r.id) || idx + 1,
        value: val,
        label,
      };
    })
    .filter((u) => u.value.length > 0);

  if (units.length === 0) {
    units.push(
      { id: 1, value: 'kg', label: 'Kilograms' },
      { id: 2, value: 't', label: 'Tonnes' }
    );
  }

  return {
    companies,
    pickups,
    deductions,
    yards,
    currencies,
    units,
  };
}

export function buildMultiTabXlsxBase64(
  tabs: Record<string, Array<Array<string | number>>>
): string {
  const entries: Record<string, string | Buffer> = {};
  const tabNames = Object.keys(tabs);

  const sheetsXml = tabNames
    .map(
      (name, idx) =>
        `<sheet name="${encodeXmlEntities(name)}" sheetId="${idx + 1}" r:id="rId${idx + 1}"/>`
    )
    .join('');
  entries['xl/workbook.xml'] = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetsXml}</sheets></workbook>`;

  const relsXml = tabNames
    .map(
      (_name, idx) =>
        `<Relationship Id="rId${idx + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${idx + 1}.xml"/>`
    )
    .join('');
  entries['xl/_rels/workbook.xml.rels'] = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relsXml}</Relationships>`;

  tabNames.forEach((name, idx) => {
    const rows = tabs[name] || [];
    const sheetRowsXml = rows
      .map((r, rIdx) => {
        const cellsXml = r
          .map((cell, cIdx) => {
            const colLetter = String.fromCharCode(65 + cIdx);
            const ref = `${colLetter}${rIdx + 1}`;
            if (typeof cell === 'number') {
              return `<c r="${ref}"><v>${cell}</v></c>`;
            }
            return `<c r="${ref}" t="inlineStr"><is><t>${encodeXmlEntities(String(cell))}</t></is></c>`;
          })
          .join('');
        return `<row r="${rIdx + 1}">${cellsXml}</row>`;
      })
      .join('');
    entries[`xl/worksheets/sheet${idx + 1}.xml`] = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRowsXml}</sheetData></worksheet>`;
  });

  return createZipFromEntries(entries).toString('base64');
}

export function buildMinimalXlsxBase64(rows: Array<Array<string | number>>): string {
  const sheetRowsXml = rows
    .map((r, rIdx) => {
      const cellsXml = r
        .map((cell, cIdx) => {
          const colLetter = String.fromCharCode(65 + cIdx);
          const ref = `${colLetter}${rIdx + 1}`;
          if (typeof cell === 'number') {
            return `<c r="${ref}"><v>${cell}</v></c>`;
          }
          return `<c r="${ref}" t="inlineStr"><is><t>${encodeXmlEntities(String(cell))}</t></is></c>`;
        })
        .join('');
      return `<row r="${rIdx + 1}">${cellsXml}</row>`;
    })
    .join('');

  const sheetXml = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRowsXml}</sheetData></worksheet>`;
  const fileName = Buffer.from('xl/worksheets/sheet1.xml', 'utf8');
  const compressed = zlib.deflateRawSync(Buffer.from(sheetXml, 'utf8'));

  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(8, 8); // deflate
  localHeader.writeUInt32LE(compressed.length, 18);
  localHeader.writeUInt32LE(Buffer.byteLength(sheetXml), 22);
  localHeader.writeUInt16LE(fileName.length, 26);
  localHeader.writeUInt16LE(0, 28);

  return Buffer.concat([localHeader, fileName, compressed]).toString('base64');
}

const DEFAULT_SEED_CUSTOMERS: CustomerRecord[] = [];
const DEFAULT_YARDS = ['North Yard', 'East Yard', 'Pier 9 Depot', 'West Yard'];
const DEFAULT_CURRENCIES = ['USD ($)'];

export class LedgerDatabase {
  private db: DatabaseSync;
  private key: Buffer;
  private rawKey: string;
  private rootDir?: string;
  private closed = false;
  private revision = 1;

  constructor(options: { dbPath: string; encryptionKey: string; rootDir?: string }) {
    if (!options.encryptionKey || options.encryptionKey.trim().length === 0) {
      const err = new Error('Invalid encryption key: key cannot be empty') as Error & {
        code?: string;
      };
      err.code = 'ERR_INVALID_ENCRYPTION_KEY';
      throw err;
    }

    this.rawKey = options.encryptionKey;
    this.rootDir =
      options.rootDir ||
      (path.basename(path.dirname(options.dbPath)) === 'data'
        ? path.dirname(path.dirname(options.dbPath))
        : path.dirname(options.dbPath));
    this.key = deriveKey(options.encryptionKey);
    const dir = path.dirname(options.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseSync(options.dbPath);

    // Apply SQLCipher key pragma and USB fault-tolerant WAL settings
    const hexKey = this.key.toString('hex');
    this.db.exec(`PRAGMA key = "x'${hexKey}'";`);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = FULL;');
    this.db.exec('PRAGMA foreign_keys = ON;');

    this.migrateAndVerify();
  }

  public getMasterKey(): string {
    return this.rawKey;
  }

  public isHealthy(): boolean {
    if (this.closed) return false;
    try {
      this.db.prepare('PRAGMA schema_version;').get();
      return true;
    } catch {
      return false;
    }
  }

  public getDataVersion(): number {
    if (this.closed) return 0;
    try {
      const row = this.db.prepare('PRAGMA data_version;').get() as { data_version: number } | undefined;
      const pragmaVersion = row ? Number(row.data_version) || 0 : 0;
      return pragmaVersion + this.revision;
    } catch {
      return this.revision;
    }
  }

  private inTransaction = false;

  public runInTransaction<T>(fn: () => T): T {
    if (this.inTransaction) {
      return fn();
    }
    this.inTransaction = true;
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const res = fn();
      this.db.exec('COMMIT;');
      this.revision++;
      try {
        this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      } catch {
        // Best effort immediate checkpoint
      }
      return res;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK;');
      } catch {
        // Ignore rollback errors if already rolled back
      }
      throw err;
    } finally {
      this.inTransaction = false;
    }
  }

  private migrateAndVerify(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS customers_enc (
        id TEXT PRIMARY KEY,
        sort_order INTEGER NOT NULL,
        ciphertext TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ledger_entries_enc (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        FOREIGN KEY (customer_id) REFERENCES customers_enc(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS companies_enc (
        id INTEGER PRIMARY KEY,
        ciphertext TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pickups_enc (
        id INTEGER PRIMARY KEY,
        company_id INTEGER NOT NULL,
        ciphertext TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS deductions_enc (
        id INTEGER PRIMARY KEY,
        company_id INTEGER NOT NULL,
        ciphertext TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS yards_enc (
        id INTEGER PRIMARY KEY,
        ciphertext TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS currencies_enc (
        id INTEGER PRIMARY KEY,
        ciphertext TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS units_enc (
        id INTEGER PRIMARY KEY,
        ciphertext TEXT NOT NULL
      );
    `);

    const canaryRow = this.db
      .prepare('SELECT value FROM _meta WHERE key = ?')
      .get('canary') as { value: string } | undefined;

    if (!canaryRow) {
      this.runInTransaction(() => {
        const encCanary = encryptPayload(CANARY_PLAINTEXT, this.key);
        this.db
          .prepare('INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)')
          .run('canary', encCanary);

        this.setMetaEncrypted('passcodeConfigured', 'false');
        this.setMetaEncrypted('passcode', '');
        this.setMetaEncrypted('hintQuestion', '');
        this.setMetaEncrypted('hintAnswer', '');
        this.setMetaEncrypted('currentCurrency', 'USD ($)');
        this.setMetaEncrypted('currencies', JSON.stringify(DEFAULT_CURRENCIES));
        this.setMetaEncrypted('language', 'en');
        this.setMetaEncrypted('yards', JSON.stringify(DEFAULT_YARDS));
        this.setMetaEncrypted('nextCustomerSeq', String(1000 + DEFAULT_SEED_CUSTOMERS.length + 1));
        this.setMetaEncrypted('nextCompanySeq', '1');
        this.setMetaEncrypted('nextPickupSeq', '1');
        this.setMetaEncrypted('nextMetalSeq', '1');
        this.setMetaEncrypted('nextDeductionSeq', '1');
        this.setMetaEncrypted('nextYardOptionSeq', '1');
        this.setMetaEncrypted('nextCurrencyOptionSeq', '1');
        this.setMetaEncrypted('nextUnitOptionSeq', '1');

        DEFAULT_SEED_CUSTOMERS.forEach((cust, idx) => {
          this.insertCustomerInternal(cust, idx + 1);
        });
      });
    } else {
      const decrypted = decryptPayload(canaryRow.value, this.key);
      if (decrypted !== CANARY_PLAINTEXT) {
        this.db.close();
        const err = new Error('Invalid encryption key') as Error & { code?: string };
        err.code = 'ERR_INVALID_ENCRYPTION_KEY';
        throw err;
      }
    }
  }

  private setMetaEncrypted(key: string, plaintextValue: string): void {
    const enc = encryptPayload(plaintextValue, this.key);
    this.db
      .prepare('INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)')
      .run(key, enc);
  }

  private getMetaDecrypted(key: string, fallback = ''): string {
    const row = this.db
      .prepare('SELECT value FROM _meta WHERE key = ?')
      .get(key) as { value: string } | undefined;
    if (!row) return fallback;
    return decryptPayload(row.value, this.key);
  }

  private insertCustomerInternal(cust: CustomerRecord, sortOrder: number): void {
    const cleanPhone =
      cust.phone === '+1 (555) 000-0000' ||
      cust.phone === '+1 (555) 910-2211' ||
      cust.phone === '+1 (555) 304-9988' ||
      cust.phone === '+1 (555) 843-1122' ||
      cust.phone === '+1 (555) 777-3341' ||
      cust.phone === '+1 (555) 902-8812' ||
      cust.phone === '+1 (555) 612-4091'
        ? ''
        : cust.phone || '';
    const custData = {
      id: cust.id,
      name: cust.name,
      defaultYard: cust.defaultYard,
      balance: cust.balance,
      lastUpdate: cust.lastUpdate,
      phone: cleanPhone,
      notes: cust.notes ?? cleanPhone,
    };
    this.db
      .prepare(
        'INSERT INTO customers_enc (id, sort_order, ciphertext) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET sort_order = excluded.sort_order, ciphertext = excluded.ciphertext'
      )
      .run(cust.id, sortOrder, encryptPayload(JSON.stringify(custData), this.key));

    this.db.prepare('DELETE FROM ledger_entries_enc WHERE customer_id = ?').run(cust.id);
    const insertEntry = this.db.prepare(
      'INSERT INTO ledger_entries_enc (customer_id, ciphertext) VALUES (?, ?)'
    );
    for (const entry of cust.ledger) {
      insertEntry.run(cust.id, encryptPayload(JSON.stringify(entry), this.key));
    }
  }

  public getJournalMode(): string {
    const row = this.db.prepare('PRAGMA journal_mode;').get() as { journal_mode: string };
    return row.journal_mode;
  }

  public setupPasscode(input: {
    passcode: string;
    confirmPasscode?: string;
    hintQuestion: string;
    hintAnswer?: string;
    recoveryCodes?: string[];
  }): { recoveryCodes: string[] } {
    const cleanPass = (input.passcode || '').trim();
    if (input.confirmPasscode !== undefined) {
      const cleanConfirm = (input.confirmPasscode || '').trim();
      if (cleanPass !== cleanConfirm) {
        throw new Error('Passwords do not match');
      }
    }
    const cleanQuestion = (input.hintQuestion || '').trim();
    const cleanAnswer = (input.hintAnswer || '').trim();
    if (!cleanPass) {
      throw new Error('Password cannot be empty');
    }
    if (!cleanQuestion) {
      throw new Error('Password hint question is required');
    }

    const codes =
      Array.isArray(input.recoveryCodes) && input.recoveryCodes.length > 0
        ? input.recoveryCodes.map((c) => String(c).trim().toUpperCase()).filter(Boolean)
        : generateRecoveryCodes(4);

    this.runInTransaction(() => {
      this.setMetaEncrypted('passcode', cleanPass);
      this.setMetaEncrypted('hintQuestion', cleanQuestion);
      this.setMetaEncrypted('hintAnswer', cleanAnswer);
      this.setMetaEncrypted('recoveryCodes', JSON.stringify(codes));
      this.setMetaEncrypted('passcodeConfigured', 'true');
    });

    const rootDirToUse = this.rootDir || process.env.ADM_ROOT_DIR;
    if (rootDirToUse) {
      try {
        const { envelopeFile, keyFile, secretsDir } = resolvePortablePaths(rootDirToUse);
        if (fs.existsSync(secretsDir)) {
          const envelope = createKeyEnvelope(this.rawKey, cleanPass, codes, cleanQuestion);
          saveKeyEnvelope(envelopeFile, envelope);
          if (fs.existsSync(keyFile)) {
            try {
              fs.unlinkSync(keyFile);
            } catch {}
          }
        }
      } catch {}
    }
    setSessionMasterKey(this.rawKey);

    return { recoveryCodes: codes };
  }

  public recoverPasscode(input: {
    recoveryCode: string;
    newPasscode: string;
    confirmPasscode?: string;
  }): { ok: boolean; remainingRecoveryCodes: string[]; newCode?: string } {
    const cleanNewPass = (input.newPasscode || '').trim();
    if (!cleanNewPass) {
      throw new Error('New password cannot be empty');
    }
    if (input.confirmPasscode !== undefined) {
      const cleanConfirm = (input.confirmPasscode || '').trim();
      if (cleanNewPass !== cleanConfirm) {
        throw new Error('Passwords do not match');
      }
    }

    const rawInputCode = (input.recoveryCode || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (!rawInputCode) {
      throw new Error('Invalid or already used recovery code');
    }

    let codes: string[] = [];
    try {
      codes = JSON.parse(this.getMetaDecrypted('recoveryCodes', '[]'));
    } catch {
      codes = [];
    }

    const matchIdx = codes.findIndex(
      (c) => c.replace(/[^A-Za-z0-9]/g, '').toUpperCase() === rawInputCode
    );

    if (matchIdx === -1) {
      throw new Error('Invalid or already used recovery code');
    }

    const replacementCode = generateRecoveryCodes(1)[0];
    codes.splice(matchIdx, 1, replacementCode);

    this.runInTransaction(() => {
      this.setMetaEncrypted('passcode', cleanNewPass);
      this.setMetaEncrypted('recoveryCodes', JSON.stringify(codes));
    });

    const rootDirToUse = this.rootDir || process.env.ADM_ROOT_DIR;
    if (rootDirToUse) {
      try {
        const { envelopeFile, keyFile, secretsDir } = resolvePortablePaths(rootDirToUse);
        if (fs.existsSync(secretsDir)) {
          const envelope = loadKeyEnvelope(envelopeFile);
          if (envelope) {
            const { salt, wrapped } = wrapMasterKeyWithPassword(this.rawKey, cleanNewPass);
            envelope.passwordSalt = salt;
            envelope.passwordWrappedKey = wrapped;
            const newRecEnv = wrapMasterKeyWithRecoveryCode(this.rawKey, replacementCode);
            envelope.recoveryEnvelopes.splice(matchIdx, 1, newRecEnv);
            envelope.updatedAt = new Date().toISOString();
            saveKeyEnvelope(envelopeFile, envelope);
          }
          if (fs.existsSync(keyFile)) {
            try {
              fs.unlinkSync(keyFile);
            } catch {}
          }
        }
      } catch {}
    }
    setSessionMasterKey(this.rawKey);

    return {
      ok: true,
      remainingRecoveryCodes: codes,
      newCode: replacementCode,
    };
  }

  public getRecoveryCodes(passcode: string): string[] {
    if (!this.verifyPasscode(passcode)) {
      throw new Error('Incorrect current password');
    }
    try {
      const codes = JSON.parse(this.getMetaDecrypted('recoveryCodes', '[]'));
      return Array.isArray(codes) ? codes : [];
    } catch {
      return [];
    }
  }

  public regenerateRecoveryCodes(passcode: string): string[] {
    if (!this.verifyPasscode(passcode)) {
      throw new Error('Incorrect current password');
    }
    const newCodes = generateRecoveryCodes(4);
    this.runInTransaction(() => {
      this.setMetaEncrypted('recoveryCodes', JSON.stringify(newCodes));
    });
    const rootDirToUse = this.rootDir || process.env.ADM_ROOT_DIR;
    if (rootDirToUse) {
      try {
        const { envelopeFile } = resolvePortablePaths(rootDirToUse);
        const envelope = loadKeyEnvelope(envelopeFile);
        if (envelope) {
          envelope.recoveryEnvelopes = newCodes.map((code) =>
            wrapMasterKeyWithRecoveryCode(this.rawKey, code)
          );
          envelope.updatedAt = new Date().toISOString();
          saveKeyEnvelope(envelopeFile, envelope);
        }
      } catch {}
    }
    return newCodes;
  }

  public resetPasscode(oldPasscode?: string): void {
    const isConfigured = this.getMetaDecrypted('passcodeConfigured', 'false') === 'true';
    if (isConfigured) {
      if (!oldPasscode || !this.verifyPasscode(oldPasscode)) {
        throw new Error('Incorrect current password');
      }
    }
    this.runInTransaction(() => {
      this.setMetaEncrypted('passcode', '');
      this.setMetaEncrypted('hintQuestion', '');
      this.setMetaEncrypted('hintAnswer', '');
      this.setMetaEncrypted('recoveryCodes', '[]');
      this.setMetaEncrypted('passcodeConfigured', 'false');
    });

    const rootDirToUse = this.rootDir || process.env.ADM_ROOT_DIR;
    if (rootDirToUse) {
      try {
        const { envelopeFile, keyFile, secretsDir } = resolvePortablePaths(rootDirToUse);
        if (!fs.existsSync(secretsDir)) {
          fs.mkdirSync(secretsDir, { recursive: true });
        }
        if (/^[0-9a-fA-F]{64}$/.test(this.rawKey)) {
          fs.writeFileSync(keyFile, this.rawKey, { mode: 0o600 });
        }
        if (fs.existsSync(envelopeFile)) {
          fs.unlinkSync(envelopeFile);
        }
      } catch {}
    }
  }

  public verifyPasscode(passcode: string): boolean {
    const isConfigured = this.getMetaDecrypted('passcodeConfigured', 'false') === 'true';
    if (!isConfigured) {
      return false;
    }
    const stored = this.getMetaDecrypted('passcode', '');
    return Boolean(stored) && passcode === stored;
  }

  public getAppState(): AppState {
    const custRows = this.db
      .prepare('SELECT id, sort_order, ciphertext FROM customers_enc ORDER BY sort_order ASC')
      .all() as Array<{ id: string; sort_order: number; ciphertext: string }>;

    const entryRows = this.db
      .prepare('SELECT id, customer_id, ciphertext FROM ledger_entries_enc ORDER BY id ASC')
      .all() as Array<{ id: number; customer_id: string; ciphertext: string }>;

    const ledgerByCustomer = new Map<string, LedgerEntryRecord[]>();
    for (const row of entryRows) {
      const entry = JSON.parse(decryptPayload(row.ciphertext, this.key)) as LedgerEntryRecord;
      const list = ledgerByCustomer.get(row.customer_id) || [];
      list.push(entry);
      ledgerByCustomer.set(row.customer_id, list);
    }
    for (const [, list] of ledgerByCustomer.entries()) {
      list.sort((a, b) => compareLedgerDates(a.date, b.date));
    }

    const customers: CustomerRecord[] = custRows.map((row) => {
      const data = JSON.parse(decryptPayload(row.ciphertext, this.key)) as Omit<
        CustomerRecord,
        'ledger'
      >;
      const isPlaceholderPhone =
        data.phone === '+1 (555) 000-0000' ||
        data.phone === '+1 (555) 910-2211' ||
        data.phone === '+1 (555) 304-9988' ||
        data.phone === '+1 (555) 843-1122' ||
        data.phone === '+1 (555) 777-3341' ||
        data.phone === '+1 (555) 902-8812' ||
        data.phone === '+1 (555) 612-4091';
      const cleanedNotes = data.notes || (!isPlaceholderPhone ? data.phone : '') || '';
      return {
        ...data,
        phone: isPlaceholderPhone ? '' : data.phone || '',
        notes: cleanedNotes,
        ledger: ledgerByCustomer.get(row.id) || [],
      };
    });

    const yards = JSON.parse(
      this.getMetaDecrypted('yards', JSON.stringify(DEFAULT_YARDS))
    ) as string[];
    const defaultYard = this.getMetaDecrypted('defaultYard', yards[0] || 'North Yard');
    const currencies = JSON.parse(
      this.getMetaDecrypted('currencies', JSON.stringify(DEFAULT_CURRENCIES))
    ) as string[];
    const currentCurrency = this.getMetaDecrypted('currentCurrency', 'USD ($)');
    const language = this.getMetaDecrypted('language', 'en');
    let isConfigured = this.getMetaDecrypted('passcodeConfigured', 'false') === 'true';
    let hintQuestion = this.getMetaDecrypted('hintQuestion', '');
    const hintAnswer = this.getMetaDecrypted('hintAnswer', '');
    let hasRecoveryCodes = (() => {
      try {
        const list = JSON.parse(this.getMetaDecrypted('recoveryCodes', '[]'));
        return Array.isArray(list) && list.length > 0;
      } catch {
        return false;
      }
    })();

    if (!isConfigured) {
      const rootDirToUse = this.rootDir || process.env.ADM_ROOT_DIR;
      if (rootDirToUse) {
        try {
          const { envelopeFile } = resolvePortablePaths(rootDirToUse);
          const env = loadKeyEnvelope(envelopeFile);
          if (env && env.isConfigured) {
            isConfigured = true;
            if (!hintQuestion && env.hintQuestion) {
              hintQuestion = env.hintQuestion;
            }
            if (env.recoveryEnvelopes && env.recoveryEnvelopes.length > 0) {
              hasRecoveryCodes = true;
            }
          }
        } catch {}
      }
    }

    return {
      version: 'v2.5.0',
      currentCurrency,
      currencies,
      language,
      yards,
      defaultYard,
      customers,
      authStatus: {
        isConfigured,
        hintQuestion,
        hintAnswer,
        hasRecoveryCodes,
      },
      dbStatus: {
        journalMode: this.getJournalMode(),
        encrypted: true,
        dataVersion: this.getDataVersion(),
        lastSync: new Date().toISOString().slice(0, 19).replace('T', ' '),
      },
    };
  }

  public createCustomer(input: {
    name: string;
    defaultYard?: string;
    balance?: number;
    phone?: string;
    notes?: string;
    currency?: string;
  }): CustomerRecord {
    const cleanName = (input.name || '').trim();
    if (!cleanName) {
      throw new Error('Customer name is required');
    }
    const bal = Math.round((Number(input.balance) || 0) * 100) / 100;
    const yard =
      (input.defaultYard && input.defaultYard.trim()) ||
      this.getMetaDecrypted('defaultYard', 'North Yard');
    const noteText = (input.notes ?? input.phone ?? '').trim();
    const now = new Date().toISOString().slice(0, 16).replace('T', ' ');

    return this.runInTransaction(() => {
      const state = this.getAppState();
      const duplicate = state.customers.find(
        (c) => c.name.trim().toLowerCase() === cleanName.toLowerCase()
      );
      if (duplicate) {
        throw new Error(`Customer "${cleanName}" already exists`);
      }

      const seq = parseInt(this.getMetaDecrypted('nextCustomerSeq', '1001'), 10);
      const newId = `CUST-${seq}`;
      this.setMetaEncrypted('nextCustomerSeq', String(seq + 1));

      const minOrderRow = this.db
        .prepare('SELECT MIN(sort_order) as minOrder FROM customers_enc')
        .get() as { minOrder: number | null };
      const nextSortOrder = (minOrderRow?.minOrder ?? 1) - 1;

      const openingEntry: LedgerEntryRecord = {
        date: now,
        invoice: bal > 0 ? bal : 0,
        paid: bal < 0 ? Math.abs(bal) : 0,
        method: bal < 0 ? 'Cash' : 'Unpaid Due',
        yard,
        memo:
          noteText ||
          (bal < 0 ? 'Initial advance given to customer' : 'Unpaid balance to pay customer'),
        runningBalance: bal,
        currency: input.currency || this.getMetaDecrypted('currentCurrency', 'USD ($)'),
      };

      const newCust: CustomerRecord = {
        id: newId,
        name: cleanName,
        defaultYard: yard,
        balance: bal,
        lastUpdate: now,
        phone: noteText,
        notes: noteText,
        ledger: [openingEntry],
      };

      this.insertCustomerInternal(newCust, nextSortOrder);
      return newCust;
    });
  }

  public addLedgerEntry(input: {
    customerId: string;
    entryType?: EntryType;
    amount?: number;
    invoice?: number;
    paid?: number;
    payFull?: boolean;
    method?: string;
    yard?: string;
    memo?: string;
    date?: string;
    currency?: string;
  }): CustomerRecord {
    return this.runInTransaction(() => {
      const state = this.getAppState();
      const cust = state.customers.find((c) => c.id === input.customerId);
      if (!cust) {
        throw new Error(`Customer ${input.customerId} not found`);
      }

      const now = input.date || new Date().toISOString().slice(0, 16).replace('T', ' ');
      let invoiceVal = 0;
      let paidVal = 0;
      let newBalance = cust.balance;
      let methodLabel = input.method || 'Cash';

      if (input.payFull) {
        if (cust.balance <= 0) {
          throw new Error('Customer has no unpaid balance to pay');
        }
        invoiceVal = 0;
        paidVal = Math.round(cust.balance * 100) / 100;
        newBalance = 0;
        methodLabel = input.method || 'Cash';
      } else if (input.entryType) {
        const impact = calculateEntryImpact(
          cust.balance,
          input.entryType,
          Number(input.amount) || 0
        );
        invoiceVal = impact.invoiceAmount;
        paidVal = impact.paidAmount;
        newBalance = impact.runningBalance;
        methodLabel =
          input.entryType === 'invoice'
            ? 'Unpaid Due'
            : input.entryType === 'advance'
              ? `Advance (${input.method || 'Cash'})`
              : input.method || 'Cash';
      } else {
        invoiceVal = Math.round(Math.abs(Number(input.invoice) || 0) * 100) / 100;
        paidVal = Math.round(Math.abs(Number(input.paid) || 0) * 100) / 100;
        newBalance = Math.round((cust.balance + invoiceVal - paidVal) * 100) / 100;
        methodLabel = input.method || (invoiceVal > 0 && paidVal === 0 ? 'Unpaid Due' : 'Cash');
      }

      const memoText =
        (input.memo || '').trim() ||
        (input.payFull
          ? 'Paid full balance to customer'
          : input.entryType === 'advance'
            ? 'Advance given to customer'
            : input.entryType === 'payment' || (paidVal > 0 && invoiceVal === 0)
              ? 'Cash paid to customer'
              : 'Unpaid amount added');

      const entryCurrency =
        input.currency || this.getMetaDecrypted('currentCurrency', 'USD ($)');

      const entry: LedgerEntryRecord = {
        date: now,
        invoice: invoiceVal,
        paid: paidVal,
        method: methodLabel,
        yard:
          input.yard ||
          cust.defaultYard ||
          this.getMetaDecrypted('defaultYard', 'North Yard'),
        memo: memoText,
        runningBalance: newBalance,
        currency: entryCurrency,
      };

      cust.ledger.push(entry);
      cust.ledger.sort((a, b) => compareLedgerDates(a.date, b.date));

      let running = 0;
      for (const item of cust.ledger) {
        const inv = Math.round((Number(item.invoice) || 0) * 100) / 100;
        const paid = Math.round((Number(item.paid) || 0) * 100) / 100;
        item.invoice = inv;
        item.paid = paid;
        running = Math.round((running + inv - paid) * 100) / 100;
        item.runningBalance = running;
      }

      cust.balance = running;
      cust.lastUpdate = now;

      this.db
        .prepare('INSERT INTO ledger_entries_enc (customer_id, ciphertext) VALUES (?, ?)')
        .run(cust.id, encryptPayload(JSON.stringify(entry), this.key));

      const custRow = this.db
        .prepare('SELECT sort_order FROM customers_enc WHERE id = ?')
        .get(cust.id) as { sort_order: number };

      const custData = {
        id: cust.id,
        name: cust.name,
        defaultYard: cust.defaultYard,
        balance: cust.balance,
        lastUpdate: cust.lastUpdate,
        phone: cust.phone || '',
        notes: cust.notes ?? cust.phone ?? '',
      };
      this.db
        .prepare(
          'INSERT INTO customers_enc (id, sort_order, ciphertext) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET sort_order = excluded.sort_order, ciphertext = excluded.ciphertext'
        )
        .run(cust.id, custRow.sort_order, encryptPayload(JSON.stringify(custData), this.key));

      return cust;
    });
  }

  public updateCustomer(input: {
    id: string;
    name?: string;
    defaultYard?: string;
    phone?: string;
    notes?: string;
  }): CustomerRecord {
    return this.runInTransaction(() => {
      const state = this.getAppState();
      const cust = state.customers.find((c) => c.id === input.id);
      if (!cust) {
        throw new Error(`Customer ${input.id} not found`);
      }

      if (input.name !== undefined) {
        const cleanName = input.name.trim();
        if (!cleanName) {
          throw new Error('Customer name cannot be empty');
        }
        const duplicate = state.customers.find(
          (c) => c.id !== cust.id && c.name.trim().toLowerCase() === cleanName.toLowerCase()
        );
        if (duplicate) {
          throw new Error(`Customer "${cleanName}" already exists`);
        }
        cust.name = cleanName;
      }
      if (input.defaultYard !== undefined) {
        const cleanYard = input.defaultYard.trim();
        if (cleanYard) cust.defaultYard = cleanYard;
      }
      if (input.phone !== undefined || input.notes !== undefined) {
        const notesVal = (input.notes !== undefined ? input.notes : input.phone ?? '').trim();
        cust.phone = notesVal;
        cust.notes = notesVal;
      }

      cust.lastUpdate = new Date().toISOString().slice(0, 16).replace('T', ' ');

      const custRow = this.db
        .prepare('SELECT sort_order FROM customers_enc WHERE id = ?')
        .get(cust.id) as { sort_order: number };

      const custData = {
        id: cust.id,
        name: cust.name,
        defaultYard: cust.defaultYard,
        balance: cust.balance,
        lastUpdate: cust.lastUpdate,
        phone: cust.phone || '',
        notes: cust.notes ?? cust.phone ?? '',
      };
      this.db
        .prepare(
          'INSERT INTO customers_enc (id, sort_order, ciphertext) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET sort_order = excluded.sort_order, ciphertext = excluded.ciphertext'
        )
        .run(cust.id, custRow.sort_order, encryptPayload(JSON.stringify(custData), this.key));

      return cust;
    });
  }

  public updateLedgerEntry(input: {
    customerId: string;
    entryIndex: number;
    date?: string;
    invoice?: number;
    paid?: number;
    method?: string;
    yard?: string;
    memo?: string;
    currency?: string;
  }): CustomerRecord {
    return this.runInTransaction(() => {
      const state = this.getAppState();
      const cust = state.customers.find((c) => c.id === input.customerId);
      if (!cust) {
        throw new Error(`Customer ${input.customerId} not found`);
      }

      const idx = input.entryIndex;
      if (idx < 0 || idx >= cust.ledger.length) {
        throw new Error(`Invalid ledger entry index: ${idx}`);
      }

      const entry = cust.ledger[idx];
      if (input.date !== undefined && input.date.trim()) {
        entry.date = input.date.trim();
      }
      if (input.invoice !== undefined) {
        entry.invoice = Math.round(Math.abs(Number(input.invoice) || 0) * 100) / 100;
      }
      if (input.paid !== undefined) {
        entry.paid = Math.round(Math.abs(Number(input.paid) || 0) * 100) / 100;
      }
      if (input.method !== undefined && input.method.trim()) {
        entry.method = input.method.trim();
      }
      if (input.yard !== undefined && input.yard.trim()) {
        entry.yard = input.yard.trim();
      }
      if (input.memo !== undefined) {
        entry.memo = input.memo.trim();
      }
      if (input.currency !== undefined && input.currency.trim()) {
        entry.currency = input.currency.trim();
      }

      cust.ledger.sort((a, b) => compareLedgerDates(a.date, b.date));

      let running = 0;
      for (const item of cust.ledger) {
        const inv = Math.round((Number(item.invoice) || 0) * 100) / 100;
        const paid = Math.round((Number(item.paid) || 0) * 100) / 100;
        item.invoice = inv;
        item.paid = paid;
        running = Math.round((running + inv - paid) * 100) / 100;
        item.runningBalance = running;
      }

      cust.balance = running;
      cust.lastUpdate = new Date().toISOString().slice(0, 16).replace('T', ' ');

      const custRow = this.db
        .prepare('SELECT sort_order FROM customers_enc WHERE id = ?')
        .get(cust.id) as { sort_order: number };

      this.insertCustomerInternal(cust, custRow.sort_order);
      return cust;
    });
  }

  public deleteLedgerEntry(input: {
    customerId: string;
    entryIndex: number;
  }): CustomerRecord {
    return this.runInTransaction(() => {
      const state = this.getAppState();
      const cust = state.customers.find((c) => c.id === input.customerId);
      if (!cust) {
        throw new Error(`Customer ${input.customerId} not found`);
      }

      const idx = input.entryIndex;
      if (idx < 0 || idx >= cust.ledger.length) {
        throw new Error(`Invalid ledger entry index: ${idx}`);
      }

      cust.ledger.splice(idx, 1);

      let running = 0;
      for (const item of cust.ledger) {
        const inv = Math.round((Number(item.invoice) || 0) * 100) / 100;
        const paid = Math.round((Number(item.paid) || 0) * 100) / 100;
        item.invoice = inv;
        item.paid = paid;
        running = Math.round((running + inv - paid) * 100) / 100;
        item.runningBalance = running;
      }

      cust.balance = running;
      cust.lastUpdate = new Date().toISOString().slice(0, 16).replace('T', ' ');

      const custRow = this.db
        .prepare('SELECT sort_order FROM customers_enc WHERE id = ?')
        .get(cust.id) as { sort_order: number };

      this.insertCustomerInternal(cust, custRow.sort_order);
      return cust;
    });
  }

  public consolidateCustomerBalance(input: {
    customerId: string;
  }): CustomerRecord {
    return this.runInTransaction(() => {
      const state = this.getAppState();
      const cust = state.customers.find((c) => c.id === input.customerId);
      if (!cust) {
        throw new Error(`Customer ${input.customerId} not found`);
      }

      const bal = Math.round((Number(cust.balance) || 0) * 100) / 100;
      const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const currency =
        cust.ledger[cust.ledger.length - 1]?.currency ||
        this.getMetaDecrypted('currentCurrency', 'USD ($)');

      cust.ledger = [
        {
          date: now,
          invoice: bal > 0 ? bal : 0,
          paid: bal < 0 ? Math.abs(bal) : 0,
          currency,
          method: bal < 0 ? 'Cash' : 'Unpaid Due',
          yard: cust.defaultYard || 'North Yard',
          memo: 'Opening balance consolidated from past logs',
          runningBalance: bal,
        },
      ];

      cust.balance = bal;
      cust.lastUpdate = now;

      const custRow = this.db
        .prepare('SELECT sort_order FROM customers_enc WHERE id = ?')
        .get(cust.id) as { sort_order: number };

      this.insertCustomerInternal(cust, custRow.sort_order);
      return cust;
    });
  }

  public deleteCustomer(customerId: string): CustomerRecord {
    return this.runInTransaction(() => {
      const state = this.getAppState();
      const cust = state.customers.find((c) => c.id === customerId);
      if (!cust) {
        throw new Error(`Customer ${customerId} not found`);
      }
      this.db.prepare('DELETE FROM ledger_entries_enc WHERE customer_id = ?').run(customerId);
      this.db.prepare('DELETE FROM customers_enc WHERE id = ?').run(customerId);
      return cust;
    });
  }

  public restoreCustomer(cust: CustomerRecord): CustomerRecord {
    return this.runInTransaction(() => {
      const minOrderRow = this.db
        .prepare('SELECT MIN(sort_order) as minOrder FROM customers_enc')
        .get() as { minOrder: number | null };
      const nextSortOrder = (minOrderRow?.minOrder ?? 1) - 1;
      this.insertCustomerInternal(cust, nextSortOrder);
      return cust;
    });
  }

  public addYard(name: string): string[] {
    const clean = (name || '').trim();
    if (!clean) throw new Error('Yard name is required');
    return this.runInTransaction(() => {
      const yards = JSON.parse(
        this.getMetaDecrypted('yards', JSON.stringify(DEFAULT_YARDS))
      ) as string[];
      if (!yards.includes(clean)) {
        yards.push(clean);
        this.setMetaEncrypted('yards', JSON.stringify(yards));
      }
      return yards;
    });
  }

  public renameYard(oldName: string, newName: string): string[] {
    const cleanNew = (newName || '').trim();
    if (!cleanNew) throw new Error('New yard name is required');
    return this.runInTransaction(() => {
      const state = this.getAppState();
      const idx = state.yards.indexOf(oldName);
      if (idx !== -1) {
        state.yards[idx] = cleanNew;
        this.setMetaEncrypted('yards', JSON.stringify(state.yards));
      }
      if (this.getMetaDecrypted('defaultYard', '') === oldName) {
        this.setMetaEncrypted('defaultYard', cleanNew);
      }
      state.customers.forEach((cust, i) => {
        let modified = false;
        if (cust.defaultYard === oldName) {
          cust.defaultYard = cleanNew;
          modified = true;
        }
        cust.ledger.forEach((entry) => {
          if (entry.yard === oldName) {
            entry.yard = cleanNew;
            modified = true;
          }
        });
        if (modified) {
          this.insertCustomerInternal(cust, i + 1);
        }
      });
      return state.yards;
    });
  }

  public removeYard(yardName: string): string[] {
    return this.runInTransaction(() => {
      const yards = JSON.parse(
        this.getMetaDecrypted('yards', JSON.stringify(DEFAULT_YARDS))
      ) as string[];
      if (yards.length <= 1) {
        throw new Error('You must keep at least one active yard.');
      }
      const nextYards = yards.filter((y) => y !== yardName);
      this.setMetaEncrypted('yards', JSON.stringify(nextYards));
      if (this.getMetaDecrypted('defaultYard', '') === yardName) {
        this.setMetaEncrypted('defaultYard', nextYards[0] || 'North Yard');
      }
      return nextYards;
    });
  }

  public setDefaultYard(yardName: string): string {
    const clean = (yardName || '').trim();
    if (!clean) throw new Error('Yard name is required');
    return this.runInTransaction(() => {
      const state = this.getAppState();
      if (!state.yards.includes(clean)) {
        throw new Error(`Yard "${clean}" does not exist in active yards.`);
      }
      this.setMetaEncrypted('defaultYard', clean);
      return clean;
    });
  }

  public addCurrency(currencyLabel: string): string[] {
    const clean = (currencyLabel || '').trim();
    if (!clean) throw new Error('Currency is required');
    return this.runInTransaction(() => {
      const currencies = JSON.parse(
        this.getMetaDecrypted('currencies', JSON.stringify(DEFAULT_CURRENCIES))
      ) as string[];
      if (!currencies.includes(clean)) {
        currencies.push(clean);
        this.setMetaEncrypted('currencies', JSON.stringify(currencies));
      }
      this.setMetaEncrypted('currentCurrency', clean);
      return currencies;
    });
  }

  public renameCurrency(oldCurrency: string, newCurrency: string): string[] {
    const cleanNew = (newCurrency || '').trim();
    if (!cleanNew) throw new Error('New currency label is required');
    return this.runInTransaction(() => {
      const currencies = JSON.parse(
        this.getMetaDecrypted('currencies', JSON.stringify(DEFAULT_CURRENCIES))
      ) as string[];
      const idx = currencies.indexOf(oldCurrency);
      if (idx !== -1) {
        currencies[idx] = cleanNew;
        this.setMetaEncrypted('currencies', JSON.stringify(currencies));
      }
      const current = this.getMetaDecrypted('currentCurrency', 'USD ($)');
      if (current === oldCurrency) {
        this.setMetaEncrypted('currentCurrency', cleanNew);
      }
      return currencies;
    });
  }

  public removeCurrency(currencyLabel: string): string[] {
    return this.runInTransaction(() => {
      const currencies = JSON.parse(
        this.getMetaDecrypted('currencies', JSON.stringify(DEFAULT_CURRENCIES))
      ) as string[];
      const nextCurrencies = currencies.filter((c) => c !== currencyLabel);
      this.setMetaEncrypted('currencies', JSON.stringify(nextCurrencies));
      const current = this.getMetaDecrypted('currentCurrency', 'USD ($)');
      if (current === currencyLabel) {
        this.setMetaEncrypted('currentCurrency', nextCurrencies[0] || 'USD ($)');
      }
      return nextCurrencies;
    });
  }

  public updateSettings(input: {
    currentCurrency?: string;
    newCurrency?: string;
    defaultYard?: string;
    language?: string;
  }): AppState {
    return this.runInTransaction(() => {
      if (input.newCurrency && input.newCurrency.trim()) {
        this.addCurrency(input.newCurrency.trim());
      } else if (input.currentCurrency) {
        this.setMetaEncrypted('currentCurrency', input.currentCurrency);
      }
      if (input.defaultYard && input.defaultYard.trim()) {
        this.setMetaEncrypted('defaultYard', input.defaultYard.trim());
      }
      if (input.language) {
        this.setMetaEncrypted('language', input.language);
      }
      return this.getAppState();
    });
  }

  // =========================================================================
  // Money-Total-Sheet Encrypted Entities CRUD (Companies, Pickups, Deductions, Yards, Currencies, Units)
  // =========================================================================

  public getCompanies(): CompanyRecord[] {
    const rows = this.db
      .prepare('SELECT id, ciphertext FROM companies_enc ORDER BY id ASC')
      .all() as Array<{ id: number; ciphertext: string }>;
    return rows.map(
      (r) => JSON.parse(decryptPayload(r.ciphertext, this.key)) as CompanyRecord
    );
  }

  public createCompany(input: { name: string } | string): CompanyRecord {
    const rawName = typeof input === 'string' ? input : input?.name;
    const cleanName = (rawName || '').trim();
    if (!cleanName) {
      throw new Error('Company name cannot be empty');
    }
    return this.runInTransaction(() => {
      const existing = this.getCompanies();
      const dup = existing.find((c) => c.name.trim().toLowerCase() === cleanName.toLowerCase());
      if (dup) {
        throw new Error('Company already registered');
      }
      const seq = parseInt(this.getMetaDecrypted('nextCompanySeq', '1'), 10);
      this.setMetaEncrypted('nextCompanySeq', String(seq + 1));
      const company: CompanyRecord = { id: seq, name: cleanName };
      this.db
        .prepare('INSERT OR REPLACE INTO companies_enc (id, ciphertext) VALUES (?, ?)')
        .run(company.id, encryptPayload(JSON.stringify(company), this.key));
      return company;
    });
  }

  public updateCompany(id: number, input: { name: string } | string): CompanyRecord {
    const rawName = typeof input === 'string' ? input : input?.name;
    const cleanName = (rawName || '').trim();
    if (!cleanName) {
      throw new Error('Company name cannot be empty');
    }
    return this.runInTransaction(() => {
      const existing = this.getCompanies();
      const target = existing.find((c) => c.id === id);
      if (!target) {
        throw new Error('Company not found');
      }
      const dup = existing.find(
        (c) => c.id !== id && c.name.trim().toLowerCase() === cleanName.toLowerCase()
      );
      if (dup) {
        throw new Error('Company already registered');
      }
      const updated: CompanyRecord = { id, name: cleanName };
      this.db
        .prepare('INSERT OR REPLACE INTO companies_enc (id, ciphertext) VALUES (?, ?)')
        .run(id, encryptPayload(JSON.stringify(updated), this.key));
      return updated;
    });
  }

  public deleteCompany(id: number): CompanyRecord {
    return this.runInTransaction(() => {
      const existing = this.getCompanies();
      const target = existing.find((c) => c.id === id);
      if (!target) {
        throw new Error('Company not found');
      }
      this.db.prepare('DELETE FROM pickups_enc WHERE company_id = ?').run(id);
      this.db.prepare('DELETE FROM deductions_enc WHERE company_id = ?').run(id);
      this.db.prepare('DELETE FROM companies_enc WHERE id = ?').run(id);
      return target;
    });
  }

  public getPickupsByCompany(companyId: number): PickupRecord[] {
    const rows = this.db
      .prepare('SELECT id, company_id, ciphertext FROM pickups_enc WHERE company_id = ? ORDER BY id ASC')
      .all(companyId) as Array<{ id: number; company_id: number; ciphertext: string }>;
    const list = rows.map(
      (r) => JSON.parse(decryptPayload(r.ciphertext, this.key)) as PickupRecord
    );
    return list.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.id - b.id;
    });
  }

  public createPickup(input: {
    company_id: number;
    date: string;
    yard?: string;
    notes?: string;
    deduction?: number;
    currency?: string;
    metals?: Array<{
      metal_name: string;
      net_weight: number;
      weight_unit?: string;
      price_per_unit: number;
      total?: number;
    }>;
  }): PickupRecord {
    return this.runInTransaction(() => {
      const pickupSeq = parseInt(this.getMetaDecrypted('nextPickupSeq', '1'), 10);
      this.setMetaEncrypted('nextPickupSeq', String(pickupSeq + 1));

      let metalSeq = parseInt(this.getMetaDecrypted('nextMetalSeq', '1'), 10);
      const metals: MetalItemRecord[] = (input.metals || []).map((m) => {
        const netWeight = Number(m.net_weight) || 0;
        const pricePerUnit = Number(m.price_per_unit) || 0;
        const total =
          m.total !== undefined && m.total !== null
            ? Number(m.total)
            : netWeight * pricePerUnit;
        const record: MetalItemRecord = {
          id: metalSeq++,
          pickup_id: pickupSeq,
          metal_name: String(m.metal_name || '').trim(),
          net_weight: netWeight,
          weight_unit: String(m.weight_unit || 'kg').trim(),
          price_per_unit: pricePerUnit,
          total: Math.round(total * 1e6) / 1e6,
        };
        return record;
      });
      this.setMetaEncrypted('nextMetalSeq', String(metalSeq));

      const deduction = Number(input.deduction) || 0;
      const sumMetals = metals.reduce((acc, m) => acc + m.total, 0);
      const totalAmount = Math.round((sumMetals - deduction) * 1e6) / 1e6;

      const pickup: PickupRecord = {
        id: pickupSeq,
        company_id: Number(input.company_id),
        date: String(input.date || new Date().toISOString().slice(0, 10)).slice(0, 10),
        yard: String(input.yard || ''),
        notes: String(input.notes || ''),
        deduction,
        total_amount: totalAmount,
        currency: String(input.currency || 'AUD$'),
        metals,
      };

      this.db
        .prepare('INSERT OR REPLACE INTO pickups_enc (id, company_id, ciphertext) VALUES (?, ?, ?)')
        .run(pickup.id, pickup.company_id, encryptPayload(JSON.stringify(pickup), this.key));

      return pickup;
    });
  }

  public updatePickup(
    pickupId: number,
    input: {
      date: string;
      yard?: string;
      notes?: string;
      deduction?: number;
      currency?: string;
      metals?: Array<{
        metal_name: string;
        net_weight: number;
        weight_unit?: string;
        price_per_unit: number;
        total?: number;
      }>;
    }
  ): PickupRecord {
    return this.runInTransaction(() => {
      const row = this.db
        .prepare('SELECT id, company_id, ciphertext FROM pickups_enc WHERE id = ?')
        .get(pickupId) as { id: number; company_id: number; ciphertext: string } | undefined;
      if (!row) {
        throw new Error('Pickup not found');
      }
      const existing = JSON.parse(decryptPayload(row.ciphertext, this.key)) as PickupRecord;

      let metalSeq = parseInt(this.getMetaDecrypted('nextMetalSeq', '1'), 10);
      const metals: MetalItemRecord[] = (input.metals || []).map((m) => {
        const netWeight = Number(m.net_weight) || 0;
        const pricePerUnit = Number(m.price_per_unit) || 0;
        const total =
          m.total !== undefined && m.total !== null
            ? Number(m.total)
            : netWeight * pricePerUnit;
        return {
          id: metalSeq++,
          pickup_id: pickupId,
          metal_name: String(m.metal_name || '').trim(),
          net_weight: netWeight,
          weight_unit: String(m.weight_unit || 'kg').trim(),
          price_per_unit: pricePerUnit,
          total: Math.round(total * 1e6) / 1e6,
        };
      });
      this.setMetaEncrypted('nextMetalSeq', String(metalSeq));

      const deduction = input.deduction !== undefined ? Number(input.deduction) || 0 : existing.deduction;
      const sumMetals = metals.reduce((acc, m) => acc + m.total, 0);
      const totalAmount = Math.round((sumMetals - deduction) * 1e6) / 1e6;

      const updated: PickupRecord = {
        id: pickupId,
        company_id: existing.company_id,
        date: String(input.date || existing.date).slice(0, 10),
        yard: input.yard !== undefined ? String(input.yard) : existing.yard,
        notes: input.notes !== undefined ? String(input.notes) : existing.notes,
        deduction,
        total_amount: totalAmount,
        currency: input.currency !== undefined ? String(input.currency) : existing.currency,
        metals,
      };

      this.db
        .prepare('INSERT OR REPLACE INTO pickups_enc (id, company_id, ciphertext) VALUES (?, ?, ?)')
        .run(updated.id, updated.company_id, encryptPayload(JSON.stringify(updated), this.key));

      return updated;
    });
  }

  public deletePickup(pickupId: number): { message: string; id: number } {
    return this.runInTransaction(() => {
      const row = this.db
        .prepare('SELECT id FROM pickups_enc WHERE id = ?')
        .get(pickupId) as { id: number } | undefined;
      if (!row) {
        throw new Error('Pickup not found');
      }
      this.db.prepare('DELETE FROM pickups_enc WHERE id = ?').run(pickupId);
      return { message: 'Pickup deleted successfully', id: pickupId };
    });
  }

  public getDeductionsByCompany(companyId: number): DeductionRecord[] {
    const rows = this.db
      .prepare('SELECT id, company_id, ciphertext FROM deductions_enc WHERE company_id = ? ORDER BY id ASC')
      .all(companyId) as Array<{ id: number; company_id: number; ciphertext: string }>;
    const list = rows.map(
      (r) => JSON.parse(decryptPayload(r.ciphertext, this.key)) as DeductionRecord
    );
    return list.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.id - b.id;
    });
  }

  public createDeduction(input: {
    company_id: number;
    date: string;
    amount: number;
    notes?: string;
    currency?: string;
  }): DeductionRecord {
    return this.runInTransaction(() => {
      const seq = parseInt(this.getMetaDecrypted('nextDeductionSeq', '1'), 10);
      this.setMetaEncrypted('nextDeductionSeq', String(seq + 1));

      const deduction: DeductionRecord = {
        id: seq,
        company_id: Number(input.company_id),
        date: String(input.date || new Date().toISOString().slice(0, 10)).slice(0, 10),
        amount: Math.round((Number(input.amount) || 0) * 100) / 100,
        notes: String(input.notes || ''),
        currency: String(input.currency || 'AUD$'),
      };

      this.db
        .prepare('INSERT OR REPLACE INTO deductions_enc (id, company_id, ciphertext) VALUES (?, ?, ?)')
        .run(deduction.id, deduction.company_id, encryptPayload(JSON.stringify(deduction), this.key));

      return deduction;
    });
  }

  public updateDeduction(
    deductionId: number,
    input: {
      date: string;
      amount: number;
      notes?: string;
      currency?: string;
    }
  ): DeductionRecord {
    return this.runInTransaction(() => {
      const row = this.db
        .prepare('SELECT id, company_id, ciphertext FROM deductions_enc WHERE id = ?')
        .get(deductionId) as { id: number; company_id: number; ciphertext: string } | undefined;
      if (!row) {
        throw new Error('Deduction not found');
      }
      const existing = JSON.parse(decryptPayload(row.ciphertext, this.key)) as DeductionRecord;

      const updated: DeductionRecord = {
        id: deductionId,
        company_id: existing.company_id,
        date: String(input.date || existing.date).slice(0, 10),
        amount: Math.round((Number(input.amount) || 0) * 100) / 100,
        notes: input.notes !== undefined ? String(input.notes) : existing.notes,
        currency: input.currency !== undefined ? String(input.currency) : existing.currency,
      };

      this.db
        .prepare('INSERT OR REPLACE INTO deductions_enc (id, company_id, ciphertext) VALUES (?, ?, ?)')
        .run(updated.id, updated.company_id, encryptPayload(JSON.stringify(updated), this.key));

      return updated;
    });
  }

  public deleteDeduction(deductionId: number): { message: string; id: number } {
    return this.runInTransaction(() => {
      const row = this.db
        .prepare('SELECT id FROM deductions_enc WHERE id = ?')
        .get(deductionId) as { id: number } | undefined;
      if (!row) {
        throw new Error('Deduction not found');
      }
      this.db.prepare('DELETE FROM deductions_enc WHERE id = ?').run(deductionId);
      return { message: 'Deduction deleted successfully', id: deductionId };
    });
  }

  public getYardOptions(): YardOptionRecord[] {
    const rows = this.db
      .prepare('SELECT id, ciphertext FROM yards_enc ORDER BY id ASC')
      .all() as Array<{ id: number; ciphertext: string }>;
    return rows.map((r) => JSON.parse(decryptPayload(r.ciphertext, this.key)) as YardOptionRecord);
  }

  public createYardOption(input: { name: string } | string): YardOptionRecord {
    const rawName = typeof input === 'string' ? input : input?.name;
    const cleanName = (rawName || '').trim();
    if (!cleanName) {
      throw new Error('Yard name cannot be empty');
    }
    return this.runInTransaction(() => {
      const existing = this.getYardOptions();
      if (existing.some((y) => y.name.toLowerCase() === cleanName.toLowerCase())) {
        throw new Error('Yard already exists');
      }
      const seq = parseInt(this.getMetaDecrypted('nextYardOptionSeq', '1'), 10);
      this.setMetaEncrypted('nextYardOptionSeq', String(seq + 1));
      const yard: YardOptionRecord = { id: seq, name: cleanName };
      this.db
        .prepare('INSERT OR REPLACE INTO yards_enc (id, ciphertext) VALUES (?, ?)')
        .run(yard.id, encryptPayload(JSON.stringify(yard), this.key));
      return yard;
    });
  }

  public updateYardOption(yardId: number, input: { name: string } | string): YardOptionRecord {
    const rawName = typeof input === 'string' ? input : input?.name;
    const cleanName = (rawName || '').trim();
    if (!cleanName) {
      throw new Error('Yard name cannot be empty');
    }
    return this.runInTransaction(() => {
      const existing = this.getYardOptions();
      const target = existing.find((y) => y.id === yardId);
      if (!target) {
        throw new Error('Yard not found');
      }
      const oldName = target.name;
      const updated: YardOptionRecord = { id: yardId, name: cleanName };
      this.db
        .prepare('INSERT OR REPLACE INTO yards_enc (id, ciphertext) VALUES (?, ?)')
        .run(yardId, encryptPayload(JSON.stringify(updated), this.key));

      // Cascade yard rename to all pickups
      if (oldName !== cleanName) {
        const pickupRows = this.db
          .prepare('SELECT id, company_id, ciphertext FROM pickups_enc')
          .all() as Array<{ id: number; company_id: number; ciphertext: string }>;
        for (const r of pickupRows) {
          const p = JSON.parse(decryptPayload(r.ciphertext, this.key)) as PickupRecord;
          if (p.yard === oldName) {
            p.yard = cleanName;
            this.db
              .prepare('UPDATE pickups_enc SET ciphertext = ? WHERE id = ?')
              .run(encryptPayload(JSON.stringify(p), this.key), p.id);
          } else if (p.yard && p.yard.startsWith(`${oldName}\n`)) {
            p.yard = `${cleanName}${p.yard.slice(oldName.length)}`;
            this.db
              .prepare('UPDATE pickups_enc SET ciphertext = ? WHERE id = ?')
              .run(encryptPayload(JSON.stringify(p), this.key), p.id);
          }
        }
      }

      return updated;
    });
  }

  public deleteYardOption(yardId: number): { message: string } {
    return this.runInTransaction(() => {
      this.db.prepare('DELETE FROM yards_enc WHERE id = ?').run(yardId);
      return { message: 'Yard deleted' };
    });
  }

  public getCurrencyOptions(): CurrencyOptionRecord[] {
    const rows = this.db
      .prepare('SELECT id, ciphertext FROM currencies_enc ORDER BY id ASC')
      .all() as Array<{ id: number; ciphertext: string }>;
    return rows.map((r) => JSON.parse(decryptPayload(r.ciphertext, this.key)) as CurrencyOptionRecord);
  }

  public createCurrencyOption(input: {
    code: string;
    symbol: string;
    label?: string;
  }): CurrencyOptionRecord {
    const code = (input.code || '').trim().toUpperCase();
    const symbol = (input.symbol || '').trim();
    const label = (input.label || `${code}${symbol}`).trim();
    if (!code || !symbol) {
      throw new Error('Currency code and symbol are required');
    }
    return this.runInTransaction(() => {
      const existing = this.getCurrencyOptions();
      if (existing.some((c) => c.code.toUpperCase() === code || c.label === label)) {
        throw new Error('Currency already exists');
      }
      const seq = parseInt(this.getMetaDecrypted('nextCurrencyOptionSeq', '1'), 10);
      this.setMetaEncrypted('nextCurrencyOptionSeq', String(seq + 1));
      const curr: CurrencyOptionRecord = { id: seq, code, symbol, label };
      this.db
        .prepare('INSERT OR REPLACE INTO currencies_enc (id, ciphertext) VALUES (?, ?)')
        .run(curr.id, encryptPayload(JSON.stringify(curr), this.key));
      return curr;
    });
  }

  public updateCurrencyOption(
    currId: number,
    input: { code: string; symbol: string; label?: string }
  ): CurrencyOptionRecord {
    const code = (input.code || '').trim().toUpperCase();
    const symbol = (input.symbol || '').trim();
    const label = (input.label || `${code}${symbol}`).trim();
    if (!code || !symbol) {
      throw new Error('Currency code and symbol are required');
    }
    return this.runInTransaction(() => {
      const existing = this.getCurrencyOptions();
      const target = existing.find((c) => c.id === currId);
      if (!target) {
        throw new Error('Currency not found');
      }
      const oldLabel = target.label;
      const oldSymbol = target.symbol;
      const updated: CurrencyOptionRecord = { id: currId, code, symbol, label };
      this.db
        .prepare('INSERT OR REPLACE INTO currencies_enc (id, ciphertext) VALUES (?, ?)')
        .run(currId, encryptPayload(JSON.stringify(updated), this.key));

      if (oldLabel !== label) {
        const pickupRows = this.db
          .prepare('SELECT id, company_id, ciphertext FROM pickups_enc')
          .all() as Array<{ id: number; company_id: number; ciphertext: string }>;
        for (const r of pickupRows) {
          const p = JSON.parse(decryptPayload(r.ciphertext, this.key)) as PickupRecord;
          if (p.currency === oldLabel || p.currency === oldSymbol) {
            p.currency = label;
            this.db
              .prepare('UPDATE pickups_enc SET ciphertext = ? WHERE id = ?')
              .run(encryptPayload(JSON.stringify(p), this.key), p.id);
          }
        }

        const deductionRows = this.db
          .prepare('SELECT id, company_id, ciphertext FROM deductions_enc')
          .all() as Array<{ id: number; company_id: number; ciphertext: string }>;
        for (const r of deductionRows) {
          const d = JSON.parse(decryptPayload(r.ciphertext, this.key)) as DeductionRecord;
          if (d.currency === oldLabel || d.currency === oldSymbol) {
            d.currency = label;
            this.db
              .prepare('UPDATE deductions_enc SET ciphertext = ? WHERE id = ?')
              .run(encryptPayload(JSON.stringify(d), this.key), d.id);
          }
        }
      }

      return updated;
    });
  }

  public deleteCurrencyOption(currId: number): { message: string } {
    return this.runInTransaction(() => {
      this.db.prepare('DELETE FROM currencies_enc WHERE id = ?').run(currId);
      return { message: 'Currency deleted' };
    });
  }

  public getUnitOptions(): UnitOptionRecord[] {
    const rows = this.db
      .prepare('SELECT id, ciphertext FROM units_enc ORDER BY id ASC')
      .all() as Array<{ id: number; ciphertext: string }>;
    return rows.map((r) => JSON.parse(decryptPayload(r.ciphertext, this.key)) as UnitOptionRecord);
  }

  public createUnitOption(input: { value: string; label?: string }): UnitOptionRecord {
    const value = (input.value || '').trim();
    const label = (input.label || value).trim();
    if (!value) {
      throw new Error('Unit value is required');
    }
    return this.runInTransaction(() => {
      const existing = this.getUnitOptions();
      if (existing.some((u) => u.value.toLowerCase() === value.toLowerCase())) {
        throw new Error('Unit already exists');
      }
      const seq = parseInt(this.getMetaDecrypted('nextUnitOptionSeq', '1'), 10);
      this.setMetaEncrypted('nextUnitOptionSeq', String(seq + 1));
      const unit: UnitOptionRecord = { id: seq, value, label };
      this.db
        .prepare('INSERT OR REPLACE INTO units_enc (id, ciphertext) VALUES (?, ?)')
        .run(unit.id, encryptPayload(JSON.stringify(unit), this.key));
      return unit;
    });
  }

  public updateUnitOption(
    unitId: number,
    input: { value: string; label?: string }
  ): UnitOptionRecord {
    const value = (input.value || '').trim();
    const label = (input.label || value).trim();
    if (!value) {
      throw new Error('Unit value is required');
    }
    return this.runInTransaction(() => {
      const existing = this.getUnitOptions();
      const target = existing.find((u) => u.id === unitId);
      if (!target) {
        throw new Error('Unit not found');
      }
      const oldValue = target.value;
      const updated: UnitOptionRecord = { id: unitId, value, label };
      this.db
        .prepare('INSERT OR REPLACE INTO units_enc (id, ciphertext) VALUES (?, ?)')
        .run(unitId, encryptPayload(JSON.stringify(updated), this.key));

      if (oldValue !== value) {
        const pickupRows = this.db
          .prepare('SELECT id, company_id, ciphertext FROM pickups_enc')
          .all() as Array<{ id: number; company_id: number; ciphertext: string }>;
        for (const r of pickupRows) {
          const p = JSON.parse(decryptPayload(r.ciphertext, this.key)) as PickupRecord;
          let changed = false;
          for (const m of p.metals || []) {
            if (m.weight_unit === oldValue) {
              m.weight_unit = value;
              changed = true;
            }
          }
          if (changed) {
            this.db
              .prepare('UPDATE pickups_enc SET ciphertext = ? WHERE id = ?')
              .run(encryptPayload(JSON.stringify(p), this.key), p.id);
          }
        }
      }

      return updated;
    });
  }

  public deleteUnitOption(unitId: number): { message: string } {
    return this.runInTransaction(() => {
      this.db.prepare('DELETE FROM units_enc WHERE id = ?').run(unitId);
      return { message: 'Unit deleted' };
    });
  }

  public getUniqueMetalNames(): string[] {
    const rows = this.db
      .prepare('SELECT ciphertext FROM pickups_enc')
      .all() as Array<{ ciphertext: string }>;
    const names = new Set<string>();
    for (const r of rows) {
      const p = JSON.parse(decryptPayload(r.ciphertext, this.key)) as PickupRecord;
      for (const m of p.metals || []) {
        if (m.metal_name && m.metal_name.trim()) {
          names.add(m.metal_name.trim());
        }
      }
    }
    return Array.from(names).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );
  }

  public exportMoneyTotalSheetDataset(): {
    companies: CompanyRecord[];
    pickups: PickupRecord[];
    deductions: DeductionRecord[];
    yards: YardOptionRecord[];
    currencies: CurrencyOptionRecord[];
    units: UnitOptionRecord[];
  } {
    const companies = this.getCompanies();
    const pickupRows = this.db
      .prepare('SELECT ciphertext FROM pickups_enc ORDER BY id ASC')
      .all() as Array<{ ciphertext: string }>;
    const pickups = pickupRows.map(
      (r) => JSON.parse(decryptPayload(r.ciphertext, this.key)) as PickupRecord
    );
    const deductionRows = this.db
      .prepare('SELECT ciphertext FROM deductions_enc ORDER BY id ASC')
      .all() as Array<{ ciphertext: string }>;
    const deductions = deductionRows.map(
      (r) => JSON.parse(decryptPayload(r.ciphertext, this.key)) as DeductionRecord
    );
    return {
      companies,
      pickups,
      deductions,
      yards: this.getYardOptions(),
      currencies: this.getCurrencyOptions(),
      units: this.getUnitOptions(),
    };
  }

  public importMoneyTotalSheetDataset(data: {
    companies: CompanyRecord[];
    pickups: PickupRecord[];
    deductions: DeductionRecord[];
    yards?: YardOptionRecord[];
    currencies?: CurrencyOptionRecord[];
    units?: UnitOptionRecord[];
  }): void {
    this.runInTransaction(() => {
      this.db.exec('DELETE FROM companies_enc;');
      this.db.exec('DELETE FROM pickups_enc;');
      this.db.exec('DELETE FROM deductions_enc;');

      let maxCompanyId = 0;
      const insertComp = this.db.prepare(
        'INSERT OR REPLACE INTO companies_enc (id, ciphertext) VALUES (?, ?)'
      );
      for (const c of data.companies || []) {
        if (c.id > maxCompanyId) maxCompanyId = c.id;
        insertComp.run(c.id, encryptPayload(JSON.stringify(c), this.key));
      }
      this.setMetaEncrypted('nextCompanySeq', String(maxCompanyId + 1));

      let maxPickupId = 0;
      let maxMetalId = 0;
      const insertPickup = this.db.prepare(
        'INSERT OR REPLACE INTO pickups_enc (id, company_id, ciphertext) VALUES (?, ?, ?)'
      );
      for (const p of data.pickups || []) {
        if (p.id > maxPickupId) maxPickupId = p.id;
        for (const m of p.metals || []) {
          if (m.id > maxMetalId) maxMetalId = m.id;
        }
        insertPickup.run(p.id, p.company_id, encryptPayload(JSON.stringify(p), this.key));
      }
      this.setMetaEncrypted('nextPickupSeq', String(maxPickupId + 1));
      this.setMetaEncrypted('nextMetalSeq', String(maxMetalId + 1));

      let maxDeductionId = 0;
      const insertDed = this.db.prepare(
        'INSERT OR REPLACE INTO deductions_enc (id, company_id, ciphertext) VALUES (?, ?, ?)'
      );
      for (const d of data.deductions || []) {
        if (d.id > maxDeductionId) maxDeductionId = d.id;
        insertDed.run(d.id, d.company_id, encryptPayload(JSON.stringify(d), this.key));
      }
      this.setMetaEncrypted('nextDeductionSeq', String(maxDeductionId + 1));

      if (data.yards && data.yards.length > 0) {
        this.db.exec('DELETE FROM yards_enc;');
        let maxYardId = 0;
        const insertYard = this.db.prepare(
          'INSERT OR REPLACE INTO yards_enc (id, ciphertext) VALUES (?, ?)'
        );
        for (const y of data.yards) {
          if (y.id > maxYardId) maxYardId = y.id;
          insertYard.run(y.id, encryptPayload(JSON.stringify(y), this.key));
        }
        this.setMetaEncrypted('nextYardOptionSeq', String(maxYardId + 1));
      }

      if (data.currencies && data.currencies.length > 0) {
        this.db.exec('DELETE FROM currencies_enc;');
        let maxCurrId = 0;
        const insertCurr = this.db.prepare(
          'INSERT OR REPLACE INTO currencies_enc (id, ciphertext) VALUES (?, ?)'
        );
        for (const c of data.currencies) {
          if (c.id > maxCurrId) maxCurrId = c.id;
          insertCurr.run(c.id, encryptPayload(JSON.stringify(c), this.key));
        }
        this.setMetaEncrypted('nextCurrencyOptionSeq', String(maxCurrId + 1));
      }

      if (data.units && data.units.length > 0) {
        this.db.exec('DELETE FROM units_enc;');
        let maxUnitId = 0;
        const insertUnit = this.db.prepare(
          'INSERT OR REPLACE INTO units_enc (id, ciphertext) VALUES (?, ?)'
        );
        for (const u of data.units) {
          if (u.id > maxUnitId) maxUnitId = u.id;
          insertUnit.run(u.id, encryptPayload(JSON.stringify(u), this.key));
        }
        this.setMetaEncrypted('nextUnitOptionSeq', String(maxUnitId + 1));
      }
    });
  }

  public exportBackupArchive(): string {
    const state = this.getAppState();
    const mtsDataset = this.exportMoneyTotalSheetDataset();
    const archivePayload = {
      version: '2.5.0',
      exportedAt: new Date().toISOString(),
      encrypted: true,
      ciphertext: encryptPayload(JSON.stringify({ ...state, mtsDataset }), this.key),
    };
    return JSON.stringify(archivePayload, null, 2);
  }

  public exportSqlDump(): string {
    const dataset = this.exportMoneyTotalSheetDataset();
    const esc = (val: string | number | null | undefined): string => {
      if (val === null || val === undefined) return '\\N';
      return String(val)
        .replace(/\\/g, '\\\\')
        .replace(/\t/g, '\\t')
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n');
    };

    const lines: string[] = [
      '--',
      '-- Money Total Sheet SQL Database Dump',
      `-- Exported at: ${new Date().toISOString()}`,
      '--',
      '',
    ];

    // 1. companies
    lines.push('COPY public.companies (id, name) FROM stdin;');
    for (const c of dataset.companies) {
      lines.push(`${c.id}\t${esc(c.name)}`);
    }
    lines.push('\\.', '');

    // 2. currency_options
    lines.push('COPY public.currency_options (id, code, symbol, label) FROM stdin;');
    for (const c of dataset.currencies) {
      lines.push(`${c.id}\t${esc(c.code)}\t${esc(c.symbol)}\t${esc(c.label)}`);
    }
    lines.push('\\.', '');

    // 3. unit_options
    lines.push('COPY public.unit_options (id, value, label) FROM stdin;');
    for (const u of dataset.units) {
      lines.push(`${u.id}\t${esc(u.value)}\t${esc(u.label)}`);
    }
    lines.push('\\.', '');

    // 4. yard_options
    lines.push('COPY public.yard_options (id, name) FROM stdin;');
    for (const y of dataset.yards) {
      lines.push(`${y.id}\t${esc(y.name)}`);
    }
    lines.push('\\.', '');

    // 5. pickups & metal_items
    lines.push(
      'COPY public.pickups (id, company_id, date, yard, notes, deduction, total_amount, currency) FROM stdin;'
    );
    const allMetals: MetalItemRecord[] = [];
    for (const p of dataset.pickups) {
      lines.push(
        `${p.id}\t${p.company_id}\t${esc(p.date)}\t${esc(p.yard)}\t${esc(p.notes || '')}\t${p.deduction ?? 0}\t${p.total_amount ?? 0}\t${esc(p.currency || 'AUD$')}`
      );
      if (Array.isArray(p.metals)) {
        for (const m of p.metals) {
          allMetals.push({
            ...m,
            pickup_id: p.id,
          });
        }
      }
    }
    lines.push('\\.', '');

    lines.push(
      'COPY public.metal_items (id, pickup_id, metal_name, net_weight, price_per_unit, total, weight_unit) FROM stdin;'
    );
    for (const [idx, m] of allMetals.entries()) {
      const mId = m.id || idx + 1;
      lines.push(
        `${mId}\t${m.pickup_id}\t${esc(m.metal_name)}\t${m.net_weight ?? 0}\t${m.price_per_unit ?? 0}\t${m.total ?? 0}\t${esc(m.weight_unit || 'kg')}`
      );
    }
    lines.push('\\.', '');

    // 6. deductions
    lines.push('COPY public.deductions (id, company_id, date, amount, notes, currency) FROM stdin;');
    for (const d of dataset.deductions) {
      lines.push(
        `${d.id}\t${d.company_id}\t${esc(d.date)}\t${d.amount ?? 0}\t${esc(d.notes || '')}\t${esc(d.currency || 'AUD$')}`
      );
    }
    lines.push('\\.', '');

    return lines.join('\n');
  }

  public clearDatabase(): AppState {
    return this.runInTransaction(() => {
      this.db.exec('DELETE FROM ledger_entries_enc;');
      this.db.exec('DELETE FROM customers_enc;');
      this.db.exec('DELETE FROM companies_enc;');
      this.db.exec('DELETE FROM pickups_enc;');
      this.db.exec('DELETE FROM deductions_enc;');
      this.db.exec('DELETE FROM yards_enc;');
      this.db.exec('DELETE FROM currencies_enc;');
      this.db.exec('DELETE FROM units_enc;');
      this.setMetaEncrypted('nextCustomerSeq', '1001');
      this.setMetaEncrypted('nextCompanySeq', '1');
      this.setMetaEncrypted('nextPickupSeq', '1');
      this.setMetaEncrypted('nextMetalSeq', '1');
      this.setMetaEncrypted('nextDeductionSeq', '1');
      this.setMetaEncrypted('nextYardOptionSeq', '1');
      this.setMetaEncrypted('nextCurrencyOptionSeq', '1');
      this.setMetaEncrypted('nextUnitOptionSeq', '1');
      return this.getAppState();
    });
  }

  private parseCustomerRowsFromTable(rows: string[][]): CustomerRecord[] {
    const importedCustomers: CustomerRecord[] = [];
    const existingYards = JSON.parse(
      this.getMetaDecrypted('yards', JSON.stringify(DEFAULT_YARDS))
    ) as string[];
    const defaultYardFallback = this.getMetaDecrypted(
      'defaultYard',
      existingYards[0] || 'North Yard'
    );

    let startRow = 0;
    let nameCol = 0;
    let yardCol = 1;
    let balCol = 2;
    let notesCol = 3;

    if (rows.length > 0) {
      const headerLower = rows[0].map((c) => (c || '').toLowerCase().trim());
      const hasHeader = headerLower.some(
        (h) =>
          h.includes('name') ||
          h.includes('customer') ||
          h.includes('balance') ||
          h.includes('yard') ||
          h.includes('amount')
      );
      if (hasHeader) {
        startRow = 1;
        const nIdx = headerLower.findIndex(
          (h) => h.includes('name') || (h.includes('customer') && !h.includes('id'))
        );
        const yIdx = headerLower.findIndex((h) => h.includes('yard') || h.includes('location'));
        const bIdx = headerLower.findIndex(
          (h) => h.includes('balance') || h.includes('amount') || h.includes('due')
        );
        const mIdx = headerLower.findIndex(
          (h) => h.includes('note') || h.includes('memo') || h.includes('phone') || h.includes('contact')
        );
        if (nIdx !== -1) nameCol = nIdx;
        if (yIdx !== -1) yardCol = yIdx;
        if (bIdx !== -1) balCol = bIdx;
        if (mIdx !== -1) notesCol = mIdx;
      } else if (rows[0][0]?.startsWith('CUST-')) {
        nameCol = 1;
        yardCol = 2;
        balCol = 3;
        notesCol = 4;
      }
    }

    let seq = parseInt(this.getMetaDecrypted('nextCustomerSeq', '1007'), 10);
    for (let i = startRow; i < rows.length; i++) {
      const cols = rows[i].map((c) => (c || '').trim());
      if (cols.length === 0 || cols.every((c) => !c)) continue;

      let name = cols[nameCol] || '';
      let yard = cols[yardCol] || defaultYardFallback;
      let rawBal = cols[balCol] ?? '0';
      let notes = cols[notesCol] || '';

      if (cols.length === 2 && !Number.isNaN(parseFloat(cols[1].replace(/[^0-9.-]/g, '')))) {
        name = cols[0];
        rawBal = cols[1];
        yard = defaultYardFallback;
        notes = '';
      }

      if (!name) continue;
      const cleanBal = parseFloat(String(rawBal).replace(/[^0-9.-]/g, '')) || 0;
      const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const id = `CUST-${seq++}`;

      if (yard && !existingYards.includes(yard)) {
        existingYards.push(yard);
      }

      importedCustomers.push({
        id,
        name,
        defaultYard: yard,
        balance: cleanBal,
        lastUpdate: now,
        phone: notes,
        notes,
        ledger: [
          {
            date: now,
            invoice: cleanBal > 0 ? cleanBal : 0,
            paid: cleanBal < 0 ? Math.abs(cleanBal) : 0,
            method: cleanBal < 0 ? 'Cash' : 'Unpaid Due',
            yard,
            memo: notes || 'Imported from Excel',
            runningBalance: cleanBal,
          },
        ],
      });
    }

    this.setMetaEncrypted('nextCustomerSeq', String(seq));
    this.setMetaEncrypted('yards', JSON.stringify(existingYards));
    return importedCustomers;
  }

  public importBackupArchive(rawContent: string, fileName?: string): AppState {
    return this.runInTransaction(() => {
      let stateToRestore: (Partial<AppState> & {
        mtsDataset?: {
          companies: CompanyRecord[];
          pickups: PickupRecord[];
          deductions: DeductionRecord[];
          yards?: YardOptionRecord[];
          currencies?: CurrencyOptionRecord[];
          units?: UnitOptionRecord[];
        };
      }) | null = null;
      const trimmed = rawContent.trim();
      const existingYards = JSON.parse(
        this.getMetaDecrypted('yards', JSON.stringify(DEFAULT_YARDS))
      ) as string[];
      const defaultYardFallback = this.getMetaDecrypted(
        'defaultYard',
        existingYards[0] || 'North Yard'
      );

      const restoreFromXlsxBuffer = (buf: Buffer) => {
        const multiTabCustomers = parseXlsxCustomerAccounts(buf, defaultYardFallback);
        if (multiTabCustomers.length > 0) {
          const existing = this.getAppState();
          stateToRestore = {
            ...existing,
            customers: multiTabCustomers,
          };
        } else {
          const tableRows = parseXlsxBuffer(buf);
          const importedCustomers = this.parseCustomerRowsFromTable(tableRows);
          if (importedCustomers.length > 0) {
            const existing = this.getAppState();
            stateToRestore = {
              ...existing,
              customers: importedCustomers,
            };
          }
        }
      };

      // Check if base64 Data URL or PKZIP binary (.xlsx)
      if (trimmed.startsWith('data:') && trimmed.includes(';base64,')) {
        const b64 = trimmed.split(';base64,')[1];
        const buf = Buffer.from(b64, 'base64');
        if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) {
          restoreFromXlsxBuffer(buf);
        } else {
          return this.importBackupArchive(buf.toString('utf8'), fileName);
        }
      } else if (trimmed.startsWith('UEsDB')) {
        const buf = Buffer.from(trimmed, 'base64');
        restoreFromXlsxBuffer(buf);
      } else if (trimmed.startsWith('{')) {
        const parsed = JSON.parse(trimmed) as {
          ciphertext?: string;
          customers?: CustomerRecord[];
          yards?: string[];
          currentCurrency?: string;
          language?: string;
          mtsDataset?: {
            companies: CompanyRecord[];
            pickups: PickupRecord[];
            deductions: DeductionRecord[];
            yards?: YardOptionRecord[];
            currencies?: CurrencyOptionRecord[];
            units?: UnitOptionRecord[];
          };
        };
        if (parsed.ciphertext) {
          stateToRestore = JSON.parse(decryptPayload(parsed.ciphertext, this.key));
        } else if (Array.isArray(parsed.customers) || parsed.mtsDataset) {
          stateToRestore = parsed;
        }
      } else if (isSqlDumpContent(trimmed, fileName)) {
        const sqlDataset = parseSqlDumpDataset(trimmed);
        if (
          sqlDataset.companies.length > 0 ||
          sqlDataset.pickups.length > 0 ||
          sqlDataset.deductions.length > 0
        ) {
          const existing = this.getAppState();
          stateToRestore = {
            ...existing,
            mtsDataset: sqlDataset,
          };
        } else {
          throw new Error('No valid companies, pickups, or deductions found in SQL file.');
        }
      } else {
        const tableRows = parseCsvRows(trimmed);
        if (tableRows.length > 0) {
          const header = tableRows[0].map((h) => (h || '').trim().toLowerCase());
          const hasDate = header.some((h) => h.includes('date'));
          const hasTotalOrPaid = header.some(
            (h) =>
              h.includes('total') ||
              h.includes('paid') ||
              h.includes('invoice') ||
              h.includes('due') ||
              h.includes('payment')
          );
          const hasCustCol = header.some(
            (h) => h === 'customer' || h === 'name' || (h.includes('customer') && !h.includes('id'))
          );

          if (hasDate && (hasTotalOrPaid || hasCustCol)) {
            const defaultCustName = fileName ? fileName.replace(/\.[^/.]+$/, '').trim() : 'Imported Customer';
            const importedCustomers = parseCsvCustomerAccounts(trimmed, defaultYardFallback, defaultCustName);
            if (importedCustomers.length > 0) {
              const existing = this.getAppState();
              stateToRestore = {
                ...existing,
                customers: importedCustomers,
              };
            }
          } else {
            const importedCustomers = this.parseCustomerRowsFromTable(tableRows);
            if (importedCustomers.length > 0) {
              const existing = this.getAppState();
              const existingNonDup = existing.customers.filter(
                (ec) => !importedCustomers.some((ic) => ic.name.toLowerCase() === ec.name.toLowerCase())
              );
              stateToRestore = {
                ...existing,
                customers: [...importedCustomers, ...existingNonDup],
              };
            }
          }
        }
      }

      if (stateToRestore) {
        if (stateToRestore.mtsDataset) {
          this.importMoneyTotalSheetDataset(stateToRestore.mtsDataset);
        }
        if (Array.isArray(stateToRestore.customers)) {
          if (stateToRestore.yards && Array.isArray(stateToRestore.yards)) {
            this.setMetaEncrypted('yards', JSON.stringify(stateToRestore.yards));
          }
          if (stateToRestore.defaultYard) {
            this.setMetaEncrypted('defaultYard', stateToRestore.defaultYard);
          }
          if (stateToRestore.currentCurrency) {
            this.setMetaEncrypted('currentCurrency', stateToRestore.currentCurrency);
          }
          if (stateToRestore.language) {
            this.setMetaEncrypted('language', stateToRestore.language);
          }
          this.db.exec('DELETE FROM ledger_entries_enc;');
          this.db.exec('DELETE FROM customers_enc;');
          stateToRestore.customers.forEach((c, idx) => {
            c.id = `CUST-${1001 + idx}`;
            this.insertCustomerInternal(c, idx + 1);
          });
          this.setMetaEncrypted('nextCustomerSeq', String(1001 + stateToRestore.customers.length));
        }
      }

      return this.getAppState();
    });
  }

  public importSqlDump(sqlText: string): {
    companies: number;
    pickups: number;
    metals: number;
    deductions: number;
    yards: number;
    currencies: number;
    units: number;
  } {
    const dataset = parseSqlDumpDataset(sqlText);
    if (
      dataset.companies.length === 0 &&
      dataset.pickups.length === 0 &&
      dataset.deductions.length === 0
    ) {
      throw new Error('No valid companies, pickups, or deductions found in SQL file.');
    }
    this.importMoneyTotalSheetDataset(dataset);
    return {
      companies: dataset.companies.length,
      pickups: dataset.pickups.length,
      metals: dataset.pickups.reduce((acc, p) => acc + (p.metals ? p.metals.length : 0), 0),
      deductions: dataset.deductions.length,
      yards: dataset.yards.length,
      currencies: dataset.currencies.length,
      units: dataset.units.length,
    };
  }

  public close(): void {
    if (!this.closed) {
      try {
        this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      } catch {
        // Ignore checkpoint error if already closed
      }
      this.db.close();
      this.closed = true;
    }
  }
}

let activeInstance: LedgerDatabase | null = null;
let shutdownHooksRegistered = false;

export function resolvePortablePaths(rootDir?: string): {
  root: string;
  secretsDir: string;
  keyFile: string;
  envelopeFile: string;
  dataDir: string;
  dbFile: string;
} {
  let cwd = rootDir || process.env.ADM_ROOT_DIR || process.cwd();
  if (cwd.endsWith('.sqlite') || cwd.endsWith('.db')) {
    const parent = path.dirname(cwd);
    cwd = path.basename(parent) === 'data' ? path.dirname(parent) : parent;
  }
  const baseRoot =
    path.basename(cwd) === 'frontend' || path.basename(cwd) === 'backend' || path.basename(cwd) === 'data'
      ? path.resolve(cwd, '..')
      : cwd;
  const secretsDir = path.join(baseRoot, 'secrets');
  const keyFile = path.join(secretsDir, 'usb_master.key');
  const envelopeFile = path.join(secretsDir, 'master_key_envelope.json');
  const dataDir = path.join(baseRoot, 'data');
  const dbFile = path.join(dataDir, 'accounts_dues.sqlite');
  return { root: baseRoot, secretsDir, keyFile, envelopeFile, dataDir, dbFile };
}

export function getOrCreateEncryptionKey(rootDir?: string): string {
  if (process.env.ADM_ENCRYPTION_KEY) {
    return process.env.ADM_ENCRYPTION_KEY;
  }
  if (sessionMasterKey) {
    return sessionMasterKey;
  }
  const { secretsDir, keyFile, envelopeFile } = resolvePortablePaths(rootDir);
  const envelope = loadKeyEnvelope(envelopeFile);
  if (envelope && envelope.isConfigured) {
    const err = new Error('Database is locked. Supervisor password required.') as Error & {
      code?: string;
    };
    err.code = 'ERR_DATABASE_LOCKED';
    throw err;
  }
  if (!fs.existsSync(secretsDir)) {
    fs.mkdirSync(secretsDir, { recursive: true });
  }
  if (fs.existsSync(keyFile)) {
    return fs.readFileSync(keyFile, 'utf8').trim();
  }
  const generatedKey = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(keyFile, generatedKey, { mode: 0o600 });
  return generatedKey;
}

export function getLedgerDatabase(rootDir?: string): LedgerDatabase {
  if (activeInstance && !activeInstance.isHealthy()) {
    try {
      activeInstance.close();
    } catch {}
    activeInstance = null;
  }

  if (!activeInstance) {
    const { dbFile } = resolvePortablePaths(rootDir);
    const encryptionKey = getOrCreateEncryptionKey(rootDir);
    activeInstance = new LedgerDatabase({ dbPath: dbFile, encryptionKey, rootDir });

    if (!shutdownHooksRegistered) {
      shutdownHooksRegistered = true;
      const gracefulClose = () => {
        if (activeInstance) {
          activeInstance.close();
          activeInstance = null;
        }
      };
      process.once('SIGINT', gracefulClose);
      process.once('SIGTERM', gracefulClose);
      process.once('beforeExit', gracefulClose);
    }
  }
  return activeInstance;
}
