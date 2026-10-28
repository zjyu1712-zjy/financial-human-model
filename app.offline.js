// Generated from src/*.js by scripts/build-offline.mjs
(() => {
'use strict';
const __modules = Object.create(null);
__modules["parameters"] = (() => {
const field = (key, label, value, min, max, step, hint) => ({ key, label, value, min, max, step, hint });

const PARAMETER_GROUPS = [
  { id: 'weights', title: '效用权重', hint: '六项权重自动归一化；改变净值的组成。', fields: [
    field('wSafety', '安全', 1, 0, 5, 0.1, '安全效用的相对权重'),
    field('wAutonomy', '自主', 1, 0, 5, 0.1, '自主效用的相对权重'),
    field('wQuality', '品质', 1, 0, 5, 0.1, '品质效用的相对权重'),
    field('wRelation', '关系', 1, 0, 5, 0.1, '关系效用的相对权重'),
    field('wGrowth', '成长', 1, 0, 5, 0.1, '成长效用的相对权重'),
    field('wMeaning', '意义', 1, 0, 5, 0.1, '意义效用的相对权重')
  ] },
  { id: 'costs', title: '成本系数', hint: '系数乘以各项损失基数；预算项沿用原型的扩展口径。', fields: [
    field('emotionRate', '情绪功能损失', 0.18, 0, 2, 0.01, '负荷与调节的简化计算'),
    field('riskRate', '风险超限', 0.12, 0, 2, 0.01, '软阈值超额的平方 / 10'),
    field('desireRate', '欲望错配', 0.16, 0, 2, 0.01, '品质缺口 × 身份依赖'),
    field('healthRate', '健康透支', 0.12, 0, 2, 0.01, '能量软阈值超额的平方 / 10'),
    field('budgetRate', '预算压力 · 扩展项', 0.08, 0, 2, 0.01, '预算软阈值以上的压力')
  ] },
  { id: 'limits', title: '约束参数', hint: '软阈值标记成本区间，硬线标记当前设定下的越界。', fields: [
    field('timeSoft', '时间软阈值', 100, 0, 100, 1, '总时间硬线固定为 100%'),
    field('riskScale', '风险容量倍率', 1, 0, 2, 0.05, '基础风险容量 × 倍率，上限 100'),
    field('riskSoftRatio', '风险软线比例', 0.72, 0, 1, 0.01, '风险硬线 × 比例'),
    field('energySoftRatio', '能量软线比例', 0.9, 0, 1, 0.01, '恢复容量 × 比例'),
    field('energyHardBuffer', '能量硬线余量', 12, 0, 40, 1, '恢复容量 + 余量，上限 100'),
    field('emotionSoftRatio', '情绪软线比例', 0.82, 0, 1, 0.01, '调节容量 × 比例'),
    field('emotionHardBuffer', '情绪硬线余量', 10, 0, 40, 1, '调节容量 + 余量，上限 100'),
    field('budgetSoft', '预算压力软线', 55, 0, 150, 1, '预算压力指标的软阈值'),
    field('budgetHard', '预算压力硬线', 100, 0, 150, 1, '不低于预算软线')
  ] },
  { id: 'dynamics', title: '状态转移', hint: '控制投入如何进入下一周；其余转移系数保持原型设定。', fields: [
    field('bodyRestGain', '休息 → 身体', 0.19, 0, 1, 0.01, '每份休息带来的身体状态增量'),
    field('cognitionLearnGain', '学习 → 认知', 0.16, 0, 1, 0.01, '每份学习带来的认知状态增量'),
    field('financeWorkGain', '工作 → 金融资源', 0.15, 0, 1, 0.01, '每份工作带来的金融状态增量'),
    field('shockRetention', '外部冲击留存率', 0.72, 0, 1, 0.01, '每过一周，冲击保留的比例')
  ] }
];

const PARAMETER_FIELDS = PARAMETER_GROUPS.flatMap(group => group.fields);
const DEFAULT_PARAMETERS = Object.freeze(Object.fromEntries(PARAMETER_FIELDS.map(f => [f.key, f.value])));
const WEIGHT_KEYS = { safety: 'wSafety', autonomy: 'wAutonomy', quality: 'wQuality', relation: 'wRelation', growth: 'wGrowth', meaning: 'wMeaning' };

function validateParameters(overrides = {}) {
  const values = { ...DEFAULT_PARAMETERS, ...overrides };
  const errors = {};
  for (const key of Object.keys(overrides)) {
    if (!Object.hasOwn(DEFAULT_PARAMETERS, key)) errors[key] = `未知参数 ${key}`;
  }
  for (const f of PARAMETER_FIELDS) {
    if (!Number.isFinite(values[f.key]) || values[f.key] < f.min || values[f.key] > f.max) {
      errors[f.key] = `${f.label}（${f.key}）需在 ${f.min}–${f.max} 之间`;
    }
  }
  if (Object.values(WEIGHT_KEYS).every(key => values[key] === 0)) errors.weights = '至少保留一项大于 0 的效用权重';
  if (values.budgetSoft > values.budgetHard) errors.budgetHard = '预算硬线需大于或等于软线';
  return { valid: Object.keys(errors).length === 0, errors, values };
}

function resolveParameters(overrides) {
  const result = validateParameters(overrides);
  if (!result.valid) throw new RangeError(Object.values(result.errors).join('；'));
  return result.values;
}

return { PARAMETER_GROUPS, PARAMETER_FIELDS, DEFAULT_PARAMETERS, WEIGHT_KEYS, validateParameters, resolveParameters };
})();
__modules["model"] = (() => {
const { DEFAULT_PARAMETERS, WEIGHT_KEYS, resolveParameters } = __modules["parameters"];

const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));

const SYSTEMS = [
  { key: "body", label: "身体-能量", symbol: "Bₜ", color: "#44b7a8" },
  { key: "cognitive", label: "认知-判断", symbol: "Cogₜ", color: "#588bf5" },
  { key: "emotion", label: "情绪-动机", symbol: "Emoₜ", color: "#be83eb" },
  { key: "social", label: "社会-关系", symbol: "Socₜ", color: "#f6a75c" },
  { key: "finance", label: "金融-资源", symbol: "Finₜ", color: "#49a3cf" },
  { key: "desire", label: "欲望-身份", symbol: "Desₜ", color: "#df718c" }
];

const STATE_FIELDS = [
  { key: "body", label: "身体-能量", hint: "睡眠、恢复、精力、健康", color: "#44b7a8" },
  { key: "cognitive", label: "认知-判断", hint: "知识、概率判断、复盘能力", color: "#588bf5" },
  { key: "emotion", label: "情绪-动机", hint: "稳定、延迟满足、恢复", color: "#be83eb" },
  { key: "social", label: "社会-关系", hint: "支持、信任、机会、边界", color: "#f6a75c" },
  { key: "finance", label: "金融-资源", hint: "现金流、缓冲、债务、选择权", color: "#49a3cf" },
  { key: "desireAlign", label: "欲望的价值匹配", hint: "想要的生活是否清晰且可持续", color: "#df718c" },
  { key: "desirePressure", label: "比较与身份压力", hint: "外部比较、地位关注与目标变化的强度", color: "#f05d79", inverted: true }
];

const ACTION_FIELDS = [
  { key: "work", label: "工作", hint: "职业与生产投入", color: "#6d8ef7", time: true },
  { key: "learn", label: "学习", hint: "技能与认知投资", color: "#8b72e8", time: true },
  { key: "rest", label: "休息", hint: "睡眠、运动、恢复", color: "#44b7a8", time: true },
  { key: "relation", label: "关系", hint: "亲密、朋友、合作", color: "#f6a75c", time: true },
  { key: "consume", label: "消费活动", hint: "生活品质与体验", color: "#df718c", time: true },
  { key: "invest", label: "投资", hint: "金融、人力或项目投资", color: "#49a3cf", time: false },
  { key: "risk", label: "风险暴露", hint: "主动承担的不确定性", color: "#ee6c71", time: false }
];

const DEFAULT_INPUT = {
  state: {
    body: 65,
    cognitive: 70,
    emotion: 58,
    social: 62,
    finance: 55,
    desireAlign: 60,
    desirePressure: 45
  },
  actions: {
    work: 38,
    learn: 15,
    rest: 27,
    relation: 13,
    consume: 7,
    invest: 45,
    risk: 38
  },
  shock: 0
};

const sum = (values) => values.reduce((total, value) => total + value, 0);

function desireHealth(state) {
  return clamp(0.65 * state.desireAlign + 0.35 * (100 - state.desirePressure));
}

function getRadarValues(state) {
  return [
    state.body,
    state.cognitive,
    state.emotion,
    state.social,
    state.finance,
    desireHealth(state)
  ];
}

function calculateConstraints(state, actions, parameters = DEFAULT_PARAMETERS) {
  const p = resolveParameters(parameters);
  const timeUse = sum([actions.work, actions.learn, actions.rest, actions.relation, actions.consume]);
  const riskCapacity = clamp(
    (0.4 * state.finance + 0.2 * state.cognitive + 0.18 * state.body + 0.12 * state.social + 6) * p.riskScale
  );
  const softRiskCap = clamp(riskCapacity * p.riskSoftRatio);
  const hardRiskCap = clamp(riskCapacity);

  const energyConsumption = 0.82 * actions.work + 0.48 * actions.learn + 0.26 * actions.relation + 0.2 * actions.consume;
  const recoveryCapacity = clamp(0.48 * state.body + 0.75 * actions.rest + 8);
  const softEnergyCap = clamp(recoveryCapacity * p.energySoftRatio);
  const hardEnergyCap = clamp(recoveryCapacity + p.energyHardBuffer);

  const emotionLoad = 0.47 * actions.work + 0.22 * actions.learn + 0.3 * actions.risk + 0.18 * actions.consume;
  const regulationCapacity = clamp(0.58 * state.emotion + 0.18 * state.social + 0.18 * actions.rest + 5);
  const softEmotionCap = clamp(regulationCapacity * p.emotionSoftRatio);
  const hardEmotionCap = clamp(regulationCapacity + p.emotionHardBuffer);

  const budgetPressure = Math.max(0,
    0.52 * actions.consume + 0.24 * actions.invest + 0.31 * actions.risk - 0.48 * state.finance
  );
  const budgetRoom = clamp(100 - budgetPressure);

  return {
    time: { label: "时间分配", use: timeUse, soft: p.timeSoft, hard: 100, unit: "%" },
    risk: { label: "风险暴露", use: actions.risk, soft: softRiskCap, hard: hardRiskCap, unit: "点" },
    energy: { label: "能量消耗", use: energyConsumption, soft: softEnergyCap, hard: hardEnergyCap, unit: "点" },
    emotion: { label: "情绪负荷", use: emotionLoad, soft: softEmotionCap, hard: hardEmotionCap, unit: "点" },
    budget: { label: "预算压力", use: budgetPressure, soft: p.budgetSoft, hard: p.budgetHard, unit: "点" },
    details: { riskCapacity, recoveryCapacity, regulationCapacity, budgetRoom }
  };
}

function constraintLevel(constraint) {
  if (constraint.use > constraint.hard) return "hard";
  if (constraint.use > constraint.soft) return "soft";
  return "safe";
}

function calculateCostBreakdown(state, actions, constraints, parameters = DEFAULT_PARAMETERS) {
  const p = resolveParameters(parameters);
  constraints ??= calculateConstraints(state, actions, p);
  const { emotion, risk, energy, budget, details } = constraints;
  const rawEmotionLoss = Math.max(0, emotion.use - 0.5 * details.regulationCapacity);
  const dysregulation = (100 - state.emotion) / 100;
  const emotionBase = Math.max(0, rawEmotionLoss - details.regulationCapacity * 0.23) * (1 + dysregulation);
  const riskBase = Math.pow(Math.max(0, risk.use - risk.soft), 2) / 10;

  const desiredQuality = 0.5 * state.desirePressure + 0.35 * actions.consume + 0.15 * actions.risk;
  const sustainableQuality = 0.72 * state.finance + 0.15 * actions.work + 8;
  const identityDependence = 0.35 + 0.65 * (state.desirePressure / 100);
  const desireBase = Math.max(0, desiredQuality - sustainableQuality) * identityDependence;

  const healthBase = Math.pow(Math.max(0, energy.use - energy.soft), 2) / 10;
  const budgetBase = Math.max(0, budget.use - budget.soft);

  return {
    emotion: { base: emotionBase, rate: p.emotionRate },
    risk: { base: riskBase, rate: p.riskRate },
    desire: { base: desireBase, rate: p.desireRate },
    health: { base: healthBase, rate: p.healthRate },
    budget: { base: budgetBase, rate: p.budgetRate }
  };
}

function calculateCosts(state, actions, constraints, parameters = DEFAULT_PARAMETERS) {
  return Object.fromEntries(Object.entries(calculateCostBreakdown(state, actions, constraints, parameters)).map(([key, term]) => [key, term.base * term.rate]));
}

function calculateUtility(state, actions, constraints = calculateConstraints(state, actions)) {
  const safety = clamp(0.52 * state.finance + 0.2 * state.body + 0.16 * state.social + 0.12 * constraints.details.budgetRoom);
  const autonomy = clamp(0.38 * state.finance + 0.22 * state.cognitive + 0.2 * state.emotion + 0.2 * (100 - Math.min(100, constraints.time.use)));
  const quality = clamp(0.36 * state.body + 0.2 * state.finance + 0.22 * actions.consume + 0.22 * actions.rest);
  const relation = clamp(0.58 * state.social + 0.23 * state.emotion + 0.19 * actions.relation);
  const growth = clamp(0.46 * state.cognitive + 0.28 * actions.learn + 0.16 * actions.work + 0.1 * actions.invest);
  const meaning = clamp(0.42 * state.desireAlign + 0.23 * state.social + 0.18 * state.cognitive + 0.17 * actions.relation);

  return { safety, autonomy, quality, relation, growth, meaning };
}

function calculateDashboard(state, actions, parameters = DEFAULT_PARAMETERS) {
  const p = resolveParameters(parameters);
  const constraints = calculateConstraints(state, actions, p);
  const utility = calculateUtility(state, actions, constraints);
  const costBreakdown = calculateCostBreakdown(state, actions, constraints, p);
  const costs = Object.fromEntries(Object.entries(costBreakdown).map(([key, term]) => [key, term.base * term.rate]));
  const weightTotal = sum(Object.values(WEIGHT_KEYS).map(key => p[key]));
  const utilityTotal = sum(Object.entries(utility).map(([key, value]) => value * p[WEIGHT_KEYS[key]])) / weightTotal;
  const costTotal = sum(Object.values(costs));
  const net = utilityTotal - costTotal;
  const levels = Object.fromEntries(
    Object.entries(constraints)
      .filter(([key]) => key !== "details")
      .map(([key, value]) => [key, constraintLevel(value)])
  );

  return { constraints, levels, utility, costs, utilityTotal, costTotal, net, costBreakdown, weightTotal };
}

function nextState(state, actions, shock, p) {
  const dashboard = calculateDashboard(state, actions, p);
  const { constraints } = dashboard;
  const timeOverload = Math.max(0, constraints.time.use - constraints.time.soft);
  const riskOverload = Math.max(0, actions.risk - constraints.risk.soft);
  const energyOverload = Math.max(0, constraints.energy.use - constraints.energy.soft);
  const emotionOverload = Math.max(0, constraints.emotion.use - constraints.emotion.soft);

  return {
    body: clamp(state.body * 0.985 + p.bodyRestGain * actions.rest - 0.11 * actions.work - 0.08 * energyOverload + 0.11 * shock),
    cognitive: clamp(state.cognitive * 0.992 + p.cognitionLearnGain * actions.learn + 0.04 * actions.work - 0.05 * emotionOverload + 0.03 * shock),
    emotion: clamp(state.emotion * 0.988 + 0.12 * actions.rest + 0.08 * actions.relation - 0.09 * emotionOverload - 0.06 * riskOverload + 0.08 * shock),
    social: clamp(state.social * 0.991 + 0.17 * actions.relation + 0.03 * actions.work - 0.05 * timeOverload + 0.04 * shock),
    finance: clamp(state.finance * 0.996 + p.financeWorkGain * actions.work + 0.07 * actions.invest - 0.1 * actions.consume - 0.12 * riskOverload + 0.09 * shock),
    desireAlign: clamp(state.desireAlign * 0.994 + 0.06 * actions.relation + 0.05 * actions.rest + 0.04 * actions.learn - 0.04 * timeOverload),
    desirePressure: clamp(state.desirePressure * 0.99 + 0.11 * actions.consume + 0.08 * riskOverload - 0.07 * actions.relation - 0.05 * actions.rest - 0.05 * shock)
  };
}

function simulate(state, actions, shock = 0, weeks = 4, parameters = DEFAULT_PARAMETERS) {
  const p = resolveParameters(parameters);
  const frames = [{ week: 0, state: { ...state }, dashboard: calculateDashboard(state, actions, p) }];
  let current = { ...state };

  for (let week = 1; week <= weeks; week += 1) {
    const decayedShock = shock * Math.pow(p.shockRetention, week - 1);
    current = nextState(current, actions, decayedShock, p);
    frames.push({ week, state: { ...current }, dashboard: calculateDashboard(current, actions, p) });
  }

  return frames;
}

function bottleneck(state, dashboard = calculateDashboard(state, DEFAULT_INPUT.actions)) {
  const stateScores = [
    { label: "身体-能量", value: state.body, kind: "state" },
    { label: "认知-判断", value: state.cognitive, kind: "state" },
    { label: "情绪-动机", value: state.emotion, kind: "state" },
    { label: "社会-关系", value: state.social, kind: "state" },
    { label: "金融-资源", value: state.finance, kind: "state" },
    { label: "欲望-身份", value: desireHealth(state), kind: "state" }
  ];
  const hardConstraint = Object.entries(dashboard.levels).find(([, level]) => level === "hard");
  const softConstraint = Object.entries(dashboard.levels).find(([, level]) => level === "soft");
  if (hardConstraint) return { label: dashboard.constraints[hardConstraint[0]].label, kind: "hard" };
  if (softConstraint) return { label: dashboard.constraints[softConstraint[0]].label, kind: "soft" };
  return stateScores.sort((a, b) => a.value - b.value)[0];
}

return { DEFAULT_PARAMETERS, clamp, SYSTEMS, STATE_FIELDS, ACTION_FIELDS, DEFAULT_INPUT, desireHealth, getRadarValues, calculateConstraints, constraintLevel, calculateCostBreakdown, calculateCosts, calculateUtility, calculateDashboard, simulate, bottleneck };
})();
__modules["experiment"] = (() => {
const { DEFAULT_INPUT, STATE_FIELDS, ACTION_FIELDS, simulate } = __modules["model"];
const { DEFAULT_PARAMETERS, PARAMETER_FIELDS, WEIGHT_KEYS, validateParameters } = __modules["parameters"];

const copy = value => JSON.parse(JSON.stringify(value));
const defaultSnapshot = () => ({ input: copy(DEFAULT_INPUT), parameters: { ...DEFAULT_PARAMETERS } });

function createExperiment() {
  return { current: defaultSnapshot(), baseline: defaultSnapshot() };
}
function captureBaseline(experiment) {
  return { ...experiment, baseline: copy(experiment.current) };
}
function restoreBaseline(experiment) {
  return { ...experiment, current: copy(experiment.baseline) };
}
function resetExperiment(experiment) {
  return { ...experiment, current: defaultSnapshot() };
}

function changeExperiment(experiment, group, key, value) {
  const reject = error => ({ valid: false, error, experiment });
  if (!Number.isFinite(value)) return reject('填写有效数字后更新计算');
  const current = copy(experiment.current);
  if (group === 'parameters') {
    const result = validateParameters({ ...current.parameters, [key]: value });
    if (!result.valid) return reject(Object.values(result.errors).join('；'));
    current.parameters = result.values;
  } else if (group === 'state' || group === 'actions') {
    const fields = group === 'state' ? STATE_FIELDS : ACTION_FIELDS;
    if (!fields.some(f => f.key === key) || value < 0 || value > 100) return reject('变量范围为 0–100');
    current.input[group][key] = value;
  } else if (group === 'shock' && key === 'shock') {
    if (value < -20 || value > 20) return reject('外部冲击范围为 -20–20');
    current.input.shock = value;
  } else return reject('未识别的变量');
  return { valid: true, error: '', experiment: { ...experiment, current } };
}

// Reconcile related numerical drafts together while retaining valid independent edits.
function changeParameterDraft(experiment, pending, key, value) {
  const drafts = { ...pending, [key]: value };
  const before = experiment.current.parameters;
  const candidate = { ...before };
  const errors = {};
  for (const [name, number] of Object.entries(drafts)) {
    const field = PARAMETER_FIELDS.find(f => f.key === name);
    if (!field) errors[name] = '未识别的参数';
    else if (!Number.isFinite(number)) errors[name] = '填写有效数字后更新计算';
    else if (number < field.min || number > field.max) errors[name] = `${field.label}需在 ${field.min}–${field.max} 之间`;
    else candidate[name] = number;
  }
  const deferGroup = (keys, message) => {
    for (const name of keys) {
      if (Object.hasOwn(drafts, name) && candidate[name] !== before[name]) errors[name] = message;
      candidate[name] = before[name];
    }
  };
  const weights = Object.values(WEIGHT_KEYS);
  if (weights.every(name => candidate[name] === 0)) deferGroup(weights, '至少保留一项大于 0 的效用权重');
  if (candidate.budgetSoft > candidate.budgetHard) deferGroup(['budgetSoft','budgetHard'], '预算硬线需大于或等于软线');
  const remaining = Object.fromEntries(Object.entries(drafts).filter(([name]) => Object.hasOwn(errors, name)));
  return { experiment: { ...experiment, current: { ...experiment.current, parameters: candidate } }, drafts: remaining, errors };
}

function compareExperiment(experiment, weeks) {
  if (![4,12].includes(weeks)) throw new RangeError('推演周期为 4 或 12 周');
  const run = snapshot => simulate(snapshot.input.state, snapshot.input.actions, snapshot.input.shock, weeks, snapshot.parameters);
  const current = run(experiment.current);
  const baseline = run(experiment.baseline);
  const delta = (a,b) => Object.fromEntries(['utilityTotal','costTotal','net'].map(key => [key,a[key]-b[key]]));
  const changes = [];
  const add = (group, fields, a, b) => fields.forEach(f => {
    if (a[f.key] !== b[f.key]) changes.push({ group, key:f.key, label:f.label, current:a[f.key], baseline:b[f.key] });
  });
  add('state',STATE_FIELDS,experiment.current.input.state,experiment.baseline.input.state);
  add('actions',ACTION_FIELDS,experiment.current.input.actions,experiment.baseline.input.actions);
  add('parameters',PARAMETER_FIELDS,experiment.current.parameters,experiment.baseline.parameters);
  if (experiment.current.input.shock !== experiment.baseline.input.shock) changes.push({ group:'shock', key:'shock',label:'外部冲击',current:experiment.current.input.shock,baseline:experiment.baseline.input.shock });
  return { current, baseline, changes, nowDelta:delta(current[0].dashboard,baseline[0].dashboard), finalDelta:delta(current[weeks].dashboard,baseline[weeks].dashboard) };
}

return { createExperiment, captureBaseline, restoreBaseline, resetExperiment, changeExperiment, changeParameterDraft, compareExperiment };
})();
__modules["presentation"] = (() => {
const { clamp } = __modules["model"];

function formatNumber(value, digits = 2) {
  return (Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value).toFixed(digits);
}
function deltaText(value) {
  const rounded = Number(formatNumber(value));
  return `${rounded > 0 ? '+' : ''}${formatNumber(rounded)}`;
}
function radarPoint(index, value, radius = 124) {
  const angle = -Math.PI / 2 + index * Math.PI / 3;
  const distance = radius * clamp(value) / 100;
  return [200 + Math.cos(angle)*distance, 176 + Math.sin(angle)*distance];
}
function linePath(values, weeks) {
  return values.map((v,i) => `${i ? 'L' : 'M'}${(20 + i/weeks*540).toFixed(1)},${(184-clamp(v)*1.7).toFixed(1)}`).join(' ');
}
const STATUS_LABELS = { safe:'阈值内', soft:'超过软阈值', hard:'超过硬线' };

return { formatNumber, deltaText, radarPoint, linePath, STATUS_LABELS };
})();
__modules["app"] = (() => {
const { STATE_FIELDS, ACTION_FIELDS, SYSTEMS, getRadarValues, clamp } = __modules["model"];
const { PARAMETER_GROUPS, PARAMETER_FIELDS, DEFAULT_PARAMETERS, WEIGHT_KEYS } = __modules["parameters"];
const { createExperiment, changeExperiment, changeParameterDraft, captureBaseline, restoreBaseline, resetExperiment, compareExperiment } = __modules["experiment"];
const { formatNumber: fmt, deltaText, radarPoint, linePath, STATUS_LABELS } = __modules["presentation"];

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

return {  };
})();
return __modules["app"];
})();
