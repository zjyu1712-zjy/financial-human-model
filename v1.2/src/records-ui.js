import { clone } from './schema.js';
import { GUIDE_GOALS } from './guide.js';
import { SOURCE_FIELDS, SOURCE_LABELS, setSource, createTrial, appendTrial, appendReview, deleteTrial, localDate } from './records.js';
import { decisionReportDocument } from './decision-report.js';

const escapeHTML=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const reviewFields={execution:'review-execution',outcome:'review-outcome',reason:'review-reason',nextStep:'review-next'};
const uid=()=>`${Date.now()}-${Math.random().toString(36).slice(2,12)}`;
const downloadHTML=(name,html)=>{const blob=new Blob([html],{type:'text/html;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};

export function mountRecords({getState,onSources,onArchive,onDrafts}){
  const $=id=>document.querySelector('#'+id);
  let selection='',sourceKey='plan.work',sourceValue,sourceSignature='',reportSignature='',pendingDelete='';
  const message=(id,text)=>{$(id).textContent=text;};
  const saveNotice=ok=>ok===false?'本机保存未完成，请用“导出全部数据”备份。':'已保存到本机。';
  function readTrial(){return {startDate:$('trial-start-date').value,reviewDate:$('trial-review-date').value,intent:$('trial-intent').value,stopRule:$('trial-stop').value};}
  function readReview(){return {trialId:selection,date:$('review-date').value,...Object.fromEntries(Object.entries(reviewFields).map(([k,id])=>[k,$(id).value]))};}
  function saveDraft(kind){
    const d=clone(getState().recordDrafts);
    if(kind==='trial')d.trial=readTrial();
    if(kind==='review'&&selection){d.reviews=d.reviews.filter(r=>r.trialId!==selection);d.reviews.push(readReview());}
    d.selectedId=selection;onDrafts(d);
  }
  function loadReview(){
    const draft=getState().recordDrafts.reviews.find(r=>r.trialId===selection);
    $('review-date').value=draft?.date||localDate();
    for(const [key,id] of Object.entries(reviewFields))$(id).value=draft?.[key]||'';
  }
  function restoreDrafts(){
    const d=getState().recordDrafts;
    $('trial-start-date').value=d.trial.startDate;$('trial-review-date').value=d.trial.reviewDate;
    $('trial-intent').value=d.trial.intent;$('trial-stop').value=d.trial.stopRule;
    selection=d.selectedId;reportSignature='';sourceValue=undefined;loadReview();render();
  }
  function loadSource(){
    const s=getState(),f=SOURCE_FIELDS.find(f=>f.id===sourceKey),entry=s.inputSources[sourceKey];
    if(!f||!entry)return;
    sourceValue=s.current[f.group][f.key];
    sourceSignature=JSON.stringify(entry);
    $('source-kind').value=entry.kind;$('source-date').value=entry.date;$('source-note').value=entry.note;
    $('source-current').textContent=`${f.label}：${sourceValue} ${f.unit}。来源标记对应这个数值。`;
  }
  function render(){
    const s=getState();
    const counts=Object.keys(SOURCE_LABELS).map(kind=>`${SOURCE_LABELS[kind]} ${Object.values(s.inputSources).filter(e=>e.kind===kind).length} 项`);
    $('source-summary').textContent=counts.join(' · ');
    $('source-list').innerHTML=`<table><thead><tr><th>输入</th><th>当前值</th><th>来源</th><th>观察日期与说明</th></tr></thead><tbody>${SOURCE_FIELDS.map(f=>{const e=s.inputSources[f.id];return `<tr><th scope="row">${escapeHTML(f.label)}</th><td>${escapeHTML(s.current[f.group][f.key])} ${escapeHTML(f.unit)}</td><td>${escapeHTML(SOURCE_LABELS[e.kind])}</td><td>${escapeHTML(e.date||'未填写日期')}${e.note?` · ${escapeHTML(e.note)}`:''}</td></tr>`;}).join('')}</tbody></table>`;
    const f=SOURCE_FIELDS.find(f=>f.id===sourceKey);
    if(f&&(sourceValue!==s.current[f.group][f.key]||sourceSignature!==JSON.stringify(s.inputSources[sourceKey])))loadSource();
    $('source-save').disabled=s.blocked;
    $('trial-create').disabled=s.blocked||!s.choiceId;
    $('trial-create-hint').textContent=s.blocked?'请先修正当前输入，再存入档案。':s.choiceId?'保存当时的输入、来源、底线和预期结果；之后复盘追加记录。':'先选择一项可试行的方案。';
    const ordered=[...s.trialArchive].sort((a,b)=>b.startDate.localeCompare(a.startDate)||b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
    if(!ordered.some(r=>r.id===selection)){selection=ordered[0]?.id||'';loadReview();}
    $('record-select').innerHTML=ordered.map((r,i)=>`<option value="${escapeHTML(r.id)}">${escapeHTML(r.startDate)} · ${escapeHTML(GUIDE_GOALS[r.snapshot.config.goal].label)} · ${escapeHTML(r.summary.label)} · ${i+1}</option>`).join('');
    $('record-select').value=selection;
    $('record-count').textContent=`${s.trialArchive.length} 份试行档案`;
    $('record-empty').hidden=!!selection;$('record-detail').hidden=!selection;
    $('record-picker').hidden=!selection;
    const r=s.trialArchive.find(r=>r.id===selection);
    // Avoid queued blank navigations racing the restored srcdoc during startup (WebKit).
    if(!r){if($('report-preview').srcdoc)$('report-preview').srcdoc='';reportSignature='';return;}
    $('record-context').textContent=`${r.startDate} 开始 · ${r.reviewDate} 计划复盘 · ${r.summary.label} · ${r.reviews.length} 次复盘`;
    $('record-intent').textContent=r.intent;$('record-stop').textContent=r.stopRule;
    $('record-original-note').textContent=r.note||'未填写补充笔记';
    $('record-review-history').innerHTML=r.reviews.length?r.reviews.map(review=>`<article class="record-review"><h4>${escapeHTML(review.date)}</h4>${Object.entries({execution:'实际执行',outcome:'实际结果',reason:'差异原因',nextStep:'下一步'}).map(([key,label])=>`<p><strong>${label}：</strong>${escapeHTML(review[key]||'未填写')}</p>`).join('')}</article>`).join(''):'<p class="muted">还没有复盘记录。</p>';
    const signature=JSON.stringify(r);
    if(signature!==reportSignature){$('report-preview').srcdoc=decisionReportDocument(r);reportSignature=signature;}
    $('review-save').disabled=r.reviews.length>=20;
    $('review-capacity').textContent=r.reviews.length>=20?'已达到本档案20次复盘的上限。未保存的文字仍保留为草稿，可随全部数据导出。':`已记录 ${r.reviews.length} / 20 次复盘。`;
    if(pendingDelete!==selection){pendingDelete='';$('record-delete-check').hidden=true;}
  }
  $('source-field').innerHTML=SOURCE_FIELDS.map(f=>`<option value="${f.id}">${escapeHTML(f.label)}</option>`).join('');$('source-field').value=sourceKey;
  $('source-kind').innerHTML=Object.entries(SOURCE_LABELS).map(([key,label])=>`<option value="${key}">${label}</option>`).join('');
  $('source-field').onchange=()=>{sourceKey=$('source-field').value;message('source-message','');loadSource();};
  $('source-save').onclick=()=>{
    if(getState().blocked){message('source-message','请先修正当前输入。');return;}
    try{const s=getState(),value=setSource(s.inputSources,sourceKey,{kind:$('source-kind').value,date:$('source-date').value,note:$('source-note').value},s.current);const ok=onSources(value);render();message('source-message',`已更新这项输入的来源。${saveNotice(ok)}`);}catch(e){message('source-message',e.message);}
  };
  for(const id of ['trial-start-date','trial-review-date','trial-intent','trial-stop'])$(id).oninput=()=>saveDraft('trial');
  for(const id of ['review-date',...Object.values(reviewFields)])$(id).oninput=()=>saveDraft('review');
  $('trial-create').onclick=()=>{
    const s=getState();if(s.blocked||!s.choiceId){message('trial-message','请先修正输入并选择一项可试行方案。');return;}
    try{
      const record=createTrial({id:uid(),createdAt:new Date().toISOString(),...readTrial(),scenario:s.current,schedule:s.schedule,weeks:s.weeks,config:s.config,limits:s.limits,choiceId:s.choiceId,sources:s.inputSources,note:s.note});
      const archive=appendTrial(s.trialArchive,record);selection=record.id;saveDraft('trial');
      const ok=onArchive(archive);loadReview();render();message('trial-message',`已添加 ${record.startDate} 的试行档案。${saveNotice(ok)}`);
    }catch(e){message('trial-message',e.message);}
  };
  $('record-select').onchange=()=>{saveDraft('review');selection=$('record-select').value;const d=clone(getState().recordDrafts);d.selectedId=selection;onDrafts(d);loadReview();render();message('record-message','');};
  $('review-save').onclick=()=>{
    if(!selection)return;
    try{const {trialId,...review}=readReview(),s=getState(),archive=appendReview(s.trialArchive,selection,{id:uid(),...review});
      const ok=onArchive(archive),d=clone(getState().recordDrafts);d.reviews=d.reviews.filter(r=>r.trialId!==selection);onDrafts(d);loadReview();render();message('record-message',`已追加复盘，原先预期保持不变。${saveNotice(ok)}`);
    }catch(e){message('record-message',e.message);}
  };
  $('record-report').onclick=()=>{const r=getState().trialArchive.find(r=>r.id===selection);if(r)downloadHTML(`金融学人-决策报告-${r.startDate}-${r.id}.html`,decisionReportDocument(r));};
  $('record-delete').onclick=()=>{pendingDelete=selection;$('record-delete-check').hidden=false;};
  $('record-delete-cancel').onclick=()=>{pendingDelete='';$('record-delete-check').hidden=true;};
  $('record-delete-confirm').onclick=()=>{
    if(!selection||pendingDelete!==selection)return;
    const id=selection,archive=deleteTrial(getState().trialArchive,id);pendingDelete='';selection='';
    const d=clone(getState().recordDrafts);d.selectedId='';d.reviews=d.reviews.filter(r=>r.trialId!==id);onDrafts(d);
    const ok=onArchive(archive);render();$('record-delete-check').hidden=true;message('record-message',`已删除所选档案。${saveNotice(ok)}`);
  };
  restoreDrafts();
  return {render,restoreDrafts};
}
