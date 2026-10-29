import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {buildOffline} from '../scripts/build-offline.mjs';
import {DEFAULT_SCENARIO} from '../src/schema.js';
import {marginalEffects} from '../src/marginal.js';
import {boot} from './fixture.mjs';

test('offline core has identical ledger and preserves feasibility',async()=>{
  const model=vm.runInNewContext(await buildOffline('model')),r=model.simulate(DEFAULT_SCENARIO,12);
  assert.equal(r.feasible,true);assert.ok(r.frames.every(f=>Math.abs(f.ledger.identityResidual)<1e-7));
});
test('checked-in bundle is exactly reproducible',async()=>{
  assert.equal(await readFile(new URL('../app.offline.js',import.meta.url),'utf8'),await buildOffline());
});
test('offline marginal engine agrees with the source engine',async()=>{
  const offline=vm.runInNewContext(await buildOffline('marginal'));
  assert.equal(JSON.stringify(offline.marginalEffects(DEFAULT_SCENARIO)),JSON.stringify(marginalEffects(DEFAULT_SCENARIO)));
});
test('offline application starts, presets and financial failures update linked outputs',async()=>{
  const {get,edit,presets}=await boot('#decision');
  assert.match(get('summary').innerHTML,/29,810/);assert.match(get('trace').innerHTML,/账本恒等式残差/);
  const before=get('summary').innerHTML;presets[0].onclick();assert.notEqual(get('summary').innerHTML,before);
  get('restore').onclick();assert.equal(get('summary').innerHTML,before);
  edit('plan','work','168');assert.match(get('verdict').innerHTML,/不可执行/);assert.equal(get('guide-comparisons').innerHTML,'');
  get('reset').onclick();get('analyze').onclick();assert.match(get('uncertainty').innerHTML,/80种/);
  edit('plan','work','');assert.equal(get('pin').disabled,true);assert.match(get('error').textContent,/工作/);
  edit('plan','work','40');assert.equal(get('pin').disabled,false);get('save').onclick();get('load').onclick();assert.match(get('operation').textContent,/已读取/);
});
test('marginal controls preserve invalid drafts and export/import complete personal data',async()=>{
  const {get,edit,saved,blobs}=await boot('#marginal');
  assert.match(get('marginal-status').textContent,/共转入 12.00 小时/);
  get('marginal-metric').value='cash';get('marginal-metric').onchange();assert.match(get('marginal-curve').innerHTML,/手上剩的钱变化/);
  get('marginal-step').value='0';get('marginal-step').oninput();assert.equal(get('marginal-summary').innerHTML,'');
  assert.equal(saved().marginalDraft.step,'0');assert.equal(get('export').disabled,false);
  get('marginal-step').value='1';get('marginal-step').oninput();
  get('marginal-frequency').value='once';get('marginal-frequency').onchange();assert.equal(get('marginal-week').disabled,false);
  get('marginal-week').value='8';get('marginal-week').oninput();get('weeks').value='4';get('weeks').onchange();
  assert.equal(get('marginal-summary').innerHTML,'');assert.equal(saved().marginalDraft.week,'8');
  get('marginal-week').value='2';get('marginal-week').oninput();get('export').onclick();
  const exported=JSON.parse(await blobs.at(-1).text());assert.equal(exported.marginalResults.primary.totalHours,1);assert.equal(exported.experiment.weeks,4);
  get('schedule').value='{"2":{"work":0}}';get('schedule-apply').onclick();assert.match(get('marginal-verdict').textContent,/第 2 周不可行/);
  await get('import').onchange({target:{files:[{size:100,text:async()=>JSON.stringify(exported)}]}});
  assert.equal(get('marginal-week').value,'2');assert.match(get('marginal-detail').innerHTML,/第 2 周/);
  edit('plan','work','');assert.equal(get('marginal-curve').innerHTML,'');edit('plan','work','40');assert.match(get('marginal-curve').innerHTML,/每次/);
});
