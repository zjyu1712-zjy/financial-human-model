import test from 'node:test';
import assert from 'node:assert/strict';
import { createLearningDemoScenario } from '../src/demo.js';
import { DEFAULT_GUIDE, buildDecisionGuide } from '../src/guide.js';
import { DEFAULT_LIMITS } from '../src/comparison.js';
import { VERSION, clone } from '../src/schema.js';
import { SOURCE_FIELDS, SOURCE_LABELS, newSources, decodeSources, reconcileSources, setSource, localDate,
  createTrial, decodeArchive, appendTrial, appendReview, deleteTrial } from '../src/records.js';

function draft(id='trial_1'){
  const scenario=createLearningDemoScenario();
  return {id,createdAt:'2026-11-11T08:09:10.123Z',startDate:'2026-11-11',reviewDate:'2026-11-18',
    intent:'学完一个单元',stopRule:'工作职责受影响时停下',note:'<保留原文>',scenario,
    schedule:{1:{work:39}},weeks:4,config:{...DEFAULT_GUIDE},limits:{...DEFAULT_LIMITS,minCash:500},
    choiceId:'work',sources:newSources(scenario)};
}
const review=(id='review_1')=>({id,date:'2026-11-14',execution:'按计划调整',outcome:'完成一半',reason:'临时加班',nextStep:'换到周末'});

test('all 12 key inputs have explicit default or legacy-unknown sources tied to their values',()=>{
  const scenario=createLearningDemoScenario(),defaults=newSources(scenario),legacy=decodeSources(undefined,scenario);
  assert.deepEqual(SOURCE_FIELDS.map(f=>f.id).sort(),[
    'plan.work','plan.learn','plan.sleep','plan.leisure','plan.wage','plan.essential','state.cash','state.fatigue',
    'state.sleepDebt','state.sleepQuality','parameters.sleepNeed','parameters.fatigueRecovery'
  ].sort());
  assert.deepEqual(Object.keys(SOURCE_LABELS).sort(),['default','estimate','record','unknown']);
  for(const {id,group,key,label,unit} of SOURCE_FIELDS){
    assert.equal(id,`${group}.${key}`);assert.ok(label&&unit);
    assert.deepEqual(defaults[id],{kind:'default',date:'',note:'',value:scenario[group][key]});
    assert.deepEqual(legacy[id],{...defaults[id],kind:'unknown'});
  }
});

test('provenance changes only for the edited key and cannot survive a change to its value',()=>{
  const scenario=createLearningDemoScenario(),before=newSources(scenario);
  const withWork=setSource(before,'plan.work',{kind:'record',date:'2024-02-29',note:'工时表'},scenario);
  const withCash=setSource(withWork,'state.cash',{kind:'estimate',date:'',note:'大约'},scenario);
  assert.equal(before['plan.work'].kind,'default');
  assert.deepEqual(decodeSources(clone(withCash),scenario),withCash);
  scenario.plan.work=41;
  assert.throws(()=>decodeSources(withCash,scenario),/数值/);
  const next=reconcileSources(withCash,scenario);
  assert.deepEqual(next['plan.work'],{kind:'unknown',date:'',note:'',value:41});
  assert.deepEqual(next['state.cash'],withCash['state.cash']);
  scenario.plan.work=40;
  assert.equal(reconcileSources(next,scenario)['plan.work'].kind,'unknown');
});

test('source imports reject incomplete, extra, invalid or oversized entries',()=>{
  const scenario=createLearningDemoScenario(),sources=newSources(scenario),key='plan.work',entry=sources[key];
  const absent=clone(sources);delete absent[key];
  for(const invalid of [null,[],{},absent,{...sources,other:entry},
    ...[{kind:'measured'},{date:'2023-02-29'},{date:'2024-2-09'},{date:null},{note:'x'.repeat(161)},
      {value:'40'},{value:Infinity},{unexpected:'x'}].map(patch=>({...sources,[key]:{...entry,...patch}}))])
    assert.throws(()=>decodeSources(invalid,scenario));
  assert.throws(()=>setSource(sources,'plan.other',{kind:'record',date:'',note:''},scenario));
  assert.throws(()=>setSource(sources,key,{kind:'record',date:'1900-02-29',note:''},scenario));
});

test('dates are local calendar dates; records reject impossible dates and review dates before start',()=>{
  assert.equal(localDate(new Date(2024,1,29,23,59)),'2024-02-29');
  assert.equal(localDate(new Date(2024,1,29,0,1)),'2024-02-29');
  assert.throws(()=>localDate(new Date(NaN)));
  const good=draft();
  assert.equal(createTrial({...good,startDate:'2024-02-29'}).startDate,'2024-02-29');
  for(const changes of [{startDate:'2026-02-29'},{startDate:'0000-01-01'},{startDate:'2026-11-31'},
    {reviewDate:'2026-11-10'},{reviewDate:'2026-11-18T00:00:00Z'},{createdAt:'2026-02-31T08:09:10.123Z'}])
    assert.throws(()=>createTrial({...good,...changes}),/日期|时间/);
});

test('trial creation saves the merged week-one plan and a fixed comparison from the available guide row',()=>{
  const input=draft(),guide=buildDecisionGuide(input.scenario,input.config,input),row=guide.available.find(r=>r.id===input.choiceId);
  input.sources=setSource(input.sources,'plan.work',{kind:'record',date:'2026-11-08',note:'历史工时'},input.scenario);
  const record=createTrial(input),saved=clone(record);
  assert.equal(record.modelVersion,VERSION);
  assert.equal(record.snapshot.scenario.plan.work,40);assert.equal(record.snapshot.schedule[1].work,39);
  assert.equal(record.summary.baselinePlan.work,39);assert.equal(record.summary.chosenPlan.work,37);
  assert.equal(record.summary.baseline.cash,row.baseline.cash);assert.equal(record.summary.chosen.cash,row.point.metrics.cash);
  assert.equal(record.summary.chosen.averageFatigue,row.path.averageFatigue);assert.deepEqual(record.summary.margins,row.margins);
  assert.equal(record.summary.totalHours,8);assert.equal(record.snapshot.sources['plan.work'].value,40);
  input.scenario.plan.work=5;input.schedule[1].work=3;input.config.amount=7;input.limits.minCash=null;
  assert.deepEqual(record,saved);
  assert.throws(()=>{record.snapshot.scenario.plan.work=1;},TypeError);
  assert.throws(()=>{record.summary.chosen.cash=1;},TypeError);
  assert.deepEqual(decodeArchive(JSON.parse(JSON.stringify([record]))),[record]);
  assert.throws(()=>createTrial({...draft(),choiceId:'sleep'}),/方案/);
  const stale=draft();stale.scenario.plan.work=38;
  assert.throws(()=>createTrial(stale),/数值/);
});

test('archive keeps same-day trials distinct and cannot exceed capacity or duplicate IDs',()=>{
  const original=decodeArchive(undefined),first=createTrial(draft()),second=createTrial(draft('trial_2'));
  const one=appendTrial(original,first),two=appendTrial(one,second);
  assert.deepEqual(original,[]);assert.deepEqual(one,[first]);assert.deepEqual(two,[first,second]);
  assert.throws(()=>two.pop(),TypeError);
  assert.throws(()=>appendTrial(two,first),/重复/);
  assert.throws(()=>decodeArchive([first,first]),/重复/);
  const atLimit=Array.from({length:100},(_,i)=>({...first,id:`trial_${i+3}`}));
  assert.throws(()=>appendTrial(atLimit,second),/100/);
  assert.throws(()=>decodeArchive([...atLimit,first]),/100/);
  assert.deepEqual(deleteTrial(two,'trial_1'),[second]);assert.deepEqual(two,[first,second]);
});

test('dated reviews append without replacing expectations, reject invalid dates and stop at capacity',()=>{
  const first=createTrial(draft()),archive=appendTrial([],first);
  const next=appendReview(archive,first.id,review());
  assert.deepEqual(archive[0].reviews,[]);
  assert.deepEqual(next[0].reviews,[review()]);assert.equal(next[0].snapshot,first.snapshot);assert.equal(next[0].summary,first.summary);
  assert.deepEqual(decodeArchive(clone(next)),next);
  assert.throws(()=>appendReview(next,first.id,review()),/重复/);
  assert.throws(()=>appendReview(next,first.id,{...review('review_2'),date:'2026-11-10'}),/日期/);
  assert.throws(()=>appendReview(next,first.id,{...review('review_2'),reason:'x'.repeat(501)}),/500/);
  const atLimit=Array.from({length:19},(_,i)=>review(`review_${i+2}`)).reduce((a,r)=>appendReview(a,first.id,r),next);
  assert.throws(()=>appendReview(atLimit,first.id,review('review_21')),/20/);
  assert.equal(atLimit[0].reviews.length,20);
  assert.throws(()=>decodeArchive([{...first,reviews:Array.from({length:21},(_,i)=>review(`review_${i}`))}]),/20/);
});

test('archive import rejects malformed snapshots, prose, reviews and manipulated financial results',()=>{
  const first=createTrial(draft()),snap=first.snapshot;
  for(const change of [{format:'other'},{modelVersion:'other'},{id:'not an id'},{id:'trial_1\n'},{intent:'x'.repeat(301)},
    {stopRule:'x'.repeat(201)},{note:'x'.repeat(2001)},{extra:'unknown'},
    {snapshot:{...snap,sources:undefined}},{snapshot:{...snap,weeks:5}},{snapshot:{...snap,weeks:undefined}},
    {snapshot:{...snap,schedule:{'53':{work:7}}}},{snapshot:{...snap,config:{...snap.config,unknown:1}}},
    {snapshot:{...snap,scenario:{...snap.scenario,extra:'x'}}},{snapshot:{...snap,choiceId:'sleep'}},
    {summary:{...first.summary,chosen:{...first.summary.chosen,cash:1}}},
    {summary:{...first.summary,extra:'unknown'}},{reviews:[review(),review()]},
    {reviews:[{...review(),date:'2026-11-32'}]}])assert.throws(()=>decodeArchive([{...first,...change}]));
  for(const invalid of [null,{},[null],new Array(1)])assert.throws(()=>decodeArchive(invalid));
});

test('archive creation cannot fill in an undefined comparison duration',()=>{
  assert.throws(()=>createTrial({...draft(),weeks:undefined}),/比较周期/);
});
