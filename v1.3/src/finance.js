const MAX_AMOUNT = 1e9;
const MAX_MONTHS = 24;

function financeRange(name, value, min, max, integer = false) {
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new RangeError(`${name} must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}`);
  }
}

function financeAmount(name, value) {
  financeRange(name, value, 0, MAX_AMOUNT);
}

export function calculateMonthlyIncome({ mode, fixedMonthly, hourlyRate, paidHoursWeek, pieceRate, unitsMonth }) {
  financeAmount('fixedMonthly', fixedMonthly);
  financeAmount('hourlyRate', hourlyRate);
  financeRange('paidHoursWeek', paidHoursWeek, 0, 168);
  financeAmount('pieceRate', pieceRate);
  financeAmount('unitsMonth', unitsMonth);
  if (!['fixed', 'hourly', 'piece', 'mixed'].includes(mode)) throw new RangeError('Invalid income mode');

  const fixed = mode === 'fixed' || mode === 'mixed' ? fixedMonthly : 0;
  const hourly = mode === 'hourly' || mode === 'mixed' ? hourlyRate * paidHoursWeek * 52 / 12 : 0;
  const piece = mode === 'piece' || mode === 'mixed' ? pieceRate * unitsMonth : 0;
  const monthly = fixed + hourly + piece;
  financeAmount('monthly income', monthly);
  return monthly;
}

export function marketReturns({ months, annualReturn, shockMonth, shockReturn }) {
  financeRange('months', months, 1, MAX_MONTHS, true);
  financeRange('annualReturn', annualReturn, -1, 1);
  financeRange('shockMonth', shockMonth, 1, months, true);
  financeRange('shockReturn', shockReturn, -1, 0);

  const monthlyLogReturn = Math.log1p(annualReturn) / 12;
  const returns = Array(months).fill(Math.expm1(monthlyLogReturn));
  returns[shockMonth - 1] = Math.expm1(monthlyLogReturn + Math.log1p(shockReturn));
  return returns;
}

export function simulateFinances({ cash, assets, debt, debtAPR, monthlyPrincipal, reserveCash, schedule, returns }) {
  financeAmount('cash', cash);
  financeAmount('assets', assets);
  financeAmount('debt', debt);
  financeRange('debtAPR', debtAPR, 0, 1);
  financeAmount('monthlyPrincipal', monthlyPrincipal);
  financeAmount('reserveCash', reserveCash);
  if (!Array.isArray(schedule) || !Array.isArray(returns) || returns.length !== schedule.length) {
    throw new TypeError('schedule and returns must be arrays with the same length');
  }
  financeRange('months', schedule.length, 1, MAX_MONTHS, true);
  for (const { income, expenses, oneOffCost } of schedule) {
    financeAmount('income', income);
    financeAmount('expenses', expenses);
    financeAmount('oneOffCost', oneOffCost);
  }
  for (const rate of returns) financeRange('monthly return', rate, -1, 1);

  const frames = [];
  let failure = null;
  let cashRoundoff = 0;
  const summary = {
    endCash: null, endAssets: null, endDebt: null, endNetWorth: null,
    minimumCash: cash,
    firstReserveBreach: cash < reserveCash ? 0 : null,
    totalIncome: 0, totalExpenses: 0, totalInterest: 0, totalPrincipal: 0, totalOneOffCost: 0, totalProfit: 0,
  };

  for (let i = 0; i < schedule.length; i++) {
    const month = i + 1;
    const { income, expenses, oneOffCost } = schedule[i];
    const interest = debt * debtAPR / 12;
    const principal = Math.min(debt, monthlyPrincipal);
    const nextCash = cash + income - expenses - oneOffCost - interest - principal;
    // Decimal inputs and their monthly sums can miss exact equality by a few ulps.
    cashRoundoff += 4 * Number.EPSILON * Math.max(cash, income, expenses, oneOffCost, interest, principal);
    if (nextCash < -cashRoundoff) {
      failure = { month, shortfall: -nextCash };
      break;
    }

    const profit = assets * returns[i];
    cash = Math.max(0, nextCash);
    assets += profit;
    debt -= principal;
    frames.push({ month, income, expenses, oneOffCost, interest, principal, profit, cash, assets, debt, netWorth: cash + assets - debt });
    summary.minimumCash = Math.min(summary.minimumCash, cash);
    if (summary.firstReserveBreach === null && reserveCash - cash > cashRoundoff) summary.firstReserveBreach = month;
    summary.totalIncome += income;
    summary.totalExpenses += expenses;
    summary.totalInterest += interest;
    summary.totalPrincipal += principal;
    summary.totalOneOffCost += oneOffCost;
    summary.totalProfit += profit;
  }

  if (!failure) {
    Object.assign(summary, { endCash: cash, endAssets: assets, endDebt: debt, endNetWorth: cash + assets - debt });
  }
  return { complete: failure === null, frames, failure, summary };
}
