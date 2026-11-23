import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {buildBundle,buildStandalone,inlineAssets} from '../scripts/build.mjs';

const root=new URL('../',import.meta.url);
test('portable edition is reproducible and has no sibling runtime assets',async()=>{
  const html=await buildStandalone();
  assert.ok(await readFile(new URL('financial-human-model-standalone.html',root),'utf8')===html,'单文件产物与源码不一致，请先构建');
  assert.equal((html.slice(0,html.indexOf('<script>')).match(/<style>/g)||[]).length,1);
  assert.equal((html.match(/<script>/g)||[]).length,1);
  assert.doesNotMatch(html,/<(?:link|script|img)\b[^>]*(?:href|src)=["'](?:https?:|styles\.css|app\.offline)/i);
  assert.match(html,/MIT License/);
  assert.match(html,/保持现状/);
  assert.match(html,/来源/);
  assert.match(html,/financial-human-workspace-v1\.3/);
  assert.doesNotMatch(html,/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/);
  new vm.Script(html.match(/<script>([\s\S]*)<\/script>/)[1]);
  const layout=JSON.parse(await readFile(new URL('qa/layout-checks.json',root),'utf8'));
  assert.equal(layout.standaloneSHA256,createHash('sha256').update(html).digest('hex'));
  assert.equal(layout.checks.length,20);
  assert.ok(layout.checks.every(check=>check.overflow===false));
  const evidence=await readFile(new URL('qa/VALIDATION.md',root),'utf8');
  for(const name of ['index.html','styles.css','app.offline.js','financial-human-model-standalone.html'])assert.ok(evidence.includes(createHash('sha256').update(await readFile(new URL(name,root))).digest('hex')),name+' 验收指纹需更新');
});
test('inline builder preserves replacement tokens and rejects raw-text escapes',()=>{
  const html='<link rel="stylesheet" href="styles.css"><main></main><script defer src="app.offline.js"></script>';
  const css='x{content:"$&"}',bundle='const x="$&";';
  assert.ok(inlineAssets({html,css,bundle,license:'MIT'}).includes(bundle));
  assert.throws(()=>inlineAssets({html,css,bundle:'</script>',license:'MIT'}));
  assert.throws(()=>inlineAssets({html:html+html,css,bundle,license:'MIT'}));
});
test('source entry loads bundle after markup and includes independent data tools',async()=>{
  const html=await readFile(new URL('index.html',root),'utf8');
  assert.ok(html.indexOf('app.offline.js')>html.indexOf('id="archive"'));
  for(const id of ['step-1','step-2','step-3','step-4','step-5','archive','export-data','import-data','import-preview','confirm-import','download-report'])assert.ok(html.includes(`id="${id}"`),id);
  assert.match(html,/type="file"[^>]*accept="\.json,application\/json"/);
});
test('bundled domain can execute offline without browser globals',async()=>{
  const api=vm.runInNewContext(await buildBundle('decision'),{Date,Math,JSON,Intl});
  assert.equal(api.DEFAULT_DECISION.format,'financial-human-work-decision-v1.3');
  assert.equal(typeof api.renderReport,'function');
});
