import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DEFAULT_SCENARIO,clone,upgradeScenario} from '../src/schema.js';
import {sleepTransition} from '../src/sleep.js';
import {simulate} from '../src/model.js';
import {compareSleepModels,sleepDemo,SLEEP_CASES} from '../src/sleep-comparison.js';
import {decodeWorkspace,WORKSPACE_KEY} from '../src/workspace.js';
import {boot} from './fixture.mjs';

const near=(a,b,e=1e-8)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
function transition({hours=56,need=8,debt=0,quality=75,rate=.3,repay=.8,impact=6}={}){
  return sleepTransition({...DEFAULT_SCENARIO.state,sleepDebt:debt,sleepQuality:quality},
    {...DEFAULT_SCENARIO.plan,sleep:hours},{...DEFAULT_SCENARIO.parameters,sleepNeed:need,fatigueRecovery:rate,sleepDebtRepay:repay,sleepDebtImpact:impact});
}

test('sleep debt conserves hours across a grid, cannot overpay or become negative',()=>{
  for(const hours of [0,28,55.99,56,63,68,168])for(const need of [4,8,9,12])for(const debt of [0,1e-10,14,10000])for(const repay of [0,.8,1]){
    const r=transition({hours,need,debt,repay});
    near(r.debtAfter,debt+r.deficit-r.repaid);near(r.balanceResidual,0);
    assert.ok(r.repaid>=0&&r.repaid<=r.availableDebt+1e-9&&r.repaid<=r.repaymentBudget+1e-9);
    assert.ok(r.debtAfter>=0&&r.recovery>=0&&r.recovery<1&&r.debtFatigue>=0&&r.debtFatigue<=6);
    assert.ok(Object.values(r).every(Number.isFinite));
  }
});
test('meeting current need prevents new debt but repayment requires surplus in this hypothesis',()=>{
  near(transition({debt:14}).debtAfter,14);
  near(transition({hours:49,debt:14}).debtAfter,21);
  assert.ok(transition({hours:68,debt:14}).debtAfter<14);
  near(transition({hours:168,debt:0}).debtAfter,0);
  near(transition({hours:68,debt:14,repay:0}).debtAfter,14);
});
test('recovery is smooth across the historical 56/63 caps and follows personal need',()=>{
  near(transition().recovery,.3*.875);
  near(transition({hours:0}).recovery,0);
  for(const need of [4,8,9,12])for(const boundary of [56,63,need*7]){
    const a=transition({hours:boundary-.001,need}),b=transition({hours:boundary,need}),c=transition({hours:boundary+.001,need});
    assert.ok(a.recovery<b.recovery&&b.recovery<c.recovery);
    assert.ok(Math.abs((b.recovery-a.recovery)-(c.recovery-b.recovery))<1e-9);
  }
  assert.ok(transition({hours:68}).recovery>transition({hours:63}).recovery);
  assert.ok(transition({hours:56,need:9}).recovery<transition({hours:56,need:8}).recovery);
  const a=transition({hours:56}).recovery,b=transition({hours:63}).recovery,c=transition({hours:70}).recovery;
  assert.ok(b-a>c-b);
});
test('quality and recovery speed affect recovery; repayment speed affects debt',()=>{
  assert.ok(transition({quality:100}).recovery>transition({quality:0}).recovery);
  assert.ok(transition({rate:.5}).recovery>transition({rate:.2}).recovery);
  assert.ok(transition({hours:68,debt:14,repay:1}).debtAfter<transition({hours:68,debt:14,repay:.2}).debtAfter);
  assert.ok(transition({hours:68,debt:14,quality:100}).debtAfter<transition({hours:68,debt:14,quality:0}).debtAfter);
  near(transition({debt:14,impact:0}).debtFatigue,0);
});
test('weekly overrides carry the debt state forward and do not silently reset it',()=>{
  const s=clone(DEFAULT_SCENARIO),run=simulate(s,4,{schedule:{1:{sleep:49},3:{sleep:68}}});
  assert.equal(run.feasible,true);near(run.frames[0].next.sleepDebt,7);near(run.frames[1].next.sleepDebt,7);
  for(let i=1;i<4;i++)near(run.frames[i].mechanisms.sleep.debtBefore,run.frames[i-1].next.sleepDebt);
  assert.ok(run.frames[2].next.sleepDebt<7);near(run.final.sleepDebt,run.frames[2].next.sleepDebt);
});
test('sleep quality is an independent observation and is not manufactured by extra hours',()=>{
  const s=clone(DEFAULT_SCENARIO);s.plan.sleep=68;
  const run=simulate(s,52);assert.equal(run.feasible,true);
  for(const f of run.frames)near(f.next.sleepQuality,s.state.sleepQuality);
});
test('extreme debt and zero sleep remain finite without clipping the debt ledger',()=>{
  const s=clone(DEFAULT_SCENARIO);s.state.sleepDebt=10000;s.parameters.sleepNeed=12;s.plan.sleep=0;
  s.state.cash=1e8;
  const run=simulate(s,52);assert.equal(run.feasible,true);near(run.final.sleepDebt,10000+84*52);
  for(const f of run.frames){assert.ok(f.next.fatigue>=0&&f.next.fatigue<=100);assert.ok(Number.isFinite(f.next.cash));}
});
test('legacy engine is byte-for-byte preserved and original numerical findings stay frozen',async()=>{
  const frozen=await readFile(new URL('../src/legacy-model.js',import.meta.url));
  assert.equal(createHash('sha256').update(frozen).digest('hex'),'f8281aa1f0d5b6b8d71a850a9994c577a961dd99d7332f292023e0b7d8f10cfd');
  const [legacy,revised]=sleepDemo().variants;
  near(legacy.delta.finalFatigue,-.7920740330342433);near(legacy.delta.averageFatigue,-.3916517482808608);
  near(revised.delta.finalFatigue,-.9497130523460022);near(revised.delta.averageFatigue,-1.024412842311067);
  assert.equal(legacy.original.sleepDebt,null);assert.equal(legacy.changed.sleepDebt,null);
  assert.ok(revised.changed.series[1].fatigue<legacy.changed.series[1].fatigue);
});
test('all three sleep starts use own-version baselines and both sources conserve transfer hours',()=>{
  for(const key of Object.keys(SLEEP_CASES))for(const source of ['unallocated','leisure']){
    const data=sleepDemo(key,source);assert.equal(data.totalHours,624);
    for(const v of data.variants){assert.equal(v.original.feasible,true);assert.equal(v.changed.feasible,true);
      near(v.delta.finalFatigue,v.changed.finalFatigue-v.original.finalFatigue);
      near(v.delta.averageFatigue,v.delta.fatigueBurden/52);
      assert.equal(v.changed.series.length,53);
    }
  }
  near(sleepDemo('higherNeed').variants[1].original.sleepDebt,364);
  near(sleepDemo('higherNeed').variants[1].changed.sleepDebt,0);
  near(sleepDemo('existingDebt').variants[1].original.sleepDebt,14);
  assert.ok(sleepDemo('existingDebt').variants[1].changed.sleepDebt<1e-8);
});
test('failed or invalid sleep comparisons do not return plausible whole-period differences',()=>{
  const s=clone(DEFAULT_SCENARIO);s.plan.care=100;
  for(const v of compareSleepModels(s).variants)assert.equal(v.delta,null);
  assert.throws(()=>compareSleepModels(DEFAULT_SCENARIO,52,'work'));
  assert.throws(()=>compareSleepModels(DEFAULT_SCENARIO,52,'unallocated',-1));
  assert.throws(()=>compareSleepModels(DEFAULT_SCENARIO,0));
  assert.throws(()=>sleepDemo('constructor'));
});
test('old scenarios migrate with explicit defaults, not fabricated measured debt',()=>{
  const s=clone(DEFAULT_SCENARIO);s.version='1.0.0';delete s.state.sleepDebt;
  for(const key of ['sleepNeed','sleepDebtRepay','sleepDebtImpact'])delete s.parameters[key];
  const before=JSON.stringify(s),updated=upgradeScenario(s);
  assert.equal(JSON.stringify(s),before);assert.equal(updated.state.sleepDebt,0);
  assert.equal(updated.parameters.sleepNeed,8);assert.equal(updated.parameters.sleepDebtRepay,.8);assert.equal(updated.parameters.sleepDebtImpact,6);
  s.version='1.2.0';assert.throws(()=>upgradeScenario(s));
});
test('personal sleep inputs mirror model controls, recalculate, preserve notes and survive reload',async()=>{
  const u=await boot();u.goal('recover');u.get('guide-amount').value=12;u.get('guide-amount').oninput();u.choose('unallocated-to-sleep');
  u.get('guide-note').value='记录实际睡眠';u.get('guide-note').oninput();
  for(const [group,key,value] of [['parameters','sleepNeed',9],['state','sleepDebt',14],['state','sleepQuality',60],['parameters','fatigueRecovery',.4]]){
    const before=u.get('guide-comparisons').innerHTML;u.edit(group,key,value,'personal-');
    assert.notEqual(u.get('guide-comparisons').innerHTML,before);assert.equal(u.get(group+'-'+key).value,String(value));
  }
  u.go('model');u.edit('parameters','sleepDebtRepay',.3);u.go('guide');
  assert.equal(u.get('guide-note').value,'记录实际睡眠');
  const html=u.get('guide-comparisons').innerHTML,v=await boot('#guide',u.storage);
  assert.equal(v.get('guide-comparisons').innerHTML,html);assert.equal(v.get('personal-parameters-sleepNeed').value,'9');
  u.edit('parameters','sleepNeed','');assert.equal(u.get('guide-comparisons').innerHTML,'');assert.equal(u.get('guide-save').disabled,true);
  u.edit('parameters','sleepNeed',9);assert.equal(u.get('guide-comparisons').innerHTML,html);
});
test('fixed sleep demos remain isolated while source and start selection survive reload',async()=>{
  const u=await boot('#demo'),before=u.get('sleep-demo-results').innerHTML;
  u.edit('parameters','sleepNeed',10);u.edit('state','sleepDebt',42);
  assert.equal(u.get('sleep-demo-results').innerHTML,before);
  u.get('sleep-case-existingDebt').checked=true;u.get('sleep-case-existingDebt').onchange();
  u.get('sleep-demo-source').value='leisure';u.get('sleep-demo-source').onchange();
  assert.match(u.get('sleep-demo-context').textContent,/14小时/);assert.match(u.get('sleep-demo-context').textContent,/自由休息/);
  assert.equal((u.get('sleep-demo-chart').innerHTML.match(/data-sleep-model=/g)||[]).length,2);
  const v=await boot('#demo',u.storage);assert.equal(v.get('sleep-demo-results').innerHTML,u.get('sleep-demo-results').innerHTML);
  assert.equal(v.get('sleep-case-existingDebt').checked,true);assert.equal(v.get('sleep-demo-source').value,'leisure');
});
test('old workspace imports preserve personal fields and notes without writing the old key',async()=>{
  const u=await boot();u.edit('plan','wage',123);const old=u.saved();old.format='financial-human-workspace-v1';
  old.experiment.format='financial-human-experiment-v1.0';old.experiment.version='1.0.0';
  for(const s of [old.experiment.current,old.experiment.baseline]){
    s.version='1.0.0';delete s.state.sleepDebt;for(const k of ['sleepNeed','sleepDebtRepay','sleepDebtImpact'])delete s.parameters[k];
  }
  const original=JSON.stringify(old),migrated=decodeWorkspace(old);assert.equal(JSON.stringify(old),original);
  assert.equal(migrated.experiment.current.plan.wage,123);assert.equal(migrated.experiment.current.state.sleepDebt,0);
  const storage=new Map([['financial-human-workspace-v1',original],[WORKSPACE_KEY,JSON.stringify(migrated)]]);
  const v=await boot('#guide',storage);v.edit('parameters','sleepNeed',9);
  assert.equal(storage.get('financial-human-workspace-v1'),original);assert.equal(v.get('plan-wage').value,'123');
});
