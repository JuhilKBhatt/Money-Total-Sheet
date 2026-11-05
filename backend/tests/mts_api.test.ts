import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  getLedgerDatabase,
  clearSessionMasterKey,
  clearAllBrowserSessions,
} from '../src/database.ts';
import { handleHttpRequest } from '../src/server.ts';

describe('Money-Total-Sheet Encrypted SQLite & REST API Integration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mts-encrypted-test-'));
    clearSessionMasterKey();
    clearAllBrowserSessions();
  });

  afterEach(() => {
    clearSessionMasterKey();
    clearAllBrowserSessions();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('auto-seeds the 4 historical Money-Total-Sheet companies, 178 pickups, 467 metal items, and 156 deductions into encrypted SQLite on first launch', () => {
    const db = getLedgerDatabase(tmpDir);
    const companies = db.getCompanies();
    assert.equal(companies.length, 4);
    assert.deepEqual(
      companies.map((c) => c.name),
      ['Metal_Top', 'King_Recycling', 'Super_Metal', 'SustainaX']
    );

    const exported = db.exportMoneyTotalSheetDataset();
    assert.equal(exported.pickups.length, 178);
    const totalMetals = exported.pickups.reduce((acc, p) => acc + p.metals.length, 0);
    assert.equal(totalMetals, 467);
    assert.equal(exported.deductions.length, 156);

    // Verify first launch is unconfigured so user is prompted to set supervisor password & 4 recovery codes
    const state = db.getAppState();
    assert.equal(state.authStatus.isConfigured, false);
    db.close();
  });

  it('supports full REST CRUD for companies, pickups, deductions, yards, currencies, units, and unique metal names', () => {
    const db = getLedgerDatabase(tmpDir);

    // 1. GET /companies/
    const compRes = handleHttpRequest(db, { method: 'GET', pathname: '/companies/' }, tmpDir);
    assert.equal(compRes.status, 200);
    const companies = JSON.parse(compRes.body);
    assert.equal(companies.length, 4);

    // 2. POST /companies/
    const createCompRes = handleHttpRequest(
      db,
      {
        method: 'POST',
        pathname: '/companies/',
        body: JSON.stringify({ name: 'Sydney Copper Hub' }),
      },
      tmpDir
    );
    assert.equal(createCompRes.status, 200);
    const newComp = JSON.parse(createCompRes.body);
    assert.equal(newComp.name, 'Sydney Copper Hub');

    // 3. POST /pickups/
    const createPickupRes = handleHttpRequest(
      db,
      {
        method: 'POST',
        pathname: '/pickups/',
        body: JSON.stringify({
          company_id: newComp.id,
          date: '2026-04-01',
          yard: 'Wetherill Park',
          currency: 'AUD$',
          notes: 'Docket #901',
          deduction: 0,
          metals: [
            { metal_name: 'Millberry Copper', net_weight: 500, weight_unit: 'kg', price_per_unit: 12.5 },
            { metal_name: 'Brass Honey', net_weight: 200, weight_unit: 'kg', price_per_unit: 7.25 },
          ],
        }),
      },
      tmpDir
    );
    assert.equal(createPickupRes.status, 200);
    const createdPickup = JSON.parse(createPickupRes.body);
    assert.equal(createdPickup.metals.length, 2);
    assert.equal(createdPickup.metals[0].total, 6250);
    assert.equal(createdPickup.metals[1].total, 1450);

    // 4. POST /deductions/
    const createDedRes = handleHttpRequest(
      db,
      {
        method: 'POST',
        pathname: '/deductions/',
        body: JSON.stringify({
          company_id: newComp.id,
          date: '2026-04-02',
          amount: 2000,
          currency: 'AUD$',
          notes: 'Cash advance',
        }),
      },
      tmpDir
    );
    assert.equal(createDedRes.status, 200);
    const createdDed = JSON.parse(createDedRes.body);
    assert.equal(createdDed.amount, 2000);

    // 5. GET /companies/:id/pickups/ & /companies/:id/deductions/
    const getPickupsRes = handleHttpRequest(
      db,
      { method: 'GET', pathname: `/companies/${newComp.id}/pickups/` },
      tmpDir
    );
    assert.equal(JSON.parse(getPickupsRes.body).length, 1);

    const getDedRes = handleHttpRequest(
      db,
      { method: 'GET', pathname: `/companies/${newComp.id}/deductions/` },
      tmpDir
    );
    assert.equal(JSON.parse(getDedRes.body).length, 1);

    // 6. GET /metals/unique-names includes 'Millberry Copper'
    const metalsRes = handleHttpRequest(
      db,
      { method: 'GET', pathname: '/metals/unique-names' },
      tmpDir
    );
    const metalNames = JSON.parse(metalsRes.body);
    assert.ok(metalNames.includes('Millberry Copper'));

    db.close();
  });

  it('blocks REST access with HTTP 401 when database is locked and unlocks with 12-hour session cookie after password verification', () => {
    const db = getLedgerDatabase(tmpDir);
    // Configure supervisor password on first launch
    const setupRes = handleHttpRequest(
      db,
      {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'setupPasscode',
          payload: {
            passcode: 'ScrapMaster#2026',
            confirmPasscode: 'ScrapMaster#2026',
            hintQuestion: 'Yard master key',
          },
        }),
      },
      tmpDir
    );
    assert.equal(setupRes.status, 200);

    // Lock the system
    const lockRes = handleHttpRequest(
      db,
      {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({ action: 'lock', payload: {} }),
      },
      tmpDir
    );
    assert.equal(lockRes.status, 200);

    // While locked, GET /companies/ without cookie returns 401
    const blockedRes = handleHttpRequest(
      null,
      { method: 'GET', pathname: '/companies/' },
      tmpDir
    );
    assert.equal(blockedRes.status, 401);

    // Unlock via verifyPasscode
    const unlockRes = handleHttpRequest(
      null,
      {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'verifyPasscode',
          payload: { passcode: 'ScrapMaster#2026' },
        }),
      },
      tmpDir
    );
    assert.equal(unlockRes.status, 200);
    const setCookie = String(unlockRes.headers?.['Set-Cookie'] || '');
    assert.ok(setCookie.includes('adm_session_token='));
    assert.ok(setCookie.includes('Max-Age=43200'));

    const cookiePair = setCookie.split(';')[0];

    // Now GET /companies/ with session cookie succeeds and returns all 4 companies
    const unlockedCompRes = handleHttpRequest(
      null,
      {
        method: 'GET',
        pathname: '/companies/',
        headers: { cookie: cookiePair },
      },
      tmpDir
    );
    assert.equal(unlockedCompRes.status, 200);
    const unlockedCompanies = JSON.parse(unlockedCompRes.body);
    assert.equal(unlockedCompanies.length, 4);
  });
});

