import { DEFAULT_SCENARIO, clone } from './schema.js';
import { DEFAULT_MARGINAL, marginalEffects } from './marginal.js';

export function createLearningDemoScenario(){
  const scenario=clone(DEFAULT_SCENARIO);
  Object.assign(scenario.state,{cash:30000,assets:0,debt:0});
  Object.assign(scenario.plan,{work:40,learn:6,sleep:56,exercise:3,relation:7,leisure:14,care:42,buy:0,sell:0,repay:0});
  return scenario;
}

export const DEMO_GOALS = {
  learn:{label:'多学一点',action:'每周多学',metrics:['knowledge','cash','fatigue'],options:[
    {id:'work',source:'work',target:'learn',label:'少工作，多学习'},
    {id:'sleep',source:'sleep',target:'learn',label:'少睡眠，多学习'}
  ]},
  recover:{label:'少累一点',action:'每周多休息',metrics:['fatigue','cash','knowledge'],options:[
    {id:'work-to-sleep',source:'work',target:'sleep',label:'少工作，补睡眠'},
    {id:'work-to-leisure',source:'work',target:'leisure',label:'少工作，多休闲'}
  ]},
  income:{label:'增加收入',action:'每周多工作',metrics:['income','cash','fatigue','knowledge'],options:[
    {id:'leisure-to-work',source:'leisure',target:'work',label:'少休闲，多工作'},
    {id:'learn-to-work',source:'learn',target:'work',label:'少学习，多工作'}
  ]}
};

export function buildDecisionDemo(goal='learn'){
  if(!Object.hasOwn(DEMO_GOALS,goal))throw new RangeError('示例目标无效');
  const definition=clone(DEMO_GOALS[goal]),{options,metrics}=definition;
  const scenario=createLearningDemoScenario(),weeks=12;
  const runs=Object.fromEntries(options.map(({id,source,target})=>[id,marginalEffects(scenario,weeks,{}, {...DEFAULT_MARGINAL,source,target})]));
  if(options.some(({id})=>!runs[id].baselineFeasible))throw new Error('演示基准不可行，不能计算完整周期比较。');
  const previous=Object.fromEntries(options.map(({id})=>[id,runs[id].baseline]));
  let previousAmount=0;
  const rows=[1,2,4].map(amount=>{
    const row={amount,totalHours:amount*weeks,from:previousAmount,additionalHours:(amount-previousAmount)*weeks};
    for(const {id,source,target} of options){
      const point=runs[id].points.find(p=>p.amount===amount);
      const plan={...scenario.plan,[target]:scenario.plan[target]+amount,[source]:scenario.plan[source]-amount};
      row[id]={...point,plan,increment:point.feasible&&previous[id]?
        Object.fromEntries(metrics.map(k=>[k,(point.metrics[k]-previous[id][k])/row.additionalHours])):null};
      previous[id]=point.feasible?point.metrics:null;
    }
    const [first,second]=options.map(({id})=>row[id]);
    row.difference=first.feasible&&second.feasible?
      Object.fromEntries(metrics.map(k=>[k,second.metrics[k]-first.metrics[k]])):null;
    previousAmount=amount;
    return row;
  });
  return {goal,...definition,scenario,weeks,baseline:runs[options[0].id].baseline,rows};
}

export function buildLearningDemo(){
  const {scenario,weeks,baseline,rows}=buildDecisionDemo('learn');
  return {scenario,weeks,baseline,rows};
}
