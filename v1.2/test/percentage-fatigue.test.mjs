import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SCENARIO,clone} from '../src/schema.js';
import {guidePath,relativePercent} from '../src/comparison.js';
import {simulate} from '../src/model.js';
import {simulate as legacySimulate} from '../src/legacy-model.js';
import {boot} from './fixture.mjs';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('percentage changes use the original value, keep signs and reject zero or invalid denominators',()=>{
  near(relativePercent(10.217452300906807,11.00952633394105),-7.194442422035668);
  near(relativePercent(68,56),12/56*100);near(relativePercent(0,12),-100);
  assert.equal(relativePercent(12,12),0);
  for(const [after,before] of [[1,0],[0,0],[1,1e-12],[2,-1],[Infinity,1],[1,NaN]])assert.equal(relativePercent(after,before),null);
});

test('fatigue burden sums closing states only and average uses the actual horizon',()=>{
  for(const weeks of [1,4,12,26,52]){
    const s=clone(DEFAULT_SCENARIO),schedule={1:{sleep:63}};
    const run=simulate(s,weeks,{schedule}),path=guidePath(s,weeks,schedule);
    const total=run.frames.reduce((n,f)=>n+f.next.fatigue,0);
    near(path.fatigueBurden,total);near(path.averageFatigue,total/weeks);
    if(weeks===1)near(path.averageFatigue,path.series[1].fatigue);
  }
});

test('default sleep reproduction exposes the 56 and 63 hour caps without changing the model',()=>{
  // Freeze the historical 1.0 finding; current equations are tested separately.
  const simulate=legacySimulate;
  const guidePath=(scenario,weeks,schedule={},transfer=null)=>{
    const s=clone(scenario);if(transfer)s.plan.sleep+=transfer.amount;
    const run=simulate(s,weeks,{schedule}),fatigueBurden=run.frames.reduce((n,f)=>n+f.next.fatigue,0);
    return {series:[{fatigue:s.state.fatigue},...run.frames.map(f=>f.next)],fatigueBurden,averageFatigue:fatigueBurden/weeks};
  };
  const s=clone(DEFAULT_SCENARIO),base=guidePath(s,52);
  const seven=guidePath(s,52,{}, {source:'unallocated',target:'sleep',amount:7});
  const twelve=guidePath(s,52,{}, {source:'unallocated',target:'sleep',amount:12});
  near(twelve.series[1].fatigue,base.series[1].fatigue);
  near(twelve.series.at(-1).fatigue-base.series.at(-1).fatigue,-.7920740330342433);
  near(twelve.averageFatigue-base.averageFatigue,-.39165174828085375);
  near(twelve.fatigueBurden-base.fatigueBurden,-20.365890910604396);
  for(let i=0;i<twelve.series.length;i++)near(twelve.series[i].fatigue,seven.series[i].fatigue);
  assert.equal((12-7)*52,260);
  const first=simulate(s,1).frames[0],a=clone(s),b=clone(s);a.plan.sleep=63;b.plan.sleep=68;
  near(simulate(a,1).final.sleepQuality,simulate(b,1).final.sleepQuality);
  near(simulate(b,1).final.fatigue,first.next.fatigue);
});

test('comparison shows signed percentages, time shares and full-period fatigue without clearing notes',async()=>{
  const u=await boot();u.goal('recover');u.get('guide-amount').value=12;u.get('guide-amount').oninput();
  u.get('guide-weeks').value=52;u.get('guide-weeks').onchange();u.choose('unallocated-to-sleep');
  u.get('guide-note').value='保留睡眠试行';u.get('guide-note').oninput();
  let html=u.get('guide-comparisons').innerHTML;
  assert.match(html,/−8\.6%/);assert.match(html,/睡眠 \+21\.4%/);assert.match(html,/这段时间平均有多累/);
  assert.match(u.get('guide-full-values').innerHTML,/累计疲劳负担（分·周）/);
  u.go('model');u.edit('parameters','fatigueRecovery','.4');u.go('guide');
  assert.notEqual(u.get('guide-comparisons').innerHTML,html);assert.equal(u.get('guide-note').value,'保留睡眠试行');
  const v=await boot('#guide',u.storage);assert.equal(v.get('guide-comparisons').innerHTML,u.get('guide-comparisons').innerHTML);
  assert.equal(v.get('guide-note').value,'保留睡眠试行');
});

test('zero learning baseline displays no invented percentage and repairs to a valid percentage',async()=>{
  const u=await boot();u.edit('plan','learn','0');
  assert.match(u.get('guide-comparisons').innerHTML,/原值为0/);
  assert.doesNotMatch(u.get('guide-comparisons').innerHTML,/NaN|Infinity/);
  u.edit('plan','learn','6');assert.doesNotMatch(u.get('guide-comparisons').innerHTML,/原值为0/);
  const before=u.get('guide-comparisons').innerHTML;
  u.edit('plan','work','');assert.equal(u.get('guide-comparisons').innerHTML,'');
  u.edit('plan','work','40');assert.equal(u.get('guide-comparisons').innerHTML,before);
});
