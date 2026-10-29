import { clone } from './schema.js';
import { DIARY_KEYS, WEEK_KEYS, newDiary, dayNumber, saveDiaryRecord, summarizeDiary, confirmDiaryWeek, diarySuggestion } from './sleep-diary.js';

export function mountSleepDiary({getCurrent,getDiary,setDiary,apply,blocked}){
  const $=id=>document.querySelector('#'+id),esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),num=(v,d=1)=>Number(v).toLocaleString('zh-CN',{maximumFractionDigits:d});
  const today=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
  const names={work:'工作',learn:'学习',care:'通勤、家务、照护',exercise:'运动',relation:'陪伴与社交',leisure:'自由休息'};
  let undo=null;
  const commit=next=>setDiary(next);
  function keepDraft(d){
    try{dayNumber(d.draft.date);}catch{return;}
    d.dailyDrafts=(d.dailyDrafts||[]).filter(r=>r.date!==d.draft.date);
    d.dailyDrafts.push(clone(d.draft));d.dailyDrafts=d.dailyDrafts.slice(-400);
  }
  function keepWeekDraft(d){
    if(!d.weekDraft.end)return;
    d.weekDrafts=(d.weekDrafts||[]).filter(w=>w.end!==d.weekDraft.end);
    d.weekDrafts.push(clone(d.weekDraft));d.weekDrafts=d.weekDrafts.slice(-60);
  }
  const message=(text,error=false)=>{$('diary-message').textContent=text;$('diary-message').className=error?'error':'status';};
  const act=fn=>{try{fn();}catch(e){message(e.message,true);}};
  function render(){
    const d=getDiary(),s=summarizeDiary(d,getCurrent(),today());
    $('sleep-helper').open=d.open;
    for(let i=1;i<=3;i++){$('diary-stage-'+i).hidden=d.step!==i;$('diary-nav-'+i).setAttribute('aria-current',d.step===i?'step':'false');}
    $('diary-progress').textContent=['先有一个参考','记下实际情况','看记录，再改设置'][d.step-1];
    $('diary-reference').textContent=`目前按每天 ${num(getCurrent().parameters.sleepNeed)} 小时比较方案。还不清楚时，可以先保留这个参考。`;
    for(const k of DIARY_KEYS)$('diary-'+k).value=d.draft[k]||(k==='date'?today():'');
    $('diary-date').max=today();
    $('diary-save').textContent=d.records.some(r=>r.date===($('diary-date').value))?'更新这一天':'保存这一天';
    $('diary-count').textContent=`已记录 ${d.records.length} 天`;
    $('diary-history').innerHTML=d.records.length?`<table><thead><tr><th>日期</th><th>睡眠</th><th>累的程度</th><th>操作</th></tr></thead><tbody>${[...d.records].reverse().map(r=>`<tr><td>${esc(r.date)}</td><td>${num(r.hours)} 小时</td><td>${num(r.fatigue)}/10</td><td><button type="button" data-diary-edit="${r.date}">修改</button> <button type="button" data-diary-delete="${r.date}">删除</button></td></tr>`).join('')}</tbody></table>`:'<p>还没有记录。</p>';
    $('diary-undo').hidden=!undo;
    $('diary-need-status').textContent=s.need?`精神较好、自由睡醒的 ${s.need.count} 天，睡眠中间值约 ${num(s.need.value)} 小时（范围 ${num(s.need.min)}–${num(s.need.max)} 小时）。`:`近28天已记录 ${s.recentCount}/14 天；其中精神较好、自由睡醒 ${s.restedCount}/5 天。记录不够，先不改参考时长。`;
    $('diary-adopt-need').disabled=!s.need||blocked();
    $('diary-adopt-need').textContent=s.need?`将每天参考改为 ${num(s.need.value)} 小时`:'暂时保留当前参考';
    $('diary-zero').checked=d.assumeZero;
    const w=s.latest;
    $('diary-actual-status').textContent=w?`最近完整一周 ${w.start} 至 ${w.end}：睡了 ${num(w.hours)} 小时，结束时累的程度 ${num(w.fatigueAfter/10)}/10。${s.currentWeekFresh?'':'这份记录已有一段时间，先不用于当前起点。'}`:'从一个周日连续记录到下个周日后，可以核对一周的变化。漏记的天不当作0。';
    $('diary-debt-status').textContent=w?`按每天 ${num(getCurrent().parameters.sleepNeed)} 小时参考、每段完整记录之前按0计，推算到 ${w.end} 还差 ${num(w.debt)} 小时。这是记录范围内的估算。`:'之前累计少睡多少还不清楚，不需要猜一个数字。';
    $('diary-adopt-actual').disabled=!w||!w.confirmed||!s.currentWeekFresh||!d.assumeZero||blocked();
    $('diary-fit-status').textContent=d.assumeZero?s.fit.reason:'恢复快慢暂不改；需要确认记账起点和至少6周实际安排。';
    $('diary-adopt-recovery').disabled=!s.fit.available||blocked();
    $('diary-fit-detail').textContent=s.fit.available?`前${s.fit.trainCount}周试算，后${s.fit.holdoutCount}周核对。后段疲劳预测误差 ${num(s.fit.beforeRMSE/10,2)} → ${num(s.fit.afterRMSE/10,2)}（0–10刻度）；模型恢复比例 ${num(getCurrent().parameters.fatigueRecovery,2)} → ${num(s.fit.value,2)}。其余影响按每周保存的设置计算。`:'只调整恢复比例，不同时猜测所有身体参数。';
    $('diary-adopted').textContent=d.lastApplied||'';
    $('diary-week-select').innerHTML='<option value="">选择一周</option>'+s.weeks.map(w=>`<option value="${w.end}">${w.start} 至 ${w.end}${w.confirmed?' · 已核对':' · 待核对'}${w.special?' · 有特殊情况，不用于恢复试算':''}</option>`).join('');
    $('diary-week-select').value=d.weekDraft.end;
    $('diary-week-fields').innerHTML=WEEK_KEYS.map(k=>`<label for="diary-week-${k}">${names[k]}（小时/周）<input id="diary-week-${k}" type="number" min="0" max="168" step="any" value="${esc(d.weekDraft[k])}" data-diary-week="${k}"></label>`).join('');
    $('diary-confirm-week').disabled=!s.weeks.some(w=>w.end===d.weekDraft.end);
  }
  function move(step){const next=clone(getDiary());next.step=step;next.open=true;commit(next);render();message('');}
  $('sleep-helper').ontoggle=()=>{const d=getDiary();if(d.open!==$('sleep-helper').open)commit({...clone(d),open:$('sleep-helper').open});};
  for(let i=1;i<=3;i++)$('diary-nav-'+i).onclick=()=>move(i);
  $('diary-start').onclick=()=>move(2);$('diary-to-summary').onclick=()=>move(3);$('diary-back-record').onclick=()=>move(2);
  for(const k of DIARY_KEYS)if(k!=='date')$('diary-'+k).oninput=()=>{const d=clone(getDiary());d.draft.date=$('diary-date').value;d.draft[k]=$('diary-'+k).value;keepDraft(d);commit(d);message('');};
  $('diary-date').onchange=()=>{
    const d=clone(getDiary()),date=$('diary-date').value;keepDraft(d);
    const row=d.dailyDrafts.find(r=>r.date===date)||d.records.find(r=>r.date===date);
    d.draft=row?Object.fromEntries(DIARY_KEYS.map(k=>[k,String(row[k])])):{...newDiary().draft,date};
    commit(d);render();message(row?'已载入这一天的记录，可以修改。':'');
  };
  $('diary-save').onclick=()=>act(()=>{const raw=Object.fromEntries(DIARY_KEYS.map(k=>[k,$('diary-'+k).value]));let d=saveDiaryRecord(getDiary(),raw,today());d.draft=raw;commit(d);render();message('已保存；方案和参数没有自动改变。');});
  $('diary-zero').onchange=()=>{const d=clone(getDiary());d.assumeZero=$('diary-zero').checked;commit(d);render();};
  $('diary-week-select').onchange=()=>{
    const d=clone(getDiary()),end=$('diary-week-select').value,saved=d.weeks.find(w=>w.end===end),plan=saved?.scenario.plan??getCurrent().plan;
    keepWeekDraft(d);const draft=d.weekDrafts.find(w=>w.end===end);
    d.weekDraft=draft?clone(draft):{end,...Object.fromEntries(WEEK_KEYS.map(k=>[k,String(plan[k])]))};commit(d);render();
    message(draft?'已恢复这一周未填完的内容。':'已带入原安排作参考，请改成这一周实际花的时间。');
  };
  document.addEventListener('input',e=>{const key=e.target?.dataset?.diaryWeek;if(!WEEK_KEYS.includes(key))return;const d=clone(getDiary());d.weekDraft[key]=e.target.value;keepWeekDraft(d);commit(d);});
  $('diary-confirm-week').onclick=()=>act(()=>{const d=getDiary(),values=Object.fromEntries(WEEK_KEYS.map(k=>[k,$('diary-week-'+k).value]));commit(confirmDiaryWeek(d,d.weekDraft.end,values,getCurrent()));render();message('这一周的实际安排已保存。');});
  document.addEventListener('click',e=>{
    const date=e.target?.dataset?.diaryEdit,remove=e.target?.dataset?.diaryDelete;if(!date&&!remove)return;
    const d=clone(getDiary()),row=d.records.find(r=>r.date===(date||remove));if(!row)return;
    if(date){keepDraft(d);const saved=d.dailyDrafts.find(r=>r.date===date)||row;d.draft=Object.fromEntries(DIARY_KEYS.map(k=>[k,String(saved[k])]));d.step=2;}
    else{undo=clone(row);d.records=d.records.filter(r=>r.date!==remove);d.dailyDrafts=d.dailyDrafts.filter(r=>r.date!==remove);}
    commit(d);render();message(remove?'已删除，可撤销。':'已载入这一天的记录。');
  });
  $('diary-undo').onclick=()=>act(()=>{if(!undo)return;commit(saveDiaryRecord(getDiary(),undo,today()));undo=null;render();message('记录已恢复。');});
  for(const kind of ['need','actual','recovery'])$('diary-adopt-'+kind).onclick=()=>act(()=>{
    if(blocked())throw new Error('先修正其他页面里尚未填好的输入');
    const next=diarySuggestion(getDiary(),getCurrent(),kind,today());
    const text={need:'已更新每天睡多久的参考；其他输入保留。',actual:'已用最近完整一周更新睡眠、疲劳和时间安排。',recovery:'已采用更贴近记录的恢复设置。'}[kind];
    const d=clone(getDiary());d.lastApplied=text;commit(d);apply(next);render();message(text);
  });
  return {render,open:()=>move(2)};
}
