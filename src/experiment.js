import { DEFAULT_INPUT, STATE_FIELDS, ACTION_FIELDS, simulate } from './model.js';
import { DEFAULT_PARAMETERS, PARAMETER_FIELDS, WEIGHT_KEYS, validateParameters } from './parameters.js';

const copy = value => JSON.parse(JSON.stringify(value));
const defaultSnapshot = () => ({ input: copy(DEFAULT_INPUT), parameters: { ...DEFAULT_PARAMETERS } });

export function createExperiment() {
  return { current: defaultSnapshot(), baseline: defaultSnapshot() };
}
export function captureBaseline(experiment) {
  return { ...experiment, baseline: copy(experiment.current) };
}
export function restoreBaseline(experiment) {
  return { ...experiment, current: copy(experiment.baseline) };
}
export function resetExperiment(experiment) {
  return { ...experiment, current: defaultSnapshot() };
}

export function changeExperiment(experiment, group, key, value) {
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
export function changeParameterDraft(experiment, pending, key, value) {
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

export function compareExperiment(experiment, weeks) {
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
