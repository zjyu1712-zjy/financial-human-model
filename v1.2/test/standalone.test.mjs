import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {boot} from './fixture.mjs';

const artifact=new URL('../financial-human-model-standalone.html',import.meta.url);
const builderURL=new URL('../scripts/build-standalone.mjs',import.meta.url);
const template='<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body><main id="app"></main><script defer src="app.offline.js"></script></body></html>';
async function builder(){
  assert.ok(existsSync(builderURL),'Standalone builder must exist');
  return import(builderURL.href);
}
function scriptFrom(html){
  const matches=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(matches.length,1,'One inline application script');
  return matches[0][1];
}

test('portable HTML exists and is exactly reproducible from current source',async()=>{
  assert.ok(existsSync(artifact),'A single shareable HTML must be generated');
  const {buildStandalone}=await builder();
  assert.equal(await readFile(artifact,'utf8'),await buildStandalone());
});

test('portable HTML embeds assets, keeps script after markup and includes the MIT license',async()=>{
  const {buildStandalone}=await builder(),html=await buildStandalone();
  assert.doesNotMatch(html,/<script\b[^>]*\bsrc\s*=/i);
  assert.doesNotMatch(html,/<link\b[^>]*\brel=["'](?:stylesheet|preload|modulepreload)["']/i);
  const css=(await readFile(new URL('../styles.css',import.meta.url),'utf8'));
  assert.ok(html.includes('<style>'+css+'</style>'));
  assert.doesNotMatch(css,/@import\b|url\s*\(/i);
  assert.ok(html.indexOf('<script>')>html.indexOf('</main>'));
  assert.match(html,/MIT License[\s\S]*Financial Human Model contributors/);
  const script=scriptFrom(html);
  assert.doesNotThrow(()=>new vm.Script(script));
  assert.doesNotMatch(script,/\b(?:fetch|XMLHttpRequest|WebSocket|Worker)\s*\(/);
  const original=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const withoutLinkAttributes=text=>text.replace(/<a\b[^>]*>/g,'<a>');
  assert.equal(withoutLinkAttributes(html.match(/<body>([\s\S]*?)<script>/)[1]),withoutLinkAttributes(original.match(/<body>([\s\S]*?)<script/)[1]));
});

test('portable HTML includes every local reference document as an offline download',async()=>{
  const {buildStandalone}=await builder(),html=await buildStandalone();
  const hrefs=[...html.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map(m=>m[1]);
  assert.ok(hrefs.every(href=>/^(?:#|https?:|data:)/.test(href)),'No sibling document paths remain');
  const docs=[...html.matchAll(/href="data:text\/plain;charset=utf-8;base64,([^"]+)" download="([^"]+)"/g)];
  assert.equal(docs.length,4);
  for(const [,data,name] of docs){
    assert.equal(Buffer.from(data,'base64').toString('utf8'),await readFile(new URL('../'+name,import.meta.url),'utf8'));
  }
});

test('embedded documents use Blob downloads and preserve UTF-8 bytes',async()=>{
  const {prepareDocumentDownloads}=await builder();
  assert.equal(typeof prepareDocumentDownloads,'function','Embedded documents need a browser download adapter');
  const text='金融学人：完整函数说明\n离线可读',link={href:'data:text/plain;charset=utf-8;base64,'+Buffer.from(text).toString('base64')},blobs=[];
  vm.runInNewContext(`(${prepareDocumentDownloads.toString()})();`,{
    document:{querySelectorAll:()=>[link]},atob,Blob,Uint8Array,
    URL:{createObjectURL:blob=>{blobs.push(blob);return 'blob:embedded-model-document';}}
  });
  assert.equal(link.href,'blob:embedded-model-document');
  assert.equal(await blobs[0].text(),text);
});

test('inlining preserves JavaScript and CSS replacement metacharacters verbatim',async()=>{
  const {inlineAssets}=await builder();
  const bundle='globalThis.proof = "$& $` $\'";';
  const css='body::after { content: "$& $` $\'"; }';
  const html=inlineAssets({html:template,css,bundle,license:'MIT License'});
  assert.ok(html.includes('<style>'+css+'</style>'));
  assert.equal(scriptFrom(html),bundle);
  const context={};vm.runInNewContext(scriptFrom(html),context);
  assert.equal(context.proof,"$& $` $'");
});

test('builder rejects ambiguous/missing source entry points',async()=>{
  const {inlineAssets}=await builder(),assets={html:template,css:'body{}',bundle:'void 0;',license:'MIT'};
  for(const marker of ['<link rel="stylesheet" href="styles.css">','<script defer src="app.offline.js"></script>']){
    assert.throws(()=>inlineAssets({...assets,html:template.replace(marker,'')}),/exactly once/);
    assert.throws(()=>inlineAssets({...assets,html:template.replace(marker,marker+marker)}),/exactly once/);
  }
});

test('builder refuses HTML raw-text termination hazards rather than emitting a broken file',async()=>{
  const {inlineAssets}=await builder(),assets={html:template,css:'body{}',bundle:'void 0;',license:'MIT'};
  for(const token of ['</script>','</ScRiPt >','<!--','<script>']){
    assert.throws(()=>inlineAssets({...assets,bundle:'const text='+JSON.stringify(token)+';'}),/unsafe.*script/i);
  }
  assert.throws(()=>inlineAssets({...assets,css:'/* </STYLE> */'}),/unsafe.*style/i);
  assert.throws(()=>inlineAssets({...assets,license:'MIT -->'}),/license/i);
});

test('portable script starts with no network APIs and preserves guide, data export and import',async()=>{
  const {buildStandalone}=await builder(),script=scriptFrom(await buildStandalone());
  const {get,goal,edit,blobs}=await boot('#guide',new Map(),false,script);
  assert.match(get('summary').innerHTML,/29,810/);
  goal('recover');get('guide-next').onclick();
  assert.equal(get('guide-step-2').hidden,false);
  edit('plan','work','39');get('export').onclick();
  const data=await blobs.at(-1).text();
  edit('plan','work','40');
  await get('import').onchange({target:{files:[{size:data.length,text:async()=>data}]}});
  assert.equal(get('plan-work').value,'39');
});

test('portable script remains usable when local storage is unavailable',async()=>{
  const {buildStandalone}=await builder(),script=scriptFrom(await buildStandalone());
  const {get,edit,blobs}=await boot('#decision',new Map(),true,script);
  assert.match(get('summary').innerHTML,/29,810/);
  edit('plan','work','39');get('export').onclick();
  assert.ok((await blobs.at(-1).text()).includes('trialArchive'));
});
