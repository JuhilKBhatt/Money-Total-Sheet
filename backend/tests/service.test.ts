import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LedgerDatabase } from '../src/database.ts';
import * as serviceModule from '../src/service.ts';

describe('Backend Service Dispatcher', () => {
  let tempDir: string;
  let db: LedgerDatabase;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-svc-test-'));
    db = new LedgerDatabase({
      dbPath: path.join(tempDir, 'svc.sqlite'),
      encryptionKey: 'svc-test-key',
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('Given a valid LedgerDatabase When dispatchLedgerAction is called with customer, ledger, and yard actions Then it returns updated state and action result', () => {
    const dispatch = (serviceModule as Record<string, unknown>).dispatchLedgerAction as (
      db: LedgerDatabase,
      action: string,
      payload: Record<string, unknown>
    ) => { ok: boolean; state?: { customers: Array<{ id: string; balance: number }>; yards: string[] }; data?: unknown };
    assert.equal(typeof dispatch, 'function', 'dispatchLedgerAction should be a function');

    const setupRes = dispatch(db, 'setupPasscode', {
      passcode: 'admin123',
      hintQuestion: 'Default demo?',
      hintAnswer: 'admin123',
    });
    assert.equal(setupRes.ok, true);

    const authRes = dispatch(db, 'verifyPasscode', { passcode: 'admin123' });
    assert.equal(authRes.ok, true);

    const badReset = dispatch(db, 'resetPasscode', { oldPasscode: 'wrong' });
    assert.equal(badReset.ok, false);

    const resetPassRes = dispatch(db, 'resetPasscode', { oldPasscode: 'admin123' });
    assert.equal(resetPassRes.ok, true);
    assert.equal(db.getAppState().authStatus.isConfigured, false);

    dispatch(db, 'setupPasscode', {
      passcode: 'admin123',
      hintQuestion: 'Default demo?',
    });

    const createRes = dispatch(db, 'createCustomer', {
      name: 'Pacific Metals',
      defaultYard: 'North Yard',
      balance: 1200,
      notes: 'VIP supplier',
    });
    assert.equal(createRes.ok, true);
    assert.equal(createRes.state?.customers.length, 1);

    // Deleting a customer without typing "delete" must be rejected
    const rejectDelCust = dispatch(db, 'deleteCustomer', {
      customerId: 'CUST-1001',
      confirmation: 'cancel',
    });
    assert.equal(rejectDelCust.ok, false);
    assert.equal(db.getAppState().customers.length, 1);

    const entryRes = dispatch(db, 'addLedgerEntry', {
      customerId: 'CUST-1001',
      entryType: 'payment',
      amount: 200,
      method: 'Bank Account',
      yard: 'North Yard',
      memo: 'Partial bank transfer',
    });
    assert.equal(entryRes.ok, true);
    const updated = entryRes.state?.customers.find((c) => c.id === 'CUST-1001');
    assert.equal(updated?.balance, 1000);

    // Paying everything remaining via payFull: true settles the balance to 0
    const payFullRes = dispatch(db, 'addLedgerEntry', {
      customerId: 'CUST-1001',
      payFull: true,
      method: 'Cash',
      yard: 'North Yard',
    });
    assert.equal(payFullRes.ok, true);
    const settled = payFullRes.state?.customers.find((c) => c.id === 'CUST-1001');
    assert.equal(settled?.balance, 0);

    // Deleting customer with confirmation "delete" succeeds
    const okDelCust = dispatch(db, 'deleteCustomer', {
      customerId: 'CUST-1001',
      confirmation: 'delete',
    });
    assert.equal(okDelCust.ok, true);
    assert.equal(okDelCust.state?.customers.length, 0);

    dispatch(db, 'createCustomer', {
      name: 'Second Customer',
      defaultYard: 'East Yard',
      balance: 500,
    });

    // Calling clearDatabase without typing "delete" must be rejected
    const rejectedClearRes = dispatch(db, 'clearDatabase', { confirmation: 'no' });
    assert.equal(rejectedClearRes.ok, false);
    assert.equal(db.getAppState().customers.length, 1);

    // Calling clearDatabase with confirmation "delete" succeeds
    const clearRes = dispatch(db, 'clearDatabase', { confirmation: 'delete' });
    assert.equal(clearRes.ok, true);
    assert.equal(clearRes.state?.customers.length, 0);
  });

  it('Given dispatchLedgerAction When setupPasscode has confirm password and recoverPasscode is executed Then password updates and recovery codes are managed', () => {
    const dispatch = (serviceModule as Record<string, unknown>).dispatchLedgerAction as (
      db: LedgerDatabase,
      action: string,
      payload: Record<string, unknown>
    ) => { ok: boolean; data?: any; error?: string };

    // 1. Password mismatch fails
    const mismatchRes = dispatch(db, 'setupPasscode', {
      passcode: 'pass123',
      confirmPasscode: 'different',
      hintQuestion: 'My favorite city?',
    });
    assert.equal(mismatchRes.ok, false);
    assert.match(mismatchRes.error || '', /passwords do not match/i);

    // 2. Matching setup succeeds and returns 4 recovery codes
    const setupRes = dispatch(db, 'setupPasscode', {
      passcode: 'pass123',
      confirmPasscode: 'pass123',
      hintQuestion: 'My favorite city?',
    });
    assert.equal(setupRes.ok, true);
    assert.ok(Array.isArray(setupRes.data?.recoveryCodes));
    assert.equal(setupRes.data?.recoveryCodes.length, 4);
    const codes = setupRes.data?.recoveryCodes;

    // 3. View recovery codes with correct password
    const viewRes = dispatch(db, 'getRecoveryCodes', { passcode: 'pass123' });
    assert.equal(viewRes.ok, true);
    assert.deepEqual(viewRes.data?.recoveryCodes, codes);

    // 4. Recover password with recovery code
    const recoverRes = dispatch(db, 'recoverPasscode', {
      recoveryCode: codes[0],
      newPasscode: 'brandNew456',
      confirmPasscode: 'brandNew456',
    });
    assert.equal(recoverRes.ok, true);

    const loginWithNew = dispatch(db, 'verifyPasscode', { passcode: 'brandNew456' });
    assert.equal(loginWithNew.ok, true);

    const loginWithOld = dispatch(db, 'verifyPasscode', { passcode: 'pass123' });
    assert.equal(loginWithOld.ok, false);
  });
});

