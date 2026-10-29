import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DEFAULT_SCENARIO,clone} from '../src/schema.js';
import {simulate} from '../src/model.js';
import {syntheticDiary as synthetic} from './diary-cases.mjs';
import {newDiary,readDiaryRecord,decodeDiary,saveDiaryRecord,dayNumber,diaryWeeks,summarizeDiary,confirmDiaryWeek,diarySuggestion} from '../src/sleep-diary.js';
import {decodeWorkspace,WORKSPACE_KEY} from '../src/workspace.js';
import {decodeGuideTrial,DEFAULT_GUIDE} from '../src/guide.js';
import {boot} from './fixture.mjs';

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const dateAt=n=>new Date(n*86400000).toISOString().slice(0,10);
const add=(date,n)=>dateAt(dayNumber(date)+n);
const record=(date,patch={})=>({date,hours:8,fatigue:2,quality:4,context:'free',note:'',...patch});
function entries(start,count,patch={}){return Array.from({length:count},(_,i)=>record(add(start,i),patch));}
test('daily records reject missing, nonfinite, impossible and future observations',()=>{
  for(const patch of [{hours:''},{hours:'  '},{hours:25},{hours:-1},{hours:Infinity},{fatigue:11},{quality:0},{quality:2.5},{date:'2026-02-30'},{date:'2026-10-30'},{context:'unknown'},{note:'a'.repeat(201)}])assert.throws(()=>readDiaryRecord({...record('2026-10-28'),...patch},'2026-10-29'));
  assert.equal(readDiaryRecord(record('2026-10-28',{hours:0,fatigue:0}), '2026-10-29').hours,0);
});
test('saving a date updates once, sorts chronologically and never changes the input object',()=>{
  const d=newDiary(),before=JSON.stringify(d),a=saveDiaryRecord(d,record('2026-10-20'));
  const b=saveDiaryRecord(a,record('2026-10-19')),c=saveDiaryRecord(b,record('2026-10-20',{hours:7}));
  assert.equal(JSON.stringify(d),before);assert.equal(c.records.length,2);assert.equal(c.records[0].date,'2026-10-19');assert.equal(c.records[1].hours,7);
});
test('complete calendar weeks need a starting rating and never treat missing dates as zero',()=>{
  const r=entries('2026-10-18',8);assert.equal(diaryWeeks(r).length,1);
  assert.equal(diaryWeeks(r.slice(1)).length,0);assert.equal(diaryWeeks(r.filter((_,i)=>i!==3)).length,0);
  near(diaryWeeks(r)[0].hours,56);near(diaryWeeks(r)[0].fatigueBefore,20);near(diaryWeeks(r)[0].quality,75);
});
test('sleep reference waits for enough recent observations and uses rested free days only',()=>{
  const d=newDiary();d.records=entries('2026-10-12',14,{hours:7.5});
  assert.equal(summarizeDiary(d,DEFAULT_SCENARIO,'2026-10-29').need.value,7.5);
  d.records[0].context='special';d.records[0].hours=24;assert.equal(summarizeDiary(d,DEFAULT_SCENARIO,'2026-10-29').need.value,7.5);
  assert.equal(summarizeDiary({...d,records:d.records.slice(1)},DEFAULT_SCENARIO,'2026-10-29').need,null);
  assert.equal(summarizeDiary(d,DEFAULT_SCENARIO,'2027-01-01').need,null);
  d.records.forEach(r=>r.context='ordinary');assert.equal(summarizeDiary(d,DEFAULT_SCENARIO,'2026-10-29').need,null);
});
test('sleep shortfall is a conditional weekly ledger, not guessed prior history',()=>{
  const d=newDiary();d.records=entries('2026-10-11',15,{hours:7,context:'ordinary'});
  const s=summarizeDiary(d,DEFAULT_SCENARIO,'2026-10-29');near(s.latest.debt,14);assert.equal(s.fit.count,0);
  assert.throws(()=>diarySuggestion(d,DEFAULT_SCENARIO,'actual','2026-10-29'));
  assert.equal(d.assumeZero,false);
});
test('gaps break the debt chain rather than silently interpolating unrecorded weeks',()=>{
  const d=newDiary();d.records=[...entries('2026-09-27',8,{hours:7}),...entries('2026-10-18',8,{hours:7})];
  const r=summarizeDiary(d,DEFAULT_SCENARIO,'2026-10-29');near(r.latest.debt,7);assert.equal(r.latest.gap,true);
});
test('weekly confirmation validates actual time and invalidates when its daily evidence changes',()=>{
  const d=newDiary();d.records=entries('2026-10-18',8,{hours:7});
  assert.throws(()=>confirmDiaryWeek(d,'2026-10-25',{...DEFAULT_SCENARIO.plan,work:168},DEFAULT_SCENARIO));
  const x=confirmDiaryWeek(d,'2026-10-25',DEFAULT_SCENARIO.plan,DEFAULT_SCENARIO);
  assert.equal(summarizeDiary(x,DEFAULT_SCENARIO).latest.confirmed,true);
  x.records[3].hours=6;assert.equal(summarizeDiary(x,DEFAULT_SCENARIO).latest.confirmed,false);
});
test('applying actual records requires recent complete evidence and explicit starting assumption',()=>{
  const d=newDiary();d.records=entries('2026-10-18',8,{hours:7});
  const x=confirmDiaryWeek(d,'2026-10-25',DEFAULT_SCENARIO.plan,DEFAULT_SCENARIO);x.assumeZero=true;
  const out=diarySuggestion(x,DEFAULT_SCENARIO,'actual','2026-10-29');near(out.plan.sleep,49);near(out.state.sleepDebt,7);near(out.state.fatigue,20);
  assert.throws(()=>diarySuggestion(x,DEFAULT_SCENARIO,'actual','2026-11-10'));
  assert.deepEqual(d.records,x.records);assert.equal(DEFAULT_SCENARIO.state.sleepDebt,0);
});
test('applying reference changes only one parameter and debt is recalculated under that reference',()=>{
  const d=newDiary();d.records=entries('2026-10-12',14,{hours:7.5});
  const s=diarySuggestion(d,DEFAULT_SCENARIO,'need','2026-10-29');near(s.parameters.sleepNeed,7.5);
  assert.deepEqual(s.plan,DEFAULT_SCENARIO.plan);assert.deepEqual(s.state,DEFAULT_SCENARIO.state);
  assert.equal(summarizeDiary(d,s).latest.debt,0);assert.ok(summarizeDiary(d,DEFAULT_SCENARIO).latest.debt>0);
});
test('recovery fit holds out later weeks and recovers a synthetic single parameter',()=>{
  const {d,s}=synthetic(),r=summarizeDiary(d,s,'2026-10-29');
  assert.equal(r.fit.count,6);assert.equal(r.fit.trainCount,4);assert.equal(r.fit.holdoutCount,2);assert.equal(r.fit.available,true);
  near(r.fit.value,.45);assert.ok(r.fit.afterRMSE<1e-6);
  const adopted=diarySuggestion(d,s,'recovery','2026-10-29');near(adopted.parameters.fatigueRecovery,.45);assert.deepEqual(adopted.state,s.state);
});
test('missing confirmations, special weeks and unknown earlier debt cannot silently fit',()=>{
  for(const kind of ['confirmation','special','unknown']){
    const {d,s}=synthetic();if(kind==='confirmation')d.weeks.pop();else if(kind==='special')d.records.at(-1).context='special';else d.assumeZero=false;
    assert.equal(summarizeDiary(d,s).fit.available,false);assert.throws(()=>diarySuggestion(d,s,'recovery','2026-10-29'));
  }
});
test('fit is rejected when later records do not improve on the current rate',()=>{
  const {d,s}=synthetic();s.parameters.fatigueRecovery=.45;assert.equal(summarizeDiary(d,s).fit.available,false);
});
test('diary import validates records, duplicates, drafts, and nested weekly scenarios',()=>{
  const d=newDiary();assert.deepEqual(decodeDiary(undefined),d);
  for(const patch of [{records:[record('2026-10-01'),record('2026-10-01')]},{draft:{date:''}},{step:9},{assumeZero:'yes'},{records:[record('2026-10-01',{foo:1})]},{dailyDrafts:[{date:'bad'}]}])assert.throws(()=>decodeDiary({...d,...patch}));
  const {d:good}=synthetic();assert.equal(decodeDiary(good).weeks.length,6);good.weeks[0].scenario.plan.work=NaN;assert.throws(()=>decodeDiary(good));
});
test('daily draft, helper step and confirmed observations survive export and import',async()=>{
  const u=await boot();u.get('diary-nav-2').onclick();
  for(const [k,v] of Object.entries({date:'2026-10-28',hours:'7.5',fatigue:'4',quality:'4',context:'ordinary',note:'实际记录'})){
    u.get('diary-'+k).value=v;if(k==='date')u.get('diary-date').onchange();else u.get('diary-'+k).oninput();
  }
  const before=JSON.stringify(u.saved().experiment);u.get('diary-save').onclick();
  assert.equal(u.saved().sleepDiary.records.length,1);assert.equal(JSON.stringify(u.saved().experiment),before);
  u.get('diary-hours').value='';u.get('diary-hours').oninput();u.get('diary-to-summary').onclick();u.go('model');u.go('guide');
  const v=await boot('#guide',u.storage);assert.equal(v.saved().sleepDiary.step,3);assert.equal(v.get('diary-hours').value,'');
  u.get('export').onclick();const data=JSON.parse(await u.blobs.at(-1).text());
  const w=await boot();await w.get('import').onchange({target:{files:[{size:100,text:async()=>JSON.stringify(data)}]}});
  assert.deepEqual(w.saved().sleepDiary,v.saved().sleepDiary);
});
test('switching dates keeps separate unfinished entries and editing or undoing deletion is safe',async()=>{
  const u=await boot();u.get('diary-date').value='2026-10-27';u.get('diary-date').onchange();u.get('diary-hours').value='7';u.get('diary-hours').oninput();
  u.get('diary-date').value='2026-10-28';u.get('diary-date').onchange();u.get('diary-hours').value='8';u.get('diary-hours').oninput();
  u.get('diary-date').value='2026-10-27';u.get('diary-date').onchange();assert.equal(u.get('diary-hours').value,'7');
  for(const [k,v] of [['fatigue','3'],['quality','4']]){u.get('diary-'+k).value=v;u.get('diary-'+k).oninput();}u.get('diary-save').onclick();
  u.listeners.click({target:{dataset:{diaryDelete:'2026-10-27'}}});assert.equal(u.saved().sleepDiary.records.length,0);
  u.get('diary-undo').onclick();assert.equal(u.saved().sleepDiary.records.length,1);
});
test('invalid records stay editable and never update model results',async()=>{
  const u=await boot(),before=u.get('guide-comparisons').innerHTML;u.get('diary-nav-2').onclick();
  u.get('diary-hours').value='99';u.get('diary-hours').oninput();u.get('diary-save').onclick();
  assert.equal(u.saved().sleepDiary.records.length,0);assert.equal(u.get('guide-comparisons').innerHTML,before);assert.ok(u.get('diary-message').textContent);
  const v=await boot('#guide',u.storage);assert.equal(v.get('diary-hours').value,'99');
});
test('adoption updates linked plans but preserves notes, fixed examples and unapplied schedule text',async()=>{
  const u=await boot();u.goal('recover');u.choose('unallocated-to-sleep');u.get('guide-note').value='我的草稿';u.get('guide-note').oninput();
  const data=u.saved();data.sleepDiary=synthetic().d;data.sleepDiary.open=true;data.sleepDiary.step=3;
  const v=await boot('#guide',new Map([[WORKSPACE_KEY,JSON.stringify(data)]]));const demo=v.get('demo-results').innerHTML,baseline=JSON.stringify(v.saved().experiment.baseline);
  v.get('schedule').value='{"2":{"work":38}}';v.listeners.input({target:v.get('schedule')});
  v.get('diary-adopt-recovery').onclick();near(v.saved().experiment.current.parameters.fatigueRecovery,.45);
  assert.equal(v.get('guide-note').value,'我的草稿');assert.equal(v.get('demo-results').innerHTML,demo);assert.equal(JSON.stringify(v.saved().experiment.baseline),baseline);
  assert.equal(v.get('schedule').value,'{"2":{"work":38}}');
});
test('1.1 workspace and trial import retain values without overwriting old keys',async()=>{
  const u=await boot();u.choose('work');u.get('guide-save').onclick();const value=u.saved();value.format='financial-human-workspace-v1.1';
  value.experiment.format='financial-human-experiment-v1.1';for(const s of [value.experiment.current,value.experiment.baseline])s.version='1.1.0';delete value.sleepDiary;
  const migrated=decodeWorkspace(value);assert.equal(migrated.sleepDiary.records.length,0);
  const trial=JSON.parse(u.storage.get('financial-human-weekly-trial-v5'));trial.format='financial-human-weekly-trial-v4';trial.scenario.version='1.1.0';assert.equal(decodeGuideTrial(trial).scenario.version,'1.2.0');
  const old=JSON.stringify(value),storage=new Map([['financial-human-workspace-v1.1',old],[WORKSPACE_KEY,JSON.stringify(migrated)]]);
  const v=await boot('#guide',storage);v.edit('plan','work',39);assert.equal(storage.get('financial-human-workspace-v1.1'),old);
});
test('diary text is escaped, never interpreted as markup',async()=>{
  const u=await boot(),data=u.saved();data.sleepDiary.records=[record('2026-10-20',{note:'<img src=x onerror=alert(1)>'})];
  const v=await boot('#guide',new Map([[WORKSPACE_KEY,JSON.stringify(data)]]));assert.doesNotMatch(v.get('diary-history').innerHTML,/<img/);
});
test('copy changes do not alter the 1.1 sleep dynamics or financial ledger',async()=>{
  const source=await readFile(new URL('../src/model.js',import.meta.url));
  assert.equal(createHash('sha256').update(source).digest('hex'),'24dd48e00af7d64b99eb8406ce9393c11bb32cee06cce6644f3ba21c6d3f42d8');
  const s=clone(DEFAULT_SCENARIO),run=simulate(s,52);near(run.final.fatigue,11.00952633394105);
  for(const f of run.frames)near(f.ledger.identityResidual,0);
});
test('future observations and old recovery records cannot update the present',()=>{
  const {d,s}=synthetic();assert.equal(summarizeDiary(d,s,'2026-09-01').latest,null);
  assert.throws(()=>diarySuggestion(d,s,'actual','2026-09-01'));
  assert.equal(summarizeDiary(d,s,'2027-01-01').fit.available,false);
});
test('changing weeks preserves unfinished actual-time inputs and their reload state',async()=>{
  const u=await boot(),data=u.saved();data.sleepDiary=synthetic().d;
  const v=await boot('#guide',new Map([[WORKSPACE_KEY,JSON.stringify(data)]]));
  const select=end=>{v.get('diary-week-select').value=end;v.get('diary-week-select').onchange();};
  select('2026-10-18');v.get('diary-week-work').value='';v.listeners.input({target:v.get('diary-week-work')});
  select('2026-10-25');select('2026-10-18');assert.equal(v.get('diary-week-work').value,'');
  const w=await boot('#guide',v.storage);assert.equal(w.get('diary-week-work').value,'');
});
