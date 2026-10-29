import { clone, TIME_KEYS } from './schema.js';
import { simulate } from './model.js';

export const LIMIT_FIELDS = {
  minCash:{label:'最低现金',unit:'元',max:1e9},
  minSleep:{label:'每周最低睡眠',unit:'小时',max:168},
  maxIncomeLoss:{label:'最多减少收入',unit:'元',max:1e9}
};
export const DEFAULT_LIMITS = {minCash:null,minSleep:null,maxIncomeLoss:null};
export function relativePercent(value,reference){
  if(!Number.isFinite(value)||!Number.isFinite(reference)||reference<=1e-9)return null;
  const result=(value-reference)/reference*100;
  return Number.isFinite(result)?result:null;
}
export function decodeLimits(input=DEFAULT_LIMITS){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!Object.hasOwn(LIMIT_FIELDS,k)))throw new Error('个人底线格式无效');
  const result={};
  for(const [key,field] of Object.entries(LIMIT_FIELDS)){
    const value=input[key];
    if(value!==null&&(!Number.isFinite(value)||value<0||value>field.max))throw new Error(`${field.label}须为0至${field.max}${field.unit}，或留空`);
    result[key]=value;
  }
  return result;
}

// Reuse the physical model with the same actual weekly time exchange as marginalEffects.
export function guidePath(scenario,weeks,schedule={},exchange=null){
  const adjusted=clone(schedule);
  if(exchange)for(let week=1;week<=weeks;week++){
    const {source,target,amount}=exchange,a={...scenario.plan,...schedule[week]};
    if(!TIME_KEYS.includes(target)||![...TIME_KEYS,'unallocated'].includes(source)||source===target||!Number.isFinite(amount)||amount<=0)throw new Error('时间交换无效');
    const free=source==='unallocated'?168-TIME_KEYS.reduce((n,k)=>n+a[k],0):a[source];
    if(amount>free+1e-9||a[target]+amount>168)return null;
    adjusted[week]={...schedule[week],[target]:a[target]+amount};
    if(source!=='unallocated')adjusted[week][source]=Math.max(0,a[source]-amount);
  }
  const run=simulate(scenario,weeks,{schedule:adjusted});
  if(!run.feasible)return null;
  const planned=Object.fromEntries(TIME_KEYS.map(k=>[k,0]));
  const series=[{week:0,cash:scenario.state.cash,fatigue:scenario.state.fatigue,sleepDebt:scenario.state.sleepDebt,knowledge:scenario.state.knowledge,income:0,effectiveLearn:0}];
  let income=0,effectiveLearn=0;
  for(const frame of run.frames){
    const a={...scenario.plan,...adjusted[frame.week]};
    for(const k of TIME_KEYS)planned[k]+=a[k];
    income+=frame.ledger.income;effectiveLearn+=frame.mechanisms.effectiveLearn;
    series.push({week:frame.week,cash:frame.next.cash,fatigue:frame.next.fatigue,sleepDebt:frame.next.sleepDebt,knowledge:frame.next.knowledge,income,effectiveLearn,sleep:a.sleep});
  }
  const extreme=(points,key,sign)=>points.reduce((a,b)=>sign*b[key]>sign*a[key]?b:a);
  const cash=extreme(series,'cash',-1),fatigue=extreme(series,'fatigue',1),sleep=extreme(series.slice(1),'sleep',-1);
  // Equal one-week samples of closing fatigue; the starting point is not an extra week.
  const fatigueBurden=series.slice(1).reduce((total,p)=>total+p.fatigue,0);
  return {series,planned,income,effectiveLearn,fatigueBurden,averageFatigue:fatigueBurden/weeks,minimumCash:{value:cash.cash,week:cash.week},
    maximumFatigue:{value:fatigue.fatigue,week:fatigue.week},minimumSleep:{value:sleep.sleep,week:sleep.week}};
}

export function limitMargins(path,baseline,input=DEFAULT_LIMITS){
  const limits=decodeLimits(input);
  if(!path||!baseline)return [];
  const values={minCash:{...path.minimumCash,threshold:limits.minCash},minSleep:{...path.minimumSleep,threshold:limits.minSleep},
    maxIncomeLoss:{value:path.income,week:path.series.at(-1).week,threshold:baseline.income-(limits.maxIncomeLoss??0)}};
  return Object.keys(limits).filter(k=>limits[k]!==null).map(key=>{
    const x=values[key],margin=x.value-x.threshold;
    return {key,...x,limit:limits[key],margin,ok:margin>=-1e-8,unit:LIMIT_FIELDS[key].unit};
  });
}

export const DEFAULT_COMPARE_VIEW = {pairs:{learn:[null,null],recover:[null,null],income:[null,null]},metric:'effectiveLearn',trendOpen:false,detailOpen:false,limitsOpen:false};
export function decodeCompareView(input=DEFAULT_COMPARE_VIEW){
  if(!input||!['cash','fatigue','effectiveLearn','sleepDebt'].includes(input.metric)||['trendOpen','detailOpen','limitsOpen'].some(k=>typeof input[k]!=='boolean'))throw new Error('对照视图设置无效');
  for(const goal of ['learn','recover','income']){
    const pair=input.pairs?.[goal];
    if(!Array.isArray(pair)||pair.length!==2||pair.some(v=>v!==null&&(typeof v!=='string'||v.length>50))||(pair[0]!==null&&pair[0]===pair[1]))throw new Error('对照方案设置无效');
  }
  return clone(input);
}
