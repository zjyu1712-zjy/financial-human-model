import { VERSION, clone, upgradeScenario } from './schema.js';
import { validateSchedule } from './model.js';
import { DEFAULT_MARGINAL, validateMarginal } from './marginal.js';
import { DEFAULT_GUIDE, GUIDE_OPTIONS, GUIDE_AMOUNT, isGuideAmount, validateGuide } from './guide.js';
import { decodeLimits, decodeCompareView, LIMIT_FIELDS } from './comparison.js';
import { decodeDiary } from './sleep-diary.js';

export const WORKSPACE_KEY='financial-human-workspace-v1.2';
export const WORKSPACE_FORMAT='financial-human-workspace-v1.2';
export const TRIAL_KEY='financial-human-weekly-trial-v5';
export const decisionKey=config=>JSON.stringify([config.goal,config.amount]);
export const noteKey=(config,choice)=>JSON.stringify([decisionKey(config),choice]);

export function decodeExperiment(value){
  if(!value || !['financial-human-experiment-v0.3','financial-human-experiment-v1.0','financial-human-experiment-v1.1','financial-human-experiment-v1.2'].includes(value.format))throw new Error('不是可导入的实验文件');
  const current=upgradeScenario(value.current),baseline=upgradeScenario(value.baseline);
  const schedule=value.schedule??{},baselineSchedule=value.baselineSchedule??{},weeks=value.weeks;
  const marginalConfig=value.marginalConfig??clone(DEFAULT_MARGINAL);
  const errors=[...validateSchedule(schedule),...validateSchedule(baselineSchedule),...validateMarginal(marginalConfig,weeks)];
  if(![4,12,26,52].includes(weeks))errors.push('周期不支持');
  if(errors.length)throw new Error(errors.join('；'));
  return {format:'financial-human-experiment-v1.2',version:VERSION,current,baseline,schedule:clone(schedule),baselineSchedule:clone(baselineSchedule),weeks,
    question:['week','spend','invest'].includes(value.question)?value.question:'week',marginalConfig:clone(marginalConfig)};
}

function readEntries(entries,kind){
  const contexts=(GUIDE_AMOUNT.max-GUIDE_AMOUNT.min)/GUIDE_AMOUNT.step+1;
  const limit=contexts*(kind==='notes'?Object.values(GUIDE_OPTIONS).reduce((n,options)=>n+options.length,0):Object.keys(GUIDE_OPTIONS).length);
  if(!Array.isArray(entries)||entries.length>limit)throw new Error('草稿列表格式无效');
  const seen=new Set();
  return entries.map(entry=>{
    if(!Array.isArray(entry)||entry.length!==2||entry.some(x=>typeof x!=='string')||entry[0].length>300||entry[1].length>2000||seen.has(entry[0]))throw new Error('草稿记录格式无效');
    seen.add(entry[0]);
    let parsed;try{parsed=JSON.parse(entry[0]);}catch{throw new Error('草稿索引无效');}
    const context=kind==='notes'?JSON.parse(parsed[0]):parsed;
    if(!Array.isArray(context)||context.length!==2||!Object.hasOwn(GUIDE_OPTIONS,context[0])||!isGuideAmount(context[1]))throw new Error('草稿目标无效');
    const choice=kind==='notes'?parsed[1]:entry[1];
    if((kind==='notes'&&(!Array.isArray(parsed)||parsed.length!==2))||!GUIDE_OPTIONS[context[0]].some(r=>r.id===choice))throw new Error('草稿方案无效');
    return [...entry];
  });
}

export function decodeWorkspace(value){
  if(![WORKSPACE_FORMAT,'financial-human-workspace-v1.1','financial-human-workspace-v1'].includes(value?.format))throw new Error('不是可导入的完整数据文件');
  const experiment=decodeExperiment(value.experiment),d=value.decision;
  if(!d || validateGuide(d.config).length || !Number.isInteger(d.step)||!Number.isInteger(d.reached)||d.step<1||d.step>d.reached||d.reached>5)throw new Error('决策进度格式无效');
  if(d.choiceId!==null&&!GUIDE_OPTIONS[d.config.goal].some(r=>r.id===d.choiceId))throw new Error('决策方案无效');
  const notes=readEntries(d.notes,'notes'),selections=readEntries(d.selections,'selections');
  const limits=decodeLimits(d.limits),view=decodeCompareView(d.view),limitDrafts=d.limitDrafts??[];
  if(!Array.isArray(limitDrafts)||limitDrafts.length>3||new Set(limitDrafts.map(e=>e?.[0])).size!==limitDrafts.length||limitDrafts.some(e=>!Array.isArray(e)||e.length!==2||!Object.hasOwn(LIMIT_FIELDS,e[0])||typeof e[1]!=='string'||e[1].length>1000))throw new Error('底线草稿无效');
  for(const [goal,pair] of Object.entries(view.pairs))if(!Object.hasOwn(GUIDE_OPTIONS,goal)||pair.some(id=>id!==null&&!GUIDE_OPTIONS[goal].some(o=>o.id===id)))throw new Error('对照方案无效');
  const demo=value.demo;
  if(!demo || !Object.hasOwn(GUIDE_OPTIONS,demo.goal)||Object.keys(GUIDE_OPTIONS).some(k=>!['1','2','4','all'].includes(demo.amounts?.[k])))throw new Error('示例设置无效');
  if(typeof value.scheduleText!=='string'||value.scheduleText.length>100000)throw new Error('逐周安排草稿无效');
  if(typeof value.scheduleError!=='string'||value.scheduleError.length>2000)throw new Error('逐周安排错误记录无效');
  if(!Array.isArray(value.fieldDrafts)||value.fieldDrafts.length>100)throw new Error('输入草稿无效');
  const fieldDrafts=value.fieldDrafts.map(entry=>{
    if(!Array.isArray(entry)||entry.length!==2||entry.some(v=>typeof v!=='string')||entry[1].length>1000)throw new Error('输入草稿无效');
    const [group,key,...extra]=entry[0].split('.');
    if(extra.length||!['state','plan','parameters','weights'].includes(group)||!Object.hasOwn(experiment.current[group],key))throw new Error('输入草稿字段无效');
    return [...entry];
  });
  const marginalDraft=value.marginalDraft;
  if(!marginalDraft||Object.keys(DEFAULT_MARGINAL).some(k=>typeof marginalDraft[k]!=='string'||marginalDraft[k].length>50))throw new Error('边际输入草稿无效');
  const sleepDemo=demo.sleepDemo??'original',sleepSource=demo.sleepSource??'unallocated';
  if(!['original','higherNeed','existingDebt'].includes(sleepDemo)||!['unallocated','leisure'].includes(sleepSource))throw new Error('睡眠示例设置无效');
  const sleepDiary=decodeDiary(value.sleepDiary);
  return {format:WORKSPACE_FORMAT,experiment,sleepDiary,decision:{...clone(d),notes,selections,limits,view,limitDrafts:clone(limitDrafts)},demo:{...clone(demo),sleepDemo,sleepSource},fieldDrafts,scheduleText:value.scheduleText,scheduleError:value.scheduleError,marginalDraft:clone(marginalDraft)};
}

export function newDecision(){return {config:clone(DEFAULT_GUIDE),choiceId:null,step:1,reached:1,notes:[],selections:[]};}
