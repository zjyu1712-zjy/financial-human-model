import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SCENARIO as D,clone,validateScenario} from '../src/schema.js';
import {states,mechanisms,step,simulate,ensemble,sensitivity,comparePlans,calibrate,calibrationTemplate,normalSequence} from '../src/model.js';
const scenario=()=>clone(D);
const close=(a,b,tolerance=1e-7)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);

test('all fields validate and default plan is feasible for 12 weeks',()=>{
  assert.deepEqual(validateScenario(D),[]);const r=simulate(D,12);assert.equal(r.feasible,true);assert.equal(r.frames.length,12);
});
test('time is a real 168-hour feasibility limit, not a penalty with impossible gains',()=>{
  const s=scenario();s.plan.work=168;const r=simulate(s,4);assert.equal(r.feasible,false);assert.equal(r.total,null);assert.equal(r.frames.length,1);assert.equal(r.frames[0].next,undefined);
});
test('cash shortage stops rather than clipping or inventing debt',()=>{
  const s=scenario();s.state.cash=0;s.plan.wage=0;const r=simulate(s,4);assert.equal(r.feasible,false);assert.equal(r.final.cash,0);assert.equal(r.final.debt,D.state.debt);
});
test('buying an asset transfers cash and does not mint wealth',()=>{
  const s=scenario();s.parameters.annualReturn=0;const a=simulate(s,1).frames[0];s.plan.buy=0;const b=simulate(s,1).frames[0];close(a.ledger.netWorthAfter,b.ledger.netWorthAfter);close(a.next.cash,b.next.cash-500);close(a.next.assets,b.next.assets+500);
});
test('net worth identity holds across positive and negative returns and loan repayment',()=>{
  for(const seed of [1,2,42,99])for(const f of simulate(D,12,{stochastic:true,seed}).frames)close(f.ledger.identityResidual,0);
});
test('asset risk grows with exposure and nonzero volatility is mandatory',()=>{
  const s=scenario();const a=simulate(s,1).frames[0];s.plan.buy=10000;const b=simulate(s,1).frames[0];assert.ok(b.diagnostics.downside>a.diagnostics.downside);s.parameters.annualVol=0;assert.ok(validateScenario(s).length);
});
test('sales cannot exceed holdings and buy and sell cannot both be positive',()=>{
  const s=scenario();s.plan.buy=0;s.plan.sell=s.state.assets+1;assert.equal(simulate(s,1).feasible,false);s.plan.buy=100;assert.ok(validateScenario(s).length);
});
test('paid-off debt does not create a future scheduled overpayment',()=>{
  const s=scenario();s.state.debt=50;const r=simulate(s,4);assert.equal(r.feasible,true);assert.equal(r.frames[0].ledger.principal,50);assert.equal(r.frames[1].ledger.principal,0);assert.equal(r.final.debt,0);
});
test('health affects effective work and learning output',()=>{
  const a=scenario(),b=scenario();a.state.health=0;b.state.health=100;const x=simulate(a,1).frames[0],y=simulate(b,1).frames[0];assert.equal(x.ledger.income,0);assert.ok(y.ledger.income>x.ledger.income);assert.ok(y.diagnostics.knowledgeGain>x.diagnostics.knowledgeGain);
});
test('financial returns do not automatically increase knowledge',()=>{
  const a=scenario(),b=scenario();b.parameters.annualReturn=.4;close(simulate(a,1).final.knowledge,simulate(b,1).final.knowledge);
});
test('higher comparison pressure enters emotion load',()=>{
  const a=scenario(),b=scenario();a.state.comparison=0;b.state.comparison=100;assert.ok(mechanisms(b.state,b.plan,b.parameters).load>mechanisms(a.state,a.plan,a.parameters).load);
});
test('cost and emotion overload share the same threshold',()=>{
  for(const work of [0,20,40,60,80]){const s=scenario();s.plan.work=work;s.plan.leisure=0;s.plan.sleep=42;s.plan.care=10;const r=simulate(s,1);if(r.feasible){const f=r.frames[0];assert.equal(f.costs.emotion>0,f.mechanisms.strain>0);}}
});
test('emotional money leakage is booked once, not a second cost line',()=>{
  const s=scenario();s.state.stress=100;s.state.regulation=0;s.state.comparison=100;const f=simulate(s,1).frames[0];assert.ok(f.mechanisms.channels.consumptionLeak>0);close(f.ledger.spending,s.plan.essential+s.plan.discretionary+s.plan.learningSpend+f.mechanisms.channels.consumptionLeak);assert.equal(Object.hasOwn(f.costs,'consumptionLeak'),false);
});
test('agency and voluntary rest affect autonomy even when total hours are the same',()=>{
  const a=scenario(),b=scenario();b.plan.work-=8;b.plan.leisure+=8;assert.ok(simulate(b,1).frames[0].utility.autonomy>simulate(a,1).frames[0].utility.autonomy);
});
test('value mismatch changes desire cost independent of spending',()=>{
  const a=scenario(),b=scenario();a.plan.valueFit=0;b.plan.valueFit=100;assert.ok(simulate(a,1).frames[0].costs.desire>simulate(b,1).frames[0].costs.desire);
});
test('weights and cost valuations do not change physical or financial state paths',()=>{
  const s=scenario();s.weights.safety=10;s.parameters.emotionRate=.9;const a=simulate(s,12),b=simulate(D,12);assert.deepEqual(a.frames.map(f=>f.next),b.frames.map(f=>f.next));assert.notEqual(a.total,b.total);
});
test('discounted objective includes all weeks',()=>{
  const r=simulate(D,4);close(r.total,r.frames.reduce((v,f,i)=>v+D.parameters.beta**i*f.net,0));
});
test('weekly overrides are scoped to the specified week and retain the baseline',()=>{
  const before=JSON.stringify(D);const c=comparePlans(D,D,4,{2:{work:32,leisure:20}});close(c.current.frames[0].net,c.baseline.frames[0].net);assert.notEqual(c.current.frames[1].net,c.baseline.frames[1].net);assert.equal(JSON.stringify(D),before);
});
test('schedule validates merged plans, boundaries, unknown keys and types',()=>{
  for(const schedule of [{0:{work:20}},{2:{unknown:5}},{2:null},{2:{work:NaN}},{2:{sell:10}}])assert.throws(()=>simulate(D,4,{schedule}));
});
test('a sale-only weekly override works when the base plan does not buy',()=>{
  const s=scenario();s.plan.buy=0;const r=simulate(s,4,{schedule:{2:{sell:100}}});assert.equal(r.feasible,true);assert.equal(r.frames[1].ledger.sell,100);
});
test('changing preferences or starting states is marked as non-equivalent comparison',()=>{
  const s=scenario();s.weights.safety=3;let c=comparePlans(s,D,4);assert.equal(c.samePreferences,false);assert.equal(c.sameStart,true);s.state.fatigue=40;c=comparePlans(s,D,4);assert.equal(c.sameStart,false);
});
test('random paths reproduce by seed and differ across seeds',()=>{
  assert.deepEqual(normalSequence(42,12),normalSequence(42,12));assert.notDeepEqual(normalSequence(42,12),normalSequence(43,12));assert.deepEqual(simulate(D,4,{seed:2,stochastic:true}),simulate(D,4,{seed:2,stochastic:true}));
});
test('market and health shocks are distinct',()=>{
  const s=scenario();s.plan.marketShock=-.5;const f=simulate(s,1).frames[0];const b=simulate(D,1).frames[0];assert.ok(f.next.assets<b.next.assets);close(f.next.health,b.next.health);
});
test('fatigue accumulates and recovery has a lag',()=>{
  const s=scenario();s.plan.sleep=42;s.plan.work=60;const r=simulate(s,4);assert.equal(r.feasible,true);assert.ok(r.final.fatigue>D.state.fatigue);assert.notEqual(r.frames[0].next.fatigue,r.final.fatigue);
});
test('knowledge gains diminish with accumulated knowledge',()=>{
  const a=scenario(),b=scenario();a.state.knowledge=20;b.state.knowledge=90;assert.ok(simulate(a,1).frames[0].diagnostics.knowledgeGain>simulate(b,1).frames[0].diagnostics.knowledgeGain);
});
test('money is not capped at 100 and all display states are bounded',()=>{
  const r=simulate(D,52);for(const f of r.frames){if(!f.feasible)break;for(const k of ['body','cognition','emotion','social','finance','desire'])assert.ok(f.states[k]>=0&&f.states[k]<=100);assert.ok(f.next.cash>=0);assert.ok(f.next.assets>=0);assert.ok(f.next.debt>=0);}assert.ok(r.final.cash>100);
});
test('ensemble reports failures instead of treating truncated paths as full results',()=>{
  const s=scenario();s.plan.work=168;const e=ensemble(s,4,{},8);assert.equal(e.completed,0);assert.equal(e.failureRate,1);assert.equal(e.mean,null);assert.equal(e.p50,null);
});
test('ensemble intervals and sensitivity are reproducible',()=>{
  const e=ensemble(D,4,{},10);assert.ok(e.p10<=e.p50&&e.p50<=e.p90);assert.equal(e.failureRate,0);
  const rows=sensitivity(D,4);assert.equal(rows.length,9);
  for(const key of ['sleepNeed','sleepDebtRepay','sleepDebtImpact'])assert.ok(rows.some(r=>r.key===key));
});
test('empty observation templates cannot pretend to calibrate',()=>{
  assert.throws(()=>calibrate(calibrationTemplate(D)),/真实/);
});
test('synthetic-data calibration has chronological holdout and recovers grid parameters',()=>{
  const template=calibrationTemplate(D);for(const row of template.records){row.scenario.state.fatigue=20+row.week*5;row.scenario.plan.learn=2+row.week;const trueScenario=clone(row.scenario);trueScenario.parameters.fatigueRecovery=.5;trueScenario.parameters.learningGain=2;const next=simulate(trueScenario,1).final;row.observed={fatigue:next.fatigue,knowledge:next.knowledge};}const fit=calibrate(template);assert.equal(fit.trainCount,4);assert.equal(fit.testCount,2);assert.deepEqual(fit.parameters,{fatigueRecovery:.5,learningGain:2});assert.ok(fit.improved);close(fit.holdoutAfter,0);
});
test('invalid data do not pass through direct model API',()=>{
  for(const [group,key,value] of [['state','cash',-1],['plan','work',NaN],['parameters','beta',2],['weights','safety',Infinity]]){const s=scenario();s[group][key]=value;assert.throws(()=>simulate(s));}assert.throws(()=>simulate(D,0));
});
