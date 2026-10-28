import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildOffline } from '../scripts/build-offline.mjs';

test('the offline build evaluates the real parameterized model without module loading', async () => {
  const script = await buildOffline('model');
  const model=vm.runInNewContext(script);
  const {state,actions}=model.DEFAULT_INPUT;
  assert.equal(model.calculateDashboard(state,{...actions,work:39}).levels.time,'hard');
  assert.equal(model.calculateDashboard(state,{...actions,risk:100},{riskRate:0}).costs.risk,0);
  assert.ok(Math.abs(model.calculateDashboard(state,actions).utilityTotal-51.053333333333335)<1e-9);
});

test('offline experiment preserves the same baseline semantics',async()=>{
  const api=vm.runInNewContext(await buildOffline('experiment'));
  const e=api.changeExperiment(api.createExperiment(),'parameters','bodyRestGain',0.29).experiment;
  const c=api.compareExperiment(e,4);
  assert.equal(c.changes.length,1);
  assert.ok(Math.abs(c.current[1].state.body-c.baseline[1].state.body-2.7)<1e-9);
});

test('browser entry bundle parses as classic JavaScript',async()=>{
  const bundle = await buildOffline('app');
  assert.doesNotThrow(()=>new vm.Script(bundle));
});
