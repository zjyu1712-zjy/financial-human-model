import test from 'node:test';
import assert from 'node:assert/strict';
import { createExperiment, changeParameterDraft } from '../src/experiment.js';

test('correcting one weight also commits the previously rejected zero-weight draft', () => {
  let result = { experiment: createExperiment(), drafts: {} };
  for (const key of ['wSafety','wAutonomy','wQuality','wRelation','wGrowth','wMeaning']) {
    result = changeParameterDraft(result.experiment, result.drafts, key, 0);
  }
  assert.match(result.errors.wMeaning, /至少保留/);
  assert.equal(result.experiment.current.parameters.wMeaning, 1);
  result = changeParameterDraft(result.experiment, result.drafts, 'wSafety', 1);
  assert.deepEqual(result.errors, {});
  assert.deepEqual(result.drafts, {});
  assert.equal(result.experiment.current.parameters.wSafety, 1);
  assert.equal(result.experiment.current.parameters.wMeaning, 0);
  assert.equal(result.experiment.baseline.parameters.wMeaning, 1);
});

test('a corrected hard limit commits the pending soft-limit draft atomically', () => {
  let result = changeParameterDraft(createExperiment(), {}, 'budgetSoft', 120);
  assert.match(result.errors.budgetSoft, /硬线/);
  assert.equal(result.experiment.current.parameters.budgetSoft, 55);
  result = changeParameterDraft(result.experiment, result.drafts, 'budgetHard', 130);
  assert.deepEqual(result.errors, {});
  assert.equal(result.experiment.current.parameters.budgetSoft, 120);
  assert.equal(result.experiment.current.parameters.budgetHard, 130);
});

test('independent parameter changes work while an empty or out-of-range draft remains', () => {
  let result = changeParameterDraft(createExperiment(), {}, 'budgetSoft', NaN);
  result = changeParameterDraft(result.experiment, result.drafts, 'bodyRestGain', 0.29);
  assert.match(result.errors.budgetSoft, /数字/);
  assert.equal(result.experiment.current.parameters.budgetSoft, 55);
  assert.equal(result.experiment.current.parameters.bodyRestGain, 0.29);
  result = changeParameterDraft(result.experiment, result.drafts, 'budgetSoft', 160);
  assert.ok(result.errors.budgetSoft);
  assert.equal(result.experiment.current.parameters.budgetSoft, 55);
  result = changeParameterDraft(result.experiment, result.drafts, 'budgetSoft', 80);
  assert.deepEqual(result.errors, {});
  assert.equal(result.experiment.current.parameters.budgetSoft, 80);
});
