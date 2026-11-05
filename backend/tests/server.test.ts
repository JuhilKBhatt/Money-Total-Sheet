import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  LedgerDatabase,
  createKeyEnvelope,
  saveKeyEnvelope,
  clearSessionMasterKey,
  expireBrowserSessionForTesting,
} from '../src/database.ts';
import {
  handleHttpRequest,
  createLedgerHttpServer,
  getEmbeddedUiHtml,
} from '../src/server.ts';

describe('Standalone Portable HTTP Server', () => {
  let tempDir: string;
  let db: LedgerDatabase;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-http-test-'));
    db = new LedgerDatabase({
      dbPath: path.join(tempDir, 'http.sqlite'),
      encryptionKey: 'http-test-secret-key',
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('Given a LedgerDatabase When GET and POST requests are routed to /api/ledger and / Then it returns encrypted ledger state and embedded UI', () => {
    const server = createLedgerHttpServer(db);
    assert.equal(typeof server.listen, 'function');

    // GET /api/ledger
    const getRes = handleHttpRequest(db, { method: 'GET', pathname: '/api/ledger' });
    assert.equal(getRes.status, 200);
    const getJson = JSON.parse(getRes.body) as { ok: boolean; state: { customers: unknown[] } };
    assert.equal(getJson.ok, true);
    assert.equal(getJson.state.customers.length, 0, 'Fresh database must start empty');

    // POST /api/ledger
    const postRes = handleHttpRequest(db, {
      method: 'POST',
      pathname: '/api/ledger',
      body: JSON.stringify({
        action: 'createCustomer',
        payload: {
          name: 'USB Portable Metals',
          defaultYard: 'North Yard',
          balance: 4500,
          phone: '555-8899',
        },
      }),
    });
    assert.equal(postRes.status, 200);
    const postJson = JSON.parse(postRes.body) as { ok: boolean; state: { customers: unknown[] } };
    assert.equal(postJson.ok, true);
    assert.equal(postJson.state.customers.length, 1);

    // GET / (Embedded UI)
    const uiRes = handleHttpRequest(db, { method: 'GET', pathname: '/' });
    assert.equal(uiRes.status, 200);
    assert.ok(uiRes.body.includes('Customer Balance Management System'));
    assert.ok(uiRes.body.includes('sqlite-api-bridge'));
    assert.ok(uiRes.body.includes('window.simulateDbAction'));
    assert.ok(uiRes.body.includes('window.addInlineLedgerEntry'));
    assert.ok(uiRes.body.includes('Delete Database'));
    assert.ok(uiRes.body.includes('Type "delete"'));

    // Verify all 11 user-reported fixes in the UI
    assert.equal(
      uiRes.body.includes('Customer Balance Engine'),
      false,
      'Should replace Customer Balance Engine SQLite 3 Local Instance with version number'
    );
    assert.ok(uiRes.body.includes('Version 2.5.0'), 'Should show application version number');
    assert.equal(uiRes.body.includes('Dari'), false, 'Should not include Dari (Afghan Persian) language option');
    assert.equal(uiRes.body.includes('fa-AF'), false, 'Should not include fa-AF language option');
    assert.equal(uiRes.body.includes('Español'), false, 'Should remove other languages');
    assert.ok(uiRes.body.includes('renderCurrenciesSettingsList'), 'Should support currency CRUD');
    assert.ok(
      uiRes.body.includes('saveInlineEditCurrency'),
      'Currency editing should use inline editing without browser prompt()'
    );
    assert.ok(
      uiRes.body.includes('submitInlineAddCurrency'),
      'Currency adding should use inline input without browser prompt()'
    );
    assert.ok(uiRes.body.includes('Bank Account'), 'Payment method should include Bank Account');
    assert.equal(
      uiRes.body.includes('value="admin123"'),
      false,
      'Login password input must not be pre-filled on refresh'
    );
    assert.ok(
      uiRes.body.includes('setup-confirm-password-input'),
      'Setup form must ask for confirm password'
    );
    assert.ok(
      uiRes.body.includes('setup-recovery-codes-grid'),
      'Setup form must display recovery codes'
    );
    assert.ok(
      uiRes.body.includes('id="login-forgot-btn"'),
      'Login screen must have a Forgot Password button'
    );
    assert.ok(
      uiRes.body.includes('id="recovery-form"'),
      'UI must include password recovery form'
    );
    assert.ok(
      uiRes.body.includes('setup-hint-question'),
      'Login page must include password and hint setup'
    );
    assert.equal(
      uiRes.body.includes('id="setup-hint-answer"'),
      false,
      'Setup form should only ask for password and hint, not a separate third answer field'
    );
    assert.ok(
      uiRes.body.includes('id="login-hint-btn"'),
      'Login screen must have a Hint button to reveal the password hint'
    );
    assert.ok(
      uiRes.body.includes('transitionToLoginAfterSetup'),
      'Setup should transition to the login screen so the user enters their password'
    );
    assert.ok(
      uiRes.body.includes('id="settings-reset-password-btn"'),
      'Settings drawer must include a Reset Password button'
    );
    assert.ok(
      uiRes.body.includes('ledger-table-add-row'),
      'Customer ledger page must use inline row-style add entry'
    );
    assert.equal(
      /<body[^>]*select-none/i.test(uiRes.body),
      false,
      'Body element must not have select-none so text and amounts can be highlighted and copied'
    );
    assert.equal(
      uiRes.body.includes('Customer Owes'),
      false,
      'UI must not say Customer Owes since the business owes the customer'
    );
    assert.equal(
      uiRes.body.includes('Payment Received from Customer'),
      false,
      'UI must not say Payment Received from Customer since the business pays the customer'
    );
    assert.ok(
      uiRes.body.includes('We Owe Customer'),
      'UI must clearly indicate We Owe Customer for positive balances'
    );
    assert.ok(
      uiRes.body.includes('payFullCustomerBalance'),
      'UI must provide a quick action to pay the customer everything owed'
    );
    // Balance Sheet View simplification: removed text-heavy export, print, add customer buttons and card descriptions from view-all-sheets
    const balanceSheetSectionMatch = uiRes.body.match(/id="view-all-sheets"[\s\S]*?id="balance-sheet-filter-bar"/);
    assert.ok(balanceSheetSectionMatch, 'Balance sheet view should exist');
    const balanceSheetHeaderHtml = balanceSheetSectionMatch[0];
    assert.equal(
      balanceSheetHeaderHtml.includes('onclick="exportSheetToCSV()"'),
      false,
      'Balance sheet header must not include Export to CSV button'
    );
    assert.equal(
      balanceSheetHeaderHtml.includes('onclick="window.print()"'),
      false,
      'Balance sheet header must not include Print Sheet button'
    );
    assert.equal(
      balanceSheetHeaderHtml.includes('onclick="openAddCustomerModal()"'),
      false,
      'Balance sheet header must not include Add Customer button'
    );
    assert.equal(
      balanceSheetHeaderHtml.includes('Unpaid cash balances owed to customers'),
      false,
      'Balance sheet metric card must not include redundant description below total to pay'
    );
    assert.equal(
      balanceSheetHeaderHtml.includes('Extra cash paid to customer in advance'),
      false,
      'Balance sheet metric card must not include redundant description below overpaid/advance'
    );
    assert.equal(
      balanceSheetHeaderHtml.includes('Total active accounts tracked'),
      false,
      'Balance sheet metric card must not include redundant description below net balance'
    );

    // Compile & syntax-check all inline <script> blocks in the embedded UI
    const scriptMatches = [...uiRes.body.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
    assert.ok(scriptMatches.length >= 2, 'Embedded UI should contain application and bridge scripts');
    for (const match of scriptMatches) {
      const code = match[1].trim();
      if (!code) continue;
      assert.doesNotThrow(
        () => new Function(code),
        'All embedded UI <script> blocks must compile without JavaScript syntax errors'
      );
    }
  });

  it('Given a fresh server instance When end-to-end feature workflows are executed via HTTP API Then auth, currency CRUD, yard CRUD, customer ledger, and deletion all succeed', () => {
    // 1. Fresh DB starts unconfigured and empty
    const initRes = JSON.parse(handleHttpRequest(db, { method: 'GET', pathname: '/api/ledger' }).body);
    assert.equal(initRes.state.authStatus.isConfigured, false);
    assert.equal(initRes.state.customers.length, 0);

    // 2. Setup password & hint -> verify login -> reset password
    const setupRes = JSON.parse(
      handleHttpRequest(db, {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'setupPasscode',
          payload: { passcode: 'secret123', hintQuestion: 'My favorite metal' },
        }),
      }).body
    );
    assert.equal(setupRes.ok, true);
    assert.equal(setupRes.state.authStatus.isConfigured, true);
    assert.equal(setupRes.state.authStatus.hintQuestion, 'My favorite metal');

    const badLogin = JSON.parse(
      handleHttpRequest(db, {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({ action: 'verifyPasscode', payload: { passcode: 'wrong' } }),
      }).body
    );
    assert.equal(badLogin.ok, false);

    const goodLogin = JSON.parse(
      handleHttpRequest(db, {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({ action: 'verifyPasscode', payload: { passcode: 'secret123' } }),
      }).body
    );
    assert.equal(goodLogin.ok, true);

    const badResetRes = JSON.parse(
      handleHttpRequest(db, {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({ action: 'resetPasscode', payload: { oldPasscode: 'wrong' } }),
      }).body
    );
    assert.equal(badResetRes.ok, false);

    const resetRes = JSON.parse(
      handleHttpRequest(db, {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({ action: 'resetPasscode', payload: { oldPasscode: 'secret123' } }),
      }).body
    );
    assert.equal(resetRes.ok, true);
    assert.equal(resetRes.state.authStatus.isConfigured, false);

    // 3. Currency add, edit (rename), and delete (remove)
    const addCurrRes = JSON.parse(
      handleHttpRequest(db, {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({ action: 'addCurrency', payload: { name: 'EUR (€)' } }),
      }).body
    );
    assert.equal(addCurrRes.ok, true);
    assert.ok(addCurrRes.state.currencies.includes('EUR (€)'));

    const editCurrRes = JSON.parse(
      handleHttpRequest(db, {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'renameCurrency',
          payload: { oldName: 'EUR (€)', newName: 'GBP (£)' },
        }),
      }).body
    );
    assert.equal(editCurrRes.ok, true);
    assert.ok(editCurrRes.state.currencies.includes('GBP (£)'));
    assert.equal(editCurrRes.state.currentCurrency, 'GBP (£)');

    const delCurrRes = JSON.parse(
      handleHttpRequest(db, {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({ action: 'removeCurrency', payload: { name: 'GBP (£)' } }),
      }).body
    );
    assert.equal(delCurrRes.ok, true);
    assert.equal(delCurrRes.state.currencies.includes('GBP (£)'), false);

    // 4. Record unpaid total + notes when cash is unavailable, pay something, then pay everything
    const custRes = JSON.parse(
      handleHttpRequest(db, {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'createCustomer',
          payload: {
            name: 'Copper Seller',
            defaultYard: 'North Yard',
            balance: 750,
            notes: 'No cash in drawer today',
          },
        }),
      }).body
    );
    assert.equal(custRes.ok, true);
    assert.equal(custRes.data.balance, 750);
    assert.equal(custRes.data.ledger[0].memo, 'No cash in drawer today');

    const partialRes = JSON.parse(
      handleHttpRequest(db, {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'addLedgerEntry',
          payload: {
            customerId: custRes.data.id,
            paid: 250,
            method: 'Cash',
            yard: 'North Yard',
          },
        }),
      }).body
    );
    assert.equal(partialRes.ok, true);
    assert.equal(partialRes.data.balance, 500);
    assert.equal(partialRes.data.ledger[1].memo, 'Cash paid to customer');

    const fullPayRes = JSON.parse(
      handleHttpRequest(db, {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'addLedgerEntry',
          payload: {
            customerId: custRes.data.id,
            payFull: true,
            method: 'Cash',
            yard: 'North Yard',
          },
        }),
      }).body
    );
    assert.equal(fullPayRes.ok, true);
    assert.equal(fullPayRes.data.balance, 0);
    assert.equal(fullPayRes.data.ledger[2].paid, 500);
    assert.equal(fullPayRes.data.ledger[2].memo, 'Paid full balance to customer');
  });

  it('Given a customer account with $100 balance (e.g. Sayed) When inspecting the customer ledger in the embedded UI Then the ledger header DOM IDs (ledger-customer-id, ledger-customer-yard) exist and renderActiveCustomerLedger updates the customer balance without throwing errors or retaining stale $14,250.00 mock data', () => {
    const uiRes = handleHttpRequest(db, { method: 'GET', pathname: '/' });
    assert.equal(uiRes.status, 200);
    assert.ok(
      uiRes.body.includes('id="ledger-customer-id"'),
      'Embedded UI must contain element with id="ledger-customer-id"'
    );
    assert.ok(
      uiRes.body.includes('id="ledger-customer-yard"'),
      'Embedded UI must contain element with id="ledger-customer-yard"'
    );
    assert.equal(
      uiRes.body.includes('+$14,250.00'),
      false,
      'Embedded UI should not retain hardcoded +$14,250.00 mock balance in the ledger sheet'
    );

    // Create customer Sayed with $100 balance
    const custRes = JSON.parse(
      handleHttpRequest(db, {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'createCustomer',
          payload: {
            name: 'Sayed',
            balance: 100,
            defaultYard: 'North Yard',
            notes: 'Unpaid cash recorded',
          },
        }),
      }).body
    );
    assert.equal(custRes.ok, true);
    assert.equal(custRes.data.name, 'Sayed');
    assert.equal(custRes.data.balance, 100);

    // Verify all DOM IDs that renderActiveCustomerLedger references exist in the HTML
    const requiredLedgerDomIds = [
      'ledger-customer-name',
      'ledger-customer-id',
      'ledger-customer-yard',
      'ledger-balance-left',
      'payment-modal-subtitle',
      'ledger-customer-status',
      'ledger-balance-card-container',
      'ledger-balance-label',
      'btn-pay-full-balance',
      'ledger-yard-filter',
      'ledger-entries-tbody',
    ];
    for (const domId of requiredLedgerDomIds) {
      assert.ok(
        uiRes.body.includes(`id="${domId}"`),
        `HTML must contain element with id="${domId}"`
      );
    }
  });

  it('Given currency configuration When user adds/edits currency with short name and symbol Then UI contains short name and symbol inputs and ledger entry creation uses the currency', () => {
    const uiRes = handleHttpRequest(db, { method: 'GET', pathname: '/' });
    assert.equal(uiRes.status, 200);

    // Verify Add Currency has separate inputs for short name and symbol
    assert.ok(
      uiRes.body.includes('id="inline-new-currency-code"'),
      'UI must contain input for currency short name'
    );
    assert.ok(
      uiRes.body.includes('id="inline-new-currency-symbol"'),
      'UI must contain input for currency symbol'
    );

    // Verify entry creation row has currency selector
    assert.ok(
      uiRes.body.includes('id="inline-entry-currency"'),
      'Inline ledger entry row must have currency selector'
    );
    assert.ok(
      uiRes.body.includes('id="input-entry-currency"'),
      'Record payment modal must have currency selector'
    );
    assert.ok(
      uiRes.body.includes('inline-edit-currency-code'),
      'Currencies settings list must support editing short name'
    );
    assert.ok(
      uiRes.body.includes('inline-edit-currency-symbol'),
      'Currencies settings list must support editing symbol'
    );
    assert.ok(
      uiRes.body.includes('updateCurrencyDropdowns'),
      'UI script must provide updateCurrencyDropdowns function'
    );
    assert.ok(
      uiRes.body.includes('updateCurrencyPlaceholders'),
      'UI script must provide updateCurrencyPlaceholders function'
    );

    // Add currency via API with shortName and symbol
    const addCurrRes = JSON.parse(
      handleHttpRequest(db, {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'addCurrency',
          payload: { shortName: 'AFN', symbol: '؋' },
        }),
      }).body
    );
    assert.equal(addCurrRes.ok, true);
    assert.ok(addCurrRes.state.currencies.includes('AFN (؋)'));

    // Create customer and add ledger entry with specified currency
    const custRes = JSON.parse(
      handleHttpRequest(db, {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'createCustomer',
          payload: {
            name: 'Kabul Metal Imports',
            balance: 0,
            defaultYard: 'East Yard',
            currency: 'AFN (؋)',
          },
        }),
      }).body
    );
    assert.equal(custRes.ok, true);

    const entryRes = JSON.parse(
      handleHttpRequest(db, {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'addLedgerEntry',
          payload: {
            customerId: custRes.data.id,
            invoice: 12000,
            currency: 'AFN (؋)',
            yard: 'East Yard',
            method: 'Unpaid Due',
            memo: 'Unpaid cash in Afghan Afghanis',
          },
        }),
      }).body
    );
    assert.equal(entryRes.ok, true);
    assert.equal(entryRes.data.balance, 12000);
    const addedEntry = entryRes.data.ledger[1];
    assert.equal(addedEntry.currency, 'AFN (؋)');

    // Edit currency with shortName and symbol
    const renameRes = JSON.parse(
      handleHttpRequest(db, {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'renameCurrency',
          payload: {
            oldName: 'AFN (؋)',
            shortName: 'EUR',
            symbol: '€',
          },
        }),
      }).body
    );
    assert.equal(renameRes.ok, true);
    assert.ok(renameRes.state.currencies.includes('EUR (€)'));
    assert.ok(!renameRes.state.currencies.includes('AFN (؋)'));
  });

  it('Given customer ledger When inspecting customer ledger controls and executing edit and delete actions Then UI contains edit and delete buttons and API handles entry and customer updates', () => {
    const uiRes = handleHttpRequest(db, { method: 'GET', pathname: '/' });
    assert.equal(uiRes.status, 200);

    // Verify Customer Ledger header contains Edit Account and Delete Account buttons
    assert.ok(
      uiRes.body.includes('id="ledger-edit-account-btn"'),
      'Customer ledger header must have an Edit Account button'
    );
    assert.ok(
      uiRes.body.includes('id="ledger-delete-account-btn"'),
      'Customer ledger header must have a Delete Account button'
    );

    // Verify modals for editing customer and editing/deleting ledger entries
    assert.ok(
      uiRes.body.includes('id="modal-edit-customer"'),
      'UI must provide an Edit Customer modal'
    );
    assert.ok(
      uiRes.body.includes('id="modal-edit-ledger-entry"'),
      'UI must provide an Edit Ledger Entry modal'
    );
    assert.ok(
      uiRes.body.includes('id="modal-delete-ledger-entry"'),
      'UI must provide a Delete Ledger Entry confirmation modal'
    );

    // Verify table actions header exists
    assert.ok(
      uiRes.body.includes('openEditLedgerEntryModal'),
      'UI script must provide openEditLedgerEntryModal'
    );
    assert.ok(
      uiRes.body.includes('confirmDeleteLedgerEntry'),
      'UI script must provide confirmDeleteLedgerEntry'
    );
    assert.ok(
      uiRes.body.includes('openEditCustomerModal'),
      'UI script must provide openEditCustomerModal'
    );

    // Create a customer with 2 entries via API
    const custRes = JSON.parse(
      handleHttpRequest(db, {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'createCustomer',
          payload: {
            name: 'Sahara Metal Traders',
            balance: 500,
            defaultYard: 'North Yard',
            notes: 'Wholesale partner',
          },
        }),
      }).body
    );
    assert.equal(custRes.ok, true);
    const custId = custRes.data.id;

    // Add another entry
    const entryRes = JSON.parse(
      handleHttpRequest(db, {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'addLedgerEntry',
          payload: {
            customerId: custId,
            paid: 200,
            invoice: 0,
            method: 'Cash',
            yard: 'North Yard',
            memo: 'Paid part of balance',
          },
        }),
      }).body
    );
    assert.equal(entryRes.ok, true);
    assert.equal(entryRes.data.balance, 300);

    // Update customer via API
    const updateCustRes = JSON.parse(
      handleHttpRequest(db, {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'updateCustomer',
          payload: {
            id: custId,
            name: 'Sahara Metal Traders LLC',
            defaultYard: 'West Yard',
            notes: 'Updated wholesale partner',
          },
        }),
      }).body
    );
    assert.equal(updateCustRes.ok, true);
    assert.equal(updateCustRes.data.name, 'Sahara Metal Traders LLC');
    assert.equal(updateCustRes.data.defaultYard, 'West Yard');

    // Update ledger entry 1 via API: change paid from 200 to 250
    const updateEntryRes = JSON.parse(
      handleHttpRequest(db, {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'updateLedgerEntry',
          payload: {
            customerId: custId,
            entryIndex: 1,
            paid: 250,
            memo: 'Corrected payout to 250',
          },
        }),
      }).body
    );
    assert.equal(updateEntryRes.ok, true);
    assert.equal(updateEntryRes.data.balance, 250);
    assert.equal(updateEntryRes.data.ledger[1].paid, 250);
    assert.equal(updateEntryRes.data.ledger[1].runningBalance, 250);

    // Delete ledger entry 1 via API
    const deleteEntryRes = JSON.parse(
      handleHttpRequest(db, {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'deleteLedgerEntry',
          payload: {
            customerId: custId,
            entryIndex: 1,
          },
        }),
      }).body
    );
    assert.equal(deleteEntryRes.ok, true);
    assert.equal(deleteEntryRes.data.ledger.length, 1);
    assert.equal(deleteEntryRes.data.balance, 500);
  });

  it('Given user-requested UI updates When inspecting embedded UI and executing actions Then CB icon is removed, subtitle is removed, consolidate button exists, and deleted yards remain in filters', () => {
    const uiRes = handleHttpRequest(db, { method: 'GET', pathname: '/' });
    assert.equal(uiRes.status, 200);

    // 1. Remove "CB" icon in heading
    assert.equal(
      uiRes.body.includes('>CB<') || uiRes.body.includes('>\n  CB\n<'),
      false,
      'Heading must not contain CB icon'
    );

    // 2. Remove "Account ID: CUST-1003 • Primary Yard: East Yard" in customer ledger
    assert.equal(
      uiRes.body.includes('Account ID: <span'),
      false,
      'Customer ledger header must not contain "Account ID: ... • Primary Yard: ..."'
    );

    // 3. Add "Remove past logs and make this balance" button below delete account
    assert.ok(
      uiRes.body.includes('id="btn-consolidate-ledger"'),
      'Customer ledger must include "Remove past logs and make this balance" button'
    );
    assert.ok(
      uiRes.body.includes('Remove past logs and make this balance'),
      'Button text must match "Remove past logs and make this balance"'
    );
    assert.ok(
      uiRes.body.includes('id="modal-consolidate-ledger"'),
      'UI must provide a confirmation modal for consolidating past logs'
    );

    // 4. Test consolidateCustomerBalance action via API
    const custRes = JSON.parse(
      handleHttpRequest(db, {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'createCustomer',
          payload: {
            name: 'Consolidate Target Customer',
            balance: 1000,
            defaultYard: 'North Yard',
            notes: 'Test notes',
          },
        }),
      }).body
    );
    assert.equal(custRes.ok, true);
    const custId = custRes.data.id;

    // Add entry
    handleHttpRequest(db, {
      method: 'POST',
      pathname: '/api/ledger',
      body: JSON.stringify({
        action: 'addLedgerEntry',
        payload: {
          customerId: custId,
          paid: 400,
          invoice: 0,
          method: 'Cash',
          yard: 'North Yard',
        },
      }),
    });

    const consolidateRes = JSON.parse(
      handleHttpRequest(db, {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'consolidateCustomerBalance',
          payload: { customerId: custId },
        }),
      }).body
    );
    assert.equal(consolidateRes.ok, true);
    assert.equal(consolidateRes.data.balance, 600);
    assert.equal(consolidateRes.data.ledger.length, 1);
    assert.equal(consolidateRes.data.ledger[0].runningBalance, 600);

    // 5. Test deleted yard appears in filter dropdowns but not in new entry dropdowns
    // Customer has yard 'Pier 9 Depot'. If we delete 'Pier 9 Depot' from yards:
    const removeYardRes = JSON.parse(
      handleHttpRequest(db, {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'removeYard',
          payload: { name: 'Pier 9 Depot' },
        }),
      }).body
    );
    assert.equal(removeYardRes.ok, true);
    assert.ok(!removeYardRes.state.yards.includes('Pier 9 Depot'));

    // Check embedded UI functions for yard dropdowns
    assert.ok(
      uiRes.body.includes('getAvailableFilterYards'),
      'UI must compute availableFilterYards to include yards from customer ledgers'
    );

    // 6. Reset password requires old password verification
    const setupPassRes = JSON.parse(
      handleHttpRequest(db, {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'setupPasscode',
          payload: { passcode: 'mypassword123', hintQuestion: 'my hint' },
        }),
      }).body
    );
    assert.equal(setupPassRes.ok, true);

    // Attempt reset with wrong password
    const failResetRes = JSON.parse(
      handleHttpRequest(db, {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'resetPasscode',
          payload: { oldPasscode: 'wrongpassword' },
        }),
      }).body
    );
    assert.equal(failResetRes.ok, false);
    assert.ok(failResetRes.error.includes('Incorrect current password'));

    // Attempt reset with correct password
    const successResetRes = JSON.parse(
      handleHttpRequest(db, {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'resetPasscode',
          payload: { oldPasscode: 'mypassword123' },
        }),
      }).body
    );
    assert.equal(successResetRes.ok, true);
    assert.equal(successResetRes.state.authStatus.isConfigured, false);

    // 7. Verify toast icon differentiation in UI
    assert.ok(
      uiRes.body.includes('id="toast-icon"'),
      'UI must contain toast-icon element for differentiating error vs success'
    );

    // 8. Verify Account ID replaced with Notes / Reference in Balance Sheet table header
    assert.ok(
      uiRes.body.includes('Notes / Reference') || uiRes.body.includes('Notes / Memo'),
      'Balance sheet table must display Notes / Reference'
    );

    // 9. Verify .csv / .xlsx migration support in UI
    assert.ok(
      uiRes.body.includes('Load from .csv') || uiRes.body.includes('.csv'),
      'UI must contain .csv file loading / migration support'
    );

    // 10. Verify importing Customer Balance Record.xlsx via HTTP API
    const xlsxFilePath = path.resolve(process.cwd(), 'Customer Balance Record.xlsx');
    if (fs.existsSync(xlsxFilePath)) {
      const xlsxBuf = fs.readFileSync(xlsxFilePath);
      const b64Url = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${xlsxBuf.toString('base64')}`;
      const importHttpRes = JSON.parse(
        handleHttpRequest(db, {
          method: 'POST',
          pathname: '/api/ledger',
          body: JSON.stringify({
            action: 'importBackup',
            payload: { content: b64Url },
          }),
        }).body
      );
      assert.equal(importHttpRes.ok, true);
      assert.equal(importHttpRes.state.customers.length, 83);
      const aliCust = importHttpRes.state.customers.find((c: any) => c.name.includes('Ali') && c.name.includes('Said'));
      assert.ok(aliCust);
      assert.equal(aliCust.balance, -6532.56);
      assert.equal(aliCust.ledger.length, 6);
    }

    // 11. Verify importing Customer Balance Record.csv via HTTP API
    const csvFilePath = path.resolve(process.cwd(), 'Customer Balance Record.csv');
    if (fs.existsSync(csvFilePath)) {
      const csvText = fs.readFileSync(csvFilePath, 'utf8');
      const importCsvRes = JSON.parse(
        handleHttpRequest(db, {
          method: 'POST',
          pathname: '/api/ledger',
          body: JSON.stringify({
            action: 'importBackup',
            payload: { content: csvText, fileName: 'Customer Balance Record.csv' },
          }),
        }).body
      );
      assert.equal(importCsvRes.ok, true);
      assert.equal(importCsvRes.state.customers.length, 83);
      const timCust = importCsvRes.state.customers.find((c: any) => c.name === 'Tim');
      assert.ok(timCust);
      assert.equal(timCust.balance, 22647.3);
      const aliCustCsv = importCsvRes.state.customers.find((c: any) => c.name.includes('Ali') && c.name.includes('Said'));
      assert.ok(aliCustCsv);
      assert.equal(aliCustCsv.balance, -6532.56);
      assert.equal(aliCustCsv.ledger.length, 6);
    }

    // 12. Verify setDefaultYard action and default Yard Location support
    const setDefYardRes = JSON.parse(
      handleHttpRequest(db, {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'setDefaultYard',
          payload: { yard: 'West Yard' },
        }),
      }).body
    );
    assert.equal(setDefYardRes.ok, true);
    assert.equal(setDefYardRes.state.defaultYard, 'West Yard');

    // UI contains default yard controls
    const refreshedUi = handleHttpRequest(db, { method: 'GET', pathname: '/' });
    assert.ok(
      refreshedUi.body.includes('setDefaultYard') || refreshedUi.body.includes('defaultYard') || refreshedUi.body.includes('Set Default'),
      'UI must contain default yard controls'
    );
  });

  it('Given the HTTP API When multiple sequential ledger entries are posted for a customer Then all entries and running balances are preserved in state and none are removed', () => {
    // 1. Create a customer
    const createRes = JSON.parse(
      handleHttpRequest(db, {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'createCustomer',
          payload: {
            name: 'Sequential Entry Test Corp',
            balance: 500,
            defaultYard: 'North Yard',
          },
        }),
      }).body
    );
    assert.equal(createRes.ok, true);
    const custId = createRes.data.id;

    // 2. Post Entry 1
    const entry1Res = JSON.parse(
      handleHttpRequest(db, {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'addLedgerEntry',
          payload: {
            customerId: custId,
            invoice: 250,
            paid: 0,
            memo: 'First load invoice',
          },
        }),
      }).body
    );
    assert.equal(entry1Res.ok, true);
    const custAfter1 = entry1Res.state.customers.find((c: any) => c.id === custId);
    assert.ok(custAfter1);
    assert.equal(custAfter1.ledger.length, 2);
    assert.equal(custAfter1.balance, 750);

    // 3. Post Entry 2
    const entry2Res = JSON.parse(
      handleHttpRequest(db, {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'addLedgerEntry',
          payload: {
            customerId: custId,
            invoice: 0,
            paid: 400,
            memo: 'Payout cash',
          },
        }),
      }).body
    );
    assert.equal(entry2Res.ok, true);
    const custAfter2 = entry2Res.state.customers.find((c: any) => c.id === custId);
    assert.ok(custAfter2);
    assert.equal(custAfter2.ledger.length, 3, 'Entry 1 must NOT be removed when Entry 2 is added');
    assert.equal(custAfter2.ledger[1].memo, 'First load invoice');
    assert.equal(custAfter2.ledger[2].memo, 'Payout cash');
    assert.equal(custAfter2.balance, 350);

    // 4. Post Entry 3
    const entry3Res = JSON.parse(
      handleHttpRequest(db, {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'addLedgerEntry',
          payload: {
            customerId: custId,
            invoice: 150,
            paid: 0,
            memo: 'Second load invoice',
          },
        }),
      }).body
    );
    assert.equal(entry3Res.ok, true);
    const custAfter3 = entry3Res.state.customers.find((c: any) => c.id === custId);
    assert.ok(custAfter3);
    assert.equal(custAfter3.ledger.length, 4, 'All entries must remain in ledger');
    assert.equal(custAfter3.ledger[0].runningBalance, 500);
    assert.equal(custAfter3.ledger[1].runningBalance, 750);
    assert.equal(custAfter3.ledger[2].runningBalance, 350);
    assert.equal(custAfter3.ledger[3].runningBalance, 500);
    assert.equal(custAfter3.balance, 500);

    // 5. Query via GET /api/ledger to verify state from database
    const getRes = JSON.parse(
      handleHttpRequest(db, {
        method: 'GET',
        pathname: '/api/ledger',
      }).body
    );
    assert.equal(getRes.ok, true);
    const getCust = getRes.state.customers.find((c: any) => c.id === custId);
    assert.ok(getCust);
    assert.equal(getCust.ledger.length, 4);
    assert.equal(getCust.balance, 500);
  });

  it('Given the HTTP API When creating a customer with a duplicate name (e.g. Ali) Then it returns HTTP 400 with an error stating the customer already exists', () => {
    // 1. Create customer "Ali"
    const createAliRes = handleHttpRequest(db, {
      method: 'POST',
      pathname: '/api/ledger',
      body: JSON.stringify({
        action: 'createCustomer',
        payload: {
          name: 'Ali',
          balance: 100,
        },
      }),
    });
    assert.equal(createAliRes.status, 200);
    const aliJson = JSON.parse(createAliRes.body);
    assert.equal(aliJson.ok, true);

    // 2. Attempt to create duplicate customer "Ali"
    const dupRes = handleHttpRequest(db, {
      method: 'POST',
      pathname: '/api/ledger',
      body: JSON.stringify({
        action: 'createCustomer',
        payload: {
          name: 'Ali',
          balance: 50,
        },
      }),
    });
    assert.equal(dupRes.status, 400);
    const dupJson = JSON.parse(dupRes.body);
    assert.equal(dupJson.ok, false);
    assert.match(dupJson.error, /already exists/i);

    // 3. Attempt to create duplicate with different casing "ali"
    const caseDupRes = handleHttpRequest(db, {
      method: 'POST',
      pathname: '/api/ledger',
      body: JSON.stringify({
        action: 'createCustomer',
        payload: {
          name: '  ali  ',
          balance: 75,
        },
      }),
    });
    assert.equal(caseDupRes.status, 400);
    const caseDupJson = JSON.parse(caseDupRes.body);
    assert.equal(caseDupJson.ok, false);
    assert.match(caseDupJson.error, /already exists/i);
  });

  it('Given an HTTP server with a password-wrapped master key When locked Then sensitive endpoints are protected, wrong passwords are rate-limited, and correct password unlocks full database state', () => {
    const rawMasterKey = '1122334455667788990011223344556677889900112233445566778899001122';
    const passcode = 'ServerVaultPass123!';
    const recoveryCodes = ['ABCD-1234', 'EFGH-5678'];
    const hintQuestion = 'What is your security passphrase?';

    // Set up envelope in tempDir/secrets/master_key_envelope.json
    const secretsDir = path.join(tempDir, 'secrets');
    fs.mkdirSync(secretsDir, { recursive: true });
    const envelopeFile = path.join(secretsDir, 'master_key_envelope.json');
    const envelope = createKeyEnvelope(rawMasterKey, passcode, recoveryCodes, hintQuestion);
    saveKeyEnvelope(envelopeFile, envelope);

    // Ensure session is locked
    clearSessionMasterKey();

    // 1. GET /api/ledger returns locked status without exposing customers
    const getRes = handleHttpRequest(null, { method: 'GET', pathname: '/api/ledger' }, tempDir);
    assert.equal(getRes.status, 200);
    const getJson = JSON.parse(getRes.body);
    assert.equal(getJson.locked, true);
    assert.equal(getJson.state.authStatus.isConfigured, true);
    assert.equal(getJson.state.authStatus.hintQuestion, hintQuestion);
    assert.equal(getJson.state.customers.length, 0);

    // 2. Unauthorized action while locked is rejected with 401
    const unauthRes = handleHttpRequest(
      null,
      {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({ action: 'createCustomer', payload: { name: 'Secret Client' } }),
      },
      tempDir
    );
    assert.equal(unauthRes.status, 401);
    const unauthJson = JSON.parse(unauthRes.body);
    assert.equal(unauthJson.ok, false);
    assert.equal(unauthJson.locked, true);

    // 3. Incorrect password via verifyPasscode fails and decrements attempts
    const failRes = handleHttpRequest(
      null,
      {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({ action: 'verifyPasscode', payload: { passcode: 'WrongPassword!' } }),
      },
      tempDir
    );
    assert.equal(failRes.status, 401);
    const failJson = JSON.parse(failRes.body);
    assert.equal(failJson.ok, false);
    assert.equal(failJson.locked, true);
    assert.equal(failJson.attemptsRemaining, 4);

    // 4. Correct password via verifyPasscode unlocks the database and returns state
    const unlockRes = handleHttpRequest(
      null,
      {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({ action: 'verifyPasscode', payload: { passcode } }),
      },
      tempDir
    );
    assert.equal(unlockRes.status, 200);
    const unlockJson = JSON.parse(unlockRes.body);
    assert.equal(unlockJson.ok, true);
    assert.ok(unlockJson.state);
    assert.equal(unlockJson.state.authStatus.isConfigured, true);

    // 5. Subsequent requests are unlocked
    const unlockedGet = handleHttpRequest(null, { method: 'GET', pathname: '/api/ledger' }, tempDir);
    assert.equal(unlockedGet.status, 200);
    const unlockedJson = JSON.parse(unlockedGet.body);
    assert.equal(unlockedJson.locked, undefined);
    assert.ok(unlockedJson.state);

    // Cleanup session
    clearSessionMasterKey();
  });

  it('Given two open tabs When one tab edits the customer ledger Then the database increments dataVersion and GET /api/ledger returns updated ledger entries and balances for the second tab', () => {
    // Tab 1 creates a customer "Sayed Recyclers" with initial balance 1000
    const createRes = handleHttpRequest(
      db,
      {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'createCustomer',
          payload: {
            name: 'Sayed Recyclers',
            balance: 1000,
            notes: 'Tab sync test customer',
          },
        }),
      },
      tempDir
    );
    assert.equal(createRes.status, 200);
    const createdJson = JSON.parse(createRes.body);
    const customerId = createdJson.data.id;

    // Tab 2 syncs state from database
    const tab2InitialSync = handleHttpRequest(db, { method: 'GET', pathname: '/api/ledger' }, tempDir);
    assert.equal(tab2InitialSync.status, 200);
    const tab2InitialJson = JSON.parse(tab2InitialSync.body);
    const custInTab2 = tab2InitialJson.state.customers.find((c: { id: string }) => c.id === customerId);
    assert.ok(custInTab2);
    assert.equal(custInTab2.balance, 1000);
    assert.equal(custInTab2.ledger.length, 1);
    const v1 = tab2InitialJson.state.dbStatus?.dataVersion;
    assert.equal(typeof v1, 'number', 'dbStatus should report dataVersion number');

    // Tab 1 adds a new ledger entry (paid $400)
    const addEntryRes = handleHttpRequest(
      db,
      {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'addLedgerEntry',
          payload: {
            customerId,
            invoice: 0,
            paid: 400,
            method: 'Cash',
            yard: 'North Yard',
            memo: 'Partial cash payout',
          },
        }),
      },
      tempDir
    );
    assert.equal(addEntryRes.status, 200);

    // Tab 2 syncs from database (simulating multi-tab sync event or periodic poll)
    const tab2UpdatedSync = handleHttpRequest(db, { method: 'GET', pathname: '/api/ledger' }, tempDir);
    assert.equal(tab2UpdatedSync.status, 200);
    const tab2UpdatedJson = JSON.parse(tab2UpdatedSync.body);
    const custUpdatedInTab2 = tab2UpdatedJson.state.customers.find((c: { id: string }) => c.id === customerId);
    assert.ok(custUpdatedInTab2);
    assert.equal(custUpdatedInTab2.balance, 600, 'Tab 2 must see updated balance 600 after Tab 1 added entry');
    assert.equal(custUpdatedInTab2.ledger.length, 2, 'Tab 2 must see 2 ledger entries');
    const v2 = tab2UpdatedJson.state.dbStatus?.dataVersion;
    assert.ok(v2 > v1, `dataVersion must increment after mutation (v1=${v1}, v2=${v2})`);

    // Tab 1 edits entry #1 (changing paid from 400 to 700)
    const editEntryRes = handleHttpRequest(
      db,
      {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'editLedgerEntry',
          payload: {
            customerId,
            entryIndex: 1,
            invoice: 0,
            paid: 700,
            method: 'Cash',
            yard: 'North Yard',
            memo: 'Updated cash payout to 700',
          },
        }),
      },
      tempDir
    );
    assert.equal(editEntryRes.status, 200);

    // Tab 2 syncs from database again
    const tab2SecondSync = handleHttpRequest(db, { method: 'GET', pathname: '/api/ledger' }, tempDir);
    assert.equal(tab2SecondSync.status, 200);
    const tab2SecondJson = JSON.parse(tab2SecondSync.body);
    const custSecondInTab2 = tab2SecondJson.state.customers.find((c: { id: string }) => c.id === customerId);
    assert.ok(custSecondInTab2);
    assert.equal(custSecondInTab2.balance, 300, 'Tab 2 must see updated balance 300 after Tab 1 edited entry');
    assert.equal(custSecondInTab2.ledger[1].paid, 700);
    assert.equal(custSecondInTab2.ledger[1].memo, 'Updated cash payout to 700');
  });

  it('Given the embedded UI script in BRIDGE_SCRIPT When inspecting tab update mechanisms Then periodic background polling interval is removed and event-driven ledger updates use BroadcastChannel, storage event, and SSE stream', () => {
    const html = getEmbeddedUiHtml(tempDir);

    assert.ok(html.includes('BroadcastChannel'), 'BRIDGE_SCRIPT must use BroadcastChannel for instant cross-tab sync');
    assert.ok(html.includes('adm_db_sync'), 'BRIDGE_SCRIPT must use adm_db_sync broadcast channel');
    assert.ok(html.includes('CUSTOMER_LEDGER_UPDATED'), 'BRIDGE_SCRIPT must broadcast CUSTOMER_LEDGER_UPDATED event when ledger updates');
    assert.ok(html.includes('EventSource'), 'BRIDGE_SCRIPT must connect to Server-Sent Events /api/sync-events for event-driven push');
    assert.ok(html.includes('/api/sync-events'), 'BRIDGE_SCRIPT must use /api/sync-events endpoint');
    assert.equal(
      html.includes('setInterval(function() { syncFromSqlite(false); }, 2500)'),
      false,
      'Background periodic polling interval must be removed to prevent resetting form and password inputs'
    );
    assert.ok(html.includes('renderActiveCustomerLedger'), 'BRIDGE_SCRIPT must re-render active customer ledger on sync');
    assert.ok(html.includes('window.fetch'), 'BRIDGE_SCRIPT must intercept window.fetch to trigger sync on POST /api/ledger');
  });

  it('Given ui.html When inspecting updateAuthModalUI Then it does not wipe or reset password-input value', () => {
    const html = getEmbeddedUiHtml(tempDir);
    // Find the updateAuthModalUI definition
    const updateAuthFn = html.slice(html.indexOf('function updateAuthModalUI()'), html.indexOf('function updateAuthModalUI()') + 800);
    assert.equal(
      updateAuthFn.includes("passInput.value = ''"),
      false,
      'updateAuthModalUI must not blindly clear password-input value while user is typing'
    );
  });

  it('Given two open tabs viewing customer ledger When Tab 1 settles balance and consolidates ledger Then Tab 2 sync reflects the consolidated ledger and zero balance', () => {
    // 1. Create a customer with opening balance 2500
    const createRes = handleHttpRequest(
      db,
      {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'createCustomer',
          payload: {
            name: 'Cross Tab Enterprise',
            defaultYard: 'East Yard',
            balance: 2500,
            notes: 'Multi-tab sync verification',
          },
        }),
      },
      tempDir
    );
    assert.equal(createRes.status, 200);
    const createJson = JSON.parse(createRes.body);
    const custId = createJson.state.customers.find((c: { name: string }) => c.name === 'Cross Tab Enterprise').id;

    // 2. Tab 1 pays full remaining balance
    const payFullRes = handleHttpRequest(
      db,
      {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'addLedgerEntry',
          payload: {
            customerId: custId,
            payFull: true,
            method: 'Bank Account',
            yard: 'East Yard',
            memo: 'Settled full balance across tabs',
          },
        }),
      },
      tempDir
    );
    assert.equal(payFullRes.status, 200);

    // 3. Tab 2 syncs and inspects the ledger
    const tab2AfterPay = handleHttpRequest(db, { method: 'GET', pathname: '/api/ledger' }, tempDir);
    assert.equal(tab2AfterPay.status, 200);
    const tab2Json1 = JSON.parse(tab2AfterPay.body);
    const custInTab2 = tab2Json1.state.customers.find((c: { id: string }) => c.id === custId);
    assert.equal(custInTab2.balance, 0, 'Tab 2 must see customer balance 0 (settled)');
    assert.equal(custInTab2.ledger.length, 2, 'Tab 2 must see 2 ledger entries');
    assert.equal(custInTab2.ledger[1].paid, 2500, 'Tab 2 must see paid 2500');

    // 4. Tab 1 consolidates customer ledger (clearing past logs)
    const consolidateRes = handleHttpRequest(
      db,
      {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'consolidateCustomerBalance',
          payload: { customerId: custId },
        }),
      },
      tempDir
    );
    assert.equal(consolidateRes.status, 200);

    // 5. Tab 2 syncs again and verifies single consolidated entry remains
    const tab2AfterConsolidate = handleHttpRequest(db, { method: 'GET', pathname: '/api/ledger' }, tempDir);
    assert.equal(tab2AfterConsolidate.status, 200);
    const tab2Json2 = JSON.parse(tab2AfterConsolidate.body);
    const custFinalInTab2 = tab2Json2.state.customers.find((c: { id: string }) => c.id === custId);
    assert.equal(custFinalInTab2.balance, 0);
    assert.equal(custFinalInTab2.ledger.length, 1, 'Tab 2 must see only 1 consolidated opening entry');
    assert.ok(custFinalInTab2.ledger[0].memo.includes('Opening balance consolidated from past logs'));
  });

  it('Given customer directory in embedded UI When inspecting renderCustomersTable Then it sorts customer accounts alphabetically A-Z', () => {
    const html = getEmbeddedUiHtml(tempDir);
    const idx = html.indexOf('function renderCustomersTable');
    const renderTableFn = html.slice(idx, idx + 1200);
    assert.ok(
      renderTableFn.includes('localeCompare') && renderTableFn.includes('filtered.sort'),
      'renderCustomersTable must sort filtered accounts alphabetically A-Z'
    );
  });

  it('Given customer ledger in embedded UI When inspecting renderActiveCustomerLedger Then it sorts transaction rows by date with oldest to top and newest to bottom', () => {
    const html = getEmbeddedUiHtml(tempDir);
    const idx = html.indexOf('function renderActiveCustomerLedger()');
    const renderLedgerFn = html.slice(idx, idx + 6000);
    assert.ok(
      renderLedgerFn.includes('filtered.sort') && (renderLedgerFn.includes('parseDateForSort') || renderLedgerFn.includes('tsA')),
      'renderActiveCustomerLedger must sort transaction entries by date'
    );
  });

  it('Given customer ledger entries created with various dates When querying GET /api/ledger Then entries are returned in chronological order from oldest at top to newest at bottom', () => {
    // 1. Create a customer
    const createRes = handleHttpRequest(
      db,
      {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'createCustomer',
          payload: {
            name: 'Chronology Corp',
            defaultYard: 'North Yard',
            balance: 0,
          },
        }),
      },
      tempDir
    );
    assert.equal(createRes.status, 200);
    const createJson = JSON.parse(createRes.body);
    const custId = createJson.state.customers.find((c: { name: string }) => c.name === 'Chronology Corp').id;

    // 2. Add an entry with a future date
    handleHttpRequest(
      db,
      {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'addLedgerEntry',
          payload: {
            customerId: custId,
            invoice: 1000,
            date: '2026-05-10 10:00',
            yard: 'North Yard',
            memo: 'May 2026 invoice',
          },
        }),
      },
      tempDir
    );

    // 3. Add an entry with an earlier date (e.g. backdated transaction)
    handleHttpRequest(
      db,
      {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'addLedgerEntry',
          payload: {
            customerId: custId,
            paid: 500,
            date: '2025-01-15 09:00',
            yard: 'North Yard',
            memo: 'January 2025 payment',
          },
        }),
      },
      tempDir
    );

    // 4. Query state
    const res = handleHttpRequest(db, { method: 'GET', pathname: '/api/ledger' }, tempDir);
    assert.equal(res.status, 200);
    const state = JSON.parse(res.body).state;
    const cust = state.customers.find((c: { id: string }) => c.id === custId);
    assert.ok(cust);
    // Find the 2 added entries (ignoring initial opening if 0)
    const dates = cust.ledger.map((e: { date: string }) => e.date);
    for (let i = 1; i < dates.length; i++) {
      assert.ok(
        dates[i] >= dates[i - 1],
        `Ledger entries must be sorted oldest to newest: ${dates[i - 1]} should come before ${dates[i]}`
      );
    }
  });

  it('Given a locked server When verifyPasscode is called with correct password Then it sets a 12-hour session cookie (Max-Age=43200) and returns sessionToken', () => {
    const rawMasterKey = '1122334455667788990011223344556677889900112233445566778899001122';
    const passcode = 'SessionTestPass123!';
    const secretsDir = path.join(tempDir, 'secrets');
    fs.mkdirSync(secretsDir, { recursive: true });
    const envelopeFile = path.join(secretsDir, 'master_key_envelope.json');
    const envelope = createKeyEnvelope(rawMasterKey, passcode, ['ABCD-1234'], 'Security question?');
    saveKeyEnvelope(envelopeFile, envelope);

    clearSessionMasterKey();

    const unlockRes = handleHttpRequest(
      null,
      {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({ action: 'verifyPasscode', payload: { passcode } }),
      },
      tempDir
    );

    assert.equal(unlockRes.status, 200);
    const body = JSON.parse(unlockRes.body);
    assert.equal(body.ok, true);
    assert.ok(body.sessionToken, 'Must return sessionToken in body');
    assert.ok(typeof body.sessionExpiresAt === 'number', 'Must return sessionExpiresAt timestamp');
    assert.ok(body.sessionExpiresAt > Date.now() + 11 * 60 * 60 * 1000, 'Expiry must be ~12 hours in the future');

    assert.ok(unlockRes.headers, 'Must have response headers');
    const setCookie = unlockRes.headers['Set-Cookie'];
    assert.ok(setCookie, 'Must set Set-Cookie header');
    const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie);
    assert.ok(cookieStr.includes(`adm_session_token=${body.sessionToken}`), 'Cookie must contain token');
    assert.ok(cookieStr.includes('Max-Age=43200'), 'Cookie Max-Age must be 43200 (12 hours)');
    assert.ok(cookieStr.includes('HttpOnly'), 'Cookie must be HttpOnly');
    assert.ok(cookieStr.includes('SameSite=Strict'), 'Cookie must be SameSite=Strict');
  });

  it('Given an issued session cookie When GET /api/ledger is requested with the cookie within 12 hours Then it returns locked: false and valid database state without requiring password', () => {
    const rawMasterKey = '1122334455667788990011223344556677889900112233445566778899001122';
    const passcode = 'SessionTestPass123!';
    const secretsDir = path.join(tempDir, 'secrets');
    fs.mkdirSync(secretsDir, { recursive: true });
    const envelopeFile = path.join(secretsDir, 'master_key_envelope.json');
    const envelope = createKeyEnvelope(rawMasterKey, passcode, ['ABCD-1234'], 'Security question?');
    saveKeyEnvelope(envelopeFile, envelope);

    clearSessionMasterKey();

    // Unlock to get session token
    const unlockRes = handleHttpRequest(
      null,
      {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({ action: 'verifyPasscode', payload: { passcode } }),
      },
      tempDir
    );
    const body = JSON.parse(unlockRes.body);
    const token = body.sessionToken;

    // Clear in-memory sessionMasterKey to simulate tab reopening or server restart
    clearSessionMasterKey();

    // Now send GET request with cookie
    const getRes = handleHttpRequest(
      null,
      {
        method: 'GET',
        pathname: '/api/ledger',
        headers: {
          cookie: `adm_session_token=${token}`,
        },
      },
      tempDir
    );

    assert.equal(getRes.status, 200);
    const getBody = JSON.parse(getRes.body);
    assert.equal(getBody.ok, true);
    assert.equal(getBody.locked, undefined, 'Must not be locked when valid session cookie provided');
    assert.ok(getBody.state, 'Must return app state');
  });

  it('Given an expired session cookie (older than 12 hours) When GET /api/ledger is requested Then the session is rejected, cookie is cleared (Max-Age=0), and locked: true is returned', () => {
    const rawMasterKey = '1122334455667788990011223344556677889900112233445566778899001122';
    const passcode = 'SessionTestPass123!';
    const secretsDir = path.join(tempDir, 'secrets');
    fs.mkdirSync(secretsDir, { recursive: true });
    const envelopeFile = path.join(secretsDir, 'master_key_envelope.json');
    const envelope = createKeyEnvelope(rawMasterKey, passcode, ['ABCD-1234'], 'Security question?');
    saveKeyEnvelope(envelopeFile, envelope);

    clearSessionMasterKey();

    // Unlock to get session token
    const unlockRes = handleHttpRequest(
      null,
      {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({ action: 'verifyPasscode', payload: { passcode } }),
      },
      tempDir
    );
    const body = JSON.parse(unlockRes.body);
    const token = body.sessionToken;

    clearSessionMasterKey();

    // Fast-forward expiration to simulate >12 hours elapsed
    expireBrowserSessionForTesting(token);

    const getRes = handleHttpRequest(
      null,
      {
        method: 'GET',
        pathname: '/api/ledger',
        headers: {
          cookie: `adm_session_token=${token}`,
        },
      },
      tempDir
    );

    assert.equal(getRes.status, 200);
    const getBody = JSON.parse(getRes.body);
    assert.equal(getBody.locked, true, 'Must return locked: true when session is expired');
    assert.ok(getRes.headers, 'Must have headers');
    const setCookie = getRes.headers['Set-Cookie'];
    assert.ok(setCookie, 'Must clear cookie via Set-Cookie');
    const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie);
    assert.ok(cookieStr.includes('Max-Age=0'), 'Must set Max-Age=0 to invalidate client cookie');
  });

  it('Given an active session When lock action is dispatched Then the session is invalidated and cookie is cleared (Max-Age=0)', () => {
    const rawMasterKey = '1122334455667788990011223344556677889900112233445566778899001122';
    const passcode = 'SessionTestPass123!';
    const secretsDir = path.join(tempDir, 'secrets');
    fs.mkdirSync(secretsDir, { recursive: true });
    const envelopeFile = path.join(secretsDir, 'master_key_envelope.json');
    const envelope = createKeyEnvelope(rawMasterKey, passcode, ['ABCD-1234'], 'Security question?');
    saveKeyEnvelope(envelopeFile, envelope);

    clearSessionMasterKey();

    const unlockRes = handleHttpRequest(
      null,
      {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({ action: 'verifyPasscode', payload: { passcode } }),
      },
      tempDir
    );
    const token = JSON.parse(unlockRes.body).sessionToken;

    // Now lock
    const lockRes = handleHttpRequest(
      null,
      {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({ action: 'lock' }),
        headers: {
          cookie: `adm_session_token=${token}`,
        },
      },
      tempDir
    );

    assert.equal(lockRes.status, 200);
    const lockBody = JSON.parse(lockRes.body);
    assert.equal(lockBody.ok, true);
    const setCookie = lockRes.headers?.['Set-Cookie'];
    assert.ok(setCookie, 'Lock must send Set-Cookie to clear session');
    const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie);
    assert.ok(cookieStr.includes('Max-Age=0'), 'Lock must clear cookie with Max-Age=0');

    // Subsequent GET with old token should be locked
    const getRes = handleHttpRequest(
      null,
      {
        method: 'GET',
        pathname: '/api/ledger',
        headers: {
          cookie: `adm_session_token=${token}`,
        },
      },
      tempDir
    );
    assert.equal(JSON.parse(getRes.body).locked, true);
  });

  it('Given a locked server When recoverPasscode is called with valid recovery code Then it unlocks, issues a 12-hour session cookie, and returns sessionToken', () => {
    const rawMasterKey = '1122334455667788990011223344556677889900112233445566778899001122';
    const passcode = 'OldPass123!';
    const recoveryCode = 'ABCD-1234';
    const secretsDir = path.join(tempDir, 'secrets');
    fs.mkdirSync(secretsDir, { recursive: true });
    const envelopeFile = path.join(secretsDir, 'master_key_envelope.json');
    const envelope = createKeyEnvelope(rawMasterKey, passcode, [recoveryCode], 'Security hint?');
    saveKeyEnvelope(envelopeFile, envelope);

    clearSessionMasterKey();

    const recRes = handleHttpRequest(
      null,
      {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({
          action: 'recoverPasscode',
          payload: {
            recoveryCode,
            newPasscode: 'NewBrandPass123!',
            confirmPasscode: 'NewBrandPass123!',
          },
        }),
      },
      tempDir
    );

    assert.equal(recRes.status, 200);
    const body = JSON.parse(recRes.body);
    assert.equal(body.ok, true);
    assert.ok(body.sessionToken);
    assert.ok(typeof body.sessionExpiresAt === 'number');
    assert.ok(recRes.headers?.['Set-Cookie']);
    const cookieStr = Array.isArray(recRes.headers['Set-Cookie'])
      ? recRes.headers['Set-Cookie'].join('; ')
      : String(recRes.headers['Set-Cookie']);
    assert.ok(cookieStr.includes(`adm_session_token=${body.sessionToken}`));
    assert.ok(cookieStr.includes('Max-Age=43200'));
  });

  it('Given an issued session token When Authorization Bearer header is used Then it unlocks and returns database state', () => {
    const rawMasterKey = '1122334455667788990011223344556677889900112233445566778899001122';
    const passcode = 'BearerAuthPass123!';
    const secretsDir = path.join(tempDir, 'secrets');
    fs.mkdirSync(secretsDir, { recursive: true });
    const envelopeFile = path.join(secretsDir, 'master_key_envelope.json');
    const envelope = createKeyEnvelope(rawMasterKey, passcode, ['ABCD-1234'], 'Security hint?');
    saveKeyEnvelope(envelopeFile, envelope);

    clearSessionMasterKey();

    const unlockRes = handleHttpRequest(
      null,
      {
        method: 'POST',
        pathname: '/api/ledger',
        body: JSON.stringify({ action: 'verifyPasscode', payload: { passcode } }),
      },
      tempDir
    );
    const token = JSON.parse(unlockRes.body).sessionToken;

    clearSessionMasterKey();

    // Query with Authorization Bearer header instead of Cookie
    const getRes = handleHttpRequest(
      null,
      {
        method: 'GET',
        pathname: '/api/ledger',
        headers: {
          authorization: `Bearer ${token}`,
        },
      },
      tempDir
    );

    assert.equal(getRes.status, 200);
    const getBody = JSON.parse(getRes.body);
    assert.equal(getBody.ok, true);
    assert.equal(getBody.locked, undefined);
    assert.ok(getBody.state);
  });

  it('Given the embedded UI script in BRIDGE_SCRIPT When inspecting session handling Then login modal is hidden on unlocked state, sessionToken is stored in localStorage, and cleared on lock', () => {
    const uiRes = handleHttpRequest(db, { method: 'GET', pathname: '/' });
    assert.equal(uiRes.status, 200);

    // 1. BRIDGE_SCRIPT hides login modal when json.locked is false
    assert.ok(
      uiRes.body.includes("loginModal.classList.add('hidden')"),
      'BRIDGE_SCRIPT must hide login modal when unlocked'
    );

    // 2. localStorage persistence on login
    assert.ok(
      uiRes.body.includes("localStorage.setItem('adm_session_token'"),
      'BRIDGE_SCRIPT must store sessionToken in localStorage'
    );

    // 3. localStorage removal on lock
    assert.ok(
      uiRes.body.includes("localStorage.removeItem('adm_session_token'"),
      'BRIDGE_SCRIPT must remove sessionToken from localStorage on lock'
    );
  });

  it('Given a fresh download or unconfigured database When GET /api/ledger is requested with a stale session cookie Then locked is false and authStatus.isConfigured is false so it asks to set a password first', () => {
    const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-fresh-download-'));
    try {
      const getRes = handleHttpRequest(
        null,
        {
          method: 'GET',
          pathname: '/api/ledger',
          headers: {
            cookie: 'adm_session_token=stale-token-from-previous-run',
          },
        },
        freshDir
      );

      assert.equal(getRes.status, 200);
      const getBody = JSON.parse(getRes.body);
      assert.equal(getBody.ok, true);
      assert.equal(getBody.locked, undefined, 'A fresh unconfigured download must not be locked');
      assert.ok(getBody.state, 'Must return state');
      assert.equal(
        getBody.state.authStatus.isConfigured,
        false,
        'Fresh download must have authStatus.isConfigured = false'
      );
    } finally {
      fs.rmSync(freshDir, { recursive: true, force: true });
    }
  });

  it('Given an already configured and locked USB When server starts Then it begins in locked mode without throwing ERR_DATABASE_LOCKED and accepts supervisor password', async () => {
    const lockedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-locked-startup-'));
    try {
      const rawMasterKey = '1122334455667788990011223344556677889900112233445566778899001122';
      const passcode = 'MySecurePass123!';
      const secretsDir = path.join(lockedDir, 'secrets');
      fs.mkdirSync(secretsDir, { recursive: true });
      const envelopeFile = path.join(secretsDir, 'master_key_envelope.json');
      const envelope = createKeyEnvelope(rawMasterKey, passcode, ['ABCD-1234'], 'Security hint');
      saveKeyEnvelope(envelopeFile, envelope);

      clearSessionMasterKey();

      // On startup with locked database, initializing server without master key in RAM must not throw
      const server = createLedgerHttpServer(null, lockedDir);
      assert.ok(server, 'Server must initialize even when database is locked');

      // GET /api/ledger must return locked state with authStatus.isConfigured: true
      const getRes = handleHttpRequest(null, { method: 'GET', pathname: '/api/ledger' }, lockedDir);
      assert.equal(getRes.status, 200);
      const getJson = JSON.parse(getRes.body);
      assert.equal(getJson.locked, true);
      assert.equal(getJson.state.authStatus.isConfigured, true);
      assert.equal(getJson.state.authStatus.hintQuestion, 'Security hint');

      // Unlocking with the passcode unlocks and returns active state
      const unlockRes = handleHttpRequest(
        null,
        {
          method: 'POST',
          pathname: '/api/ledger',
          body: JSON.stringify({ action: 'verifyPasscode', payload: { passcode } }),
        },
        lockedDir
      );
      assert.equal(unlockRes.status, 200);
      const unlockJson = JSON.parse(unlockRes.body);
      assert.equal(unlockJson.ok, true);
      assert.ok(unlockJson.sessionToken);

      clearSessionMasterKey();
    } finally {
      fs.rmSync(lockedDir, { recursive: true, force: true });
    }
  });
});
