const field = (key, label, value, min, max, step, hint) => ({ key, label, value, min, max, step, hint });

export const PARAMETER_GROUPS = [
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

export const PARAMETER_FIELDS = PARAMETER_GROUPS.flatMap(group => group.fields);
export const DEFAULT_PARAMETERS = Object.freeze(Object.fromEntries(PARAMETER_FIELDS.map(f => [f.key, f.value])));
export const WEIGHT_KEYS = { safety: 'wSafety', autonomy: 'wAutonomy', quality: 'wQuality', relation: 'wRelation', growth: 'wGrowth', meaning: 'wMeaning' };

export function validateParameters(overrides = {}) {
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

export function resolveParameters(overrides) {
  const result = validateParameters(overrides);
  if (!result.valid) throw new RangeError(Object.values(result.errors).join('；'));
  return result.values;
}
