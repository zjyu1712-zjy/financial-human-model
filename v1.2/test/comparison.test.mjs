import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SCENARIO,clone} from '../src/schema.js';
import {simulate} from '../src/model.js';
import {DEFAULT_GUIDE,buildDecisionGuide,decodeGuideTrial} from '../src/guide.js';
import {DEFAULT_LIMITS,decodeLimits,guidePath,limitMargins} from '../src/comparison.js';
import {decodeWorkspace,TRIAL_KEY} from '../src/workspace.js';
import {createLearningDemoScenario} from '../src/demo.js';
import {boot} from './fixture.mjs';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const limit=(u,k,v)=>{u.get('guide-limit-'+k).value=v;u.get('guide-limit-'+k).oninput();};
const open=(u,id)=>{u.get(id).open=true;u.get(id).ontoggle();};
const metric=(u,key)=>{u.get('guide-trend-'+key).checked=true;u.get('guide-trend-'+key).onchange();};

test('guide path totals, time transfers and chronological series match the existing model',()=>{
  const s=createLearningDemoScenario(),schedule={1:{work:36,learn:10},2:{sleep:58,leisure:12}};
  const r=buildDecisionGuide(s,DEFAULT_GUIDE,{weeks:12,schedule});
  for(const row of r.rows.filter(x=>x.point.feasible)){
    near(row.path.series.at(-1).cash,row.point.metrics.cash);
    near(row.path.income,row.point.metrics.income);near(row.path.effectiveLearn,row.point.metrics.effectiveLearn);
    near(row.path.effectiveLearn-r.baselinePath.effectiveLearn,row.point.delta.effectiveLearn);
    near(row.path.planned.learn-r.baselinePath.planned.learn,24);
    assert.equal(row.path.series.length,13);assert.equal(row.path.series[0].effectiveLearn,0);
    for(let i=1;i<row.path.series.length;i++)assert.ok(row.path.series[i].effectiveLearn>=row.path.series[i-1].effectiveLearn);
  }
  const direct=simulate(s,12,{schedule});near(r.baselinePath.income,direct.frames.reduce((n,f)=>n+f.ledger.income,0));
});

test('cash and fatigue extrema include the starting point and sleep respects actual weekly overrides',()=>{
  const s=createLearningDemoScenario(),p=guidePath(s,4,{2:{sleep:48},3:{work:32}});
  assert.equal(p.minimumCash.week,0);assert.equal(p.minimumCash.value,s.state.cash);
  assert.deepEqual(p.minimumSleep,{value:48,week:2});
  assert.equal(p.maximumFatigue.value,Math.max(...p.series.map(x=>x.fatigue)));
});

test('cash, sleep and income limits have signed margins and filter without changing physical results',()=>{
  const s=createLearningDemoScenario(),r=buildDecisionGuide(s),work=r.rows.find(x=>x.id==='work');
  const limits={minCash:30000,minSleep:56,maxIncomeLoss:500};
  const filtered=buildDecisionGuide(s,DEFAULT_GUIDE,{limits});
  assert.equal(filtered.available.some(x=>x.id==='work'),false);
  assert.equal(filtered.available.some(x=>x.id==='leisure'),true);
  const row=filtered.rows.find(x=>x.id==='work');assert.deepEqual(row.point,work.point);
  near(row.margins.find(m=>m.key==='maxIncomeLoss').margin,500+work.point.delta.income);
  assert.match(row.reason,/最多减少收入/);
  assert.equal(row.margins.find(m=>m.key==='minCash').margin,0);
  const failing=buildDecisionGuide(s,DEFAULT_GUIDE,{limits:{...DEFAULT_LIMITS,minCash:30001}});
  assert.equal(failing.available.length,0);assert.match(failing.excluded.find(r=>r.id==='work').reason,/起点/);
});

test('limits check every week and do not confuse a cash difference with reduced income',()=>{
  const s=createLearningDemoScenario(),base=guidePath(s,4,{});
  const buy=guidePath(s,4,{1:{buy:1000}});
  const m=limitMargins(buy,base,{...DEFAULT_LIMITS,maxIncomeLoss:0});
  near(m[0].margin,0);assert.equal(m[0].ok,true);assert.notEqual(buy.series.at(-1).cash,base.series.at(-1).cash);
  const r=buildDecisionGuide(s,DEFAULT_GUIDE,{schedule:{3:{sleep:40}},limits:{...DEFAULT_LIMITS,minSleep:50}});
  assert.equal(r.available.length,0);assert.ok(r.excluded.some(x=>x.reason.includes('第 3 周')));
});

test('unset limits differ from zero and malformed limits are rejected',()=>{
  assert.deepEqual(decodeLimits(),DEFAULT_LIMITS);assert.deepEqual(limitMargins(null,null),[]);
  for(const v of [null,{},[],{...DEFAULT_LIMITS,minCash:-1},{...DEFAULT_LIMITS,minCash:'0'},{...DEFAULT_LIMITS,minSleep:169},{...DEFAULT_LIMITS,maxIncomeLoss:Infinity},{...DEFAULT_LIMITS,extra:0}])assert.throws(()=>decodeLimits(v));
  const s=createLearningDemoScenario();assert.equal(buildDecisionGuide(s).available.length,2);
  assert.equal(buildDecisionGuide(s,DEFAULT_GUIDE,{limits:{...DEFAULT_LIMITS,maxIncomeLoss:0}}).available.length,0);
  s.state.cash=0;s.plan.wage=0;assert.equal(guidePath(s,12),null);
});

test('direct comparison shows extra effective input and charts while full detail stays separate',async()=>{
  const u=await boot();
  assert.match(u.get('guide-comparisons').innerHTML,/总共挪了多少时间/);assert.match(u.get('guide-comparisons').innerHTML,/学习效果（折算小时）/);
  assert.match(u.get('guide-comparisons').innerHTML,/compare-delta-bar/);assert.match(u.get('guide-comparisons').innerHTML,/原安排/);
  assert.match(u.get('guide-direct-summary').textContent,/方案B比方案A/);
  assert.match(u.get('guide-full-values').innerHTML,/累计学习投入/);assert.match(u.get('guide-margins').innerHTML,/尚未设置/);
  assert.equal(u.get('guide-trend-details').open,false);assert.equal(u.get('guide-detail-details').open,false);
  open(u,'guide-trend-details');assert.equal((u.get('guide-trend-chart').innerHTML.match(/data-guide-series=/g)||[]).length,3);
  for(const key of ['cash','fatigue','effectiveLearn']){metric(u,key);assert.doesNotMatch(u.get('guide-trend-chart').innerHTML,/NaN|Infinity/);}
});

test('comparison selection swaps instead of duplicating and persists separately for each goal',async()=>{
  const u=await boot(),oldA=u.get('guide-compare-a').value,oldB=u.get('guide-compare-b').value;
  u.get('guide-compare-a').value=oldB;u.get('guide-compare-a').onchange();
  assert.equal(u.get('guide-compare-a').value,oldB);assert.equal(u.get('guide-compare-b').value,oldA);
  u.goal('recover');u.goal('learn');assert.equal(u.get('guide-compare-a').value,oldB);
  const reloaded=await boot('#guide',u.storage);assert.equal(reloaded.get('guide-compare-a').value,oldB);
});

test('limits, views and drafts survive page switching, refresh and full export/import',async()=>{
  const u=await boot();open(u,'guide-limits-panel');limit(u,'minCash','1000');limit(u,'minSleep','50');limit(u,'maxIncomeLoss','5000');
  open(u,'guide-trend-details');open(u,'guide-detail-details');metric(u,'cash');u.go('model');u.go('guide');
  assert.equal(u.get('guide-limit-minCash').value,'1000');assert.match(u.get('guide-margins').innerHTML,/余量/);
  assert.match(u.get('guide-trend-chart').innerHTML,/我的现金底线/);
  u.get('export').onclick();const value=JSON.parse(await u.blobs.at(-1).text());
  const v=await boot();await v.get('import').onchange({target:{files:[{size:100,text:async()=>JSON.stringify(value)}]}});
  assert.deepEqual(v.saved().decision.limits,{minCash:1000,minSleep:50,maxIncomeLoss:5000});
  assert.equal(v.get('guide-trend-details').open,true);assert.equal(v.get('guide-detail-details').open,true);assert.equal(v.saved().decision.view.metric,'cash');
  const w=await boot('#guide',v.storage);assert.equal(w.get('guide-limit-minSleep').value,'50');assert.match(w.get('guide-trend-chart').innerHTML,/data-guide-series/);
});

test('invalid limit drafts clear graphs, block saving, survive refresh and recover notes',async()=>{
  const u=await boot();u.choose('work');u.get('guide-note').value='保留这段复盘';u.get('guide-note').oninput();
  open(u,'guide-trend-details');limit(u,'minCash','-1');
  assert.equal(u.get('guide-comparisons').innerHTML,'');assert.equal(u.get('guide-trend-chart').innerHTML,'');assert.equal(u.get('guide-save').disabled,true);
  const v=await boot('#guide',u.storage);assert.equal(v.get('guide-limit-minCash').value,'-1');assert.equal(v.get('guide-compare-panel').hidden,true);
  limit(v,'minCash','');assert.equal(v.saved().decision.limits.minCash,null);assert.equal(v.get('guide-note').value,'保留这段复盘');
});

test('new constraints invalidate chosen trials without losing notes and saved trials carry limits',async()=>{
  const u=await boot();u.choose('work');u.get('guide-note').value='原工作方案';u.get('guide-note').oninput();
  limit(u,'maxIncomeLoss','0');assert.equal(u.get('guide-save').disabled,true);
  limit(u,'maxIncomeLoss','5000');assert.equal(u.get('guide-note').value,'原工作方案');assert.equal(u.get('guide-save').disabled,false);
  u.get('guide-save').onclick();const r=decodeGuideTrial(JSON.parse(u.storage.get(TRIAL_KEY)));assert.equal(r.limits.maxIncomeLoss,5000);
  limit(u,'maxIncomeLoss','0');u.get('guide-load').onclick();assert.equal(u.get('guide-limit-maxIncomeLoss').value,'5000');
});

test('earlier workspaces and trials migrate to unset limits and default comparison view',async()=>{
  const u=await boot(),old=u.saved();delete old.decision.limits;delete old.decision.limitDrafts;delete old.decision.view;
  const restored=decodeWorkspace(old);assert.deepEqual(restored.decision.limits,DEFAULT_LIMITS);assert.equal(restored.decision.view.trendOpen,false);
  const record={format:'financial-human-weekly-trial-v2',scenario:clone(DEFAULT_SCENARIO),config:DEFAULT_GUIDE,choiceId:'work',note:''};
  assert.deepEqual(decodeGuideTrial(record).limits,DEFAULT_LIMITS);
  for(const mutate of [x=>x.decision.limits={...DEFAULT_LIMITS,minSleep:170},x=>x.decision.limitDrafts=[['unexpected','1']],x=>x.decision.view.pairs.learn=['work','work'],x=>x.decision.view.metric='bad']){
    const broken=u.saved();mutate(broken);assert.throws(()=>decodeWorkspace(broken));
  }
});

test('parameter edits recalculate all graph values and margins without clearing comparison controls',async()=>{
  const u=await boot();open(u,'guide-trend-details');limit(u,'minCash','1000');
  const before=u.get('guide-trend-values').innerHTML,details=u.get('guide-full-values').innerHTML;
  u.edit('parameters','learningGain','2');assert.notEqual(u.get('guide-full-values').innerHTML,details);
  u.edit('state','health','65');assert.notEqual(u.get('guide-trend-values').innerHTML,before);
  assert.equal(u.get('guide-trend-details').open,true);assert.equal(u.get('guide-limit-minCash').value,'1000');
  u.edit('plan','work','');assert.equal(u.get('guide-trend-chart').innerHTML,'');
});

test('learning gain updates knowledge and later cash, while wage updates first-week cash',async()=>{
  const u=await boot();u.choose('work');u.get('guide-note').value='参数联动草稿';u.get('guide-note').oninput();
  const trial=u.get('guide-trial-plan').innerHTML,comparison=u.get('guide-comparisons').innerHTML;
  const knowledge=()=>u.get('guide-full-values').innerHTML.match(/<tr><td>最后学到多少（分）<\/td>(.*?)<\/tr>/)?.[1];
  const before=knowledge();assert.ok(before);
  u.edit('parameters','learningGain','2');assert.notEqual(knowledge(),before);
  assert.notEqual(u.get('guide-comparisons').innerHTML,comparison);
  assert.equal(u.get('guide-trial-plan').innerHTML,trial);
  const wage=u.saved().experiment.current.plan.wage;
  u.edit('plan','wage',String(wage+10));assert.notEqual(u.get('guide-trial-plan').innerHTML,trial);
  u.edit('plan','wage',String(wage));assert.equal(u.get('guide-trial-plan').innerHTML,trial);
  assert.equal(u.get('guide-note').value,'参数联动草稿');
});
