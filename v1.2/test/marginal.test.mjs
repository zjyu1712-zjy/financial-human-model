import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SCENARIO, TIME_KEYS, clone } from '../src/schema.js';
import { simulate } from '../src/model.js';
import { DEFAULT_MARGINAL, marginalEffects, validateMarginal } from '../src/marginal.js';

const near=(a,b,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
const config=patch=>({...DEFAULT_MARGINAL,...patch});
function example(){
  const s=clone(DEFAULT_SCENARIO);
  Object.assign(s.state,{cash:30000,assets:0,debt:0});
  Object.assign(s.plan,{sleep:56,work:40,learn:6,exercise:3,relation:7,leisure:14,care:42,buy:0,sell:0,repay:0});
  return s;
}

test('one recurring hour matches explicit plan simulation and has a 12-hour denominator',()=>{
  const s=example(),r=marginalEffects(s,12),p=r.primary;
  const changed=clone(s);changed.plan.learn+=1;changed.plan.work-=1;
  const base=simulate(s,12),alternative=simulate(changed,12);
  assert.equal(p.feasible,true);assert.equal(p.totalHours,12);
  for(const k of ['cash','fatigue','knowledge']){
    near(p.metrics[k],alternative.final[k]);near(p.delta[k],alternative.final[k]-base.final[k]);
    near(p.perHour[k],p.delta[k]/12);near(p.perStep[k],p.delta[k]);
    near(p.firstDelta[k],alternative.frames[0].next[k]-base.frames[0].next[k]);
  }
  near(p.delta.objective,alternative.total-base.total);
});

test('a single intervention has one-hour denominator and follows through later weeks',()=>{
  const s=example(),r=marginalEffects(s,12,{},config({frequency:'once',week:3}));
  const alt=simulate(s,12,{schedule:{3:{work:39,learn:7}}});
  assert.equal(r.firstWeek,3);assert.equal(r.affectedWeeks,1);assert.equal(r.primary.totalHours,1);
  near(r.primary.metrics.cash,alt.final.cash);near(r.primary.perHour.cash,r.primary.delta.cash);
  const b=simulate(s,12);
  near(r.primary.firstDelta.fatigue,alt.frames[2].next.fatigue-b.frames[2].next.fatigue);
  assert.notEqual(r.primary.delta.cash,r.primary.firstDelta.cash);
});

test('week-specific overrides are perturbed relative to their actual values, with unrelated fields retained',()=>{
  const s=example(),schedule={2:{work:32,learn:14,discretionary:450},4:{work:34,learn:12},20:{work:30}};
  const r=marginalEffects(s,4,schedule),adjusted={
    1:{work:39,learn:7},2:{work:31,learn:15,discretionary:450},3:{work:39,learn:7},4:{work:33,learn:13},20:{work:30}
  };
  const expected=simulate(s,4,{schedule:adjusted});
  near(r.primary.metrics.cash,expected.final.cash);near(r.primary.metrics.knowledge,expected.final.knowledge);
});

test('does not mutate scenario, weekly overrides, or settings',()=>{
  const s=example(),schedule={2:{work:32,learn:14}},c=config({step:2});
  const before=JSON.stringify([s,schedule,c]);marginalEffects(s,12,schedule,c);
  assert.equal(JSON.stringify([s,schedule,c]),before);
});

test('sources matter: sleep sacrifice and work sacrifice have different outcomes',()=>{
  const s=example(),work=marginalEffects(s,12,{},config({step:6})),sleep=marginalEffects(s,12,{},config({step:6,source:'sleep'}));
  near(work.primary.metrics.cash,32295.26039383,1e-5);
  near(sleep.primary.metrics.fatigue,58.45293447247215,1e-5);
  assert.ok(sleep.primary.delta.fatigue>work.primary.delta.fatigue+20);
});

test('unused time can fund an increase but cannot be double-booked',()=>{
  const spare=marginalEffects(DEFAULT_SCENARIO,12,{},config({source:'unallocated'}));
  assert.equal(spare.primary.feasible,true);
  const full=marginalEffects(example(),12,{},config({source:'unallocated'}));
  assert.equal(full.primary.feasible,false);assert.equal(full.primary.delta,null);
  assert.match(full.primary.errors.join(),/来源只有 0.00/);
});

test('a scheduled shortage reports the exact week without clipping the requested change',()=>{
  const r=marginalEffects(example(),4,{2:{work:.5}},config({step:1}));
  assert.equal(r.points[0].feasible,true);assert.equal(r.primary.feasible,false);
  assert.equal(r.primary.failedWeek,2);assert.equal(r.primary.amount,1);
  assert.equal(r.primary.perHour,null);assert.equal(r.primary.metrics,null);
});

test('a one-week change does not consume a source in other weeks',()=>{
  const r=marginalEffects(example(),4,{2:{work:0}},config({frequency:'once',week:1}));
  assert.equal(r.primary.feasible,true);
});

test('a later cash failure cannot receive a whole-period marginal result',()=>{
  const s=example();s.state.cash=0;
  const r=marginalEffects(s,12,{},config({target:'leisure',source:'work',step:20}));
  assert.equal(r.baselineFeasible,true);assert.equal(r.primary.feasible,false);
  assert.match(r.primary.errors.join(),/现金缺口/);
  assert.equal(r.primary.delta,null);assert.equal(r.primary.contributions,null);
});

test('infeasible baseline does not yield a plausible-looking comparison',()=>{
  const s=example();s.plan.learn+=1;
  const r=marginalEffects(s,12);assert.equal(r.baselineFeasible,false);assert.equal(r.baseline,null);
  for(const p of r.points){assert.equal(p.feasible,false);assert.equal(p.delta,null);assert.equal(p.segment,null);}
});

test('score contributions reconcile exactly to the discounted net objective difference',()=>{
  const s=example();s.weights.growth=5;s.parameters.beta=.9;
  const r=marginalEffects(s,12,{},config({source:'sleep',step:8}));
  for(const p of r.points.filter(p=>p.feasible)){
    near(Object.values(p.contributions).reduce((a,b)=>a+b,0),p.delta.objective);
  }
  assert.ok(r.primary.contributions.healthCost<0);
});

test('a reduction in a cost has a positive contribution to net utility',()=>{
  const s=example();s.state.fatigue=90;
  const r=marginalEffects(s,4,{},config({target:'leisure',source:'work',step:4}));
  assert.ok(r.primary.contributions.healthCost>0);
});

test('preferences alter evaluation, not physical marginal effects',()=>{
  const s=example(),a=marginalEffects(s,12);s.weights.growth=9;
  const b=marginalEffects(s,12);
  near(a.primary.delta.cash,b.primary.delta.cash);near(a.primary.delta.fatigue,b.primary.delta.fatigue);
  assert.notEqual(a.primary.delta.objective,b.primary.delta.objective);
});

test('adjacent increments have their own denominators and do not assume linearity',()=>{
  const r=marginalEffects(example(),12);
  let previous={amount:0,totalHours:0,metrics:r.baseline};
  for(const p of r.points){
    near(p.segment.perHour.knowledge,(p.metrics.knowledge-previous.metrics.knowledge)/(p.totalHours-previous.totalHours));
    near(p.segment.additionalHours,(p.amount-previous.amount)*12);previous=p;
  }
  assert.notEqual(r.points[0].segment.perHour.knowledge,r.points[3].segment.perHour.knowledge);
});

test('all seven time variables can be examined as targets',()=>{
  for(const target of TIME_KEYS){
    const r=marginalEffects(DEFAULT_SCENARIO,4,{},config({target,source:'unallocated'}));
    assert.equal(r.primary.feasible,true);
    assert.ok(Object.values(r.primary.delta).every(Number.isFinite));
  }
});

test('zero source, maximum valid single transfer, and oversized sweep amounts are handled',()=>{
  const s=example();s.plan.work=0;
  assert.equal(marginalEffects(s,1).primary.feasible,false);
  const full=example();full.plan.work=168;
  for(const k of TIME_KEYS)if(k!=='work')full.plan[k]=0;
  const r=marginalEffects(full,1,{},config({step:168}));
  assert.equal(r.primary.feasible,true);assert.equal(r.points[2].feasible,false);
});

test('invalid controls are rejected instead of producing Infinity or silent fallbacks',()=>{
  for(const patch of [{step:0},{step:-1},{step:.001},{step:NaN},{step:Infinity},{step:'1'},{step:169},
    {source:'learn'},{target:'cash'},{source:'cash'},{frequency:'sometimes'},
    {frequency:'once',week:13},{week:1.5},{unknown:1}]){
    assert.throws(()=>marginalEffects(example(),12,{},config(patch)),RangeError);
  }
  assert.ok(validateMarginal(null,12).length);assert.ok(validateMarginal([],12).length);
});

test('tiny steps remain finite at the zero-learning boundary',()=>{
  const s=example();s.plan.learn=0;
  const r=marginalEffects(s,12,{},config({step:.01}));
  assert.ok(r.primary.delta.knowledge>0);
  assert.ok(Object.values(r.primary.perHour).every(Number.isFinite));
});

test('finite-difference results are reproducible and contain no simulated statistical claims',()=>{
  const a=marginalEffects(example(),12),b=marginalEffects(example(),12);
  assert.deepEqual(a,b);assert.equal(a.path,'deterministic-z0');
  assert.equal(a.method,'forward-finite-difference');
});
