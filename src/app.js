import { STATE_FIELDS, ACTION_FIELDS, SYSTEMS, getRadarValues, clamp } from './model.js';
import { PARAMETER_GROUPS, PARAMETER_FIELDS, DEFAULT_PARAMETERS, WEIGHT_KEYS } from './parameters.js';
import { createExperiment, changeExperiment, changeParameterDraft, captureBaseline, restoreBaseline, resetExperiment, compareExperiment } from './experiment.js';
import { formatNumber as fmt, deltaText, radarPoint, linePath, STATUS_LABELS } from './presentation.js';

let experiment = createExperiment();
let weeks = 4;
let radarMode = 'initial';
let baselineNumber = 0;
const invalid = new Map();
let parameterDrafts = {};
const $ = selector => document.querySelector(selector);
const utilityNames = { safety:'安全', autonomy:'自主', quality:'品质', relation:'关系', growth:'成长', meaning:'意义' };
const costNames = { emotion:'情绪功能损失', risk:'风险超限', desire:'欲望错配', health:'健康透支', budget:'预算压力 · 扩展' };
const groupNames = { state:'状态', actions:'行动', shock:'冲击', parameters:'参数' };

function control(field, value, group) {
  const { key, label, hint, color = '#21776b', min = 0, max = 100, step = 1 } = field;
  const id = `${group}-${key}`;
  const prefix = group === 'state' ? '初始状态' : group === 'actions' ? '行动' : group === 'parameters' ? '参数' : '冲击';
  const defaultLabel = group === 'parameters' ? `<span class="default-label">默认 ${field.value}</span>` : '';
  return `<div class="control-row" style="--accent:${color}">
    <div class="control-copy"><label for="${id}-number">${label}</label>${defaultLabel}<small id="${id}-hint">${hint}</small></div>
    <input id="${id}-number" type="number" min="${min}" max="${max}" step="any" value="${value}" data-group="${group}" data-key="${key}" aria-label="${prefix} · ${label}" aria-describedby="${id}-hint ${id}-error" aria-invalid="false" />
    <input id="${id}-range" type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-group="${group}" data-key="${key}" aria-label="${prefix} · ${label}滑杆" aria-describedby="${id}-hint" />
    <span class="field-error" id="${id}-error"></span></div>`;
}

function renderControls() {
  const openGroups = new Set([...document.querySelectorAll('#parameter-groups details[open]')].map(el => el.id));
  const first = !$('#parameter-groups').children.length;
  const { input, parameters } = experiment.current;
  $('#state-controls').innerHTML = STATE_FIELDS.map(f => control(f,input.state[f.key],'state')).join('');
  $('#action-controls').innerHTML = ACTION_FIELDS.map(f => control(f,input.actions[f.key],'actions')).join('');
  $('#shock-control').innerHTML = control({ key:'shock',label:'外部冲击',hint:'统一冲击指标，正值增加状态输入',min:-20,max:20,step:1,color:'#7c8c9b' },input.shock,'shock');
  $('#parameter-groups').innerHTML = PARAMETER_GROUPS.map(group => `<details id="parameters-${group.id}" ${openGroups.has(`parameters-${group.id}`) || (first && group.id === 'weights') ? 'open' : ''}>
    <summary>${group.title}<small>${group.fields.length} 个参数</small></summary><div class="parameter-inner"><p class="caption">${group.hint}</p><div class="parameter-controls">${group.fields.map(f => control(f,parameters[f.key],'parameters')).join('')}</div></div></details>`).join('');
  fillRanges();
}

function fillRanges() {
  document.querySelectorAll('input[type=range]').forEach(el => el.style.setProperty('--value',`${100*(Number(el.value)-Number(el.min))/(Number(el.max)-Number(el.min))}%`));
}
function updateDraftStatus() {
  $('#draft-status').hidden = invalid.size === 0;
  $('#draft-status').textContent = `${invalid.size} 个输入待修正，图表使用各字段最近一次有效值。`;
  $('#pin-button').disabled = invalid.size > 0;
}
function clearDrafts() { invalid.clear(); parameterDrafts = {}; updateDraftStatus(); }
function announce(text) { $('#operation-status').textContent = text; }
function table(headings, rows) {
  return `<div class="table-scroll"><table><thead><tr>${headings.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map((v,i)=>`<td${i ? ' class="numeric"' : ''}>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function renderSummary(c) {
  const a = c.current[0].dashboard, b = c.baseline[0].dashboard;
  for (const [name,key,target] of [['net','net','net-value'],['utility','utilityTotal','utility-total'],['cost','costTotal','cost-total']]) {
    $(`#${target}`).textContent = fmt(a[key]);
    $(`#${name}-reference`).textContent = `基准 ${fmt(b[key])}`;
    $(`#${name}-delta`).textContent = `Δ ${deltaText(a[key]-b[key])}`;
  }
  const time = a.constraints.time.use;
  $('#time-summary').textContent = time > 100 ? `时间合计 ${fmt(time)}%，超出总量 ${fmt(time-100)} 个百分点。` : `时间合计 ${fmt(time)}%，未分配 ${fmt(100-time)}%。`;
  $('#time-summary').className = `input-note${time>100?' over':''}`;
}

function renderRadar(c) {
  const period = radarMode === 'initial' ? 0 : weeks;
  const a = getRadarValues(c.current[period].state), b = getRadarValues(c.baseline[period].state);
  const polygon = values => values.map((v,i)=>radarPoint(i,v).join(',')).join(' ');
  const grid = [25,50,75,100].map(v=>`<polygon points="${polygon(Array(6).fill(v))}" class="radar-grid" />`).join('');
  const axes = SYSTEMS.map((s,i)=>{
    const [x,y]=radarPoint(i,100),[lx,ly]=radarPoint(i,100,157);
    return `<line x1="200" y1="176" x2="${x}" y2="${y}" class="radar-axis"/><text x="${lx}" y="${ly}" class="radar-label">${s.label}</text>`;
  }).join('');
  $('#radar-chart').innerHTML = `<title>${period ? `第 ${weeks} 周假设状态` : '初始状态'}对照</title>${grid}${axes}<polygon points="${polygon(b)}" class="radar-reference"/><polygon points="${polygon(a)}" class="radar-data"/>${a.map((v,i)=>{const [x,y]=radarPoint(i,v);return `<circle cx="${x}" cy="${y}" r="3.5" fill="#21776b"/>`;}).join('')}`;
  $('#radar-values').innerHTML = SYSTEMS.map((s,i)=>`<div class="radar-value"><span>${s.label}</span><b>${fmt(a[i],1)}</b><small>基准 ${fmt(b[i],1)} · Δ ${deltaText(a[i]-b[i])}</small></div>`).join('');
  $('#radar-final-label').textContent = `第 ${weeks} 周`;
  $('#radar-period').textContent = `${period ? `第 ${weeks} 周假设状态` : '初始状态'} · 0–100`;
}

function renderConstraints(c) {
  const a=c.current[0].dashboard,b=c.baseline[0].dashboard;
  $('#constraint-list').innerHTML = Object.entries(a.constraints).filter(([key])=>key!=='details').map(([key,v])=>{
    const level=a.levels[key], ref=b.constraints[key], max=Math.max(v.use,v.hard,v.soft,1)*1.12;
    return `<article class="constraint-item ${level}"><div><b>${v.label}</b><span>${fmt(v.use,1)} / 硬线 ${fmt(v.hard,1)} ${v.unit}</span></div>
      <div class="constraint-track"><em style="width:${100*v.use/max}%"></em><u title="软阈值" style="left:${100*v.soft/max}%"></u><u class="hard-line" title="硬线" style="left:${100*v.hard/max}%"></u></div>
      <small>${STATUS_LABELS[level]} · 软线 ${fmt(v.soft,1)} · 基准：${fmt(ref.use,1)} / 硬线 ${fmt(ref.hard,1)}，${STATUS_LABELS[b.levels[key]]}</small></article>`;
  }).join('');
  const levels=Object.values(a.levels),level=levels.includes('hard')?'hard':levels.includes('soft')?'soft':'safe';
  $('#constraint-status').className=`status-pill ${level}`;
  $('#constraint-status').textContent=STATUS_LABELS[level];
}

function renderComponents(c) {
  const a=c.current[0].dashboard,b=c.baseline[0].dashboard;
  const bars=(values, refs, names, cost=false)=>Object.entries(values).map(([key,value])=>{
    const max=cost?Math.max(1,...Object.values(values),...Object.values(refs)):100;
    return `<div class="metric-row"><div><span>${names[key]}</span><b>${fmt(value)} / ${fmt(refs[key])}</b></div><i class="metric-track${cost?' cost':''}"><em style="width:${clamp(value/max*100)}%"></em><u style="left:${clamp(refs[key]/max*100)}%"></u></i></div>`;
  }).join('');
  $('#utility-bars').innerHTML=bars(a.utility,b.utility,utilityNames);
  $('#cost-bars').innerHTML=bars(a.costs,b.costs,costNames,true);
}

function renderForecast(c) {
  const grid=[0,25,50,75,100].map(v=>`<line x1="20" x2="560" y1="${184-v*1.7}" y2="${184-v*1.7}"/><text x="2" y="${188-v*1.7}">${v}</text>`).join('');
  const lines = (frames, baseline=false)=>SYSTEMS.map((s,i)=>`<path class="forecast-path${baseline?' forecast-baseline':''}" d="${linePath(frames.map(f=>getRadarValues(f.state)[i]),weeks)}" stroke="${s.color}"/>`).join('');
  $('#forecast-chart').innerHTML=`<svg viewBox="0 0 580 215" role="img" aria-label="${weeks} 周假设推演，实验组实线与基准虚线"><g class="forecast-grid">${grid}</g>${lines(c.baseline,true)}${lines(c.current)}<text class="forecast-axis" x="20" y="207">初始</text><text class="forecast-axis" x="520" y="207">第 ${weeks} 周</text></svg>`;
  $('#forecast-legend').innerHTML=SYSTEMS.map(s=>`<span><i style="background:${s.color}"></i>${s.label}</span>`).join('');
  $('#forecast-title').textContent=`第 ${weeks} 周模型净值`;
  $('#forecast-net').textContent=fmt(c.current[weeks].dashboard.net);
  $('#forecast-comparison').textContent=`基准 ${fmt(c.baseline[weeks].dashboard.net)} · Δ ${deltaText(c.finalDelta.net)}`;
  const count=frames=>frames.slice(1).filter(f=>Object.values(f.dashboard.levels).includes('hard')).length;
  $('#forecast-boundaries').textContent=`硬线越界周数：实验组 ${count(c.current)} / ${weeks}，基准 ${count(c.baseline)} / ${weeks}。`;
}

function renderChanges(c) {
  $('#change-count').textContent=`${c.changes.length} 项改动`;
  $('#changes-list').innerHTML=c.changes.length?table(['变量 / 参数','基准','实验组','差值'],c.changes.map(d=>[`${groupNames[d.group]} · ${d.label}`,fmt(d.baseline),fmt(d.current),deltaText(d.current-d.baseline)])):'<p class="empty-state">两组输入与参数一致。调整任意一项后，这里会记录差值。</p>';
}

function renderCalculations(c) {
  const { input,parameters:p }=experiment.current;
  const d=c.current[0].dashboard, s=input.state,a=input.actions;
  const weights=Object.entries(d.utility).map(([key,value])=>[utilityNames[key],fmt(value),fmt(p[WEIGHT_KEYS[key]]),fmt(p[WEIGHT_KEYS[key]]/d.weightTotal*100)+'%',fmt(value*p[WEIGHT_KEYS[key]]/d.weightTotal)]);
  const costBases={emotion:'max(0, 情绪负荷 − 0.73 × 调节容量) × [1 + (100 − Emo) / 100]',risk:'max(0, 风险暴露 − 风险软线)² / 10',desire:'max(0, 期望品质 − 可持续品质) × 身份依赖',health:'max(0, 能量消耗 − 能量软线)² / 10',budget:'max(0, 预算压力 − 预算软线)'};
  $('#calculation-detail').innerHTML=`<p class="formula">U = Σ(分项值 × 权重) / Σ权重 = ${fmt(d.utilityTotal)}<br>Cost = 四类系统成本 + 预算扩展项 = ${fmt(d.costTotal)}<br>Net = ${fmt(d.utilityTotal)} − ${fmt(d.costTotal)} = ${fmt(d.net)}</p>${table(['效用','分项值','权重','归一占比','加权贡献'],weights)}<h3 style="margin-top:22px">成本的计算基数</h3>${table(['成本项','基数','系数','结果'],Object.entries(d.costBreakdown).map(([key,t])=>[costNames[key],fmt(t.base),fmt(t.rate),fmt(t.base*t.rate)]))}<div class="formula-list">${Object.entries(costBases).map(([key,formula])=>`<p class="formula-note"><b>${costNames[key]}</b>：${formula}</p>`).join('')}</div><p class="formula-note">期望品质 = 0.5 × 比较压力 + 0.35 × 消费 + 0.15 × 风险暴露；可持续品质 = 0.72 × Fin + 0.15 × 工作 + 8；身份依赖 = 0.35 + 0.65 × 比较压力 / 100。情绪成本在本版中以负荷和调节能力作聚合近似。</p><details><summary>效用分项与欲望身份雷达值</summary><div class="formula">安全 = clip(0.52 Fin + 0.20 B + 0.16 Soc + 0.12 预算余量)<br>自主 = clip(0.38 Fin + 0.22 Cog + 0.20 Emo + 0.20 (100 − min(100, 时间合计)))<br>品质 = clip(0.36 B + 0.20 Fin + 0.22 消费 + 0.22 休息)<br>关系 = clip(0.58 Soc + 0.23 Emo + 0.19 关系投入)<br>成长 = clip(0.46 Cog + 0.28 学习 + 0.16 工作 + 0.10 投资)<br>意义 = clip(0.42 价值匹配 + 0.23 Soc + 0.18 Cog + 0.17 关系投入)<br>欲望身份雷达值 = clip(0.65 价值匹配 + 0.35 (100 − 比较压力))<br>预算余量 = clip(100 − 预算压力)；clip 将结果限定在 0–100。</div></details>`;

  const q=d.constraints, v=q.details;
  $('#constraint-detail').innerHTML=`<div class="formula-list">
    <article><h3>时间分配</h3><div class="formula">工作 + 学习 + 休息 + 关系 + 消费活动 = ${fmt(q.time.use)}%<br>软线 ${fmt(q.time.soft)}%；硬线 100%。</div></article>
    <article><h3>风险容量</h3><div class="formula">clip((0.40 Fin + 0.20 Cog + 0.18 B + 0.12 Soc + 6) × ${fmt(p.riskScale)}) = ${fmt(v.riskCapacity)}<br>软线 = 容量 × ${fmt(p.riskSoftRatio)} = ${fmt(q.risk.soft)}；硬线 = 容量。</div></article>
    <article><h3>能量消耗与恢复</h3><div class="formula">消耗 = 0.82 工作 + 0.48 学习 + 0.26 关系 + 0.20 消费 = ${fmt(q.energy.use)}<br>恢复容量 = clip(0.48 B + 0.75 休息 + 8) = ${fmt(v.recoveryCapacity)}<br>软线 = 恢复容量 × ${fmt(p.energySoftRatio)} = ${fmt(q.energy.soft)}；硬线 = clip(恢复容量 + ${fmt(p.energyHardBuffer)}) = ${fmt(q.energy.hard)}。</div></article>
    <article><h3>情绪负荷与调节</h3><div class="formula">负荷 = 0.47 工作 + 0.22 学习 + 0.30 风险 + 0.18 消费 = ${fmt(q.emotion.use)}<br>调节容量 = clip(0.58 Emo + 0.18 Soc + 0.18 休息 + 5) = ${fmt(v.regulationCapacity)}<br>软线 = 调节容量 × ${fmt(p.emotionSoftRatio)} = ${fmt(q.emotion.soft)}；硬线 = clip(调节容量 + ${fmt(p.emotionHardBuffer)}) = ${fmt(q.emotion.hard)}。</div></article>
    <article><h3>预算压力</h3><div class="formula">max(0, 0.52 消费 + 0.24 投资 + 0.31 风险 − 0.48 Fin) = ${fmt(q.budget.use)}<br>软线 ${fmt(q.budget.soft)}；硬线 ${fmt(q.budget.hard)}。该项使用无量纲压力指标。</div></article>
  </div><p class="formula-note">严格大于硬线记为“超过硬线”；否则，严格大于软线记为“超过软阈值”。其余记为“阈值内”。</p>`;

  const first=c.current[1].state;
  const formulas=[
    ['body','身体 B',`0.985 B + ${fmt(p.bodyRestGain)} 休息 − 0.11 工作 − 0.08 能量超额 + 0.11 ε`],
    ['cognitive','认知 Cog',`0.992 Cog + ${fmt(p.cognitionLearnGain)} 学习 + 0.04 工作 − 0.05 情绪超额 + 0.03 ε`],
    ['emotion','情绪 Emo','0.988 Emo + 0.12 休息 + 0.08 关系 − 0.09 情绪超额 − 0.06 风险超额 + 0.08 ε'],
    ['social','关系 Soc','0.991 Soc + 0.17 关系投入 + 0.03 工作 − 0.05 时间超额 + 0.04 ε'],
    ['finance','金融 Fin',`0.996 Fin + ${fmt(p.financeWorkGain)} 工作 + 0.07 投资 − 0.10 消费 − 0.12 风险超额 + 0.09 ε`],
    ['desireAlign','欲望价值匹配','0.994 价值匹配 + 0.06 关系 + 0.05 休息 + 0.04 学习 − 0.04 时间超额'],
    ['desirePressure','比较与身份压力','0.990 比较压力 + 0.11 消费 + 0.08 风险超额 − 0.07 关系 − 0.05 休息 − 0.05 ε']
  ];
  $('#transition-detail').innerHTML=`<p class="formula-note">每条转移式计算后执行 clip(0,100)。超额指 max(0, 用量 − 软阈值)。第 k 周的 ε = 初始冲击 × ${fmt(p.shockRetention)}^(k−1)；第一周 ε = ${fmt(input.shock)}。</p>${formulas.map(([key,label,f])=>`<article><h3>${label}</h3><p class="formula">下一周 = clip(${f})<br>当前 ${fmt(s[key])} → 第一周 ${fmt(first[key])}</p></article>`).join('')}<p class="formula-note">初始行动：工作 ${fmt(a.work)}，学习 ${fmt(a.learn)}，休息 ${fmt(a.rest)}，关系 ${fmt(a.relation)}，消费 ${fmt(a.consume)}，投资 ${fmt(a.invest)}，风险 ${fmt(a.risk)}。</p>`;
}

function render() {
  const comparison=compareExperiment(experiment,weeks);
  renderSummary(comparison);renderRadar(comparison);renderConstraints(comparison);renderComponents(comparison);renderForecast(comparison);renderChanges(comparison);renderCalculations(comparison);
  document.querySelectorAll('[data-weeks]').forEach(el=>{const active=Number(el.dataset.weeks)===weeks;el.classList.toggle('active',active);el.setAttribute('aria-pressed',String(active));});
  document.querySelectorAll('[data-radar]').forEach(el=>{const active=el.dataset.radar===radarMode;el.classList.toggle('active',active);el.setAttribute('aria-pressed',String(active));});
}

document.addEventListener('input',event=>{
  const el=event.target,{group,key}=el.dataset;
  if (!group || !key) return;
  const id=`${group}-${key}`;
  const value=el.value.trim()===''?NaN:Number(el.value);
  if (group === 'parameters') {
    const result = changeParameterDraft(experiment, parameterDrafts, key, value);
    experiment = result.experiment; parameterDrafts = result.drafts;
    // Show a rejected slider draft in the number field; the slider keeps its valid position.
    if (el.type === 'range') $(`#${id}-number`).value = el.value;
    for (const field of PARAMETER_FIELDS) {
      const fieldId = `parameters-${field.key}`;
      const number = $(`#${fieldId}-number`), range = $(`#${fieldId}-range`);
      const error = result.errors[field.key];
      number.setAttribute('aria-invalid', String(Boolean(error)));
      $(`#${fieldId}-error`).textContent = error || '';
      if (error) invalid.set(fieldId, error);
      else {
        invalid.delete(fieldId);
        if (number !== el) number.value = experiment.current.parameters[field.key];
      }
      range.value = experiment.current.parameters[field.key];
    }
    fillRanges();updateDraftStatus();render();return;
  }
  const result=changeExperiment(experiment,group,key,value);
  const number=$(`#${id}-number`),range=$(`#${id}-range`),error=$(`#${id}-error`);
  if (!result.valid) {
    invalid.set(id,result.error);number.setAttribute('aria-invalid','true');error.textContent=result.error;updateDraftStatus();return;
  }
  experiment=result.experiment;
  invalid.delete(id);number.setAttribute('aria-invalid','false');error.textContent='';
  if(el!==number) number.value=value;
  if(el!==range) range.value=value;
  fillRanges();updateDraftStatus();render();
});

$('#pin-button').addEventListener('click',()=>{
  if(invalid.size) return;
  experiment=captureBaseline(experiment);baselineNumber+=1;$('#baseline-label').textContent=`已固定实验基准 ${baselineNumber}`;render();announce('当前输入与参数已设为基准，后续改动只更新实验组。');
});
$('#restore-button').addEventListener('click',()=>{experiment=restoreBaseline(experiment);clearDrafts();renderControls();render();announce('已恢复基准输入与参数，当前推演周期保持不变。');});
$('#reset-button').addEventListener('click',()=>{experiment=resetExperiment(experiment);clearDrafts();renderControls();render();announce('实验组已恢复默认输入与参数，固定基准保持不变。');});
$('#reset-parameters-button').addEventListener('click',()=>{experiment={...experiment,current:{...experiment.current,parameters:{...DEFAULT_PARAMETERS}}};clearDrafts();renderControls();render();announce('参数已恢复默认，初始状态、行动和固定基准保持不变。');});
document.querySelectorAll('[data-weeks]').forEach(el=>el.addEventListener('click',()=>{weeks=Number(el.dataset.weeks);render();announce(`两组均已切换为 ${weeks} 周推演。`);}));
document.querySelectorAll('[data-radar]').forEach(el=>el.addEventListener('click',()=>{radarMode=el.dataset.radar;render();}));

renderControls();render();$('#boot-message').hidden=true;
