import { calculateMonthlyIncome, marketReturns, simulateFinances } from './finance.js';

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

export const DEFAULT_DECISION = freezeDecisionData({
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

export function validateDecision(value) {
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

export function compareDecision(value, stress = false) {
  assertValidDecision(value);
  if (typeof stress !== 'boolean') throw new Error('市场下跌情景必须明确开启或关闭。');
  return computeDecision(value, stress);
}

function decisionSnapshots(value) {
  return { base: computeDecision(value, false), stress: computeDecision(value, true) };
}

export function createRecord(decision, { id, createdAt } = {}) {
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

export function appendReview(record, review) {
  assertDecisionRecord(record);
  if (record.reviews.length === 50) throw new Error('每条决策最多保存 50 条复盘。');
  if (!validDecisionReview(review, record.decision.startDate)) throw new Error('请检查实际收支和文字长度；复盘日期不得早于决策开始日期。');
  return freezeDecisionData(structuredClone({ ...record, reviews: [...record.reviews, review] }));
}

export function makeWorkspace(decision, records) {
  return decodeWorkspace({ format: DECISION_WORKSPACE_FORMAT, decision, records });
}

export function decodeWorkspace(value) {
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

export function renderReport(record) {
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
