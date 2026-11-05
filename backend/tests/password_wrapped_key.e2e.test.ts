import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  clearSessionMasterKey,
  isDatabaseLocked,
  loadKeyEnvelope,
  resolvePortablePaths,
  resetFailedUnlockAttempts,
} from '../src/database.ts';
import { handleHttpRequest } from '../src/server.ts';

describe('Password-Wrapped Master Key End-to-End Workflow', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-wrapped-key-e2e-'));
    clearSessionMasterKey();
    resetFailedUnlockAttempts(tempDir);
  });

  afterEach(() => {
    clearSessionMasterKey();
    resetFailedUnlockAttempts(tempDir);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('Given a fresh USB When setupPasscode is called Then key is wrapped into envelope and plaintext key file is removed', () => {
    // 1. Initial status before setup: not locked, not configured
    const initialGet = handleHttpRequest(null, { method: 'GET', pathname: '/api/ledger' }, tempDir);
    assert.equal(initialGet.status, 200);
    const initialJson = JSON.parse(initialGet.body);
    assert.equal(initialJson.state.authStatus.isConfigured, false);

    // 2. Perform first-time supervisor setup
    const setupRes = handleHttpRequest(
      null,
      {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'setupPasscode',
          payload: {
            passcode: 'SuperSecret123!',
            confirmPasscode: 'SuperSecret123!',
            hintQuestion: 'Where did you grow up?',
            hintAnswer: '',
          },
        }),
      },
      tempDir
    );
    assert.equal(setupRes.status, 200);
    const setupJson = JSON.parse(setupRes.body);
    assert.equal(setupJson.ok, true);
    assert.equal(setupJson.data.recoveryCodes.length, 4);

    const { keyFile, envelopeFile } = resolvePortablePaths(tempDir);

    // 3. Verify master_key_envelope.json exists and usb_master.key does NOT exist
    assert.equal(fs.existsSync(envelopeFile), true, 'master_key_envelope.json must be created');
    assert.equal(fs.existsSync(keyFile), false, 'usb_master.key must NOT exist on disk after setup');

    // 4. Verify envelope contains encrypted envelope structure, not plaintext key or password
    const envContent = fs.readFileSync(envelopeFile, 'utf8');
    assert.equal(envContent.includes('SuperSecret123!'), false, 'Password must not be in envelope');
    const envelope = loadKeyEnvelope(envelopeFile);
    assert.ok(envelope);
    assert.equal(envelope.isConfigured, true);
    assert.equal(envelope.recoveryEnvelopes.length, 4);

    // 5. Create customer and transaction
    const custRes = handleHttpRequest(
      null,
      {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'createCustomer',
          payload: {
            name: 'Kabul Metal Works',
            balance: 5000,
            notes: 'High volume client',
          },
        }),
      },
      tempDir
    );
    assert.equal(custRes.status, 200);

    // 6. Simulate USB disconnect or system reboot: clear session key from RAM
    clearSessionMasterKey();
    assert.equal(isDatabaseLocked(tempDir), true, 'Database must be locked after server restart');

    // 7. GET /api/ledger while locked does not leak customer records
    const lockedGet = handleHttpRequest(null, { method: 'GET', pathname: '/api/ledger' }, tempDir);
    assert.equal(lockedGet.status, 200);
    const lockedJson = JSON.parse(lockedGet.body);
    assert.equal(lockedJson.locked, true);
    assert.equal(lockedJson.state.customers.length, 0, 'No customers can be returned when locked');
    assert.equal(lockedJson.state.authStatus.hintQuestion, 'Where did you grow up?');

    // 8. Test 5 failed login attempts trigger lockout
    for (let attempt = 1; attempt <= 4; attempt++) {
      const wrongRes = handleHttpRequest(
        null,
        {
          method: 'POST',
          pathname: '/api/ledger',
          body: JSON.stringify({
            action: 'verifyPasscode',
            payload: { passcode: 'WrongPass' + attempt },
          }),
        },
        tempDir
      );
      assert.equal(wrongRes.status, 401);
      const wrongJson = JSON.parse(wrongRes.body);
      assert.equal(wrongJson.locked, true);
      assert.equal(wrongJson.attemptsRemaining, 5 - attempt);
    }

    // 5th failed attempt locks out
    const fifthWrong = handleHttpRequest(
      null,
      {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'verifyPasscode',
          payload: { passcode: 'WrongPass5' },
        }),
      },
      tempDir
    );
    assert.equal(fifthWrong.status, 401);
    const fifthJson = JSON.parse(fifthWrong.body);
    assert.equal(fifthJson.lockout, true);
    assert.ok(fifthJson.remainingSeconds > 0);

    // 9. Reset lockout for testing recovery flow
    resetFailedUnlockAttempts(tempDir);

    // 10. Recover using first recovery code
    const recoveryCode = setupJson.data.recoveryCodes[0];
    const recoverRes = handleHttpRequest(
      null,
      {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'recoverPasscode',
          payload: {
            recoveryCode,
            newPasscode: 'BrandNewSecurePass2026!',
            confirmPasscode: 'BrandNewSecurePass2026!',
          },
        }),
      },
      tempDir
    );
    assert.equal(recoverRes.status, 200);
    const recoverJson = JSON.parse(recoverRes.body);
    assert.equal(recoverJson.ok, true);
    assert.ok(recoverJson.data.newCode, 'Should issue a replacement recovery code');

    // Verify customer data is intact and accessible
    assert.equal(recoverJson.state.customers.length, 1);
    assert.equal(recoverJson.state.customers[0].name, 'Kabul Metal Works');
    assert.equal(recoverJson.state.customers[0].balance, 5000);

    // 11. Lock again, then unlock with the new password
    clearSessionMasterKey();
    assert.equal(isDatabaseLocked(tempDir), true);

    const unlockRes = handleHttpRequest(
      null,
      {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'verifyPasscode',
          payload: { passcode: 'BrandNewSecurePass2026!' },
        }),
      },
      tempDir
    );
    assert.equal(unlockRes.status, 200);
    const unlockJson = JSON.parse(unlockRes.body);
    assert.equal(unlockJson.ok, true);
    assert.equal(unlockJson.state.customers.length, 1);
  });
});

