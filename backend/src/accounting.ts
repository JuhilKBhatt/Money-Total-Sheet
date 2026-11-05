export type BalanceClassification = 'OWING' | 'ADVANCE' | 'SETTLED';
export type EntryType = 'invoice' | 'payment' | 'advance';

export interface LedgerEntryRecord {
  id?: string;
  customerId?: string;
  date: string;
  entryType?: EntryType;
  invoice: number;
  paid: number;
  method: string;
  yard: string;
  memo: string;
  runningBalance: number;
  currency?: string;
}

export interface CustomerRecord {
  id: string;
  name: string;
  defaultYard: string;
  balance: number;
  lastUpdate: string;
  phone: string;
  notes?: string;
  ledger: LedgerEntryRecord[];
}

export interface MetalItemRecord {
  id: number;
  pickup_id: number;
  metal_name: string;
  net_weight: number;
  weight_unit: string;
  price_per_unit: number;
  total: number;
}

export interface PickupRecord {
  id: number;
  company_id: number;
  date: string;
  yard: string;
  notes: string;
  deduction: number;
  total_amount: number;
  currency: string;
  metals: MetalItemRecord[];
}

export interface DeductionRecord {
  id: number;
  company_id: number;
  date: string;
  amount: number;
  notes: string;
  currency: string;
}

export interface CompanyRecord {
  id: number;
  name: string;
}

export interface YardOptionRecord {
  id: number;
  name: string;
}

export interface CurrencyOptionRecord {
  id: number;
  code: string;
  symbol: string;
  label: string;
}

export interface UnitOptionRecord {
  id: number;
  value: string;
  label: string;
}

export interface ConsolidatedMetrics {
  totalOwing: number;
  owingCount: number;
  totalAdvance: number;
  advanceCount: number;
  settledCount: number;
  netPosition: number;
  totalAccounts: number;
}

export interface BalanceSheetFilters {
  yard?: string;
  type?: string;
  search?: string;
  amountPreset?: string;
}

export function extractCurrencySymbol(currencyLabel = 'USD ($)'): string {
  if (!currencyLabel) return '$';
  const match = currencyLabel.match(/\(([^)]+)\)/);
  if (match && match[1]) return match[1].trim();
  const trimmed = currencyLabel.trim();
  return trimmed || '$';
}

export function extractCurrencyShortName(currencyLabel = 'USD ($)'): string {
  if (!currencyLabel) return 'USD';
  const match = currencyLabel.match(/^([^(]+)/);
  if (match && match[1]) return match[1].trim().toUpperCase();
  return currencyLabel.trim().toUpperCase() || 'USD';
}

export function buildCurrencyLabel(shortName: string, symbol: string): string {
  const code = (shortName || '').trim().toUpperCase();
  const sym = (symbol || '').trim();
  if (code && sym) return `${code} (${sym})`;
  if (code) return code;
  if (sym) return sym;
  return 'USD ($)';
}

export function formatSignedBalance(amount: number, currencySymbol = '$'): string {
  const num = Number(amount);
  const sym = extractCurrencySymbol(currencySymbol);
  if (!Number.isFinite(num)) {
    return `${sym}0.00`;
  }
  const rounded = Math.round(num * 100) / 100;
  if (rounded === 0 || Math.abs(rounded) < 0.005) {
    return `${sym}0.00`;
  }
  const formatted = Math.abs(rounded).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return rounded > 0 ? `+${sym}${formatted}` : `-${sym}${formatted}`;
}

export function formatMoney(amount: number, currencySymbol = '$'): string {
  const num = Math.abs(Number(amount));
  const sym = extractCurrencySymbol(currencySymbol);
  if (!Number.isFinite(num)) {
    return `${sym}0.00`;
  }
  const rounded = Math.round(num * 100) / 100;
  return (
    sym +
    rounded.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export function classifyBalance(balance: number): BalanceClassification {
  const num = Number(balance);
  if (!Number.isFinite(num)) return 'SETTLED';
  const rounded = Math.round(num * 100) / 100;
  if (rounded === 0 || Math.abs(rounded) < 0.005) return 'SETTLED';
  return rounded > 0 ? 'OWING' : 'ADVANCE';
}

export function calculateEntryImpact(
  currentBalance: number,
  entryType: EntryType,
  amount: number
): { invoiceAmount: number; paidAmount: number; runningBalance: number } {
  const cleanAmount = Math.round(Math.abs(Number(amount) || 0) * 100) / 100;
  const cur = Math.round((Number(currentBalance) || 0) * 100) / 100;
  if (entryType === 'invoice') {
    const next = Math.round((cur + cleanAmount) * 100) / 100;
    return { invoiceAmount: cleanAmount, paidAmount: 0, runningBalance: next };
  }
  const next = Math.round((cur - cleanAmount) * 100) / 100;
  return { invoiceAmount: 0, paidAmount: cleanAmount, runningBalance: next };
}

export function calculateConsolidatedMetrics(
  customers: Array<{ balance: number }>
): ConsolidatedMetrics {
  let totalOwing = 0;
  let owingCount = 0;
  let totalAdvance = 0;
  let advanceCount = 0;
  let settledCount = 0;

  for (const c of customers) {
    const bal = Math.round((Number(c.balance) || 0) * 100) / 100;
    const cls = classifyBalance(bal);
    if (cls === 'OWING') {
      totalOwing = Math.round((totalOwing + bal) * 100) / 100;
      owingCount++;
    } else if (cls === 'ADVANCE') {
      totalAdvance = Math.round((totalAdvance + Math.abs(bal)) * 100) / 100;
      advanceCount++;
    } else {
      settledCount++;
    }
  }

  const netPosition = Math.round((totalOwing - totalAdvance) * 100) / 100;
  return {
    totalOwing,
    owingCount,
    totalAdvance,
    advanceCount,
    settledCount,
    netPosition,
    totalAccounts: customers.length,
  };
}

export function filterBalanceSheetCustomers<
  T extends { id: string; name: string; defaultYard: string; phone?: string; notes?: string; balance: number }
>(customers: T[], filters: BalanceSheetFilters): T[] {
  const yardVal = filters.yard || 'ALL';
  const typeVal = filters.type || 'ALL';
  const searchVal = (filters.search || '').toLowerCase().trim();
  const amountPreset = filters.amountPreset || 'ALL';

  return customers.filter((cust) => {
    if (yardVal !== 'ALL' && cust.defaultYard !== yardVal) return false;

    const cls = classifyBalance(cust.balance);
    if (typeVal === 'OWING' && cls !== 'OWING') return false;
    if (typeVal === 'ADVANCE' && cls !== 'ADVANCE') return false;
    if (typeVal === 'SETTLED' && cls !== 'SETTLED') return false;

    if (searchVal) {
      const matchName = cust.name.toLowerCase().includes(searchVal);
      const matchId = cust.id.toLowerCase().includes(searchVal);
      const matchYard = cust.defaultYard.toLowerCase().includes(searchVal);
      const matchPhone = (cust.phone || '').toLowerCase().includes(searchVal);
      const matchNotes = (cust.notes || '').toLowerCase().includes(searchVal);
      if (!matchName && !matchId && !matchYard && !matchPhone && !matchNotes) return false;
    }

    const roundedBal = Math.round((Number(cust.balance) || 0) * 100) / 100;
    if (amountPreset === 'GT5000' && Math.abs(roundedBal) < 5000) return false;
    if (amountPreset === 'GT10000' && Math.abs(roundedBal) < 10000) return false;
    if (amountPreset === 'NEGATIVE' && cls !== 'ADVANCE') return false;

    return true;
  });
}

export function generateBalanceSheetCSV(
  customers: Array<{ id: string; name: string; defaultYard: string; balance: number; lastUpdate: string }>
): string {
  const header = 'Customer ID,Customer Name,Yard,Current Balance,Position Status,Last Updated\n';
  const rows = customers.map((c) => {
    const cls = classifyBalance(c.balance);
    const pos =
      cls === 'OWING' ? 'We Owe Customer' : cls === 'ADVANCE' ? 'Advance Given' : 'Settled';
    const safeName = c.name.replace(/"/g, '""');
    const safeYard = c.defaultYard.replace(/"/g, '""');
    return `"${c.id}","${safeName}","${safeYard}","${c.balance}","${pos}","${c.lastUpdate}"`;
  });
  return header + rows.join('\n') + '\n';
}

export function parseDateForSort(dateStr?: string): number {
  if (!dateStr || typeof dateStr !== 'string') return 0;
  const trimmed = dateStr.trim();
  if (!trimmed) return 0;
  const normalized = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
  const parsed = Date.parse(normalized);
  if (!isNaN(parsed)) return parsed;

  const parts = trimmed.split(/[-/ :T]/).map(Number);
  if (parts.length >= 3) {
    if (parts[0] > 1000) {
      // YYYY-MM-DD
      return new Date(
        parts[0],
        (parts[1] || 1) - 1,
        parts[2] || 1,
        parts[3] || 0,
        parts[4] || 0
      ).getTime();
    } else if (parts[2] > 1000) {
      // MM/DD/YYYY or DD/MM/YYYY
      return new Date(
        parts[2],
        (parts[0] || 1) - 1,
        parts[1] || 1,
        parts[3] || 0,
        parts[4] || 0
      ).getTime();
    }
  }
  return 0;
}

export function compareLedgerDates(dateA?: string, dateB?: string): number {
  const tsA = parseDateForSort(dateA);
  const tsB = parseDateForSort(dateB);
  if (tsA !== tsB) {
    return tsA - tsB; // oldest (smaller timestamp) first, newest (larger timestamp) last
  }
  return String(dateA || '').localeCompare(String(dateB || ''));
}

export function sortLedgerEntriesByDate<T extends { date: string }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => compareLedgerDates(a.date, b.date));
}

export function sortCustomersAlphabetically<T extends { name: string }>(customers: T[]): T[] {
  return [...customers].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
  );
}

export function calculateCompanyBalance(
  pickups: PickupRecord[],
  deductions: DeductionRecord[]
): number {
  const pickupTotal = pickups.reduce((sum, p) => sum + (Number(p.total_amount) || 0), 0);
  const deductionTotal = deductions.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
  return Math.round((pickupTotal - deductionTotal) * 100) / 100;
}

