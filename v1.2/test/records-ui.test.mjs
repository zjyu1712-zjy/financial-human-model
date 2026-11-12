import test from 'node:test';
import assert from 'node:assert/strict';
import {boot} from './fixture.mjs';
import {decodeWorkspace} from '../src/workspace.js';
import {appendReview} from '../src/records.js';
import {readFile} from 'node:fs/promises';

function prepare(u){
  for(let i=0;i<3;i++)u.get('guide-next').onclick();
  u.choose('work');u.get('guide-next').onclick();
  u.get('trial-start-date').value='2026-11-11';
  u.get('trial-review-date').value='2026-11-18';
  u.get('trial-intent').value='完成一节课程';
  u.get('trial-stop').value='无法完成必要工作时暂停';
}
function mark(u){
  u.get('source-field').value='plan.work';u.get('source-field').onchange();
  u.get('source-kind').value='record';u.get('source-date').value='2026-11-11';
  u.get('source-note').value='过去一周的日程记录';u.get('source-save').onclick();
}
test('sources bind to a value, survive reload and invalidate on advanced edits',async()=>{
  const u=await boot();
  assert.equal(u.saved().inputSources['plan.work'].kind,'default');
  mark(u);assert.equal(u.saved().inputSources['plan.work'].kind,'record');
  const v=await boot('#guide',u.storage);
  assert.equal(v.saved().inputSources['plan.work'].note,'过去一周的日程记录');
  v.edit('plan','work','39');assert.equal(v.saved().inputSources['plan.work'].kind,'unknown');
  assert.match(v.get('source-list').innerHTML,/来源未知/);
});
test('dated trials accumulate, freeze expectations and export the entire archive',async()=>{
  const u=await boot();prepare(u);mark(u);u.get('trial-create').onclick();
  assert.equal(u.saved().trialArchive.length,1);
  const first=structuredClone(u.saved().trialArchive[0]);
  u.get('trial-create').onclick();
  assert.equal(u.saved().trialArchive.length,2);
  assert.notEqual(u.saved().trialArchive[1].id,first.id);
  u.edit('parameters','learningGain','2');
  assert.deepEqual(u.saved().trialArchive[0],first);
  const v=await boot('#files',u.storage);assert.equal(v.saved().trialArchive.length,2);
  v.get('export').onclick();const exported=JSON.parse(await v.blobs.at(-1).text());
  assert.deepEqual(exported.trialArchive,v.saved().trialArchive);
  assert.deepEqual(decodeWorkspace(exported).trialArchive,exported.trialArchive);
});
test('reviews append to the selected historical record without rewriting its snapshot',async()=>{
  const u=await boot();prepare(u);u.get('trial-create').onclick();
  const before=structuredClone(u.saved().trialArchive[0]);
  u.get('review-date').value='2026-11-18';u.get('review-execution').value='只完成了一小时';
  u.get('review-outcome').value='完成半节课程';u.get('review-reason').value='临时工作';
  u.get('review-next').value='下周减少任务量';u.get('review-save').onclick();
  const r=u.saved().trialArchive[0];assert.deepEqual(r.snapshot,before.snapshot);
  assert.deepEqual(r.summary,before.summary);assert.equal(r.reviews.length,1);
  assert.equal(r.reviews[0].execution,'只完成了一小时');
  u.get('review-execution').value='第二次复盘';u.get('review-save').onclick();
  assert.equal(u.saved().trialArchive[0].reviews.length,2);
});
test('reports use archived values and escape user text; JSON is not substituted for HTML',async()=>{
  const u=await boot();prepare(u);u.get('trial-intent').value='<script>alert(1)</script>';u.get('trial-create').onclick();
  u.get('record-report').onclick();const before=await u.blobs.at(-1).text();
  assert.match(before,/<html/);assert.match(before,/&lt;script&gt;/);assert.doesNotMatch(before,/<script>/);
  u.edit('state','cash','90000');u.get('record-report').onclick();
  assert.equal(await u.blobs.at(-1).text(),before);
  assert.equal(u.get('report-preview').srcdoc,before);
});
test('invalid current drafts block archive creation while history remains readable',async()=>{
  const u=await boot();prepare(u);u.get('trial-create').onclick();
  u.edit('plan','work','');assert.equal(u.get('trial-create').disabled,true);
  u.get('trial-create').onclick();assert.equal(u.saved().trialArchive.length,1);
  u.get('record-report').onclick();assert.match(await u.blobs.at(-1).text(),/<html/);
});
test('legacy workspaces receive unknown sources and empty archives; corrupt import is atomic',async()=>{
  const u=await boot();prepare(u);u.get('trial-create').onclick();
  const original=u.saved(),bad=structuredClone(original);bad.trialArchive[0].startDate='2026-02-30';
  await u.get('import').onchange({target:{files:[{size:100,text:async()=>JSON.stringify(bad)}]}});
  assert.deepEqual(u.saved(),original);
  assert.match(u.get('file-message').textContent,/导入未完成/);
  const old=structuredClone(original);delete old.trialArchive;delete old.inputSources;
  await u.get('import').onchange({target:{files:[{size:100,text:async()=>JSON.stringify(old)}]}});
  assert.equal(u.saved().trialArchive.length,0);assert.equal(u.saved().inputSources['plan.work'].kind,'unknown');
});
test('deletion requires a second explicit action and does not affect other archives',async()=>{
  const u=await boot();prepare(u);u.get('trial-create').onclick();u.get('trial-create').onclick();
  u.get('record-delete').onclick();assert.equal(u.saved().trialArchive.length,2);
  u.get('record-delete-confirm').onclick();assert.equal(u.saved().trialArchive.length,1);
});
test('trial and review drafts survive reload and remain separate for each trial',async()=>{
  const u=await boot();prepare(u);u.get('trial-intent').oninput();u.get('trial-create').onclick();
  const first=u.saved().trialArchive[0].id;
  u.get('review-execution').value='尚未完成的复盘';u.get('review-execution').oninput();
  const v=await boot('#files',u.storage);assert.equal(v.get('trial-intent').value,'完成一节课程');
  assert.equal(v.get('review-execution').value,'尚未完成的复盘');
  v.get('trial-create').onclick();assert.equal(v.get('review-execution').value,'');
  v.get('record-select').value=first;v.get('record-select').onchange();
  assert.equal(v.get('review-execution').value,'尚未完成的复盘');
});
test('storage denial keeps a trial exportable and clearly reports it was not saved locally',async()=>{
  const u=await boot('#guide',new Map(),true);prepare(u);u.get('trial-create').onclick();
  assert.match(u.get('trial-message').textContent,/本机保存未完成/);
  u.get('export').onclick();const data=JSON.parse(await u.blobs.at(-1).text());assert.equal(data.trialArchive.length,1);
});
test('restoring an older snapshot cannot attribute it to the current input records',async()=>{
  const u=await boot();prepare(u);u.get('guide-save').onclick();mark(u);
  u.get('guide-load').onclick();assert.equal(u.saved().inputSources['plan.work'].kind,'unknown');
});
test('source editor refreshes when restoring default values even when its numeric value stays equal',async()=>{
  const u=await boot();mark(u);assert.equal(u.get('source-kind').value,'record');
  u.get('reset').onclick();assert.equal(u.get('source-kind').value,'default');
});
test('full archive backups above 5MB remain importable; above 64MB is rejected',async()=>{
  const u=await boot();prepare(u);u.get('trial-create').onclick();const data=u.saved();
  const v=await boot();await v.get('import').onchange({target:{files:[{size:6000000,text:async()=>JSON.stringify(data)}]}});
  assert.equal(v.saved().trialArchive.length,1);
  const before=v.saved();await v.get('import').onchange({target:{files:[{size:64000001,text:async()=>JSON.stringify(data)}]}});
  assert.match(v.get('error').textContent,/64 MB/);assert.deepEqual(v.saved(),before);
});
test('review capacity is visible when the save button becomes disabled',async()=>{
  const u=await boot();prepare(u);u.get('trial-create').onclick();const data=u.saved();
  for(let i=0;i<20;i++)data.trialArchive=appendReview(data.trialArchive,data.trialArchive[0].id,{id:`review-${i}`,date:'2026-11-18',execution:'完成',outcome:'',reason:'',nextStep:''});
  await u.get('import').onchange({target:{files:[{size:100,text:async()=>JSON.stringify(data)}]}});
  assert.equal(u.get('review-save').disabled,true);assert.match(u.get('review-capacity').textContent,/20.*上限/);
});
test('restored report srcdoc loads eagerly even while its details pane starts collapsed',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const frame=html.match(/<iframe\b[^>]*id="report-preview"[^>]*>/)?.[0];
  assert.ok(frame);assert.doesNotMatch(frame,/loading="lazy"/);assert.match(frame,/sandbox=""/);
});
test('startup restores the report in one navigation without racing blank srcdoc writes',async()=>{
  const u=await boot();assert.deepEqual(u.get('report-preview').srcdocWrites,[]);
  prepare(u);u.get('trial-create').onclick();
  const v=await boot('#files',u.storage);
  assert.equal(v.get('report-preview').srcdocWrites.length,1);
  assert.match(v.get('report-preview').srcdocWrites[0],/单页决策报告/);
});
