// Generated from v1.3/src.
(()=>{
'use strict';
const __modules=Object.create(null);
__modules["finance"]=(()=>{
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

function calculateMonthlyIncome({ mode, fixedMonthly, hourlyRate, paidHoursWeek, pieceRate, unitsMonth }) {
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

function marketReturns({ months, annualReturn, shockMonth, shockReturn }) {
  financeRange('months', months, 1, MAX_MONTHS, true);
  financeRange('annualReturn', annualReturn, -1, 1);
  financeRange('shockMonth', shockMonth, 1, months, true);
  financeRange('shockReturn', shockReturn, -1, 0);

  const monthlyLogReturn = Math.log1p(annualReturn) / 12;
  const returns = Array(months).fill(Math.expm1(monthlyLogReturn));
  returns[shockMonth - 1] = Math.expm1(monthlyLogReturn + Math.log1p(shockReturn));
  return returns;
}

function simulateFinances({ cash, assets, debt, debtAPR, monthlyPrincipal, reserveCash, schedule, returns }) {
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

return {calculateMonthlyIncome,marketReturns,simulateFinances};
})();
__modules["decision"]=(()=>{
const {calculateMonthlyIncome, marketReturns, simulateFinances }=__modules["finance"];

const DECISION_FORMAT = 'financial-human-work-decision-v1.3';
const DECISION_RECORD_FORMAT = 'financial-human-work-decision-record-v1.3';
const DECISION_WORKSPACE_FORMAT = 'financial-human-workspace-v1.3';
const DECISION_AMOUNT_MAX = 1e9;
const DECISION_TEXT_MAX = 2000;
const DECISION_SOURCE_NOTE_MAX = 1000;
const DECISION_SOURCE_LABELS = {
  'profile.cash': '现状：现金', 'profile.assets': '现状：投资资产', 'profile.debt': '现状：债务',
  'profile.debtAPR': '现状：债务年利率', 'profile.monthlyPrincipal': '现状：每月计划还本',
  'profile.reserveCash': '现状：现金底线', 'profile.income': '现状：税后收入',
  'profile.expenses': '现状：月支出', 'profile.time': '现状：每周时间',
  'change.income': '改变：税后收入', 'change.expenses': '改变：月支出',
  'change.time': '改变：每周时间', 'change.oneOffCost': '改变：一次性费用',
  'assumptions.annualReturn': '假设：市场年回报', 'assumptions.shockMonth': '假设：下跌月份',
  'assumptions.shockReturn': '假设：额外市场下跌',
};
const DECISION_SOURCE_KINDS = { record: '记录', estimate: '估计', assumption: '假设', unknown: '未知' };
const DECISION_CHOICES = { undecided: '待决定', baseline: '保持现状', changed: '改变工作安排' };
const DECISION_INCOME_MODES = { fixed: '固定', hourly: '按小时', piece: '计件', mixed: '混合' };
const DECISION_TIME_LABELS = { work: '工作', commute: '通勤', care: '照护', sleep: '睡眠', learn: '学习', other: '其他' };
const DECISION_LIFE_LABELS = { body: '身体', cognition: '认知', emotion: '情绪', relations: '关系', values: '价值' };

function freezeDecisionData(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeDecisionData);
    Object.freeze(value);
  }
  return value;
}

const decisionEmptyIncome = { mode: 'fixed', fixedMonthly: 0, hourlyRate: 0, paidHoursWeek: 0, pieceRate: 0, unitsMonth: 0 };
const decisionEmptyTime = { work: 0, commute: 0, care: 0, sleep: 0, learn: 0, other: 0 };

const DEFAULT_DECISION = freezeDecisionData({
  format: DECISION_FORMAT,
  title: '',
  startDate: '',
  months: 12,
  profile: {
    cash: 0, assets: 0, debt: 0, debtAPR: 0, monthlyPrincipal: 0, reserveCash: 0,
    income: { ...decisionEmptyIncome }, expenses: 0, time: { ...decisionEmptyTime },
  },
  change: {
    name: '改变工作安排', startMonth: 1, durationMonths: 12,
    income: { ...decisionEmptyIncome }, expenses: 0, time: { ...decisionEmptyTime }, oneOffCost: 0,
  },
  assumptions: { annualReturn: 0, shockMonth: 1, shockReturn: -0.2 },
  limits: { minSleep: 0, maxWork: 168 },
  life: { body: '', cognition: '', emotion: '', relations: '', values: '' },
  sources: Object.fromEntries(Object.keys(DECISION_SOURCE_LABELS).map(key => [key, {
    kind: key.startsWith('assumptions.') ? 'assumption' : 'unknown', date: '', note: '',
  }])),
  action: { choice: 'undecided', reason: '', conditions: '', reviewDate: '' },
});

function isDecisionObject(value) {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasDecisionKeys(value, keys) {
  return isDecisionObject(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function validDecisionText(value, length, required = false) {
  return typeof value === 'string' && value.length <= length && (!required || value.trim().length > 0);
}

function validDecisionDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(+date) && date.toISOString().slice(0, 10) === value;
}

function validDecisionCreatedAt(value) {
  if (validDecisionDate(value)) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !validDecisionDate(value.slice(0, 10))) return false;
  const date = new Date(value);
  return !Number.isNaN(+date) && date.toISOString() === value;
}

function decisionInRange(value, min, max) {
  return Number.isFinite(value) && value >= min && value <= max;
}

function decisionMonth(value, max) {
  return Number.isInteger(max) && Number.isInteger(value) && decisionInRange(value, 1, max);
}

function decisionTotalTime(time) {
  return Object.values(time).reduce((total, hours) => total + hours, 0);
}

function validateDecision(value) {
  if (!hasDecisionKeys(value, Object.keys(DEFAULT_DECISION)) || value.format !== DECISION_FORMAT) return ['不是有效的 1.3 工作安排决策。'];
  const errors = [];
  const check = (valid, message) => { if (!valid) errors.push(message); };
  const checkAmount = (amount, label) => check(decisionInRange(amount, 0, DECISION_AMOUNT_MAX), `${label}须为 0 至 10 亿之间的数字。`);
  const checkHours = (hours, label) => check(decisionInRange(hours, 0, 168), `${label}须为 0 至 168 小时。`);
  const { title, startDate, months, profile, change, assumptions, limits, life, sources, action } = value;
  const validStartDate = validDecisionDate(startDate);
  check(validDecisionText(title, 200, true), '请填写决策标题，最多 200 字。');
  check(validStartDate, '请填写有效的开始日期（YYYY-MM-DD）。');
  check([6, 12, 24].includes(months), '比较周期只能是 6、12 或 24 个月。');

  for (const [plan, example, label] of [[profile, DEFAULT_DECISION.profile, '现状'], [change, DEFAULT_DECISION.change, '改变方案']]) {
    if (!hasDecisionKeys(plan, Object.keys(example))) {
      errors.push(`${label}资料不完整或含有未支持的字段。`);
      continue;
    }
    if (plan === profile) {
      for (const [key, name] of [['cash', '现金'], ['assets', '投资资产'], ['debt', '债务'], ['monthlyPrincipal', '每月计划还本'], ['reserveCash', '现金底线']]) checkAmount(plan[key], `现状${name}`);
      check(decisionInRange(plan.debtAPR, 0, 1), '债务年利率须为 0% 至 100%。');
    } else {
      check(validDecisionText(plan.name, 200, true), '请填写改变方案名称，最多 200 字。');
      const validStart = decisionMonth(plan.startMonth, months);
      check(validStart, '改变开始月份须在比较周期内。');
      check(validStart && decisionMonth(plan.durationMonths, months - plan.startMonth + 1), '改变持续月份须使整个改变方案落在比较周期内。');
      checkAmount(plan.oneOffCost, '改变方案一次性费用');
    }
    checkAmount(plan.expenses, `${label}月支出`);
    const validTime = hasDecisionKeys(plan.time, Object.keys(decisionEmptyTime));
    check(validTime, `${label}每周时间资料不完整。`);
    if (validTime) {
      for (const [key, name] of Object.entries(DECISION_TIME_LABELS)) checkHours(plan.time[key], `${label}${name}时间`);
      if (Object.values(plan.time).every(hours => decisionInRange(hours, 0, 168))) check(decisionTotalTime(plan.time) <= 168, `${label}时间总和不得超过每周 168 小时。`);
    }
    if (!hasDecisionKeys(plan.income, Object.keys(decisionEmptyIncome))) {
      errors.push(`${label}税后收入资料不完整。`);
    } else {
      const { mode, paidHoursWeek } = plan.income;
      const before = errors.length;
      check(typeof mode === 'string' && Object.hasOwn(DECISION_INCOME_MODES, mode), `${label}收入类型无效。`);
      for (const [key, name] of [['fixedMonthly', '固定月收入'], ['hourlyRate', '时薪'], ['pieceRate', '单件收入'], ['unitsMonth', '月件数']]) checkAmount(plan.income[key], `${label}${name}`);
      checkHours(paidHoursWeek, `${label}每周付费工时`);
      if (validTime && (mode === 'hourly' || mode === 'mixed') && decisionInRange(plan.time.work, 0, 168)) {
        check(paidHoursWeek <= plan.time.work, `${label}每周付费工时不能超过每周工作时间。`);
      }
      if (errors.length === before) {
        try { calculateMonthlyIncome(plan.income); } catch { errors.push(`${label}计算所得月收入不得超过 10 亿。`); }
      }
    }
  }

  if (!hasDecisionKeys(assumptions, Object.keys(DEFAULT_DECISION.assumptions))) {
    errors.push('市场假设资料不完整。');
  } else {
    check(decisionInRange(assumptions.annualReturn, -1, 1), '市场年回报须为 −100% 至 100%。');
    check(decisionMonth(assumptions.shockMonth, months), '下跌月份须在比较周期内。');
    check(decisionInRange(assumptions.shockReturn, -1, 0), '市场额外下跌幅度须为 −100% 至 0%。');
  }
  if (!hasDecisionKeys(limits, Object.keys(DEFAULT_DECISION.limits))) {
    errors.push('时间底线资料不完整。');
  } else {
    checkHours(limits.minSleep, '每周最低睡眠时间');
    checkHours(limits.maxWork, '每周最高工作时间');
  }
  if (!hasDecisionKeys(life, Object.keys(DEFAULT_DECISION.life))) {
    errors.push('生活取舍记录格式无效。');
  } else {
    for (const [key, label] of Object.entries(DECISION_LIFE_LABELS)) check(validDecisionText(life[key], DECISION_TEXT_MAX), `${label}观察须为不超过 ${DECISION_TEXT_MAX} 字的文本。`);
  }
  if (!hasDecisionKeys(sources, Object.keys(DECISION_SOURCE_LABELS))) {
    errors.push('来源记录资料不完整或含有未支持的字段。');
  } else {
    for (const [key, source] of Object.entries(sources)) {
      const label = DECISION_SOURCE_LABELS[key];
      if (!hasDecisionKeys(source, ['kind', 'date', 'note'])) {
        errors.push(`${label}的来源格式无效。`);
        continue;
      }
      check(typeof source.kind === 'string' && Object.hasOwn(DECISION_SOURCE_KINDS, source.kind), `${label}的来源类型无效。`);
      check(source.date === '' || validDecisionDate(source.date), `${label}的来源日期无效。`);
      check(validDecisionText(source.note, DECISION_SOURCE_NOTE_MAX), `${label}的来源说明须为不超过 ${DECISION_SOURCE_NOTE_MAX} 字的文本。`);
    }
  }
  if (!hasDecisionKeys(action, Object.keys(DEFAULT_DECISION.action))) {
    errors.push('行动计划格式无效。');
  } else {
    check(typeof action.choice === 'string' && Object.hasOwn(DECISION_CHOICES, action.choice), '行动选择无效。');
    check(validDecisionText(action.reason, DECISION_TEXT_MAX), `行动理由须为不超过 ${DECISION_TEXT_MAX} 字的文本。`);
    check(validDecisionText(action.conditions, DECISION_TEXT_MAX), `改变或退出条件须为不超过 ${DECISION_TEXT_MAX} 字的文本。`);
    if (action.reviewDate !== '') {
      const validReviewDate = validDecisionDate(action.reviewDate);
      check(validReviewDate, '计划复盘日期无效。');
      if (validReviewDate && validStartDate) check(action.reviewDate >= startDate, '计划复盘日期不得早于决策开始日期。');
    }
  }
  return errors;
}

function assertValidDecision(value) {
  const errors = validateDecision(value);
  if (errors.length) throw new Error(errors.join('\n'));
}

function decisionDisplayNumber(value) {
  return value === null ? '—' : String(Number(value.toPrecision(12)));
}

function decisionConditions(label, result, reserveCash, time, limits, timePeriod = '') {
  const breach = result.summary.firstReserveBreach;
  const money = decisionDisplayNumber;
  const conditions = [breach === null
    ? `${label}：${result.complete ? '全程' : '期初及已完成月份'}未低于现金底线 ${money(reserveCash)}。`
    : `${label}：${breach === 0 ? '期初' : `第 ${breach} 个月`}低于现金底线 ${money(reserveCash)}。`];
  if (result.failure) conditions.push(`${label}：第 ${result.failure.month} 个月现金不足，缺口 ${money(result.failure.shortfall)}；财务路径在该月停止。`);
  conditions.push(
    `${label}：${timePeriod}每周睡眠 ${money(time.sleep)} 小时，${time.sleep < limits.minSleep ? '低于' : '达到'}最低 ${money(limits.minSleep)} 小时。`,
    `${label}：${timePeriod}每周工作 ${money(time.work)} 小时，${time.work > limits.maxWork ? '超过' : '未超过'}上限 ${money(limits.maxWork)} 小时。`,
  );
  return conditions;
}

function computeDecision(value, stress) {
  const { months, profile, change, assumptions, limits } = value;
  const current = { income: calculateMonthlyIncome(profile.income), expenses: profile.expenses, oneOffCost: 0 };
  const revised = { income: calculateMonthlyIncome(change.income), expenses: change.expenses, oneOffCost: 0 };
  const returns = marketReturns({ ...assumptions, months, shockReturn: stress ? assumptions.shockReturn : 0 });
  const baseline = simulateFinances({ ...profile, returns, schedule: Array(months).fill(current) });
  const schedule = Array.from({ length: months }, (_, index) => {
    const elapsed = index + 1 - change.startMonth;
    if (elapsed < 0 || elapsed >= change.durationMonths) return current;
    return elapsed === 0 ? { ...revised, oneOffCost: change.oneOffCost } : revised;
  });
  const changed = simulateFinances({ ...profile, returns, schedule });
  const timeDelta = {
    work: profile.time.work + profile.time.commute - (change.time.work + change.time.commute),
    sleep: change.time.sleep - profile.time.sleep,
    unallocated: decisionTotalTime(profile.time) - decisionTotalTime(change.time),
  };
  const conditions = [
    ...decisionConditions('保持现状', baseline, profile.reserveCash, profile.time, limits),
    ...decisionConditions('改变安排', changed, profile.reserveCash, change.time, limits, '生效期间'),
  ];
  return { baseline, changed, timeDelta, conditions };
}

function compareDecision(value, stress = false) {
  assertValidDecision(value);
  if (typeof stress !== 'boolean') throw new Error('市场下跌情景必须明确开启或关闭。');
  return computeDecision(value, stress);
}

function decisionSnapshots(value) {
  return { base: computeDecision(value, false), stress: computeDecision(value, true) };
}

function createRecord(decision, { id, createdAt } = {}) {
  assertValidDecision(decision);
  if (!validDecisionText(id, 128, true) || !validDecisionCreatedAt(createdAt)) throw new Error('决策记录的编号或创建时间无效。');
  return freezeDecisionData({
    format: DECISION_RECORD_FORMAT, id, createdAt, decision: structuredClone(decision),
    results: decisionSnapshots(decision), reviews: [],
  });
}

function validDecisionReview(review, startDate) {
  return hasDecisionKeys(review, ['date', 'actualIncome', 'actualExpenses', 'note', 'nextStep'])
    && validDecisionDate(review.date) && review.date >= startDate
    && [review.actualIncome, review.actualExpenses].every(amount => amount === null || decisionInRange(amount, 0, DECISION_AMOUNT_MAX))
    && validDecisionText(review.note, DECISION_TEXT_MAX)
    && validDecisionText(review.nextStep, DECISION_TEXT_MAX);
}

function sameDecisionData(value, expected) {
  if (value === expected) return true;
  if (Array.isArray(expected)) {
    return Array.isArray(value) && value.length === expected.length && Object.keys(value).length === expected.length
      && expected.every((item, index) => Object.hasOwn(value, index) && sameDecisionData(value[index], item));
  }
  if (!isDecisionObject(expected)) return false;
  const keys = Object.keys(expected);
  return hasDecisionKeys(value, keys) && keys.every(key => sameDecisionData(value[key], expected[key]));
}

function assertDecisionRecord(record) {
  if (!hasDecisionKeys(record, ['format', 'id', 'createdAt', 'decision', 'results', 'reviews']) || record.format !== DECISION_RECORD_FORMAT
      || !validDecisionText(record.id, 128, true) || !validDecisionCreatedAt(record.createdAt)) throw new Error('决策记录格式、编号或创建时间无效。');
  assertValidDecision(record.decision);
  if (!Array.isArray(record.reviews) || record.reviews.length > 50 || Object.keys(record.reviews).length !== record.reviews.length
      || !Array.from(record.reviews).every(review => validDecisionReview(review, record.decision.startDate))) throw new Error('决策复盘格式无效，或超过 50 条。');
  if (!sameDecisionData(record.results, decisionSnapshots(record.decision))) throw new Error('决策记录的计算快照与输入不一致。');
}

function appendReview(record, review) {
  assertDecisionRecord(record);
  if (record.reviews.length === 50) throw new Error('每条决策最多保存 50 条复盘。');
  if (!validDecisionReview(review, record.decision.startDate)) throw new Error('请检查实际收支和文字长度；复盘日期不得早于决策开始日期。');
  return freezeDecisionData(structuredClone({ ...record, reviews: [...record.reviews, review] }));
}

function makeWorkspace(decision, records) {
  return decodeWorkspace({ format: DECISION_WORKSPACE_FORMAT, decision, records });
}

function decodeWorkspace(value) {
  if (!hasDecisionKeys(value, ['format', 'decision', 'records']) || value.format !== DECISION_WORKSPACE_FORMAT) throw new Error('不是 1.3 工作安排工作区；旧版文件不会自动转换。');
  assertValidDecision(value.decision);
  if (!Array.isArray(value.records) || value.records.length > 100 || Object.keys(value.records).length !== value.records.length) throw new Error('工作区的决策记录格式无效，或超过 100 条。');
  const ids = new Set();
  for (const record of value.records) {
    assertDecisionRecord(record);
    if (ids.has(record.id)) throw new Error('工作区含重复的决策记录编号。');
    ids.add(record.id);
  }
  const copy = structuredClone(value);
  copy.records.forEach(freezeDecisionData);
  return copy;
}

function escapeDecisionHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function decisionReportTable(headings, rows) {
  const escape = escapeDecisionHtml;
  return `<table><thead><tr>${headings.map(heading => `<th scope="col">${escape(heading)}</th>`).join('')}</tr></thead><tbody>${rows.map(([label, ...values]) =>
    `<tr><th scope="row">${escape(label)}</th>${values.map(value => `<td>${escape(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function decisionReportScenario(label, result, months, changeName) {
  const number = decisionDisplayNumber;
  const summaries = [result.baseline.summary, result.changed.summary];
  const fields = [
    ['期末现金', 'endCash'], ['期末投资资产', 'endAssets'], ['期末债务', 'endDebt'], ['期末净财富', 'endNetWorth'],
    ['最低现金（含期初）', 'minimumCash'], ['累计税后收入', 'totalIncome'], ['累计支出', 'totalExpenses'],
    ['累计利息', 'totalInterest'], ['累计还本', 'totalPrincipal'], ['累计一次性费用', 'totalOneOffCost'],
    ['累计投资损益', 'totalProfit'],
  ];
  const status = [result.baseline, result.changed].map(path => path.complete ? `完成 ${months} 个月` : `第 ${path.failure.month} 个月停止，现金缺口 ${number(path.failure.shortfall)}`);
  return `<section><h2>${label}</h2>${decisionReportTable(['财务指标', '保持现状', changeName], [
    ['路径状态', ...status],
    ...fields.map(([name, key]) => [name, ...summaries.map(summary => number(summary[key]))]),
  ])}<ul>${result.conditions.map(condition => `<li>${escapeDecisionHtml(condition)}</li>`).join('')}</ul></section>`;
}

function decisionReportExcerpt(value, limit) {
  const chars = Array.from(value.trim().replace(/\s+/g, ' '));
  return chars.length <= limit ? chars.join('') : `${chars.slice(0, limit).join('')}…`;
}

function decisionReportSummary({ decision, results, reviews }) {
  const { change, assumptions, limits, life, sources, action } = decision;
  const escape = escapeDecisionHtml;
  const number = decisionDisplayNumber;
  const excerpt = decisionReportExcerpt;
  const percent = rate => `${number(rate * 100)}%`;
  const describe = ({ failure, summary }) => {
    if (failure) return `第 ${failure.month} 个月停止，现金缺口 ${number(failure.shortfall)}`;
    const breach = summary.firstReserveBreach;
    const reserve = breach === null ? '' : `；${breach === 0 ? '期初' : `第 ${breach} 月`}低于现金底线`;
    return `期末现金 ${number(summary.endCash)}，净财富 ${number(summary.endNetWorth)}${reserve}`;
  };
  const observations = Object.entries(DECISION_LIFE_LABELS).flatMap(([key, label]) => life[key].trim() ? [`${label}：${excerpt(life[key], 36)}`] : []);
  const sourced = Object.entries(DECISION_SOURCE_LABELS).filter(([key]) => {
    const { kind, date, note } = sources[key];
    return kind !== 'unknown' || date || note.trim();
  });
  const provenance = sourced.slice(0, 3).map(([key, label]) => {
    const { kind, date, note } = sources[key];
    return [label, DECISION_SOURCE_KINDS[kind], date, excerpt(note, 28)].filter(Boolean).join(' · ');
  });
  if (sourced.length > 3) provenance.push(`另有 ${sourced.length - 3} 项，见完整报告`);
  const review = reviews.at(-1);
  const time = results.base.timeDelta;
  return `<section class="report-summary" aria-labelledby="summary-heading"><h2 id="summary-heading">一页摘要</h2>
<p><strong>改变方案：</strong>${escape(excerpt(change.name, 60))}，从第 ${change.startMonth} 个月起持续 ${change.durationMonths} 个月。现金底线 ${number(decision.profile.reserveCash)}。</p>
${decisionReportTable(['市场情景', '保持现状', '改变安排'], [
    ['基础情景', describe(results.base.baseline), describe(results.base.changed)],
    ['市场下跌情景', describe(results.stress.baseline), describe(results.stress.changed)],
  ])}
<p><strong>情景假设：</strong>市场年回报 ${percent(assumptions.annualReturn)}；下跌情景在第 ${assumptions.shockMonth} 月额外变动 ${percent(assumptions.shockReturn)}。两方案使用同一市场路径。</p>
<p><strong>每周时间：</strong>改变生效期间，工作与通勤减少 ${number(time.work)} 小时，睡眠变化 ${number(time.sleep)} 小时，未分配时间变化 ${number(time.unallocated)} 小时（负数表示反向变化）。最低睡眠 ${number(limits.minSleep)} 小时，最高工作 ${number(limits.maxWork)} 小时。</p>
<p><strong>生活取舍：</strong>${escape(observations.join('；') || '未记录')}</p>
<p><strong>行动：</strong>${DECISION_CHOICES[action.choice]}${action.reason.trim() ? `；理由：${escape(excerpt(action.reason, 70))}` : ''}${action.conditions.trim() ? `；改变或退出条件：${escape(excerpt(action.conditions, 70))}` : ''}${action.reviewDate ? `；计划复盘：${escape(action.reviewDate)}` : ''}。</p>
${review ? `<p><strong>最近追加复盘：</strong>${escape([review.date, excerpt(review.note, 50), excerpt(review.nextStep, 50)].filter(Boolean).join(' · '))}</p>` : ''}
<p><strong>输入来源：</strong>${escape(provenance.join('；') || '未记录')}；${Object.values(sources).filter(source=>source.kind==='unknown').length} 项来源未知。</p>
<p><small>打印仅包含本摘要。情景用于比较，不代表预测或自动建议；现金不足时不自动卖出投资或借款。</small></p>
</section>`;
}

function renderReport(record) {
  assertDecisionRecord(record);
  const { decision, results, createdAt, reviews } = record;
  const { title, startDate, months, profile, change, assumptions, limits, life, sources, action } = decision;
  const escape = escapeDecisionHtml;
  const number = decisionDisplayNumber;
  const percent = rate => `${number(rate * 100)}%`;
  const plans = [profile, change];
  const incomeFields = [
    ['固定月收入', 'fixedMonthly', 'fixed'], ['时薪', 'hourlyRate', 'hourly'], ['每周付费工时', 'paidHoursWeek', 'hourly'],
    ['单件收入', 'pieceRate', 'piece'], ['每月件数', 'unitsMonth', 'piece'],
  ];
  const inputRows = [
    ['方案生效', `全程作为基线；改变方案未生效时沿用`, `第 ${change.startMonth} 个月起，持续 ${change.durationMonths} 个月`],
    ['收入类型', ...plans.map(plan => DECISION_INCOME_MODES[plan.income.mode])],
    ...incomeFields.map(([label, key, mode]) => [label, ...plans.map(({ income }) =>
      income.mode === mode || income.mode === 'mixed' ? number(income[key]) : '不适用')]),
    ['月税后收入', ...plans.map(plan => number(calculateMonthlyIncome(plan.income)))],
    ['月支出', ...plans.map(plan => number(plan.expenses))],
    ['一次性费用', '0', number(change.oneOffCost)],
    ...Object.entries(DECISION_TIME_LABELS).map(([key, label]) => [`${label}（小时/周）`, ...plans.map(plan => number(plan.time[key]))]),
    ['未分配（小时/周）', ...plans.map(plan => number(168 - decisionTotalTime(plan.time)))],
  ];
  const sourceRows = Object.entries(DECISION_SOURCE_LABELS).map(([key, label]) => {
    const source = sources[key];
    return [label, DECISION_SOURCE_KINDS[source.kind], source.date || '—', source.note || '—'];
  });
  const reviewRows = reviews.map(review => [review.date, number(review.actualIncome), number(review.actualExpenses), review.note || '—', review.nextStep || '—']);
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${escape(title)}｜金融学人 1.3</title>
<style>body{font:16px/1.6 system-ui,sans-serif;color:#1d2825;background:#fff;max-width:70rem;margin:auto;padding:1.5rem}h1,h2{line-height:1.2;overflow-wrap:anywhere}section{margin:2rem 0}table{width:100%;border-collapse:collapse;margin:1rem 0}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #cbd5cf;padding:.4rem .6rem;overflow-wrap:anywhere;white-space:pre-wrap}thead{background:#edf3ed}p,li,dd{overflow-wrap:anywhere}dd{white-space:pre-wrap;margin-bottom:.5rem}.scenarios{display:grid;gap:1.5rem;grid-template-columns:repeat(auto-fit,minmax(min(100%,26rem),1fr))}small{color:#43524b}.report-appendix{border-top:1px solid #cbd5cf;padding-top:1rem}.report-appendix>summary{cursor:pointer;font-weight:bold}
@page{size:A4;margin:14mm}
@media print{.report-appendix{display:none!important}body{font-size:10pt;line-height:1.45;margin:0;padding:0;max-width:none}h1{font-size:16pt;margin:.25rem 0}h2{font-size:12pt;margin:.8rem 0 .3rem}p{margin:.35rem 0}table{table-layout:fixed;margin:.4rem 0}th,td{padding:.25rem .4rem}.report-summary{break-inside:avoid;margin:0}}</style></head>
<body><header><p>金融学人 1.3｜工作安排决策报告 · 金额单位：税后人民币（元）</p><h1>${escape(title)}</h1><p>开始日期：${escape(startDate)} · 比较周期：${months} 个月 · 记录日期：${escape(createdAt)}</p></header>
${decisionReportSummary(record)}
<details class="report-appendix"><summary>查看完整输入、计算与复盘</summary>
<section><h2>现状与改变方案</h2><p>期初现金 ${number(profile.cash)}，投资资产 ${number(profile.assets)}，债务 ${number(profile.debt)}。债务年利率 ${percent(profile.debtAPR)}，每月计划还本 ${number(profile.monthlyPrincipal)}，现金底线 ${number(profile.reserveCash)}。</p>
${decisionReportTable(['输入', '保持现状', change.name], inputRows)}</section>
<section><h2>市场假设与时间底线</h2><p>两种方案采用同一市场路径：假设市场年回报 ${percent(assumptions.annualReturn)}；下跌情景在第 ${assumptions.shockMonth} 个月额外变动 ${percent(assumptions.shockReturn)}。每周睡眠最低 ${number(limits.minSleep)} 小时，工作最高 ${number(limits.maxWork)} 小时。</p>
<p>改变生效期间，每周工作与通勤减少 ${number(results.base.timeDelta.work)} 小时，睡眠变化 ${number(results.base.timeDelta.sleep)} 小时，未分配时间变化 ${number(results.base.timeDelta.unallocated)} 小时。负数表示反向变化。</p></section>
<div class="scenarios">${decisionReportScenario('基础情景', results.base, months, change.name)}${decisionReportScenario('市场下跌情景', results.stress, months, change.name)}</div>
<p><small>现金不足时不自动变卖投资或借款，不显示全期结束值；累计数据仅计入有效月份。两种情景都是假设比较，不代表预测或自动建议。</small></p>
<section><h2>生活观察与取舍</h2><dl>${Object.entries(DECISION_LIFE_LABELS).map(([key, label]) => `<dt>${label}</dt><dd>${escape(life[key] || '未记录')}</dd>`).join('')}</dl></section>
<section><h2>行动与复盘</h2>${decisionReportTable(['行动', '记录'], [
    ['选择', DECISION_CHOICES[action.choice]], ['理由', action.reason || '—'],
    ['改变或退出条件', action.conditions || '—'], ['计划复盘日期', action.reviewDate || '—'],
  ])}${reviews.length ? decisionReportTable(['复盘日期', '实际收入', '实际支出', '观察', '下一步'], reviewRows) : '<p>尚未追加复盘。</p>'}</section>
<section><h2>输入来源</h2>${decisionReportTable(['字段', '来源类型', '日期', '说明'], sourceRows)}</section>
</details></body></html>`;
}

return {DEFAULT_DECISION,validateDecision,compareDecision,createRecord,appendReview,makeWorkspace,decodeWorkspace,renderReport};
})();
__modules["app"]=(()=>{
const {DEFAULT_DECISION, validateDecision, compareDecision, createRecord, appendReview, renderReport, makeWorkspace, decodeWorkspace }=__modules["decision"];

const KEY='financial-human-workspace-v1.3',LOCAL_FORMAT='financial-human-local-state-v1.3',MAX_BACKUP_BYTES=128*1024*1024;
const $=id=>document.querySelector('#'+id),clone=value=>JSON.parse(JSON.stringify(value));
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const amount=value=>value===null?'未完成完整周期':value!==0&&Math.abs(value)<.01?(value<0?'−':'')+'不到 0.01 元':new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2}).format(value)+' 元';
const number=value=>new Intl.NumberFormat('zh-CN',{maximumFractionDigits:1}).format(value);
const modes=[['fixed','固定月薪'],['hourly','按付费小时'],['piece','按件计酬'],['mixed','混合收入']];
const sourceNames={'profile.cash':'当前可用现金','profile.assets':'当前投资资产','profile.debt':'债务本金','profile.debtAPR':'债务年利率','profile.monthlyPrincipal':'每月计划还本','profile.reserveCash':'现金底线','profile.income':'当前收入约定','profile.expenses':'当前每月支出','profile.time':'当前每周安排','change.income':'改变后的收入约定','change.expenses':'改变后的每月支出','change.time':'改变后的每周安排','change.oneOffCost':'一次性费用','assumptions.annualReturn':'年回报假设','assumptions.shockMonth':'冲击月份假设','assumptions.shockReturn':'下跌幅度假设'};
const sourceKinds=[['unknown','来源未知'],['record','来自记录或约定'],['estimate','个人估计'],['assumption','情景假设']];
const timeLabels={work:'工作',commute:'通勤',care:'照护与必要家务',sleep:'睡眠',learn:'学习',other:'其他已占用时间'};
const lifeLabels={body:'身体与恢复：能否持续？',cognition:'认知与判断：还缺什么信息？',emotion:'情绪与行动：有什么待观察的影响？',relations:'关系与责任：谁会受到影响，有什么支持？',values:'欲望与价值：真正想换回什么，愿意放弃什么？'};
const editable=new Map();
let decision,records=[],step=1,stress=false,selectedId=null,pendingImport=null,lastValid=null,storageUnavailable=false,storageProtected=false,recoveryRaw=null;

function example(){
  const d=clone(DEFAULT_DECISION);d.title='减少工作投入，换回时间（示例）';d.startDate=today();d.months=12;
  Object.assign(d.profile,{cash:120000,assets:60000,debt:20000,debtAPR:.06,monthlyPrincipal:1000,reserveCash:30000,expenses:10000});
  Object.assign(d.profile.income,{mode:'fixed',fixedMonthly:15000});
  Object.assign(d.profile.time,{work:40,commute:7,care:21,sleep:56,learn:4,other:14});
  Object.assign(d.change,{name:'减少工时并调整收入（示例）',startMonth:2,durationMonths:11,expenses:9000,oneOffCost:5000});
  Object.assign(d.change.income,{mode:'fixed',fixedMonthly:12000});Object.assign(d.change.time,{work:32,commute:4,care:21,sleep:56,learn:8,other:14});
  Object.assign(d.assumptions,{annualReturn:.03,shockMonth:3,shockReturn:-.2});Object.assign(d.limits,{minSleep:49,maxWork:55});
  d.action.reviewDate=today();return d;
}
function valueAt(path){return path.split('.').reduce((value,key)=>value[key],decision);}
function setAt(path,value){const keys=path.split('.'),last=keys.pop(),object=keys.reduce((value,key)=>value[key],decision);object[last]=value;}
function field(path,label,{type='number',min=0,max=1e9,step:increment='any',note='',options=null,maxlength=2000}={}){
  editable.set(path,{type,options});const id='input-'+path.replaceAll('.','-'),value=valueAt(path);
  const attrs=`id="${id}" data-path="${path}"`;
  const control=options?`<select ${attrs}>${options.map(([key,name])=>`<option value="${key}"${String(value)===String(key)?' selected':''}>${name}</option>`).join('')}</select>`:type==='textarea'?`<textarea ${attrs} maxlength="${maxlength}" rows="3">${escape(value)}</textarea>`:`<input ${attrs} type="${type}" value="${escape(value)}"${type==='number'?` min="${min}" max="${max}" step="${increment}"`:` maxlength="${maxlength}"`}>`;
  return `<label class="field" for="${id}"><span>${escape(label)}</span>${control}${note?`<small>${escape(note)}</small>`:''}</label>`;
}
function incomeFields(prefix){
  const mode=valueAt(prefix+'.mode');
  let html=field(prefix+'.mode','计酬方式',{type:'select',options:modes});
  if(['fixed','mixed'].includes(mode))html+=field(prefix+'.fixedMonthly','约定税后固定收入（元／月）');
  if(['hourly','mixed'].includes(mode))html+=field(prefix+'.hourlyRate','税后付费时薪（元／小时）')+field(prefix+'.paidHoursWeek','每周付费小时',{max:168,note:'不能超过每周工作时数；不使用效率折扣'});
  if(['piece','mixed'].includes(mode))html+=field(prefix+'.pieceRate','税后每件报酬（元）')+field(prefix+'.unitsMonth','每月计酬件数');
  return html;
}
function timeFields(prefix){return Object.entries(timeLabels).map(([key,label])=>field(prefix+'.'+key,label+'（小时／周）',{max:168})).join('');}
function renderForms(){
  $('intent-fields').innerHTML=field('title','这次要作出的选择',{type:'text',maxlength:200})+field('startDate','观察起点',{type:'date'})+field('months','观察期',{type:'select',options:[[6,'6 个月'],[12,'12 个月'],[24,'24 个月']]});
  $('profile-money').innerHTML=field('profile.cash','可立即动用现金（元）')+field('profile.assets','投资资产市值（元）',{note:'不自动变现用于支付；暂不纳入房产和锁定资金'})+field('profile.debt','计息债务本金（元）')+field('profile.debtAPR','债务年利率（小数）',{max:1,note:'例如 0.06 表示年利率 6%；月利息按期初本金计算'})+field('profile.monthlyPrincipal','每月计划还本（元）',{note:'不包含利息；最后一期按剩余本金封顶'})+field('profile.expenses','每月生活与必要支出（元）',{note:'不含本页另算的债务利息、还本与一次性改变费用；应含照护等责任支出'});
  $('profile-income').innerHTML=incomeFields('profile.income');$('profile-time').innerHTML=timeFields('profile.time');
  $('limit-fields').innerHTML=field('profile.reserveCash','希望保留的现金底线（元）')+field('limits.minSleep','每周最低睡眠（小时）',{max:168})+field('limits.maxWork','每周最多工作（小时）',{max:168});
  $('change-fields').innerHTML=field('change.name','方案名称',{type:'text',maxlength:200})+field('change.startMonth','从第几个月开始',{min:1,max:24,step:1})+field('change.durationMonths','持续几个月',{min:1,max:24,step:1})+field('change.expenses','改变期间每月支出（元）')+field('change.oneOffCost','开始当月的一次性费用（元）',{note:'例如搬家、过渡或学习费用；不要重复计入每月支出'});
  $('change-income').innerHTML=incomeFields('change.income');$('change-time').innerHTML=timeFields('change.time');
  $('life-fields').innerHTML=Object.entries(lifeLabels).map(([key,label])=>field('life.'+key,label,{type:'textarea'})).join('');
  $('assumption-fields').innerHTML=field('assumptions.annualReturn','假设税费后有效年回报（小数）',{min:-1,max:1,note:'0.03 表示 3%；不代表市场预测'})+field('assumptions.shockMonth','不利情景：第几个月下跌',{min:1,max:24,step:1})+field('assumptions.shockReturn','额外下跌幅度（小数）',{min:-1,max:0,note:'−0.20 表示当月在基础回报上额外下跌 20%'});
  $('action-fields').innerHTML=field('action.choice','当前倾向',{type:'select',options:[['undecided','先保留判断'],['baseline','保持现状'],['changed','采用改变安排']]})+field('action.reason','为什么作这个决定？',{type:'textarea'})+field('action.conditions','行动前提、暂停或退出条件',{type:'textarea'})+field('action.reviewDate','计划回看日期',{type:'date'});
  renderSources();
}
function renderSources(){
  $('source-fields').innerHTML=Object.entries(decision.sources).map(([key,source],i)=>`<div class="source-row"><span>${escape(sourceNames[key]||key)}</span><label for="source-kind-${i}">来源<select id="source-kind-${i}" data-source="${key}" data-source-part="kind">${sourceKinds.map(([kind,label])=>`<option value="${kind}"${source.kind===kind?' selected':''}>${label}</option>`).join('')}</select></label><label for="source-date-${i}">依据日期<input id="source-date-${i}" type="date" data-source="${key}" data-source-part="date" value="${escape(source.date)}"></label><label for="source-note-${i}">依据说明<input id="source-note-${i}" type="text" maxlength="300" data-source="${key}" data-source-part="note" value="${escape(source.note)}"></label></div>`).join('');
}
function storageWarning(message){storageUnavailable=true;$('storage-warning').hidden=false;$('storage-warning-text').textContent=message;$('download-recovery').hidden=recoveryRaw===null;}
function validDraft(value){
  const shape=(x,y)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===Object.keys(y).length&&Object.keys(y).every(k=>Object.hasOwn(x,k)&&(typeof y[k]==='object'?shape(x[k],y[k]):typeof x[k]===typeof y[k]||typeof y[k]==='number'&&x[k]===''));
  return shape(value,DEFAULT_DECISION)&&JSON.stringify(value).length<100000;
}
function readSnapshot(value){
  if(value?.format!==LOCAL_FORMAT){const workspace=decodeWorkspace(value);return {workspace,draft:clone(workspace.decision)};}
  if(Object.keys(value).length!==3||!Object.hasOwn(value,'workspace')||!Object.hasOwn(value,'draft')||!validDraft(value.draft))throw new Error('本地草稿备份格式无效，未替换当前数据。');
  return {workspace:decodeWorkspace(value.workspace),draft:clone(value.draft)};
}
function load(){
  decision=example();lastValid=makeWorkspace(decision,[]);
  try{
    const saved=localStorage.getItem(KEY);if(saved){
      recoveryRaw=saved;const value=JSON.parse(saved);
      if(value?.format===LOCAL_FORMAT){
        const workspace=decodeWorkspace(value.workspace);records=workspace.records;lastValid=workspace;
        if(validDraft(value.draft)){decision=clone(value.draft);recoveryRaw=null;}
        else{decision=clone(workspace.decision);storageWarning('当前草稿损坏，已恢复有效输入和全部档案。可先下载原始保存内容留作备份。');}
      }else{const snapshot=readSnapshot(value);decision=snapshot.draft;records=snapshot.workspace.records;lastValid=snapshot.workspace;recoveryRaw=null;}
    }
  }catch(error){storageProtected=recoveryRaw!==null;storageWarning(storageProtected?'原保存内容未通过校验，已保护原始数据不被普通编辑覆盖。可下载原始内容；当前修改可另行导出，或确认导入有效备份。':'本机存储不可用。本次仍可计算并导出，请保留已有备份。');}
  selectedId=records.at(-1)?.id??null;
}
function persist(){
  try{
    if(storageProtected){storageWarning('原始保存内容已保护，本次变化仅在当前打开中。请导出当前工作，或下载原始保存内容后导入有效备份。');return;}
    const valid=!validateDecision(decision).length;lastValid=makeWorkspace(valid?decision:lastValid.decision,records);
    localStorage.setItem(KEY,JSON.stringify({format:LOCAL_FORMAT,workspace:lastValid,draft:decision}));
    storageUnavailable=false;$('storage-warning').hidden=true;
    $('draft-status').textContent='当前草稿已保存在本机';
  }catch(error){storageWarning('浏览器未能保存本次变化，可能是存储被禁用或空间已满。计算仍可使用，请导出备份。');$('draft-status').textContent='当前变化仅保留在本次打开中';}
}
function say(message){$('operation').textContent=message+(storageUnavailable?' 当前变化仅在本次打开中，请导出备份。':'');}
function failureLabel(result){return result.complete?'已覆盖完整观察期':`第 ${result.failure.month} 月现金不足 ${amount(result.failure.shortfall)}；之后不继续推演`;}
function reserveLabel(result){return result.summary.firstReserveBreach!==null?(result.summary.firstReserveBreach===0?'起点已低于底线':`第 ${result.summary.firstReserveBreach} 月低于底线`):result.failure?`第 ${result.failure.month} 月发生现金缺口`:'观察期内未低于底线';}
function renderResults(){
  const errors=validateDecision(decision);$('validation-errors').hidden=!errors.length;$('validation-errors').innerHTML=errors.length?`<strong>有 ${errors.length} 项需要核对</strong><ul>${errors.map(e=>`<li>${escape(e)}</li>`).join('')}</ul>`:'';
  $('save-record').disabled=!!errors.length;
  if(errors.length){for(const id of ['result-cards','result-comparison','time-results','decision-conditions','monthly-results'])$(id).innerHTML='';$('scenario-description').textContent='输入修正后更新结果，不展示上一次测算。';return;}
  const result=compareDecision(decision,stress),a=result.baseline,b=result.changed;
  $('scenario-description').textContent=`${stress?`第 ${decision.assumptions.shockMonth} 月额外下跌 ${number(-decision.assumptions.shockReturn*100)}%；`:'无额外市场冲击；'}年回报假设 ${number(decision.assumptions.annualReturn*100)}%。改变从第 ${decision.change.startMonth} 月持续 ${decision.change.durationMonths} 个月，结束后恢复原安排。`;
  const endDelta=a.complete&&b.complete?b.summary.endCash-a.summary.endCash:null;
  $('result-cards').innerHTML=[['期末现金差异',endDelta===null?'路径未完成':`${endDelta>0?'+':''}${amount(endDelta)}`,'改变方案减保持现状；投资资产不算可用现金'],['每周工作与通勤减少',number(result.timeDelta.work)+' 小时','仅指改变期间；不自动认定为自由时间'],['改变方案的现金底线',reserveLabel(b),'底线由你设定，并非统一财务标准']].map(([label,value,note])=>`<div class="card"><span>${escape(label)}</span><strong>${escape(value)}</strong><small>${escape(note)}</small></div>`).join('');
  const metricRows=[['期末可用现金',amount(a.summary.endCash),amount(b.summary.endCash)],['期末投资资产',amount(a.summary.endAssets),amount(b.summary.endAssets)],['期末债务本金',amount(a.summary.endDebt),amount(b.summary.endDebt)],['期末净资产',amount(a.summary.endNetWorth),amount(b.summary.endNetWorth)],['最低现金（已完成月份含起点）',amount(a.summary.minimumCash),amount(b.summary.minimumCash)],['首次低于现金底线',reserveLabel(a),reserveLabel(b)],['推演状态',failureLabel(a),failureLabel(b)]];
  $('result-comparison').innerHTML=`<table><thead><tr><th>同一观察期</th><th>保持现状</th><th>${escape(decision.change.name)}</th></tr></thead><tbody>${metricRows.map(row=>`<tr>${row.map((v,i)=>`<${i?'td':'th'}>${escape(v)}</${i?'td':'th'}>`).join('')}</tr>`).join('')}</tbody></table>`;
  $('time-results').innerHTML=`<p>改变期间，每周工作及通勤 ${result.timeDelta.work>=0?'减少':'增加'} ${number(Math.abs(result.timeDelta.work))} 小时；睡眠 ${result.timeDelta.sleep>=0?'增加':'减少'} ${number(Math.abs(result.timeDelta.sleep))} 小时。</p><p class="muted">未分配时间变化：${result.timeDelta.unallocated>0?'+':''}${number(result.timeDelta.unallocated)} 小时／周。其他活动仍需你安排。生活影响由你观察，不折算为金钱收益。</p>`;
  $('decision-conditions').innerHTML=result.conditions.map(c=>`<li>${escape(c)}</li>`).join('');
  const rows=[];for(let i=0;i<decision.months;i++){const fa=a.frames[i],fb=b.frames[i];const cell=(r,f)=>f?amount(f.cash):r.failure?.month===i+1?`缺口 ${amount(r.failure.shortfall)}`:'已停止';rows.push(`<tr><th>第 ${i+1} 月</th><td>${escape(cell(a,fa))}</td><td>${escape(cell(b,fb))}</td></tr>`);}
  $('monthly-results').innerHTML=`<table><thead><tr><th>月末现金</th><th>保持现状</th><th>改变安排</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
  for(const prefix of ['profile','change']){const total=Object.values(decision[prefix].time).reduce((n,v)=>n+v,0);$(prefix==='profile'?'baseline-time-summary':'changed-time-summary').textContent=`每周已安排 ${number(total)} 小时；未分配 ${number(168-total)} 小时。`;}
}
function showStep(next){step=Math.max(1,Math.min(5,next));for(let i=1;i<=5;i++)$('step-'+i).hidden=i!==step;for(const button of document.querySelectorAll('[data-step]'))button.setAttribute('aria-current',Number(button.dataset.step)===step?'step':'false');$('previous-step').disabled=step===1;$('next-step').hidden=step===5;$('step-position').textContent=`第 ${step} 步，共 5 步`;$('next-step').textContent=['','下一步：确认现状','下一步：改变安排','下一步：对照结果','下一步：记录决定'][step]||'下一步';}
function record(){return records.find(r=>r.id===selectedId)??null;}
function renderArchive(){
  $('record-count').textContent=`${records.length} / 100 条`;
  $('record-select').innerHTML=records.length?records.map(r=>`<option value="${escape(r.id)}"${r.id===selectedId?' selected':''}>${escape(r.decision.startDate+' · '+r.decision.title)}</option>`).join(''):'<option value="">尚无档案</option>';
  const current=record();for(const id of ['preview-report','download-report'])$(id).disabled=!current;
  $('review-panel').hidden=!current;$('report-preview').hidden=true;$('confirm-delete').checked=false;
  $('record-summary').textContent=current?`保存于 ${current.createdAt.slice(0,10)} · ${current.decision.months} 个月 · 已追加 ${current.reviews.length} 次复盘。后续编辑不会改变本条快照。`:'保存后，在这里查看当时的依据、下载报告并追加实际记录。';
  $('review-history').innerHTML=current?current.reviews.map(r=>`<article class="review-item"><h4>${escape(r.date)}</h4><p>实际收入：${r.actualIncome===null?'未填写':escape(amount(r.actualIncome))}；实际支出：${r.actualExpenses===null?'未填写':escape(amount(r.actualExpenses))}</p><p>${escape(r.note)}</p><p>${escape(r.nextStep)}</p></article>`).join(''):'';
  $('review-date').value=current&&current.decision.startDate>today()?current.decision.startDate:today();
  for(const id of ['review-income','review-expenses','review-note','review-next'])$(id).value='';
}
function download(name,text,type='application/json;charset=utf-8'){
  const url=URL.createObjectURL(new Blob([text],{type})),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function safe(operation){try{operation();}catch(error){say(error.message||'操作未完成，请核对输入。');}}
function workspaceForExport(){
  if(!validateDecision(decision).length)return makeWorkspace(decision,records);
  return {format:LOCAL_FORMAT,workspace:makeWorkspace(lastValid.decision,records),draft:clone(decision)};
}
function backupText(value){
  const text=JSON.stringify(value,null,2);if(new Blob([text]).size>MAX_BACKUP_BYTES)throw new Error('备份超过 128 MB，请先分批整理档案；当前数据未替换。');return text;
}
function handleEdit(event){
  const el=event.target,path=el.dataset?.path,sourceKey=el.dataset?.source;
  if(path&&editable.has(path)){
    const config=editable.get(path);let value=el.value;
    if(config.type==='number'||path==='months'){value=value===''?'':Number(value);if(typeof value==='number'&&!Number.isFinite(value))value='';}
    setAt(path,value);
    const source=Object.keys(decision.sources).find(key=>path===key||path.startsWith(key+'.'));
    if(source){decision.sources[source]={kind:source.startsWith('assumptions.')?'assumption':'unknown',date:'',note:''};renderSources();}
    if(path.endsWith('.income.mode')){
      const prefix=path.slice(0,-5),income=valueAt(prefix),active=new Set(value==='mixed'?['fixedMonthly','hourlyRate','paidHoursWeek','pieceRate','unitsMonth']:value==='fixed'?['fixedMonthly']:value==='hourly'?['hourlyRate','paidHoursWeek']:['pieceRate','unitsMonth']);
      for(const key of ['fixedMonthly','hourlyRate','paidHoursWeek','pieceRate','unitsMonth'])if(!active.has(key)&&(!Number.isFinite(income[key])||income[key]<0||income[key]>(key==='paidHoursWeek'?168:1e9)))income[key]=0;
      const container=path.startsWith('profile')?'profile-income':'change-income';$(container).innerHTML=incomeFields(prefix);
    }
    $('confirm-facts').checked=false;renderResults();persist();
  }else if(sourceKey&&Object.hasOwn(decision.sources,sourceKey)&&['kind','date','note'].includes(el.dataset.sourcePart)){
    decision.sources[sourceKey][el.dataset.sourcePart]=el.value;$('confirm-facts').checked=false;renderResults();persist();
  }
}
document.addEventListener('input',handleEdit);
document.addEventListener('change',event=>{if(event.target.tagName==='SELECT')handleEdit(event);});
for(const button of document.querySelectorAll('[data-step]'))button.onclick=()=>{showStep(Number(button.dataset.step));$('step-title-'+step).focus();};
$('previous-step').onclick=()=>showStep(step-1);$('next-step').onclick=()=>{showStep(step+1);$('step-title-'+step).focus();};
$('market-base').onclick=()=>{stress=false;$('market-base').setAttribute('aria-pressed','true');$('market-stress').setAttribute('aria-pressed','false');renderResults();};
$('market-stress').onclick=()=>{stress=true;$('market-base').setAttribute('aria-pressed','false');$('market-stress').setAttribute('aria-pressed','true');renderResults();};
$('load-example').onclick=()=>safe(()=>{if(!$('replace-example-check').checked)throw new Error('请先确认替换当前草稿；已有决策档案会保留。');decision=example();$('replace-example-check').checked=false;$('confirm-facts').checked=false;renderForms();renderResults();persist();showStep(1);say('已载入示例，已有档案保持不变。');});
$('save-record').onclick=()=>safe(()=>{
  if(!$('confirm-facts').checked)throw new Error('请先核对输入并勾选确认。');if(records.length>=100)throw new Error('已达到 100 条档案，请先导出备份并整理。');
  const id=typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():`decision-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const entry=createRecord(decision,{id,createdAt:new Date().toISOString()});records=[...records,entry];selectedId=id;persist();renderArchive();say('决策已保存。当时的输入与两种市场情景一起保留。');
});
$('record-select').onchange=()=>{selectedId=$('record-select').value;renderArchive();};
$('preview-report').onclick=()=>safe(()=>{const current=record();if(!current)throw new Error('请先选择档案。');$('report-preview').srcdoc=renderReport(current);$('report-preview').hidden=false;});
$('download-report').onclick=()=>safe(()=>{const current=record();if(!current)throw new Error('请先选择档案。');download(`金融学人-决策报告-${current.decision.startDate}.html`,renderReport(current),'text/html;charset=utf-8');say('报告已下载，可独立打开并打印为 PDF。');});
$('append-review').onclick=()=>safe(()=>{
  const current=record();if(!current)throw new Error('请先选择档案。');const numeric=id=>$(id).value===''?null:Number($(id).value);
  const next=appendReview(current,{date:$('review-date').value,actualIncome:numeric('review-income'),actualExpenses:numeric('review-expenses'),note:$('review-note').value,nextStep:$('review-next').value});records=records.map(r=>r.id===current.id?next:r);persist();renderArchive();for(const id of ['review-income','review-expenses','review-note','review-next'])$(id).value='';say('已追加复盘，原测算未改变。');
});
$('delete-record').onclick=()=>safe(()=>{if(!$('confirm-delete').checked)throw new Error('请先确认删除所选档案。');records=records.filter(r=>r.id!==selectedId);selectedId=records.at(-1)?.id??null;persist();renderArchive();say('所选档案已删除。');});
$('export-data').onclick=()=>safe(()=>{download(`金融学人-1.3-全部数据-${today()}.json`,backupText(workspaceForExport()));say('数据已导出，含当前草稿与档案。请妥善保存个人记录。');});
$('import-data').onchange=async()=>{
  pendingImport=null;$('import-preview').hidden=true;
  try{const file=$('import-data').files[0];if(!file)return;if(file.size>MAX_BACKUP_BYTES)throw new Error('文件超过 128 MB，请使用 1.3 导出的数据文件。');const snapshot=readSnapshot(JSON.parse(await file.text()));pendingImport=snapshot;const workspace=snapshot.workspace;$('import-description').textContent=`准备导入：${workspace.decision.title}，含 ${workspace.records.length} 条档案${validateDecision(snapshot.draft).length?'及未完成草稿':''}。当前有 ${records.length} 条档案。尚未替换任何数据。`;$('import-preview').hidden=false;say('请核对导入预览。');}catch(error){say(error.message||'文件读取失败，未替换当前数据。');}finally{$('import-data').value='';}
};
$('cancel-import').onclick=()=>{pendingImport=null;$('import-preview').hidden=true;say('已取消，当前数据保持不变。');};
$('download-recovery').onclick=()=>safe(()=>{if(recoveryRaw===null)throw new Error('没有待恢复的原始保存内容。');download(`金融学人-1.3-原始保存备份-${today()}.json`,recoveryRaw);say('原始保存内容已发起下载，当前数据未替换。');});
$('confirm-import').onclick=()=>safe(()=>{
  if(!pendingImport)throw new Error('请先选择并校验数据文件。');
  const backup=workspaceForExport();download(`金融学人-1.3-替换前备份-${today()}.json`,backupText(backup));
  if(storageProtected&&recoveryRaw!==null)download(`金融学人-1.3-原始保存备份-${today()}.json`,recoveryRaw);
  storageProtected=false;recoveryRaw=null;
  decision=clone(pendingImport.draft);records=pendingImport.workspace.records;lastValid=pendingImport.workspace;pendingImport=null;selectedId=records.at(-1)?.id??null;$('import-preview').hidden=true;$('confirm-facts').checked=false;renderForms();renderResults();renderArchive();persist();showStep(1);say('已导入 1.3 数据，替换前备份已发起下载；1.2 数据未改变。');
});
load();renderForms();renderResults();renderArchive();showStep(1);

return {};
})();
return __modules["app"];
})();
