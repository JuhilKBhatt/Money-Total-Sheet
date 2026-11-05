import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as accounting from '../src/accounting.ts';

describe('Accounting Domain Logic', () => {
  it('Given a positive, negative, or zero amount When formatSignedBalance is called Then it returns explicit signed currency strings', () => {
    const fn = (accounting as Record<string, unknown>).formatSignedBalance as (amount: number, currencySymbol?: string) => string;
    assert.equal(typeof fn, 'function', 'formatSignedBalance should be a function');
    assert.equal(fn(14250), '+$14,250.00');
    assert.equal(fn(-4600), '-$4,600.00');
    assert.equal(fn(0), '$0.00');
    assert.equal(fn(0.0001), '$0.00');
    assert.equal(fn(6190.5, '€'), '+€6,190.50');
  });

  it('Given a monetary amount When formatMoney is called Then it returns unsigned formatted currency', () => {
    const fn = (accounting as Record<string, unknown>).formatMoney as (amount: number, currencySymbol?: string) => string;
    assert.equal(typeof fn, 'function', 'formatMoney should be a function');
    assert.equal(fn(18000), '$18,000.00');
    assert.equal(fn(-5000), '$5,000.00');
    assert.equal(fn(0), '$0.00');
  });

  it('Given a customer balance When classifyBalance is called Then it classifies as OWING, ADVANCE, or SETTLED', () => {
    const fn = (accounting as Record<string, unknown>).classifyBalance as (balance: number) => string;
    assert.equal(typeof fn, 'function', 'classifyBalance should be a function');
    assert.equal(fn(100.25), 'OWING');
    assert.equal(fn(-50), 'ADVANCE');
    assert.equal(fn(0), 'SETTLED');
  });

  it('Given an existing balance and ledger entry When calculateEntryImpact is called Then it computes invoice, paid, and new runningBalance', () => {
    const fn = (accounting as Record<string, unknown>).calculateEntryImpact as (
      currentBalance: number,
      entryType: 'invoice' | 'payment' | 'advance',
      amount: number
    ) => { invoiceAmount: number; paidAmount: number; runningBalance: number };
    assert.equal(typeof fn, 'function', 'calculateEntryImpact should be a function');

    // Invoice increases balance owed (+)
    assert.deepEqual(fn(1000, 'invoice', 500), {
      invoiceAmount: 500,
      paidAmount: 0,
      runningBalance: 1500,
    });

    // Payment settles customer debt (-)
    assert.deepEqual(fn(1500, 'payment', 600), {
      invoiceAmount: 0,
      paidAmount: 600,
      runningBalance: 900,
    });

    // Advance given to customer creates/increases negative credit (-)
    assert.deepEqual(fn(2400, 'advance', 7000), {
      invoiceAmount: 0,
      paidAmount: 7000,
      runningBalance: -4600,
    });
  });

  it('Given a list of customer accounts When calculateConsolidatedMetrics is called Then it returns receivables, advances, net position, and counts', () => {
    const fn = (accounting as Record<string, unknown>).calculateConsolidatedMetrics as (
      customers: Array<{ balance: number }>
    ) => {
      totalOwing: number;
      owingCount: number;
      totalAdvance: number;
      advanceCount: number;
      settledCount: number;
      netPosition: number;
      totalAccounts: number;
    };
    assert.equal(typeof fn, 'function', 'calculateConsolidatedMetrics should be a function');

    const customers = [
      { balance: 14250.0 },
      { balance: 8400.0 },
      { balance: 6190.5 },
      { balance: 0.0 },
      { balance: -4600.0 },
      { balance: 6000.0 },
    ];

    const metrics = fn(customers);
    assert.deepEqual(metrics, {
      totalOwing: 34840.5,
      owingCount: 4,
      totalAdvance: 4600.0,
      advanceCount: 1,
      settledCount: 1,
      netPosition: 30240.5,
      totalAccounts: 6,
    });
  });

  it('Given customer accounts and filter criteria When filterBalanceSheetCustomers is called Then it returns matching accounts', () => {
    const fn = (accounting as Record<string, unknown>).filterBalanceSheetCustomers as (
      customers: Array<{ id: string; name: string; defaultYard: string; phone: string; balance: number }>,
      filters: { yard?: string; type?: string; search?: string; amountPreset?: string }
    ) => Array<{ id: string }>;
    assert.equal(typeof fn, 'function', 'filterBalanceSheetCustomers should be a function');

    const customers = [
      { id: 'CUST-1001', name: 'Apex Metals Ltd.', defaultYard: 'North Yard', phone: '111', balance: 14250 },
      { id: 'CUST-1004', name: 'Delta Auto Salvage', defaultYard: 'West Yard', phone: '222', balance: 0 },
      { id: 'CUST-1005', name: 'Evergreen Recyclers', defaultYard: 'North Yard', phone: '333', balance: -4600 },
      { id: 'CUST-1006', name: 'Highland Builders Ltd.', defaultYard: 'East Yard', phone: '444', balance: 6000 },
    ];

    assert.equal(fn(customers, { yard: 'North Yard' }).length, 2);
    assert.equal(fn(customers, { type: 'OWING' }).length, 2);
    assert.equal(fn(customers, { type: 'ADVANCE' }).length, 1);
    assert.equal(fn(customers, { type: 'SETTLED' }).length, 1);
    assert.equal(fn(customers, { amountPreset: 'GT10000' }).length, 1);
    assert.equal(fn(customers, { amountPreset: 'GT5000' }).length, 2);
    assert.equal(fn(customers, { amountPreset: 'NEGATIVE' }).length, 1);
    assert.equal(fn(customers, { search: 'evergreen' }).length, 1);
  });

  it('Given customer accounts When generateBalanceSheetCSV is called Then it returns a valid CSV string', () => {
    const fn = (accounting as Record<string, unknown>).generateBalanceSheetCSV as (
      customers: Array<{ id: string; name: string; defaultYard: string; balance: number; lastUpdate: string }>
    ) => string;
    assert.equal(typeof fn, 'function', 'generateBalanceSheetCSV should be a function');

    const csv = fn([
      { id: 'CUST-1001', name: 'Apex Metals Ltd.', defaultYard: 'North Yard', balance: 14250, lastUpdate: '2025-02-23 14:15' },
      { id: 'CUST-1005', name: 'Evergreen Recyclers', defaultYard: 'North Yard', balance: -4600, lastUpdate: '2025-02-24 16:30' },
    ]);
    assert.ok(csv.includes('Customer ID,Customer Name,Yard,Current Balance,Position Status,Last Updated'));
    assert.ok(csv.includes('"CUST-1001","Apex Metals Ltd.","North Yard","14250","We Owe Customer","2025-02-23 14:15"'));
    assert.ok(csv.includes('"CUST-1005","Evergreen Recyclers","North Yard","-4600","Advance Given","2025-02-24 16:30"'));
  });

  it('Given a currency short name and symbol When building or extracting currency labels Then it formats and parses short name and symbol accurately', () => {
    assert.equal(accounting.buildCurrencyLabel('USD', '$'), 'USD ($)');
    assert.equal(accounting.buildCurrencyLabel('afn', '؋'), 'AFN (؋)');
    assert.equal(accounting.buildCurrencyLabel('eur', '€'), 'EUR (€)');

    assert.equal(accounting.extractCurrencyShortName('USD ($)'), 'USD');
    assert.equal(accounting.extractCurrencyShortName('AFN (؋)'), 'AFN');
    assert.equal(accounting.extractCurrencyShortName('EUR (€)'), 'EUR');
    assert.equal(accounting.extractCurrencyShortName('CAD'), 'CAD');

    assert.equal(accounting.extractCurrencySymbol('USD ($)'), '$');
    assert.equal(accounting.extractCurrencySymbol('AFN (؋)'), '؋');
    assert.equal(accounting.extractCurrencySymbol('EUR (€)'), '€');
    assert.equal(accounting.extractCurrencySymbol('؋'), '؋');
    assert.equal(accounting.extractCurrencySymbol('€'), '€');

    assert.equal(accounting.formatSignedBalance(100, 'AFN (؋)'), '+؋100.00');
    assert.equal(accounting.formatSignedBalance(-50, 'EUR (€)'), '-€50.00');
    assert.equal(accounting.formatMoney(250, 'AFN (؋)'), '؋250.00');
  });

  it('Given edge case amounts (small sub-cent floats, -0, NaN, Infinity) When formatSignedBalance, formatMoney, and classifyBalance are called Then they return mathematically clean and settled values without -$0.00 or +$0.00', () => {
    // Exact zero and negative zero
    assert.equal(accounting.formatSignedBalance(0), '$0.00');
    assert.equal(accounting.formatSignedBalance(-0), '$0.00');
    assert.equal(accounting.classifyBalance(0), 'SETTLED');
    assert.equal(accounting.classifyBalance(-0), 'SETTLED');

    // Sub-cent fractional amounts that round to zero cents
    assert.equal(accounting.formatSignedBalance(0.004), '$0.00');
    assert.equal(accounting.formatSignedBalance(-0.004), '$0.00');
    assert.equal(accounting.classifyBalance(0.004), 'SETTLED');
    assert.equal(accounting.classifyBalance(-0.004), 'SETTLED');

    // Exactly one cent
    assert.equal(accounting.formatSignedBalance(0.01), '+$0.01');
    assert.equal(accounting.formatSignedBalance(-0.01), '-$0.01');
    assert.equal(accounting.classifyBalance(0.01), 'OWING');
    assert.equal(accounting.classifyBalance(-0.01), 'ADVANCE');

    // Format money
    assert.equal(accounting.formatMoney(0), '$0.00');
    assert.equal(accounting.formatMoney(-0), '$0.00');
    assert.equal(accounting.formatMoney(0.004), '$0.00');
    assert.equal(accounting.formatMoney(-0.004), '$0.00');

    // Non-finite values
    assert.equal(accounting.formatSignedBalance(NaN), '$0.00');
    assert.equal(accounting.formatSignedBalance(Infinity), '$0.00');
    assert.equal(accounting.formatMoney(NaN), '$0.00');
    assert.equal(accounting.classifyBalance(NaN), 'SETTLED');
    assert.equal(accounting.classifyBalance(Infinity), 'SETTLED');
  });

  it('Given customer accounts with floating-point additions When calculateConsolidatedMetrics is called Then sums and net position avoid IEEE 754 precision drift', () => {
    const customers = [
      { balance: 0.1 },
      { balance: 0.2 },
      { balance: -0.3 },
      { balance: 0.004 }, // rounds to 0.00 -> settled
    ];
    const metrics = accounting.calculateConsolidatedMetrics(customers);
    assert.equal(metrics.totalOwing, 0.3);
    assert.equal(metrics.owingCount, 2);
    assert.equal(metrics.totalAdvance, 0.3);
    assert.equal(metrics.advanceCount, 1);
    assert.equal(metrics.settledCount, 1);
    assert.equal(metrics.netPosition, 0.0);
    assert.equal(metrics.totalAccounts, 4);
  });

  it('Given customer accounts When sortCustomersAlphabetically is called Then it sorts customers alphabetically (A-Z) case-insensitively', () => {
    const fn = (accounting as Record<string, unknown>).sortCustomersAlphabetically as (
      customers: Array<{ name: string; id?: string }>
    ) => Array<{ name: string; id?: string }>;
    assert.equal(typeof fn, 'function', 'sortCustomersAlphabetically should be a function');

    const input = [
      { name: 'Zubair Brothers' },
      { name: 'Ali' },
      { name: 'baker metals' },
      { name: 'Apex Ltd' },
      { name: 'charlie recycling' },
    ];
    const sorted = fn(input);
    const names = sorted.map((c) => c.name);
    assert.deepEqual(names, [
      'Ali',
      'Apex Ltd',
      'baker metals',
      'charlie recycling',
      'Zubair Brothers',
    ]);
  });

  it('Given ledger entries with dates When sortLedgerEntriesByDate is called Then it sorts entries chronologically from oldest at the top to newest at the bottom', () => {
    const fn = (accounting as Record<string, unknown>).sortLedgerEntriesByDate as (
      entries: Array<{ date: string; memo: string }>
    ) => Array<{ date: string; memo: string }>;
    assert.equal(typeof fn, 'function', 'sortLedgerEntriesByDate should be a function');

    const input = [
      { date: '2026-11-02 14:00', memo: 'Latest entry' },
      { date: '2024-01-15 09:30', memo: 'Oldest entry' },
      { date: '2025-06-20 11:15', memo: 'Middle entry' },
      { date: '2025-06-20 16:45', memo: 'Same day later' },
    ];
    const sorted = fn(input);
    assert.deepEqual(
      sorted.map((e) => e.memo),
      ['Oldest entry', 'Middle entry', 'Same day later', 'Latest entry']
    );
  });
});


