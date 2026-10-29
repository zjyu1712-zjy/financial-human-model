import { DEFAULT_SCENARIO, clone } from './schema.js';
import { simulate } from './model.js';
import { simulate as legacySimulate } from './legacy-model.js';

export const SLEEP_CASES={
  original:{label:'原例：需求8小时',need:8,debt:0},
  higherNeed:{label:'需求改为9小时',need:9,debt:0},
  existingDebt:{label:'已有14小时睡眠债',need:8,debt:14}
};
export function compareSleepModels(scenario=DEFAULT_SCENARIO,weeks=52,source='unallocated',amount=12){
  if(!['unallocated','leisure'].includes(source)||!Number.isFinite(amount)||amount<0)throw new Error('睡眠对照配置无效');
  const adjusted=clone(scenario);adjusted.plan.sleep+=amount;
  if(source==='leisure')adjusted.plan.leisure-=amount;
  const summarize=(run,legacy)=>{
    if(!run.feasible)return {feasible:false,errors:run.errors,failedWeek:run.failedWeek};
    const series=[{week:0,fatigue:scenario.state.fatigue,sleepDebt:legacy?null:scenario.state.sleepDebt},...run.frames.map(f=>({week:f.week,fatigue:f.next.fatigue,sleepDebt:legacy?null:f.next.sleepDebt}))];
    const burden=run.frames.reduce((n,f)=>n+f.next.fatigue,0);
    return {feasible:true,series,finalFatigue:run.final.fatigue,averageFatigue:burden/weeks,fatigueBurden:burden,sleepDebt:legacy?null:run.final.sleepDebt,cash:run.final.cash,
      effectiveLearn:run.frames.reduce((n,f)=>n+f.mechanisms.effectiveLearn,0),debtRepaid:legacy?null:run.frames.reduce((n,f)=>n+f.mechanisms.sleep.repaid,0)};
  };
  const variants=[['legacy',legacySimulate],['revised',simulate]].map(([key,engine])=>{
    const original=summarize(engine(scenario,weeks),key==='legacy'),changed=summarize(engine(adjusted,weeks),key==='legacy');
    const delta=original.feasible&&changed.feasible?Object.fromEntries(['finalFatigue','averageFatigue','fatigueBurden','cash','effectiveLearn'].map(k=>[k,changed[k]-original[k]])):null;
    return {key,original,changed,delta};
  });
  return {weeks,source,amount,totalHours:weeks*amount,scenario:clone(scenario),variants};
}
export function sleepDemo(key='original',source='unallocated'){
  if(!Object.hasOwn(SLEEP_CASES,key))throw new Error('未知睡眠示例');
  const s=clone(DEFAULT_SCENARIO),c=SLEEP_CASES[key];s.parameters.sleepNeed=c.need;s.state.sleepDebt=c.debt;
  return compareSleepModels(s,52,source,12);
}
