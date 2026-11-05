import { buildCurrencyLabel, type CustomerRecord, type EntryType } from './accounting.ts';
import {
  clearSessionMasterKey,
  unlockWithPasscode,
  type AppState,
  type LedgerDatabase,
} from './database.ts';
import { isUsbConnected, simulateUsbRemoval } from './heartbeat.ts';

export interface ServiceResult {
  ok: boolean;
  state?: AppState;
  data?: unknown;
  error?: string;
  connected?: boolean;
}

export function dispatchLedgerAction(
  db: LedgerDatabase,
  action: string,
  payload: Record<string, unknown> = {}
): ServiceResult {
  try {
    switch (action) {
      case 'getState': {
        return { ok: true, state: db.getAppState() };
      }
      case 'setupPasscode': {
        const setupRes = db.setupPasscode({
          passcode: String(payload.passcode ?? ''),
          confirmPasscode: payload.confirmPasscode !== undefined ? String(payload.confirmPasscode) : undefined,
          hintQuestion: String(payload.hintQuestion ?? ''),
          hintAnswer: String(payload.hintAnswer ?? ''),
          recoveryCodes: Array.isArray(payload.recoveryCodes) ? (payload.recoveryCodes as string[]) : undefined,
        });
        return { ok: true, data: setupRes, state: db.getAppState() };
      }
      case 'recoverPasscode': {
        const recRes = db.recoverPasscode({
          recoveryCode: String(payload.recoveryCode ?? ''),
          newPasscode: String(payload.newPasscode ?? ''),
          confirmPasscode: payload.confirmPasscode !== undefined ? String(payload.confirmPasscode) : undefined,
        });
        return { ok: true, data: recRes, state: db.getAppState() };
      }
      case 'getRecoveryCodes': {
        const codes = db.getRecoveryCodes(String(payload.passcode ?? ''));
        return { ok: true, data: { recoveryCodes: codes }, state: db.getAppState() };
      }
      case 'regenerateRecoveryCodes': {
        const codes = db.regenerateRecoveryCodes(String(payload.passcode ?? ''));
        return { ok: true, data: { recoveryCodes: codes }, state: db.getAppState() };
      }
      case 'resetPasscode': {
        db.resetPasscode(payload.oldPasscode !== undefined ? String(payload.oldPasscode) : undefined);
        return { ok: true, state: db.getAppState() };
      }
      case 'verifyPasscode': {
        const valid = db.verifyPasscode(String(payload.passcode ?? ''));
        if (!valid) {
          return { ok: false, error: 'Invalid supervisor passcode' };
        }
        return { ok: true, state: db.getAppState() };
      }
      case 'unlock': {
        const unlockRes = unlockWithPasscode(String(payload.passcode ?? ''));
        if (!unlockRes.ok) {
          return { ok: false, error: unlockRes.error || 'Incorrect supervisor password' };
        }
        return { ok: true, state: db.getAppState() };
      }
      case 'lock': {
        clearSessionMasterKey();
        return { ok: true, state: db.getAppState() };
      }
      case 'createCustomer': {
        const created = db.createCustomer({
          name: String(payload.name ?? ''),
          defaultYard:
            payload.defaultYard !== undefined && String(payload.defaultYard).trim()
              ? String(payload.defaultYard).trim()
              : undefined,
          balance: Number(payload.balance ?? 0),
          phone: String(payload.phone ?? ''),
          notes: String(payload.notes ?? payload.phone ?? ''),
          currency: payload.currency ? String(payload.currency) : undefined,
        });
        return { ok: true, data: created, state: db.getAppState() };
      }
      case 'updateCustomer': {
        const updated = db.updateCustomer({
          id: String(payload.id ?? payload.customerId ?? ''),
          name: payload.name !== undefined ? String(payload.name) : undefined,
          defaultYard: payload.defaultYard !== undefined ? String(payload.defaultYard) : undefined,
          phone: payload.phone !== undefined ? String(payload.phone) : undefined,
          notes: payload.notes !== undefined ? String(payload.notes) : undefined,
        });
        return { ok: true, data: updated, state: db.getAppState() };
      }
      case 'deleteCustomer': {
        const confirmation = String(payload.confirmation ?? '')
          .trim()
          .toLowerCase();
        if (confirmation !== 'delete') {
          return {
            ok: false,
            error: 'Please type "delete" to confirm deleting this customer account.',
          };
        }
        const deleted = db.deleteCustomer(String(payload.customerId ?? ''));
        return { ok: true, data: deleted, state: db.getAppState() };
      }
      case 'restoreCustomer': {
        const restored = db.restoreCustomer(payload.customer as CustomerRecord);
        return { ok: true, data: restored, state: db.getAppState() };
      }
      case 'addLedgerEntry': {
        const updatedCustomer = db.addLedgerEntry({
          customerId: String(payload.customerId ?? ''),
          entryType: payload.entryType as EntryType | undefined,
          amount: payload.amount !== undefined ? Number(payload.amount) : undefined,
          invoice: payload.invoice !== undefined ? Number(payload.invoice) : undefined,
          paid: payload.paid !== undefined ? Number(payload.paid) : undefined,
          payFull: Boolean(payload.payFull),
          currency: payload.currency ? String(payload.currency) : undefined,
          method: payload.method ? String(payload.method) : undefined,
          yard:
            payload.yard !== undefined && String(payload.yard).trim()
              ? String(payload.yard).trim()
              : undefined,
          memo: payload.memo ? String(payload.memo) : undefined,
          date: payload.date ? String(payload.date) : undefined,
        });
        return { ok: true, data: updatedCustomer, state: db.getAppState() };
      }
      case 'updateLedgerEntry':
      case 'editLedgerEntry': {
        const updatedCustomer = db.updateLedgerEntry({
          customerId: String(payload.customerId ?? ''),
          entryIndex: Number(payload.entryIndex ?? 0),
          date: payload.date !== undefined ? String(payload.date) : undefined,
          invoice: payload.invoice !== undefined ? Number(payload.invoice) : undefined,
          paid: payload.paid !== undefined ? Number(payload.paid) : undefined,
          method: payload.method !== undefined ? String(payload.method) : undefined,
          yard: payload.yard !== undefined ? String(payload.yard) : undefined,
          memo: payload.memo !== undefined ? String(payload.memo) : undefined,
          currency: payload.currency !== undefined ? String(payload.currency) : undefined,
        });
        return { ok: true, data: updatedCustomer, state: db.getAppState() };
      }
      case 'deleteLedgerEntry': {
        const updatedCustomer = db.deleteLedgerEntry({
          customerId: String(payload.customerId ?? ''),
          entryIndex: Number(payload.entryIndex ?? 0),
        });
        return { ok: true, data: updatedCustomer, state: db.getAppState() };
      }
      case 'consolidateCustomerBalance': {
        const updatedCustomer = db.consolidateCustomerBalance({
          customerId: String(payload.customerId ?? ''),
        });
        return { ok: true, data: updatedCustomer, state: db.getAppState() };
      }
      case 'addYard': {
        const yards = db.addYard(String(payload.name ?? ''));
        return { ok: true, data: yards, state: db.getAppState() };
      }
      case 'renameYard': {
        const yards = db.renameYard(String(payload.oldName ?? ''), String(payload.newName ?? ''));
        return { ok: true, data: yards, state: db.getAppState() };
      }
      case 'removeYard': {
        const yards = db.removeYard(String(payload.name ?? ''));
        return { ok: true, data: yards, state: db.getAppState() };
      }
      case 'addCurrency': {
        const label =
          payload.shortName && payload.symbol
            ? buildCurrencyLabel(String(payload.shortName), String(payload.symbol))
            : String(payload.name ?? payload.currency ?? '');
        const currencies = db.addCurrency(label);
        return { ok: true, data: currencies, state: db.getAppState() };
      }
      case 'renameCurrency': {
        const oldLabel = String(payload.oldName ?? payload.oldCurrency ?? '');
        const newLabel =
          payload.shortName && payload.symbol
            ? buildCurrencyLabel(String(payload.shortName), String(payload.symbol))
            : String(payload.newName ?? payload.newCurrency ?? '');
        const currencies = db.renameCurrency(oldLabel, newLabel);
        return { ok: true, data: currencies, state: db.getAppState() };
      }
      case 'removeCurrency': {
        const currencies = db.removeCurrency(String(payload.name ?? payload.currency ?? ''));
        return { ok: true, data: currencies, state: db.getAppState() };
      }
      case 'setDefaultYard': {
        const yard = String(payload.name ?? payload.yard ?? payload.defaultYard ?? '').trim();
        db.setDefaultYard(yard);
        return { ok: true, state: db.getAppState() };
      }
      case 'updateSettings': {
        const state = db.updateSettings({
          currentCurrency: payload.currentCurrency ? String(payload.currentCurrency) : undefined,
          newCurrency: payload.newCurrency ? String(payload.newCurrency) : undefined,
          defaultYard: payload.defaultYard ? String(payload.defaultYard) : undefined,
          language: payload.language ? String(payload.language) : undefined,
        });
        return { ok: true, state };
      }
      case 'exportBackup': {
        const archive = db.exportBackupArchive();
        return { ok: true, data: archive, state: db.getAppState() };
      }
      case 'importBackup': {
        const state = db.importBackupArchive(
          String(payload.content ?? ''),
          payload.fileName ? String(payload.fileName) : undefined
        );
        return { ok: true, state };
      }
      case 'clearDatabase': {
        const confirmation = String(payload.confirmation ?? '')
          .trim()
          .toLowerCase();
        if (confirmation !== 'delete') {
          return {
            ok: false,
            error: 'Please type "delete" to confirm deleting the database.',
          };
        }
        const state = db.clearDatabase();
        return { ok: true, state };
      }
      case 'heartbeat': {
        const connected = isUsbConnected();
        return {
          ok: connected,
          connected,
          data: { connected, timestamp: Date.now() },
          state: db.getAppState(),
          ...(connected ? {} : { error: 'USB drive disconnected' }),
        };
      }
      case 'simulateUsbRemoval': {
        const sim = payload.simulated !== false;
        simulateUsbRemoval(sim);
        return { ok: true, data: { simulated: sim }, state: db.getAppState() };
      }
      default:
        return { ok: false, error: `Unknown action: ${action}` };
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unexpected database error',
    };
  }
}

