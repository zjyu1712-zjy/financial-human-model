import { DEFAULT_DECISION, validateDecision, compareDecision, createRecord, appendReview, renderReport, makeWorkspace, decodeWorkspace } from './decision.js';

const KEY='financial-human-workspace-v1.3',LOCAL_FORMAT='financial-human-local-state-v1.3',MAX_BACKUP_BYTES=128*1024*1024;
const $=id=>document.querySelector('#'+id),clone=value=>JSON.parse(JSON.stringify(value));
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const amount=value=>value===null?'未完成完整周期':value!==0&&Math.abs(value)<.01?(value<0?'−':'')+'不到 0.01 元':new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2}).format(value)+' 元';
const number=value=>new Intl.NumberFormat('zh-CN',{maximumFractionDigits:1}).format(value);
const modes=[['fixed','固定月薪'],['hourly','按付费小时'],['piece','按件计酬'],['mixed','混合收入']];
const sourceNames={'profile.cash':'当前可用现金','profile.assets':'当前投资资产','profile.debt':'债务本金','profile.debtAPR':'债务年利率','profile.monthlyPrincipal':'每月计划还本','profile.reserveCash':'现金底线','profile.income':'当前收入约定','profile.expenses':'当前每月支出','profile.time':'当前每周安排','change.income':'改变后的收入约定','change.expenses':'改变后的每月支出','change.time':'改变后的每周安排','change.oneOffCost':'一次性费用','assumptions.annualReturn':'年回报假设','assumptions.shockMonth':'冲击月份假设','assumptions.shockReturn':'下跌幅度假设'};
const sourceKinds=[['unknown','来源未知'],['record','来自记录或约定'],['estimate','个人估计'],['assumption','情景假设']];
const timeLabels={work:'工作',commute:'通勤',care:'照护与必要家务',sleep:'睡眠',learn:'学习',other:'其他已占用时间'};
const lifeLabels={body:'身体与恢复：能否持续？',cognition:'认知与判断：还缺什么信息？',emotion:'情绪与行动：有什么待观察的影响？',relations:'关系与责任：谁会受到影响，有什么支持？',values:'欲望与价值：真正想换回什么，愿意放弃什么？'};
const editable=new Map();
let decision,records=[],step=1,stress=false,selectedId=null,pendingImport=null,lastValid=null,storageUnavailable=false,storageProtected=false,recoveryRaw=null;

function example(){
  const d=clone(DEFAULT_DECISION);d.title='减少工作投入，换回时间（示例）';d.startDate=today();d.months=12;
  Object.assign(d.profile,{cash:120000,assets:60000,debt:20000,debtAPR:.06,monthlyPrincipal:1000,reserveCash:30000,expenses:10000});
  Object.assign(d.profile.income,{mode:'fixed',fixedMonthly:15000});
  Object.assign(d.profile.time,{work:40,commute:7,care:21,sleep:56,learn:4,other:14});
  Object.assign(d.change,{name:'减少工时并调整收入（示例）',startMonth:2,durationMonths:11,expenses:9000,oneOffCost:5000});
  Object.assign(d.change.income,{mode:'fixed',fixedMonthly:12000});Object.assign(d.change.time,{work:32,commute:4,care:21,sleep:56,learn:8,other:14});
  Object.assign(d.assumptions,{annualReturn:.03,shockMonth:3,shockReturn:-.2});Object.assign(d.limits,{minSleep:49,maxWork:55});
  d.action.reviewDate=today();return d;
}
function valueAt(path){return path.split('.').reduce((value,key)=>value[key],decision);}
function setAt(path,value){const keys=path.split('.'),last=keys.pop(),object=keys.reduce((value,key)=>value[key],decision);object[last]=value;}
function field(path,label,{type='number',min=0,max=1e9,step:increment='any',note='',options=null,maxlength=2000}={}){
  editable.set(path,{type,options});const id='input-'+path.replaceAll('.','-'),value=valueAt(path);
  const attrs=`id="${id}" data-path="${path}"`;
  const control=options?`<select ${attrs}>${options.map(([key,name])=>`<option value="${key}"${String(value)===String(key)?' selected':''}>${name}</option>`).join('')}</select>`:type==='textarea'?`<textarea ${attrs} maxlength="${maxlength}" rows="3">${escape(value)}</textarea>`:`<input ${attrs} type="${type}" value="${escape(value)}"${type==='number'?` min="${min}" max="${max}" step="${increment}"`:` maxlength="${maxlength}"`}>`;
  return `<label class="field" for="${id}"><span>${escape(label)}</span>${control}${note?`<small>${escape(note)}</small>`:''}</label>`;
}
function incomeFields(prefix){
  const mode=valueAt(prefix+'.mode');
  let html=field(prefix+'.mode','计酬方式',{type:'select',options:modes});
  if(['fixed','mixed'].includes(mode))html+=field(prefix+'.fixedMonthly','约定税后固定收入（元／月）');
  if(['hourly','mixed'].includes(mode))html+=field(prefix+'.hourlyRate','税后付费时薪（元／小时）')+field(prefix+'.paidHoursWeek','每周付费小时',{max:168,note:'不能超过每周工作时数；不使用效率折扣'});
  if(['piece','mixed'].includes(mode))html+=field(prefix+'.pieceRate','税后每件报酬（元）')+field(prefix+'.unitsMonth','每月计酬件数');
  return html;
}
function timeFields(prefix){return Object.entries(timeLabels).map(([key,label])=>field(prefix+'.'+key,label+'（小时／周）',{max:168})).join('');}
function renderForms(){
  $('intent-fields').innerHTML=field('title','这次要作出的选择',{type:'text',maxlength:200})+field('startDate','观察起点',{type:'date'})+field('months','观察期',{type:'select',options:[[6,'6 个月'],[12,'12 个月'],[24,'24 个月']]});
  $('profile-money').innerHTML=field('profile.cash','可立即动用现金（元）')+field('profile.assets','投资资产市值（元）',{note:'不自动变现用于支付；暂不纳入房产和锁定资金'})+field('profile.debt','计息债务本金（元）')+field('profile.debtAPR','债务年利率（小数）',{max:1,note:'例如 0.06 表示年利率 6%；月利息按期初本金计算'})+field('profile.monthlyPrincipal','每月计划还本（元）',{note:'不包含利息；最后一期按剩余本金封顶'})+field('profile.expenses','每月生活与必要支出（元）',{note:'不含本页另算的债务利息、还本与一次性改变费用；应含照护等责任支出'});
  $('profile-income').innerHTML=incomeFields('profile.income');$('profile-time').innerHTML=timeFields('profile.time');
  $('limit-fields').innerHTML=field('profile.reserveCash','希望保留的现金底线（元）')+field('limits.minSleep','每周最低睡眠（小时）',{max:168})+field('limits.maxWork','每周最多工作（小时）',{max:168});
  $('change-fields').innerHTML=field('change.name','方案名称',{type:'text',maxlength:200})+field('change.startMonth','从第几个月开始',{min:1,max:24,step:1})+field('change.durationMonths','持续几个月',{min:1,max:24,step:1})+field('change.expenses','改变期间每月支出（元）')+field('change.oneOffCost','开始当月的一次性费用（元）',{note:'例如搬家、过渡或学习费用；不要重复计入每月支出'});
  $('change-income').innerHTML=incomeFields('change.income');$('change-time').innerHTML=timeFields('change.time');
  $('life-fields').innerHTML=Object.entries(lifeLabels).map(([key,label])=>field('life.'+key,label,{type:'textarea'})).join('');
  $('assumption-fields').innerHTML=field('assumptions.annualReturn','假设税费后有效年回报（小数）',{min:-1,max:1,note:'0.03 表示 3%；不代表市场预测'})+field('assumptions.shockMonth','不利情景：第几个月下跌',{min:1,max:24,step:1})+field('assumptions.shockReturn','额外下跌幅度（小数）',{min:-1,max:0,note:'−0.20 表示当月在基础回报上额外下跌 20%'});
  $('action-fields').innerHTML=field('action.choice','当前倾向',{type:'select',options:[['undecided','先保留判断'],['baseline','保持现状'],['changed','采用改变安排']]})+field('action.reason','为什么作这个决定？',{type:'textarea'})+field('action.conditions','行动前提、暂停或退出条件',{type:'textarea'})+field('action.reviewDate','计划回看日期',{type:'date'});
  renderSources();
}
function renderSources(){
  $('source-fields').innerHTML=Object.entries(decision.sources).map(([key,source],i)=>`<div class="source-row"><span>${escape(sourceNames[key]||key)}</span><label for="source-kind-${i}">来源<select id="source-kind-${i}" data-source="${key}" data-source-part="kind">${sourceKinds.map(([kind,label])=>`<option value="${kind}"${source.kind===kind?' selected':''}>${label}</option>`).join('')}</select></label><label for="source-date-${i}">依据日期<input id="source-date-${i}" type="date" data-source="${key}" data-source-part="date" value="${escape(source.date)}"></label><label for="source-note-${i}">依据说明<input id="source-note-${i}" type="text" maxlength="300" data-source="${key}" data-source-part="note" value="${escape(source.note)}"></label></div>`).join('');
}
function storageWarning(message){storageUnavailable=true;$('storage-warning').hidden=false;$('storage-warning-text').textContent=message;$('download-recovery').hidden=recoveryRaw===null;}
function validDraft(value){
  const shape=(x,y)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===Object.keys(y).length&&Object.keys(y).every(k=>Object.hasOwn(x,k)&&(typeof y[k]==='object'?shape(x[k],y[k]):typeof x[k]===typeof y[k]||typeof y[k]==='number'&&x[k]===''));
  return shape(value,DEFAULT_DECISION)&&JSON.stringify(value).length<100000;
}
function readSnapshot(value){
  if(value?.format!==LOCAL_FORMAT){const workspace=decodeWorkspace(value);return {workspace,draft:clone(workspace.decision)};}
  if(Object.keys(value).length!==3||!Object.hasOwn(value,'workspace')||!Object.hasOwn(value,'draft')||!validDraft(value.draft))throw new Error('本地草稿备份格式无效，未替换当前数据。');
  return {workspace:decodeWorkspace(value.workspace),draft:clone(value.draft)};
}
function load(){
  decision=example();lastValid=makeWorkspace(decision,[]);
  try{
    const saved=localStorage.getItem(KEY);if(saved){
      recoveryRaw=saved;const value=JSON.parse(saved);
      if(value?.format===LOCAL_FORMAT){
        const workspace=decodeWorkspace(value.workspace);records=workspace.records;lastValid=workspace;
        if(validDraft(value.draft)){decision=clone(value.draft);recoveryRaw=null;}
        else{decision=clone(workspace.decision);storageWarning('当前草稿损坏，已恢复有效输入和全部档案。可先下载原始保存内容留作备份。');}
      }else{const snapshot=readSnapshot(value);decision=snapshot.draft;records=snapshot.workspace.records;lastValid=snapshot.workspace;recoveryRaw=null;}
    }
  }catch(error){storageProtected=recoveryRaw!==null;storageWarning(storageProtected?'原保存内容未通过校验，已保护原始数据不被普通编辑覆盖。可下载原始内容；当前修改可另行导出，或确认导入有效备份。':'本机存储不可用。本次仍可计算并导出，请保留已有备份。');}
  selectedId=records.at(-1)?.id??null;
}
function persist(){
  try{
    if(storageProtected){storageWarning('原始保存内容已保护，本次变化仅在当前打开中。请导出当前工作，或下载原始保存内容后导入有效备份。');return;}
    const valid=!validateDecision(decision).length;lastValid=makeWorkspace(valid?decision:lastValid.decision,records);
    localStorage.setItem(KEY,JSON.stringify({format:LOCAL_FORMAT,workspace:lastValid,draft:decision}));
    storageUnavailable=false;$('storage-warning').hidden=true;
    $('draft-status').textContent='当前草稿已保存在本机';
  }catch(error){storageWarning('浏览器未能保存本次变化，可能是存储被禁用或空间已满。计算仍可使用，请导出备份。');$('draft-status').textContent='当前变化仅保留在本次打开中';}
}
function say(message){$('operation').textContent=message+(storageUnavailable?' 当前变化仅在本次打开中，请导出备份。':'');}
function failureLabel(result){return result.complete?'已覆盖完整观察期':`第 ${result.failure.month} 月现金不足 ${amount(result.failure.shortfall)}；之后不继续推演`;}
function reserveLabel(result){return result.summary.firstReserveBreach!==null?(result.summary.firstReserveBreach===0?'起点已低于底线':`第 ${result.summary.firstReserveBreach} 月低于底线`):result.failure?`第 ${result.failure.month} 月发生现金缺口`:'观察期内未低于底线';}
function renderResults(){
  const errors=validateDecision(decision);$('validation-errors').hidden=!errors.length;$('validation-errors').innerHTML=errors.length?`<strong>有 ${errors.length} 项需要核对</strong><ul>${errors.map(e=>`<li>${escape(e)}</li>`).join('')}</ul>`:'';
  $('save-record').disabled=!!errors.length;
  if(errors.length){for(const id of ['result-cards','result-comparison','time-results','decision-conditions','monthly-results'])$(id).innerHTML='';$('scenario-description').textContent='输入修正后更新结果，不展示上一次测算。';return;}
  const result=compareDecision(decision,stress),a=result.baseline,b=result.changed;
  $('scenario-description').textContent=`${stress?`第 ${decision.assumptions.shockMonth} 月额外下跌 ${number(-decision.assumptions.shockReturn*100)}%；`:'无额外市场冲击；'}年回报假设 ${number(decision.assumptions.annualReturn*100)}%。改变从第 ${decision.change.startMonth} 月持续 ${decision.change.durationMonths} 个月，结束后恢复原安排。`;
  const endDelta=a.complete&&b.complete?b.summary.endCash-a.summary.endCash:null;
  $('result-cards').innerHTML=[['期末现金差异',endDelta===null?'路径未完成':`${endDelta>0?'+':''}${amount(endDelta)}`,'改变方案减保持现状；投资资产不算可用现金'],['每周工作与通勤减少',number(result.timeDelta.work)+' 小时','仅指改变期间；不自动认定为自由时间'],['改变方案的现金底线',reserveLabel(b),'底线由你设定，并非统一财务标准']].map(([label,value,note])=>`<div class="card"><span>${escape(label)}</span><strong>${escape(value)}</strong><small>${escape(note)}</small></div>`).join('');
  const metricRows=[['期末可用现金',amount(a.summary.endCash),amount(b.summary.endCash)],['期末投资资产',amount(a.summary.endAssets),amount(b.summary.endAssets)],['期末债务本金',amount(a.summary.endDebt),amount(b.summary.endDebt)],['期末净资产',amount(a.summary.endNetWorth),amount(b.summary.endNetWorth)],['最低现金（已完成月份含起点）',amount(a.summary.minimumCash),amount(b.summary.minimumCash)],['首次低于现金底线',reserveLabel(a),reserveLabel(b)],['推演状态',failureLabel(a),failureLabel(b)]];
  $('result-comparison').innerHTML=`<table><thead><tr><th>同一观察期</th><th>保持现状</th><th>${escape(decision.change.name)}</th></tr></thead><tbody>${metricRows.map(row=>`<tr>${row.map((v,i)=>`<${i?'td':'th'}>${escape(v)}</${i?'td':'th'}>`).join('')}</tr>`).join('')}</tbody></table>`;
  $('time-results').innerHTML=`<p>改变期间，每周工作及通勤 ${result.timeDelta.work>=0?'减少':'增加'} ${number(Math.abs(result.timeDelta.work))} 小时；睡眠 ${result.timeDelta.sleep>=0?'增加':'减少'} ${number(Math.abs(result.timeDelta.sleep))} 小时。</p><p class="muted">未分配时间变化：${result.timeDelta.unallocated>0?'+':''}${number(result.timeDelta.unallocated)} 小时／周。其他活动仍需你安排。生活影响由你观察，不折算为金钱收益。</p>`;
  $('decision-conditions').innerHTML=result.conditions.map(c=>`<li>${escape(c)}</li>`).join('');
  const rows=[];for(let i=0;i<decision.months;i++){const fa=a.frames[i],fb=b.frames[i];const cell=(r,f)=>f?amount(f.cash):r.failure?.month===i+1?`缺口 ${amount(r.failure.shortfall)}`:'已停止';rows.push(`<tr><th>第 ${i+1} 月</th><td>${escape(cell(a,fa))}</td><td>${escape(cell(b,fb))}</td></tr>`);}
  $('monthly-results').innerHTML=`<table><thead><tr><th>月末现金</th><th>保持现状</th><th>改变安排</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
  for(const prefix of ['profile','change']){const total=Object.values(decision[prefix].time).reduce((n,v)=>n+v,0);$(prefix==='profile'?'baseline-time-summary':'changed-time-summary').textContent=`每周已安排 ${number(total)} 小时；未分配 ${number(168-total)} 小时。`;}
}
function showStep(next){step=Math.max(1,Math.min(5,next));for(let i=1;i<=5;i++)$('step-'+i).hidden=i!==step;for(const button of document.querySelectorAll('[data-step]'))button.setAttribute('aria-current',Number(button.dataset.step)===step?'step':'false');$('previous-step').disabled=step===1;$('next-step').hidden=step===5;$('step-position').textContent=`第 ${step} 步，共 5 步`;$('next-step').textContent=['','下一步：确认现状','下一步：改变安排','下一步：对照结果','下一步：记录决定'][step]||'下一步';}
function record(){return records.find(r=>r.id===selectedId)??null;}
function renderArchive(){
  $('record-count').textContent=`${records.length} / 100 条`;
  $('record-select').innerHTML=records.length?records.map(r=>`<option value="${escape(r.id)}"${r.id===selectedId?' selected':''}>${escape(r.decision.startDate+' · '+r.decision.title)}</option>`).join(''):'<option value="">尚无档案</option>';
  const current=record();for(const id of ['preview-report','download-report'])$(id).disabled=!current;
  $('review-panel').hidden=!current;$('report-preview').hidden=true;$('confirm-delete').checked=false;
  $('record-summary').textContent=current?`保存于 ${current.createdAt.slice(0,10)} · ${current.decision.months} 个月 · 已追加 ${current.reviews.length} 次复盘。后续编辑不会改变本条快照。`:'保存后，在这里查看当时的依据、下载报告并追加实际记录。';
  $('review-history').innerHTML=current?current.reviews.map(r=>`<article class="review-item"><h4>${escape(r.date)}</h4><p>实际收入：${r.actualIncome===null?'未填写':escape(amount(r.actualIncome))}；实际支出：${r.actualExpenses===null?'未填写':escape(amount(r.actualExpenses))}</p><p>${escape(r.note)}</p><p>${escape(r.nextStep)}</p></article>`).join(''):'';
  $('review-date').value=current&&current.decision.startDate>today()?current.decision.startDate:today();
  for(const id of ['review-income','review-expenses','review-note','review-next'])$(id).value='';
}
function download(name,text,type='application/json;charset=utf-8'){
  const url=URL.createObjectURL(new Blob([text],{type})),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function safe(operation){try{operation();}catch(error){say(error.message||'操作未完成，请核对输入。');}}
function workspaceForExport(){
  if(!validateDecision(decision).length)return makeWorkspace(decision,records);
  return {format:LOCAL_FORMAT,workspace:makeWorkspace(lastValid.decision,records),draft:clone(decision)};
}
function backupText(value){
  const text=JSON.stringify(value,null,2);if(new Blob([text]).size>MAX_BACKUP_BYTES)throw new Error('备份超过 128 MB，请先分批整理档案；当前数据未替换。');return text;
}
function handleEdit(event){
  const el=event.target,path=el.dataset?.path,sourceKey=el.dataset?.source;
  if(path&&editable.has(path)){
    const config=editable.get(path);let value=el.value;
    if(config.type==='number'||path==='months'){value=value===''?'':Number(value);if(typeof value==='number'&&!Number.isFinite(value))value='';}
    setAt(path,value);
    const source=Object.keys(decision.sources).find(key=>path===key||path.startsWith(key+'.'));
    if(source){decision.sources[source]={kind:source.startsWith('assumptions.')?'assumption':'unknown',date:'',note:''};renderSources();}
    if(path.endsWith('.income.mode')){
      const prefix=path.slice(0,-5),income=valueAt(prefix),active=new Set(value==='mixed'?['fixedMonthly','hourlyRate','paidHoursWeek','pieceRate','unitsMonth']:value==='fixed'?['fixedMonthly']:value==='hourly'?['hourlyRate','paidHoursWeek']:['pieceRate','unitsMonth']);
      for(const key of ['fixedMonthly','hourlyRate','paidHoursWeek','pieceRate','unitsMonth'])if(!active.has(key)&&(!Number.isFinite(income[key])||income[key]<0||income[key]>(key==='paidHoursWeek'?168:1e9)))income[key]=0;
      const container=path.startsWith('profile')?'profile-income':'change-income';$(container).innerHTML=incomeFields(prefix);
    }
    $('confirm-facts').checked=false;renderResults();persist();
  }else if(sourceKey&&Object.hasOwn(decision.sources,sourceKey)&&['kind','date','note'].includes(el.dataset.sourcePart)){
    decision.sources[sourceKey][el.dataset.sourcePart]=el.value;$('confirm-facts').checked=false;renderResults();persist();
  }
}
document.addEventListener('input',handleEdit);
document.addEventListener('change',event=>{if(event.target.tagName==='SELECT')handleEdit(event);});
for(const button of document.querySelectorAll('[data-step]'))button.onclick=()=>{showStep(Number(button.dataset.step));$('step-title-'+step).focus();};
$('previous-step').onclick=()=>showStep(step-1);$('next-step').onclick=()=>{showStep(step+1);$('step-title-'+step).focus();};
$('market-base').onclick=()=>{stress=false;$('market-base').setAttribute('aria-pressed','true');$('market-stress').setAttribute('aria-pressed','false');renderResults();};
$('market-stress').onclick=()=>{stress=true;$('market-base').setAttribute('aria-pressed','false');$('market-stress').setAttribute('aria-pressed','true');renderResults();};
$('load-example').onclick=()=>safe(()=>{if(!$('replace-example-check').checked)throw new Error('请先确认替换当前草稿；已有决策档案会保留。');decision=example();$('replace-example-check').checked=false;$('confirm-facts').checked=false;renderForms();renderResults();persist();showStep(1);say('已载入示例，已有档案保持不变。');});
$('save-record').onclick=()=>safe(()=>{
  if(!$('confirm-facts').checked)throw new Error('请先核对输入并勾选确认。');if(records.length>=100)throw new Error('已达到 100 条档案，请先导出备份并整理。');
  const id=typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():`decision-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const entry=createRecord(decision,{id,createdAt:new Date().toISOString()});records=[...records,entry];selectedId=id;persist();renderArchive();say('决策已保存。当时的输入与两种市场情景一起保留。');
});
$('record-select').onchange=()=>{selectedId=$('record-select').value;renderArchive();};
$('preview-report').onclick=()=>safe(()=>{const current=record();if(!current)throw new Error('请先选择档案。');$('report-preview').srcdoc=renderReport(current);$('report-preview').hidden=false;});
$('download-report').onclick=()=>safe(()=>{const current=record();if(!current)throw new Error('请先选择档案。');download(`金融学人-决策报告-${current.decision.startDate}.html`,renderReport(current),'text/html;charset=utf-8');say('报告已下载，可独立打开并打印为 PDF。');});
$('append-review').onclick=()=>safe(()=>{
  const current=record();if(!current)throw new Error('请先选择档案。');const numeric=id=>$(id).value===''?null:Number($(id).value);
  const next=appendReview(current,{date:$('review-date').value,actualIncome:numeric('review-income'),actualExpenses:numeric('review-expenses'),note:$('review-note').value,nextStep:$('review-next').value});records=records.map(r=>r.id===current.id?next:r);persist();renderArchive();for(const id of ['review-income','review-expenses','review-note','review-next'])$(id).value='';say('已追加复盘，原测算未改变。');
});
$('delete-record').onclick=()=>safe(()=>{if(!$('confirm-delete').checked)throw new Error('请先确认删除所选档案。');records=records.filter(r=>r.id!==selectedId);selectedId=records.at(-1)?.id??null;persist();renderArchive();say('所选档案已删除。');});
$('export-data').onclick=()=>safe(()=>{download(`金融学人-1.3-全部数据-${today()}.json`,backupText(workspaceForExport()));say('数据已导出，含当前草稿与档案。请妥善保存个人记录。');});
$('import-data').onchange=async()=>{
  pendingImport=null;$('import-preview').hidden=true;
  try{const file=$('import-data').files[0];if(!file)return;if(file.size>MAX_BACKUP_BYTES)throw new Error('文件超过 128 MB，请使用 1.3 导出的数据文件。');const snapshot=readSnapshot(JSON.parse(await file.text()));pendingImport=snapshot;const workspace=snapshot.workspace;$('import-description').textContent=`准备导入：${workspace.decision.title}，含 ${workspace.records.length} 条档案${validateDecision(snapshot.draft).length?'及未完成草稿':''}。当前有 ${records.length} 条档案。尚未替换任何数据。`;$('import-preview').hidden=false;say('请核对导入预览。');}catch(error){say(error.message||'文件读取失败，未替换当前数据。');}finally{$('import-data').value='';}
};
$('cancel-import').onclick=()=>{pendingImport=null;$('import-preview').hidden=true;say('已取消，当前数据保持不变。');};
$('download-recovery').onclick=()=>safe(()=>{if(recoveryRaw===null)throw new Error('没有待恢复的原始保存内容。');download(`金融学人-1.3-原始保存备份-${today()}.json`,recoveryRaw);say('原始保存内容已发起下载，当前数据未替换。');});
$('confirm-import').onclick=()=>safe(()=>{
  if(!pendingImport)throw new Error('请先选择并校验数据文件。');
  const backup=workspaceForExport();download(`金融学人-1.3-替换前备份-${today()}.json`,backupText(backup));
  if(storageProtected&&recoveryRaw!==null)download(`金融学人-1.3-原始保存备份-${today()}.json`,recoveryRaw);
  storageProtected=false;recoveryRaw=null;
  decision=clone(pendingImport.draft);records=pendingImport.workspace.records;lastValid=pendingImport.workspace;pendingImport=null;selectedId=records.at(-1)?.id??null;$('import-preview').hidden=true;$('confirm-facts').checked=false;renderForms();renderResults();renderArchive();persist();showStep(1);say('已导入 1.3 数据，替换前备份已发起下载；1.2 数据未改变。');
});
load();renderForms();renderResults();renderArchive();showStep(1);
