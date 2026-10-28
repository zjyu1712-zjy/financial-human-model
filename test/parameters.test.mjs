import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../src/model.js';

const { state, actions } = model.DEFAULT_INPUT;
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('time allocation of 101 percent crosses the hard boundary', () => {
  const a = { ...actions, work: 39 };
  assert.equal(model.calculateDashboard(state, a).levels.time, 'hard');
  assert.equal(model.calculateDashboard(state, actions).levels.time, 'safe');
});

test('utility weights select one dimension without changing its raw value', () => {
  const p = { wSafety: 1, wAutonomy: 0, wQuality: 0, wRelation: 0, wGrowth: 0, wMeaning: 0 };
  const dashboard = model.calculateDashboard(state, actions, p);
  // 0.52*55 + 0.2*65 + 0.16*62 + 0.12*100 = 63.52.
  close(dashboard.utilityTotal, 63.52);
  assert.deepEqual(dashboard.utility, model.calculateDashboard(state, actions).utility);
});

test('doubling the risk coefficient doubles risk cost and leaves utility fixed', () => {
  const a = { ...actions, risk: 100 };
  const base = model.calculateDashboard(state, a);
  const changed = model.calculateDashboard(state, a, { riskRate: 0.24 });
  close(changed.costs.risk, base.costs.risk * 2);
  close(changed.utilityTotal, base.utilityTotal);
});

test('constraint parameters change crossing while preserving usage', () => {
  const low = model.calculateDashboard(state, actions, { riskScale: 0.1 });
  assert.equal(low.levels.risk, 'hard');
  close(low.constraints.risk.use, 38);
});

test('recovery coefficient changes first-week body response by the expected amount', () => {
  const base = model.simulate(state, actions, 0, 4);
  const changed = model.simulate(state, actions, 0, 4, { bodyRestGain: 0.29 });
  close(changed[1].state.body - base[1].state.body, 2.7);
  assert.deepEqual(changed[0].state, base[0].state);
});

test('parameters reach every forecast dashboard as well as its final result', () => {
  const frames = model.simulate(state, { ...actions, risk: 100 }, 0, 12, { riskRate: 0, emotionRate: 0, healthRate: 0, desireRate: 0, budgetRate: 0 });
  for (const frame of frames) assert.equal(frame.dashboard.costTotal, 0);
});

test('invalid parameters reject zero total weight, nonfinite and inverted boundaries', () => {
  assert.throws(() => model.calculateDashboard(state, actions, { wSafety: 0, wAutonomy: 0, wQuality: 0, wRelation: 0, wGrowth: 0, wMeaning: 0 }), /权重/);
  assert.throws(() => model.calculateDashboard(state, actions, { riskRate: NaN }), /riskRate/);
  assert.throws(() => model.calculateDashboard(state, actions, { budgetSoft: 80, budgetHard: 60 }), /预算/);
  assert.throws(() => model.calculateDashboard(state, actions, { riskScale: -1 }), /riskScale/);
});

test('zero capacity and extreme costs still produce finite outputs', () => {
  const d = model.calculateDashboard(state, { ...actions, risk: 100 }, { riskScale: 0, riskRate: 2 });
  assert.equal(d.constraints.risk.hard, 0);
  assert.equal(d.levels.risk, 'hard');
  assert.ok(Number.isFinite(d.net));
  assert.ok(d.net < 0);
});

test('explanations reconstruct the cost total from actual terms', () => {
  const d = model.calculateDashboard(state, { ...actions, risk: 100 });
  assert.ok(d.costBreakdown, 'cost breakdown is exposed');
  for (const [key, term] of Object.entries(d.costBreakdown)) close(term.base * term.rate, d.costs[key]);
  close(Object.values(d.costs).reduce((a,b) => a+b, 0), d.costTotal);
});
