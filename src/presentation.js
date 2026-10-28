import { clamp } from './model.js';

export function formatNumber(value, digits = 2) {
  return (Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value).toFixed(digits);
}
export function deltaText(value) {
  const rounded = Number(formatNumber(value));
  return `${rounded > 0 ? '+' : ''}${formatNumber(rounded)}`;
}
export function radarPoint(index, value, radius = 124) {
  const angle = -Math.PI / 2 + index * Math.PI / 3;
  const distance = radius * clamp(value) / 100;
  return [200 + Math.cos(angle)*distance, 176 + Math.sin(angle)*distance];
}
export function linePath(values, weeks) {
  return values.map((v,i) => `${i ? 'L' : 'M'}${(20 + i/weeks*540).toFixed(1)},${(184-clamp(v)*1.7).toFixed(1)}`).join(' ');
}
export const STATUS_LABELS = { safe:'阈值内', soft:'超过软阈值', hard:'超过硬线' };
