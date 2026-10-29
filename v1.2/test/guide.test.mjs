import test from 'node:test';
import assert from 'node:assert/strict';
import {createLearningDemoScenario} from '../src/demo.js';
import {DEFAULT_GUIDE,GUIDE_GOALS,GUIDE_OPTIONS,buildDecisionGuide,validateGuide,decodeGuideTrial} from '../src/guide.js';
import {TIME_KEYS} from '../src/schema.js';
import {DEFAULT_MARGINAL,marginalEffects} from '../src/marginal.js';

test('default decision flow protects sleep and shows the two affordable time sources',()=>{
  const r=buildDecisionGuide(createLearningDemoScenario());
  assert.deepEqual(r.available.map(x=>x.source),['work','leisure']);
  assert.match(r.excluded.find(x=>x.source==='sleep').reason,/睡眠不减少/);
  assert.equal(r.totalHours,24);assert.equal(r.usedHours,168);
  for(const row of r.available)assert.equal(TIME_KEYS.reduce((n,k)=>n+row.plan[k],0),168);
});

test('boundaries filter choices without changing their underlying model results',()=>{
  const s=createLearningDemoScenario(),before=JSON.stringify(s),a=buildDecisionGuide(s);
  const b=buildDecisionGuide(s,{amount:2,protectWork:true,protectSleep:false});
  assert.deepEqual(b.available.map(x=>x.source),['leisure','sleep']);
  for(const row of b.rows)assert.deepEqual(row.point.delta,a.rows.find(x=>x.source===row.source).point.delta);
  assert.equal(JSON.stringify(s),before);
});

test('guide results use the existing marginal engine rather than a simplified score',()=>{
  const s=createLearningDemoScenario();
  for(const amount of [1,2,4]){
    const r=buildDecisionGuide(s,{...DEFAULT_GUIDE,amount,protectSleep:false});
    for(const row of r.available){
      const expected=marginalEffects(s,12,{}, {...DEFAULT_MARGINAL,step:amount,source:row.source}).primary;
      assert.deepEqual(row.point,expected);
    }
  }
});

test('empty choices stay empty when no source satisfies the boundaries',()=>{
  const s=createLearningDemoScenario();for(const key of TIME_KEYS)s.plan[key]=0;s.plan.sleep=168;
  const r=buildDecisionGuide(s);assert.equal(r.available.length,0);assert.equal(r.rows.length,4);
  assert.ok(r.excluded.every(x=>x.reason.length>0));
});

test('financial or time failure cannot be presented as an available trial',()=>{
  const s=createLearningDemoScenario();s.state.cash=0;s.plan.wage=0;
  const r=buildDecisionGuide(s,{...DEFAULT_GUIDE,protectSleep:false});
  assert.equal(r.available.length,0);assert.ok(r.rows.every(x=>!x.point.feasible));
});

test('goal input rejects missing boundaries, invalid amounts and extra fields',()=>{
  for(const config of [null,{},[],{...DEFAULT_GUIDE,amount:-1},{...DEFAULT_GUIDE,amount:49},{...DEFAULT_GUIDE,amount:1.5},{...DEFAULT_GUIDE,amount:NaN},{...DEFAULT_GUIDE,amount:Infinity},{...DEFAULT_GUIDE,amount:'2'},{...DEFAULT_GUIDE,protectSleep:1},{...DEFAULT_GUIDE,unexpected:1},
    {...DEFAULT_GUIDE,goal:'__proto__'},{...DEFAULT_GUIDE,goal:'constructor'},{...DEFAULT_GUIDE,protectLearn:undefined},{...DEFAULT_GUIDE,incomeMode:'salary'}]){
    assert.ok(validateGuide(config).length);assert.throws(()=>buildDecisionGuide(createLearningDemoScenario(),config));
  }
});

test('all goals and increments use the same engine and conserve hours without mutating inputs',()=>{
  const s=createLearningDemoScenario(),original=JSON.stringify(s);
  for(const goal of Object.keys(GUIDE_GOALS))for(const amount of [1,2,4]){
    const config={...DEFAULT_GUIDE,goal,amount,protectSleep:false,incomeMode:'output'},before=JSON.stringify(config);
    const result=buildDecisionGuide(s,config);
    assert.equal(result.rows.length,GUIDE_OPTIONS[goal].length);
    for(const row of result.rows){
      const expected=marginalEffects(s,12,{}, {...DEFAULT_MARGINAL,target:row.target,source:row.source,step:amount}).primary;
      assert.deepEqual(row.point,expected);
      if(row.available){
        assert.equal(TIME_KEYS.reduce((n,k)=>n+row.plan[k],0),168);
        assert.equal(row.plan[row.target],s.plan[row.target]+amount);
        assert.ok(row.point.delta[GUIDE_GOALS[goal].metric]*GUIDE_GOALS[goal].direction>1e-8);
      }
    }
    assert.equal(JSON.stringify(config),before);
  }
  assert.equal(JSON.stringify(s),original);
});

test('recovery compares different destinations and protects work and learning independently',()=>{
  const s=createLearningDemoScenario(),r=buildDecisionGuide(s,{...DEFAULT_GUIDE,goal:'recover'});
  for(const id of ['work-to-sleep','work-to-leisure','learn-to-leisure'])assert.ok(r.available.some(x=>x.id===id));
  assert.ok(r.available.find(x=>x.id==='work-to-sleep').point.delta.cash<0);
  assert.ok(r.available.find(x=>x.id==='learn-to-leisure').point.delta.knowledge<0);
  const filtered=buildDecisionGuide(s,{...DEFAULT_GUIDE,goal:'recover',protectWork:true,protectLearn:true});
  assert.ok(filtered.available.every(x=>!['work','learn'].includes(x.source)));
  assert.match(filtered.excluded.find(x=>x.id==='learn-to-leisure').reason,/学习时间不减少/);
  for(const row of filtered.rows)assert.deepEqual(row.point,r.rows.find(x=>x.id===row.id).point);
});

test('income is blocked for unknown or fixed pay, and tracks work income rather than asset wealth',()=>{
  const s=createLearningDemoScenario();
  for(const incomeMode of ['unknown','fixed']){
    const r=buildDecisionGuide(s,{...DEFAULT_GUIDE,goal:'income',incomeMode});
    assert.ok(r.blocker.length>0);assert.equal(r.rows.length,0);assert.equal(r.available.length,0);
  }
  const r=buildDecisionGuide(s,{...DEFAULT_GUIDE,goal:'income',incomeMode:'output'});
  assert.deepEqual(r.available.map(x=>x.id),['leisure-to-work','learn-to-work']);
  assert.ok(r.available.find(x=>x.id==='leisure-to-work').point.delta.fatigue>0);
  assert.ok(r.available.find(x=>x.id==='learn-to-work').point.delta.knowledge<0);
  const protectedResult=buildDecisionGuide(s,{...DEFAULT_GUIDE,goal:'income',incomeMode:'output',protectLearn:true});
  assert.match(protectedResult.excluded.find(x=>x.id==='learn-to-work').reason,/学习时间不减少/);
});

test('a feasible schedule is not labeled successful when the requested outcome does not improve',()=>{
  const s=createLearningDemoScenario();s.plan.wage=0;
  const income=buildDecisionGuide(s,{...DEFAULT_GUIDE,goal:'income',incomeMode:'output'});
  assert.equal(income.available.length,0);
  const row=income.excluded.find(x=>x.id==='leisure-to-work');assert.equal(row.point.feasible,true);assert.match(row.reason,/收入没有增加/);
  s.plan.work=4;s.state.fatigue=0;
  const recover=buildDecisionGuide(s,{...DEFAULT_GUIDE,goal:'recover'});
  assert.equal(recover.available.length,0);
  assert.ok(recover.excluded.some(x=>x.point.feasible&&x.reason.includes('疲劳没有降低')));
  // Zero effective learning stays zero even when raw learning hours increase.
  Object.assign(s.state,{health:0,sleepQuality:0,fatigue:100});
  Object.assign(s.plan,{sleep:0,exercise:0,work:80,learn:66,care:0,relation:0,leisure:22});
  const learn=buildDecisionGuide(s);assert.equal(learn.available.length,0);
  assert.ok(learn.excluded.some(x=>x.point.feasible&&x.reason.includes('知识积累没有增加')));
});

test('legacy and multi-goal trial records roundtrip and cannot borrow a different goals choice',()=>{
  const scenario=createLearningDemoScenario();
  const legacy={format:'financial-human-weekly-trial-v1',scenario,config:{amount:2,protectSleep:true,protectWork:false},source:'work',note:'旧记录'};
  const decoded=decodeGuideTrial(legacy);
  assert.deepEqual(decoded.config,DEFAULT_GUIDE);assert.equal(decoded.choiceId,'work');assert.equal(decoded.legacy,true);
  for(const [goal,choiceId] of [['learn','work'],['recover','work-to-leisure'],['income','learn-to-work']]){
    const record={format:'financial-human-weekly-trial-v2',scenario,config:{...DEFAULT_GUIDE,goal,incomeMode:'output'},choiceId,note:'<script>plain text</script>'};
    const r=decodeGuideTrial(record);assert.equal(r.config.goal,goal);assert.equal(r.choiceId,choiceId);assert.equal(r.note,record.note);
    r.scenario.plan.work=0;assert.equal(record.scenario.plan.work,40);
    for(const invalid of [{...record,choiceId:'constructor'},{...record,note:'x'.repeat(2001)},{...record,config:{...record.config,goal:'other'}},
      {...record,config:legacy.config},{...record,scenario:null}])assert.throws(()=>decodeGuideTrial(invalid));
  }
  assert.throws(()=>decodeGuideTrial({...legacy,config:{...DEFAULT_GUIDE,goal:'income',incomeMode:'output'}}));
  assert.throws(()=>decodeGuideTrial({format:'financial-human-weekly-trial-v2',scenario,config:{...DEFAULT_GUIDE,goal:'recover'},choiceId:'work',note:''}));
  for(const invalid of [null,{},[],{...legacy,config:null},{...legacy,config:{...legacy.config,protectWork:true}}])assert.throws(()=>decodeGuideTrial(invalid));
});
