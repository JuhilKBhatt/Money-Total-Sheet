import fs from 'node:fs';
import { exec } from 'node:child_process';
import type http from 'node:http';
import {
  resolvePortablePaths,
  clearAllBrowserSessions,
  clearSessionMasterKey,
  type LedgerDatabase,
} from './database.ts';

let simulatedRemoval = false;

export function simulateUsbRemoval(simulated: boolean): void {
  simulatedRemoval = simulated;
}

export function isUsbRemovalSimulated(): boolean {
  return simulatedRemoval;
}

/**
 * Checks if the portable USB storage media is currently mounted, present, and accessible.
 */
export function isUsbConnected(rootDir?: string): boolean {
  if (simulatedRemoval) {
    return false;
  }
  if (process.env.ADM_SIMULATE_USB_REMOVAL === 'true') {
    return false;
  }

  try {
    const { root, secretsDir, keyFile } = resolvePortablePaths(rootDir);
    const canaryPath = process.env.ADM_USB_CANARY_PATH || keyFile;

    // 1. Verify root directory is present and is a directory
    if (!fs.existsSync(root)) {
      return false;
    }
    const rootStat = fs.statSync(root);
    if (!rootStat.isDirectory()) {
      return false;
    }

    // 2. Verify secretsDir is present
    if (!fs.existsSync(secretsDir)) {
      return false;
    }

    // 3. Verify canary/key file readability or secretsDir accessibility
    if (fs.existsSync(canaryPath)) {
      fs.accessSync(canaryPath, fs.constants.R_OK);
    } else {
      fs.accessSync(secretsDir, fs.constants.R_OK | fs.constants.W_OK);
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Executes host OS commands to close browser windows or tabs viewing the application.
 */
export function closeHostBrowserWindows(port = 3002): void {
  try {
    if (process.platform === 'darwin') {
      const script = `
        try
          tell application "Google Chrome"
            if it is running then
              close (every tab of every window whose URL starts with "http://localhost:${port}" or URL starts with "http://127.0.0.1:${port}")
            end if
          end tell
        end try
        try
          tell application "Safari"
            if it is running then
              close (every tab of every window whose URL starts with "http://localhost:${port}" or URL starts with "http://127.0.0.1:${port}")
            end if
          end tell
        end try
        try
          tell application "Brave Browser"
            if it is running then
              close (every tab of every window whose URL starts with "http://localhost:${port}" or URL starts with "http://127.0.0.1:${port}")
            end if
          end tell
        end try
        try
          tell application "Microsoft Edge"
            if it is running then
              close (every tab of every window whose URL starts with "http://localhost:${port}" or URL starts with "http://127.0.0.1:${port}")
            end if
          end tell
        end try
      `;
      exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, () => {});
    }
  } catch {
    // Non-blocking best effort
  }
}

export interface UsbRemovalOptions {
  db?: LedgerDatabase;
  server?: http.Server;
  port?: number;
  closeBrowser?: boolean;
  exitProcess?: boolean;
  onRemoval?: () => void;
}

/**
 * Handles the emergency shutdown procedure when the USB storage drive is disconnected.
 */
export function handleUsbRemoval(options: UsbRemovalOptions = {}): void {
  console.warn('[USB Heartbeat] WARNING: Portable USB drive has been disconnected or removed!');

  if (typeof options.onRemoval === 'function') {
    try {
      options.onRemoval();
    } catch (e) {
      console.error('[USB Heartbeat] onRemoval callback error:', e);
    }
  }

  // Flush SQLite WAL and close database cleanly to prevent corruption
  if (options.db) {
    try {
      options.db.close();
    } catch (e) {
      console.error('[USB Heartbeat] Database close error:', e);
    }
  }

  // Clear in-memory session keys and active browser sessions immediately
  clearSessionMasterKey();
  clearAllBrowserSessions();

  // Close browser tabs/windows
  if (options.closeBrowser !== false) {
    closeHostBrowserWindows(options.port || 3002);
  }

  // Close HTTP server if provided
  if (options.server) {
    try {
      options.server.close();
    } catch {}
  }

  // Terminate backend process
  if (options.exitProcess !== false) {
    setTimeout(() => {
      process.exit(0);
    }, 400);
  }
}

export interface HeartbeatMonitor {
  stop: () => void;
  checkNow: () => boolean;
}

/**
 * Starts a recurring background heartbeat monitor that checks if the USB drive is plugged in.
 */
export function startUsbHeartbeat(options: {
  db?: LedgerDatabase;
  server?: http.Server;
  rootDir?: string;
  intervalMs?: number;
  port?: number;
  closeBrowser?: boolean;
  exitProcess?: boolean;
  onRemoval?: () => void;
}): HeartbeatMonitor {
  const interval = options.intervalMs || 1500;
  let active = true;

  const performCheck = (): boolean => {
    if (!active) return false;
    const connected = isUsbConnected(options.rootDir);
    if (!connected) {
      active = false;
      clearInterval(timer);
      handleUsbRemoval({
        db: options.db,
        server: options.server,
        port: options.port,
        closeBrowser: options.closeBrowser,
        exitProcess: options.exitProcess,
        onRemoval: options.onRemoval,
      });
      return false;
    }
    return true;
  };

  const timer = setInterval(performCheck, interval);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  return {
    stop: () => {
      active = false;
      clearInterval(timer);
    },
    checkNow: () => performCheck(),
  };
}

