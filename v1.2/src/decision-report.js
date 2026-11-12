import { LIMIT_FIELDS } from './comparison.js';
import { PLAIN_FIELDS } from './copy.js';
import { GUIDE_GOALS } from './guide.js';
import { SOURCE_FIELDS, SOURCE_LABELS } from './records.js';

const METRICS=[
  ['knowledge','期末知识','分'],
  ['effectiveLearn','累计有效学习','折算小时'],
  ['income','累计工作收入','元'],
  ['cash','期末现金','元'],
  ['fatigue','期末疲劳','分',-1],
  ['averageFatigue','平均疲劳','分',-1],
  ['sleepDebt','期末睡眠债','小时',-1]
];
const escapeHTML=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const scalar=new Intl.NumberFormat('zh-CN',{maximumFractionDigits:20});
const decimal=new Intl.NumberFormat('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const time=(date,label=date)=>`<time datetime="${escapeHTML(date)}">${escapeHTML(label)}</time>`;
const timeLabel=key=>key==='unallocated'?'空余时间':PLAIN_FIELDS[key];

function excerpt(text,limit){
  const chars=Array.from(text.trim().replace(/\s+/gu,' '));
  return escapeHTML(chars.length>limit?chars.slice(0,limit).join('')+'…':chars.join(''));
}

function metricRows(summary){
  return METRICS.map(([key,label,unit,direction=1])=>{
    const before=summary.baseline[key],after=summary.chosen[key],delta=after-before;
    const change=Math.abs(delta)<1e-9?0:delta;
    const effect=change===0?'':change*direction>0?'report-favorable':'report-unfavorable';
    const amount=change===0?'0.00':Math.abs(change)<.01?`${change>0?'增加':'减少'} &lt;0.01`:`${change>0?'+':'−'}${decimal.format(Math.abs(change))}`;
    return `<tr><th scope="row">${label} <small>（${unit}）</small></th><td>${decimal.format(before)}</td><td>${decimal.format(after)}</td><td class="${effect}">${amount}</td></tr>`;
  }).join('\n');
}

function limitRows(limits,margins,weeks){
  return Object.entries(LIMIT_FIELDS).map(([key,{label,unit}])=>{
    const margin=margins.find(m=>m.key===key);
    const heading=key==='maxIncomeLoss'?`${label}（${weeks} 周累计）`:label;
    const detail=margin?`<small>${margin.week===0?'起点':`第 ${scalar.format(margin.week)} 周`} · ${margin.ok?'余量':'差额'} ${decimal.format(Math.abs(margin.margin))} ${unit}</small>`:'';
    return `<div><dt>${heading}</dt><dd>${limits[key]===null?'未设置':`${scalar.format(limits[key])} ${unit}`}${detail}</dd></div>`;
  }).join('\n');
}

function sourceRows(sources){
  return SOURCE_FIELDS.map(field=>{
    const source=sources[field.id];
    const context=[SOURCE_LABELS[source.kind],source.date?time(source.date):'',source.note?excerpt(source.note,18):''].filter(Boolean);
    return `<div><dt>${escapeHTML(field.label)}</dt><dd class="report-source-value">${scalar.format(source.value)} ${escapeHTML(field.unit)}</dd><dd class="report-source-context">${context.join(' · ')}</dd></div>`;
  }).join('\n');
}

// This view never uses the working scenario or runs the model again.
export function renderDecisionReport(record){
  const {snapshot,summary,reviews}=record;
  const {config,weeks,limits,sources}=snapshot;
  const duration=scalar.format(weeks);
  const goal=GUIDE_GOALS[config.goal].label;
  const protectedTimes=[['protectSleep','睡眠'],['protectWork','工作'],['protectLearn','学习']].filter(([key])=>config[key]).map(([,label])=>label);
  const planChange=[summary.source,summary.target].map(key=>{
    const label=escapeHTML(timeLabel(key));
    if(key==='unallocated')return `${label}减少 ${scalar.format(config.amount)} 小时`;
    return `${label} ${scalar.format(summary.baselinePlan[key])} → ${scalar.format(summary.chosenPlan[key])} 小时`;
  }).join('；');
  const latest=reviews.reduce((current,review)=>!current||review.date>=current.date?review:current,null);
  const prose=(label,value,limit)=>`<div><dt>${label}</dt><dd>${excerpt(value,limit)||'未填写'}</dd></div>`;
  const created=record.createdAt.slice(0,16).replace('T',' ')+' UTC';
  return `<article class="decision-report">
<header class="report-header">
  <p class="report-kicker">试行档案</p>
  <h1>单页决策报告</h1>
  <p class="report-meta">归档 ${time(record.createdAt,created)} · 模型 ${escapeHTML(record.modelVersion)}</p>
</header>
<section>
  <h2>试行计划</h2>
  <p><strong>${goal}｜${escapeHTML(summary.label)}</strong> · 每周挪 ${scalar.format(config.amount)} 小时 · ${duration} 周合计 ${scalar.format(summary.totalHours)} 小时</p>
  <p class="report-meta">首周：${planChange}</p>
  <p class="report-dates"><span>开始 ${time(record.startDate)}</span><span>计划复盘 ${time(record.reviewDate)}</span></p>
  <dl class="report-prose">${prose('试行意图',record.intent,54)}${prose('停止条件',record.stopRule,54)}${record.note?prose('备注',record.note,54):''}</dl>
</section>
<section>
  <h2>预计变化 · ${duration} 周</h2>
  <table class="report-metrics">
    <thead><tr><th scope="col">指标</th><th scope="col">原安排</th><th scope="col">所选方案</th><th scope="col">差值</th></tr></thead>
    <tbody>${metricRows(summary)}</tbody>
  </table>
</section>
<section>
  <h2>个人底线</h2>
  <dl class="report-limits">${limitRows(limits,summary.margins,duration)}</dl>
  <p class="report-meta">${protectedTimes.length?`不减少：${protectedTimes.join('、')}`:'未设置不减少的时间项目。'}</p>
</section>
<section>
  <h2>关键输入及来源</h2>
  <p class="report-meta">来源对应基础输入，不含逐周调整。推演收入按有效工时折算。</p>
  <dl class="report-sources">${sourceRows(sources)}</dl>
</section>
<section>
  <h2>最近复盘${latest?` · ${time(latest.date)}`:''}</h2>
  ${latest?`<dl class="report-review">${prose('执行',latest.execution,48)}${prose('实际结果',latest.outcome,48)}${prose('原因',latest.reason,48)}${prose('下一步',latest.nextStep,48)}</dl>`:'<p class="report-meta">暂无复盘。</p>'}
</section>
<footer>预计变化是模型推演。带省略号的内容为节选，全文保留在档案中。</footer>
</article>`;
}

const REPORT_STYLE=`
@page { size: A4; margin: 12mm; }
* { box-sizing: border-box; }
body { margin: 0; background: #f2f5f6; color: #18303b; font: 13px/1.36 system-ui, "PingFang SC", "Microsoft YaHei", sans-serif; }
.decision-report { max-width: 820px; margin: 0 auto; padding: 20px; background: #fff; overflow-wrap: anywhere; }
.report-header { border-top: 4px solid #186c63; padding-top: 10px; }
.decision-report h1, .decision-report h2, .decision-report p, .decision-report dl, .decision-report dd { margin: 0; }
.decision-report h1 { font-size: 1.9em; line-height: 1.25; margin-bottom: 4px; }
.decision-report h2 { font-size: 1.1em; margin-bottom: 4px; }
.report-kicker { font-size: .84em; font-weight: 700; color: #186c63; letter-spacing: .14em; }
.report-meta, .decision-report footer { color: #445b65; font-size: .89em; }
.decision-report section { margin-top: 9px; }
.report-dates, .report-review, .report-sources, .report-limits { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); column-gap: 14px; }
.decision-report .report-limits { grid-template-columns: repeat(3, minmax(0,1fr)); margin-bottom: 3px; }
.decision-report .report-dates { width: fit-content; margin-top: 2px; }
.report-prose > div, .report-review > div { display: grid; grid-template-columns: 4.6em minmax(0,1fr); }
.report-prose dt, .report-review dt, .report-limits dt { font-weight: 650; }
.report-metrics { width: 100%; border-collapse: collapse; table-layout: fixed; font-variant-numeric: tabular-nums; }
.report-metrics th, .report-metrics td { text-align: right; padding: 2px 6px; border-bottom: 1px solid #dce4e7; }
.report-metrics th:first-child { width: 40%; text-align: left; }
.report-metrics thead { background: #edf3f5; }
.report-metrics tbody th { font-weight: 500; }
.report-favorable { color: #156653; font-weight: 650; }
.report-unfavorable { color: #9a4231; font-weight: 650; }
.report-sources > div { display: grid; grid-template-columns: minmax(0,1.2fr) minmax(0,.8fr); align-items: baseline; column-gap: 6px; border-bottom: 1px solid #dce4e7; padding: 2px 0; }
.report-source-value { text-align: right; font-weight: 550; }
.report-source-context { grid-column: 1 / -1; }
.report-source-context, .report-limits small { display: block; color: #445b65; font-size: .84em; }
.decision-report footer { margin-top: 12px; border-top: 1px solid #a6b8bf; padding-top: 5px; }
@media screen and (max-width: 560px) {
  .decision-report { padding: 14px; }
  .report-sources, .report-review, .decision-report .report-limits { grid-template-columns: minmax(0,1fr); row-gap: 3px; }
  .report-metrics { font-size: .87em; }
  .report-metrics th, .report-metrics td { padding: 3px; }
  .report-metrics th:first-child { width: 32%; }
}
@media print {
  body { background: #fff; font-size: 9.5pt; line-height: 1.32; }
  .decision-report { padding: 0; margin: 0; max-width: none; }
  .decision-report section, .decision-report header, .decision-report footer { break-inside: avoid; }
  .decision-report section { margin-top: 8px; }
  .decision-report footer { margin-top: 8px; }
}
`;

export function decisionReportDocument(record){
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>单页决策报告 · ${escapeHTML(record.startDate)}</title>
<style>${REPORT_STYLE}</style>
</head>
<body>
${renderDecisionReport(record)}
</body>
</html>`;
}
