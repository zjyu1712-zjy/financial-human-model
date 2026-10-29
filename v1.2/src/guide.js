import { clone, TIME_KEYS, validateScenario, upgradeScenario } from './schema.js';
import { validateSchedule } from './model.js';
import { DEFAULT_MARGINAL, marginalEffects } from './marginal.js';
import { DEFAULT_LIMITS, decodeLimits, guidePath, limitMargins, LIMIT_FIELDS } from './comparison.js';

export const DEFAULT_GUIDE = {
  goal:'learn',amount:2,protectSleep:true,protectWork:false,protectLearn:false,incomeMode:'unknown'
};
export const GUIDE_AMOUNT = {min:0,max:48,step:1};
export function isGuideAmount(value){return Number.isInteger(value)&&value>=GUIDE_AMOUNT.min&&value<=GUIDE_AMOUNT.max;}
export const GUIDE_STEPS = [
  {label:'选择目标',heading:'guide-goal-title'},
  {label:'现状与底线',heading:'guide-boundaries-title'},
  {label:'比较代价',heading:'guide-compare-title'},
  {label:'选择方案',heading:'guide-choice-title'},
  {label:'试一周再回看',heading:'guide-review-title'}
];
export const GUIDE_GOALS = {
  learn:{label:'多学一点',action:'给学习腾时间',metric:'knowledge',direction:1,metrics:['knowledge','cash','fatigue'],
    hint:'看知识积累能否增加，同时比较现金和疲劳的变化。知识分不是考试成绩。',
    review:'实际多学了多久？完成了什么？工作、休息和疲劳付出了什么代价？',
    question:'这周准备学什么？执行后，与预期有什么不同？',
    placeholder:'例如：完成一个课程单元；记录实际学习时数、工作是否受影响、疲劳有没有变化。'},
  recover:{label:'少累一点',action:'给睡眠或休闲腾时间',metric:'fatigue',direction:-1,metrics:['fatigue','cash','knowledge'],
    hint:'看累积疲劳能否降低，同时比较收入与学习的代价。疲劳分不是健康诊断。',
    review:'腾出的时间真的用于休息了吗？实际疲劳有没有减轻？收入或学习受了什么影响？',
    question:'这周准备怎样休息？执行后，是否真的轻松了一点？',
    placeholder:'例如：减少两小时额外工作，留给散步或休息；记录实际工作、睡眠时数和疲劳感受。'},
  income:{label:'增加收入',action:'给有偿工作腾时间',metric:'income',direction:1,metrics:['income','cash','fatigue','knowledge'],
    hint:'只估算额外有效工时有报酬的情况；暂不估算涨薪、跳槽、投资或技能变现。',
    review:'额外工作实际获得了多少报酬？扣除新增支出后剩下多少？疲劳、睡眠和学习是否受影响？',
    question:'这周有哪些确定有报酬的额外工作？执行后，收入与代价如何？',
    placeholder:'例如：先确认两小时额外工作如何计酬；记录实际到账、额外费用和疲劳变化。'}
};
const option=(id,source,target,label,explanation)=>({id,source,target,label,explanation});
export const GUIDE_OPTIONS = {
  learn:[
    option('unallocated','unallocated','learn','用尚未安排的时间','不减少已有活动，但会占用原本可自由安排的缓冲。'),
    option('work','work','learn','少工作一点','用工作时间换学习，可能少一部分收入；现实中还要确认职责是否允许。'),
    option('leisure','leisure','learn','少一点自主休闲','学习增加了，自主休息和情绪调节的空间也会减少。'),
    option('sleep','sleep','learn','少睡一点','工作时长不变，但少睡可能通过疲劳降低后续效率，不是免费多学。')
  ],
  recover:[
    option('unallocated-to-sleep','unallocated','sleep','用空余时间补睡眠','不减少已有活动，但会占用自由缓冲。睡眠已经充足时，本模型未必算出额外改善。'),
    option('work-to-sleep','work','sleep','少工作，补睡眠','减轻工作负荷、增加睡眠，代价可能是收入减少；先确认工作职责允许。'),
    option('work-to-leisure','work','leisure','少工作，留点自主休闲','减少工作负荷，留出能自己支配的休息时间，同时可能少一部分收入。'),
    option('learn-to-leisure','learn','leisure','少学一点，缓一缓','降低总投入，给休息留出空间；代价是知识积累可能放慢。'),
    option('leisure-to-sleep','leisure','sleep','少一点休闲，多一点睡眠','睡眠不足时可能受益，但会减少自主休闲；不是睡得越久就一定越不累。')
  ],
  income:[
    option('unallocated-to-work','unallocated','work','用空余时间增加有偿工作','不减少已有活动，但自由缓冲减少，疲劳也可能增加。'),
    option('leisure-to-work','leisure','work','少一点休闲，多一点有偿工作','用自主休闲换报酬，疲劳和恢复代价可能抵消一部分收入增益。'),
    option('learn-to-work','learn','work','少学一点，增加有偿工作','把学习时间换成当下报酬，代价是知识积累可能放慢。'),
    option('sleep-to-work','sleep','work','少睡一点，增加有偿工作','工时虽增加，少睡造成的效率损失也可能抵消报酬；模型可行不等于健康上适宜。')
  ]
};
export function normalizeGuideConfig(config){
  // Old learning-only records had exactly these three fields.
  if(config && typeof config==='object' && !Array.isArray(config) && Object.keys(config).length===3 &&
    ['amount','protectSleep','protectWork'].every(k=>Object.hasOwn(config,k)))return {...DEFAULT_GUIDE,...config};
  return config;
}
export function validateGuide(input){
  const config=normalizeGuideConfig(input);
  if(!config || typeof config!=='object' || Array.isArray(config))return ['目标设置无效'];
  const errors=[];
  if(Object.keys(config).some(k=>!Object.hasOwn(DEFAULT_GUIDE,k)))errors.push('目标设置包含未定义字段');
  if(!Object.hasOwn(GUIDE_GOALS,config.goal))errors.push('目标须为学习、减轻疲劳或增加收入');
  if(!isGuideAmount(config.amount))errors.push('每周调整时间须为0至48小时的整数');
  if(['protectSleep','protectWork','protectLearn'].some(k=>typeof config[k]!=='boolean'))errors.push('底线须为明确的是或否');
  if(!['unknown','output','fixed'].includes(config.incomeMode))errors.push('收入方式无效');
  return errors;
}
export function buildDecisionGuide(scenario,input=DEFAULT_GUIDE,{weeks=12,schedule={},limits=DEFAULT_LIMITS}={}){
  limits=decodeLimits(limits);
  const errors=[...validateGuide(input),...validateScenario(scenario),...validateSchedule(schedule)];
  if(![4,12,26,52].includes(weeks))errors.push('比较周期须为4、12、26或52周');
  if(errors.length)throw new RangeError(errors.join('；'));
  const config=normalizeGuideConfig(input),goal=GUIDE_GOALS[config.goal],firstPlan={...scenario.plan,...schedule[1]};
  const blocker=config.amount===0?'0 小时表示保留原安排，无需新增试行方案。':config.goal!=='income'||config.incomeMode==='output'?'':config.incomeMode==='fixed'?
    '固定工资且额外工时无报酬时，多工作不会直接增收。当前模型暂不能估算涨薪、跳槽或副业收入，因此不生成增收方案。':
    '先确认额外工作如何计酬；尚不确定时，不把多工作当成必然多赚钱。';
  const baselinePath=blocker?null:guidePath(scenario,weeks,schedule);
  const rows=blocker?[]:GUIDE_OPTIONS[config.goal].map(def=>{
    const {source,target}=def;
    const result=marginalEffects(scenario,weeks,schedule, {...DEFAULT_MARGINAL,source,target,step:config.amount});
    const protection={sleep:[config.protectSleep,'睡眠'],work:[config.protectWork,'工作时长'],learn:[config.protectLearn,'学习时间']}[source];
    const improved=result.primary.feasible && result.primary.delta[goal.metric]*goal.direction>1e-8;
    const path=result.primary.feasible?guidePath(scenario,weeks,schedule,{source,target,amount:config.amount}):null;
    const margins=limitMargins(path,baselinePath,limits),breaches=margins.filter(m=>!m.ok);
    const noImprovement={learn:'知识积累没有增加',recover:'累积疲劳没有降低',income:'累计工作收入没有增加'}[config.goal];
    const reason=protection?.[0]?`你设定了${protection[1]}不减少`:!result.primary.feasible?result.primary.errors.join('；'):
      breaches.length?breaches.map(m=>`${m.week===0?'起点':`第 ${m.week} 周`}${LIMIT_FIELDS[m.key].label}底线未满足，差 ${Math.abs(m.margin).toFixed(1)} ${m.unit}`).join('；'):
      !improved?`在当前假设下，${noImprovement}，暂不作为这个目标的试行方案。`:'';
    const plan={...firstPlan,[target]:firstPlan[target]+config.amount};
    if(source!=='unallocated')plan[source]-=config.amount;
    return {...def,available:!reason,reason,improved,point:result.primary,plan,path,margins,
      baseline:result.baseline,baselineFeasible:result.baselineFeasible};
  });
  return {scenario:clone(scenario),schedule:clone(schedule),config:clone(config),limits,baselinePath,weeks,totalHours:config.amount*weeks,blocker,
    usedHours:TIME_KEYS.reduce((n,k)=>n+firstPlan[k],0),rows,available:rows.filter(r=>r.available),excluded:rows.filter(r=>!r.available)};
}
export function decodeGuideTrial(record){
  const legacy=record?.format==='financial-human-weekly-trial-v1';
  if(!record || !['financial-human-weekly-trial-v1','financial-human-weekly-trial-v2','financial-human-weekly-trial-v3','financial-human-weekly-trial-v4','financial-human-weekly-trial-v5'].includes(record.format) ||
    typeof record.note!=='string' || record.note.length>2000)throw new Error('保存的试行计划格式不完整，未替换当前内容。');
  let scenario;try{scenario=upgradeScenario(record.scenario);}catch{throw new Error('保存的试行计划格式不完整，未替换当前内容。');}
  const modern=['financial-human-weekly-trial-v3','financial-human-weekly-trial-v4','financial-human-weekly-trial-v5'].includes(record.format);
  const weeks=modern?record.weeks:12,schedule=modern?record.schedule:{};
  const config=normalizeGuideConfig(record.config);
  if(validateGuide(config).length || (!legacy&&!Object.hasOwn(record.config,'goal')) || (legacy&&config.goal!=='learn'))
    throw new Error('保存的试行计划格式不完整，未替换当前内容。');
  const choiceId=legacy?record.source:record.choiceId;
  if(!GUIDE_OPTIONS[config.goal].some(r=>r.id===choiceId))throw new Error('保存的试行计划格式不完整，未替换当前内容。');
  const limits=decodeLimits(record.limits);
  if(!buildDecisionGuide(scenario,config,{weeks,schedule,limits}).available.some(r=>r.id===choiceId))
    throw new Error('这份试行计划已不满足当前约束或目标，未自动采用。');
  return {scenario,config:clone(config),choiceId,note:record.note,legacy,weeks,schedule:clone(schedule),limits};
}
