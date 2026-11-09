import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getLedgerDatabase,
  resolvePortablePaths,
  loadKeyEnvelope,
  isDatabaseLocked,
  unlockWithPasscode,
  unlockWithRecoveryCode,
  getAuthLockoutStatus,
  createBrowserSession,
  validateBrowserSession,
  destroyBrowserSession,
  clearAllBrowserSessions,
  clearSessionMasterKey,
  getSessionMasterKey,
  extractSessionTokenFromHeaders,
  buildSessionCookieHeader,
  buildClearSessionCookieHeader,
  TWELVE_HOURS_SECONDS,
  type LedgerDatabase,
  type BrowserSession,
} from './database.ts';
import { dispatchLedgerAction } from './service.ts';
import { isUsbConnected, startUsbHeartbeat } from './heartbeat.ts';

const BRIDGE_SCRIPT = `
<script data-purpose="sqlite-api-bridge">
(function() {
  const syncChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('adm_db_sync') : null;
  let lastKnownDataVersion = -1;
  let isSyncing = false;

  function broadcastDbChange(data = {}) {
    const payload = Object.assign({ type: 'CUSTOMER_LEDGER_UPDATED', timestamp: Date.now() }, data);
    try {
      if (syncChannel) {
        syncChannel.postMessage(payload);
      }
    } catch (e) {}
    try {
      localStorage.setItem('adm_db_sync_pulse', JSON.stringify(payload));
    } catch (e) {}
  }

  // Intercept window.fetch so any direct POST /api/ledger mutation broadcasts to all tabs
  // and notifies the Database Sync LED of read/write activity
  if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
    const origFetch = window.fetch;
    window.fetch = async function(...args) {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
      const options = args[1] || {};
      const method = String(options.method || 'GET').toUpperCase();
      const isHeartbeatOrSse = url.includes('/api/heartbeat') || url.includes('/api/sync-events');
      const isDbCall = !isHeartbeatOrSse && (
        url.includes('/api/ledger') ||
        url.includes('/database') ||
        url.includes('/companies') ||
        url.includes('/pickups') ||
        url.includes('/deductions') ||
        url.includes('/yards') ||
        url.includes('/currencies') ||
        url.includes('/units') ||
        url.includes('/metals')
      );
      if (isDbCall) {
        let mode = method === 'GET' ? 'read' : 'write';
        if (url.includes('/api/ledger') && method === 'POST' && options.body) {
          try {
            const parsed = JSON.parse(String(options.body));
            if (parsed.action === 'getState' || parsed.action === 'checkLockout') {
              mode = 'read';
            }
          } catch (e) {}
        }
        window.dispatchEvent(new CustomEvent('adm-db-activity', { detail: { phase: 'start', mode } }));
      }
      try {
        const res = await origFetch.apply(this, args);
        try {
          if (url.includes('/api/ledger') && options && options.method === 'POST' && res && res.ok) {
            let action = '';
            let customerId;
            try {
              if (options.body) {
                const parsed = JSON.parse(String(options.body));
                action = parsed.action;
                customerId = parsed.payload?.customerId;
              }
            } catch (e) {}
            if (action !== 'getState' && action !== 'verifyPasscode' && action !== 'checkLockout') {
              broadcastDbChange({ action, customerId: customerId || (typeof appData !== 'undefined' ? appData.activeCustomerId : undefined) });
            }
          }
        } catch (e) {}
        return res;
      } finally {
        if (isDbCall) {
          window.dispatchEvent(new CustomEvent('adm-db-activity', { detail: { phase: 'end' } }));
        }
      }
    };
  }

  function applyStateToAppData(state) {
    if (!state || typeof appData === 'undefined') return;
    appData.customers = state.customers;
    appData.yards = state.yards;
    appData.defaultYard = state.defaultYard;
    appData.currentCurrency = state.currentCurrency;
    appData.currencies = state.currencies || [state.currentCurrency || 'USD ($)'];
    appData.language = state.language || 'en';
    appData.authStatus = state.authStatus || { isConfigured: false, hintQuestion: '', hintAnswer: '' };
    if (!appData.activeCustomerId && state.customers && state.customers.length > 0) {
      appData.activeCustomerId = state.customers[0].id;
    }
  }

  async function syncFromSqlite(forceRender = false) {
    if (isSyncing) return;
    isSyncing = true;
    try {
      const res = await fetch('/api/ledger', { cache: 'no-store' });
      const json = await res.json();
      if (json.ok && json.state && typeof appData !== 'undefined') {
        const currentVersion = json.state.dbStatus?.dataVersion ?? -1;
        const hasChanged = forceRender || lastKnownDataVersion === -1 || currentVersion !== lastKnownDataVersion;
        lastKnownDataVersion = currentVersion;

        applyStateToAppData(json.state);
        if (typeof updateAuthModalUI === 'function') {
          updateAuthModalUI();
        }
        if (json.locked || !json.state?.authStatus?.isConfigured) {
          const loginModal = document.getElementById('login-modal');
          if (loginModal) loginModal.classList.remove('hidden');
        } else {
          const loginModal = document.getElementById('login-modal');
          if (loginModal) loginModal.classList.add('hidden');
        }

        if (hasChanged && !json.locked && json.state?.authStatus?.isConfigured) {
          if (typeof applyLanguageTranslations === 'function') applyLanguageTranslations(appData.language);
          if (typeof updateYardDropdowns === 'function') updateYardDropdowns();
          if (typeof updateCurrencyDropdowns === 'function') updateCurrencyDropdowns();
          if (typeof renderDashboard === 'function') renderDashboard();
          if (appData.currentView === 'ledger' && typeof renderActiveCustomerLedger === 'function') {
            renderActiveCustomerLedger();
          } else if (appData.currentView === 'directory' && typeof renderCustomersTable === 'function') {
            renderCustomersTable();
          } else if (appData.currentView === 'sheet' && typeof renderAllSheetsTable === 'function') {
            renderAllSheetsTable();
          }
        }

        window.dispatchEvent(new CustomEvent('adm-auth-changed', {
          detail: {
            locked: Boolean(json.locked),
            isConfigured: Boolean(json.state?.authStatus?.isConfigured),
            state: json.state
          }
        }));
      }
    } catch (err) {
      console.error('SQLite sync error:', err);
    } finally {
      isSyncing = false;
    }
  }

  async function postSqliteAction(action, payload) {
    const dot = document.getElementById('db-traffic-dot');
    const text = document.getElementById('db-traffic-status');
    if (dot && text) {
      dot.className = 'w-2.5 h-2.5 rounded-full bg-rose-500 shadow-xs';
      text.innerText = 'Syncing';
    }
    try {
      const res = await fetch('/api/ledger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, payload })
      });
      const json = await res.json();
      if (json.sessionToken) {
        try {
          localStorage.setItem('adm_session_token', json.sessionToken);
        } catch (e) {}
      }
      if (action === 'lock') {
        try {
          localStorage.removeItem('adm_session_token');
        } catch (e) {}
      }
      if (json.ok) {
        if (json.state && typeof appData !== 'undefined') {
          applyStateToAppData(json.state);
          if (json.state.dbStatus?.dataVersion !== undefined) {
            lastKnownDataVersion = json.state.dbStatus.dataVersion;
          }
          if (typeof renderDashboard === 'function') renderDashboard();
          if (appData.currentView === 'ledger' && typeof renderActiveCustomerLedger === 'function') {
            renderActiveCustomerLedger();
          }
        }
        broadcastDbChange({ action, customerId: payload?.customerId || (typeof appData !== 'undefined' ? appData.activeCustomerId : undefined) });
        window.dispatchEvent(new CustomEvent('adm-auth-changed', {
          detail: {
            locked: Boolean(json.locked),
            isConfigured: Boolean(json.state?.authStatus?.isConfigured),
            state: json.state
          }
        }));
      }
      return json;
    } finally {
      setTimeout(() => {
        if (dot && text) {
          dot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-xs';
          text.innerText = 'Idle';
        }
      }, 250);
    }
  }

  window.postSqliteAction = postSqliteAction;
  window.syncFromSqlite = syncFromSqlite;

  window.lockSystem = async function() {
    await postSqliteAction('lock', {});
    const loginModal = document.getElementById('login-modal');
    if (loginModal) loginModal.classList.remove('hidden');
    if (typeof updateAuthModalUI === 'function') updateAuthModalUI();
    window.dispatchEvent(new CustomEvent('adm-auth-changed', { detail: { locked: true } }));
  };

  // Cross-Tab Instant Sync Handlers (Event-Driven)
  if (syncChannel) {
    syncChannel.onmessage = function(e) {
      if (e && e.data && (e.data.type === 'CUSTOMER_LEDGER_UPDATED' || e.data.type === 'DB_MUTATED')) {
        syncFromSqlite(true);
      }
    };
  }

  // Server-Sent Events (SSE) for server-to-tab push notifications
  if (typeof EventSource !== 'undefined') {
    try {
      const sse = new EventSource('/api/sync-events');
      sse.onmessage = function(e) {
        try {
          const data = JSON.parse(e.data);
          if (data && (data.type === 'CUSTOMER_LEDGER_UPDATED' || data.type === 'DB_MUTATED')) {
            syncFromSqlite(true);
          }
        } catch (err) {}
      };
    } catch (e) {}
  }

  window.addEventListener('storage', function(e) {
    if (e.key === 'adm_db_sync_pulse') {
      syncFromSqlite(true);
    }
  });

  window.addEventListener('focus', function() {
    syncFromSqlite(true);
  });

  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') {
      syncFromSqlite(true);
    }
  });

  window.addEventListener('pageshow', () => {
    const passInput = document.getElementById('password-input');
    if (passInput) passInput.value = '';
  });

  window.addEventListener('DOMContentLoaded', () => {
    const passInput = document.getElementById('password-input');
    if (passInput) passInput.value = '';
    syncFromSqlite();

    window.handleSetupPasscode = async function() {
      const passcode = (document.getElementById('setup-password-input')?.value || '').trim();
      const confirmPasscode = (document.getElementById('setup-confirm-password-input')?.value || '').trim();
      const hintQuestion = (document.getElementById('setup-hint-question')?.value || '').trim();
      const setupErr = document.getElementById('setup-error-msg');
      if (!passcode || !confirmPasscode || !hintQuestion) {
        if (setupErr) {
          setupErr.innerText = 'Please enter password, confirmation, and a password hint.';
          setupErr.classList.remove('hidden');
        }
        showToast('Please enter password, confirmation, and a password hint.');
        return;
      }
      if (passcode !== confirmPasscode) {
        if (setupErr) {
          setupErr.innerText = 'Passwords do not match. Please verify your password.';
          setupErr.classList.remove('hidden');
        }
        showToast('Passwords do not match.');
        return;
      }
      if (setupErr) setupErr.classList.add('hidden');
      const codes = typeof generatedSetupRecoveryCodes !== 'undefined' ? generatedSetupRecoveryCodes : [];
      const res = await postSqliteAction('setupPasscode', {
        passcode,
        confirmPasscode,
        hintQuestion,
        hintAnswer: '',
        recoveryCodes: codes
      });
      if (res.ok || typeof transitionToLoginAfterSetup === 'function') {
        if (typeof transitionToLoginAfterSetup === 'function') {
          transitionToLoginAfterSetup(passcode, hintQuestion);
        } else if (typeof updateAuthModalUI === 'function') {
          updateAuthModalUI();
        }
        window.dispatchEvent(new CustomEvent('adm-auth-changed', { detail: { locked: false, isConfigured: true } }));
      } else {
        showToast(res.error || 'Failed to configure password.');
      }
    };

    window.handleRecoverPasscode = async function() {
      const code = (document.getElementById('recovery-code-input')?.value || '').trim();
      const newPass = (document.getElementById('recovery-new-password-input')?.value || '').trim();
      const confirmPass = (document.getElementById('recovery-confirm-password-input')?.value || '').trim();
      const errEl = document.getElementById('recovery-error-msg');

      if (!code || !newPass || !confirmPass) {
        if (errEl) {
          errEl.innerText = 'Please enter your recovery code, new password, and confirmation.';
          errEl.classList.remove('hidden');
        }
        showToast('Please fill out all recovery fields.');
        return;
      }
      if (newPass !== confirmPass) {
        if (errEl) {
          errEl.innerText = 'Passwords do not match. Please verify your new password.';
          errEl.classList.remove('hidden');
        }
        showToast('Passwords do not match.');
        return;
      }

      const res = await postSqliteAction('recoverPasscode', {
        recoveryCode: code,
        newPasscode: newPass,
        confirmPasscode: confirmPass
      });
      if (!res.ok) {
        if (errEl) {
          errEl.innerText = res.error || 'Invalid or already used recovery code.';
          errEl.classList.remove('hidden');
        }
        showToast(res.error || 'Password recovery failed.');
        return;
      }

      if (typeof saveLocalAuthBackup === 'function') {
        saveLocalAuthBackup(newPass, (typeof appData !== 'undefined' && appData.authStatus) ? appData.authStatus.hintQuestion : '');
      }
      showToast('Password reset successfully! Log in with your new password.');
      if (typeof showLoginForm === 'function') {
        showLoginForm();
      }
      const passInp = document.getElementById('password-input');
      if (passInp) {
        passInp.value = '';
        passInp.focus();
      }
    };

    window.handleLogin = async function() {
      const passInput = document.getElementById('password-input');
      const errEl = document.getElementById('login-error-msg');
      const pass = passInput ? passInput.value : '';
      if (!pass) return;
      const res = await postSqliteAction('verifyPasscode', { passcode: pass });
      if (res.ok) {
        if (passInput) passInput.value = '';
        if (errEl) errEl.classList.add('hidden');
        const hintBox = document.getElementById('login-hint-box');
        if (hintBox) hintBox.classList.add('hidden');
        document.getElementById('login-modal').classList.add('hidden');
        showToast('Logged in successfully.');
        renderDashboard();
        window.dispatchEvent(new CustomEvent('adm-auth-changed', { detail: { locked: false } }));
      } else {
        if (errEl) {
          errEl.innerText = res.error || 'Incorrect supervisor password.';
          errEl.classList.remove('hidden');
        }
        showToast(res.error || 'Incorrect password. Click "Hint" if you need a reminder.');
      }
    };

    window.resetPasswordFromSettings = function() {
      if (typeof openResetPasswordModal === 'function') openResetPasswordModal();
    };

    window.submitResetPasswordWithOld = async function() {
      const inp = document.getElementById('reset-passcode-old-input');
      const err = document.getElementById('reset-passcode-error');
      const oldPasscode = inp ? inp.value : '';
      if (!oldPasscode) {
        if (err) { err.innerText = 'Please enter your current password.'; err.classList.remove('hidden'); }
        showToast('Please enter your current password.', 'warn');
        return;
      }
      const res = await postSqliteAction('resetPasscode', { oldPasscode });
      if (res.ok) {
        if (typeof closeResetPasswordModal === 'function') closeResetPasswordModal();
        try { localStorage.removeItem('adm_auth_v2'); } catch (e) {}
        appData.authStatus = { isConfigured: false, hintQuestion: '', hintAnswer: '' };
        if (typeof closeSettingsDrawer === 'function') closeSettingsDrawer();
        if (typeof updateAuthModalUI === 'function') updateAuthModalUI();
        document.getElementById('login-modal').classList.remove('hidden');
        const setupPassEl = document.getElementById('setup-password-input');
        if (setupPassEl) {
          setupPassEl.value = '';
          setupPassEl.focus();
        }
        showToast('Password reset. Please set up your new password and hint.');
      } else {
        if (err) { err.innerText = res.error || 'Incorrect current password.'; err.classList.remove('hidden'); }
        showToast(res.error || 'Incorrect current password.', 'error');
      }
    };

    window.submitNewCustomer = async function() {
      const name = document.getElementById('input-customer-name').value.trim();
      const balance = Math.round((parseFloat(document.getElementById('input-customer-balance').value) || 0) * 100) / 100;
      const defaultYard = document.getElementById('input-customer-yard').value;
      const notes = (document.getElementById('input-customer-contact').value || '').trim();
      if (!name) {
        showToast('Please enter customer / company name.');
        return;
      }
      const res = await postSqliteAction('createCustomer', { name, balance, defaultYard, phone: '', notes });
      if (res.ok) {
        closeAddCustomerModal();
        showToast('Customer account "' + name + '" saved to encrypted DB!');
        renderDashboard();
      }
    };

    window.addInlineCustomer = async function() {
      const name = document.getElementById('quick-add-cust-name').value.trim();
      const defaultYard = document.getElementById('quick-add-cust-yard').value;
      const balance = Math.round((parseFloat(document.getElementById('quick-add-cust-bal').value) || 0) * 100) / 100;
      const notes = document.getElementById('quick-add-cust-phone').value.trim();
      if (!name) {
        showToast('Please enter customer / company name.');
        return;
      }
      if (appData && Array.isArray(appData.customers)) {
        const dup = appData.customers.find(c => c.name.trim().toLowerCase() === name.toLowerCase());
        if (dup) {
          showToast('Customer "' + name + '" already exists.');
          return;
        }
      }
      const res = await postSqliteAction('createCustomer', { name, balance, defaultYard, phone: '', notes });
      if (res.ok) {
        document.getElementById('quick-add-cust-name').value = '';
        document.getElementById('quick-add-cust-bal').value = '';
        document.getElementById('quick-add-cust-phone').value = '';
        showToast('Customer "' + name + '" added to encrypted DB.');
        renderDashboard();
      } else {
        showToast(res.error || 'Failed to add customer.');
      }
    };

    window.submitLedgerEntry = async function() {
      const entryType = document.getElementById('input-entry-type').value;
      const rawAmt = parseFloat(document.getElementById('input-entry-amount').value) || 0;
      const amount = Math.round(Math.abs(rawAmt) * 100) / 100;
      const currency = document.getElementById('input-entry-currency')?.value || appData.currentCurrency || 'USD ($)';
      const method = document.getElementById('input-entry-method').value || 'Cash';
      const yard = document.getElementById('input-entry-yard').value;
      const memo = document.getElementById('input-entry-memo').value;
      const res = await postSqliteAction('addLedgerEntry', {
        customerId: appData.activeCustomerId,
        entryType,
        amount,
        currency,
        method,
        yard,
        memo
      });
      if (res.ok) {
        closeRecordPaymentModal();
        showToast('Ledger entry committed to encrypted SQLite.');
        renderActiveCustomerLedger();
        renderDashboard();
      } else {
        showToast(res.error || 'Failed to commit ledger entry.');
      }
    };

    window.executeDeleteCustomer = async function() {
      if (!customerPendingDeletion) return;
      const inp = document.getElementById('delete-customer-confirm-input');
      const typed = inp ? inp.value.trim() : '';
      if (typed.toLowerCase() !== 'delete') {
        showToast('Please type "delete" to confirm account deletion.');
        return;
      }
      const cust = customerPendingDeletion;
      recentlyDeletedCustomer = JSON.parse(JSON.stringify(cust));
      const res = await postSqliteAction('deleteCustomer', { customerId: cust.id, confirmation: typed });
      if (res.ok) {
        closeDeleteCustomerModal();
        if (appData.customers.length > 0) {
          appData.activeCustomerId = appData.customers[0].id;
        }
        switchView('directory');
        showToast('Account "' + cust.name + '" deleted from DB.');
        renderDashboard();
      } else {
        showToast(res.error || 'Could not delete account.');
      }
    };

    window.undoDeleteCustomer = async function() {
      if (!recentlyDeletedCustomer) return;
      const restoredName = recentlyDeletedCustomer.name;
      const res = await postSqliteAction('restoreCustomer', { customer: recentlyDeletedCustomer });
      if (res.ok) {
        recentlyDeletedCustomer = null;
        showToast('Account "' + restoredName + '" restored to DB.');
        renderDashboard();
      }
    };

    window.addInlineLedgerEntry = async function() {
      const dateVal = (document.getElementById('inline-entry-date')?.value || new Date().toISOString().slice(0, 10)) + ' ' + new Date().toTimeString().slice(0, 5);
      const invoice = Math.round((parseFloat(document.getElementById('inline-entry-inv')?.value) || 0) * 100) / 100;
      const paid = Math.round((parseFloat(document.getElementById('inline-entry-paid')?.value) || 0) * 100) / 100;
      const currency = document.getElementById('inline-entry-currency')?.value || appData.currentCurrency || 'USD ($)';
      const method = document.getElementById('inline-entry-method')?.value || 'Cash';
      const yard = document.getElementById('inline-entry-yard')?.value || 'North Yard';
      const memo = (document.getElementById('inline-entry-memo')?.value || '').trim() || (paid > 0 && invoice === 0 ? 'Cash paid to customer' : 'Unpaid amount added');
      if (invoice === 0 && paid === 0) {
        showToast('Please enter an unpaid total to pay or a cash amount paid.');
        return;
      }
      const res = await postSqliteAction('addLedgerEntry', {
        customerId: appData.activeCustomerId,
        invoice,
        paid,
        currency,
        method,
        yard,
        memo,
        date: dateVal
      });
      if (res.ok) {
        document.getElementById('inline-entry-inv').value = '';
        document.getElementById('inline-entry-paid').value = '';
        document.getElementById('inline-entry-memo').value = '';
        showToast('Row posted to encrypted ledger.');
        renderActiveCustomerLedger();
        renderDashboard();
      } else {
        showToast(res.error || 'Failed to post row to ledger.');
      }
    };

    window.payFullCustomerBalance = async function() {
      const cust = appData.customers.find(c => c.id === appData.activeCustomerId);
      if (!cust || cust.balance <= 0) {
        showToast('No unpaid balance to pay for this customer.');
        return;
      }
      const dateVal = (document.getElementById('inline-entry-date')?.value || new Date().toISOString().slice(0, 10)) + ' ' + new Date().toTimeString().slice(0, 5);
      const method = document.getElementById('inline-entry-method')?.value || 'Cash';
      const yard = document.getElementById('inline-entry-yard')?.value || cust.defaultYard || 'North Yard';
      const memo = (document.getElementById('inline-entry-memo')?.value || '').trim() || 'Paid full balance to customer';
      const res = await postSqliteAction('addLedgerEntry', {
        customerId: appData.activeCustomerId,
        payFull: true,
        method,
        yard,
        memo,
        date: dateVal
      });
      if (res.ok) {
        if (document.getElementById('inline-entry-inv')) document.getElementById('inline-entry-inv').value = '';
        if (document.getElementById('inline-entry-paid')) document.getElementById('inline-entry-paid').value = '';
        if (document.getElementById('inline-entry-memo')) document.getElementById('inline-entry-memo').value = '';
        showToast('Paid full balance to ' + cust.name + '. Account settled!');
        renderActiveCustomerLedger();
        renderDashboard();
      } else {
        showToast(res.error || 'Failed to settle account.');
      }
    };

    window.submitEditCustomer = async function() {
      const custId = document.getElementById('edit-customer-id')?.value || appData.activeCustomerId;
      const name = (document.getElementById('edit-customer-name')?.value || '').trim();
      const yard = document.getElementById('edit-customer-yard')?.value || 'North Yard';
      const notes = (document.getElementById('edit-customer-notes')?.value || '').trim();
      if (!name) {
        showToast('Customer name cannot be empty.');
        return;
      }
      if (appData && Array.isArray(appData.customers)) {
        const dup = appData.customers.find(c => c.id !== custId && c.name.trim().toLowerCase() === name.toLowerCase());
        if (dup) {
          showToast('Customer "' + name + '" already exists.');
          return;
        }
      }
      const res = await postSqliteAction('updateCustomer', { id: custId, name, defaultYard: yard, notes, phone: notes });
      if (res.ok) {
        if (typeof closeEditCustomerModal === 'function') closeEditCustomerModal();
        showToast('Account "' + name + '" updated in encrypted DB.');
        renderActiveCustomerLedger();
        renderDashboard();
      } else {
        showToast(res.error || 'Failed to update customer account.');
      }
    };

    window.submitEditLedgerEntry = async function() {
      const cust = appData.customers.find(c => c.id === appData.activeCustomerId);
      const idx = typeof editingLedgerEntryIndex !== 'undefined' ? editingLedgerEntryIndex : parseInt(document.getElementById('edit-entry-index')?.value || '0', 10);
      if (!cust || idx < 0) return;

      const dateVal = document.getElementById('edit-entry-date')?.value?.trim();
      const invoice = Math.round((parseFloat(document.getElementById('edit-entry-inv')?.value) || 0) * 100) / 100;
      const paid = Math.round((parseFloat(document.getElementById('edit-entry-paid')?.value) || 0) * 100) / 100;
      const currency = document.getElementById('edit-entry-currency')?.value || appData.currentCurrency || 'USD ($)';
      const method = document.getElementById('edit-entry-method')?.value || 'Cash';
      const yard = document.getElementById('edit-entry-yard')?.value || cust.defaultYard;
      const memo = (document.getElementById('edit-entry-memo')?.value || '').trim() || (paid > 0 ? 'Cash paid to customer' : 'Unpaid amount added');

      const res = await postSqliteAction('updateLedgerEntry', {
        customerId: cust.id,
        entryIndex: idx,
        date: dateVal,
        invoice,
        paid,
        currency,
        method,
        yard,
        memo,
      });
      if (res.ok) {
        if (typeof closeEditLedgerEntryModal === 'function') closeEditLedgerEntryModal();
        showToast('Ledger entry updated in encrypted DB.');
        renderActiveCustomerLedger();
        renderDashboard();
      } else {
        showToast(res.error || 'Failed to update ledger entry.');
      }
    };

    window.executeDeleteLedgerEntry = async function() {
      const cust = appData.customers.find(c => c.id === appData.activeCustomerId);
      const idx = typeof deletingLedgerEntryIndex !== 'undefined' ? deletingLedgerEntryIndex : 0;
      if (!cust || idx < 0) return;

      const res = await postSqliteAction('deleteLedgerEntry', {
        customerId: cust.id,
        entryIndex: idx,
      });
      if (res.ok) {
        if (typeof closeDeleteLedgerEntryModal === 'function') closeDeleteLedgerEntryModal();
        showToast('Ledger entry removed from encrypted DB.');
        renderActiveCustomerLedger();
        renderDashboard();
      } else {
        showToast(res.error || 'Failed to delete ledger entry.');
      }
    };

    window.executeConsolidateLedger = async function() {
      const cust = appData.customers.find(c => c.id === appData.activeCustomerId);
      if (!cust) return;
      const res = await postSqliteAction('consolidateCustomerBalance', { customerId: cust.id });
      if (res.ok) {
        if (typeof closeConsolidateLedgerModal === 'function') closeConsolidateLedgerModal();
        showToast('Past logs cleared. Balance preserved in encrypted database.');
        renderDashboard();
        renderActiveCustomerLedger();
      } else {
        showToast(res.error || 'Failed to consolidate customer ledger.');
      }
    };

    window.setDefaultYard = async function(yard) {
      appData.defaultYard = yard;
      if (typeof updateYardDropdowns === 'function') updateYardDropdowns();
      if (typeof renderYardsSettingsList === 'function') renderYardsSettingsList();
      renderDashboard();
      if (appData.currentView === 'ledger' && typeof renderActiveCustomerLedger === 'function') {
        renderActiveCustomerLedger();
      }
      showToast('Default Yard Location set to "' + yard + '"');
      await postSqliteAction('setDefaultYard', { yard });
    };

    window.notifyLanguageChange = async function() {
      const lang = document.getElementById('system-language').value || 'en';
      if (typeof applyLanguageTranslations === 'function') {
        applyLanguageTranslations(lang);
      }
      await postSqliteAction('updateSettings', { language: lang });
      showToast('Language set to English');
    };

    window.simulateDbAction = async function(action) {
      if (action === 'load-sql' || action === 'load-xlsx') {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = action === 'load-xlsx' ? '.csv,.xlsx,.xls' : '.sql,.json,.bak';
        input.onchange = async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          let content = '';
          const isXlsx = file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls');
          if (isXlsx) {
            content = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result || ''));
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(file);
            });
          } else {
            content = await file.text();
          }
          const res = await postSqliteAction('importBackup', { content, fileName: file.name });
          if (res.ok) {
            if (typeof updateYardDropdowns === 'function') updateYardDropdowns();
            renderDashboard();
            if (appData.currentView === 'ledger') renderActiveCustomerLedger();
            showToast('Loaded "' + file.name + '" into encrypted SQLite database.');
            window.dispatchEvent(new CustomEvent('adm-auth-changed', { detail: { locked: false } }));
          } else {
            showToast(res.error || 'Failed to import file.');
          }
        };
        input.click();
      } else if (action === 'download-db') {
        const res = await fetch('/database/export-sql');
        const json = await res.json();
        if (res.ok && json.ok && typeof json.sql === 'string') {
          const dateStr = new Date().toISOString().slice(0, 10);
          const element = document.createElement('a');
          element.setAttribute('href', 'data:application/sql;charset=utf-8,' + encodeURIComponent(json.sql));
          element.setAttribute('download', 'money_total_sheet_backup_' + dateStr + '.sql');
          element.style.display = 'none';
          document.body.appendChild(element);
          element.click();
          document.body.removeChild(element);
          showToast('Database backup (.sql) downloaded.');
        }
      } else if (action === 'delete-db') {
        const box = document.getElementById('inline-delete-db-box');
        const inp = document.getElementById('inline-delete-db-input');
        if (box) {
          box.classList.toggle('hidden');
          if (!box.classList.contains('hidden') && inp) {
            inp.value = '';
            inp.focus();
          }
        }
      }
    };

    let consecutiveHeartbeatFailures = 0;
    let heartbeatActive = true;

    function triggerUsbDisconnectLockout() {
      if (!heartbeatActive) return;
      heartbeatActive = false;
      if (typeof appData !== 'undefined') {
        appData.customers = [];
      }
      document.body.innerHTML = \`
        <div style="position:fixed;inset:0;background:#0f172a;color:white;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:99999;font-family:system-ui,-apple-system,sans-serif;text-align:center;padding:24px;">
          <div style="width:68px;height:68px;border-radius:50%;background:#ef4444;display:flex;align-items:center;justify-content:center;margin-bottom:20px;box-shadow:0 0 25px rgba(239,68,68,0.5);">
            <svg style="width:38px;height:38px;color:white;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
            </svg>
          </div>
          <h1 style="font-size:26px;font-weight:800;margin-bottom:10px;color:#f87171;letter-spacing:-0.5px;">USB Drive Disconnected</h1>
          <p style="font-size:14px;color:#94a3b8;max-width:440px;line-height:1.5;margin-bottom:24px;">The encrypted USB storage device has been disconnected. The database has been cleanly flushed and closed. This application window is closing for security.</p>
          <button onclick="try{window.close();}catch(e){}window.location.replace('about:blank');" style="padding:10px 24px;background:#334155;color:white;border:none;border-radius:10px;cursor:pointer;font-size:13px;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,0.3);">Close Window</button>
        </div>
      \`;
      try {
        window.close();
      } catch (e) {}
      setTimeout(() => {
        try {
          window.location.replace('about:blank');
        } catch (e) {}
      }, 1000);
    }

    window.triggerUsbDisconnectLockout = triggerUsbDisconnectLockout;

    async function checkUsbHeartbeat() {
      if (!heartbeatActive) return;
      try {
        const res = await fetch('/api/heartbeat', { cache: 'no-store' });
        if (res.status === 410) {
          triggerUsbDisconnectLockout();
          return;
        }
        const json = await res.json();
        if (!json || json.connected === false) {
          triggerUsbDisconnectLockout();
          return;
        }
        consecutiveHeartbeatFailures = 0;
      } catch (err) {
        consecutiveHeartbeatFailures++;
        if (consecutiveHeartbeatFailures >= 2) {
          triggerUsbDisconnectLockout();
        }
      }
    }

    setInterval(checkUsbHeartbeat, 1500);
  });
})();
</script>
`;

export function getEmbeddedUiHtml(rootDir?: string): string {
  const { root } = resolvePortablePaths(rootDir);
  const candidates = [
    path.join(root, 'backend', 'src', 'ui.html'),
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui.html'),
    path.join(root, 'stitch_interactive_ui_prototype', 'code.html'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const rawHtml = fs.readFileSync(candidate, 'utf8');
      return rawHtml.replace('</body>', `${BRIDGE_SCRIPT}\n</body>`);
    }
  }
  return '<!DOCTYPE html><html><head><title>Money Total Sheet</title></head><body><h1>Money Total Sheet</h1></body></html>';
}

export function handleHttpRequest(
  db: LedgerDatabase | null,
  req: {
    method: string;
    pathname: string;
    body?: string;
    headers?: Record<string, string | string[] | undefined>;
  },
  rootDir?: string
): {
  status: number;
  contentType: string;
  body: string;
  headers?: Record<string, string | string[]>;
} {
  const dirToUse = rootDir || (db && (db as unknown as { rootDir?: string }).rootDir) || undefined;
  const token = extractSessionTokenFromHeaders(req.headers);
  let sessionValidation: { valid: boolean; session?: BrowserSession; reason?: string } | null = null;
  const responseHeaders: Record<string, string | string[]> = {};

  if (token) {
    sessionValidation = validateBrowserSession(token, dirToUse);
    if (!sessionValidation.valid) {
      responseHeaders['Set-Cookie'] = buildClearSessionCookieHeader();
    }
  }

  const dbLocked = isDatabaseLocked(dirToUse);
  const locked = dbLocked ? !(token && sessionValidation && sessionValidation.valid) : false;

  // Serve static compiled frontend assets (/assets/*)
  if (req.pathname.startsWith('/assets/') && req.method === 'GET') {
    const assetName = path.basename(req.pathname);
    const { root } = resolvePortablePaths(dirToUse);
    const candidatePaths = [
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets', assetName),
      path.join(root, 'backend', 'src', 'assets', assetName),
      path.join(root, 'frontend', 'dist', 'assets', assetName),
    ];
    for (const candidate of candidatePaths) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        const contentType = assetName.endsWith('.css')
          ? 'text/css; charset=utf-8'
          : assetName.endsWith('.js')
            ? 'text/javascript; charset=utf-8'
            : 'application/octet-stream';
        return {
          status: 200,
          contentType,
          headers: responseHeaders,
          body: fs.readFileSync(candidate, 'utf8'),
        };
      }
    }
  }

  if (req.pathname === '/api/heartbeat' && req.method === 'GET') {
    const connected = isUsbConnected(dirToUse);
    if (connected) {
      return {
        status: 200,
        contentType: 'application/json; charset=utf-8',
        headers: responseHeaders,
        body: JSON.stringify({ ok: true, connected: true, timestamp: Date.now() }),
      };
    } else {
      return {
        status: 410,
        contentType: 'application/json; charset=utf-8',
        headers: responseHeaders,
        body: JSON.stringify({ ok: false, connected: false, error: 'USB device has been disconnected' }),
      };
    }
  }

  if (req.pathname === '/api/ledger' && req.method === 'GET') {
    if (locked) {
      const envelope = loadKeyEnvelope(resolvePortablePaths(dirToUse).envelopeFile);
      const lockout = getAuthLockoutStatus(dirToUse);
      return {
        status: 200,
        contentType: 'application/json; charset=utf-8',
        headers: responseHeaders,
        body: JSON.stringify({
          ok: true,
          locked: true,
          lockout: lockout.locked,
          lockoutRemainingSeconds: lockout.remainingSeconds,
          state: {
            version: '2.5.0',
            currentCurrency: 'USD ($)',
            currencies: ['USD ($)'],
            language: 'en',
            yards: ['North Yard', 'East Yard', 'Pier 9 Depot', 'West Yard'],
            defaultYard: 'North Yard',
            customers: [],
            authStatus: {
              isConfigured: Boolean(envelope && envelope.isConfigured),
              hintQuestion: envelope?.hintQuestion || '',
              hintAnswer: '',
              hasRecoveryCodes: Boolean(envelope?.recoveryEnvelopes && envelope.recoveryEnvelopes.length > 0),
            },
            dbStatus: {
              journalMode: 'wal',
              encrypted: true,
              lastSync: new Date().toISOString(),
            },
          },
        }),
      };
    }
    const activeDb = db && db.isHealthy() ? db : getLedgerDatabase(dirToUse);
    const result = dispatchLedgerAction(activeDb, 'getState');
    return {
      status: result.ok ? 200 : 400,
      contentType: 'application/json; charset=utf-8',
      headers: responseHeaders,
      body: JSON.stringify(result),
    };
  }

  if (req.pathname === '/api/ledger' && req.method === 'POST') {
    try {
      const parsed = JSON.parse(req.body || '{}') as {
        action: string;
        payload?: Record<string, unknown>;
      };

      if (parsed.action === 'verifyPasscode' || parsed.action === 'unlock') {
        const { envelopeFile } = resolvePortablePaths(dirToUse);
        const envelope = loadKeyEnvelope(envelopeFile);

        if (envelope && envelope.isConfigured) {
          const unlockRes = unlockWithPasscode(String(parsed.payload?.passcode ?? ''), dirToUse);
          if (!unlockRes.ok) {
            return {
              status: 401,
              contentType: 'application/json; charset=utf-8',
              headers: responseHeaders,
              body: JSON.stringify({
                ok: false,
                locked: true,
                error: unlockRes.error,
                attemptsRemaining: unlockRes.attemptsRemaining,
                lockout: unlockRes.lockout,
                remainingSeconds: unlockRes.remainingSeconds,
              }),
            };
          }
        } else {
          const activeDb = db && db.isHealthy() ? db : getLedgerDatabase(dirToUse);
          const valid = activeDb.verifyPasscode(String(parsed.payload?.passcode ?? ''));
          if (!valid) {
            return {
              status: 401,
              contentType: 'application/json; charset=utf-8',
              headers: responseHeaders,
              body: JSON.stringify({
                ok: false,
                locked: true,
                error: 'Invalid supervisor passcode',
              }),
            };
          }
        }

        const session = createBrowserSession(getSessionMasterKey() || undefined, dirToUse);
        responseHeaders['Set-Cookie'] = buildSessionCookieHeader(session.token);
        const activeDb = db && db.isHealthy() ? db : getLedgerDatabase(dirToUse);
        return {
          status: 200,
          contentType: 'application/json; charset=utf-8',
          headers: responseHeaders,
          body: JSON.stringify({
            ok: true,
            sessionToken: session.token,
            sessionExpiresAt: session.expiresAt,
            sessionMaxAge: TWELVE_HOURS_SECONDS,
            state: activeDb.getAppState(),
          }),
        };
      }

      if (parsed.action === 'recoverPasscode') {
        const { envelopeFile } = resolvePortablePaths(dirToUse);
        const envelope = loadKeyEnvelope(envelopeFile);

        let recRes: { ok: boolean; remainingRecoveryCodes?: string[]; newCode?: string; error?: string };
        if (envelope && envelope.isConfigured) {
          recRes = unlockWithRecoveryCode(
            String(parsed.payload?.recoveryCode ?? ''),
            String(parsed.payload?.newPasscode ?? ''),
            parsed.payload?.confirmPasscode !== undefined
              ? String(parsed.payload?.confirmPasscode)
              : undefined,
            dirToUse
          );
        } else {
          const activeDb = db && db.isHealthy() ? db : getLedgerDatabase(dirToUse);
          try {
            const res = activeDb.recoverPasscode({
              recoveryCode: String(parsed.payload?.recoveryCode ?? ''),
              newPasscode: String(parsed.payload?.newPasscode ?? ''),
              confirmPasscode:
                parsed.payload?.confirmPasscode !== undefined
                  ? String(parsed.payload?.confirmPasscode)
                  : undefined,
            });
            recRes = { ok: true, remainingRecoveryCodes: res.remainingRecoveryCodes, newCode: res.newCode };
          } catch (e) {
            recRes = { ok: false, error: e instanceof Error ? e.message : 'Invalid recovery code' };
          }
        }

        if (!recRes.ok) {
          return {
            status: 400,
            contentType: 'application/json; charset=utf-8',
            headers: responseHeaders,
            body: JSON.stringify({ ok: false, locked: true, error: recRes.error }),
          };
        }
        const session = createBrowserSession(getSessionMasterKey() || undefined, dirToUse);
        responseHeaders['Set-Cookie'] = buildSessionCookieHeader(session.token);
        const activeDb = db && db.isHealthy() ? db : getLedgerDatabase(dirToUse);
        return {
          status: 200,
          contentType: 'application/json; charset=utf-8',
          headers: responseHeaders,
          body: JSON.stringify({
            ok: true,
            sessionToken: session.token,
            sessionExpiresAt: session.expiresAt,
            sessionMaxAge: TWELVE_HOURS_SECONDS,
            data: recRes,
            state: activeDb.getAppState(),
          }),
        };
      }

      if (parsed.action === 'lock') {
        if (token) {
          destroyBrowserSession(token);
        }
        clearAllBrowserSessions();
        clearSessionMasterKey();
        responseHeaders['Set-Cookie'] = buildClearSessionCookieHeader();
        const envelope = loadKeyEnvelope(resolvePortablePaths(dirToUse).envelopeFile);
        let fallbackState: any;
        if (db && db.isHealthy()) {
          try {
            fallbackState = db.getAppState();
          } catch {}
        }
        if (!fallbackState) {
          fallbackState = {
            version: '2.5.0',
            currentCurrency: 'USD ($)',
            currencies: ['USD ($)'],
            language: 'en',
            yards: ['North Yard', 'East Yard', 'Pier 9 Depot', 'West Yard'],
            defaultYard: 'North Yard',
            customers: [],
            authStatus: {
              isConfigured: Boolean(envelope && envelope.isConfigured),
              hintQuestion: envelope?.hintQuestion || '',
              hintAnswer: '',
              hasRecoveryCodes: Boolean(envelope?.recoveryEnvelopes && envelope.recoveryEnvelopes.length > 0),
            },
            dbStatus: {
              journalMode: 'wal',
              encrypted: true,
              lastSync: new Date().toISOString(),
            },
          };
        }
        return {
          status: 200,
          contentType: 'application/json; charset=utf-8',
          headers: responseHeaders,
          body: JSON.stringify({
            ok: true,
            locked: true,
            state: fallbackState,
          }),
        };
      }

      if (locked) {
        if (parsed.action === 'getState') {
          const envelope = loadKeyEnvelope(resolvePortablePaths(dirToUse).envelopeFile);
          return {
            status: 200,
            contentType: 'application/json; charset=utf-8',
            headers: responseHeaders,
            body: JSON.stringify({
              ok: true,
              locked: true,
              state: {
                version: '2.5.0',
                currentCurrency: 'USD ($)',
                currencies: ['USD ($)'],
                language: 'en',
                yards: ['North Yard', 'East Yard', 'Pier 9 Depot', 'West Yard'],
                defaultYard: 'North Yard',
                customers: [],
                authStatus: {
                  isConfigured: Boolean(envelope && envelope.isConfigured),
                  hintQuestion: envelope?.hintQuestion || '',
                  hintAnswer: '',
                  hasRecoveryCodes: Boolean(envelope?.recoveryEnvelopes && envelope.recoveryEnvelopes.length > 0),
                },
                dbStatus: {
                  journalMode: 'wal',
                  encrypted: true,
                  lastSync: new Date().toISOString(),
                },
              },
            }),
          };
        }

        return {
          status: 401,
          contentType: 'application/json; charset=utf-8',
          headers: responseHeaders,
          body: JSON.stringify({
            ok: false,
            locked: true,
            error: 'Database is locked. Supervisor password required.',
          }),
        };
      }

      const activeDb = db && db.isHealthy() ? db : getLedgerDatabase(dirToUse);
      const result = dispatchLedgerAction(activeDb, parsed.action, parsed.payload || {});
      if (parsed.action === 'setupPasscode' && result.ok) {
        const session = createBrowserSession(getSessionMasterKey() || undefined, dirToUse);
        responseHeaders['Set-Cookie'] = buildSessionCookieHeader(session.token);
      }
      return {
        status: result.ok ? 200 : 400,
        contentType: 'application/json; charset=utf-8',
        headers: responseHeaders,
        body: JSON.stringify(result),
      };
    } catch (err) {
      return {
        status: 400,
        contentType: 'application/json; charset=utf-8',
        headers: responseHeaders,
        body: JSON.stringify({
          ok: false,
          error: err instanceof Error ? err.message : 'Invalid JSON payload',
        }),
      };
    }
  }

  // =========================================================================
  // Money-Total-Sheet REST API Endpoints
  // =========================================================================
  const isMtsApiRoute =
    req.pathname.startsWith('/companies') ||
    req.pathname.startsWith('/pickups') ||
    req.pathname.startsWith('/deductions') ||
    req.pathname.startsWith('/yards') ||
    req.pathname.startsWith('/currencies') ||
    req.pathname.startsWith('/units') ||
    req.pathname.startsWith('/metals') ||
    req.pathname.startsWith('/database');

  if (isMtsApiRoute) {
    if (locked) {
      return {
        status: 401,
        contentType: 'application/json; charset=utf-8',
        headers: responseHeaders,
        body: JSON.stringify({
          detail: 'Database is locked. Supervisor password required.',
        }),
      };
    }

    try {
      const activeDb = db && db.isHealthy() ? db : getLedgerDatabase(dirToUse);

      // --- Export SQL Dump ---
      if (req.pathname === '/database/export-sql' && req.method === 'GET') {
        const sql = activeDb.exportSqlDump();
        return {
          status: 200,
          contentType: 'application/json; charset=utf-8',
          headers: responseHeaders,
          body: JSON.stringify({
            ok: true,
            sql,
          }),
        };
      }

      // --- Restore SQL Dump ---
      if (req.pathname === '/database/restore-sql' && req.method === 'POST') {
        let sqlText = '';
        const rawBody = req.body || '';
        if (rawBody.trim().startsWith('{')) {
          const parsedBody = JSON.parse(rawBody) as { sql?: string; content?: string };
          sqlText = String(parsedBody.sql ?? parsedBody.content ?? '');
        } else {
          sqlText = rawBody;
        }
        const stats = activeDb.importSqlDump(sqlText);
        return {
          status: 200,
          contentType: 'application/json; charset=utf-8',
          headers: responseHeaders,
          body: JSON.stringify({
            ok: true,
            message: 'SQL database dump restored into encrypted database.',
            stats,
          }),
        };
      }

      // --- Reset Database ---
      if (req.pathname === '/database/reset' && req.method === 'POST') {
        const parsedBody = req.body ? (JSON.parse(req.body) as { confirmation?: string }) : {};
        const confirmation = String(parsedBody.confirmation ?? '')
          .trim()
          .toLowerCase();
        if (confirmation !== 'delete' && confirmation !== 'reset') {
          return {
            status: 400,
            contentType: 'application/json; charset=utf-8',
            headers: responseHeaders,
            body: JSON.stringify({
              ok: false,
              detail: 'Please type "delete" to confirm resetting the database.',
            }),
          };
        }
        activeDb.clearDatabase();
        return {
          status: 200,
          contentType: 'application/json; charset=utf-8',
          headers: responseHeaders,
          body: JSON.stringify({
            ok: true,
            message: 'Encrypted database has been reset to an empty state.',
          }),
        };
      }

      const bodyObj = req.body ? JSON.parse(req.body) : {};

      // --- Companies ---
      if (req.pathname === '/companies/' || req.pathname === '/companies') {
        if (req.method === 'GET') {
          return {
            status: 200,
            contentType: 'application/json; charset=utf-8',
            headers: responseHeaders,
            body: JSON.stringify(activeDb.getCompanies()),
          };
        }
        if (req.method === 'POST') {
          const created = activeDb.createCompany(String(bodyObj.name ?? ''));
          return {
            status: 200,
            contentType: 'application/json; charset=utf-8',
            headers: responseHeaders,
            body: JSON.stringify(created),
          };
        }
      }

      const companySubMatch = req.pathname.match(/^\/companies\/(\d+)\/(pickups|deductions)\/?$/);
      if (companySubMatch) {
        const companyId = Number(companySubMatch[1]);
        const subResource = companySubMatch[2];
        if (req.method === 'GET') {
          const data =
            subResource === 'pickups'
              ? activeDb.getPickupsByCompany(companyId)
              : activeDb.getDeductionsByCompany(companyId);
          return {
            status: 200,
            contentType: 'application/json; charset=utf-8',
            headers: responseHeaders,
            body: JSON.stringify(data),
          };
        }
        if (req.method === 'POST') {
          const created =
            subResource === 'pickups'
              ? activeDb.createPickup({
                  company_id: companyId,
                  date: String(bodyObj.date ?? ''),
                  yard: String(bodyObj.yard ?? ''),
                  currency: String(bodyObj.currency ?? '$'),
                  notes: String(bodyObj.notes ?? ''),
                  deduction: Number(bodyObj.deduction) || 0,
                  metals: Array.isArray(bodyObj.metals) ? bodyObj.metals : [],
                })
              : activeDb.createDeduction({
                  company_id: companyId,
                  date: String(bodyObj.date ?? ''),
                  amount: Number(bodyObj.amount) || 0,
                  currency: String(bodyObj.currency ?? '$'),
                  notes: String(bodyObj.notes ?? ''),
                });
          return {
            status: 200,
            contentType: 'application/json; charset=utf-8',
            headers: responseHeaders,
            body: JSON.stringify(created),
          };
        }
      }

      const companyIdMatch = req.pathname.match(/^\/companies\/(\d+)\/?$/);
      if (companyIdMatch) {
        const companyId = Number(companyIdMatch[1]);
        if (req.method === 'PUT') {
          const updated = activeDb.updateCompany(companyId, String(bodyObj.name ?? ''));
          return {
            status: 200,
            contentType: 'application/json; charset=utf-8',
            headers: responseHeaders,
            body: JSON.stringify(updated),
          };
        }
        if (req.method === 'DELETE') {
          const deleted = activeDb.deleteCompany(companyId);
          return {
            status: 200,
            contentType: 'application/json; charset=utf-8',
            headers: responseHeaders,
            body: JSON.stringify(deleted),
          };
        }
      }

      // --- Pickups ---
      if (req.pathname === '/pickups/' || req.pathname === '/pickups') {
        if (req.method === 'POST') {
          const created = activeDb.createPickup({
            company_id: Number(bodyObj.company_id),
            date: String(bodyObj.date ?? ''),
            yard: String(bodyObj.yard ?? ''),
            currency: String(bodyObj.currency ?? '$'),
            notes: String(bodyObj.notes ?? ''),
            deduction: Number(bodyObj.deduction) || 0,
            metals: Array.isArray(bodyObj.metals) ? bodyObj.metals : [],
          });
          return {
            status: 200,
            contentType: 'application/json; charset=utf-8',
            headers: responseHeaders,
            body: JSON.stringify(created),
          };
        }
      }

      const pickupIdMatch = req.pathname.match(/^\/pickups\/(\d+)\/?$/);
      if (pickupIdMatch) {
        const pickupId = Number(pickupIdMatch[1]);
        if (req.method === 'PUT') {
          const updated = activeDb.updatePickup(pickupId, {
            date: String(bodyObj.date ?? ''),
            yard: String(bodyObj.yard ?? ''),
            currency: String(bodyObj.currency ?? '$'),
            notes: String(bodyObj.notes ?? ''),
            deduction: Number(bodyObj.deduction) || 0,
            metals: Array.isArray(bodyObj.metals) ? bodyObj.metals : [],
          });
          return {
            status: 200,
            contentType: 'application/json; charset=utf-8',
            headers: responseHeaders,
            body: JSON.stringify(updated),
          };
        }
        if (req.method === 'DELETE') {
          const deleted = activeDb.deletePickup(pickupId);
          return {
            status: 200,
            contentType: 'application/json; charset=utf-8',
            headers: responseHeaders,
            body: JSON.stringify(deleted),
          };
        }
      }

      // --- Deductions ---
      if (req.pathname === '/deductions/' || req.pathname === '/deductions') {
        if (req.method === 'POST') {
          const created = activeDb.createDeduction({
            company_id: Number(bodyObj.company_id),
            date: String(bodyObj.date ?? ''),
            amount: Number(bodyObj.amount) || 0,
            currency: String(bodyObj.currency ?? '$'),
            notes: String(bodyObj.notes ?? ''),
          });
          return {
            status: 200,
            contentType: 'application/json; charset=utf-8',
            headers: responseHeaders,
            body: JSON.stringify(created),
          };
        }
      }

      const deductionIdMatch = req.pathname.match(/^\/deductions\/(\d+)\/?$/);
      if (deductionIdMatch) {
        const deductionId = Number(deductionIdMatch[1]);
        if (req.method === 'PUT') {
          const updated = activeDb.updateDeduction(deductionId, {
            date: String(bodyObj.date ?? ''),
            amount: Number(bodyObj.amount) || 0,
            currency: String(bodyObj.currency ?? '$'),
            notes: String(bodyObj.notes ?? ''),
          });
          return {
            status: 200,
            contentType: 'application/json; charset=utf-8',
            headers: responseHeaders,
            body: JSON.stringify(updated),
          };
        }
        if (req.method === 'DELETE') {
          const deleted = activeDb.deleteDeduction(deductionId);
          return {
            status: 200,
            contentType: 'application/json; charset=utf-8',
            headers: responseHeaders,
            body: JSON.stringify(deleted),
          };
        }
      }

      // --- Yards ---
      if (req.pathname === '/yards/' || req.pathname === '/yards') {
        if (req.method === 'GET') {
          return {
            status: 200,
            contentType: 'application/json; charset=utf-8',
            headers: responseHeaders,
            body: JSON.stringify(activeDb.getYardOptions()),
          };
        }
        if (req.method === 'POST') {
          const created = activeDb.createYardOption(String(bodyObj.name ?? ''));
          return {
            status: 200,
            contentType: 'application/json; charset=utf-8',
            headers: responseHeaders,
            body: JSON.stringify(created),
          };
        }
      }

      const yardIdMatch = req.pathname.match(/^\/yards\/(\d+)\/?$/);
      if (yardIdMatch) {
        const yardId = Number(yardIdMatch[1]);
        if (req.method === 'PUT') {
          const updated = activeDb.updateYardOption(yardId, String(bodyObj.name ?? ''));
          return {
            status: 200,
            contentType: 'application/json; charset=utf-8',
            headers: responseHeaders,
            body: JSON.stringify(updated),
          };
        }
        if (req.method === 'DELETE') {
          const deleted = activeDb.deleteYardOption(yardId);
          return {
            status: 200,
            contentType: 'application/json; charset=utf-8',
            headers: responseHeaders,
            body: JSON.stringify(deleted),
          };
        }
      }

      // --- Currencies ---
      if (req.pathname === '/currencies/' || req.pathname === '/currencies') {
        if (req.method === 'GET') {
          return {
            status: 200,
            contentType: 'application/json; charset=utf-8',
            headers: responseHeaders,
            body: JSON.stringify(activeDb.getCurrencyOptions()),
          };
        }
        if (req.method === 'POST') {
          const created = activeDb.createCurrencyOption({
            code: String(bodyObj.code ?? ''),
            symbol: String(bodyObj.symbol ?? ''),
            label: String(bodyObj.label ?? ''),
          });
          return {
            status: 200,
            contentType: 'application/json; charset=utf-8',
            headers: responseHeaders,
            body: JSON.stringify(created),
          };
        }
      }

      const currencyIdMatch = req.pathname.match(/^\/currencies\/(\d+)\/?$/);
      if (currencyIdMatch) {
        const currencyId = Number(currencyIdMatch[1]);
        if (req.method === 'PUT') {
          const updated = activeDb.updateCurrencyOption(currencyId, {
            code: String(bodyObj.code ?? ''),
            symbol: String(bodyObj.symbol ?? ''),
            label: String(bodyObj.label ?? ''),
          });
          return {
            status: 200,
            contentType: 'application/json; charset=utf-8',
            headers: responseHeaders,
            body: JSON.stringify(updated),
          };
        }
        if (req.method === 'DELETE') {
          const deleted = activeDb.deleteCurrencyOption(currencyId);
          return {
            status: 200,
            contentType: 'application/json; charset=utf-8',
            headers: responseHeaders,
            body: JSON.stringify(deleted),
          };
        }
      }

      // --- Weight Units ---
      if (req.pathname === '/units/' || req.pathname === '/units') {
        if (req.method === 'GET') {
          return {
            status: 200,
            contentType: 'application/json; charset=utf-8',
            headers: responseHeaders,
            body: JSON.stringify(activeDb.getUnitOptions()),
          };
        }
        if (req.method === 'POST') {
          const created = activeDb.createUnitOption({
            value: String(bodyObj.value ?? ''),
            label: String(bodyObj.label ?? ''),
          });
          return {
            status: 200,
            contentType: 'application/json; charset=utf-8',
            headers: responseHeaders,
            body: JSON.stringify(created),
          };
        }
      }

      const unitIdMatch = req.pathname.match(/^\/units\/(\d+)\/?$/);
      if (unitIdMatch) {
        const unitId = Number(unitIdMatch[1]);
        if (req.method === 'PUT') {
          const updated = activeDb.updateUnitOption(unitId, {
            value: String(bodyObj.value ?? ''),
            label: String(bodyObj.label ?? ''),
          });
          return {
            status: 200,
            contentType: 'application/json; charset=utf-8',
            headers: responseHeaders,
            body: JSON.stringify(updated),
          };
        }
        if (req.method === 'DELETE') {
          const deleted = activeDb.deleteUnitOption(unitId);
          return {
            status: 200,
            contentType: 'application/json; charset=utf-8',
            headers: responseHeaders,
            body: JSON.stringify(deleted),
          };
        }
      }

      // --- Unique Metal Names ---
      if (req.pathname === '/metals/unique-names' && req.method === 'GET') {
        return {
          status: 200,
          contentType: 'application/json; charset=utf-8',
          headers: responseHeaders,
          body: JSON.stringify(activeDb.getUniqueMetalNames()),
        };
      }
    } catch (err) {
      return {
        status: 400,
        contentType: 'application/json; charset=utf-8',
        headers: responseHeaders,
        body: JSON.stringify({
          detail: err instanceof Error ? err.message : 'Request failed',
        }),
      };
    }
  }

  if (req.pathname === '/api/sync-events' && req.method === 'GET') {
    return {
      status: 200,
      contentType: 'text/event-stream; charset=utf-8',
      body: 'data: {"type":"CONNECTED"}\n\n',
    };
  }

  if ((req.pathname === '/' || req.pathname === '/settings' || req.pathname === '/index.html') && req.method === 'GET') {
    const html = getEmbeddedUiHtml(dirToUse);
    return {
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: html,
    };
  }

  return {
    status: 404,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify({ ok: false, error: 'Not Found' }),
  };
}

const sseClients = new Set<http.ServerResponse>();

export function broadcastSseUpdate(payload: Record<string, unknown>) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(data);
    } catch {
      sseClients.delete(client);
    }
  }
}

export function createLedgerHttpServer(db: LedgerDatabase | null, rootDir?: string): http.Server {
  return http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const method = req.method || 'GET';

    if (url.pathname === '/api/sync-events' && method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      res.write('data: {"type":"CONNECTED"}\n\n');
      sseClients.add(res);
      req.on('close', () => {
        sseClients.delete(res);
      });
      return;
    }

    if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const token = extractSessionTokenFromHeaders(req.headers);
        const sessionValidation = token ? validateBrowserSession(token, rootDir) : null;
        const dbLocked = isDatabaseLocked(rootDir);
        const isLocked = dbLocked ? !(token && sessionValidation && sessionValidation.valid) : false;
        const activeDb = isLocked ? null : (db && db.isHealthy() ? db : getLedgerDatabase(rootDir));
        const response = handleHttpRequest(
          activeDb,
          {
            method,
            pathname: url.pathname,
            body: Buffer.concat(chunks).toString('utf8'),
            headers: req.headers,
          },
          rootDir
        );
        if (response.status === 200 && response.contentType.includes('application/json')) {
          try {
            const parsed = JSON.parse(response.body);
            if ((parsed.ok && parsed.state) || url.pathname !== '/api/ledger') {
              const version = parsed.state?.dbStatus?.dataVersion;
              broadcastSseUpdate({
                type: 'CUSTOMER_LEDGER_UPDATED',
                dataVersion: version,
                timestamp: Date.now(),
              });
            }
          } catch (e) {}
        }
        const headers: Record<string, string | string[]> = {
          'Content-Type': response.contentType,
          ...(response.headers || {}),
        };
        res.writeHead(response.status, headers);
        res.end(response.body);
      });
      return;
    }

    const token = extractSessionTokenFromHeaders(req.headers);
    const sessionValidation = token ? validateBrowserSession(token, rootDir) : null;
    const dbLocked = isDatabaseLocked(rootDir);
    const isLocked = dbLocked ? !(token && sessionValidation && sessionValidation.valid) : false;
    const activeDb = isLocked ? null : (db && db.isHealthy() ? db : getLedgerDatabase(rootDir));
    const response = handleHttpRequest(
      activeDb,
      { method, pathname: url.pathname, headers: req.headers },
      rootDir
    );
    const headers: Record<string, string | string[]> = {
      'Content-Type': response.contentType,
      ...(response.headers || {}),
    };
    res.writeHead(response.status, headers);
    res.end(response.body);
  });
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const port = Number(process.env.PORT || 3003);
  const host = process.env.HOST || '127.0.0.1';
  const rootDir = process.env.ADM_ROOT_DIR || resolvePortablePaths().root;
  const locked = isDatabaseLocked(rootDir);
  let db: LedgerDatabase | null = null;
  if (!locked) {
    try {
      db = getLedgerDatabase(rootDir);
    } catch {}
  }
  const server = createLedgerHttpServer(db, rootDir);

  server.listen(port, host, () => {
    console.log(
      `[Money Total Sheet] Portable Encrypted Ledger Server listening on http://${host}:${port}${locked ? ' [Locked - Supervisor Login Required]' : ''}`
    );
  });

  const heartbeat = startUsbHeartbeat({
    db: db || undefined,
    server,
    port,
    rootDir,
    intervalMs: 1500,
    exitProcess: true,
    closeBrowser: true,
  });

  const shutdown = () => {
    heartbeat.stop();
    console.log('\n[Money Total Sheet] Flushing encrypted WAL and closing SQLite database...');
    server.close(() => {
      if (db) {
        try {
          db.close();
        } catch {}
      }
      process.exit(0);
    });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
