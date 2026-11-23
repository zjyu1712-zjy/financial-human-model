import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_DECISION, appendReview, compareDecision, createRecord, decodeWorkspace,
  makeWorkspace, renderReport, validateDecision,
} from '../src/decision.js';

function decision() {
  const value = structuredClone(DEFAULT_DECISION);
  Object.assign(value, { title: '减少夜班', startDate: '2028-02-29', months: 6 });
  Object.assign(value.profile, { cash: 1000, assets: 1000, expenses: 100 });
  Object.assign(value.profile.time, { work: 40, commute: 5, sleep: 50 });
  Object.assign(value.change, { startMonth: 2, durationMonths: 2, expenses: 110, oneOffCost: 15 });
  Object.assign(value.change.time, { work: 30, commute: 4, sleep: 55 });
  value.profile.income.fixedMonthly = 200;
  value.change.income.fixedMonthly = 160;
  Object.assign(value.assumptions, { annualReturn: 0, shockMonth: 3, shockReturn: -0.25 });
  return value;
}

const identity = { id: 'record-1', createdAt: '2028-01-02T03:04:05.000Z' };
const review = { date: '2028-05-01', actualIncome: 160, actualExpenses: null, note: '记录一', nextStep: '继续记录' };

test('keeps the comparison baseline unchanged and applies temporary changes only once and on schedule', () => {
  const value = decision();
  const result = compareDecision(value);
  assert.deepEqual(result.baseline.frames.map(({ income, expenses, oneOffCost }) => [income, expenses, oneOffCost]), Array(6).fill([200, 100, 0]));
  assert.deepEqual(result.changed.frames.map(({ income, expenses, oneOffCost }) => [income, expenses, oneOffCost]), [
    [200, 100, 0], [160, 110, 15], [160, 110, 0], [200, 100, 0], [200, 100, 0], [200, 100, 0],
  ]);
  assert.equal(result.baseline.summary.endCash, 1600);
  assert.equal(result.changed.summary.endCash, 1485);
  assert.deepEqual(result.timeDelta, { work: 11, sleep: 5, unallocated: 6 });
});

test('uses the same market shock for both choices without turning life notes into financial inputs', () => {
  const value = decision();
  const assetBalances = result => result.frames.map(frame => frame.assets);
  const base = compareDecision(value);
  assert.deepEqual(assetBalances(base.baseline), [1000, 1000, 1000, 1000, 1000, 1000]);
  value.life.emotion = '压力很大';
  value.life.cognition = '全面休息';
  assert.deepEqual(compareDecision(value), base);
  const stress = compareDecision(value, true);
  assert.deepEqual(assetBalances(stress.baseline), [1000, 1000, 750, 750, 750, 750]);
  assert.deepEqual(assetBalances(stress.changed), [1000, 1000, 750, 750, 750, 750]);
});

test('reports opening reserve breaches, cash shortfalls, and each weekly time limit', () => {
  const value = decision();
  Object.assign(value.profile, { cash: 0, reserveCash: 50 });
  value.change.oneOffCost = 250;
  Object.assign(value.limits, { minSleep: 53, maxWork: 35 });
  const result = compareDecision(value);
  assert.equal(result.baseline.summary.firstReserveBreach, 0);
  assert.deepEqual(result.changed.failure, { month: 2, shortfall: 100 });
  assert.equal(result.changed.summary.endCash, null);
  const conditions = result.conditions.join('\n');
  assert.match(conditions, /保持现状[^\n]*期初[^\n]*现金底线/);
  assert.match(conditions, /改变安排[^\n]*第\s*2\s*个月[^\n]*缺口[^\n]*100/);
  assert.match(conditions, /保持现状[^\n]*睡眠[^\n]*50[^\n]*53/);
  assert.match(conditions, /改变安排[^\n]*工作[^\n]*30[^\n]*35/);
});

test('rejects malformed, nonfinite, or oversized decision inputs before simulation', () => {
  assert.deepEqual(validateDecision(decision()), []);
  for (const [label, edit] of [
    ['prior version', v => { v.format = 'financial-human-work-decision-v1.2'; }],
    ['impossible start date', v => { v.startDate = '2026-02-29'; }],
    ['invalid action date', v => { v.action.reviewDate = '2028-04-31'; }],
    ['planned review before comparison starts', v => { v.action.reviewDate = '2028-02-28'; }],
    ['invalid action choice', v => { v.action.choice = 'auto'; }],
    ['oversized life note', v => { v.life.body = 'a'.repeat(10_000); }],
    ['oversized title', v => { v.title = 'a'.repeat(201); }],
    ['unsupported period', v => { v.months = 10; }],
    ['period with an invalid type', v => { v.months = Symbol(); }],
    ['non-finite amount', v => { v.change.expenses = Infinity; }],
    ['oversized amount', v => { v.profile.cash = 1e9 + 1; }],
    ['string amount', v => { v.profile.expenses = '100'; }],
    ['negative expense', v => { v.change.expenses = -1; }],
    ['negative debt return', v => { v.profile.debtAPR = -0.01; }],
    ['oversized derived pay', v => { Object.assign(v.change.income, { mode: 'piece', pieceRate: 1e9, unitsMonth: 2 }); }],
    ['work exceeds the week', v => { v.profile.time.work = 169; }],
    ['activities exceed the week', v => { v.change.time.other = 100; }],
    ['paid hours exceed work', v => { Object.assign(v.profile.income, { mode: 'hourly', paidHoursWeek: 41 }); }],
    ['invalid income mode', v => { v.change.income.mode = 'psychology'; }],
    ['change exceeds horizon', v => { v.change.durationMonths = 6; }],
    ['fractional month', v => { v.change.startMonth = 1.5; }],
    ['shock exceeds horizon', v => { v.assumptions.shockMonth = 7; }],
    ['positive shock', v => { v.assumptions.shockReturn = 0.01; }],
    ['annual return below minus 100%', v => { v.assumptions.annualReturn = -1.01; }],
    ['invalid weekly sleep limit', v => { v.limits.minSleep = 169; }],
    ['invalid source kind', v => { v.sources['profile.cash'].kind = 'bank'; }],
    ['impossible source date', v => { v.sources['profile.cash'].date = '2028-11-31'; }],
    ['non-text source note', v => { v.sources['profile.cash'].note = ['bank']; }],
    ['unrecognized source field', v => { v.sources['__proto__.cash'] = { kind: 'unknown', date: '', note: '' }; }],
    ['missing source field', v => { delete v.sources['profile.cash']; }],
    ['missing nested shape', v => { v.change.income = null; }],
  ]) {
    const value = decision();
    edit(value);
    assert.ok(validateDecision(value).length, label);
    assert.throws(() => compareDecision(value), Error, label);
  }
  const fixed = decision();
  fixed.profile.income.paidHoursWeek = 90;
  fixed.change.startMonth = 6;
  fixed.change.durationMonths = 1;
  fixed.action.reviewDate = fixed.startDate;
  assert.deepEqual(validateDecision(fixed), []);
});

test('record creation snapshots inputs and both scenarios, and a review does not change history', () => {
  const value = decision();
  const record = createRecord(value, identity);
  value.change.income.fixedMonthly = 999;
  assert.equal(record.decision.change.income.fixedMonthly, 160);
  assert.equal(record.results.base.changed.summary.endAssets, 1000);
  assert.equal(record.results.stress.changed.summary.endAssets, 750);
  const entry = { ...review };
  const updated = appendReview(record, entry);
  entry.note = '改写';
  assert.deepEqual(record.reviews, []);
  assert.deepEqual(updated.reviews, [review]);
  assert.deepEqual(updated.results, record.results);
  assert.throws(() => createRecord(value, { ...identity, createdAt: '2028-02-30T03:04:05.000Z' }), Error);
  assert.throws(() => appendReview(record, { ...review, actualIncome: NaN }), Error);
  assert.throws(() => appendReview(record, { ...review, date: '2028-04-31' }), Error);
  assert.throws(() => appendReview(record, { ...review, date: '2028-02-28' }), Error);
  assert.equal(appendReview(record, { ...review, date: '2028-02-29' }).reviews.length, 1);
  assert.throws(() => appendReview(record, { ...review, actualExpenses: -1 }), Error);
});

test('workspace decoding returns independent copies and rejects tampered records and old formats', () => {
  const value = decision();
  const record = appendReview(createRecord(value, identity), review);
  const workspace = makeWorkspace(value, [record]);
  const data = JSON.parse(JSON.stringify(workspace));
  data.records[0].results.base.baseline.summary = Object.fromEntries(Object.entries(data.records[0].results.base.baseline.summary).reverse());
  const decoded = decodeWorkspace(data);
  assert.deepEqual(decoded, workspace);
  assert.notEqual(decoded.decision.profile, data.decision.profile);
  assert.notEqual(decoded.records[0].reviews[0], data.records[0].reviews[0]);

  for (const [label, edit] of [
    ['old workspace', v => { v.format = 'financial-human-workspace-v1.2'; }],
    ['duplicate record ID', v => { v.records.push(v.records[0]); }],
    ['tampered stress snapshot', v => { v.records[0].results.stress.changed.summary.endCash += 1; }],
    ['tampered frame', v => { v.records[0].results.base.baseline.frames[0].cash += 1; }],
    ['tampered underlying decision', v => { v.records[0].decision.profile.cash += 1; }],
    ['oversized record count', v => { v.records = Array.from({ length: 101 }, (_, index) => ({ ...v.records[0], id: `record-${index}` })); }],
    ['oversized review count', v => { v.records[0].reviews = Array(51).fill(review); }],
    ['review before comparison starts', v => { v.records[0].reviews[0].date = '2028-02-28'; }],
    ['nonfinite imported value', v => { v.records[0].results.base.baseline.failure = NaN; }],
  ]) {
    const modified = structuredClone(data);
    edit(modified);
    assert.throws(() => decodeWorkspace(modified), Error, label);
  }

  const atLimit = structuredClone(record);
  atLimit.reviews = Array.from({ length: 50 }, () => ({ ...review }));
  assert.equal(makeWorkspace(value, [atLimit]).records[0].reviews.length, 50);
  assert.throws(() => appendReview(atLimit, review), Error);
});

test('renders an offline report with assumptions, both scenarios, provenance, review, and escaped user text', () => {
  const value = decision();
  value.title = `<script>标题</script> & "例"`;
  value.change.name = '<img src=x onerror=alert(1)>';
  value.life.body = '<form>观察</form>';
  value.action.reason = '<a>理由</a>';
  value.sources['profile.cash'] = { kind: 'record', date: '2028-02-10', note: '<b>工资单</b>' };
  const entry = { ...review, note: '<em>复盘</em>' };
  const html = renderReport(appendReview(createRecord(value, identity), entry));
  assert.match(html, /^<!doctype html>/i);
  for (const token of ['&lt;script&gt;标题&lt;/script&gt; &amp; &quot;例&quot;', '&lt;img src=x onerror=alert(1)&gt;', '&lt;form&gt;观察&lt;/form&gt;', '&lt;a&gt;理由&lt;/a&gt;', '&lt;b&gt;工资单&lt;/b&gt;', '&lt;em&gt;复盘&lt;/em&gt;', '2028-02-10', '2028-05-01', '基础情景', '下跌情景', '1485', '750']) {
    assert.ok(html.includes(token), token);
  }
  assert.doesNotMatch(html, /<(?:script|img|form|a|link|iframe)\b/i);
});

test('labels a market loss as investment profit or loss, not operating surplus', () => {
  const html = renderReport(createRecord(decision(), identity));
  assert.match(html, /<th scope="row">累计投资损益<\/th><td>-250<\/td><td>-250<\/td>/);
});

test('shows only the income inputs used by each contract in the report', () => {
  const value = decision();
  value.profile.income.hourlyRate = 999;
  Object.assign(value.change.income, { mode: 'hourly', hourlyRate: 25, paidHoursWeek: 20 });
  const record = createRecord(value, identity);
  const html = renderReport(record);
  assert.ok(html.includes('<th scope="row">固定月收入</th><td>200</td><td>不适用</td>'));
  assert.ok(html.includes('<th scope="row">时薪</th><td>不适用</td><td>25</td>'));
  assert.equal(record.decision.profile.income.hourlyRate, 999);
});

test('prints only a compact summary while keeping full notes in the offline appendix', () => {
  const value = decision();
  value.life.body = `<strong>只保留一段</strong>${'一个很长的身体观察'.repeat(100)}完整附文的结尾`;
  Object.assign(value.profile, { cash: 0, reserveCash: 50 });
  value.change.oneOffCost = 250;
  const html = renderReport(createRecord(value, identity));
  assert.match(html, /@page\s*\{[^}]*size:\s*A4/);
  assert.match(html, /@media\s+print\s*\{[\s\S]*\.report-appendix\s*\{\s*display:\s*none/);
  const [summary, appendix] = html.split('<details class="report-appendix"');
  assert.ok(appendix);
  assert.match(appendix,/^><summary>/);
  assert.match(summary,/来源未知/);
  assert.match(summary,/人民币/);
  assert.match(summary, /基础情景[^\n]*市场下跌情景/);
  assert.match(summary, /第 2 个月停止，现金缺口 100/);
  assert.match(summary, /&lt;strong&gt;只保留一段&lt;\/strong&gt;/);
  assert.doesNotMatch(summary, /完整附文的结尾/);
  assert.match(appendix, /完整附文的结尾/);
});
