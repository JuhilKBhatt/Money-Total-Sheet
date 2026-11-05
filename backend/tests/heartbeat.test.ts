import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  isUsbConnected,
  simulateUsbRemoval,
  startUsbHeartbeat,
  handleUsbRemoval,
  closeHostBrowserWindows,
} from '../src/heartbeat.ts';
import { LedgerDatabase } from '../src/database.ts';
import { dispatchLedgerAction } from '../src/service.ts';
import { handleHttpRequest } from '../src/server.ts';

describe('USB Heartbeat & Emergency Disconnect Detection', () => {
  const testDir = path.join(os.tmpdir(), `adm_heartbeat_test_${Date.now()}`);
  const secretsDir = path.join(testDir, 'secrets');
  const dataDir = path.join(testDir, 'data');
  const keyFile = path.join(secretsDir, 'usb_master.key');

  it('Given an accessible portable USB root directory When isUsbConnected is called Then it returns true', () => {
    fs.mkdirSync(secretsDir, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(keyFile, 'test-key-32-chars-long-abcdef12');

    simulateUsbRemoval(false);
    assert.equal(isUsbConnected(testDir), true, 'USB should be reported as connected when directory exists');
  });

  it('Given a simulated USB unplug event When isUsbConnected is called Then it returns false', () => {
    simulateUsbRemoval(true);
    assert.equal(isUsbConnected(testDir), false, 'USB must be reported as disconnected when removal is simulated');
    simulateUsbRemoval(false);
  });

  it('Given a nonexistent or unmounted root path When isUsbConnected is called Then it returns false', () => {
    const missingDir = path.join(os.tmpdir(), `nonexistent_usb_${Date.now()}`);
    assert.equal(isUsbConnected(missingDir), false, 'Missing USB path must return false');
  });

  it('Given an active database When USB removal occurs Then handleUsbRemoval closes the database cleanly', () => {
    const dbFile = path.join(dataDir, 'test_hb.sqlite');
    const db = new LedgerDatabase({ dbPath: dbFile, encryptionKey: 'test-key-32-chars-long-abcdef12' });
    assert.equal((db as any).closed, false);

    let removalTriggered = false;
    handleUsbRemoval({
      db,
      closeBrowser: false,
      exitProcess: false,
      onRemoval: () => {
        removalTriggered = true;
      },
    });

    assert.equal((db as any).closed, true, 'Database must be closed upon USB removal');
    assert.equal(removalTriggered, true, 'onRemoval callback must be triggered');
  });

  it('Given a running heartbeat timer When USB is disconnected Then onRemoval is invoked and timer stops', async () => {
    let called = false;
    simulateUsbRemoval(true);

    const hb = startUsbHeartbeat({
      rootDir: testDir,
      intervalMs: 50,
      exitOnRemoval: false,
      closeBrowser: false,
      onRemoval: () => {
        called = true;
      },
    });

    await new Promise((r) => setTimeout(r, 120));
    hb.stop();
    simulateUsbRemoval(false);

    assert.equal(called, true, 'startUsbHeartbeat must trigger onRemoval when USB disconnects');
  });

  it('Given handleHttpRequest When GET /api/heartbeat is queried Then it returns connection status and HTTP codes', () => {
    const dbFile = path.join(dataDir, 'test_hb2.sqlite');
    const db = new LedgerDatabase({ dbPath: dbFile, encryptionKey: 'test-key-32-chars-long-abcdef12' });

    simulateUsbRemoval(false);
    const resConnected = handleHttpRequest(db, { method: 'GET', pathname: '/api/heartbeat' }, testDir);
    assert.equal(resConnected.status, 200);
    const jsonConnected = JSON.parse(resConnected.body);
    assert.equal(jsonConnected.ok, true);
    assert.equal(jsonConnected.connected, true);

    simulateUsbRemoval(true);
    const resDisconnected = handleHttpRequest(db, { method: 'GET', pathname: '/api/heartbeat' }, testDir);
    assert.equal(resDisconnected.status, 410);
    const jsonDisconnected = JSON.parse(resDisconnected.body);
    assert.equal(jsonDisconnected.ok, false);
    assert.equal(jsonDisconnected.connected, false);

    simulateUsbRemoval(false);
    db.close();
  });

  it('Given dispatchLedgerAction When heartbeat action is dispatched Then it returns live USB status', () => {
    const dbFile = path.join(dataDir, 'test_hb3.sqlite');
    const db = new LedgerDatabase({ dbPath: dbFile, encryptionKey: 'test-key-32-chars-long-abcdef12' });

    simulateUsbRemoval(false);
    const res = dispatchLedgerAction(db, 'heartbeat');
    assert.equal(res.ok, true);
    assert.equal((res as any).connected, true);

    simulateUsbRemoval(true);
    const resRemoved = dispatchLedgerAction(db, 'heartbeat');
    assert.equal(resRemoved.ok, false);
    assert.equal((resRemoved as any).connected, false);

    simulateUsbRemoval(false);
    db.close();
  });

  it('Given closeHostBrowserWindows function When called Then it executes without throwing errors', () => {
    assert.doesNotThrow(() => {
      closeHostBrowserWindows(3002);
    });
  });
});

