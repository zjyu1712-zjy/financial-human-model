import test from 'node:test';
import assert from 'node:assert/strict';
import { createExperiment, captureBaseline, restoreBaseline, resetExperiment, changeExperiment, compareExperiment } from '../src/experiment.js';
import { radarPoint, linePath, formatNumber, deltaText } from '../src/presentation.js';

test('editing nested inputs and parameters leaves the reference unchanged', () => {
  const e = createExperiment();
  const changed = changeExperiment(e, 'state', 'body', 30).experiment;
  const updated = changeExperiment(changed, 'parameters', 'riskRate', 1).experiment;
  assert.equal(updated.baseline.input.state.body, 65);
  assert.equal(updated.baseline.parameters.riskRate, 0.12);
  assert.equal(e.current.input.state.body, 65);
  assert.equal(updated.current.parameters.riskRate, 1);
});

test('pin and restore copy inputs and parameters without resetting the baseline', () => {
  let e = changeExperiment(createExperiment(), 'state', 'body', 25).experiment;
  e = changeExperiment(e, 'parameters', 'riskRate', 0.5).experiment;
  e = captureBaseline(e);
  e = changeExperiment(e, 'state', 'body', 80).experiment;
  const restored = restoreBaseline(e);
  assert.equal(restored.current.input.state.body, 25);
  assert.equal(restored.current.parameters.riskRate, 0.5);
  restored.current.input.state.body = 90;
  assert.equal(restored.baseline.input.state.body, 25);
  const reset = resetExperiment(e);
  assert.equal(reset.current.input.state.body, 65);
  assert.equal(reset.baseline.input.state.body, 25);
});

test('both runs share the selected horizon and an unchanged run has zero deltas', () => {
  const c = compareExperiment(createExperiment(), 12);
  assert.equal(c.current.length, 13);
  assert.equal(c.baseline.length, 13);
  assert.equal(c.changes.length, 0);
  assert.equal(c.nowDelta.net, 0);
  assert.equal(c.finalDelta.net, 0);
  assert.throws(() => compareExperiment(createExperiment(), 0), /周期/);
});

test('a transition edit appears in differences and alters only the experimental path', () => {
  const e = changeExperiment(createExperiment(), 'parameters', 'bodyRestGain', 0.29).experiment;
  const c = compareExperiment(e, 4);
  assert.equal(c.changes.length, 1);
  assert.equal(c.changes[0].key, 'bodyRestGain');
  assert.ok(Math.abs(c.current[1].state.body-c.baseline[1].state.body-2.7) < 1e-9);
});

test('invalid edits preserve the full last valid state', () => {
  const e = createExperiment();
  for (const [group,key,value] of [['state','body',NaN], ['state','body',101], ['parameters','riskRate',''], ['shock','shock',21], ['parameters','budgetHard',2], ['state','unknown',50]]) {
    const r = changeExperiment(e, group, key, value);
    assert.equal(r.valid, false);
    assert.deepEqual(r.experiment, e);
    assert.ok(r.error);
  }
});

test('all-zero weights are rejected without erasing the last positive weight', () => {
  let e = createExperiment();
  for (const key of ['wSafety','wAutonomy','wQuality','wRelation','wGrowth']) e = changeExperiment(e,'parameters',key,0).experiment;
  const r = changeExperiment(e,'parameters','wMeaning',0);
  assert.equal(r.valid, false);
  assert.equal(r.experiment.current.parameters.wMeaning, 1);
});

test('chart geometry clamps to its axis while signed numeric text keeps true values', () => {
  assert.deepEqual(radarPoint(0, -5), [200,176]);
  assert.deepEqual(radarPoint(0, 150), [200,52]);
  assert.equal(linePath([-10,120],1),'M20.0,184.0 L560.0,14.0');
  assert.equal(formatNumber(-123.456),'-123.46');
  assert.equal(deltaText(2.5),'+2.50');
  assert.equal(deltaText(-0.0001),'0.00');
});
