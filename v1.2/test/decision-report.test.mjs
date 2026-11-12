import test from 'node:test';
import assert from 'node:assert/strict';
import {clone, DEFAULT_SCENARIO} from '../src/schema.js';
import {DEFAULT_GUIDE} from '../src/guide.js';
import {appendReview,createTrial,newSources,setSource,SOURCE_FIELDS,SOURCE_LABELS} from '../src/records.js';
import {renderDecisionReport,decisionReportDocument} from '../src/decision-report.js';

function fixture(overrides={}){
  const scenario=clone(DEFAULT_SCENARIO),schedule={1:{work:42}};
  let sources=newSources(scenario);
  sources=setSource(sources,'state.cash',{kind:'record',date:'2026-11-10',note:'工资账本'},scenario);
  sources=setSource(sources,'plan.work',{kind:'estimate',date:'',note:''},scenario);
  sources=setSource(sources,'state.fatigue',{kind:'unknown',date:'',note:''},scenario);
  const record=createTrial({
    id:'report-case',createdAt:'2026-11-10T14:30:00.000Z',startDate:'2026-11-11',reviewDate:'2026-11-18',
    intent:'完成一个练习单元',stopRule:'工作延误就暂停',note:'先和同事确认',scenario,schedule,weeks:4,
    config:{...DEFAULT_GUIDE},limits:{minCash:1000,minSleep:null,maxIncomeLoss:5000},choiceId:'work',sources,
    ...overrides
  });
  return {record,scenario,schedule};
}

test('report shows saved original and chosen metrics, time adjustment and applicable limits',()=>{
  const {record}=fixture();
  const report=renderDecisionReport(record);
  assert.match(report,/多学一点.*少工作一点/s);
  assert.match(report,/工作.*42.*40.*学习.*6.*8/s);
  assert.match(report,/原安排.*所选方案.*差值/s);
  assert.match(report,/累计工作收入.*6,826\.79.*6,493\.47.*−333\.32/s);
  assert.match(report,/期末知识.*62\.96.*63\.44.*\+0\.48/s);
  assert.match(report,/最低现金.*1,000.*余量.*28,232\.86/s);
  assert.match(report,/每周最低睡眠[^\n]*未设置/);
  assert.match(report,/最多减少收入.*5,000/s);
  assert.match(report,/完成一个练习单元.*工作延误就暂停.*先和同事确认/s);
});

test('a zero-valued limit is configured rather than unset',()=>{
  const {record}=fixture({limits:{minCash:0,minSleep:0,maxIncomeLoss:5000}});
  assert.match(renderDecisionReport(record),/每周最低睡眠[^\n]*0 小时[^\n]*余量/);
});

test('report has all 12 source labels and distinguishes entered values from their source status',()=>{
  const {record}=fixture();
  const report=renderDecisionReport(record);
  assert.equal(SOURCE_FIELDS.length,12);
  for(const field of SOURCE_FIELDS){
    const source=record.snapshot.sources[field.id];
    const row=report.split('\n').find(line=>line.includes(`<dt>${field.label}</dt>`));
    assert.ok(row,field.label);
    assert.ok(row.includes(SOURCE_LABELS[source.kind]),field.label);
    assert.ok(row.includes(source.value.toLocaleString('zh-CN')),field.label);
  }
  assert.match(report,/30,000 元.*来自记录.*2026-11-10.*工资账本/s);
  assert.match(report,/来源对应基础输入，不含逐周调整/);
  assert.match(report,/按有效工时折算/);
});

test('changes to the working scenario and schedule leave the saved report unchanged',()=>{
  const {record,scenario,schedule}=fixture();
  const original=renderDecisionReport(record);
  scenario.plan.work=100;
  scenario.state.cash=10000;
  schedule[1].work=1;
  assert.equal(renderDecisionReport(record),original);
  assert.match(original,/归档.*2026-11-10.*1\.2\.0/s);
  assert.match(original,/开始.*2026-11-11.*计划复盘.*2026-11-18/s);
});

test('a dated latest review is separate from the original projections',()=>{
  const {record}=fixture();
  const review=(id,date,execution)=>({id,date,execution,outcome:'完成练习',reason:'工时稳定',nextStep:'再试一周'});
  let archive=[record];
  archive=appendReview(archive,record.id,review('first','2026-11-18','早期的复盘'));
  archive=appendReview(archive,record.id,review('latest','2026-11-21','已执行两周'));
  archive=appendReview(archive,record.id,review('backfill','2026-11-19','后来补录的旧复盘'));
  const report=renderDecisionReport(archive[0]);
  assert.match(report,/累计工作收入.*6,826\.79.*6,493\.47/s);
  assert.match(report,/最近复盘.*2026-11-21.*已执行两周.*完成练习.*工时稳定.*再试一周/s);
  assert.doesNotMatch(report,/早期的复盘|后来补录的旧复盘/);
  assert.match(renderDecisionReport(record),/暂无复盘/);
});

test('report escapes user text, excerpts long prose visibly, and keeps the full original record',()=>{
  const text='<img src=x onerror="alert(1)"> & 试行';
  const long='这里是完整的说明。'.repeat(28)+'归档尾部标记';
  const sourceNote="<a id='x'>&";
  const sources=setSource(newSources(DEFAULT_SCENARIO),'plan.work',{kind:'estimate',date:'',note:sourceNote},DEFAULT_SCENARIO);
  const {record}=fixture({intent:text,note:long,sources});
  const reviewed=appendReview([record],record.id,{
    id:'review',date:'2026-11-18',execution:text,outcome:'已完成',reason:long,nextStep:'继续'
  })[0];
  const report=renderDecisionReport(reviewed);
  assert.equal(report.match(/&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; 试行/g)?.length,2);
  assert.match(report,/&lt;a id=&#39;x&#39;&gt;&amp;/);
  assert.doesNotMatch(report,/<img |<a id=|归档尾部标记/);
  assert.match(report,/….*全文保留在档案中/s);
  assert.equal(reviewed.note,long);
  assert.equal(reviewed.reviews[0].reason,long);
});

test('standalone report embeds the same report, offline styles and A4 print rules',()=>{
  const {record}=fixture();
  const doc=decisionReportDocument(record);
  assert.match(doc,/^<!doctype html>\s*<html lang="zh-CN">/i);
  assert.match(doc,/<meta name="viewport"/);
  assert.match(doc,/<style>.*@page\s*\{\s*size:\s*A4.*@media print.*<\/style>/s);
  assert.match(doc,/<\/body>\s*<\/html>\s*$/);
  assert.ok(doc.includes(renderDecisionReport(record)));
  assert.doesNotMatch(doc,/<(?:script|link|img|iframe)\b|url\s*\(|@import/i);
});
