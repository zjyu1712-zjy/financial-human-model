import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DEFAULT_SCENARIO,VERSION,clone} from '../src/schema.js';
import {DEFAULT_GUIDE,buildDecisionGuide,decodeGuideTrial} from '../src/guide.js';
import {DEFAULT_MARGINAL,marginalEffects} from '../src/marginal.js';
import {WORKSPACE_KEY,TRIAL_KEY,decodeWorkspace,decodeExperiment} from '../src/workspace.js';
import {boot} from './fixture.mjs';
const next=u=>u.get('guide-next').onclick();
function trial(u,id='work'){for(let i=0;i<3;i++)next(u);u.choose(id);next(u);u.get('guide-note').value='我的复盘 <script>不执行</script>';u.get('guide-note').oninput();}

test('selecting each goal plan enables saving; cancellation and invalidation disable it again',async()=>{
  for(const [goal,id] of [['learn','work'],['recover','work-to-leisure'],['income','leisure-to-work']]){
    const u=await boot();assert.equal(u.get('guide-save').disabled,true);u.goal(goal);
    if(goal==='income'){u.get('guide-income-mode').value='output';u.get('guide-income-mode').onchange();}
    trial(u,id);assert.equal(u.get('guide-save').disabled,false);
    u.get('guide-save').onclick();const saved=JSON.parse(u.storage.get(TRIAL_KEY));
    assert.equal(saved.choiceId,id);assert.equal(saved.config.goal,goal);assert.match(saved.note,/我的复盘/);
    u.get('guide-cancel').onclick();assert.equal(u.get('guide-save').disabled,true);
    u.choose(id);assert.equal(u.get('guide-save').disabled,false);
    u.edit('plan','work','');assert.equal(u.get('guide-save').disabled,true);
    u.edit('plan','work','40');assert.equal(u.get('guide-save').disabled,false);
  }
});

test('personal and advanced controls share values and parameter changes recalculate the selected trial',async()=>{
  const u=await boot();trial(u);const old=u.get('guide-comparisons').innerHTML,plan=u.get('guide-trial-plan').innerHTML;
  u.edit('plan','work','38','personal-');assert.equal(u.get('plan-work').value,'38');assert.match(u.get('guide-trial-plan').innerHTML,/工作 36 小时/);
  u.edit('plan','work','37');assert.equal(u.get('personal-plan-work').value,'37');assert.notEqual(u.get('guide-comparisons').innerHTML,old);
  u.go('model');u.edit('parameters','learningGain','2');u.go('guide');
  assert.notEqual(u.get('guide-trial-plan').innerHTML,plan);assert.equal(u.get('guide-step-5').hidden,false);
  assert.match(u.get('guide-note').value,/我的复盘/);assert.match(u.get('guide-options').innerHTML,/data-guide-choice="work" checked/);
  const s=u.saved();assert.equal(s.experiment.current.plan.work,37);assert.equal(s.experiment.current.parameters.learningGain,2);
  assert.equal(decodeWorkspace(s).decision.choiceId,'work');
});

test('all goals, amounts, periods and scheduled weeks compare with the same marginal engine',()=>{
  const schedule={1:{work:36,leisure:16},2:{learn:8,work:38}};
  for(const goal of ['learn','recover','income'])for(const amount of [1,2,4])for(const weeks of [4,12,26,52]){
    const config={...DEFAULT_GUIDE,goal,amount,incomeMode:'output'},result=buildDecisionGuide(DEFAULT_SCENARIO,config,{weeks,schedule});
    for(const row of result.rows){
      const expected=marginalEffects(DEFAULT_SCENARIO,weeks,schedule,{...DEFAULT_MARGINAL,source:row.source,target:row.target,step:amount});
      assert.deepEqual(row.point,expected.primary);assert.equal(result.totalHours,amount*weeks);
      assert.equal(row.plan[row.target],({...DEFAULT_SCENARIO.plan,...schedule[1]})[row.target]+amount);
    }
  }
});

test('period and schedule changes update comparisons and first-week trial plans immediately',async()=>{
  const u=await boot();trial(u);const before=u.get('guide-comparisons').innerHTML;
  u.get('guide-weeks').value='4';u.get('guide-weeks').onchange();assert.equal(u.get('weeks').value,'4');
  assert.match(u.get('guide-period').textContent,/4 周/);assert.notEqual(u.get('guide-comparisons').innerHTML,before);
  u.get('schedule').value='{"1":{"work":36,"leisure":16},"2":{"work":32}}';u.get('schedule-apply').onclick();
  assert.match(u.get('guide-trial-plan').innerHTML,/工作 34 小时/);assert.match(u.get('guide-options').innerHTML,/工作 36 → 34/);
  assert.match(u.get('guide-note').value,/我的复盘/);
  u.get('guide-save').onclick();const record=JSON.parse(u.storage.get(TRIAL_KEY));assert.equal(record.weeks,4);assert.equal(record.schedule[1].work,36);
  assert.equal(decodeGuideTrial(record).weeks,4);
});

test('infeasible selected plans are removed and old drafts are restored when inputs recover',async()=>{
  const u=await boot();trial(u);u.edit('plan','work','0');
  assert.equal(u.get('guide-trial').hidden,true);assert.equal(u.saved().decision.choiceId,null);assert.equal(u.get('guide-step-4').hidden,false);
  assert.doesNotMatch(u.get('guide-options').innerHTML,/data-guide-choice="work"/);
  u.edit('plan','work','40');assert.match(u.get('guide-note').value,/我的复盘/);assert.match(u.get('guide-options').innerHTML,/data-guide-choice="work" checked/);
});

test('invalid numeric input clears stale decisions but remains editable and exportable across refresh',async()=>{
  const u=await boot();trial(u);u.edit('plan','work','','personal-');
  assert.equal(u.get('guide-comparisons').innerHTML,'');assert.equal(u.get('guide-save').disabled,true);assert.equal(u.get('plan-work').value,'');
  const reloaded=await boot('#guide',u.storage);
  assert.equal(reloaded.get('personal-plan-work').value,'');assert.equal(reloaded.get('guide-comparisons').innerHTML,'');
  assert.equal(reloaded.saved().fieldDrafts[0][1],'');
  reloaded.edit('plan','work','40');assert.match(reloaded.get('guide-note').value,/我的复盘/);assert.notEqual(reloaded.get('guide-comparisons').innerHTML,'');
  assert.deepEqual(reloaded.saved().fieldDrafts,[]);
});

test('all three goals retain separate notes, selected sources, steps and demo settings on refresh',async()=>{
  const u=await boot();
  for(const [goal,id] of [['learn','work'],['recover','work-to-leisure'],['income','leisure-to-work']]){
    u.goal(goal);if(goal==='income'){u.get('guide-income-mode').value='output';u.get('guide-income-mode').onchange();}
    trial(u,id);u.get('guide-note').value=goal+'记录';u.get('guide-note').oninput();
  }
  u.get('demo-goal-recover').checked=true;u.get('demo-goal-recover').onchange();u.select('4');
  const v=await boot('#guide',u.storage);assert.equal(v.get('guide-step-5').hidden,false);assert.equal(v.get('guide-note').value,'income记录');
  assert.equal(v.get('demo-goal-recover').checked,true);assert.equal(v.get('demo-4').checked,true);
  v.goal('learn');assert.equal(v.get('guide-note').value,'learn记录');v.goal('recover');assert.equal(v.get('guide-note').value,'recover记录');
});

test('complete export carries drafts and notes and imports atomically without mixing old state',async()=>{
  const u=await boot();trial(u);u.edit('parameters','learningGain','2');
  u.get('schedule').value='{"2":';u.listeners.input({target:u.get('schedule')});u.get('export').onclick();
  const value=JSON.parse(await u.blobs.at(-1).text());assert.match(value.scheduleText,/\{"2":/);
  const v=await boot();await v.get('import').onchange({target:{files:[{size:100,text:async()=>JSON.stringify(value)}]}});
  assert.equal(v.get('parameters-learningGain').value,'2');assert.equal(v.get('schedule').value,'{"2":');assert.match(v.get('guide-note').value,/我的复盘/);
  const original=JSON.stringify(v.saved()),invalid=clone(value);invalid.experiment.current.plan.work=-1;
  await v.get('import').onchange({target:{files:[{size:100,text:async()=>JSON.stringify(invalid)}]}});
  assert.equal(JSON.stringify(v.saved()),original);assert.match(v.get('error').textContent,/工作/);
});

test('0.3 experiments and v1/v2 trial records migrate without overwriting legacy saves',async()=>{
  const legacy=JSON.parse(await readFile(new URL('../examples/marginal-work-to-learning.json',import.meta.url),'utf8'));
  const decoded=decodeExperiment(legacy);assert.equal(decoded.current.version,VERSION);assert.equal(legacy.current.version,'0.3.0-research');
  const u=await boot();await u.get('import').onchange({target:{files:[{size:100,text:async()=>JSON.stringify(legacy)}]}});
  assert.equal(u.saved().experiment.current.plan.care,42);assert.equal(u.saved().experiment.current.version,VERSION);
  const record={format:'financial-human-weekly-trial-v2',scenario:legacy.current,config:DEFAULT_GUIDE,choiceId:'work',note:'0.3复盘'};
  u.storage.set(record.format,JSON.stringify(record));u.get('guide-load').onclick();assert.equal(u.get('guide-note').value,'0.3复盘');
  u.get('guide-save').onclick();assert.equal(u.storage.get(record.format),JSON.stringify(record));assert.equal(JSON.parse(u.storage.get(TRIAL_KEY)).scenario.version,VERSION);
});

test('corrupt stored data is not automatically overwritten and storage denial does not crash calculations',async()=>{
  const storage=new Map([[WORKSPACE_KEY,'broken']]),u=await boot('#guide',storage);
  assert.equal(storage.get(WORKSPACE_KEY),'broken');assert.match(u.get('workspace-status').textContent,/异常/);
  u.edit('parameters','learningGain','2');assert.equal(storage.get(WORKSPACE_KEY),'broken');assert.notEqual(u.get('guide-comparisons').innerHTML,'');
  const v=await boot('#guide',new Map(),true);v.edit('plan','work','38');assert.match(v.get('workspace-status').textContent,/未保存|异常/);assert.notEqual(v.get('guide-comparisons').innerHTML,'');
  v.get('export').onclick();assert.equal(JSON.parse(await v.blobs.at(-1).text()).experiment.current.plan.work,38);
});

test('malformed workspace progress, notes, input fields and demo configuration are rejected',async()=>{
  const u=await boot();trial(u);const original=u.saved();
  const mutate=[v=>v.decision.step=6,v=>v.decision.choiceId='sleep-to-work',v=>v.decision.notes=[[JSON.stringify(['bad','work']),'x']],
    v=>v.fieldDrafts=[['__proto__.polluted','yes']],v=>v.demo.amounts.learn='3',v=>v.experiment.schedule={0:{work:1}},v=>v.experiment.current.parameters.learningGain=99];
  for(const change of mutate){const value=clone(original);change(value);assert.throws(()=>decodeWorkspace(value));}
  assert.deepEqual(u.saved(),original);assert.equal({}.polluted,undefined);
});

test('cancelled trial does not reselect itself on parameter change',async()=>{
  const u=await boot();trial(u);u.get('guide-cancel').onclick();u.edit('parameters','learningGain','2');
  assert.equal(u.saved().decision.choiceId,null);assert.equal(u.get('guide-trial').hidden,true);
  u.choose('work');assert.match(u.get('guide-note').value,/我的复盘/);
});

test('failed schedule application remains a blocked editable draft after reload',async()=>{
  const u=await boot();u.get('schedule').value='{"bad":';u.get('schedule-apply').onclick();assert.equal(u.get('guide-comparisons').innerHTML,'');
  const v=await boot('#guide',u.storage);assert.equal(v.get('schedule').value,'{"bad":');assert.equal(v.get('guide-comparisons').innerHTML,'');
  next(v);assert.equal(v.get('guide-step-2').hidden,false);
  v.get('schedule').value='{}';v.get('schedule-apply').onclick();assert.notEqual(v.get('guide-comparisons').innerHTML,'');
});
