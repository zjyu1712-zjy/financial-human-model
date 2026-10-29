import { TIME_KEYS, UTILITY_LABELS, clone } from './schema.js';
import { simulate, sum } from './model.js';

export const DEFAULT_MARGINAL = {target:'learn',source:'work',step:1,frequency:'weekly',week:1};
export const MARGINAL_METRICS = {
  cash:{label:'手上剩的钱',unit:'元'},wealth:{label:'扣掉欠款后的资产',unit:'元'},
  fatigue:{label:'累的程度',unit:'分'},sleepDebt:{label:'估计欠的睡眠',unit:'小时'},knowledge:{label:'学到多少',unit:'分'},
  income:{label:'这段时间赚的钱',unit:'元'},effectiveLearn:{label:'学习效果（折算小时）',unit:'小时'},
  body:{label:'身体和精力',unit:'分'},cognition:{label:'知识和判断',unit:'分'},
  emotion:{label:'心情和动力',unit:'分'},social:{label:'关系和帮助',unit:'分'},
  finance:{label:'钱和欠款的情况',unit:'分'},desire:{label:'想要什么，能否做主',unit:'分'},
  objective:{label:'按个人偏好的综合得分',unit:'分'}
};
export const MARGINAL_CONTRIBUTIONS = {
  ...UTILITY_LABELS,emotionCost:'情绪成本',healthCost:'疲劳成本',desireCost:'欲望成本',riskCost:'风险成本'
};

export function validateMarginal(config,weeks){
  if(!config || typeof config!=='object' || Array.isArray(config))return ['边际设置须为对象'];
  const errors=[];
  if(Object.keys(config).some(k=>!Object.hasOwn(DEFAULT_MARGINAL,k)))errors.push('边际设置含未定义字段');
  if(!TIME_KEYS.includes(config.target))errors.push('增加项须为时间变量');
  if(![...TIME_KEYS,'unallocated'].includes(config.source))errors.push('来源须为时间变量或未分配时间');
  if(config.target===config.source)errors.push('增加项与时间来源不能相同');
  if(!Number.isFinite(config.step)||config.step<.01||config.step>168)errors.push('调整步长须在 0.01–168 小时之间');
  if(!['weekly','once'].includes(config.frequency))errors.push('持续方式须为每周或单周');
  if(!Number.isInteger(config.week)||config.week<1||config.week>52 || (config.frequency==='once'&&config.week>weeks))errors.push('单次调整周须在当前周期内');
  return errors;
}

function outcome(run,end,scenario){
  const frames=run.frames.slice(0,end),last=frames.at(-1);
  if(frames.length!==end || frames.some(f=>!f.feasible))return null;
  const weights=scenario.weights,weightSum=sum(Object.values(weights));
  const contributions=Object.fromEntries(Object.keys(MARGINAL_CONTRIBUTIONS).map(k=>[k,0]));
  for(const f of frames){
    const discount=scenario.parameters.beta**(f.week-1);
    for(const k of Object.keys(UTILITY_LABELS))contributions[k]+=discount*f.utility[k]*weights[k]/weightSum;
    for(const [k,v] of Object.entries(f.costs))contributions[k+'Cost']-=discount*v;
  }
  return {metrics:{cash:last.next.cash,wealth:last.states.netWorth,fatigue:last.next.fatigue,sleepDebt:last.next.sleepDebt,knowledge:last.next.knowledge,
    income:sum(frames.map(f=>f.ledger.income)),effectiveLearn:sum(frames.map(f=>f.mechanisms.effectiveLearn)),
    ...Object.fromEntries(['body','cognition','emotion','social','finance','desire'].map(k=>[k,last.states[k]])),
    objective:sum(frames.map(f=>scenario.parameters.beta**(f.week-1)*f.net))},contributions};
}
const subtract=(a,b)=>Object.fromEntries(Object.keys(a).map(k=>[k,a[k]-b[k]]));
const divide=(a,d)=>Object.fromEntries(Object.keys(a).map(k=>[k,a[k]/d]));

// Change the actual merged plan in selected weeks, without changing either original input.
function perturb(scenario,weeks,schedule,config,amount){
  const adjusted=clone(schedule),selected=config.frequency==='once'?[config.week]:Array.from({length:weeks},(_,i)=>i+1);
  for(const week of selected){
    const plan={...scenario.plan,...schedule[week]};
    const available=config.source==='unallocated'?168-sum(TIME_KEYS.map(k=>plan[k])):plan[config.source];
    if(amount>available+1e-9)return {feasible:false,failedWeek:week,errors:[`第 ${week} 周来源只有 ${available.toFixed(2)} 小时，需要 ${amount.toFixed(2)} 小时`],schedule:null};
    if(plan[config.target]+amount>168)return {feasible:false,failedWeek:week,errors:[`第 ${week} 周增加项超过 168 小时`],schedule:null};
    const patch={...schedule[week],[config.target]:plan[config.target]+amount};
    if(config.source!=='unallocated')patch[config.source]=Math.max(0,plan[config.source]-amount);
    adjusted[week]=patch;
  }
  return {feasible:true,schedule:adjusted};
}

export function marginalEffects(scenario,weeks=12,schedule={},config=DEFAULT_MARGINAL){
  const errors=validateMarginal(config,weeks);
  if(errors.length)throw new RangeError(errors.join('；'));
  const base=simulate(scenario,weeks,{schedule}),firstWeek=config.frequency==='once'?config.week:1;
  const affectedWeeks=config.frequency==='once'?1:weeks;
  const baseline=base.feasible?outcome(base,weeks,scenario):null;
  const firstBase=outcome(base,firstWeek,scenario);
  const points=[.5,1,2,4].map(factor=>{
    const amount=config.step*factor,totalHours=amount*affectedWeeks;
    const empty={factor,amount,totalHours,feasible:false,metrics:null,delta:null,perHour:null,perStep:null,
      firstDelta:null,contributions:null,segment:null,errors:[],failedWeek:null};
    if(!base.feasible)return {...empty,errors:[`当前安排第 ${base.failedWeek} 周不可行，不能作为对照`,...base.errors],failedWeek:base.failedWeek};
    const changed=perturb(scenario,weeks,schedule,config,amount);
    if(!changed.feasible)return {...empty,errors:changed.errors,failedWeek:changed.failedWeek};
    const run=simulate(scenario,weeks,{schedule:changed.schedule});
    if(!run.feasible)return {...empty,errors:run.errors,failedWeek:run.failedWeek};
    const result=outcome(run,weeks,scenario),first=outcome(run,firstWeek,scenario);
    const delta=subtract(result.metrics,baseline.metrics);
    return {...empty,feasible:true,metrics:result.metrics,delta,perHour:divide(delta,totalHours),perStep:divide(delta,amount),
      firstDelta:subtract(first.metrics,firstBase.metrics),contributions:subtract(result.contributions,baseline.contributions)};
  });
  // Adjacent increments expose curvature; never extrapolate across an infeasible point.
  let previous=baseline?{feasible:true,amount:0,totalHours:0,metrics:baseline.metrics}:null;
  for(const point of points){
    if(previous?.feasible && point.feasible){
      const additionalHours=point.totalHours-previous.totalHours;
      point.segment={from:previous.amount,to:point.amount,additionalHours,
        perHour:divide(subtract(point.metrics,previous.metrics),additionalHours)};
    }
    previous=point;
  }
  return {method:'forward-finite-difference',path:'deterministic-z0',config:clone(config),weeks,affectedWeeks,firstWeek,
    baseline:baseline?.metrics??null,firstBaseline:firstBase?.metrics??null,baselineFeasible:base.feasible,
    baselineErrors:base.errors,baselineFailedWeek:base.failedWeek??null,points,primary:points[1]};
}
