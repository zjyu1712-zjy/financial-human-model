import { VERSION, STATE_GROUPS, PLAN_GROUPS, PARAM_FIELDS, DEFAULT_SCENARIO, UTILITY_LABELS, SYSTEM_LABELS, TIME_KEYS, clone, validateScenario } from './schema.js';
import { states, mechanisms, simulate, comparePlans, ensemble, sensitivity, calibrate, calibrationTemplate, validateSchedule, sum } from './model.js';
import { DEFAULT_MARGINAL, MARGINAL_METRICS, MARGINAL_CONTRIBUTIONS, validateMarginal, marginalEffects } from './marginal.js';
import { DEMO_GOALS, buildDecisionDemo, createLearningDemoScenario } from './demo.js';
import { DEFAULT_GUIDE, GUIDE_GOALS, GUIDE_STEPS, buildDecisionGuide, decodeGuideTrial } from './guide.js';
import { PAGES, resolvePage } from './navigation.js';
import { WORKSPACE_KEY, WORKSPACE_FORMAT, TRIAL_KEY, decisionKey, noteKey, decodeExperiment, decodeWorkspace } from './workspace.js';
import { DEFAULT_LIMITS, LIMIT_FIELDS, decodeLimits, DEFAULT_COMPARE_VIEW, relativePercent } from './comparison.js';
import { SLEEP_CASES, sleepDemo } from './sleep-comparison.js';
import { newDiary } from './sleep-diary.js';
import { mountSleepDiary } from './sleep-diary-ui.js';
import { PLAIN_FIELDS, PLAIN_GROUPS } from './copy.js';

const $=q=>document.querySelector(q);
const escapeHTML=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=(v,d=1)=>Number.isFinite(v)?v.toLocaleString('zh-CN',{minimumFractionDigits:d,maximumFractionDigits:d}):'不可计算';
const delta=v=>Number.isFinite(v)?`${v>0?'+':''}${number(v)}`:'不比较';
let current=clone(DEFAULT_SCENARIO),baseline=clone(DEFAULT_SCENARIO),schedule={},baselineSchedule={},weeks=12,comparison=null,fit=null;
let marginalConfig=clone(DEFAULT_MARGINAL),marginalResult=null;
const demoCache=new Map(),demoAmounts={learn:'1',recover:'1',income:'1'};
let demoGoal='learn';
let sleepDemoCase='original',sleepDemoSource='unallocated';
let sleepDiary=newDiary(),sleepDiaryUI=null;
let guideConfig=clone(DEFAULT_GUIDE),guideResult=null,guideChoice=null;
const guideNotes=new Map();
const guideSelections=new Map();
let guideStep=1,guideReached=1;
let guideLimits=clone(DEFAULT_LIMITS),guideView=clone(DEFAULT_COMPARE_VIEW);
const limitDrafts=new Map();
const timeLabels=Object.fromEntries(PLAN_GROUPS[0].fields.map(f=>[f.key,PLAIN_FIELDS[f.key]||f.label]));
const signed=(v,d=2)=>Number.isFinite(v)?`${v>0?'+':''}${number(v,d)}`:'不计算';
const hours=v=>number(v,v>0&&v<.01?3:2);
const drafts=new Map();
const fieldDrafts=new Map();
let ready=false,restoring=false,storageBlocked=false;
const stateFormulas={
  body:'B = 0.45 健康 + 0.30 睡眠质量 + 0.25 (100 − 疲劳)',
  cognition:'Cog = (0.35 知识 + 0.25 校准 + 0.25 自知 + 0.15 注意力) × (1 − 0.35 偏差/100)',
  emotion:'Emo = 0.35 调节 + 0.25 动机 + 0.20 (100 − 反刍) + 0.20 (100 − 压力)',
  social:'Soc = 0.45 支持 + 0.35 信任 + 0.20 触达 − 0.20 冲突',
  finance:'Fin = 0.65 缓冲达标分 + 0.35 偿债覆盖分；现金、资产、负债另记人民币账本',
  desire:'Des = 0.40 价值清晰 + 0.30 自主 + 0.30 (100 − 比较压力)'
};
const paths={
  body:'健康、睡眠、疲劳 → 注意力与有效投入 → 工作收入、知识增益；过载和情绪损耗 → 下一周疲劳',
  cognition:'知识、校准、自知、偏差 → 有效工作；偏差同时影响学习效率和风险波动放大',
  emotion:'压力与反刍 → 情绪负荷；调节与支持 → 容量；超额 → 六条行为通道',
  social:'支持 → 情绪调节容量；信任与冲突 → 关系效用；关系时间 → 缓慢修复',
  finance:'实际现金流 → 可行性与现金缓冲；持仓 × 波动 → 风险敞口；净财富按账本恒等式更新',
  desire:'比较压力 → 情绪负荷；品质目标 → 可持续缺口；价值匹配 → 意义与欲望成本；自主感 → 自主效用'
};
function field(f,group,prefix=''){const id=`${prefix}${group}-${f.key}`,label=group==='state'||group==='plan'?PLAIN_FIELDS[f.key]||f.label:f.label,unit=f.key==='fatigue'?'0–100分':f.unit||'重视程度';return `<div class="field"><label for="${id}" title="${escapeHTML(f.meaning||'个人偏好相对权重')}">${escapeHTML(label)}</label><input id="${id}" type="number" min="${f.min}" max="${f.max}" step="any" value="${current[group][f.key]}" data-group="${group}" data-key="${f.key}" aria-label="${escapeHTML(label)}" aria-invalid="false"><span class="unit">${escapeHTML(unit)}</span></div>`;}
function table(headers,rows){return `<table><thead><tr>${headers.map(h=>`<th>${escapeHTML(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(v=>`<td>${escapeHTML(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;}
function announce(text){$('#operation').textContent=text;}
function setError(text){$('#error').hidden=!text;$('#error').textContent=text;}
sleepDiaryUI=mountSleepDiary({getCurrent:()=>current,getDiary:()=>sleepDiary,setDiary:value=>{sleepDiary=value;persistWorkspace();},blocked:()=>drafts.size>0||limitDrafts.size>0,
  apply:next=>{rememberGuideNote();const rawSchedule=$('#schedule').value;current=next;renderControls();$('#schedule').value=rawSchedule;renderResults();persistWorkspace();}});
function refreshDrafts(){
  setError([...drafts.values()].join('；'));
  for(const id of ['pin','analyze'])$('#'+id).disabled=drafts.size>0;
  if(drafts.size)clearMarginal('输入未通过校验；边际结果已清除。');
}
function mirrorField(group,key,value,invalid=false){
  for(const el of document.querySelectorAll('[data-group]'))if(el.dataset.group===group&&el.dataset.key===key){
    if(el!==document.activeElement)el.value=value;
    el.setAttribute('aria-invalid',String(invalid));
  }
}
function renderPersonalInputs(){
  const fields=(group,keys)=>keys.map(key=>field((group==='parameters'?PARAM_FIELDS:(group==='plan'?PLAN_GROUPS:STATE_GROUPS).flatMap(g=>g.fields)).find(f=>f.key===key),group,'personal-')).join('');
  $('#personal-inputs').innerHTML=`<div><h3>现在一周怎么过</h3>${fields('plan',['work','learn','sleep','leisure'])}</div><div><h3>钱和精力</h3>${fields('state',['cash','fatigue'])}${fields('plan',['wage','essential'])}</div><details class="personal-advanced"><summary>睡眠计算用的设置（可先不改）</summary>${fields('parameters',['sleepNeed','fatigueRecovery'])}${fields('state',['sleepDebt','sleepQuality'])}</details>`;
  $('#diary-reference-field').innerHTML=field({...PARAM_FIELDS.find(f=>f.key==='sleepNeed'),label:'先按每天睡多久来比较'},'parameters','diary-');
}
function renderControls(){
  $('#plan-controls').innerHTML=PLAN_GROUPS.map(g=>`<div class="field-group"><h3>${g.id==='shocks'?'第一周可能遇到的变化':g.name}</h3>${g.fields.map(f=>field(f,'plan')).join('')}</div>`).join('');
  $('#state-controls').innerHTML=STATE_GROUPS.map(g=>`<article class="system"><header><h3>${PLAIN_GROUPS[g.id]}</h3><strong id="score-${g.id}" title="模型综合分，0–100">0</strong></header>${g.fields.map(f=>field(f,'state')).join('')}</article>`).join('');
  const sleepKeys=['sleepNeed','fatigueRecovery','sleepDebtRepay','sleepDebtImpact'];
  $('#parameters').innerHTML=[['睡眠与恢复',PARAM_FIELDS.filter(f=>sleepKeys.includes(f.key))],['学习与资金',PARAM_FIELDS.filter(f=>!sleepKeys.includes(f.key)).slice(0,8)],['评价权重',PARAM_FIELDS.filter(f=>!sleepKeys.includes(f.key)).slice(8)]].map(([label,fs])=>`<div><h3>${label}</h3>${fs.map(f=>field(f,'parameters')).join('')}</div>`).join('');
  $('#weights').innerHTML=Object.entries(UTILITY_LABELS).map(([key,label])=>field({key,label,min:0,max:10,unit:'权重'},'weights')).join('');
  $('#schedule').value=JSON.stringify(schedule,null,2);
  $('#schedule-note').textContent=Object.keys(schedule).length?`${Object.keys(schedule).length} 周有单独安排`:'无逐周覆盖';
  renderMarginalControls();
  renderPersonalInputs();
  renderLimitControls();
  sleepDiaryUI?.render();
}
function card(label,value,reference,unit){const difference=Number.isFinite(value)&&Number.isFinite(reference)?value-reference:null;return `<article class="metric"><span class="label">${label}</span><strong>${number(value)} <small>${unit}</small></strong><small>对照安排 ${number(reference)} · 相差 ${delta(difference)}</small></article>`;}
function renderResults(){
  comparison=comparePlans(current,baseline,weeks,schedule,baselineSchedule);
  const {current:a,baseline:b}=comparison;
  const av=a.feasible?a.final:null,bv=b.feasible?b.final:null;
  const question=$('#question').value;
  const definitions={
    cash:card('最后剩多少钱',av?.cash,bv?.cash,'元'),
    fatigue:card('最后一周有多累',av?.fatigue,bv?.fatigue,'分'),
    knowledge:card('最后学到多少',av?.knowledge,bv?.knowledge,'分'),
    wealth:card('扣掉欠款后还剩多少资产',av?av.cash+av.assets-av.debt:null,bv?bv.cash+bv.assets-bv.debt:null,'元'),
    objective:card('按个人偏好的综合得分',a.total,b.total,'分')
  };
  const order=question==='invest'?['cash','wealth','fatigue','objective']:question==='spend'?['cash','wealth','fatigue','objective']:['cash','fatigue','knowledge','objective'];
  $('#summary').innerHTML=order.map(k=>definitions[k]).join('');
  if(!a.feasible){$('#verdict').innerHTML=`<p class="bad">第 ${a.failedWeek} 周不可执行：${escapeHTML(a.errors.join('；'))}</p>`;}
  else if(!b.feasible){$('#verdict').textContent=`基准第 ${b.failedWeek} 周不可执行；当前方案可完成。`;}
  else{
    $('#verdict').textContent=[!comparison.sameStart&&'起点不同',!comparison.sameMechanism&&'机制参数不同',!comparison.samePreferences&&'重视的事情不同'].filter(Boolean).join(' · ');
  }
  const x=states(current.state,current.plan,current.parameters);
  for(const key of Object.keys(SYSTEM_LABELS))$('#score-'+key).textContent=number(x[key],0);
  drawChart();
  $('#weekly-results').innerHTML=table(['周','剩多少钱（元）','扣掉欠款后的资产（元）','有多累（分）','学到多少（分）','这一周的综合得分','能否按计划进行'],a.frames.map(f=>f.feasible?[f.week,number(f.next.cash),number(f.states.netWorth),number(f.next.fatigue),number(f.next.knowledge),number(f.net),f.warnings.join('；')||'可以']:[f.week,'不执行','不执行','不执行','不执行','不排名',f.errors.join('；')]));
  renderTrace(a.frames[0]);
  $('#uncertainty').textContent='待重新计算';$('#sensitivity').innerHTML='';
  renderMarginal();
  syncLinkedGuide();
  sleepDiaryUI?.render();
  persistWorkspace();
}
function renderMarginalControls(){
  const options=Object.entries(timeLabels).map(([k,v])=>`<option value="${k}">${v}</option>`).join('');
  $('#marginal-target').innerHTML=options;
  $('#marginal-source').innerHTML=options+'<option value="unallocated">未分配时间</option>';
  for(const key of Object.keys(DEFAULT_MARGINAL))$('#marginal-'+key).value=marginalConfig[key];
  for(const key of ['step','week'])$('#marginal-'+key).setAttribute('aria-invalid','false');
  $('#marginal-metric').innerHTML=Object.entries(MARGINAL_METRICS).map(([k,v])=>`<option value="${k}">${v.label} · ${v.unit}</option>`).join('');
  $('#marginal-metric').value='knowledge';
}
function clearMarginal(message){
  marginalResult=null;$('#marginal-status').textContent=message;
  for(const id of ['summary','detail','curve','systems','contributions'])$('#marginal-'+id).innerHTML='';
  $('#marginal-verdict').textContent='';$('#marginal-formula').textContent='';
}
function renderMarginal(){
  $('#marginal-week').disabled=marginalConfig.frequency!=='once';$('#marginal-week').max=weeks;
  if(drafts.size){clearMarginal('输入未通过校验；边际结果已清除。');return;}
  try{
    marginalResult=marginalEffects(current,weeks,schedule,marginalConfig);
    const r=marginalResult,p=r.primary,c=marginalConfig,source=c.source==='unallocated'?'未分配时间':timeLabels[c.source];
    const period=c.frequency==='weekly'?`每周重复，共 ${weeks} 周`:`只调整第 ${c.week} 周，观察至第 ${weeks} 周`;
    $('#marginal-status').textContent=`${source} → ${timeLabels[c.target]} · ${period} · 共转入 ${number(p.totalHours,2)} 小时`;
    $('#marginal-formula').textContent=`ΔY = 调整后的结果 − 当前安排的结果\n累计转入 H = 每次调整 δ × 调整周数 n\n每转入 1 小时的结果变化 = ΔY / H\n本次：H = ${c.step} × ${r.affectedWeeks} = ${p.totalHours} 小时\n相邻段边际效应 = (Y₂ − Y₁) / (H₂ − H₁)\n步长比较：0.5δ、δ、2δ、4δ；不将一种步长的结果线性外推。\n现金、疲劳、知识与六系统均看期末差值；收入、学习效果（折算）与 J 为周期累计差值。\nJ 的变化 = 六项加权贴现综合得分的组成 + 四项成本贡献；成本减少记为正贡献。`;
    for(const id of ['summary','detail','systems','contributions'])$('#marginal-'+id).innerHTML='';
    if(!p.feasible){
      $('#marginal-verdict').textContent=`${r.baselineFeasible?'调整后':'当前安排'}在第 ${p.failedWeek} 周不可行：${p.errors.join('；')}`;
      renderMarginalCurve();return;
    }
    $('#marginal-summary').innerHTML=['cash','fatigue','knowledge'].map(k=>{
      const m=MARGINAL_METRICS[k];return `<article class="metric"><span class="label">${weeks}周后，${m.label}变化</span><strong>${signed(p.delta[k])} <small>${m.unit}</small></strong><small>每转入 1 小时：${signed(p.perHour[k],3)} ${m.unit}/小时</small></article>`;
    }).join('');
    $('#marginal-verdict').textContent='';
    const keys=['cash','fatigue','knowledge','income','effectiveLearn','objective'];
    $('#marginal-detail').innerHTML=table(['结果差值',`首次调整周末（第 ${r.firstWeek} 周）`,`周期末（第 ${weeks} 周）`],keys.map(k=>[`${MARGINAL_METRICS[k].label}（${MARGINAL_METRICS[k].unit}）`,signed(p.firstDelta[k]),signed(p.delta[k])]));
    $('#marginal-systems').innerHTML=table(['最后的状态','当前安排','调整后','变化'],['body','cognition','emotion','social','finance','desire'].map(k=>[MARGINAL_METRICS[k].label,number(r.baseline[k],2),number(p.metrics[k],2),signed(p.delta[k])]));
    $('#marginal-contributions').innerHTML=table(['综合得分怎么变化','得分变化'],[
      ...Object.entries(MARGINAL_CONTRIBUTIONS).map(([k,v])=>[v,signed(p.contributions[k],3)]),['合计',signed(p.delta.objective,3)]
    ]);
    renderMarginalCurve();
  }catch(e){clearMarginal(e.message);}
}
function renderMarginalCurve(){
  if(!marginalResult)return;
  const r=marginalResult,key=$('#marginal-metric').value,m=MARGINAL_METRICS[key];
  const max=Math.max(1e-9,...r.points.filter(p=>p.feasible).map(p=>Math.abs(p.delta[key])));
  $('#marginal-curve').innerHTML=r.points.map(p=>{
    const heading=`每次 +${hours(p.amount)} 小时`;
    if(!p.feasible)return `<article class="marginal-point"><h4>${heading}</h4><p class="error">不可行 · 第 ${p.failedWeek} 周</p><p>${escapeHTML(p.errors.join('；'))}</p></article>`;
    const width=Math.abs(p.delta[key])/max*50,left=p.delta[key]<0?50-width:50;
    return `<article class="marginal-point"><h4>${heading}</h4><span class="muted">共转入 ${hours(p.totalHours)} 小时</span><div class="bar-track" aria-hidden="true"><span class="bar-fill ${p.delta[key]<0?'negative':''}" style="left:${left}%;width:${width}%"></span></div><dl><dt>相对当前安排的${m.label}变化</dt><dd>${signed(p.delta[key],3)} ${m.unit}</dd><dt>平均每转入 1 小时</dt><dd>${signed(p.perHour[key],3)} ${m.unit}/小时</dd><dt>${p.segment?`每次 ${hours(p.segment.from)} → ${hours(p.amount)} 小时这一段`:'相邻段'}</dt><dd>${p.segment?signed(p.segment.perHour[key],3)+' '+m.unit+'/小时':'前一档不可行，不比较'}</dd></dl></article>`;
  }).join('');
}
function renderPage(moveFocus=false){
  const page=resolvePage(globalThis.location?.hash||''),info=PAGES[page];
  for(const key of Object.keys(PAGES)){
    $('#'+key).hidden=key!==page;
    $('#nav-'+key).setAttribute('aria-current',key===page?'page':'false');
  }
  $('#page-title').textContent=info.title;$('#page-description').textContent=info.description;
  $('#page-description').hidden=!info.description;
  $('#experiment-controls').hidden=!info.controls;$('#experiment-status').hidden=['demo','guide'].includes(page);
  const professional=!['guide','demo','model'].includes(page);
  $('#professional-title').textContent='更多工具';
  $('#professional-tools').setAttribute('data-active',String(professional));
  if(moveFocus)$('#professional-tools').open=false;
  document.title=`${info.title} · 金融学人 1.2`;
  if(page==='decision'&&comparison)drawChart();
  if(page==='guide'&&guideStep===3)drawGuideTrend();
  if(page==='demo')renderSleepDemo();
  if(moveFocus){globalThis.scrollTo?.({top:0,behavior:'auto'});$('#page-title').focus?.({preventScroll:true});}
}
const relative=(v,unit,digits=2)=>Math.abs(v)<1e-9?'不变':`${v>0?'多':'少'} ${number(Math.abs(v),digits)} ${unit}`;
const guideMetrics={knowledge:{label:'最后学到多少',unit:'分',digits:2},fatigue:{label:'最后一周有多累',unit:'分',digits:1},averageFatigue:{label:'这段时间平均有多累',unit:'分',digits:2},
  cash:{label:'最后剩多少钱',unit:'元',digits:0},income:{label:'这段时间赚的钱',unit:'元',digits:0},sleepDebt:{label:'最后还差多少睡眠',unit:'小时',digits:1},effectiveLearn:{label:'学习效果（折算小时）',unit:'小时',digits:1}};
function guideOutcome(key,d){
  const m=guideMetrics[key],value=d[key],unit=10**(-m.digits);
  if(Math.abs(value)>1e-9&&Math.abs(value)<unit)return `${value>0?'多':'少'}不到 ${number(unit,m.digits)} ${m.unit}`;
  return relative(value,m.unit,m.digits);
}
function percentLabel(value,reference){
  const percent=relativePercent(value,reference);
  if(percent===null)return reference===0?'原值为0':'原值过小，不算比例';
  if(Math.abs(percent)<1e-9)return '0.0%';
  if(Math.abs(percent)<.1)return `${percent>0?'增加':'减少'}<0.1%`;
  return `${percent>0?'+':'−'}${number(Math.abs(percent),1)}%`;
}
function percentMarkup(value,reference){
  return `<span class="compare-percent" title="相对原安排的变化量 ÷ 原安排数值 × 100%">${escapeHTML(percentLabel(value,reference))}</span>`;
}
function renderLimitControls(){
  for(const key of Object.keys(LIMIT_FIELDS)){
    const el=$('#guide-limit-'+key);if(el!==document.activeElement)el.value=limitDrafts.has(key)?limitDrafts.get(key):guideLimits[key]??'';
    el.setAttribute('aria-invalid',String(limitDrafts.has(key)));
  }
  $('#guide-limit-error').hidden=!limitDrafts.size;
  $('#guide-limit-error').textContent=[...limitDrafts.keys()].map(k=>`${LIMIT_FIELDS[k].label}请输入0至${LIMIT_FIELDS[k].max}，或留空`).join('；');
  $('#guide-limits-panel').open=guideView.limitsOpen;
}
const guideCompareKeys=()=>guideConfig.goal==='learn'?['effectiveLearn','cash','fatigue']:guideConfig.goal==='recover'?['fatigue','sleepDebt','cash','effectiveLearn']:['income','cash','fatigue','effectiveLearn'];
function comparedRows(){
  const available=guideResult?.available||[],pair=guideView.pairs[guideConfig.goal];
  const a=available.find(r=>r.id===pair[0])??available[0];
  const b=available.find(r=>r.id===pair[1]&&r.id!==a?.id)??available.find(r=>r.id!==a?.id);
  return [a,b].filter(Boolean);
}
const atWeek=week=>week===0?'起点':`第${week}周`;
function compareTable(headers,rows){
  return `<table class="guide-compare-table"><colgroup><col class="compare-label-col">${headers.slice(1).map(()=>'<col>').join('')}</colgroup><thead><tr>${headers.map(h=>`<th scope="col">${escapeHTML(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr><th scope="row">${row[0]}</th>${row.slice(1).map(v=>`<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function renderGuideComparison(){
  const rows=comparedRows(),base=guideResult?.baselinePath;
  $('#guide-compare-panel').hidden=!rows.length;
  for(const id of ['guide-comparisons','guide-direct-summary','guide-margins','guide-trend-chart','guide-process-summary','guide-trend-values','guide-full-values'])$('#'+id).innerHTML='';
  if(!rows.length||!base)return;
  const headers=['相对原安排',...rows.map((r,i)=>`方案${i===0?'A':'B'}`)];
  const options=guideResult.available.map(r=>`<option value="${r.id}">${r.source==='unallocated'?'空余时间':timeLabels[r.source]} → ${timeLabels[r.target]}</option>`).join('');
  for(const [i,id] of ['guide-compare-a','guide-compare-b'].entries()){$('#'+id).innerHTML=options;$('#'+id).value=rows[i]?.id??'';}
  $('#guide-compare-b-label').hidden=rows.length<2;
  const keys=guideCompareKeys();
  const timeValue=(path,key)=>key==='unallocated'?weeks*168-TIME_KEYS.reduce((total,k)=>total+path.planned[k],0):path.planned[key];
  const data=[[`总共挪了多少时间<small>整个${weeks}周</small>`,...rows.map(r=>`<div class="compare-time-flow"><span>${r.source==='unallocated'?'空余时间':timeLabels[r.source]}</span><span aria-hidden="true">→</span><span>${timeLabels[r.target]}</span></div><strong>${number(guideResult.totalHours,0)} 小时</strong><small class="compare-time-percent">${timeLabels[r.target]} ${escapeHTML(percentLabel(timeValue(r.path,r.target),timeValue(base,r.target)))} · ${r.source==='unallocated'?'空余时间':timeLabels[r.source]} ${escapeHTML(percentLabel(timeValue(r.path,r.source),timeValue(base,r.source)))}</small><small>${escapeHTML(guidePlanLine(r))}</small>`)],...keys.flatMap(key=>key==='fatigue'?[key,'averageFatigue']:[key]).map(key=>{
    const reference=key==='averageFatigue'?base.averageFatigue:rows[0].baseline[key];
    const read=r=>key==='averageFatigue'?r.path.averageFatigue:r.point.metrics[key];
    const m=guideMetrics[key],scale=Math.max(1e-9,...rows.map(r=>Math.abs(read(r)-reference)));
    return [`${escapeHTML(m.label)}<small>原安排 ${number(reference,m.digits)} ${m.unit}</small>`,...rows.map(r=>{
      const adjusted=read(r),value=adjusted-reference,width=Math.abs(value)/scale*50,left=value<0?50-width:50,good=value*(['fatigue','averageFatigue','sleepDebt'].includes(key)?-1:1)>0;
      return `<div class="compare-value ${Math.abs(value)<1e-9?'':good?'compare-gain':'compare-cost'}"><strong>${guideOutcome(key,{[key]:value})}</strong>${percentMarkup(adjusted,reference)}</div><div class="compare-delta-bar" aria-hidden="true"><span style="left:${left}%;width:${width}%" class="${good?'compare-gain':'compare-cost'}"></span></div><small>调整后 ${number(adjusted,m.digits)} ${m.unit}</small>`;
    })];
  })];
  $('#guide-comparisons').innerHTML='<div class="section-head"><h3>投入与回报</h3><div class="compare-key"><span class="compare-gain">收获 / 减负</span><span class="compare-cost">损失 / 负担</span></div></div>'+compareTable(headers,data);
  $('#guide-comparisons').setAttribute('data-goal',guideConfig.goal);
  $('#guide-direct-summary').textContent=rows.length===2?`方案B比方案A：${keys.map(key=>`${guideMetrics[key].label}${guideOutcome(key,{[key]:rows[1].point.metrics[key]-rows[0].point.metrics[key]})}`).join('，')}。`:'当前只有这一项满足条件的调整方案。';
  const marginRows=rows[0].margins.map((item,i)=>{
    const heading=item.key==='minCash'?`现金至少保留 ${number(item.limit,0)} 元`:item.key==='minSleep'?`每周至少睡眠 ${number(item.limit,1)} 小时`:`${weeks}周最多少赚 ${number(item.limit,0)} 元`;
    return [heading,...rows.map(r=>{
      const m=r.margins[i],precision=m.key==='minSleep'?1:0;
      const slack=m.margin<1e-8?'刚好到线':m.margin<10**(-precision)?`余量不到 ${10**(-precision)} ${m.unit}`:`余量 ${number(m.margin,precision)} ${m.unit}`;
      return `<strong>${slack}</strong><small>${atWeek(m.week)} · ${m.key==='maxIncomeLoss'?'累计收入':m.key==='minCash'?'现金':'睡眠'} ${number(m.value,precision)} ${m.unit}</small>`;
    })];
  });
  $('#guide-margins').innerHTML=marginRows.length?compareTable(headers,marginRows):'<p class="muted">尚未设置个人底线。</p>';
  $('#guide-edit-limits').textContent=marginRows.length?'修改底线':'设置底线';
  const all=[{label:'原安排',path:base},...rows.map((r,i)=>({label:`方案${i===0?'A':'B'}`,path:r.path}))];
  $('#guide-full-values').innerHTML=table(['整个'+weeks+'周',...all.map(r=>r.label)],
    [['累计学习投入（小时）',p=>p.planned.learn],['学习效果（折算）（模型估计，小时）',p=>p.effectiveLearn],['累计工作投入（小时）',p=>p.planned.work],['这段时间赚的钱（元）',p=>p.income],['最后学到多少（分）',p=>p.series.at(-1).knowledge],['这段时间平均有多累（分）',p=>p.averageFatigue],['累计疲劳负担（分·周）',p=>p.fatigueBurden],['最后还差多少睡眠（小时）',p=>p.series.at(-1).sleepDebt]].map(([label,read])=>[label,...all.map(r=>number(read(r.path),2))]));
  $('#guide-process-summary').innerHTML=compareTable(headers,[
    ['最低现金',...rows.map(r=>`<strong>${number(r.path.minimumCash.value,0)} 元</strong><small>${atWeek(r.path.minimumCash.week)}</small>`)],
    ['最高疲劳',...rows.map(r=>`<strong>${number(r.path.maximumFatigue.value,1)} 分</strong><small>${atWeek(r.path.maximumFatigue.week)}</small>`)]
  ]);
  $('#guide-trend-details').open=guideView.trendOpen;$('#guide-detail-details').open=guideView.detailOpen;
  for(const k of ['cash','fatigue','effectiveLearn','sleepDebt'])$('#guide-trend-'+k).checked=k===guideView.metric;
  drawGuideTrend();
}
function drawGuideTrend(){
  const rows=comparedRows(),base=guideResult?.baselinePath;
  if(!rows.length||!base||!guideView.trendOpen)return;
  const key=guideView.metric,m=guideMetrics[key],all=[{id:'original',label:'原安排',path:base},...rows.map((r,i)=>({id:i===0?'a':'b',label:`方案${i===0?'A':'B'}`,path:r.path}))];
  $('#guide-trend-unit').textContent=key==='effectiveLearn'?`累计学习效果（折算） · 模型估计 · ${m.unit}`:`${key==='cash'?'现金余额':key==='sleepDebt'?'估计欠的睡眠':'累的程度'} · ${m.unit}`;
  $('#guide-trend-legend').innerHTML=all.map(r=>`<span class="trend-${r.id}">${r.label}</span>`).join('');
  const values=all.flatMap(r=>r.path.series.map(p=>p[key])),floor=key==='cash'?guideLimits.minCash:null;
  if(floor!==null)values.push(floor);
  const lo=Math.min(...values),hi=Math.max(...values),pad=Math.max((hi-lo)*.12,1),min=Math.max(0,lo-pad),max=Math.max(min+1,hi+pad);
  const width=Math.max(280,$('#guide-trend-chart').clientWidth||640),right=width-16,bottom=206;
  const x=week=>58+week/weeks*(right-58),y=v=>bottom-(v-min)/(max-min)*176;
  const axis=v=>Math.abs(v)>=1e8?`${number(v/1e8,1)}亿`:Math.abs(v)>=10000?`${number(v/10000,1)}万`:number(v,Math.abs(max-min)<10?1:0);
  const grid=Array.from({length:4},(_,i)=>{const value=min+(max-min)*i/3;return `<line x1="58" x2="${right}" y1="${y(value)}" y2="${y(value)}" class="chart-grid"/><text x="50" y="${y(value)+4}" text-anchor="end">${axis(value)}</text>`;}).join('');
  const paths=all.map(r=>`<path data-guide-series="${r.id}" class="trend-${r.id}" d="${r.path.series.map((p,i)=>`${i?'L':'M'}${x(p.week)},${y(p[key])}`).join(' ')}"/>`).join('');
  const markers=!['cash','fatigue'].includes(key)?'':all.map(r=>{const p=key==='cash'?r.path.minimumCash:r.path.maximumFatigue;return `<circle class="trend-${r.id}" cx="${x(p.week)}" cy="${y(p.value)}" r="3.5"><title>${r.label} · ${atWeek(p.week)} · ${key==='cash'?'最低现金':'最高疲劳'} ${number(p.value,m.digits)} ${m.unit}</title></circle>`;}).join('');
  const line=floor===null?'':`<line class="trend-limit" x1="58" x2="${right}" y1="${y(floor)}" y2="${y(floor)}"/><text class="trend-limit-label" x="${right}" y="${y(floor)-6}" text-anchor="end">我的现金底线</text>`;
  $('#guide-trend-chart').innerHTML=`<svg viewBox="0 0 ${width} 240" role="img" aria-label="${escapeHTML($('#guide-trend-unit').textContent)}，原安排与${rows.length}个方案，起点至第${weeks}周"><title>${escapeHTML($('#guide-trend-unit').textContent)}</title>${grid}${paths}${markers}${line}<text x="58" y="230">起点</text><text x="${x(Math.floor(weeks/2))}" y="230" text-anchor="middle">第${Math.floor(weeks/2)}周</text><text x="${right}" y="230" text-anchor="end">第${weeks}周</text></svg>`;
  $('#guide-trend-values').innerHTML=table([`周 · ${m.unit}`,...all.map(r=>r.label)],base.series.map((p,i)=>[p.week,...all.map(r=>number(r.path.series[i][key],key==='cash'?0:1))]));
}
for(const key of Object.keys(LIMIT_FIELDS))$('#guide-limit-'+key).oninput=()=>{
  const el=$('#guide-limit-'+key),raw=el.value,candidate={...guideLimits,[key]:raw.trim()===''?null:Number(raw)};
  try{guideLimits=decodeLimits(candidate);limitDrafts.delete(key);}catch{limitDrafts.set(key,raw);}
  rememberGuideNote();invalidateGuideSteps(2);renderLimitControls();syncLinkedGuide();persistWorkspace();
};
$('#guide-edit-limits').onclick=()=>{guideView.limitsOpen=true;$('#guide-limits-panel').open=true;goGuideStep(2);$('#guide-limit-minCash').focus?.();};
for(const [i,id] of ['guide-compare-a','guide-compare-b'].entries())$('#'+id).onchange=()=>{
  const old=comparedRows().map(r=>r.id),value=$('#'+id).value;
  if(!guideResult?.available.some(r=>r.id===value))return;
  const pair=[old[0]??null,old[1]??null];pair[i]=value;if(pair[1-i]===value)pair[1-i]=old[i]??null;
  guideView.pairs[guideConfig.goal]=pair;renderGuideComparison();persistWorkspace();
};
for(const key of ['cash','fatigue','effectiveLearn','sleepDebt'])$('#guide-trend-'+key).onchange=()=>{if($('#guide-trend-'+key).checked){guideView.metric=key;drawGuideTrend();persistWorkspace();}};
for(const [id,key] of [['guide-trend-details','trendOpen'],['guide-detail-details','detailOpen'],['guide-limits-panel','limitsOpen']])$('#'+id).ontoggle=()=>{
  const open=$('#'+id).open;if(guideView[key]===open)return;guideView[key]=open;if(key==='trendOpen')drawGuideTrend();persistWorkspace();
};
function guideStepIssue(){
  if(guideStep===1&&guideConfig.goal==='income'&&guideConfig.incomeMode!=='output')return guideResult?.blocker||'先确认额外工作的计酬方式。';
  if(!guideResult)return guideStep===1?'':$('#guide-status').textContent||'当前输入无法计算，请核对起点。';
  if(guideStep===1)return guideResult.blocker;
  if(guideStep===3&&!guideResult.available.length)return '当前没有可试行的安排。请返回核对目标或底线，也可以暂时不改变。';
  if(guideStep===4&&!guideResult.available.some(r=>r.id===guideChoice))return '先选择一项愿意试行的安排。';
  return '';
}
function renderGuideSteps(moveFocus=false){
  for(let step=1;step<=GUIDE_STEPS.length;step++){
    $('#guide-step-'+step).hidden=step!==guideStep;
    const button=$('#guide-nav-'+step);
    button.disabled=step>guideReached;
    button.setAttribute('aria-current',step===guideStep?'step':'false');
    button.setAttribute('data-complete',String(step<guideReached&&step!==guideStep));
  }
  $('#guide-progress').textContent=`第 ${guideStep} 步，共 ${GUIDE_STEPS.length} 步`;
  $('#guide-context').hidden=guideStep===1;
  $('#guide-context').textContent=`${GUIDE_GOALS[guideConfig.goal].label} · 每周调整 ${guideConfig.amount} 小时 · 我的输入`;
  $('#guide-back').hidden=guideStep===1;$('#guide-next').hidden=guideStep===GUIDE_STEPS.length;
  const issue=guideStepIssue();
  $('#guide-next').disabled=!!issue;
  $('#guide-next').textContent=guideStep===4?'进入试一周再回看':`下一步：${GUIDE_STEPS[guideStep]?.label||'完成'}`;
  $('#guide-step-hint').hidden=!issue;$('#guide-step-hint').textContent=issue;
  if(guideStep===3)drawGuideTrend();
  if(moveFocus){globalThis.scrollTo?.({top:0,behavior:'auto'});$('#'+GUIDE_STEPS[guideStep-1].heading).focus?.({preventScroll:true});}
}
function goGuideStep(step){
  if(!Number.isInteger(step)||step<1||step>guideReached)return;
  rememberGuideNote();guideStep=step;renderGuideSteps(true);persistWorkspace();
}
function invalidateGuideSteps(from){guideReached=Math.min(guideReached,from);guideStep=Math.min(guideStep,from);}
function guidePlanLine(row){
  const a={...current.plan,...schedule[1]};
  return `${timeLabels[row.target]} ${a[row.target]} → ${row.plan[row.target]} 小时；${row.source==='unallocated'?`未分配时间减少 ${guideConfig.amount} 小时`:`${timeLabels[row.source]} ${a[row.source]} → ${row.plan[row.source]} 小时`}`;
}
function renderGuideChoices(){
  const goal=GUIDE_GOALS[guideConfig.goal];
  $('#guide-options').innerHTML=(guideResult?.available||[]).map(r=>`<label class="guide-choice-row"><input type="radio" name="guide-choice" value="${r.id}" data-guide-choice="${r.id}" ${guideChoice===r.id?'checked':''}><span><strong>${r.label}</strong><span class="guide-plan-line">${guidePlanLine(r)}</span><span class="muted">${guideCompareKeys().map(k=>`${guideMetrics[k].label}${guideOutcome(k,r.point.delta)}`).join('；')}</span></span></label>`).join('');
  const selected=guideResult?.available.find(r=>r.id===guideChoice);
  $('#guide-choice-summary').textContent=selected?`已选：${selected.label}`:'尚未选择方案。';
}
function renderGuide(){
  $('#guide-amount').value=guideConfig.amount;$('#guide-protect-sleep').checked=guideConfig.protectSleep;$('#guide-protect-work').checked=guideConfig.protectWork;
  $('#guide-amount-value').textContent=guideConfig.amount;
  $('#guide-amount').setAttribute('aria-valuetext',`每周 ${guideConfig.amount} 小时`);
  $('#guide-protect-learn').checked=guideConfig.protectLearn;$('#guide-income-mode').value=guideConfig.incomeMode;
  for(const key of Object.keys(GUIDE_GOALS))$('#guide-goal-'+key).checked=key===guideConfig.goal;
  const s=current,a=s.plan,goal=GUIDE_GOALS[guideConfig.goal];
  $('#guide-income-setting').hidden=guideConfig.goal!=='income';
  $('#guide-income-assumption').textContent=`当前时薪：${number(a.wage,0)} 元/有效小时`;
  $('#guide-action').textContent=goal.action;
  $('#guide-note-label').textContent=goal.question;$('#guide-note').placeholder=goal.placeholder;
  const used=TIME_KEYS.reduce((n,k)=>n+a[k],0);
  $('#guide-start').textContent=`每周已安排 ${number(used,1)} / 168 小时 · ${used<=168?'未分配 '+number(168-used,1)+' 小时':'超出 '+number(used-168,1)+' 小时'}`;
  $('#guide-start').className=used>168?'error':'status';
  $('#guide-assumptions').textContent=`其他时间：运动 ${a.exercise} · 关系 ${a.relation} · 事务 ${a.care} 小时/周。资产 ${number(s.state.assets,0)} 元 · 债务 ${number(s.state.debt,0)} 元。${Object.keys(schedule).length?'另有 '+Object.keys(schedule).length+' 周单独安排。':''}`;
  $('#guide-weeks').value=weeks;
  $('#guide-limit-period').textContent=`${weeks}周`;
  $('#guide-period').textContent=`相对原安排 · 观察 ${weeks} 周${Object.keys(schedule).length?' · 含逐周安排':''}`;
  const target=guideConfig.goal==='learn'?`每周学习从 ${a.learn} 小时变为 ${a.learn+guideConfig.amount} 小时`:
    guideConfig.goal==='income'?`每周工作从 ${a.work} 小时变为 ${a.work+guideConfig.amount} 小时`:'将其他活动的一部分时间换给睡眠或自由休息';
  $('#guide-target').textContent=guideConfig.amount===0?'保持原安排。':`${target}；${weeks} 周累计转入 ${guideConfig.amount*weeks} 小时。`;
  try{
    const inputErrors=[...drafts].filter(([key])=>key!=='marginal').map(([,message])=>message);
    if(inputErrors.length)throw new Error(inputErrors.join('；'));
    if(limitDrafts.size)throw new Error('请先修正底线输入，再比较方案。');
    guideResult=buildDecisionGuide(current,guideConfig,{weeks,schedule,limits:guideLimits});
    if(!guideResult.available.some(r=>r.id===guideChoice))guideChoice=null;
    $('#guide-status').textContent=guideResult.blocker || (guideResult.available.length?
      `${guideResult.available.length} 个可选方案`:
      '暂无满足底线且改善目标的方案，请调整起点或条件。');
    $('#guide-excluded').innerHTML=guideResult.blocker?`<p>${escapeHTML(guideResult.blocker)}</p>`:guideResult.excluded.length?guideResult.excluded.map(r=>`<p><span>${r.label}</span>：${escapeHTML(r.reason)}</p>`).join(''):'<p>当前候选安排均满足设定的底线与资源约束，并改善目标指标。</p>';
  }catch(e){guideResult=null;$('#guide-status').textContent=e.message;$('#guide-comparisons').innerHTML='';$('#guide-excluded').innerHTML='';}
  $('#personal-error').textContent=guideResult?'':$('#guide-status').textContent;
  $('#personal-error').hidden=!!guideResult;
  renderGuideComparison();
  renderGuideChoices();renderGuideTrial();renderGuideSteps();
}
function renderGuideTrial(){
  const row=guideResult?.available.find(r=>r.id===guideChoice);
  $('#guide-save').disabled=!row;
  $('#guide-trial').hidden=!row;$('#guide-trial-placeholder').hidden=!!row;
  if(!row){$('#guide-trial-plan').innerHTML='';return;}
  const p=row.plan,d=row.point.firstDelta,goal=GUIDE_GOALS[guideConfig.goal];
  const first=guideCompareKeys().map(k=>`${guideMetrics[k].label}${guideOutcome(k,d)}`).join('，');
  $('#guide-trial-plan').innerHTML=`<p class="guide-trial-title">为了${goal.label}：这周先试“${row.label}”，调整 ${guideConfig.amount} 小时</p><p>工作 ${p.work} 小时 · 学习 ${p.learn} 小时 · 睡眠 ${p.sleep} 小时 · 自由休息 ${p.leisure} 小时</p><p class="muted">第 1 周模拟变化：${first}。</p>`;
}
const guideContextKey=()=>decisionKey(guideConfig);
const guideNoteKey=()=>noteKey(guideConfig,guideChoice);
function rememberGuideNote(){if(guideChoice){guideNotes.set(guideNoteKey(),$('#guide-note').value);guideSelections.set(guideContextKey(),guideChoice);}}
function restoreGuideDraft(){
  $('#guide-note').value=guideChoice?(guideNotes.get(guideNoteKey())||''):'';
}
function syncLinkedGuide(){
  rememberGuideNote();
  const previous=guideChoice;
  if(!guideChoice)guideChoice=guideSelections.get(guideContextKey())??null;
  renderGuide();restoreGuideDraft();
  if(previous&&!guideChoice){
    invalidateGuideSteps(guideResult?.available.length?4:3);
    $('#guide-message').textContent='原方案已不适用，请重新选择；复盘草稿已保留。';
  }else if(ready&&guideChoice)$('#guide-message').textContent='结果已随当前输入更新。';
  renderGuideSteps();
}
function changeGuide(goal=guideConfig.goal,from=1){
  rememberGuideNote();
  const previousGoal=guideConfig.goal,previousChoice=guideChoice,before=JSON.stringify(guideConfig);
  const previousPlan=guideResult?.available.find(r=>r.id===guideChoice)?.plan,previousNote=$('#guide-note').value;
  guideConfig={goal,amount:Number($('#guide-amount').value),protectSleep:$('#guide-protect-sleep').checked,protectWork:$('#guide-protect-work').checked,
    protectLearn:$('#guide-protect-learn').checked,incomeMode:$('#guide-income-mode').value};
  if(JSON.stringify(guideConfig)===before)return;
  guideChoice=guideSelections.get(guideContextKey())??(goal===previousGoal?previousChoice:null);
  invalidateGuideSteps(from);$('#guide-message').textContent='';renderGuide();
  const selected=guideResult?.available.find(r=>r.id===guideChoice);
  if(selected&&goal===previousGoal&&JSON.stringify(selected.plan)===JSON.stringify(previousPlan)&&!guideNotes.has(guideNoteKey()))guideNotes.set(guideNoteKey(),previousNote);
  restoreGuideDraft();
  if(previousChoice&&!guideChoice)$('#guide-message').textContent='原方案已不适用，请重新比较选择；原记录仍保留在对应方案中。';
  else if(previousNote&&!$('#guide-note').value)$('#guide-message').textContent='安排已更新；原复盘草稿保留在原目标和时数下。';
  persistWorkspace();
}
for(const id of ['guide-amount','guide-income-mode'])$('#'+id).onchange=()=>changeGuide();
$('#guide-amount').oninput=()=>changeGuide();
for(const id of ['guide-protect-sleep','guide-protect-work','guide-protect-learn'])$('#'+id).onchange=()=>changeGuide(guideConfig.goal,2);
for(const goal of Object.keys(GUIDE_GOALS))$('#guide-goal-'+goal).onchange=()=>{if($('#guide-goal-'+goal).checked)changeGuide(goal);};
for(let step=1;step<=GUIDE_STEPS.length;step++)$('#guide-nav-'+step).onclick=()=>goGuideStep(step);
$('#guide-back').onclick=()=>goGuideStep(guideStep-1);
$('#guide-next').onclick=()=>{
  if(guideStep>=GUIDE_STEPS.length||guideStepIssue()){renderGuideSteps();return;}
  guideReached=Math.max(guideReached,guideStep+1);goGuideStep(guideStep+1);
};
$('#guide-note').oninput=()=>{$('#guide-message').textContent='';rememberGuideNote();persistWorkspace();};
document.addEventListener('change',e=>{
  const choice=e.target?.dataset?.guideChoice;
  if(!choice || !e.target.checked || !guideResult?.available.some(r=>r.id===choice))return;
  if(choice===guideChoice)return;
  rememberGuideNote();guideChoice=choice;restoreGuideDraft();$('#guide-message').textContent='';
  invalidateGuideSteps(4);renderGuideTrial();renderGuideSteps();
  $('#guide-choice-summary').textContent=`已选：${guideResult.available.find(r=>r.id===choice).label}`;
  persistWorkspace();
});
$('#guide-cancel').onclick=()=>{rememberGuideNote();guideChoice=null;guideSelections.delete(guideContextKey());$('#guide-note').value='';invalidateGuideSteps(4);renderGuide();renderGuideSteps(true);$('#guide-message').textContent='已取消选择，原安排保留。';persistWorkspace();};
$('#guide-save').onclick=()=>{
  if(!guideResult?.available.some(r=>r.id===guideChoice))return;
  try{const record={format:TRIAL_KEY,scenario:clone(current),schedule:clone(schedule),weeks,config:clone(guideConfig),limits:clone(guideLimits),choiceId:guideChoice,note:$('#guide-note').value,savedAt:new Date().toISOString()};localStorage.setItem(TRIAL_KEY,JSON.stringify(record));persistWorkspace();$('#guide-message').textContent='已保存这次试行计划。';}
  catch(e){$('#guide-message').textContent='浏览器不允许本地存储，本次记录尚未保存。';}
};
$('#guide-load').onclick=()=>{
  try{
    const raw=localStorage.getItem(TRIAL_KEY)??localStorage.getItem('financial-human-weekly-trial-v4')??localStorage.getItem('financial-human-weekly-trial-v3')??localStorage.getItem('financial-human-weekly-trial-v2')??localStorage.getItem('financial-human-weekly-trial-v1');if(!raw)throw new Error('本机还没有保存过试行计划。');
    const r=decodeGuideTrial(JSON.parse(raw));
    rememberGuideNote();current=r.scenario;schedule=r.schedule;weeks=r.weeks;guideConfig=r.config;guideChoice=r.choiceId;guideStep=5;guideReached=5;
    guideLimits=r.limits;limitDrafts.clear();
    guideNotes.set(guideNoteKey(),r.note);guideSelections.set(guideContextKey(),guideChoice);$('#guide-note').value=r.note;
    drafts.clear();fieldDrafts.clear();$('#weeks').value=weeks;renderControls();refreshDrafts();renderResults();renderGuideSteps(true);$('#guide-message').textContent=`已读取${r.legacy?'旧版学习':'上次'}试行计划，输入与参数已恢复。`;
  }catch(e){$('#guide-message').textContent=e.message;}
};
const demoDigits={cash:2,knowledge:3,fatigue:2,income:2};
function demoCard(data,row,option){
  const {id,source,target,label}=option,p=row[id],a=data.scenario.plan;
  if(!p.feasible)return `<article class="demo-option"><h4>${label}</h4><p class="error">第 ${p.failedWeek} 周不可行：${escapeHTML(p.errors.join('；'))}</p></article>`;
  const time=`${timeLabels[source]} ${a[source]} → ${p.plan[source]}；${timeLabels[target]} ${a[target]} → ${p.plan[target]} 小时/周`;
  const outcomes=data.metrics.map(k=>`<div><dt>${guideMetrics[k].label}变化</dt><dd>${signed(p.delta[k],demoDigits[k])}<small>${guideMetrics[k].unit}</small></dd></div>`).join('');
  const detail=table(['指标','第1周差值','12周结果值','平均每转入1小时'],data.metrics.map(k=>[
    `${guideMetrics[k].label}（${guideMetrics[k].unit}）`,signed(p.firstDelta[k],demoDigits[k]),number(p.metrics[k],demoDigits[k]),signed(p.perHour[k],4)
  ]));
  const increment=p.increment?table([`每周 ${row.from} → ${row.amount} 小时`,`${row.additionalHours} 小时新增投入的单位变化`],
    data.metrics.map(k=>[guideMetrics[k].label,`${signed(p.increment[k],4)} ${guideMetrics[k].unit}/小时`])):'';
  return `<article class="demo-option" data-demo-source="${source}" data-demo-target="${target}" data-demo-option="${id}" data-demo-amount="${row.amount}"><h4>${label}</h4><p class="demo-time-label">${time}</p><dl class="demo-metrics" data-count="${data.metrics.length}">${outcomes}</dl><details><summary>第一周、最后和每小时的结果</summary><div class="table-wrap">${detail}</div><div class="table-wrap">${increment}</div></details></article>`;
}
function renderDemo(choice=demoAmounts[demoGoal]){
  if(!['1','2','4','all'].includes(choice))return;
  demoAmounts[demoGoal]=choice;
  for(const key of Object.keys(DEMO_GOALS))$('#demo-goal-'+key).checked=key===demoGoal;
  for(const key of ['1','2','4','all'])$('#demo-'+key).checked=key===choice;
  try{
    if(!demoCache.has(demoGoal))demoCache.set(demoGoal,buildDecisionDemo(demoGoal));
    const data=demoCache.get(demoGoal),rows=choice==='all'?data.rows:data.rows.filter(r=>r.amount===Number(choice));
    const b=data.baseline;
    $('#demo-action').textContent=data.action;
    const a=data.scenario.plan;
    $('#demo-start').textContent=`每周：工作 ${a.work} · 学习 ${a.learn} · 睡眠 ${a.sleep} · 休闲 ${a.leisure} · 其他 ${a.exercise+a.relation+a.care} 小时`;
    $('#demo-pay').textContent=`计酬：${number(data.scenario.plan.wage,0)} 元/有效小时`;
    $('#demo-baseline').textContent=`原安排 · 12 周${demoGoal==='income'?`累计收入 ${number(b.income,2)} 元 · `:'末：'}现金 ${number(b.cash,2)} 元 · 知识 ${number(b.knowledge,3)} 分 · 疲劳 ${number(b.fatigue,2)} 分`;
    $('#demo-status').textContent=choice==='all'?'每周 1 / 2 / 4 小时 · 共 6 种安排':`相对原安排 · 12 周累计转入 ${Number(choice)*12} 小时`;
    $('#demo-results').innerHTML=rows.map(row=>`<div class="demo-group"><h3>${data.action} ${row.amount} 小时 · 持续 12 周</h3><div class="demo-pair">${data.options.map(option=>demoCard(data,row,option)).join('')}</div><details><summary>两种方案的差值</summary><p>${data.options[1].label} − ${data.options[0].label}</p>${row.difference?`<div class="table-wrap">${table(['指标','差值'],data.metrics.map(k=>[guideMetrics[k].label,`${signed(row.difference[k],demoDigits[k])} ${guideMetrics[k].unit}`]))}</div>`:'<p>至少一组不可行，暂无差值。</p>'}</details></div>`).join('');
  }catch(e){$('#demo-status').textContent=e.message;$('#demo-results').innerHTML='';}
  persistWorkspace();
}
for(const choice of ['1','2','4','all'])$('#demo-'+choice).onchange=()=>{if($('#demo-'+choice).checked)renderDemo(choice);};
for(const key of Object.keys(DEMO_GOALS))$('#demo-goal-'+key).onchange=()=>{if($('#demo-goal-'+key).checked){demoGoal=key;renderDemo();}};

function drawChart(){
  const key=$('#chart-metric').value;
  const values=run=>{const initial=key==='wealth'?run===comparison.current?current.state.cash+current.state.assets-current.state.debt:baseline.state.cash+baseline.state.assets-baseline.state.debt:key==='net'?null:(run===comparison.current?current.state[key]:baseline.state[key]);return [initial,...run.frames.map(f=>!f.feasible?null:key==='net'?f.net:key==='wealth'?f.states.netWorth:f.next[key])];};
  const a=values(comparison.current),b=values(comparison.baseline),all=[...a,...b].filter(Number.isFinite);
  if(!all.length){$('#trajectory').textContent='暂无可行结果';return;}
  const lo=Math.min(...all),hi=Math.max(...all),pad=Math.max((hi-lo)*.12,1),min=lo-pad,max=hi+pad;
  const width=Math.max(280,$('#trajectory').clientWidth||810),right=width-20;
  const y=v=>205-(v-min)/(max-min)*175;
  const path=xs=>xs.map((v,i)=>v===null?'':`${i===0||xs[i-1]===null?'M':'L'}${70+i/weeks*(right-70)},${y(v)}`).join(' ');
  const grid=Array.from({length:5},(_,i)=>{const v=min+(max-min)*i/4;return `<line x1="70" x2="${right}" y1="${y(v)}" y2="${y(v)}" class="chart-grid"/><text x="60" y="${y(v)+4}" text-anchor="end">${number(v,0)}</text>`;}).join('');
  $('#trajectory').innerHTML=`<svg viewBox="0 0 ${width} 240" role="img" aria-label="${escapeHTML($('#chart-metric').selectedOptions[0].text)}方案对照"><title>${escapeHTML($('#chart-metric').selectedOptions[0].text)}</title>${grid}<path d="${path(b)}" fill="none" class="chart-baseline" stroke-width="2" stroke-dasharray="6 4"/><path d="${path(a)}" fill="none" class="chart-current" stroke-width="2.5"/><text x="70" y="230">起点</text><text x="${right}" y="230" text-anchor="end">第 ${weeks} 周</text></svg>`;
}
function renderSleepDemo(){
  for(const key of Object.keys(SLEEP_CASES))$('#sleep-case-'+key).checked=key===sleepDemoCase;
  $('#sleep-demo-source').value=sleepDemoSource;
  const r=sleepDemo(sleepDemoCase,sleepDemoSource),c=SLEEP_CASES[sleepDemoCase];
  $('#sleep-demo-context').textContent=`每周睡眠 56 → 68 小时 · ${sleepDemoSource==='unallocated'?'空余时间':'自由休息'}减少12小时 · 共52周 / 624小时；需求${c.need}小时/天，期初估计欠的睡眠${c.debt}小时。`;
  const data=[['最后一周有多累','finalFatigue','分'],['这段时间平均有多累','averageFatigue','分'],['累计疲劳负担','fatigueBurden','分·周']].map(([label,key,unit])=>[
    label,...r.variants.map(v=>`<div class="compare-value ${v.delta[key]<0?'compare-gain':'compare-cost'}"><strong>${relative(v.delta[key],unit,2)}</strong>${percentMarkup(v.changed[key],v.original[key])}</div><small>原安排 ${number(v.original[key],2)} → 调整后 ${number(v.changed[key],2)} ${unit}</small>`)
  ]);
  data.push(['最后还差多少睡眠',...r.variants.map(v=>v.key==='legacy'?'未建模':`<strong>${number(v.changed.sleepDebt,1)} 小时</strong><small>原安排 ${number(v.original.sleepDebt,1)} 小时</small>`)]);
  $('#sleep-demo-results').innerHTML=compareTable(['同一版本内，相对不调整','旧模型 1.0','现模型（1.1起）'],data);
  $('#sleep-demo-other').innerHTML=compareTable(['相对各自原安排','旧模型 1.0','现模型（1.1起）'],[['最后剩多少钱变化','cash','元'],['累计学习效果（折算）变化','effectiveLearn','小时']].map(([label,key,unit])=>[label,...r.variants.map(v=>`${relative(v.delta[key],unit,2)}${percentMarkup(v.changed[key],v.original[key])}`)]));
  const series=r.variants.map(v=>v.changed.series.map((p,i)=>p.fatigue-v.original.series[i].fatigue));
  const values=series.flat(),min=Math.min(0,...values)-1,max=Math.max(0,...values)+1;
  const width=Math.max(280,$('#sleep-demo-chart').clientWidth||640),right=width-16;
  const x=t=>58+t/52*(right-58),y=v=>206-(v-min)/(max-min)*176;
  const grid=Array.from({length:4},(_,i)=>{const value=min+(max-min)*i/3;return `<line x1="58" x2="${right}" y1="${y(value)}" y2="${y(value)}" class="chart-grid"/><text x="50" y="${y(value)+4}" text-anchor="end">${number(value,1)}</text>`;}).join('');
  $('#sleep-demo-chart').innerHTML=`<svg viewBox="0 0 ${width} 240" role="img" aria-label="多睡12小时，旧模型与新模型相对各自原安排的疲劳变化"><title>疲劳差值，负值表示减轻</title>${grid}${series.map((points,i)=>`<path data-sleep-model="${i?'revised':'legacy'}" class="${i?'trend-a':'trend-original'}" d="${points.map((value,t)=>`${t?'L':'M'}${x(t)},${y(value)}`).join(' ')}"/>`).join('')}<text x="58" y="230">起点</text><text x="${x(26)}" y="230" text-anchor="middle">第26周</text><text x="${right}" y="230" text-anchor="end">第52周</text></svg>`;
  $('#sleep-demo-weekly').innerHTML=table(['周','旧版疲劳差值','新版疲劳差值','新版原安排估计欠的睡眠（小时）','新版调整后估计欠的睡眠（小时）'],r.variants[1].original.series.map((p,i)=>[i,number(series[0][i],2),number(series[1][i],2),number(p.sleepDebt,2),number(r.variants[1].changed.series[i].sleepDebt,2)]));
}
for(const key of Object.keys(SLEEP_CASES))$('#sleep-case-'+key).onchange=()=>{if($('#sleep-case-'+key).checked){sleepDemoCase=key;renderSleepDemo();persistWorkspace();}};
$('#sleep-demo-source').onchange=()=>{sleepDemoSource=$('#sleep-demo-source').value;renderSleepDemo();persistWorkspace();};

function renderTrace(f){
  const m=f.mechanisms,p=current.parameters;
  let html=`<div class="trace-grid"><div><h3>资源与有效行动 · 第一周</h3><div class="equation">时间 ${number(m.time)} / 168 小时\n有效工作 = 工作小时 × 身体、认知、疲劳与判断效率\n= ${number(m.effectiveWork)} 小时\n有效学习 = 学习小时 × 身体、动机、偏差与压力效率\n= ${number(m.effectiveLearn)} 小时\n情绪负荷 ${number(m.load)} − 调节容量 ${number(m.capacity)}\n超额 = max(0, 负荷 − 容量) = ${number(m.strain)}</div></div><div><h3>情绪的六条通道 · 各自记账</h3>${table(['通道','本周值','进入哪里'],[
    ['判断损失',number(m.channels.judgmentLoss)+'%','有效工作效率'],['额外消费',number(m.channels.consumptionLeak)+' 元','实际现金支出，仅记一次'],['风险扭曲',number(m.channels.riskMultiplier,2)+' 倍','持仓的周波动'],['关系损害',number(m.channels.relationshipDamage)+' 分','下一周信任'],['健康消耗',number(m.channels.healthWear)+' 分','下一周疲劳'],['主体感损失',number(m.channels.agencyLoss)+' 分','当期自主效用']
  ])}</div></div>`;
  html+=`<details><summary>睡眠债与恢复 · 第一周</summary>${table(['核算项','数值'],[['个人周需求',number(m.sleep.need)+' 小时'],['本周短缺 / 超需',`${number(m.sleep.deficit)} / ${number(m.sleep.surplus)} 小时`],['期初睡眠债',number(m.sleep.debtBefore)+' 小时'],['本周偿还',number(m.sleep.repaid)+' 小时'],['期末睡眠债',number(m.sleep.debtAfter)+' 小时'],['睡眠债账本残差',number(m.sleep.balanceResidual,8)+' 小时'],['本周有效疲劳恢复率',number(m.sleep.recovery*100)+'%'],['睡眠债疲劳增量',number(m.sleep.debtFatigue)+' 分']])}</details>`;
  if(f.feasible){const l=f.ledger;html+=`<details open><summary>资金恒等式</summary><div class="equation">现金期末 = 期初现金 + 收入 − 支出 − 利息 − 偿还本金 − 买入 + 卖出\n${number(l.cashAfter)} = ${number(l.cashBefore)} + ${number(l.income)} − ${number(l.spending)} − ${number(l.interest)} − ${number(l.principal)} − ${number(l.buy)} + ${number(l.sell)}\n资产期末 = (期初资产 + 买入 − 卖出) + 当周投资盈亏\n${number(l.assetsAfter)} = (${number(l.assetsBefore)} + ${number(l.buy)} − ${number(l.sell)}) + ${number(l.profit)}\n净财富变动 = 收入 − 支出 − 利息 + 投资盈亏\n账本恒等式残差：${number(l.identityResidual,8)} 元</div></details>`;
    html+=`<details><summary>评价函数与不重复扣算</summary>${table(['效用项','原始分值','个人权重'],Object.entries(f.utility).map(([k,v])=>[UTILITY_LABELS[k],number(v),current.weights[k]]))}${table(['体验成本','效用分'],Object.entries(f.costs).map(([k,v])=>[{emotion:'即时情绪不适',health:'高疲劳不适',desire:'品质与价值失配',risk:'风险不适'}[k],number(v)]))}<div class="equation">Net = 加权效用 − 四类体验成本 = ${number(f.net)}\nJ = Σ beta^(周数−1) × Net，beta = ${p.beta}\n市场亏损、消费支出与利息只进入资金账本，不再作为同一笔金钱损失从 Net 扣除。\n身体状态与当期不适是不同核算对象；这些效用权重仍需个人确认。</div></details>`;
  }
  $('#trace').innerHTML=html;
}
function download(name,value){const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function snapshot(){return {format:'financial-human-experiment-v1.2',version:VERSION,current,baseline,schedule,baselineSchedule,weeks,question:$('#question').value,
  marginalConfig:{...marginalConfig,week:marginalConfig.frequency==='once'?Math.min(weeks,marginalConfig.week):marginalConfig.week}};}
function workspaceSnapshot(){
  rememberGuideNote();
  return {format:WORKSPACE_FORMAT,experiment:snapshot(),sleepDiary,decision:{config:guideConfig,choiceId:guideChoice,step:guideStep,reached:guideReached,
    notes:[...guideNotes],selections:[...guideSelections],limits:guideLimits,limitDrafts:[...limitDrafts],view:guideView},demo:{goal:demoGoal,amounts:{...demoAmounts},sleepDemo:sleepDemoCase,sleepSource:sleepDemoSource},fieldDrafts:[...fieldDrafts],
    scheduleText:$('#schedule').value,scheduleError:drafts.get('schedule')||'',marginalDraft:Object.fromEntries(Object.keys(DEFAULT_MARGINAL).map(k=>[k,$('#marginal-'+k).value]))};
}
function persistWorkspace(force=false){
  if(!ready||restoring)return;
  if(storageBlocked&&!force)return;
  try{
    const value=workspaceSnapshot();decodeWorkspace(value);
    localStorage.setItem(WORKSPACE_KEY,JSON.stringify(value));storageBlocked=false;
    $('#workspace-status').textContent='已自动保存到本机';
  }catch(e){$('#workspace-status').textContent='未保存到本机，请导出数据保留。';}
}
function acceptSnapshot(s){
  const full=[WORKSPACE_FORMAT,'financial-human-workspace-v1.1','financial-human-workspace-v1'].includes(s?.format)?decodeWorkspace(s):null,e=full?.experiment??decodeExperiment(s);
  simulate(e.current,e.weeks,{schedule:e.schedule});simulate(e.baseline,e.weeks,{schedule:e.baselineSchedule});
  rememberGuideNote();restoring=true;
  try{
    current=e.current;baseline=e.baseline;schedule=e.schedule;baselineSchedule=e.baselineSchedule;weeks=e.weeks;marginalConfig=e.marginalConfig;
    if(full){
      sleepDiary=full.sleepDiary;
      const d=full.decision;guideConfig=d.config;guideChoice=d.choiceId;guideStep=d.step;guideReached=d.reached;
      guideLimits=d.limits;guideView=d.view;limitDrafts.clear();for(const entry of d.limitDrafts)limitDrafts.set(...entry);
      guideNotes.clear();guideSelections.clear();for(const entry of d.notes)guideNotes.set(...entry);for(const entry of d.selections)guideSelections.set(...entry);
      demoGoal=full.demo.goal;sleepDemoCase=full.demo.sleepDemo;sleepDemoSource=full.demo.sleepSource;Object.assign(demoAmounts,full.demo.amounts);restoreGuideDraft();
    }
    $('#weeks').value=weeks;$('#question').value=e.question;drafts.clear();fieldDrafts.clear();renderControls();
    for(const [key,raw] of full?.fieldDrafts??[]){
      const [group,fieldKey]=key.split('.'),candidate=clone(current);candidate[group][fieldKey]=raw.trim()===''?NaN:Number(raw);
      const errors=validateScenario(candidate);
      if(errors.length){fieldDrafts.set(key,raw);drafts.set(key,errors.join('；'));mirrorField(group,fieldKey,raw,true);}
    }
    if(full){
      $('#schedule').value=full.scheduleText;
      if(full.scheduleError)drafts.set('schedule',full.scheduleError);
      for(const key of Object.keys(DEFAULT_MARGINAL))$('#marginal-'+key).value=full.marginalDraft[key];
      updateMarginal();
    }
    refreshDrafts();renderResults();renderDemo();renderSleepDemo();renderGuideSteps();
  }finally{restoring=false;}
  storageBlocked=false;persistWorkspace();
}
function resetDrafts(){drafts.clear();fieldDrafts.clear();refreshDrafts();renderControls();renderResults();}

function updateMarginal(){
  const candidate=Object.fromEntries(Object.keys(DEFAULT_MARGINAL).map(k=>[k,['step','week'].includes(k)?Number($('#marginal-'+k).value):$('#marginal-'+k).value]));
  const errors=validateMarginal(candidate,weeks);
  for(const k of ['step','week'])$('#marginal-'+k).setAttribute('aria-invalid',String(errors.length>0));
  if(errors.length){drafts.set('marginal',errors.join('；'));refreshDrafts();persistWorkspace();return;}
  marginalConfig=candidate;drafts.delete('marginal');refreshDrafts();renderMarginal();persistWorkspace();
}
for(const k of ['target','source','frequency'])$('#marginal-'+k).onchange=updateMarginal;
for(const k of ['step','week'])$('#marginal-'+k).oninput=updateMarginal;
$('#marginal-metric').onchange=renderMarginalCurve;

document.addEventListener('input',e=>{
  const el=e.target,{group,key}=el.dataset;
  if(el.id==='schedule'){persistWorkspace();return;}
  if(!group||!key)return;
  const value=el.value.trim()===''?NaN:Number(el.value),candidate=clone(current);candidate[group][key]=value;
  const errors=validateScenario(candidate);
  if(errors.length){drafts.set(`${group}.${key}`,errors.join('；'));fieldDrafts.set(`${group}.${key}`,el.value);mirrorField(group,key,el.value,true);el.setAttribute('aria-invalid','true');refreshDrafts();syncLinkedGuide();persistWorkspace();return;}
  current=candidate;drafts.delete(`${group}.${key}`);fieldDrafts.delete(`${group}.${key}`);mirrorField(group,key,el.value);el.setAttribute('aria-invalid','false');refreshDrafts();renderResults();
});
$('#schedule-apply').onclick=()=>{try{const value=JSON.parse($('#schedule').value);const errors=validateSchedule(value);if(errors.length)throw new Error(errors.join('；'));simulate(current,weeks,{schedule:value});schedule=value;drafts.delete('schedule');refreshDrafts();$('#schedule-note').textContent=`${Object.keys(schedule).length} 周有单独安排`;renderResults();announce('逐周安排已更新。');}catch(e){drafts.set('schedule',e.message);refreshDrafts();syncLinkedGuide();persistWorkspace();}};
$('#pin').onclick=()=>{baseline=clone(current);baselineSchedule=clone(schedule);renderResults();announce('已固定当前输入、参数与逐周安排作为基准。');};
$('#restore').onclick=()=>{current=clone(baseline);schedule=clone(baselineSchedule);resetDrafts();announce('已恢复保存的对照安排。');};
$('#reset').onclick=()=>{current=clone(DEFAULT_SCENARIO);schedule={};resetDrafts();announce('实验组恢复默认，基准未变。');};
$('#weeks').onchange=()=>{weeks=Number($('#weeks').value);updateMarginal();renderResults();};
$('#guide-weeks').onchange=()=>{$('#weeks').value=$('#guide-weeks').value;$('#weeks').onchange();};
$('#question').onchange=renderResults;$('#chart-metric').onchange=drawChart;
document.querySelectorAll('[data-preset]').forEach(b=>b.onclick=()=>{
  current=clone(baseline);schedule=clone(baselineSchedule);
  if(b.dataset.preset==='recover'){const moved=Math.min(8,current.plan.work);current.plan.work-=moved;current.plan.sleep+=moved/2;current.plan.leisure+=moved/2;$('#question').value='week';}
  if(b.dataset.preset==='spend'){current.plan.discretionary+=300;$('#question').value='spend';}
  if(b.dataset.preset==='invest'){current.plan.sell=0;current.plan.buy+=1000;$('#question').value='invest';}
  const errors=validateScenario(current);if(errors.length){current=clone(baseline);setError(errors.join('；'));return;}
  resetDrafts();announce('以保存的对照安排生成对照方案；基准本身未改变。');
});
$('#analyze').onclick=()=>{
  try{
    const a=ensemble(current,weeks,schedule),b=ensemble(baseline,weeks,baselineSchedule);
    const pairs=a.runs.map((r,i)=>[r,b.runs[i]]).filter(([x,y])=>x.feasible&&y.feasible);
    const pairedCounts=!comparison.samePreferences||!comparison.sameStart||!comparison.sameMechanism?['口径不同','口径不同']:
      !pairs.length?['没有两种安排都能完成的情况','没有两种安排都能完成的情况']:[0,1].map(i=>`${pairs.filter(pair=>pair[i].total>pair[1-i].total+1e-8).length} / ${pairs.length}`);
    $('#uncertainty').innerHTML=table(['同样80种可能情况','当前安排','保存的对照安排'],[
      ['时间或钱不够的情况占比',number(a.failureRate*100)+'%',number(b.failureRate*100)+'%'],
      ['能完成的情况下，综合得分平均值',number(a.mean),number(b.mean)],['综合得分的中间80%范围',`${number(a.p10)} 至 ${number(a.p90)}`,`${number(b.p10)} 至 ${number(b.p90)}`],
      ['能完成时，扣掉欠款后的资产范围（元）',`${number(a.wealth10)} 至 ${number(a.wealth90)}`,`${number(b.wealth10)} 至 ${number(b.wealth90)}`],
      ['两种安排都能完成时，综合得分更高的次数',...pairedCounts]
    ]);
    const rows=sensitivity(current,weeks,schedule);
    $('#sensitivity').innerHTML=`<h3>换一个设定，结果会差多少</h3>`+table(['参数','较低值 / 较高值','综合得分变化'],rows.map(r=>[PARAM_FIELDS.find(f=>f.key===r.key).label,r.values.map(v=>number(v,3)).join(' / '),r.deltas.map(delta).join(' / ')]));
  }catch(e){setError(e.message);}
};
$('#template').onclick=()=>download('financial-human-observations-template.json',calibrationTemplate(current));
$('#observations').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>5000000)throw new Error('文件超过 5 MB');fit=calibrate(JSON.parse(await file.text()));$('#calibration-result').innerHTML=table(['拟合结果','数值'],[
  ['前段试算 / 后段核对',`${fit.trainCount} / ${fit.testCount}`],['疲劳恢复率',fit.parameters.fatigueRecovery],['学习增益系数',fit.parameters.learningGain],['后段预测误差：原设置 → 新设置',`${number(fit.holdoutBefore,3)} → ${number(fit.holdoutAfter,3)}`],['判读',fit.improved?'后段预测更贴近记录':'后段预测没有变准，保留原设置']]);$('#adopt-fit').hidden=!fit.improved;}catch(error){fit=null;$('#adopt-fit').hidden=true;$('#calibration-result').textContent=error.message;}};
$('#adopt-fit').onclick=()=>{if(!fit?.improved)return;current.parameters={...current.parameters,...fit.parameters};resetDrafts();announce('已采用两个试拟合参数；保存的对照安排未变。');};
$('#export').onclick=()=>download('financial-human-1.2.json',{...workspaceSnapshot(),results:drafts.size?null:comparison,marginalResults:marginalResult,exportedAt:new Date().toISOString()});
$('#import').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>5000000)throw new Error('文件超过 5 MB');const value=JSON.parse(await file.text()),old=(value.experiment?.current??value.current)?.version!==VERSION;acceptSnapshot(value);announce(old?'旧数据已导入。原来的输入保留，缺少的设置使用默认值；请核对后继续。':'数据和对照安排已导入。');}catch(error){setError(error.message);}};
$('#save').onclick=()=>{persistWorkspace(true);announce($('#workspace-status').textContent);};
$('#load').onclick=()=>{try{const value=localStorage.getItem(WORKSPACE_KEY)??localStorage.getItem('financial-human-v0.3');if(!value)throw new Error('没有本机保存的数据');acceptSnapshot(JSON.parse(value));announce('已读取本机数据。');}catch(e){setError(e.message);}};
$('#dictionary').innerHTML=table(['层级','代码变量','名称与单位','定义 / 测量边界'],[
  ...STATE_GROUPS.flatMap(g=>g.fields.map(f=>[g.name,`state.${f.key}`,`${f.label} · ${f.unit}`,f.meaning])),
  ...PLAN_GROUPS.flatMap(g=>g.fields.map(f=>[g.name,`plan.${f.key}`,`${f.label} · ${f.unit}`,f.meaning])),
  ...PARAM_FIELDS.map(f=>['参数',`parameters.${f.key}`,`${f.label} · ${f.unit}`,f.meaning]),
  ...Object.entries(UTILITY_LABELS).map(([k,v])=>['个人偏好',`weights.${k}`,`${v} · 相对权重`,'个人价值取舍，不从生理数据直接拟合'])
]);
$('#system-equations').innerHTML=STATE_GROUPS.map(g=>`<h3>${g.name}</h3><p class="equation">${stateFormulas[g.id]}</p><p class="muted">${paths[g.id]}</p>`).join('');
const demoScenario=createLearningDemoScenario();
$('#demo-model-definitions').innerHTML=table(['初始资源与安排','数值'],[
  ['现金 / 资产 / 债务（元）',[demoScenario.state.cash,demoScenario.state.assets,demoScenario.state.debt].join(' / ')],
  ['疲劳 / 知识（分）',[demoScenario.state.fatigue,demoScenario.state.knowledge].join(' / ')],
  ...TIME_KEYS.map(k=>[`${timeLabels[k]}（小时/周）`,demoScenario.plan[k]]),
  ['必要 / 品质 / 学习支出（元/周）',[demoScenario.plan.essential,demoScenario.plan.discretionary,demoScenario.plan.learningSpend].join(' / ')],
  ['时薪（元/有效小时）',demoScenario.plan.wage]
])+table(['目标','预设方案','时间来源 → 目的地'],Object.values(DEMO_GOALS).flatMap(g=>g.options.map(o=>[g.label,o.label,`${timeLabels[o.source]} → ${timeLabels[o.target]}`])));
$('#version-notes').innerHTML=table(['事项','0.2','0.3'],[
  ['状态输入','六系统概括评分','22 个细项；原始资源与综合指数分开'],['资源','0–100 行动强度、预算压力分','每周 168 小时；现金、持仓、负债核算'],['投资','独立投资与风险滑杆','买卖改变持仓；持仓与波动产生收益分布'],['情绪','负荷聚合成本','统一超额阈值；六条行为通道分别入账'],['动态','固定行动和统一冲击','逐周覆盖、累的程度、边际递减、分类冲击'],['评价','初末时点净值','贴现累计效用；真实资源结果保留'],['验证','程序测试','资源恒等式、反例回归、随机情景、敏感性、真实记录试拟合入口']
]);
globalThis.addEventListener?.('resize',()=>{if(comparison)drawChart();if(guideStep===3)drawGuideTrend();if(resolvePage(location.hash)==='demo')renderSleepDemo();});
globalThis.addEventListener?.('hashchange',()=>renderPage(true));
renderControls();renderResults();renderDemo();renderSleepDemo();renderPage();
try{
  const saved=localStorage.getItem(WORKSPACE_KEY);
  if(saved)acceptSnapshot(JSON.parse(saved));
}catch(e){storageBlocked=true;$('#workspace-status').textContent='本机存档异常，原存档未覆盖。';setError(e.message);}
ready=true;if(!storageBlocked)persistWorkspace();
