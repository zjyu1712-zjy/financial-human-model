import {writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {VERSION} from '../src/schema.js';
import {sleepDemo,SLEEP_CASES} from '../src/sleep-comparison.js';
const integrity={};
for(const file of ['src/schema.js','src/sleep.js','src/model.js','src/legacy-model.js','src/sleep-comparison.js']){
  integrity[file]=createHash('sha256').update(await readFile(new URL('../'+file,import.meta.url))).digest('hex');
}
const cases=Object.keys(SLEEP_CASES).flatMap(key=>['unallocated','leisure'].map(source=>({key,...sleepDemo(key,source)})));
const data={version:VERSION,status:'hypothetical-unvalidated',integrity,
  scope:'Default input scenarios, not the user personal workspace. Cash and other inputs may differ from the screenshot.',
  units:{fatigue:'self-referenced index points',sleepDebt:'unmet sleep hours in a model ledger, not physiological measurement',fatigueBurden:'index point-weeks'},
  comparison:'Each version compares its own unchanged arrangement against its adjusted arrangement.',
  sampling:'Week-end fatigue at weeks 1..52; week 0 excluded from the average and burden.',
  assumptions:['Sleep need is constant within a run','Only surplus sleep repays debt; meeting current need stops new debt','Sleep quality is held fixed, unlike legacy 1.0','Weekly aggregation cannot resolve daily timing','Parameters and nonlinear forms are not empirically fitted'],cases};
await writeFile(new URL('../qa/sleep-model-comparison.json',import.meta.url),JSON.stringify(data,null,2)+'\n');
console.log(JSON.stringify(cases.map(c=>({key:c.key,source:c.source,variants:c.variants.map(v=>({key:v.key,delta:v.delta,debtOriginal:v.original.sleepDebt,debtAdjusted:v.changed.sleepDebt}))})),null,2));
