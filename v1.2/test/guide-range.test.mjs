import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DEFAULT_SCENARIO,TIME_KEYS} from '../src/schema.js';
import {DEFAULT_GUIDE,GUIDE_AMOUNT,GUIDE_OPTIONS,buildDecisionGuide,decodeGuideTrial} from '../src/guide.js';
import {DEFAULT_MARGINAL,marginalEffects} from '../src/marginal.js';
import {decodeWorkspace,decisionKey,noteKey,TRIAL_KEY} from '../src/workspace.js';
import {boot} from './fixture.mjs';

const amount=(u,n)=>{u.get('guide-amount').value=n;u.get('guide-amount').oninput();};

test('every integer from 0 to 48 works for all three goals without nonfinite outputs',()=>{
  for(const goal of Object.keys(GUIDE_OPTIONS))for(let n=0;n<=48;n++){
    const r=buildDecisionGuide(DEFAULT_SCENARIO,{...DEFAULT_GUIDE,goal,amount:n,incomeMode:'output',protectSleep:false});
    assert.equal(r.totalHours,n*12);
    if(n===0){assert.match(r.blocker,/保留原安排/);assert.deepEqual(r.rows,[]);continue;}
    assert.equal(r.rows.length,GUIDE_OPTIONS[goal].length);
    for(const row of r.rows){
      if(row.point.feasible){
        for(const data of [row.point.metrics,row.point.delta,row.point.perHour,row.point.firstDelta])assert.ok(Object.values(data).every(Number.isFinite));
        assert.ok(TIME_KEYS.reduce((sum,k)=>sum+row.plan[k],0)<=168);
        assert.ok(TIME_KEYS.every(k=>row.plan[k]>=0));
      }else{assert.equal(row.available,false);assert.equal(row.point.delta,null);assert.ok(row.reason);}
    }
  }
});

test('expanded hours use the unchanged marginal engine with scheduled weeks and every horizon',()=>{
  const schedule={1:{work:36,leisure:16},2:{work:10,learn:32}};
  for(const goal of Object.keys(GUIDE_OPTIONS))for(const n of [3,5,12,24,47,48])for(const weeks of [4,12,26,52]){
    const r=buildDecisionGuide(DEFAULT_SCENARIO,{...DEFAULT_GUIDE,goal,amount:n,incomeMode:'output'},{weeks,schedule});
    for(const row of r.rows){
      const expected=marginalEffects(DEFAULT_SCENARIO,weeks,schedule,{...DEFAULT_MARGINAL,target:row.target,source:row.source,step:n});
      assert.deepEqual(row.point,expected.primary);
      if(row.available)assert.equal(row.plan[row.target],({...DEFAULT_SCENARIO.plan,...schedule[1]})[row.target]+n);
    }
  }
});

test('48 is not clamped into a feasible plan when source time or funds are insufficient',()=>{
  const r=buildDecisionGuide(DEFAULT_SCENARIO,{...DEFAULT_GUIDE,amount:48});
  const row=r.excluded.find(r=>r.id==='work');assert.ok(row);assert.equal(row.point.amount,48);
  assert.match(row.reason,/来源只有/);assert.equal(row.point.delta,null);
  const poor=structuredClone(DEFAULT_SCENARIO);poor.state.cash=0;poor.plan.wage=0;
  assert.equal(buildDecisionGuide(poor,{...DEFAULT_GUIDE,amount:48}).available.length,0);
});

test('slider updates while dragging, retains separate drafts, and handles zero without a fake trial',async()=>{
  const u=await boot();amount(u,3);u.choose('work');u.get('guide-note').value='三小时复盘';u.get('guide-note').oninput();
  const before=u.get('guide-comparisons').innerHTML;
  amount(u,5);assert.equal(String(u.get('guide-amount-value').textContent),'5');
  assert.equal(u.get('guide-amount')['aria-valuetext'],'每周 5 小时');assert.notEqual(u.get('guide-comparisons').innerHTML,before);
  u.choose('work');u.get('guide-note').value='五小时复盘';u.get('guide-note').oninput();
  amount(u,0);assert.equal(u.get('guide-comparisons').innerHTML,'');assert.equal(u.get('guide-save').disabled,true);
  assert.equal(u.get('guide-next').disabled,true);assert.match(u.get('guide-step-hint').textContent,/保留原安排/);
  assert.doesNotMatch(u.get('guide-status').textContent,/NaN|Infinity|0.01/);
  assert.equal(u.saved().decision.config.amount,0);
  amount(u,48);assert.equal(u.saved().decision.config.amount,48);
  amount(u,3);assert.equal(u.get('guide-note').value,'三小时复盘');
  amount(u,5);assert.equal(u.get('guide-note').value,'五小时复盘');
  assert.equal(u.get('guide-save').disabled,false);u.get('guide-save').onclick();
  const record=JSON.parse(u.storage.get(TRIAL_KEY));assert.equal(decodeGuideTrial(record).config.amount,5);
  const v=await boot('#guide',u.storage);assert.equal(v.get('guide-amount').value,'5');assert.equal(v.get('guide-note').value,'五小时复盘');
});

test('zero and maximum slider values survive full export and import',async()=>{
  for(const n of [0,3,48]){
    const u=await boot();amount(u,n);u.get('export').onclick();const exported=JSON.parse(await u.blobs.at(-1).text());
    assert.equal(decodeWorkspace(exported).decision.config.amount,n);
    const v=await boot();await v.get('import').onchange({target:{files:[{size:100,text:async()=>JSON.stringify(exported)}]}});
    assert.equal(v.get('guide-amount').value,String(n));assert.equal(v.saved().decision.config.amount,n);
  }
});

test('draft capacity covers all goals, hours and choices rather than failing at 100 records',async()=>{
  const u=await boot(),value=u.saved();value.decision.notes=[];value.decision.selections=[];
  for(const [goal,options] of Object.entries(GUIDE_OPTIONS))for(let n=0;n<=48;n++){
    const config={...DEFAULT_GUIDE,goal,amount:n};
    value.decision.selections.push([decisionKey(config),options[0].id]);
    for(const option of options)value.decision.notes.push([noteKey(config,option.id),`记录${n}`]);
  }
  const decoded=decodeWorkspace(value);assert.equal(decoded.decision.notes.length,637);assert.equal(decoded.decision.selections.length,147);
  for(const invalid of [-1,49,1.5]){const bad=structuredClone(value);bad.decision.notes[0][0]=noteKey({...DEFAULT_GUIDE,amount:invalid},'work');assert.throws(()=>decodeWorkspace(bad));}
});

test('slider markup has an explicit range, output and an accessible label',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/<input id="guide-amount" type="range" min="0" max="48" step="1"/);
  assert.match(html,/<label id="guide-action" for="guide-amount">/);
  assert.match(html,/<output id="guide-amount-value" for="guide-amount">/);
  assert.deepEqual(GUIDE_AMOUNT,{min:0,max:48,step:1});
});
