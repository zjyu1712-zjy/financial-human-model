import { clone, upgradeScenario, TIME_KEYS } from './schema.js';
import { mechanisms, clip } from './model.js';
import { sleepTransition } from './sleep.js';

const DAY=86400000;
export const DIARY_KEYS=['date','hours','fatigue','quality','context','note'];
export const WEEK_KEYS=['work','learn','care','exercise','relation','leisure'];
export function newDiary(){return {step:1,open:false,records:[],weeks:[],dailyDrafts:[],weekDrafts:[],assumeZero:false,
  draft:{date:'',hours:'',fatigue:'',quality:'',context:'ordinary',note:''},
  weekDraft:{end:'',...Object.fromEntries(WEEK_KEYS.map(k=>[k,'']))},lastApplied:null};}
export function dayNumber(date){
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('请选择日期');
  const n=Date.parse(date+'T00:00:00Z');
  if(!Number.isFinite(n)||new Date(n).toISOString().slice(0,10)!==date)throw new Error('日期不存在');
  return n/DAY;
}
const dateAt=n=>new Date(n*DAY).toISOString().slice(0,10);
const numeric=(value,label,min,max)=>{
  if((typeof value==='string'&&value.trim()==='')||value===null||typeof value==='boolean')throw new Error('请填写'+label);
  const n=Number(value);if(!Number.isFinite(n)||n<min||n>max)throw new Error(`${label}请填写${min}到${max}`);return n;
};
export function readDiaryRecord(value,today=null){
  if(!value||Object.keys(value).some(k=>!DIARY_KEYS.includes(k)))throw new Error('记录格式不正确');
  const date=value.date;dayNumber(date);if(today&&date>today)throw new Error('还没到这一天，先记录已经发生的情况');
  const hours=numeric(value.hours,'实际睡眠小时',0,24),fatigue=numeric(value.fatigue,'累的程度',0,10),quality=numeric(value.quality,'睡得怎样',1,5);
  if(!Number.isInteger(quality)||!['ordinary','free','special'].includes(value.context))throw new Error('请选择这一天的情况');
  if(typeof value.note!=='string'||value.note.length>200)throw new Error('备注最多200字');
  return {date,hours,fatigue,quality,context:value.context,note:value.note};
}
export function decodeDiary(value){
  if(value===undefined)return newDiary();
  if(!value||![1,2,3].includes(value.step)||typeof value.open!=='boolean'||typeof value.assumeZero!=='boolean'||!Array.isArray(value.records)||value.records.length>400||!Array.isArray(value.weeks)||value.weeks.length>60)throw new Error('睡眠记录格式不正确');
  const records=value.records.map(r=>readDiaryRecord(r));
  if(new Set(records.map(r=>r.date)).size!==records.length)throw new Error('同一天有重复记录');
  for(const [object,keys] of [[value.draft,DIARY_KEYS],[value.weekDraft,['end',...WEEK_KEYS]]]){
    if(!object||Object.keys(object).length!==keys.length||keys.some(k=>typeof object[k]!=='string'||object[k].length>300))throw new Error('记录草稿格式不正确');
  }
  const dailyDrafts=value.dailyDrafts??[];
  if(!Array.isArray(dailyDrafts)||dailyDrafts.length>400||new Set(dailyDrafts.map(r=>r?.date)).size!==dailyDrafts.length)throw new Error('每日草稿格式不正确');
  for(const r of dailyDrafts){dayNumber(r?.date);if(DIARY_KEYS.some(k=>typeof r[k]!=='string'||r[k].length>300))throw new Error('每日草稿格式不正确');}
  const weekDrafts=value.weekDrafts??[];
  if(!Array.isArray(weekDrafts)||weekDrafts.length>60||new Set(weekDrafts.map(w=>w?.end)).size!==weekDrafts.length)throw new Error('每周草稿格式不正确');
  for(const w of weekDrafts){dayNumber(w?.end);if(WEEK_KEYS.some(k=>typeof w[k]!=='string'||w[k].length>300))throw new Error('每周草稿格式不正确');}
  const weeks=value.weeks.map(w=>{
    if(!w||typeof w.fingerprint!=='string'||w.fingerprint.length>10000)throw new Error('每周记录格式不正确');
    dayNumber(w.end);const scenario=upgradeScenario(w.scenario);
    if(TIME_KEYS.reduce((n,k)=>n+scenario.plan[k],0)>168+1e-8)throw new Error('一周实际安排超过168小时');
    return {end:w.end,fingerprint:w.fingerprint,scenario};
  });
  if(new Set(weeks.map(w=>w.end)).size!==weeks.length)throw new Error('同一周有重复记录');
  if(value.lastApplied!==null&&(typeof value.lastApplied!=='string'||value.lastApplied.length>500))throw new Error('修改记录格式不正确');
  return {...clone(value),dailyDrafts:clone(dailyDrafts),weekDrafts:clone(weekDrafts),records:records.sort((a,b)=>a.date.localeCompare(b.date)),weeks};
}
export function saveDiaryRecord(diary,raw,today){
  const row=readDiaryRecord(raw,today),next=clone(diary),index=next.records.findIndex(r=>r.date===row.date);
  if(index<0&&next.records.length>=400)throw new Error('已保存400天，请先导出存档');
  if(index>=0)next.records[index]=row;else next.records.push(row);
  next.records.sort((a,b)=>a.date.localeCompare(b.date));return next;
}
// Calendar weeks need the preceding Sunday's rating as the starting fatigue.
export function diaryWeeks(records){
  const map=new Map(records.map(r=>[r.date,r])),result=[];
  for(const end of records){
    const n=dayNumber(end.date);if(new Date(n*DAY).getUTCDay()!==0)continue;
    const before=map.get(dateAt(n-7)),days=Array.from({length:7},(_,i)=>map.get(dateAt(n-6+i)));
    if(!before||days.some(r=>!r))continue;
    result.push({start:dateAt(n-6),end:end.date,before,days,hours:days.reduce((s,r)=>s+r.hours,0),
      quality:days.reduce((s,r)=>s+(r.quality-1)*25,0)/7,fatigueBefore:before.fatigue*10,fatigueAfter:end.fatigue*10,
      special:days.some(r=>r.context==='special')||before.context==='special',fingerprint:JSON.stringify([before,...days])});
  }
  return result.sort((a,b)=>a.end.localeCompare(b.end));
}
export function confirmDiaryWeek(diary,end,values,current){
  const week=diaryWeeks(diary.records).find(w=>w.end===end);if(!week)throw new Error('这周记录还不完整');
  const scenario=clone(current);
  for(const k of WEEK_KEYS)scenario.plan[k]=numeric(values[k],'本周实际时间',0,168);
  scenario.plan.sleep=week.hours;
  if(TIME_KEYS.reduce((n,k)=>n+scenario.plan[k],0)>168+1e-8)throw new Error('睡眠加上这些安排超过168小时，请核对实际时间');
  const next=clone(diary),row={end,fingerprint:week.fingerprint,scenario};
  if(next.weeks.length>=60&&!next.weeks.some(w=>w.end===end))throw new Error('已核对60周，请先导出存档');
  next.weeks=next.weeks.filter(w=>w.end!==end);next.weeks.push(row);return next;
}
const median=values=>{const v=[...values].sort((a,b)=>a-b),m=Math.floor(v.length/2);return v.length%2?v[m]:(v[m-1]+v[m])/2;};
export function summarizeDiary(diary,current,today=null){
  const ordered=diary.records.filter(r=>!today||r.date<=today).sort((a,b)=>a.date.localeCompare(b.date));
  const cutoff=today?dayNumber(today)-27:ordered.length?dayNumber(ordered.at(-1).date)-27:0;
  const recent=ordered.filter(r=>dayNumber(r.date)>=cutoff&&(!today||r.date<=today));
  const rested=recent.filter(r=>r.context==='free'&&r.fatigue<=3&&r.quality>=3&&r.hours>=4&&r.hours<=12);
  const need=recent.length>=14&&rested.length>=5?{value:Math.round(median(rested.map(r=>r.hours))*4)/4,count:rested.length,
    min:Math.min(...rested.map(r=>r.hours)),max:Math.max(...rested.map(r=>r.hours))}:null;
  const weeks=diaryWeeks(ordered);let debt=0,previous=null;
  const computed=weeks.map(w=>{
    const gap=previous!==null&&dayNumber(w.end)-dayNumber(previous)!==7;if(gap)debt=0;
    const startDebt=debt,sleep=sleepTransition({sleepDebt:debt,sleepQuality:w.quality},{sleep:w.hours},current.parameters);debt=sleep.debtAfter;previous=w.end;
    const saved=diary.weeks.find(r=>r.end===w.end),confirmed=!!saved&&saved.fingerprint===w.fingerprint;
    return {...w,startDebt,debt,sleep,confirmed,scenario:confirmed?saved.scenario:null,gap};
  });
  const latest=computed.at(-1)??null;
  const usable=diary.assumeZero?computed.filter(w=>w.confirmed&&!w.special&&w.fatigueBefore>=10):[];
  const fit=fitRecovery(usable,current.parameters);
  if(today&&usable.length&&dayNumber(today)-dayNumber(usable.at(-1).end)>28){fit.available=false;fit.reason='最近核对的记录超过28天，先补充近期情况';}
  return {count:ordered.length,recentCount:recent.length,restedCount:rested.length,need,weeks:computed,latest,fit,
    currentWeekFresh:!!latest&&(!today||(dayNumber(today)>=dayNumber(latest.end)&&dayNumber(today)-dayNumber(latest.end)<=7))};
}
// A conditional, one-parameter fit. Other state inputs remain the saved week's assumptions.
export function fitRecovery(weeks,parameters){
  if(weeks.length<6)return {available:false,count:weeks.length,reason:`已确认${weeks.length}/6个可用周，暂不改恢复设置`};
  const rows=weeks.slice(-12),split=Math.floor(rows.length*2/3),train=rows.slice(0,split),holdout=rows.slice(split);
  const predict=(w,rate)=>{
    const p={...parameters,fatigueRecovery:rate},s={...w.scenario.state,fatigue:w.fatigueBefore,sleepQuality:w.quality,sleepDebt:w.startDebt},a={...w.scenario.plan,sleep:w.hours};
    const m=mechanisms(s,a,p),load=Math.max(0,a.work+a.learn+.5*a.care-50);
    return clip(s.fatigue*(1-m.sleep.recovery)+.5*load+m.sleep.debtFatigue+m.channels.healthWear-.12*Math.min(a.exercise,5));
  };
  const loss=(data,r)=>data.reduce((n,w)=>n+(predict(w,r)-w.fatigueAfter)**2,0)/data.length;
  const grid=Array.from({length:76},(_,i)=>{const rate=(i+5)/100;return {rate,loss:loss(train,rate)};}).sort((a,b)=>a.loss-b.loss);
  const best=grid[0],before=loss(holdout,parameters.fatigueRecovery),after=loss(holdout,best.rate);
  const close=grid.filter(p=>p.loss<=best.loss+Math.max(1,best.loss*.1));
  const span=Math.max(...close.map(p=>p.rate))-Math.min(...close.map(p=>p.rate));
  const available=best.rate>.05&&best.rate<.8&&span<=.2&&before-after>=1&&after<before*.9;
  return {available,count:weeks.length,value:best.rate,trainCount:train.length,holdoutCount:holdout.length,
    beforeRMSE:Math.sqrt(before),afterRMSE:Math.sqrt(after),span,reason:available?'这组恢复设置更贴近后几周的实际记录':'后几周的误差没有可靠改善，暂不改恢复设置'};
}
export function diarySuggestion(diary,current,kind,today){
  const summary=summarizeDiary(diary,current,today),candidate=clone(current);
  if(kind==='need'){
    if(!summary.need)throw new Error('精神较好、自由睡醒的记录还不够');
    candidate.parameters.sleepNeed=summary.need.value;
  }else if(kind==='actual'){
    if(!summary.latest||!summary.currentWeekFresh)throw new Error('需要最近7天内结束的完整一周记录');
    const w=summary.latest;if(!w.confirmed)throw new Error('先核对最近一周实际花的时间');
    if(!diary.assumeZero)throw new Error('先确认这段记录之前的缺觉如何处理');
    for(const k of TIME_KEYS)candidate.plan[k]=w.scenario.plan[k];
    candidate.plan.sleep=w.hours;candidate.state.fatigue=w.fatigueAfter;candidate.state.sleepQuality=w.quality;candidate.state.sleepDebt=w.debt;
  }else if(kind==='recovery'){
    if(!summary.fit.available)throw new Error(summary.fit.reason);
    candidate.parameters.fatigueRecovery=summary.fit.value;
  }else throw new Error('未知修改项');
  return upgradeScenario(candidate);
}
