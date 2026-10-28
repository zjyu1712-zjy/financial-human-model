import { DEFAULT_PARAMETERS, WEIGHT_KEYS, resolveParameters } from './parameters.js';
export { DEFAULT_PARAMETERS } from './parameters.js';
export const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));

export const SYSTEMS = [
  { key: "body", label: "身体-能量", symbol: "Bₜ", color: "#44b7a8" },
  { key: "cognitive", label: "认知-判断", symbol: "Cogₜ", color: "#588bf5" },
  { key: "emotion", label: "情绪-动机", symbol: "Emoₜ", color: "#be83eb" },
  { key: "social", label: "社会-关系", symbol: "Socₜ", color: "#f6a75c" },
  { key: "finance", label: "金融-资源", symbol: "Finₜ", color: "#49a3cf" },
  { key: "desire", label: "欲望-身份", symbol: "Desₜ", color: "#df718c" }
];

export const STATE_FIELDS = [
  { key: "body", label: "身体-能量", hint: "睡眠、恢复、精力、健康", color: "#44b7a8" },
  { key: "cognitive", label: "认知-判断", hint: "知识、概率判断、复盘能力", color: "#588bf5" },
  { key: "emotion", label: "情绪-动机", hint: "稳定、延迟满足、恢复", color: "#be83eb" },
  { key: "social", label: "社会-关系", hint: "支持、信任、机会、边界", color: "#f6a75c" },
  { key: "finance", label: "金融-资源", hint: "现金流、缓冲、债务、选择权", color: "#49a3cf" },
  { key: "desireAlign", label: "欲望的价值匹配", hint: "想要的生活是否清晰且可持续", color: "#df718c" },
  { key: "desirePressure", label: "比较与身份压力", hint: "外部比较、地位关注与目标变化的强度", color: "#f05d79", inverted: true }
];

export const ACTION_FIELDS = [
  { key: "work", label: "工作", hint: "职业与生产投入", color: "#6d8ef7", time: true },
  { key: "learn", label: "学习", hint: "技能与认知投资", color: "#8b72e8", time: true },
  { key: "rest", label: "休息", hint: "睡眠、运动、恢复", color: "#44b7a8", time: true },
  { key: "relation", label: "关系", hint: "亲密、朋友、合作", color: "#f6a75c", time: true },
  { key: "consume", label: "消费活动", hint: "生活品质与体验", color: "#df718c", time: true },
  { key: "invest", label: "投资", hint: "金融、人力或项目投资", color: "#49a3cf", time: false },
  { key: "risk", label: "风险暴露", hint: "主动承担的不确定性", color: "#ee6c71", time: false }
];

export const DEFAULT_INPUT = {
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

export function desireHealth(state) {
  return clamp(0.65 * state.desireAlign + 0.35 * (100 - state.desirePressure));
}

export function getRadarValues(state) {
  return [
    state.body,
    state.cognitive,
    state.emotion,
    state.social,
    state.finance,
    desireHealth(state)
  ];
}

export function calculateConstraints(state, actions, parameters = DEFAULT_PARAMETERS) {
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

export function constraintLevel(constraint) {
  if (constraint.use > constraint.hard) return "hard";
  if (constraint.use > constraint.soft) return "soft";
  return "safe";
}

export function calculateCostBreakdown(state, actions, constraints, parameters = DEFAULT_PARAMETERS) {
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

export function calculateCosts(state, actions, constraints, parameters = DEFAULT_PARAMETERS) {
  return Object.fromEntries(Object.entries(calculateCostBreakdown(state, actions, constraints, parameters)).map(([key, term]) => [key, term.base * term.rate]));
}

export function calculateUtility(state, actions, constraints = calculateConstraints(state, actions)) {
  const safety = clamp(0.52 * state.finance + 0.2 * state.body + 0.16 * state.social + 0.12 * constraints.details.budgetRoom);
  const autonomy = clamp(0.38 * state.finance + 0.22 * state.cognitive + 0.2 * state.emotion + 0.2 * (100 - Math.min(100, constraints.time.use)));
  const quality = clamp(0.36 * state.body + 0.2 * state.finance + 0.22 * actions.consume + 0.22 * actions.rest);
  const relation = clamp(0.58 * state.social + 0.23 * state.emotion + 0.19 * actions.relation);
  const growth = clamp(0.46 * state.cognitive + 0.28 * actions.learn + 0.16 * actions.work + 0.1 * actions.invest);
  const meaning = clamp(0.42 * state.desireAlign + 0.23 * state.social + 0.18 * state.cognitive + 0.17 * actions.relation);

  return { safety, autonomy, quality, relation, growth, meaning };
}

export function calculateDashboard(state, actions, parameters = DEFAULT_PARAMETERS) {
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

export function simulate(state, actions, shock = 0, weeks = 4, parameters = DEFAULT_PARAMETERS) {
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

export function bottleneck(state, dashboard = calculateDashboard(state, DEFAULT_INPUT.actions)) {
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
