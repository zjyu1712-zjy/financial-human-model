import { DEFAULT_SCENARIO, TIME_KEYS, UTILITY_LABELS, clone, validateScenario } from './schema.js';

export const clip=(x,lo=0,hi=100)=>Math.min(hi,Math.max(lo,x));
export const positive=x=>Math.max(0,x);
export const sum=xs=>xs.reduce((a,b)=>a+b,0);
export const saturate=(x,scale)=>100*(1-Math.exp(-positive(x)/scale));

// Raw stocks retain their own units. Only this observation map emits comparable display indices.
export function states(s,a,p){
  const body=clip(.45*s.health+.30*s.sleepQuality+.25*(100-s.fatigue));
  const focus=clip(.6*body+.4*(100-s.rumination));
  const cognition=clip((.35*s.knowledge+.25*s.calibration+.25*s.metacognition+.15*focus)*(1-.35*s.bias/100));
  const emotion=clip(.35*s.regulation+.25*s.motivation+.20*(100-s.rumination)+.20*(100-s.stress));
  const social=clip(.45*s.support+.35*s.trust+.20*s.network-.20*s.conflict);
  const reserveWeeks=s.cash/a.essential;
  const netWorth=s.cash+s.assets-s.debt;
  const reserve=clip(100*reserveWeeks/p.bufferWeeks);
  const solvency=clip(100*(s.cash+s.assets)/(s.cash+s.assets+s.debt+1));
  const finance=clip(.65*reserve+.35*solvency);
  const desire=clip(.4*s.clarity+.3*s.agency+.3*(100-s.comparison));
  return {body,cognition,emotion,social,finance,desire,focus,reserveWeeks,netWorth};
}

export function mechanisms(s,a,p){
  const x=states(s,a,p);
  const time=sum(TIME_KEYS.map(k=>a[k]));
  const sleepDebt=positive(56-a.sleep);
  const load=clip(.50*a.work+.30*a.care+.35*s.stress+.25*s.comparison+.20*s.rumination+1.2*sleepDebt);
  const capacity=clip(.40*s.regulation+.20*s.support+.15*s.sleepQuality+.25*saturate(a.leisure+a.relation,14));
  const strain=positive(load-capacity);
  const channels={
    judgmentLoss:clip(.25*strain+.15*s.bias,0,60),
    consumptionLeak:a.discretionary*.15*strain/100,
    riskMultiplier:1+.50*s.bias/100+.50*strain/100,
    relationshipDamage:.05*strain,
    healthWear:.08*strain,
    agencyLoss:.15*strain
  };
  const workEfficiency=clip(Math.sqrt(s.health/100)*(.35+.65*x.cognition/100)*(1-.6*s.fatigue/100)*(1-channels.judgmentLoss/100),0,1);
  const learningEfficiency=clip(x.body/100*(.4+.6*s.motivation/100)*(1-s.bias/150)*(1-strain/150),0,1);
  return {x,time,sleepDebt,load,capacity,strain,channels,workEfficiency,learningEfficiency,effectiveWork:a.work*workEfficiency,effectiveLearn:a.learn*learningEfficiency};
}

export function step(s,a,p,weights,z=0,shockFactor=1){
  const m=mechanisms(s,a,p);
  const errors=[];
  if(m.time>168+1e-9)errors.push(`时间需 ${m.time.toFixed(1)} 小时，超过每周 168 小时`);
  if(a.sell>s.assets+1e-9)errors.push('卖出金额超过期初风险资产市值');
  const income=a.wage*m.effectiveWork*Math.max(0,1+a.incomeShock*shockFactor);
  const interest=s.debt*p.debtAPR/52;
  const principal=Math.min(a.repay,s.debt);
  const spending=a.essential+a.discretionary+a.learningSpend+m.channels.consumptionLeak;
  const cash=s.cash+income-spending-interest-principal-a.buy+a.sell;
  if(cash< -1e-8)errors.push(`现金缺口 ${(-cash).toFixed(2)} 元；未假定自动借款`);
  const holding=s.assets+a.buy-a.sell;
  const weeklySigma=p.annualVol/Math.sqrt(52)*m.channels.riskMultiplier;
  const downside=positive(holding)*weeklySigma*1.65;
  const lossCapacity=positive(cash-p.bufferWeeks*a.essential)+p.riskTolerance*positive(m.x.netWorth);
  const riskPressure=100*downside/(lossCapacity+a.essential);
  const proposed={income,interest,principal,spending,cash,holding,downside,lossCapacity,weeklySigma};
  if(errors.length)return {feasible:false,errors,mechanisms:m,proposed};

  const rawReturn=p.annualReturn/52+weeklySigma*z+a.marketShock*shockFactor;
  const assetReturn=Math.max(-1,rawReturn);
  const profit=holding*assetReturn;
  const overload=positive(a.work+a.learn+.5*a.care-50);
  const recovery=p.fatigueRecovery*(.5+.5*Math.min(1,a.sleep/56))*(.5+.5*s.sleepQuality/100);
  const knowledgeGain=p.learningGain*Math.sqrt(m.effectiveLearn)*(1-s.knowledge/100);
  const next={...s,
    cash:Math.max(0,cash),assets:holding+profit,debt:s.debt-principal,
    fatigue:clip(s.fatigue*(1-recovery)+.50*overload+.60*m.sleepDebt+m.channels.healthWear-.12*Math.min(a.exercise,5)),
    health:clip(s.health+.08*Math.min(a.exercise,5)*(1-s.health/100)-.015*positive(s.fatigue-60)-a.healthShock*shockFactor),
    sleepQuality:clip(s.sleepQuality+.04*(Math.min(a.sleep,63)-56)-.015*m.strain),
    knowledge:clip(s.knowledge*.999+knowledgeGain),
    calibration:clip(s.calibration+.015*m.effectiveLearn*(s.metacognition/100)*(1-s.calibration/100)),
    metacognition:clip(s.metacognition+.01*m.effectiveLearn*(1-s.metacognition/100)),
    bias:clip(s.bias+.01*m.strain-.02*m.effectiveLearn*s.metacognition/100),
    regulation:clip(s.regulation+.012*a.leisure*(1-s.regulation/100)-.008*m.strain),
    rumination:clip(.97*s.rumination+.06*m.strain-.02*a.leisure),
    stress:clip(.75*s.stress+.35*m.strain),
    motivation:clip(s.motivation+.015*(a.valueFit-50)-.015*m.strain),
    support:clip(s.support+.10*Math.sqrt(a.relation)*(1-s.support/100)-.015*s.conflict),
    trust:clip(s.trust+.08*Math.sqrt(a.relation)*(1-s.trust/100)-.02*s.conflict-m.channels.relationshipDamage),
    network:clip(s.network+.035*Math.sqrt(a.relation+a.work)*(1-s.network/100)),
    conflict:clip(.97*s.conflict+.08*m.strain-.04*a.relation),
    clarity:clip(s.clarity+.02*m.effectiveLearn*(1-s.clarity/100)),
    agency:clip(s.agency+.015*(a.valueFit-50)-.03*m.strain),
    comparison:clip(.98*s.comparison+.02*positive(a.discretionary-s.targetSpend)/Math.max(1,s.targetSpend)*100-.025*a.relation),
    targetSpend:s.targetSpend
  };
  const x=states(next,a,p);
  const unallocated=168-m.time;
  const voluntaryHours=unallocated+a.leisure+a.exercise+a.relation;
  const qualitySatisfaction=s.targetSpend>0 ? 100*Math.min(1,Math.log1p(a.discretionary)/Math.log1p(s.targetSpend)) : 100;
  const sustainableSpend=positive(income-a.essential-a.learningSpend-interest-principal);
  const aspirationGap=s.targetSpend>0 ? 100*positive(s.targetSpend-sustainableSpend)/s.targetSpend : 0;
  const valueMismatch=100-a.valueFit;
  const utility={
    safety:x.finance,
    autonomy:clip(.6*positive(s.agency-m.channels.agencyLoss)+.4*saturate(voluntaryHours,28)),
    quality:clip(.65*qualitySatisfaction+.35*saturate(a.leisure,12)),
    relation:x.social,
    growth:saturate(knowledgeGain,2),
    meaning:clip(.5*s.clarity+.5*a.valueFit)
  };
  const costs={emotion:p.emotionRate*m.strain,health:p.healthRate*positive(next.fatigue-60),desire:p.desireRate*(.6*aspirationGap+.4*valueMismatch),risk:p.riskRate*riskPressure};
  const utilityTotal=sum(Object.entries(utility).map(([k,v])=>v*weights[k]))/sum(Object.values(weights));
  const costTotal=sum(Object.values(costs));
  const ledger={income,spending,interest,principal,buy:a.buy,sell:a.sell,profit,cashBefore:s.cash,cashAfter:next.cash,assetsBefore:s.assets,assetsAfter:next.assets,debtBefore:s.debt,debtAfter:next.debt,
    netWorthBefore:m.x.netWorth,netWorthAfter:x.netWorth,identityResidual:x.netWorth-m.x.netWorth-(income-spending-interest+profit)};
  return {feasible:true,errors:[],next,states:x,mechanisms:m,ledger,utility,costs,utilityTotal,costTotal,net:utilityTotal-costTotal,
    diagnostics:{downside,lossCapacity,riskPressure,assetReturn,returnFloored:rawReturn< -1,knowledgeGain,sustainableSpend,aspirationGap,valueMismatch,unallocated},
    warnings:[...(downside>lossCapacity?['风险压力超过设定容忍线']:[]),...(next.cash<p.bufferWeeks*a.essential?['现金缓冲低于目标']:[]),...(m.strain>0?['情绪负荷超过调节容量']:[])]};
}

// Mulberry32 and Box-Muller: repeatable scenario noise, not an empirical market generator.
export function normalSequence(seed,count){
  let t=seed>>>0;
  const uniform=()=>{t+=0x6D2B79F5;let a=t;a=Math.imul(a^(a>>>15),a|1);a^=a+Math.imul(a^(a>>>7),a|61);return ((a^(a>>>14))>>>0)/4294967296;};
  return Array.from({length:count},()=>Math.sqrt(-2*Math.log(Math.max(1e-12,uniform())))*Math.cos(2*Math.PI*uniform()));
}

export function validateSchedule(schedule={}){
  if(!schedule || typeof schedule!=='object' || Array.isArray(schedule))return ['逐周计划须为以周数为键的对象'];
  const errors=[];
  for(const [week,patch] of Object.entries(schedule)){
    if(!/^[1-9]\d*$/.test(week) || Number(week)>52 || !patch || typeof patch!=='object' || Array.isArray(patch)){errors.push('周数须为 1–52，内容为行动字段');continue;}
    const trial=clone(DEFAULT_SCENARIO);trial.plan={...trial.plan,buy:0,sell:0,...patch};
    errors.push(...validateScenario(trial).map(e=>`第 ${week} 周：${e}`));
  }
  return errors;
}

export function simulate(scenario,weeks=12,options={}){
  const errors=validateScenario(scenario);
  errors.push(...validateSchedule(options.schedule||{}));
  if(!Number.isInteger(weeks) || weeks<1 || weeks>52)errors.push('周期须为 1–52 整周');
  if(errors.length)throw new RangeError(errors.join('；'));
  let current={...scenario.state},total=0;
  const frames=[];
  const draws=options.stochastic ? normalSequence(options.seed??42,weeks) : Array(weeks).fill(0);
  for(let t=0;t<weeks;t++){
    const plan={...scenario.plan,...(options.schedule?.[t+1]||{})};
    const weeklyErrors=validateScenario({...scenario,plan});
    if(weeklyErrors.length)throw new RangeError(weeklyErrors.join('；'));
    const result=step(current,plan,scenario.parameters,scenario.weights,draws[t],scenario.parameters.shockRetention**t);
    frames.push({...result,week:t+1});
    if(!result.feasible)return {feasible:false,frames,failedWeek:t+1,errors:result.errors,total:null,partialTotal:total,final:current};
    total+=scenario.parameters.beta**t*result.net;
    current=result.next;
  }
  return {feasible:true,frames,total,final:current,errors:[]};
}

export function percentile(values,q){
  if(!values.length)return null;
  const sorted=[...values].sort((a,b)=>a-b),pos=(sorted.length-1)*q,i=Math.floor(pos);
  return sorted[i]+(sorted[Math.min(i+1,sorted.length-1)]-sorted[i])*(pos-i);
}

export function ensemble(scenario,weeks=12,schedule={},count=80,seed=371){
  if(!Number.isInteger(count)||count<1||count>500)throw new RangeError('路径数需为 1–500');
  const runs=Array.from({length:count},(_,i)=>simulate(scenario,weeks,{schedule,stochastic:true,seed:seed+i}));
  const complete=runs.filter(r=>r.feasible);
  const totals=complete.map(r=>r.total);
  return {count,completed:complete.length,failureRate:1-complete.length/count,mean:totals.length?sum(totals)/totals.length:null,p10:percentile(totals,.1),p50:percentile(totals,.5),p90:percentile(totals,.9),
    wealth10:percentile(complete.map(r=>r.final.cash+r.final.assets-r.final.debt),.1),wealth90:percentile(complete.map(r=>r.final.cash+r.final.assets-r.final.debt),.9),runs};
}

export function sensitivity(scenario,weeks,schedule={}){
  const base=simulate(scenario,weeks,{schedule});
  if(!base.feasible)return [];
  const ranges={fatigueRecovery:[.05,.8],learningGain:[.1,4],annualReturn:[-.3,.4],annualVol:[.01,1],emotionRate:[0,1],desireRate:[0,1]};
  return Object.entries(ranges).map(([key,[lo,hi]])=>{
    const center=scenario.parameters[key],delta=Math.max(Math.abs(center)*.2,(hi-lo)*.02);
    const values=[Math.max(lo,center-delta),Math.min(hi,center+delta)];
    const outcomes=values.map(value=>simulate({...scenario,parameters:{...scenario.parameters,[key]:value}},weeks,{schedule}));
    return {key,values,deltas:outcomes.map(r=>r.feasible?r.total-base.total:null),span:outcomes.every(r=>r.feasible)?Math.abs(outcomes[1].total-outcomes[0].total):Infinity};
  }).sort((a,b)=>b.span-a.span);
}

export function comparePlans(current,baseline,weeks,schedule={},baselineSchedule={}){
  const a=simulate(current,weeks,{schedule}),b=simulate(baseline,weeks,{schedule:baselineSchedule});
  const samePreferences=Object.keys(UTILITY_LABELS).every(k=>current.weights[k]===baseline.weights[k]) && ['beta','emotionRate','healthRate','desireRate','riskRate'].every(k=>current.parameters[k]===baseline.parameters[k]);
  const sameStart=Object.keys(current.state).every(k=>current.state[k]===baseline.state[k]);
  const sameMechanism=Object.keys(current.parameters).every(k=>current.parameters[k]===baseline.parameters[k]);
  return {current:a,baseline:b,delta:a.feasible&&b.feasible?a.total-b.total:null,samePreferences,sameStart,sameMechanism};
}

export function calibrationTemplate(scenario){
  return {version:'observations-v1',note:'示例结构，不是观测数据。每条填写当周期初实际状态、实际行动及下周期初观测；week 严格递增。至少 6 条。',records:Array.from({length:6},(_,i)=>({week:i+1,scenario:clone(scenario),observed:{fatigue:null,knowledge:null}}))};
}

export function calibrate(data){
  if(data?.version!=='observations-v1'||!Array.isArray(data.records)||data.records.length<6||data.records.length>260)throw new Error('需 6–260 条真实周记录，格式为 observations-v1');
  const records=data.records;
  records.forEach((r,i)=>{
    if(!Number.isInteger(r.week)||r.week<1||(i && r.week<=records[i-1].week))throw new Error('记录须按周数严格递增');
    const errors=validateScenario(r.scenario);if(errors.length)throw new Error(`第 ${r.week} 周：${errors.join('；')}`);
    for(const key of ['fatigue','knowledge'])if(!Number.isFinite(r.observed?.[key])||r.observed[key]<0||r.observed[key]>100)throw new Error(`第 ${r.week} 周缺少真实 ${key} 观测`);
    if(!simulate(r.scenario,1).feasible)throw new Error(`第 ${r.week} 周资源约束不可行`);
  });
  const split=Math.max(4,Math.floor(records.length*.7)),train=records.slice(0,split),test=records.slice(split);
  const mse=(rows,overrides)=>sum(rows.map(r=>{
    const run=simulate({...r.scenario,parameters:{...r.scenario.parameters,...overrides}},1);
    return sum(['fatigue','knowledge'].map(k=>(run.final[k]-r.observed[k])**2))/2;
  }))/rows.length;
  let best={mse:Infinity,parameters:null};
  for(const fatigueRecovery of [.1,.2,.3,.4,.5,.6,.7])for(const learningGain of [.4,.8,1.2,1.6,2,2.4,3]){
    const parameters={fatigueRecovery,learningGain},error=mse(train,parameters);
    if(error<best.mse)best={mse:error,parameters};
  }
  const before=mse(test,{}),after=mse(test,best.parameters);
  return {trainCount:train.length,testCount:test.length,parameters:best.parameters,trainRMSE:Math.sqrt(best.mse),holdoutBefore:Math.sqrt(before),holdoutAfter:Math.sqrt(after),improved:after<before,
    note:'仅试拟合疲劳恢复和知识增益两个系数；不能识别全部因果关系，也不校准个人价值权重。保留集不改善时不要采用。'};
}
