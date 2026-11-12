import { VERSION, STATE_GROUPS, PLAN_GROUPS, PARAM_FIELDS, clone } from './schema.js';
import { PLAIN_FIELDS } from './copy.js';
import { dayNumber } from './sleep-diary.js';
import { DEFAULT_GUIDE, buildDecisionGuide } from './guide.js';
import { DEFAULT_LIMITS } from './comparison.js';

export const TRIAL_FORMAT='financial-human-decision-record-v1';
export const TRIAL_LIMIT=100;
export const REVIEW_LIMIT=20;
export const SOURCE_NOTE_LIMIT=160;
export const RECORD_TEXT_LIMITS=Object.freeze({intent:300,stopRule:200,note:2000,execution:500,outcome:500,reason:500,nextStep:500});
export const SOURCE_LABELS=Object.freeze({default:'默认假设',estimate:'个人估计',record:'来自记录',unknown:'来源未知'});

function freezeTree(value){
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){
    for(const child of Object.values(value))freezeTree(child);
    Object.freeze(value);
  }
  return value;
}
const fields={plan:PLAN_GROUPS.flatMap(g=>g.fields),state:STATE_GROUPS.flatMap(g=>g.fields),parameters:PARAM_FIELDS};
const sourceField=(group,key)=>{
  const f=fields[group].find(f=>f.key===key);
  return {id:`${group}.${key}`,group,key,label:PLAIN_FIELDS[key]??f.label,unit:f.unit};
};
export const SOURCE_FIELDS=freezeTree([
  ...['work','learn','sleep','leisure'].map(key=>sourceField('plan',key)),
  ...['cash','fatigue'].map(key=>sourceField('state',key)),
  ...['wage','essential'].map(key=>sourceField('plan',key)),
  ...['sleepNeed','fatigueRecovery'].map(key=>sourceField('parameters',key)),
  ...['sleepDebt','sleepQuality'].map(key=>sourceField('state',key))
]);
const sourceIds=SOURCE_FIELDS.map(f=>f.id);
const object=value=>value!==null&&typeof value==='object'&&Object.prototype.toString.call(value)==='[object Object]';
const shape=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const rawSource=(kind,value)=>({kind,date:'',note:'',value});
const hasKind=kind=>typeof kind==='string'&&Object.hasOwn(SOURCE_LABELS,kind);

function readDate(value,label){
  try{
    dayNumber(value);
    if(value.startsWith('0000'))throw new Error();
  }catch{throw new Error(`${label}须为有效日期（YYYY-MM-DD）`);}
  return value;
}
export function localDate(date=new Date()){
  const pad=(n,size)=>String(n).padStart(size,'0');
  return readDate(`${pad(date.getFullYear(),4)}-${pad(date.getMonth()+1,2)}-${pad(date.getDate(),2)}`,'本地日期');
}
function sourceValue(scenario,{group,key,label}){
  const value=scenario?.[group]?.[key];
  if(!Number.isFinite(value))throw new Error(`${label}数值无效`);
  return value;
}
function readSource(input,value,label){
  if(!shape(input,['kind','date','note','value'])||!hasKind(input.kind))throw new Error(`${label}来源格式无效`);
  if(input.value!==value)throw new Error(`${label}来源与当前数值不一致`);
  if(input.date!=='')readDate(input.date,`${label}来源日期`);
  if(typeof input.note!=='string'||input.note.length>SOURCE_NOTE_LIMIT)throw new Error(`${label}来源备注最多 ${SOURCE_NOTE_LIMIT} 字`);
  return {kind:input.kind,date:input.date,note:input.note,value};
}
const sourceMap=read=>freezeTree(Object.fromEntries(SOURCE_FIELDS.map(f=>[f.id,read(f)])));
export function newSources(scenario,kind='default'){
  if(!hasKind(kind))throw new Error('来源类别无效');
  return sourceMap(f=>rawSource(kind,sourceValue(scenario,f)));
}
export function decodeSources(value,scenario){
  if(value===undefined)return newSources(scenario,'unknown');
  if(!shape(value,sourceIds))throw new Error('输入来源格式不完整');
  return sourceMap(f=>readSource(value[f.id],sourceValue(scenario,f),f.label));
}
export function reconcileSources(sources,scenario){
  return sourceMap(f=>{
    const value=sourceValue(scenario,f),entry=sources?.[f.id];
    return entry?.value===value?readSource(entry,value,f.label):rawSource('unknown',value);
  });
}
export function setSource(sources,id,{kind,date='',note=''}={},scenario){
  const field=SOURCE_FIELDS.find(f=>f.id===id);
  if(!field)throw new Error('未知的输入来源字段');
  const value=sourceValue(scenario,field);
  return freezeTree({...reconcileSources(sources,scenario),[id]:readSource({kind,date,note,value},value,field.label)});
}

const trialKeys=['id','createdAt','startDate','reviewDate','intent','stopRule','note'];
const recordKeys=['format','modelVersion','snapshot','summary','reviews',...trialKeys];
const snapshotKeys=['scenario','schedule','weeks','config','limits','choiceId','sources'];
const reviewFields=['execution','outcome','reason','nextStep'];
const metrics=['cash','income','fatigue','sleepDebt','knowledge','effectiveLearn'];
const emptyArchive=Object.freeze([]);
// Workspace auto-save revalidates on each edit; a frozen record never needs a second simulation.
const validatedRecords=new WeakSet();
function lockRecord(record){freezeTree(record);validatedRecords.add(record);return record;}

function readId(value){
  if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(value))throw new Error('记录编号无效');
  return value;
}
function readTimestamp(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value))throw new Error('保存时间无效');
  readDate(value.slice(0,10),'保存日期');
  const date=new Date(value),canonical=value.length===20?value.replace('Z','.000Z'):value;
  if(!Number.isFinite(date.getTime())||date.toISOString()!==canonical)throw new Error('保存时间无效');
  return value;
}
function readText(key,value,required=false){
  const label={intent:'试行目标',stopRule:'停止条件',note:'试行备注',execution:'实际执行',outcome:'实际结果',reason:'偏差原因',nextStep:'下一步'}[key];
  const limit=RECORD_TEXT_LIMITS[key];
  if(typeof value!=='string'||value.length>limit)throw new Error(`${label}最多 ${limit} 字`);
  if(required&&!value.trim())throw new Error(`请填写${label}`);
  return value;
}
function readTrialFields({id,createdAt,startDate,reviewDate,intent,stopRule,note}){
  readDate(startDate,'开始日期');readDate(reviewDate,'计划回看日期');
  if(reviewDate<startDate)throw new Error('计划回看日期不能早于开始日期');
  return {id:readId(id),createdAt:readTimestamp(createdAt),startDate,reviewDate,
    intent:readText('intent',intent,true),stopRule:readText('stopRule',stopRule,true),note:readText('note',note)};
}
function readReview(input,startDate){
  if(!shape(input,['id','date',...reviewFields]))throw new Error('复盘记录格式不完整');
  const id=readId(input.id),date=readDate(input.date,'复盘日期');
  if(date<startDate)throw new Error('复盘日期不能早于试行开始日期');
  const entries=reviewFields.map(key=>[key,readText(key,input[key])]);
  if(!entries.some(([,value])=>value.trim()))throw new Error('请至少填写一项复盘内容');
  return {id,date,...Object.fromEntries(entries)};
}
function makeSnapshot({scenario,schedule,weeks,config,limits,choiceId,sources}){
  if(!shape(scenario,['version','state','plan','parameters','weights'])||
    !object(schedule)||Object.values(schedule).some(p=>!object(p))||
    !shape(config,Object.keys(DEFAULT_GUIDE))||!shape(limits,Object.keys(DEFAULT_LIMITS))||sources===undefined)
    throw new Error('试行快照格式不完整');
  if(weeks===undefined)throw new Error('试行比较周期缺失');
  const recordedSources=decodeSources(sources,scenario);
  const guide=buildDecisionGuide(scenario,config,{schedule,weeks,limits});
  const row=guide.available.find(r=>r.id===choiceId);
  if(!row)throw new Error('所选试行方案已不满足当前目标或底线');
  const outcome=(values,path)=>({...Object.fromEntries(metrics.map(key=>[key,values[key]])),averageFatigue:path.averageFatigue});
  const snapshot={scenario:guide.scenario,schedule:guide.schedule,weeks:guide.weeks,config:guide.config,limits:guide.limits,choiceId,sources:recordedSources};
  const summary={label:row.label,source:row.source,target:row.target,baselinePlan:{...scenario.plan,...schedule[1]},chosenPlan:row.plan,
    totalHours:guide.totalHours,baseline:outcome(row.baseline,guide.baselinePath),chosen:outcome(row.point.metrics,row.path),margins:row.margins};
  return {snapshot,summary};
}
export function createTrial(input){
  const {note=''}=input;
  const fields=readTrialFields({...input,note});
  const {snapshot,summary}=makeSnapshot(input);
  return lockRecord({format:TRIAL_FORMAT,modelVersion:VERSION,...fields,snapshot,summary,reviews:[]});
}

function matchesSummary(value,expected){
  // Separate JS engines can round transcendental calculations differently; allow only numerical noise.
  if(typeof expected==='number')return Number.isFinite(value)&&Math.abs(value-expected)<=1e-9+32*Number.EPSILON*Math.abs(expected);
  if(Array.isArray(expected))return Array.isArray(value)&&value.length===expected.length&&expected.every((item,i)=>matchesSummary(value[i],item));
  if(object(expected))return shape(value,Object.keys(expected))&&Object.entries(expected).every(([key,item])=>matchesSummary(value[key],item));
  return value===expected;
}
function uniqueIds(records){
  const ids=Array.from(records,r=>readId(r?.id));
  if(new Set(ids).size!==ids.length)throw new Error('记录编号重复');
}
function decodeRecord(record){
  if(validatedRecords.has(record))return record;
  if(!shape(record,recordKeys)||record.format!==TRIAL_FORMAT||record.modelVersion!==VERSION||!shape(record.snapshot,snapshotKeys))
    throw new Error('试行记录格式或模型版本不支持');
  const fields=readTrialFields(record);
  if(!Array.isArray(record.reviews))throw new Error('复盘列表格式无效');
  if(record.reviews.length>REVIEW_LIMIT)throw new Error(`每次试行最多保存 ${REVIEW_LIMIT} 次复盘`);
  uniqueIds(record.reviews);
  const reviews=record.reviews.map(value=>readReview(value,fields.startDate));
  const {snapshot,summary}=makeSnapshot(record.snapshot);
  if(!matchesSummary(record.summary,summary))throw new Error('保存的预期结果与试行快照不一致');
  return lockRecord({format:TRIAL_FORMAT,modelVersion:VERSION,...fields,snapshot,summary:clone(record.summary),reviews});
}
function checkArchive(value){
  if(!Array.isArray(value))throw new Error('试行档案格式无效');
  if(value.length>TRIAL_LIMIT)throw new Error(`最多保存 ${TRIAL_LIMIT} 次试行，请先导出备份并删除不再需要的记录`);
}
export function decodeArchive(value){
  if(value===undefined)return emptyArchive;
  checkArchive(value);uniqueIds(value);
  return Object.freeze(value.map(decodeRecord));
}
export function appendTrial(archive,record){
  checkArchive(archive);
  if(archive.length>=TRIAL_LIMIT)throw new Error(`已保存 ${TRIAL_LIMIT} 次试行，请先导出备份并删除不再需要的记录`);
  const current=decodeArchive(archive),next=decodeRecord(record);
  if(current.some(r=>r.id===next.id))throw new Error('试行编号重复');
  return Object.freeze([...current,next]);
}
export function appendReview(archive,id,input){
  const current=decodeArchive(archive),record=current.find(r=>r.id===id);
  if(!record)throw new Error('未找到这次试行');
  if(record.reviews.length>=REVIEW_LIMIT)throw new Error(`每次试行最多保存 ${REVIEW_LIMIT} 次复盘`);
  const review=readReview(input,record.startDate);
  if(record.reviews.some(r=>r.id===review.id))throw new Error('复盘编号重复');
  const next=lockRecord({...record,reviews:[...record.reviews,review]});
  return Object.freeze(current.map(r=>r===record?next:r));
}
export function deleteTrial(archive,id){
  const current=decodeArchive(archive);
  if(!current.some(r=>r.id===id))throw new Error('未找到这次试行');
  return Object.freeze(current.filter(r=>r.id!==id));
}
