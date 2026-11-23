import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateMonthlyIncome, marketReturns, simulateFinances } from '../src/finance.js';

const contract = {
  mode: 'fixed', fixedMonthly: 5000, hourlyRate: 30,
  paidHoursWeek: 12, pieceRate: 15, unitsMonth: 80,
};
const market = { months: 12, annualReturn: 0.21, shockMonth: 3, shockReturn: 0 };
const month = { income: 0, expenses: 0, oneOffCost: 0 };
const opening = { cash: 200, assets: 500, debt: 0, debtAPR: 0, monthlyPrincipal: 0, reserveCash: 100 };

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} ≠ ${expected}`);
}

test('contract modes pay only the selected components, independent of subjective inputs', () => {
  for (const [mode, expected] of Object.entries({ fixed: 5000, hourly: 1560, piece: 1200, mixed: 7760 })) {
    assert.equal(calculateMonthlyIncome({ ...contract, mode }), expected);
    assert.equal(calculateMonthlyIncome({ ...contract, mode, fatigue: 1, stress: 1 }), expected);
  }
});

test('income rejects malformed contracts, nonfinite values and out-of-range pay', () => {
  for (const invalid of [
    null, { mode: 'fixed' }, { ...contract, mode: 'unknown' }, { ...contract, hourlyRate: '30' },
    { ...contract, fixedMonthly: Infinity }, { ...contract, pieceRate: -1 },
    { ...contract, paidHoursWeek: 169 }, { ...contract, unitsMonth: NaN },
    { ...contract, fixedMonthly: 1e9 + 1 }, { ...contract, mode: 'mixed', pieceRate: 1e9 },
  ]) assert.throws(() => calculateMonthlyIncome(invalid));
  assert.equal(calculateMonthlyIncome({ ...contract, fixedMonthly: 1e9 }), 1e9);
});

test('monthly returns compound to the annual assumption and the specified shock is multiplicative', () => {
  const base = marketReturns(market);
  const stressed = marketReturns({ ...market, shockReturn: -0.2 });
  assert.equal(base.length, 12);
  near(base.reduce((wealth, rate) => wealth * (1 + rate), 1), 1.21);
  near(stressed.reduce((wealth, rate) => wealth * (1 + rate), 1), 0.968);
  near(1 + stressed[2], (1 + base[2]) * 0.8);
  assert.deepEqual(stressed.filter((_, index) => index !== 2), base.filter((_, index) => index !== 2));
  assert.deepEqual(marketReturns({ ...market, stress: 1, fatigue: 1 }), base);
});

test('minus 100% annual return or shock never creates a return below minus 100%', () => {
  assert.deepEqual(marketReturns({ ...market, annualReturn: -1, shockReturn: -1 }), Array(12).fill(-1));
  const shockOnly = marketReturns({ ...market, annualReturn: 0, shockReturn: -1 });
  assert.deepEqual(shockOnly, [0, 0, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const result = simulateFinances({ ...opening, schedule: [month, month], returns: [-1, 1] });
  assert.deepEqual(result.frames.map(frame => frame.assets), [0, 0]);
});

test('market assumptions stay finite and give valid month indices and horizons', () => {
  for (const override of [
    { months: 0 }, { months: 1.5 }, { months: 25 }, { annualReturn: NaN },
    { annualReturn: 1.01 }, { annualReturn: -1.01 }, { shockMonth: 0 },
    { shockMonth: 13 }, { shockMonth: 2.5 }, { shockReturn: -1.01 }, { shockReturn: 0.01 },
  ]) assert.throws(() => marketReturns({ ...market, ...override }));
  assert.equal(marketReturns({ ...market, months: 24 }).length, 24);
});

test('cash and net worth conserve each flow; principal is capped by opening debt', () => {
  const result = simulateFinances({
    ...opening, cash: 1000, assets: 1000, debt: 600, debtAPR: 0.12, monthlyPrincipal: 400,
    schedule: [
      { income: 1000, expenses: 500, oneOffCost: 40 },
      { income: 400, expenses: 700, oneOffCost: 0 },
      month,
    ],
    returns: [0.1, -0.2, 0],
  });
  assert.equal(result.complete, true);
  assert.equal(result.failure, null);
  assert.deepEqual(result.frames, [
    { month: 1, income: 1000, expenses: 500, oneOffCost: 40, interest: 6, principal: 400, profit: 100, cash: 1054, assets: 1100, debt: 200, netWorth: 1954 },
    { month: 2, income: 400, expenses: 700, oneOffCost: 0, interest: 2, principal: 200, profit: -220, cash: 552, assets: 880, debt: 0, netWorth: 1432 },
    { month: 3, ...month, interest: 0, principal: 0, profit: 0, cash: 552, assets: 880, debt: 0, netWorth: 1432 },
  ]);
  assert.deepEqual(result.summary, {
    endCash: 552, endAssets: 880, endDebt: 0, endNetWorth: 1432,
    minimumCash: 552, firstReserveBreach: null, totalIncome: 1400,
    totalExpenses: 1200, totalInterest: 8, totalPrincipal: 600, totalOneOffCost: 40, totalProfit: -120,
  });
  let netWorth = 1400;
  for (const frame of result.frames) {
    const { income, expenses, interest, oneOffCost, profit } = frame;
    near(frame.netWorth - netWorth, income - expenses - interest - oneOffCost + profit);
    netWorth = frame.netWorth;
  }
  near(result.summary.totalProfit, result.summary.endAssets - 1000);
});

test('a cash shortfall leaves the entire failed month uncommitted even with available assets', () => {
  const result = simulateFinances({
    ...opening, debt: 50, debtAPR: 0.24, monthlyPrincipal: 20,
    schedule: [{ ...month, income: 10, expenses: 20 }, { ...month, income: 5, expenses: 160, oneOffCost: 12 }, month],
    returns: [0, -1, 1],
  });
  assert.equal(result.complete, false);
  assert.equal(result.failure.month, 2);
  near(result.failure.shortfall, 18.6);
  assert.deepEqual(result.frames, [
    { ...month, month: 1, income: 10, expenses: 20, interest: 1, principal: 20, profit: 0, cash: 169, assets: 500, debt: 30, netWorth: 639 },
  ]);
  assert.deepEqual(result.summary, {
    endCash: null, endAssets: null, endDebt: null, endNetWorth: null,
    minimumCash: 169, firstReserveBreach: null,
    totalIncome: 10, totalExpenses: 20, totalInterest: 1, totalPrincipal: 20, totalOneOffCost: 0, totalProfit: 0,
  });
});

test('reserve breaches include opening month zero and exclude balances equal to reserve', () => {
  const alreadyBelow = simulateFinances({ ...opening, cash: 99, schedule: [{ ...month, income: 1 }], returns: [0] });
  assert.equal(alreadyBelow.summary.firstReserveBreach, 0);
  assert.equal(alreadyBelow.summary.minimumCash, 99);
  const dipsBelow = simulateFinances({
    ...opening, schedule: [{ ...month, expenses: 100 }, { ...month, expenses: 100 }], returns: [0, 0],
  });
  assert.equal(dipsBelow.complete, true);
  assert.equal(dipsBelow.summary.firstReserveBreach, 2);
  assert.equal(dipsBelow.summary.minimumCash, 0);
});

test('floating-point noise is not a cash shortfall or an otherwise exact reserve breach', () => {
  const result = simulateFinances({
    ...opening, cash: 0.3, reserveCash: 0.2, schedule: [{ ...month, expenses: 0.1 }], returns: [0],
  });
  assert.equal(result.summary.firstReserveBreach, null);
  const exactSpend = simulateFinances({
    ...opening, cash: 0.3, schedule: [{ ...month, expenses: 0.1 }, { ...month, expenses: 0.2 }], returns: [0, 0],
  });
  assert.equal(exactSpend.complete, true);
  assert.equal(exactSpend.summary.endCash, 0);
  const subCentShortfall = simulateFinances({
    ...opening, cash: 0.3, schedule: [{ ...month, expenses: 0.301 }], returns: [0],
  });
  assert.equal(subCentShortfall.complete, false);
  near(subCentShortfall.failure.shortfall, 0.001);
});

test('simulation rejects invalid amounts, paths or periods before computing any prefix', () => {
  const valid = { ...opening, schedule: [month], returns: [0] };
  for (const invalid of [
    { cash: '200' }, { assets: 1e9 + 1 }, { debt: Infinity }, { debtAPR: 1.1 },
    { monthlyPrincipal: -1 }, { reserveCash: NaN }, { schedule: [] }, { schedule: [null] },
    { schedule: Array(1) }, { schedule: [{ ...month, income: 1e9 + 1 }] },
    { schedule: [{ ...month, oneOffCost: -5 }] }, { returns: [] }, { returns: Array(1) },
    { returns: [Infinity] }, { returns: [-1.1] }, { returns: [1.1] },
    { schedule: Array(25).fill(month), returns: Array(25).fill(0) },
    { schedule: [{ ...month, expenses: 1000 }, { ...month, expenses: NaN }], returns: [0, 0] },
  ]) assert.throws(() => simulateFinances({ ...valid, ...invalid }));
});
