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

  it('initializes a completely empty encrypted SQLite database on first launch without pre-seeded companies or records', () => {
    const db = getLedgerDatabase(tmpDir);
    const companies = db.getCompanies();
    assert.equal(companies.length, 0);

    const exported = db.exportMoneyTotalSheetDataset();
    assert.equal(exported.companies.length, 0);
    assert.equal(exported.pickups.length, 0);
    assert.equal(exported.deductions.length, 0);
    assert.equal(exported.yards.length, 0);
    assert.equal(exported.currencies.length, 0);
    assert.equal(exported.units.length, 0);

    // Verify first launch is unconfigured so user is prompted to set supervisor password & 4 recovery codes
    const state = db.getAppState();
    assert.equal(state.customers.length, 0);
    assert.equal(state.authStatus.isConfigured, false);
    db.close();
  });

  it('supports full REST CRUD for companies, pickups, deductions, yards, currencies, units, and unique metal names', () => {
    const db = getLedgerDatabase(tmpDir);

    // 1. GET /companies/ starts empty
    const compRes = handleHttpRequest(db, { method: 'GET', pathname: '/companies/' }, tmpDir);
    assert.equal(compRes.status, 200);
    const companies = JSON.parse(compRes.body);
    assert.equal(companies.length, 0);

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

    // Now GET /companies/ with session cookie succeeds and returns empty array on fresh DB
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
    assert.equal(unlockedCompanies.length, 0);
  });

  it('restores legacy PostgreSQL pg_dump .sql files (COPY FROM stdin) and SQL INSERT dumps into the encrypted database', () => {
    const db = getLedgerDatabase(tmpDir);

    const pgDumpSql = [
      '--',
      '-- PostgreSQL database dump',
      '--',
      '',
      'COPY public.companies (id, name) FROM stdin;',
      '1\tApex_Metals',
      '2\tPacific_Scrap',
      '\\.',
      '',
      'COPY public.currency_options (id, code, symbol, label) FROM stdin;',
      '1\tAUD\t$\tAUD$',
      '2\tUSD\t$\tUSD$',
      '\\.',
      '',
      'COPY public.unit_options (id, value, label) FROM stdin;',
      '1\tkg\tKilograms',
      '2\tt\tTonnes',
      '\\.',
      '',
      'COPY public.yard_options (id, name) FROM stdin;',
      '1\tWetherill Park',
      '2\tSmithfield',
      '\\.',
      '',
      'COPY public.pickups (id, company_id, date, yard, notes, deduction, total_amount, currency) FROM stdin;',
      '10\t1\t2026-02-15\tWetherill Park\\n\\nDocket #402\tClean load\t50\t2950\tAUD$',
      '11\t2\t2026-02-16\tSmithfield\t\\N\t0\t1200\tAUD$',
      '\\.',
      '',
      'COPY public.metal_items (id, pickup_id, metal_name, net_weight, price_per_unit, total, weight_unit) FROM stdin;',
      '100\t10\tBright Copper\t250\t12\t3000\tkg',
      '101\t11\tBrass Honey\t150\t8\t1200\tkg',
      '\\.',
      '',
      'COPY public.deductions (id, company_id, date, amount, notes, currency) FROM stdin;',
      '50\t1\t2026-02-18\t1000\tEFT Transfer\tAUD$',
      '\\.',
    ].join('\n');

    // 1. Test POST /database/restore-sql
    const restoreRes = handleHttpRequest(
      db,
      {
        method: 'POST',
        pathname: '/database/restore-sql',
        body: JSON.stringify({ sql: pgDumpSql, fileName: 'scheduled_backup_2026-03-22.sql' }),
      },
      tmpDir
    );
    assert.equal(restoreRes.status, 200);
    const restoreJson = JSON.parse(restoreRes.body);
    assert.equal(restoreJson.ok, true);
    assert.deepEqual(restoreJson.stats, {
      companies: 2,
      pickups: 2,
      metals: 2,
      deductions: 1,
      yards: 2,
      currencies: 2,
      units: 2,
    });

    // Verify encrypted database now holds the restored companies, pickups, metals, and deductions
    const companies = db.getCompanies();
    assert.deepEqual(
      companies.map((c) => c.name),
      ['Apex_Metals', 'Pacific_Scrap']
    );
    const apexPickups = db.getPickupsByCompany(1);
    assert.equal(apexPickups.length, 1);
    assert.equal(apexPickups[0].yard, 'Wetherill Park\n\nDocket #402');
    assert.equal(apexPickups[0].metals.length, 1);
    assert.equal(apexPickups[0].metals[0].metal_name, 'Bright Copper');
    assert.equal(apexPickups[0].metals[0].total, 3000);

    const apexDeductions = db.getDeductionsByCompany(1);
    assert.equal(apexDeductions.length, 1);
    assert.equal(apexDeductions[0].amount, 1000);
    assert.equal(apexDeductions[0].notes, 'EFT Transfer');

    // Verify GET /database/export-sql exports a valid .sql dump that round-trips cleanly
    const exportRes = handleHttpRequest(
      db,
      {
        method: 'GET',
        pathname: '/database/export-sql',
      },
      tmpDir
    );
    assert.equal(exportRes.status, 200);
    const exportJson = JSON.parse(exportRes.body);
    assert.equal(exportJson.ok, true);
    assert.ok(exportJson.sql.includes('COPY public.companies (id, name) FROM stdin;'));
    assert.ok(exportJson.sql.includes('Apex_Metals'));
    assert.ok(exportJson.sql.includes('Bright Copper'));

    // 2. Test SQL INSERT INTO syntax via /api/ledger importBackup
    const insertSql = `
INSERT INTO companies (id, name) VALUES (1, 'Metro_Recycling');
INSERT INTO pickups (id, company_id, date, yard, notes, deduction, total_amount, currency) VALUES (1, 1, '2026-03-10', 'Minchinbury', 'Test SQL Insert', 0, 500, 'AUD$');
INSERT INTO metal_items (id, pickup_id, metal_name, net_weight, price_per_unit, total, weight_unit) VALUES (1, 1, 'Aluminium Domestic', 200, 2.5, 500, 'kg');
INSERT INTO deductions (id, company_id, date, amount, notes, currency) VALUES (1, 1, '2026-03-11', 250, 'Cash paid', 'AUD$');
`;
    const importRes = handleHttpRequest(
      db,
      {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'importBackup',
          payload: { content: insertSql, fileName: 'legacy_insert.sql' },
        }),
      },
      tmpDir
    );
    assert.equal(importRes.status, 200);
    assert.deepEqual(
      db.getCompanies().map((c) => c.name),
      ['Metro_Recycling']
    );
    assert.equal(db.getPickupsByCompany(1)[0].metals[0].metal_name, 'Aluminium Domestic');

    // 3. Test POST /database/reset requires confirmation="delete" and wipes database to empty state
    const badResetRes = handleHttpRequest(
      db,
      {
        method: 'POST',
        pathname: '/database/reset',
        body: JSON.stringify({ confirmation: 'wrong' }),
      },
      tmpDir
    );
    assert.equal(badResetRes.status, 400);
    assert.equal(db.getCompanies().length, 1);

    const goodResetRes = handleHttpRequest(
      db,
      {
        method: 'POST',
        pathname: '/database/reset',
        body: JSON.stringify({ confirmation: 'delete' }),
      },
      tmpDir
    );
    assert.equal(goodResetRes.status, 200);
    const exportedAfterReset = db.exportMoneyTotalSheetDataset();
    assert.equal(exportedAfterReset.companies.length, 0);
    assert.equal(exportedAfterReset.pickups.length, 0);
    assert.equal(exportedAfterReset.deductions.length, 0);
    assert.equal(exportedAfterReset.yards.length, 0);
    assert.equal(exportedAfterReset.currencies.length, 0);
    assert.equal(exportedAfterReset.units.length, 0);

    db.close();
  });

  it('verifies complex money calculations, IEEE-754 floating-point edge cases, multi-currency ledgers, edits, cascades, and round-trip SQL backup/restore', () => {
    const db = getLedgerDatabase(tmpDir);

    // 1. Setup Yards, Currencies, Units, and Company via HTTP routes
    const yardRes = handleHttpRequest(
      db,
      { method: 'POST', pathname: '/yards/', body: JSON.stringify({ name: 'Wetherill Park' }) },
      tmpDir
    );
    assert.equal(yardRes.status, 200);
    const yard = JSON.parse(yardRes.body);

    const audRes = handleHttpRequest(
      db,
      { method: 'POST', pathname: '/currencies/', body: JSON.stringify({ code: 'AUD', symbol: '$', label: 'AUD$' }) },
      tmpDir
    );
    const usdRes = handleHttpRequest(
      db,
      { method: 'POST', pathname: '/currencies/', body: JSON.stringify({ code: 'USD', symbol: '$', label: 'USD$' }) },
      tmpDir
    );
    const eurRes = handleHttpRequest(
      db,
      { method: 'POST', pathname: '/currencies/', body: JSON.stringify({ code: 'EUR', symbol: '€', label: 'EUR€' }) },
      tmpDir
    );
    assert.equal(audRes.status, 200);
    assert.equal(usdRes.status, 200);
    assert.equal(eurRes.status, 200);
    const usdCurr = JSON.parse(usdRes.body);

    const kgRes = handleHttpRequest(
      db,
      { method: 'POST', pathname: '/units/', body: JSON.stringify({ value: 'kg', label: 'Kilograms' }) },
      tmpDir
    );
    const tRes = handleHttpRequest(
      db,
      { method: 'POST', pathname: '/units/', body: JSON.stringify({ value: 't', label: 'Tonnes' }) },
      tmpDir
    );
    assert.equal(kgRes.status, 200);
    assert.equal(tRes.status, 200);
    const kgUnit = JSON.parse(kgRes.body);

    const compRes = handleHttpRequest(
      db,
      { method: 'POST', pathname: '/companies/', body: JSON.stringify({ name: 'Precision Metals Pty Ltd' }) },
      tmpDir
    );
    assert.equal(compRes.status, 200);
    const company = JSON.parse(compRes.body);

    // 2. Test fractional weights (3 decimals), sub-cent unit prices ($1.245/kg), and IEEE-754 float trap (100.10 + 200.20)
    const p1Res = handleHttpRequest(
      db,
      {
        method: 'POST',
        pathname: `/companies/${company.id}/pickups/`,
        body: JSON.stringify({
          date: '2026-03-01',
          yard: 'Wetherill Park\n\nDocket #1001',
          notes: 'Trip 1 - Fractional & IEEE-754 test',
          deduction: 0,
          currency: 'AUD$',
          metals: [
            // 100.10 + 200.20 in IEEE-754 float is 300.30000000000007
            { metal_name: 'Copper Candy', net_weight: 10, weight_unit: 'kg', price_per_unit: 10.01 },
            { metal_name: 'Copper Birch', net_weight: 20, weight_unit: 'kg', price_per_unit: 10.01 },
            // Sub-cent unit price: 1000 kg * $1.245/kg = $1245.00
            { metal_name: 'Heavy Steel', net_weight: 1000, weight_unit: 'kg', price_per_unit: 1.245 },
            // Fractional weight: 123.456 kg * $2.50/kg = $308.64
            { metal_name: 'Cast Aluminium', net_weight: 123.456, weight_unit: 'kg', price_per_unit: 2.5 },
            // Zero-price dross item: 50 kg * $0.00/kg = $0.00
            { metal_name: 'Slag / Dross', net_weight: 50, weight_unit: 'kg', price_per_unit: 0 },
          ],
        }),
      },
      tmpDir
    );
    assert.equal(p1Res.status, 200);
    const p1 = JSON.parse(p1Res.body);
    assert.equal(p1.metals[0].total, 100.1);
    assert.equal(p1.metals[1].total, 200.2);
    assert.equal(p1.metals[2].total, 1245);
    assert.equal(p1.metals[3].total, 308.64);
    assert.equal(p1.metals[4].total, 0);
    // Total pickup 1 = 100.10 + 200.20 + 1245.00 + 308.64 + 0 = 1853.94
    assert.equal(p1.total_amount, 1853.94);

    // 3. Add a USD$ pickup and EUR€ pickup to test multi-currency ledger isolation
    const p2Res = handleHttpRequest(
      db,
      {
        method: 'POST',
        pathname: `/companies/${company.id}/pickups/`,
        body: JSON.stringify({
          date: '2026-03-02',
          yard: 'Wetherill Park',
          notes: 'Export Container USD',
          deduction: 0,
          currency: 'USD$',
          metals: [
            { metal_name: 'ICW Insulated Wire', net_weight: 500.5, weight_unit: 'kg', price_per_unit: 4.2 },
          ],
        }),
      },
      tmpDir
    );
    assert.equal(p2Res.status, 200);
    const p2 = JSON.parse(p2Res.body);
    // 500.5 * 4.2 = 2102.10
    assert.equal(p2.total_amount, 2102.1);

    const p3Res = handleHttpRequest(
      db,
      {
        method: 'POST',
        pathname: `/companies/${company.id}/pickups/`,
        body: JSON.stringify({
          date: '2026-03-02',
          yard: 'Wetherill Park',
          notes: 'European Alloy Lot',
          deduction: 0,
          currency: 'EUR€',
          metals: [
            { metal_name: 'Stainless 316', net_weight: 2.5, weight_unit: 't', price_per_unit: 1500 },
          ],
        }),
      },
      tmpDir
    );
    assert.equal(p3Res.status, 200);
    const p3 = JSON.parse(p3Res.body);
    assert.equal(p3.total_amount, 3750);

    // 4. Add Deductions:
    // - AUD$ deduction of 300.30 (testing 100.10 + 200.20 - 300.30 exact cancellation)
    // - AUD$ deduction of 1553.64 (settling AUD$ to exact 0.00!)
    // - USD$ deduction of 2500.00 (creating an advance / negative balance of -397.90 in USD$)
    const d1Res = handleHttpRequest(
      db,
      {
        method: 'POST',
        pathname: `/companies/${company.id}/deductions`,
        body: JSON.stringify({
          date: '2026-03-03',
          amount: 300.3,
          notes: 'Partial EFT 1',
          currency: 'AUD$',
        }),
      },
      tmpDir
    );
    const d2Res = handleHttpRequest(
      db,
      {
        method: 'POST',
        pathname: `/companies/${company.id}/deductions`,
        body: JSON.stringify({
          date: '2026-03-04',
          amount: 1553.64,
          notes: 'Final Settlement AUD',
          currency: 'AUD$',
        }),
      },
      tmpDir
    );
    const d3Res = handleHttpRequest(
      db,
      {
        method: 'POST',
        pathname: `/companies/${company.id}/deductions`,
        body: JSON.stringify({
          date: '2026-03-04',
          amount: 2500,
          notes: 'USD Advance Wire',
          currency: 'USD$',
        }),
      },
      tmpDir
    );
    assert.equal(d1Res.status, 200);
    assert.equal(d2Res.status, 200);
    assert.equal(d3Res.status, 200);
    const d2 = JSON.parse(d2Res.body);

    // Simulate frontend CompanyData.jsx cleanMoney + buildLedgerData + grandTotals calculation
    const cleanMoney = (val: unknown) => {
      const v = Number(val) || 0;
      return Math.abs(v) < 1e-6 ? 0 : Math.round(v * 1e6) / 1e6;
    };
    const computeGrandTotals = (compId: number) => {
      const ps = db.getPickupsByCompany(compId);
      const ds = db.getDeductionsByCompany(compId);
      const totals: Record<string, number> = {};
      for (const p of ps) {
        const c = p.currency || 'AUD$';
        if (!totals[c]) totals[c] = 0;
        const pSum = (p.metals || []).reduce(
          (acc, m) => cleanMoney(acc + cleanMoney((Number(m.net_weight) || 0) * (Number(m.price_per_unit) || 0))),
          0
        );
        totals[c] = cleanMoney(totals[c] + pSum);
      }
      for (const d of ds) {
        const c = d.currency || 'AUD$';
        if (!totals[c]) totals[c] = 0;
        totals[c] = cleanMoney(totals[c] - cleanMoney(d.amount));
      }
      return totals;
    };

    const totals1 = computeGrandTotals(company.id);
    // AUD$ should be exact +0 (not -0 or -5.68e-14)
    assert.equal(totals1['AUD$'], 0);
    assert.equal(Object.is(totals1['AUD$'], -0), false);
    // USD$ should be 2102.10 - 2500.00 = -397.90 (Advance)
    assert.equal(totals1['USD$'], -397.9);
    // EUR€ should be +3750.00
    assert.equal(totals1['EUR€'], 3750);

    // 5. Test Editing a Pickup & Editing a Deduction
    // Update Pickup 1: change Heavy Steel price from 1.245 to 1.50 (+255.00 AUD$)
    const updateP1Res = handleHttpRequest(
      db,
      {
        method: 'PUT',
        pathname: `/pickups/${p1.id}`,
        body: JSON.stringify({
          date: '2026-03-01',
          yard: 'Wetherill Park\n\nDocket #1001',
          notes: 'Trip 1 - Updated price',
          deduction: 0,
          currency: 'AUD$',
          metals: [
            { metal_name: 'Copper Candy', net_weight: 10, weight_unit: 'kg', price_per_unit: 10.01 },
            { metal_name: 'Copper Birch', net_weight: 20, weight_unit: 'kg', price_per_unit: 10.01 },
            { metal_name: 'Heavy Steel', net_weight: 1000, weight_unit: 'kg', price_per_unit: 1.5 },
            { metal_name: 'Cast Aluminium', net_weight: 123.456, weight_unit: 'kg', price_per_unit: 2.5 },
          ],
        }),
      },
      tmpDir
    );
    assert.equal(updateP1Res.status, 200);
    const updatedP1 = JSON.parse(updateP1Res.body);
    assert.equal(updatedP1.total_amount, 2108.94);

    // Update Deduction 2: change amount from 1553.64 to 1000.00
    const updateD2Res = handleHttpRequest(
      db,
      {
        method: 'PUT',
        pathname: `/deductions/${d2.id}`,
        body: JSON.stringify({
          date: '2026-03-04',
          amount: 1000,
          notes: 'Adjusted AUD Payment',
          currency: 'AUD$',
        }),
      },
      tmpDir
    );
    assert.equal(updateD2Res.status, 200);

    const totals2 = computeGrandTotals(company.id);
    // New AUD$ balance = 2108.94 - 300.30 - 1000.00 = 808.64
    assert.equal(totals2['AUD$'], 808.64);

    // 6. Test Cascading Settings Updates (Yard rename, Currency update, Unit update)
    const renameYardRes = handleHttpRequest(
      db,
      {
        method: 'PUT',
        pathname: `/yards/${yard.id}`,
        body: JSON.stringify({ name: 'Wetherill Park HQ' }),
      },
      tmpDir
    );
    assert.equal(renameYardRes.status, 200);
    // Verify multi-line yard preserved Docket #1001 while updating first line
    const pickupsAfterYardRename = db.getPickupsByCompany(company.id);
    assert.equal(pickupsAfterYardRename[0].yard, 'Wetherill Park HQ\n\nDocket #1001');
    assert.equal(pickupsAfterYardRename[1].yard, 'Wetherill Park HQ');

    // Rename USD$ currency label to US$
    const renameCurrRes = handleHttpRequest(
      db,
      {
        method: 'PUT',
        pathname: `/currencies/${usdCurr.id}`,
        body: JSON.stringify({ code: 'USD', symbol: '$', label: 'US$' }),
      },
      tmpDir
    );
    assert.equal(renameCurrRes.status, 200);
    const totalsAfterCurrRename = computeGrandTotals(company.id);
    assert.equal(totalsAfterCurrRename['US$'], -397.9);
    assert.equal(totalsAfterCurrRename['USD$'], undefined);

    // Rename 'kg' unit to 'KG'
    const renameUnitRes = handleHttpRequest(
      db,
      {
        method: 'PUT',
        pathname: `/units/${kgUnit.id}`,
        body: JSON.stringify({ value: 'KG', label: 'Kilograms' }),
      },
      tmpDir
    );
    assert.equal(renameUnitRes.status, 200);
    assert.equal(db.getPickupsByCompany(company.id)[0].metals[0].weight_unit, 'KG');

    // 7. Full Round-Trip SQL Export -> Reset -> SQL Restore
    const snapshotBefore = db.exportMoneyTotalSheetDataset();
    const sqlExportRes = handleHttpRequest(
      db,
      { method: 'GET', pathname: '/database/export-sql' },
      tmpDir
    );
    assert.equal(sqlExportRes.status, 200);
    const exportedSql = JSON.parse(sqlExportRes.body).sql;

    // Reset DB
    const resetRes = handleHttpRequest(
      db,
      { method: 'POST', pathname: '/database/reset', body: JSON.stringify({ confirmation: 'delete' }) },
      tmpDir
    );
    assert.equal(resetRes.status, 200);
    assert.equal(db.getCompanies().length, 0);

    // Restore from exported SQL
    const restoreSqlRes = handleHttpRequest(
      db,
      {
        method: 'POST',
        pathname: '/database/restore-sql',
        body: JSON.stringify({ sql: exportedSql, fileName: 'roundtrip.sql' }),
      },
      tmpDir
    );
    assert.equal(restoreSqlRes.status, 200);

    const snapshotAfter = db.exportMoneyTotalSheetDataset();
    assert.deepEqual(snapshotAfter, snapshotBefore);
    const totalsAfterRestore = computeGrandTotals(company.id);
    assert.deepEqual(totalsAfterRestore, totalsAfterCurrRename);

    // 8. Verify UI routes and compiled frontend bundle assets
    const rootHtmlRes = handleHttpRequest(db, { method: 'GET', pathname: '/' }, tmpDir);
    assert.equal(rootHtmlRes.status, 200);
    assert.ok(rootHtmlRes.body.includes('/assets/app.js'));
    assert.ok(rootHtmlRes.body.includes('/assets/app.css'));

    const settingsHtmlRes = handleHttpRequest(db, { method: 'GET', pathname: '/settings' }, tmpDir);
    assert.equal(settingsHtmlRes.status, 200);

    const appJsRes = handleHttpRequest(db, { method: 'GET', pathname: '/assets/app.js' }, tmpDir);
    assert.equal(appJsRes.status, 200);
    assert.ok(appJsRes.body.includes('db-sync-led'));
    assert.ok(appJsRes.body.includes('Download Database Backup (.sql)'));
    assert.ok(appJsRes.body.includes('Restore from SQL File (.sql)'));
    assert.ok(appJsRes.body.includes('Reset Database'));
    assert.equal(appJsRes.body.includes('openSettingsDrawer'), false);
    assert.equal(appJsRes.body.includes('Regenerate Recovery Codes'), false);

    db.close();
  });
});


