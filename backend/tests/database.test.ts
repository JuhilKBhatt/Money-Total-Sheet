import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as dbModule from '../src/database.ts';

describe('Encrypted SQLite Database Engine', () => {
  let tempDir: string;
  let dbPath: string;
  const testSecret = 'test-usb-master-aes256-encryption-key-2026';

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-db-test-'));
    dbPath = path.join(tempDir, 'ledger.sqlite');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('Given a new database file When initialized with an encryption key Then it enables WAL mode, seeds default accounts, and encrypts data at rest', () => {
    const LedgerDatabase = (dbModule as Record<string, unknown>).LedgerDatabase as new (opts: {
      dbPath: string;
      encryptionKey: string;
    }) => {
      getJournalMode: () => string;
      getAppState: () => {
        customers: Array<{ id: string; name: string; balance: number }>;
        yards: string[];
        currentCurrency: string;
      };
      close: () => void;
    };
    assert.equal(typeof LedgerDatabase, 'function', 'LedgerDatabase class should exist');

    const db = new LedgerDatabase({ dbPath, encryptionKey: testSecret });
    assert.equal(db.getJournalMode().toLowerCase(), 'wal');

    const state = db.getAppState();
    assert.equal(state.customers.length, 0, 'Fresh database must start empty with 0 customers');
    assert.deepEqual(state.yards, ['North Yard', 'East Yard', 'Pier 9 Depot', 'West Yard']);
    db.close();
  });

  it('Given an encrypted database When opened with an incorrect encryption key Then it throws ERR_INVALID_ENCRYPTION_KEY', () => {
    const LedgerDatabase = (dbModule as Record<string, unknown>).LedgerDatabase as new (opts: {
      dbPath: string;
      encryptionKey: string;
    }) => { close: () => void };
    assert.equal(typeof LedgerDatabase, 'function', 'LedgerDatabase class should exist');

    const db = new LedgerDatabase({ dbPath, encryptionKey: testSecret });
    db.close();

    assert.throws(
      () => {
        new LedgerDatabase({ dbPath, encryptionKey: 'wrong-key-attempt' });
      },
      (err: Error & { code?: string }) => {
        return err.code === 'ERR_INVALID_ENCRYPTION_KEY' || err.message.includes('Invalid encryption key');
      }
    );
  });

  it('Given an existing database When reopened with the same key Then migrations are idempotent and data persists across restarts', () => {
    const LedgerDatabase = (dbModule as Record<string, unknown>).LedgerDatabase as new (opts: {
      dbPath: string;
      encryptionKey: string;
    }) => {
      createCustomer: (input: { name: string; defaultYard: string; balance: number; phone: string }) => { id: string; balance: number };
      getAppState: () => { customers: Array<{ id: string; name: string; balance: number }> };
      close: () => void;
    };
    assert.equal(typeof LedgerDatabase, 'function', 'LedgerDatabase class should exist');

    const db1 = new LedgerDatabase({ dbPath, encryptionKey: testSecret });
    const created = db1.createCustomer({
      name: 'Harbor Scrap Co.',
      defaultYard: 'North Yard',
      balance: -2500,
      phone: '',
    });
    assert.equal(created.id, 'CUST-1001');
    db1.close();

    // Verify at-rest encryption: raw SQLite file bytes must not contain plaintext customer name
    const rawBytes = fs.readFileSync(dbPath, 'utf8');
    assert.equal(rawBytes.includes('Harbor Scrap Co.'), false, 'Raw DB file must not leak plaintext customer names');

    const db2 = new LedgerDatabase({ dbPath, encryptionKey: testSecret });
    const state = db2.getAppState();
    assert.equal(state.customers.length, 1);
    const harbor = state.customers.find((c) => c.id === 'CUST-1001');
    assert.ok(harbor);
    assert.equal(harbor.name, 'Harbor Scrap Co.');
    assert.equal(harbor.balance, -2500);
    db2.close();
  });

  it('Given a customer account When ledger entries are posted Then running balances and customer balance update atomically', () => {
    const LedgerDatabase = (dbModule as Record<string, unknown>).LedgerDatabase as new (opts: {
      dbPath: string;
      encryptionKey: string;
    }) => {
      createCustomer: (input: { name: string; defaultYard: string; balance: number }) => { id: string };
      addLedgerEntry: (input: {
        customerId: string;
        entryType: 'invoice' | 'payment' | 'advance';
        amount: number;
        method: string;
        yard: string;
        memo: string;
      }) => { balance: number; ledger: Array<{ runningBalance: number; invoice: number; paid: number }> };
      close: () => void;
    };
    assert.equal(typeof LedgerDatabase, 'function', 'LedgerDatabase class should exist');

    const db = new LedgerDatabase({ dbPath, encryptionKey: testSecret });
    const created = db.createCustomer({
      name: 'Delta Auto Salvage',
      defaultYard: 'West Yard',
      balance: 0,
    });
    const afterInvoice = db.addLedgerEntry({
      customerId: created.id,
      entryType: 'invoice',
      amount: 3000,
      method: 'Cash',
      yard: 'West Yard',
      memo: 'Steel plates',
    });
    assert.equal(afterInvoice.balance, 3000);

    const afterAdvance = db.addLedgerEntry({
      customerId: created.id,
      entryType: 'advance',
      amount: 4200,
      method: 'Cash',
      yard: 'West Yard',
      memo: 'Cash advance',
    });
    assert.equal(afterAdvance.balance, -1200);
    assert.equal(afterAdvance.ledger[afterAdvance.ledger.length - 1].runningBalance, -1200);
    db.close();
  });

  it('Given a customer account When deleted and subsequently restored Then the account and its full ledger history are recovered', () => {
    const LedgerDatabase = (dbModule as Record<string, unknown>).LedgerDatabase as new (opts: {
      dbPath: string;
      encryptionKey: string;
    }) => {
      createCustomer: (input: { name: string; defaultYard: string; balance: number }) => { id: string };
      deleteCustomer: (id: string) => { id: string; name: string; balance: number; ledger: unknown[] };
      restoreCustomer: (cust: unknown) => void;
      getAppState: () => { customers: Array<{ id: string; ledger: unknown[] }> };
      close: () => void;
    };
    assert.equal(typeof LedgerDatabase, 'function', 'LedgerDatabase class should exist');

    const db = new LedgerDatabase({ dbPath, encryptionKey: testSecret });
    const created = db.createCustomer({
      name: 'Apex Metals Ltd.',
      defaultYard: 'North Yard',
      balance: 14250,
    });
    const deleted = db.deleteCustomer(created.id);
    assert.equal(deleted.id, created.id);
    assert.equal(db.getAppState().customers.length, 0);

    db.restoreCustomer(deleted);
    const restoredState = db.getAppState();
    assert.equal(restoredState.customers.length, 1);
    const cust = restoredState.customers.find((c) => c.id === created.id);
    assert.ok(cust);
    assert.equal(cust.ledger.length, 1);
    db.close();
  });

  it('Given yard locations and settings When modified or backed up and restored Then changes persist and backup restores cleanly', () => {
    const LedgerDatabase = (dbModule as Record<string, unknown>).LedgerDatabase as new (opts: {
      dbPath: string;
      encryptionKey: string;
    }) => {
      addYard: (name: string) => string[];
      renameYard: (oldName: string, newName: string) => string[];
      removeYard: (name: string) => string[];
      exportBackupArchive: () => string;
      importBackupArchive: (payload: string) => void;
      verifyPasscode: (passcode: string) => boolean;
      close: () => void;
    };
    assert.equal(typeof LedgerDatabase, 'function', 'LedgerDatabase class should exist');

    const db = new LedgerDatabase({ dbPath, encryptionKey: testSecret });
    assert.equal(db.verifyPasscode('admin123'), false, 'Passcode should not be pre-set before setup');

    const yardsAfterAdd = db.addYard('South Harbor Yard');
    assert.ok(yardsAfterAdd.includes('South Harbor Yard'));

    const yardsAfterRename = db.renameYard('South Harbor Yard', 'Central Depot');
    assert.ok(yardsAfterRename.includes('Central Depot'));

    const archive = db.exportBackupArchive();
    assert.equal(archive.includes('Apex Metals Ltd.'), false, 'Encrypted backup archive should not expose plaintext');

    db.removeYard('Central Depot');
    db.importBackupArchive(archive);
    db.close();
  });

  it('Given a database When setDefaultYard is called Then defaultYard is updated in AppState, used when creating new customer entries, and used as fallback when importing .csv and .xlsx files', () => {
    const LedgerDatabase = (dbModule as Record<string, unknown>).LedgerDatabase as new (opts: {
      dbPath: string;
      encryptionKey: string;
    }) => {
      getAppState: () => {
        yards: string[];
        defaultYard: string;
        customers: Array<{ id: string; name: string; defaultYard: string; ledger: Array<{ yard: string }> }>;
      };
      setDefaultYard: (yard: string) => string;
      createCustomer: (input: { name: string; defaultYard?: string; balance?: number }) => { id: string; defaultYard: string };
      addLedgerEntry: (input: { customerId: string; invoice: number; paid: number; yard?: string }) => unknown;
      renameYard: (oldName: string, newName: string) => string[];
      removeYard: (yard: string) => string[];
      importBackupArchive: (payload: string, fileName?: string) => unknown;
      close: () => void;
    };

    const db = new LedgerDatabase({ dbPath, encryptionKey: testSecret });
    assert.equal(typeof db.setDefaultYard, 'function', 'setDefaultYard should be a function');

    // Initial default yard should be North Yard (first in DEFAULT_YARDS)
    assert.equal(db.getAppState().defaultYard, 'North Yard');

    // Setting default yard to Pier 9 Depot
    db.setDefaultYard('Pier 9 Depot');
    assert.equal(db.getAppState().defaultYard, 'Pier 9 Depot');

    // Creating a customer without specifying defaultYard uses the configured default Yard Location
    const cust1 = db.createCustomer({ name: 'Acme Metal Recyclers' });
    assert.equal(cust1.defaultYard, 'Pier 9 Depot');

    // Adding ledger entry without specifying yard uses customer default / system default
    db.addLedgerEntry({
      customerId: cust1.id,
      invoice: 500,
      paid: 0,
    });
    const refreshed = db.getAppState().customers.find((c) => c.id === cust1.id);
    assert.equal(refreshed?.ledger[1].yard, 'Pier 9 Depot');

    // Importing a CSV without yard column uses defaultYard ('Pier 9 Depot')
    const csvContent = [
      'Customer,Date,Total,Paid Type,Paid,Notes,Balance Remaining',
      'CSV Yard Test,2026-10-30,450,,0,Test Entry,450'
    ].join('\n');
    db.importBackupArchive(csvContent, 'test.csv');
    const importedCust = db.getAppState().customers.find((c) => c.name === 'CSV Yard Test');
    assert.ok(importedCust);
    assert.equal(importedCust?.defaultYard, 'Pier 9 Depot');
    assert.equal(importedCust?.ledger[0].yard, 'Pier 9 Depot');

    // Renaming default yard updates defaultYard setting
    db.renameYard('Pier 9 Depot', 'Pier 9 Main Terminal');
    assert.equal(db.getAppState().defaultYard, 'Pier 9 Main Terminal');

    // Removing default yard safely falls back to next active yard
    db.removeYard('Pier 9 Main Terminal');
    assert.notEqual(db.getAppState().defaultYard, 'Pier 9 Main Terminal');
    assert.ok(db.getAppState().yards.includes(db.getAppState().defaultYard));

    db.close();
  });

  it('Given a new database When setupPasscode is called with password and hint question Then authStatus is configured and verifyPasscode validates the new password', () => {
    const LedgerDatabase = (dbModule as Record<string, unknown>).LedgerDatabase as new (opts: {
      dbPath: string;
      encryptionKey: string;
    }) => {
      getAppState: () => {
        authStatus: { isConfigured: boolean; hintQuestion: string; hintAnswer: string };
      };
      setupPasscode: (input: {
        passcode: string;
        hintQuestion: string;
        hintAnswer?: string;
      }) => void;
      resetPasscode: () => void;
      verifyPasscode: (passcode: string) => boolean;
      close: () => void;
    };

    const db = new LedgerDatabase({ dbPath, encryptionKey: testSecret });
    assert.equal(db.getAppState().authStatus?.isConfigured, false);
    assert.equal(typeof db.setupPasscode, 'function', 'setupPasscode should be a function');
    assert.equal(typeof db.resetPasscode, 'function', 'resetPasscode should be a function');

    db.setupPasscode({
      passcode: 'vault2026',
      hintQuestion: 'Mother maiden city?',
      hintAnswer: 'Kabul',
    });

    const state = db.getAppState();
    assert.equal(state.authStatus.isConfigured, true);
    assert.equal(state.authStatus.hintQuestion, 'Mother maiden city?');
    assert.equal(state.authStatus.hintAnswer, 'Kabul');
    assert.equal(db.verifyPasscode('vault2026'), true);
    assert.equal(db.verifyPasscode('wrong'), false);

    // Resetting passcode without correct old passcode throws error
    assert.throws(
      () => db.resetPasscode('wrong'),
      /Incorrect current password/i
    );

    // Resetting with correct old passcode succeeds
    db.resetPasscode('vault2026');
    const afterReset = db.getAppState();
    assert.equal(afterReset.authStatus.isConfigured, false);
    assert.equal(afterReset.authStatus.hintQuestion, '');
    assert.equal(db.verifyPasscode('vault2026'), false);
    db.close();
  });

  it('Given initial password setup When confirm password does not match Then setupPasscode throws; When valid Then recovery codes are generated and can recover a forgotten password', () => {
    const LedgerDatabase = (dbModule as Record<string, unknown>).LedgerDatabase as new (opts: {
      dbPath: string;
      encryptionKey: string;
    }) => {
      getAppState: () => {
        authStatus: { isConfigured: boolean; hintQuestion: string; hintAnswer: string; hasRecoveryCodes?: boolean };
      };
      setupPasscode: (input: {
        passcode: string;
        confirmPasscode?: string;
        hintQuestion: string;
        hintAnswer?: string;
        recoveryCodes?: string[];
      }) => { recoveryCodes: string[] };
      recoverPasscode: (input: {
        recoveryCode: string;
        newPasscode: string;
        confirmPasscode?: string;
      }) => { ok: boolean; remainingRecoveryCodes: string[]; newCode?: string };
      getRecoveryCodes: (passcode: string) => string[];
      regenerateRecoveryCodes: (passcode: string) => string[];
      verifyPasscode: (passcode: string) => boolean;
      close: () => void;
    };

    const db = new LedgerDatabase({ dbPath, encryptionKey: testSecret });

    // 1. Password confirmation mismatch throws error
    assert.throws(
      () =>
        db.setupPasscode({
          passcode: 'secret123',
          confirmPasscode: 'mismatch456',
          hintQuestion: 'My favorite color?',
        }),
      /passwords do not match/i
    );

    // 2. Successful setup returns generated recovery codes
    const setupResult = db.setupPasscode({
      passcode: 'secret123',
      confirmPasscode: 'secret123',
      hintQuestion: 'My favorite color?',
      hintAnswer: 'Blue',
    });
    assert.ok(Array.isArray(setupResult.recoveryCodes), 'Should return recovery codes array');
    assert.equal(setupResult.recoveryCodes.length, 4, 'Should generate 4 recovery codes');
    const codes = setupResult.recoveryCodes;

    const state = db.getAppState();
    assert.equal(state.authStatus.isConfigured, true);
    assert.equal(state.authStatus.hasRecoveryCodes, true);

    // 3. Supervisor can view recovery codes with valid password
    const viewedCodes = db.getRecoveryCodes('secret123');
    assert.deepEqual(viewedCodes, codes);

    assert.throws(
      () => db.getRecoveryCodes('wrongPass'),
      /Incorrect current password/i
    );

    // 4. Recover password using a valid recovery code (handling case and hyphens)
    const codeToUse = codes[0];
    const rawCodeNoHyphen = codeToUse.replace('-', '').toLowerCase();

    // Confirm password mismatch during recovery throws error
    assert.throws(
      () =>
        db.recoverPasscode({
          recoveryCode: rawCodeNoHyphen,
          newPasscode: 'newSecret789',
          confirmPasscode: 'mismatchSecret',
        }),
      /passwords do not match/i
    );

    // Successful recovery
    const recoveryResult = db.recoverPasscode({
      recoveryCode: rawCodeNoHyphen,
      newPasscode: 'newSecret789',
      confirmPasscode: 'newSecret789',
    });
    assert.equal(recoveryResult.ok, true);
    assert.equal(db.verifyPasscode('newSecret789'), true);
    assert.equal(db.verifyPasscode('secret123'), false);

    // The used recovery code cannot be used again
    assert.throws(
      () =>
        db.recoverPasscode({
          recoveryCode: rawCodeNoHyphen,
          newPasscode: 'anotherPass',
          confirmPasscode: 'anotherPass',
        }),
      /invalid or already used recovery code/i
    );

    // Regenerate recovery codes with new password
    const newCodes = db.regenerateRecoveryCodes('newSecret789');
    assert.equal(newCodes.length, 4);
    assert.notDeepEqual(newCodes, codes);

    db.close();
  });

  it('Given currencies in settings When addCurrency, renameCurrency, and removeCurrency are called Then currencies list and currentCurrency update', () => {
    const LedgerDatabase = (dbModule as Record<string, unknown>).LedgerDatabase as new (opts: {
      dbPath: string;
      encryptionKey: string;
    }) => {
      addCurrency: (curr: string) => string[];
      renameCurrency: (oldCurr: string, newCurr: string) => string[];
      removeCurrency: (curr: string) => string[];
      getAppState: () => { currencies: string[]; currentCurrency: string };
      close: () => void;
    };

    const db = new LedgerDatabase({ dbPath, encryptionKey: testSecret });
    assert.equal(typeof db.addCurrency, 'function', 'addCurrency should be a function');
    assert.equal(typeof db.renameCurrency, 'function', 'renameCurrency should be a function');
    assert.equal(typeof db.removeCurrency, 'function', 'removeCurrency should be a function');

    db.addCurrency('AFN (؋)');
    assert.ok(db.getAppState().currencies.includes('AFN (؋)'));
    assert.equal(db.getAppState().currentCurrency, 'AFN (؋)');

    db.renameCurrency('AFN (؋)', 'AFN (Af)');
    assert.ok(db.getAppState().currencies.includes('AFN (Af)'));
    assert.equal(db.getAppState().currentCurrency, 'AFN (Af)');

    db.removeCurrency('AFN (Af)');
    assert.equal(db.getAppState().currencies.includes('AFN (Af)'), false);
    db.close();
  });

  it('Given an .xlsx ZIP buffer When imported via importBackupArchive Then customer rows and balances are extracted into the database', () => {
    const buildTestXlsxBase64 = (dbModule as Record<string, unknown>).buildMinimalXlsxBase64 as (
      rows: Array<Array<string | number>>
    ) => string;
    assert.equal(typeof buildTestXlsxBase64, 'function', 'buildMinimalXlsxBase64 helper should exist');

    const LedgerDatabase = (dbModule as Record<string, unknown>).LedgerDatabase as new (opts: {
      dbPath: string;
      encryptionKey: string;
    }) => {
      clearDatabase: () => void;
      importBackupArchive: (payload: string) => { customers: Array<{ name: string; defaultYard: string; balance: number; notes?: string }> };
      close: () => void;
    };

    const db = new LedgerDatabase({ dbPath, encryptionKey: testSecret });
    db.clearDatabase();

    const xlsxBase64 = buildTestXlsxBase64([
      ['Customer Name', 'Yard', 'Balance', 'Notes'],
      ['Kabul Steel Traders', 'North Yard', 5400.5, 'Lot 12 rebar'],
      ['Pamir Scrap Co', 'East Yard', -1200, ''],
    ]);

    const state = db.importBackupArchive(`data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${xlsxBase64}`);
    assert.equal(state.customers.length, 2);
    assert.equal(state.customers[0].name, 'Kabul Steel Traders');
    assert.equal(state.customers[0].balance, 5400.5);
    assert.equal(state.customers[0].notes, 'Lot 12 rebar');
    assert.equal(state.customers[1].name, 'Pamir Scrap Co');
    assert.equal(state.customers[1].balance, -1200);
    assert.equal(state.customers[1].notes, '');
    db.close();
  });

  it('Given a multi-tab customer .xlsx workbook where each tab is a customer with columns Date, Total, Paid Type, Paid, Notes, Balance Remaining When imported via importBackupArchive Then each customer account is created with their individual ledger entries, correct signed running balances, and Paid Type is ignored', () => {
    const buildMultiTabXlsxBase64 = (dbModule as Record<string, unknown>).buildMultiTabXlsxBase64 as (
      tabs: Record<string, Array<Array<string | number>>>
    ) => string;
    assert.equal(typeof buildMultiTabXlsxBase64, 'function', 'buildMultiTabXlsxBase64 helper should exist');

    const LedgerDatabase = (dbModule as Record<string, unknown>).LedgerDatabase as new (opts: {
      dbPath: string;
      encryptionKey: string;
    }) => {
      clearDatabase: () => void;
      importBackupArchive: (payload: string) => { customers: Array<any> };
      close: () => void;
    };

    const db = new LedgerDatabase({ dbPath, encryptionKey: testSecret });
    db.clearDatabase();

    const multiTabBase64 = buildMultiTabXlsxBase64({
      'Ali Said Meer Agha': [
        ['Date', 'Total', 'Paid Type', 'Paid', 'Notes', 'Balance Remaining'],
        ['2025-02-28', 0, 'Paid', 1536.72, 'Balance remaining before deleting old ones', -6532.56],
        ['2025-03-22', 1159.72, 'Paid', 1500, 'scr7824', ''],
        ['', 0, 'Paid', 50, 'nesar acc', ''],
        ['2025-03-24', 534.44, 'Paid', 140, 'scr7888', ''],
        ['2025-07-05', 5000, 'Paid', 20000, 'for car', ''],
        ['2026-03-01', 10000, '', 0, 'by naser', ''],
      ],
      'Abas': [
        ['Date', 'Total', 'Paid Type', 'Paid', 'Notes', 'Balance Remaining'],
        ['', 0, '', 0, '', 0],
      ],
      'Template': [
        ['Date', 'Total', 'Paid Type', 'Paid', 'Notes', 'Balance Remaining'],
        ['', 0, '', 0, '', 0],
      ],
    });

    const state = db.importBackupArchive(`data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${multiTabBase64}`);
    // "Template" with 0 balance and 0 entries should be skipped
    assert.equal(state.customers.length, 2);

    const ali = state.customers.find((c: any) => c.name === 'Ali Said Meer Agha');
    assert.ok(ali);
    assert.equal(ali.balance, -6532.56);
    assert.equal(ali.notes, 'Balance remaining before deleting old ones');
    assert.equal(ali.ledger.length, 6);
    // Paid Type must be ignored and not leak into paymentMethod/method
    assert.equal(ali.ledger[0].paid, 1536.72);
    assert.equal(ali.ledger[0].invoice, 0);
    assert.equal(ali.ledger[0].runningBalance, -1536.72);
    assert.equal(ali.ledger[1].invoice, 1159.72);
    assert.equal(ali.ledger[1].paid, 1500);
    assert.equal(ali.ledger[1].runningBalance, -1877);
    // Entry 2 with empty date should inherit previous date 2025-03-22
    assert.equal(ali.ledger[2].date, '2025-03-22');
    assert.equal(ali.ledger[5].runningBalance, -6532.56);

    const abas = state.customers.find((c: any) => c.name === 'Abas');
    assert.ok(abas);
    assert.equal(abas.balance, 0);
    assert.equal(abas.ledger.length, 1);

    db.close();
  });

  it('Given Customer Balance Record.xlsx When imported via importBackupArchive Then all 83 customers are loaded with complete ledger history and accurate balances', () => {
    const filePath = path.resolve(process.cwd(), 'Customer Balance Record.xlsx');
    if (!fs.existsSync(filePath)) return;

    const fileBuf = fs.readFileSync(filePath);
    const b64 = fileBuf.toString('base64');

    const LedgerDatabase = (dbModule as Record<string, unknown>).LedgerDatabase as new (opts: {
      dbPath: string;
      encryptionKey: string;
    }) => {
      clearDatabase: () => void;
      importBackupArchive: (payload: string) => { customers: Array<any> };
      close: () => void;
    };

    const db = new LedgerDatabase({ dbPath, encryptionKey: testSecret });
    db.clearDatabase();

    const state = db.importBackupArchive(`data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${b64}`);
    assert.equal(state.customers.length, 83);

    // Verify key customer accounts and their balances
    const ali = state.customers.find((c: any) => c.name.includes('Ali') && c.name.includes('Said'));
    assert.ok(ali);
    assert.equal(ali.balance, -6532.56);
    assert.equal(ali.ledger.length, 6);

    const tim = state.customers.find((c: any) => c.name === 'Tim');
    assert.ok(tim);
    assert.equal(tim.balance, 22647.3);

    const hamid = state.customers.find((c: any) => c.name === 'Hamid');
    assert.ok(hamid);
    assert.equal(hamid.balance, 11701.2);

    const pull = state.customers.find((c: any) => c.name === 'Pull');
    assert.ok(pull);
    assert.equal(pull.balance, 95371.33);

    const totalBalance = Math.round(state.customers.reduce((acc: number, c: any) => acc + c.balance, 0) * 100) / 100;
    assert.equal(totalBalance, 142509.25);

    db.close();
  });

  it('Given Customer Balance Record.csv When imported via importBackupArchive Then all 83 customers are loaded with complete ledger history, accurate balances, and matching total net balance 142509.25', () => {
    const filePath = path.resolve(process.cwd(), 'Customer Balance Record.csv');
    if (!fs.existsSync(filePath)) return;

    const csvContent = fs.readFileSync(filePath, 'utf8');

    const LedgerDatabase = (dbModule as Record<string, unknown>).LedgerDatabase as new (opts: {
      dbPath: string;
      encryptionKey: string;
    }) => {
      clearDatabase: () => void;
      importBackupArchive: (payload: string, fileName?: string) => { customers: Array<any> };
      close: () => void;
    };

    const db = new LedgerDatabase({ dbPath, encryptionKey: testSecret });
    db.clearDatabase();

    const state = db.importBackupArchive(csvContent, 'Customer Balance Record.csv');
    assert.equal(state.customers.length, 83);

    // Verify Ali Said Meer Agha
    const ali = state.customers.find((c: any) => c.name.includes('Ali') && c.name.includes('Said'));
    assert.ok(ali);
    assert.equal(ali.balance, -6532.56);
    assert.equal(ali.ledger.length, 6);
    assert.equal(ali.ledger[0].paid, 1536.72);
    assert.equal(ali.ledger[0].runningBalance, -1536.72);
    assert.equal(ali.ledger[1].invoice, 1159.72);
    assert.equal(ali.ledger[1].paid, 1500);
    assert.equal(ali.ledger[1].runningBalance, -1877);
    assert.equal(ali.ledger[5].runningBalance, -6532.56);

    // Verify Tim
    const tim = state.customers.find((c: any) => c.name === 'Tim');
    assert.ok(tim);
    assert.equal(tim.balance, 22647.3);

    // Verify Hamid
    const hamid = state.customers.find((c: any) => c.name === 'Hamid');
    assert.ok(hamid);
    assert.equal(hamid.balance, 11701.2);

    // Verify Pull
    const pull = state.customers.find((c: any) => c.name === 'Pull');
    assert.ok(pull);
    assert.equal(pull.balance, 95371.33);

    // Verify Total Balance
    const totalBalance = Math.round(state.customers.reduce((acc: number, c: any) => acc + c.balance, 0) * 100) / 100;
    assert.equal(totalBalance, 142509.25);

    db.close();
  });

  it('Given a single customer CSV with columns Date, Total, Paid Type, Paid, Notes, Balance Remaining and fileName Sayed.csv When imported via importBackupArchive Then customer Sayed is loaded with their ledger history and accurate balances', () => {
    const singleCustCsv = [
      'Date,Total,Paid Type,Paid,Notes,Balance Remaining',
      '2026-10-28,558.30,,0,Unpaid amount added,558.30',
      '2026-10-29,481.40,,0,Unpaid amount added,1039.70',
      '2026-10-30,304.70,,0,Unpaid amount added,1344.40'
    ].join('\n');

    const LedgerDatabase = (dbModule as Record<string, unknown>).LedgerDatabase as new (opts: {
      dbPath: string;
      encryptionKey: string;
    }) => {
      clearDatabase: () => void;
      importBackupArchive: (payload: string, fileName?: string) => { customers: Array<any> };
      close: () => void;
    };

    const db = new LedgerDatabase({ dbPath, encryptionKey: testSecret });
    db.clearDatabase();

    const state = db.importBackupArchive(singleCustCsv, 'Sayed.csv');
    assert.equal(state.customers.length, 1);
    const cust = state.customers[0];
    assert.equal(cust.name, 'Sayed');
    assert.equal(cust.balance, 1344.4);
    assert.equal(cust.ledger.length, 3);
    assert.equal(cust.ledger[0].invoice, 558.3);
    assert.equal(cust.ledger[1].invoice, 481.4);
    assert.equal(cust.ledger[1].runningBalance, 1039.7);
    assert.equal(cust.ledger[2].runningBalance, 1344.4);

    db.close();
  });

  it('Given a populated database When clearDatabase is called Then all customer accounts and ledger entries are permanently removed', () => {
    const LedgerDatabase = (dbModule as Record<string, unknown>).LedgerDatabase as new (opts: {
      dbPath: string;
      encryptionKey: string;
    }) => {
      createCustomer: (input: { name: string; defaultYard: string; balance: number }) => { id: string };
      clearDatabase: () => { customers: unknown[] };
      getAppState: () => { customers: unknown[] };
      close: () => void;
    };

    const db = new LedgerDatabase({ dbPath, encryptionKey: testSecret });
    db.createCustomer({ name: 'Temp Customer', defaultYard: 'North Yard', balance: 500 });
    assert.equal(db.getAppState().customers.length, 1);
    assert.equal(typeof db.clearDatabase, 'function', 'clearDatabase should be a function');

    const nextState = db.clearDatabase();
    assert.equal(nextState.customers.length, 0);
    assert.equal(db.getAppState().customers.length, 0);
    db.close();
  });

  it('Given a customer who wants cash payment when cash is unavailable When we record the total and notes Then we track how much we need to pay them and can later pay something or everything', () => {
    const db = new dbModule.LedgerDatabase({ dbPath, encryptionKey: testSecret });

    // Customer comes in wanting $1,500 cash; we don't have cash available so we write total + notes
    const cust = db.createCustomer({
      name: 'Farid Scrap Seller',
      defaultYard: 'North Yard',
      balance: 1500,
      notes: 'Copper & brass load - no cash on hand',
    });
    assert.equal(cust.balance, 1500);
    assert.equal(cust.notes, 'Copper & brass load - no cash on hand');
    assert.equal(cust.ledger.length, 1);
    assert.equal(cust.ledger[0].invoice, 1500);
    assert.equal(cust.ledger[0].paid, 0);
    assert.equal(cust.ledger[0].method, 'Unpaid Due');
    assert.equal(cust.ledger[0].memo, 'Copper & brass load - no cash on hand');

    // Next time they come, we pay them something ($600 partial cash payment)
    const afterPartial = db.addLedgerEntry({
      customerId: cust.id,
      entryType: 'payment',
      amount: 600,
      method: 'Cash',
      yard: 'North Yard',
    });
    assert.equal(afterPartial.balance, 900);
    assert.equal(afterPartial.ledger[1].paid, 600);
    assert.equal(afterPartial.ledger[1].memo, 'Cash paid to customer');

    // Next time they come, we pay them everything (remaining $900)
    const afterFull = db.addLedgerEntry({
      customerId: cust.id,
      payFull: true,
      method: 'Cash',
      yard: 'North Yard',
    });
    assert.equal(afterFull.balance, 0);
    assert.equal(afterFull.ledger[2].paid, 900);
    assert.equal(afterFull.ledger[2].runningBalance, 0);
    assert.equal(afterFull.ledger[2].memo, 'Paid full balance to customer');

    db.close();
  });

  it('Given a customer account When updateCustomer is called Then details are updated and persisted', () => {
    const db = new dbModule.LedgerDatabase({ dbPath, encryptionKey: testSecret });
    const cust = db.createCustomer({
      name: 'Old Name Corp',
      balance: 500,
      defaultYard: 'North Yard',
      phone: 'Initial notes',
    });

    const updated = db.updateCustomer({
      id: cust.id,
      name: 'New Name Logistics',
      defaultYard: 'East Yard',
      phone: 'Updated notes and contact',
    });

    assert.equal(updated.name, 'New Name Logistics');
    assert.equal(updated.defaultYard, 'East Yard');
    assert.equal(updated.phone, 'Updated notes and contact');

    // Verify persistence across restart
    db.close();
    const reopenedDb = new dbModule.LedgerDatabase({ dbPath, encryptionKey: testSecret });
    const found = reopenedDb.getAppState().customers.find((c) => c.id === cust.id);
    assert.ok(found);
    assert.equal(found?.name, 'New Name Logistics');
    assert.equal(found?.defaultYard, 'East Yard');
    assert.equal(found?.phone, 'Updated notes and contact');
    reopenedDb.close();
  });

  it('Given a customer ledger When updateLedgerEntry and deleteLedgerEntry are called Then entries and running balances recalculate atomically', () => {
    const db = new dbModule.LedgerDatabase({ dbPath, encryptionKey: testSecret });
    const cust = db.createCustomer({
      name: 'Delta Scrap',
      balance: 1000,
      defaultYard: 'North Yard',
    });

    // Add entry 1: cash paid $400 (balance becomes 600)
    db.addLedgerEntry({
      customerId: cust.id,
      invoice: 0,
      paid: 400,
      method: 'Cash',
      yard: 'North Yard',
      memo: 'Partial cash payout',
    });

    // Add entry 2: new unpaid bill $200 (balance becomes 800)
    db.addLedgerEntry({
      customerId: cust.id,
      invoice: 200,
      paid: 0,
      method: 'Unpaid Due',
      yard: 'North Yard',
      memo: 'More metal delivered',
    });

    const stateBefore = db.getAppState().customers.find((c) => c.id === cust.id);
    assert.ok(stateBefore);
    assert.equal(stateBefore?.balance, 800);
    assert.equal(stateBefore?.ledger.length, 3);

    // Edit entry 1: change paid from 400 to 500 (balance should become 1000 - 500 + 200 = 700)
    const afterEdit = db.updateLedgerEntry({
      customerId: cust.id,
      entryIndex: 1,
      paid: 500,
      memo: 'Corrected payout amount to 500',
    });
    assert.equal(afterEdit.ledger[1].paid, 500);
    assert.equal(afterEdit.ledger[1].runningBalance, 500);
    assert.equal(afterEdit.ledger[2].runningBalance, 700);
    assert.equal(afterEdit.balance, 700);

    // Delete entry 2: (balance should become 1000 - 500 = 500)
    const afterDelete = db.deleteLedgerEntry({
      customerId: cust.id,
      entryIndex: 2,
    });
    assert.equal(afterDelete.ledger.length, 2);
    assert.equal(afterDelete.balance, 500);
    assert.equal(afterDelete.ledger[1].runningBalance, 500);

    db.close();
  });

  it('Given a customer with multiple past transactions When consolidateCustomerBalance is called Then past logs are cleared and replaced with a single opening entry preserving the current balance', () => {
    const db = new dbModule.LedgerDatabase({ dbPath, encryptionKey: testSecret });
    const cust = db.createCustomer({
      name: 'Omega Metal Recyclers',
      balance: 1500,
      defaultYard: 'North Yard',
      notes: 'Initial copper load',
    });

    db.addLedgerEntry({
      customerId: cust.id,
      invoice: 0,
      paid: 600,
      method: 'Cash',
      yard: 'North Yard',
      memo: 'Partial payout',
    });

    db.addLedgerEntry({
      customerId: cust.id,
      invoice: 350,
      paid: 0,
      method: 'Unpaid Due',
      yard: 'North Yard',
      memo: 'Additional scrap invoice',
    });

    const beforeConsolidation = db.getAppState().customers.find((c) => c.id === cust.id);
    assert.ok(beforeConsolidation);
    assert.equal(beforeConsolidation?.ledger.length, 3);
    assert.equal(beforeConsolidation?.balance, 1250);

    const consolidated = db.consolidateCustomerBalance({ customerId: cust.id });
    assert.equal(consolidated.balance, 1250);
    assert.equal(consolidated.ledger.length, 1);
    assert.equal(consolidated.ledger[0].invoice, 1250);
    assert.equal(consolidated.ledger[0].paid, 0);
    assert.equal(consolidated.ledger[0].runningBalance, 1250);
    assert.equal(consolidated.ledger[0].memo, 'Opening balance consolidated from past logs');

    // Persistence across db restart
    db.close();
    const reopened = new dbModule.LedgerDatabase({ dbPath, encryptionKey: testSecret });
    const reopenedCust = reopened.getAppState().customers.find((c) => c.id === cust.id);
    assert.ok(reopenedCust);
    assert.equal(reopenedCust?.balance, 1250);
    assert.equal(reopenedCust?.ledger.length, 1);
    reopened.close();
  });

  it('Given default database initialization Then only USD ($) is the single currency source of truth', () => {
    const db = new dbModule.LedgerDatabase({ dbPath, encryptionKey: testSecret });
    db.clearDatabase();
    const state = db.getAppState();
    assert.deepEqual(state.currencies, ['USD ($)']);
    assert.equal(state.currentCurrency, 'USD ($)');
    db.close();
  });

  it('Given comprehensive ledger transactions When calculating running balances, totals, edits, deletions, and payFull Then every calculation is mathematically exact to the cent', () => {
    const db = new dbModule.LedgerDatabase({ dbPath, encryptionKey: testSecret });
    db.clearDatabase();

    // 1. Create customer with opening balance of 100.50
    const cust = db.createCustomer({
      name: 'Mathematical Audit Client',
      balance: 100.50,
      defaultYard: 'North Yard',
    });
    assert.equal(cust.balance, 100.50);
    assert.equal(cust.ledger[0].runningBalance, 100.50);

    // 2. Add an invoice of 49.75 -> balance becomes 150.25
    const step1 = db.addLedgerEntry({
      customerId: cust.id,
      invoice: 49.75,
      paid: 0,
      yard: 'North Yard',
    });
    assert.equal(step1.balance, 150.25);
    assert.equal(step1.ledger[1].runningBalance, 150.25);

    // 3. Add an advance of 200.00 -> balance becomes -49.75 (Advance Given)
    const step2 = db.addLedgerEntry({
      customerId: cust.id,
      invoice: 0,
      paid: 200.00,
      yard: 'North Yard',
      method: 'Cash',
    });
    assert.equal(step2.balance, -49.75);
    assert.equal(step2.ledger[2].runningBalance, -49.75);

    // Attempting payFull on negative balance throws error
    assert.throws(() => {
      db.addLedgerEntry({
        customerId: cust.id,
        payFull: true,
        yard: 'North Yard',
      });
    }, /no unpaid balance/i);

    // 4. Add an invoice of 149.75 -> balance becomes +100.00 (We Owe Customer)
    const step3 = db.addLedgerEntry({
      customerId: cust.id,
      invoice: 149.75,
      paid: 0,
      yard: 'North Yard',
    });
    assert.equal(step3.balance, 100.00);
    assert.equal(step3.ledger[3].runningBalance, 100.00);

    // 5. Pay full balance -> balance becomes 0.00 (Settled)
    const step4 = db.addLedgerEntry({
      customerId: cust.id,
      payFull: true,
      yard: 'North Yard',
    });
    assert.equal(step4.balance, 0.00);
    assert.equal(step4.ledger[4].paid, 100.00);
    assert.equal(step4.ledger[4].runningBalance, 0.00);

    // Verify invoice sum minus paid sum matches balance
    let totalInv = 0;
    let totalPaid = 0;
    for (const e of step4.ledger) {
      totalInv = Math.round((totalInv + e.invoice) * 100) / 100;
      totalPaid = Math.round((totalPaid + e.paid) * 100) / 100;
    }
    assert.equal(Math.round((totalInv - totalPaid) * 100) / 100, 0.00);

    // 6. Edit entry index 1 (change invoice from 49.75 to 59.75) -> all subsequent entries recalculate by +10.00
    const step5 = db.updateLedgerEntry({
      customerId: cust.id,
      entryIndex: 1,
      invoice: 59.75,
    });
    // Entry 0: 100.50 (bal 100.50)
    // Entry 1: +59.75 (bal 160.25)
    // Entry 2: -200.00 (bal -39.75)
    // Entry 3: +149.75 (bal 110.00)
    // Entry 4: -100.00 (bal 10.00)
    assert.equal(step5.ledger[1].runningBalance, 160.25);
    assert.equal(step5.ledger[2].runningBalance, -39.75);
    assert.equal(step5.ledger[3].runningBalance, 110.00);
    assert.equal(step5.ledger[4].runningBalance, 10.00);
    assert.equal(step5.balance, 10.00);

    // 7. Delete entry index 2 (-200.00 payout removed) -> remaining entries recalculate
    const step6 = db.deleteLedgerEntry({
      customerId: cust.id,
      entryIndex: 2,
    });
    // Entry 0: 100.50 (bal 100.50)
    // Entry 1: +59.75 (bal 160.25)
    // Entry 2: +149.75 (bal 310.00)
    // Entry 3: -100.00 (bal 210.00)
    assert.equal(step6.ledger.length, 4);
    assert.equal(step6.ledger[0].runningBalance, 100.50);
    assert.equal(step6.ledger[1].runningBalance, 160.25);
    assert.equal(step6.ledger[2].runningBalance, 310.00);
    assert.equal(step6.ledger[3].runningBalance, 210.00);
    assert.equal(step6.balance, 210.00);

    db.close();
  });

  it('Given an encrypted database with an existing customer When adding multiple sequential ledger entries Then all entries are permanently persisted and none are overwritten or lost', () => {
    const LedgerDatabase = (dbModule as Record<string, unknown>).LedgerDatabase as new (opts: {
      dbPath: string;
      encryptionKey: string;
    }) => {
      createCustomer: (input: { name: string; defaultYard: string; balance: number }) => { id: string };
      addLedgerEntry: (input: {
        customerId: string;
        invoice?: number;
        paid?: number;
        yard?: string;
        memo?: string;
      }) => { balance: number; ledger: Array<{ invoice: number; paid: number; runningBalance: number; memo: string }> };
      getAppState: () => { customers: Array<{ id: string; balance: number; ledger: Array<{ invoice: number; paid: number; memo: string }> }> };
      close: () => void;
    };

    const db = new LedgerDatabase({ dbPath, encryptionKey: testSecret });
    const cust = db.createCustomer({
      name: 'Pacific Recycling Hub',
      defaultYard: 'North Yard',
      balance: 100,
    });

    // Add Entry 1
    const res1 = db.addLedgerEntry({
      customerId: cust.id,
      invoice: 50,
      paid: 0,
      memo: 'Unpaid load 1',
    });
    assert.equal(res1.ledger.length, 2); // opening + entry 1
    assert.equal(res1.balance, 150);

    // Add Entry 2
    const res2 = db.addLedgerEntry({
      customerId: cust.id,
      invoice: 0,
      paid: 75,
      memo: 'Partial payout',
    });
    assert.equal(res2.ledger.length, 3); // opening + entry 1 + entry 2
    assert.equal(res2.balance, 75);

    // Add Entry 3
    const res3 = db.addLedgerEntry({
      customerId: cust.id,
      invoice: 25,
      paid: 0,
      memo: 'Unpaid load 2',
    });
    assert.equal(res3.ledger.length, 4); // opening + entry 1 + entry 2 + entry 3
    assert.equal(res3.balance, 100);

    // Verify through fresh getAppState()
    const state = db.getAppState();
    const loadedCust = state.customers.find((c) => c.id === cust.id);
    assert.ok(loadedCust);
    assert.equal(loadedCust.ledger.length, 4);
    assert.equal(loadedCust.ledger[0].memo, 'Unpaid balance to pay customer');
    assert.equal(loadedCust.ledger[1].memo, 'Unpaid load 1');
    assert.equal(loadedCust.ledger[2].memo, 'Partial payout');
    assert.equal(loadedCust.ledger[3].memo, 'Unpaid load 2');
    assert.equal(loadedCust.balance, 100);

    db.close();
  });

  it('Given an encrypted database with multiple customer ledger entries When closed and reopened from disk Then all ledger entries and running balances are preserved on disk without data loss', () => {
    const LedgerDatabase = (dbModule as Record<string, unknown>).LedgerDatabase as new (opts: {
      dbPath: string;
      encryptionKey: string;
    }) => {
      createCustomer: (input: { name: string; defaultYard: string; balance: number }) => { id: string };
      addLedgerEntry: (input: {
        customerId: string;
        invoice?: number;
        paid?: number;
        yard?: string;
        memo?: string;
      }) => { balance: number; ledger: Array<{ invoice: number; paid: number; runningBalance: number }> };
      getAppState: () => { customers: Array<{ id: string; balance: number; ledger: Array<{ invoice: number; paid: number; memo: string }> }> };
      close: () => void;
    };

    // Session 1: Create customer and add 2 entries
    const db1 = new LedgerDatabase({ dbPath, encryptionKey: testSecret });
    const cust = db1.createCustomer({
      name: 'Titan Scrap Logistics',
      defaultYard: 'East Yard',
      balance: 500,
    });
    db1.addLedgerEntry({
      customerId: cust.id,
      invoice: 200,
      paid: 0,
      memo: 'Batch A',
    });
    db1.addLedgerEntry({
      customerId: cust.id,
      invoice: 0,
      paid: 300,
      memo: 'Batch B payout',
    });
    db1.close();

    // Session 2: Reopen from disk (simulating USB unplug and replug)
    const db2 = new LedgerDatabase({ dbPath, encryptionKey: testSecret });
    const stateBeforeAdd = db2.getAppState();
    const titan = stateBeforeAdd.customers.find((c) => c.id === cust.id);
    assert.ok(titan);
    assert.equal(titan.ledger.length, 3);
    assert.equal(titan.balance, 400);

    // Add Entry 3 in new session
    const afterEntry3 = db2.addLedgerEntry({
      customerId: cust.id,
      invoice: 150,
      paid: 0,
      memo: 'Batch C',
    });
    assert.equal(afterEntry3.ledger.length, 4, 'Entry 3 must NOT overwrite previous entries');
    assert.equal(afterEntry3.ledger[1].memo, 'Batch A');
    assert.equal(afterEntry3.ledger[2].memo, 'Batch B payout');
    assert.equal(afterEntry3.ledger[3].memo, 'Batch C');
    assert.equal(afterEntry3.balance, 550);

    db2.close();
  });

  it('Given an existing customer with multiple ledger entries When updateCustomer is called to modify name or notes Then existing ledger entries are NOT deleted and remain intact', () => {
    const LedgerDatabase = (dbModule as Record<string, unknown>).LedgerDatabase as new (opts: {
      dbPath: string;
      encryptionKey: string;
    }) => {
      createCustomer: (input: { name: string; defaultYard: string; balance: number }) => { id: string };
      addLedgerEntry: (input: {
        customerId: string;
        invoice?: number;
        paid?: number;
        memo?: string;
      }) => { balance: number; ledger: unknown[] };
      updateCustomer: (input: { id: string; name?: string; notes?: string }) => { id: string; name: string; notes: string };
      getAppState: () => { customers: Array<{ id: string; name: string; ledger: unknown[] }> };
      close: () => void;
    };

    const db = new LedgerDatabase({ dbPath, encryptionKey: testSecret });
    const cust = db.createCustomer({
      name: 'Original Metals',
      defaultYard: 'North Yard',
      balance: 1000,
    });
    db.addLedgerEntry({ customerId: cust.id, invoice: 500, paid: 0, memo: 'Load 1' });
    db.addLedgerEntry({ customerId: cust.id, invoice: 0, paid: 300, memo: 'Load 2' });

    // Update customer name & notes
    db.updateCustomer({
      id: cust.id,
      name: 'Renamed Metals LLC',
      notes: 'New account notes',
    });

    const state = db.getAppState();
    const updated = state.customers.find((c) => c.id === cust.id);
    assert.ok(updated);
    assert.equal(updated.name, 'Renamed Metals LLC');
    assert.equal(updated.ledger.length, 3, 'updateCustomer must preserve all past ledger entries');
    db.close();
  });

  it('Given an active LedgerDatabase instance When isHealthy is checked Then it reports health accurately, and if the handle is closed or invalid isHealthy returns false', () => {
    const LedgerDatabase = (dbModule as Record<string, unknown>).LedgerDatabase as new (opts: {
      dbPath: string;
      encryptionKey: string;
    }) => {
      isHealthy: () => boolean;
      close: () => void;
    };

    const db = new LedgerDatabase({ dbPath, encryptionKey: testSecret });
    assert.equal(typeof db.isHealthy, 'function', 'isHealthy method should exist on LedgerDatabase');
    assert.equal(db.isHealthy(), true, 'Active database connection should be healthy');
    db.close();
    assert.equal(db.isHealthy(), false, 'Closed database connection should not be healthy');
  });

  it('Given an encrypted database When addLedgerEntry or createCustomer is called Then WAL checkpoint is executed so main sqlite file size updates immediately', () => {
    const LedgerDatabase = (dbModule as Record<string, unknown>).LedgerDatabase as new (opts: {
      dbPath: string;
      encryptionKey: string;
    }) => {
      createCustomer: (input: { name: string; defaultYard: string; balance: number }) => { id: string };
      addLedgerEntry: (input: {
        customerId: string;
        invoice?: number;
        paid?: number;
        memo?: string;
      }) => unknown;
      close: () => void;
    };

    const db = new LedgerDatabase({ dbPath, encryptionKey: testSecret });
    const cust = db.createCustomer({
      name: 'WAL Flush Check Corp',
      defaultYard: 'North Yard',
      balance: 100,
    });
    db.addLedgerEntry({
      customerId: cust.id,
      invoice: 250,
      paid: 0,
      memo: 'Immediate flush test',
    });

    // Check that accounts_dues.sqlite size on disk is non-zero and wal file is truncated (0 bytes or non-existent)
    const walPath = `${dbPath}-wal`;
    if (fs.existsSync(walPath)) {
      const walStat = fs.statSync(walPath);
      assert.equal(walStat.size, 0, 'WAL file should be truncated to 0 bytes after immediate transaction checkpoint');
    }
    const dbStat = fs.statSync(dbPath);
    assert.ok(dbStat.size > 0, 'Main SQLite file should contain all committed data');

    db.close();
  });

  it('Given an existing customer "Ali" When createCustomer is called with name "Ali" or "ali" Then it throws an error that customer already exists', () => {
    const LedgerDatabase = (dbModule as Record<string, unknown>).LedgerDatabase as new (opts: {
      dbPath: string;
      encryptionKey: string;
    }) => {
      createCustomer: (input: { name: string; defaultYard?: string; balance?: number }) => { id: string; name: string };
      close: () => void;
    };

    const db = new LedgerDatabase({ dbPath, encryptionKey: testSecret });
    const cust1 = db.createCustomer({ name: 'Ali', balance: 100 });
    assert.equal(cust1.name, 'Ali');

    // Attempting exact match duplicate
    assert.throws(
      () => {
        db.createCustomer({ name: 'Ali', balance: 200 });
      },
      (err: Error) => {
        return /already exists/i.test(err.message);
      },
      'Should throw duplicate error for exact name match'
    );

    // Attempting case-insensitive duplicate "ali" with leading/trailing spaces
    assert.throws(
      () => {
        db.createCustomer({ name: '  ali  ', balance: 50 });
      },
      (err: Error) => {
        return /already exists/i.test(err.message);
      },
      'Should throw duplicate error for case-insensitive name match'
    );

    db.close();
  });

  it('Given existing customers "Ali" and "Bob" When Bob is renamed to "Ali" Then updateCustomer throws; When Ali is updated with the same name Then it succeeds', () => {
    const LedgerDatabase = (dbModule as Record<string, unknown>).LedgerDatabase as new (opts: {
      dbPath: string;
      encryptionKey: string;
    }) => {
      createCustomer: (input: { name: string; defaultYard?: string; balance?: number }) => { id: string; name: string };
      updateCustomer: (input: { id: string; name?: string; notes?: string }) => { id: string; name: string };
      close: () => void;
    };

    const db = new LedgerDatabase({ dbPath, encryptionKey: testSecret });
    const ali = db.createCustomer({ name: 'Ali', balance: 100 });
    const bob = db.createCustomer({ name: 'Bob', balance: 50 });

    // Attempting to rename Bob to Ali
    assert.throws(
      () => {
        db.updateCustomer({ id: bob.id, name: 'ali' });
      },
      (err: Error) => {
        return /already exists/i.test(err.message);
      },
      'Renaming Bob to Ali must throw duplicate error'
    );

    // Updating Ali without changing name or with same name must succeed
    const updatedAli = db.updateCustomer({ id: ali.id, name: 'Ali', notes: 'Updated notes' });
    assert.equal(updatedAli.name, 'Ali');

    db.close();
  });

  it('Given a 32-byte master key and a supervisor passcode When wrapMasterKeyWithPassword and unwrapMasterKeyWithPassword are used Then correct passcode unwraps the exact key and wrong passcode throws ERR_INCORRECT_PASSWORD', () => {
    const rawMasterKey = 'a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0';
    const passcode = 'MySecurePass123!';

    const wrapped = (dbModule as Record<string, unknown>).wrapMasterKeyWithPassword as (
      key: string | Buffer,
      pass: string
    ) => { salt: string; wrapped: { iv: string; authTag: string; ciphertext: string } };
    const unwrapped = (dbModule as Record<string, unknown>).unwrapMasterKeyWithPassword as (
      payload: { iv: string; authTag: string; ciphertext: string },
      pass: string,
      salt: string
    ) => Buffer;

    assert.equal(typeof wrapped, 'function', 'wrapMasterKeyWithPassword should be exported');
    assert.equal(typeof unwrapped, 'function', 'unwrapMasterKeyWithPassword should be exported');

    const result = wrapped(rawMasterKey, passcode);
    assert.ok(result.salt, 'Should return salt');
    assert.ok(result.wrapped.iv, 'Should return iv');
    assert.ok(result.wrapped.authTag, 'Should return authTag');
    assert.ok(result.wrapped.ciphertext, 'Should return ciphertext');

    // 1. Unwrapping with the correct passcode succeeds
    const recoveredBuf = unwrapped(result.wrapped, passcode, result.salt);
    assert.equal(recoveredBuf.toString('hex'), rawMasterKey);

    // 2. Unwrapping with an incorrect passcode throws ERR_INCORRECT_PASSWORD
    assert.throws(
      () => {
        unwrapped(result.wrapped, 'WrongPasscode456!', result.salt);
      },
      (err: Error & { code?: string }) => {
        return err.code === 'ERR_INCORRECT_PASSWORD' || /incorrect supervisor password/i.test(err.message);
      }
    );
  });

  it('Given a master key and recovery codes When wrapMasterKeyWithRecoveryCode and unwrapMasterKeyWithRecoveryCode are used Then valid recovery code unwraps the key and invalid code throws error', () => {
    const rawMasterKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const recoveryCode = 'A1B2-C3D4';

    const wrapRec = (dbModule as Record<string, unknown>).wrapMasterKeyWithRecoveryCode as (
      key: string | Buffer,
      code: string
    ) => { codeHash: string; salt: string; iv: string; authTag: string; ciphertext: string };
    const unwrapRec = (dbModule as Record<string, unknown>).unwrapMasterKeyWithRecoveryCode as (
      envelopes: Array<{ codeHash: string; salt: string; iv: string; authTag: string; ciphertext: string }>,
      code: string
    ) => { masterKey: Buffer; matchedIndex: number };

    assert.equal(typeof wrapRec, 'function', 'wrapMasterKeyWithRecoveryCode should be exported');
    assert.equal(typeof unwrapRec, 'function', 'unwrapMasterKeyWithRecoveryCode should be exported');

    const env = wrapRec(rawMasterKey, recoveryCode);
    assert.ok(env.codeHash, 'Should have codeHash');

    // Case-insensitive and hyphen-insensitive recovery code match
    const unwrapped = unwrapRec([env], 'a1b2c3d4');
    assert.equal(unwrapped.masterKey.toString('hex'), rawMasterKey);
    assert.equal(unwrapped.matchedIndex, 0);

    // Invalid recovery code throws
    assert.throws(
      () => {
        unwrapRec([env], 'WRONG-CODE');
      },
      /invalid or already used recovery code/i
    );
  });

  it('Given a master key and passcode When createKeyEnvelope is written to disk Then the envelope file contains no plaintext master key and can be loaded cleanly', () => {
    const rawMasterKey = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
    const passcode = 'VaultBoss2026';
    const codes = ['RECV-0001', 'RECV-0002'];
    const hintQuestion = 'First pet name?';

    const createEnv = (dbModule as Record<string, unknown>).createKeyEnvelope as (
      key: string | Buffer,
      pass: string,
      recoveryCodes: string[],
      hint?: string
    ) => unknown;
    const saveEnv = (dbModule as Record<string, unknown>).saveKeyEnvelope as (
      filePath: string,
      env: unknown
    ) => void;
    const loadEnv = (dbModule as Record<string, unknown>).loadKeyEnvelope as (
      filePath: string
    ) => { version: number; isConfigured: boolean; hintQuestion?: string } | null;

    assert.equal(typeof createEnv, 'function', 'createKeyEnvelope should be exported');
    assert.equal(typeof saveEnv, 'function', 'saveKeyEnvelope should be exported');
    assert.equal(typeof loadEnv, 'function', 'loadKeyEnvelope should be exported');

    const env = createEnv(rawMasterKey, passcode, codes, hintQuestion);
    const envelopeFile = path.join(tempDir, 'master_key_envelope.json');
    saveEnv(envelopeFile, env);

    // Verify envelope file exists and does NOT contain the raw master key in plaintext
    const fileContent = fs.readFileSync(envelopeFile, 'utf8');
    assert.equal(fileContent.includes(rawMasterKey), false, 'Plaintext master key must NEVER exist in envelope file');
    assert.equal(fileContent.includes(passcode), false, 'Plaintext password must NEVER exist in envelope file');

    // Loading envelope parses properly
    const loaded = loadEnv(envelopeFile);
    assert.ok(loaded);
    assert.equal(loaded.version, 1);
    assert.equal(loaded.isConfigured, true);
    assert.equal(loaded.hintQuestion, hintQuestion);
  });

  it('Given consecutive failed unlock attempts When 5 incorrect passwords are provided Then getAuthLockoutStatus reports lockout active and further unlock attempts are blocked until lockout expires', () => {
    const recordFailed = (dbModule as Record<string, unknown>).recordFailedUnlockAttempt as (
      rootDir?: string
    ) => { locked: boolean; remainingSeconds: number; attemptsRemaining: number };
    const getLockout = (dbModule as Record<string, unknown>).getAuthLockoutStatus as (
      rootDir?: string
    ) => { locked: boolean; remainingSeconds: number };
    const resetFailed = (dbModule as Record<string, unknown>).resetFailedUnlockAttempts as (
      rootDir?: string
    ) => void;

    assert.equal(typeof recordFailed, 'function', 'recordFailedUnlockAttempt should be exported');
    assert.equal(typeof getLockout, 'function', 'getAuthLockoutStatus should be exported');
    assert.equal(typeof resetFailed, 'function', 'resetFailedUnlockAttempts should be exported');

    resetFailed(tempDir);
    assert.equal(getLockout(tempDir).locked, false);

    // 4 failed attempts should not lock out yet
    for (let i = 1; i <= 4; i++) {
      const res = recordFailed(tempDir);
      assert.equal(res.locked, false);
      assert.equal(res.attemptsRemaining, 5 - i);
    }

    // 5th failed attempt triggers lockout
    const fifth = recordFailed(tempDir);
    assert.equal(fifth.locked, true);
    assert.ok(fifth.remainingSeconds > 0);

    const status = getLockout(tempDir);
    assert.equal(status.locked, true);
    assert.ok(status.remainingSeconds > 250); // ~300 seconds

    // Resetting clears the lockout
    resetFailed(tempDir);
    assert.equal(getLockout(tempDir).locked, false);
  });

  it('Given a configured master key envelope When unlockWithPasscode or unlockWithRecoveryCode is called Then database unlocks in memory and provides full access', () => {
    const rawMasterKey = 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';
    const passcode = 'VaultPass999';
    const codes = ['REC-1111', 'REC-2222'];
    const hintQuestion = 'Favorite port?';

    const createEnv = (dbModule as Record<string, unknown>).createKeyEnvelope as (
      key: string | Buffer,
      pass: string,
      recoveryCodes: string[],
      hint?: string
    ) => unknown;
    const saveEnv = (dbModule as Record<string, unknown>).saveKeyEnvelope as (
      filePath: string,
      env: unknown
    ) => void;
    const isLocked = (dbModule as Record<string, unknown>).isDatabaseLocked as (
      rootDir?: string
    ) => boolean;
    const unlockPass = (dbModule as Record<string, unknown>).unlockWithPasscode as (
      pass: string,
      rootDir?: string
    ) => { ok: boolean; error?: string };
    const unlockRec = (dbModule as Record<string, unknown>).unlockWithRecoveryCode as (
      code: string,
      newPass: string,
      confirmPass?: string,
      rootDir?: string
    ) => { ok: boolean; newCode?: string; error?: string };
    const clearSession = (dbModule as Record<string, unknown>).clearSessionMasterKey as () => void;

    assert.equal(typeof isLocked, 'function', 'isDatabaseLocked should be exported');
    assert.equal(typeof unlockPass, 'function', 'unlockWithPasscode should be exported');
    assert.equal(typeof unlockRec, 'function', 'unlockWithRecoveryCode should be exported');

    // Create envelope in tempDir
    const secretsDir = path.join(tempDir, 'secrets');
    fs.mkdirSync(secretsDir, { recursive: true });
    const envelopeFile = path.join(secretsDir, 'master_key_envelope.json');
    const env = createEnv(rawMasterKey, passcode, codes, hintQuestion);
    saveEnv(envelopeFile, env);

    clearSession();
    assert.equal(isLocked(tempDir), true, 'Database should be locked before password unlock');

    // Wrong passcode fails
    const failRes = unlockPass('WrongPassword', tempDir);
    assert.equal(failRes.ok, false);
    assert.equal(isLocked(tempDir), true);

    // Correct passcode unlocks
    const successRes = unlockPass(passcode, tempDir);
    assert.equal(successRes.ok, true);
    assert.equal(isLocked(tempDir), false, 'Database should be unlocked after successful passcode');

    // Lock again
    clearSession();
    assert.equal(isLocked(tempDir), true);

    // Recovery code unlocks and changes passcode
    const recRes = unlockRec('rec-1111', 'BrandNewPass888', 'BrandNewPass888', tempDir);
    assert.equal(recRes.ok, true);
    assert.ok(recRes.newCode);
    assert.equal(isLocked(tempDir), false);

    // Relock and verify new password works
    clearSession();
    assert.equal(isLocked(tempDir), true);
    const newUnlockRes = unlockPass('BrandNewPass888', tempDir);
    assert.equal(newUnlockRes.ok, true);
    assert.equal(isLocked(tempDir), false);
  });
});

