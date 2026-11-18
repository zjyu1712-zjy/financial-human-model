import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {buildBundle} from '../scripts/build.mjs';

async function boot(storage=new Map(),blocked=false){
  const elements=new Map(),listeners={},blobs=[];
  const get=id=>{
    if(!elements.has(id))elements.set(id,{id,value:'',textContent:'',hidden:false,disabled:false,checked:false,dataset:{},files:[],innerHTML:'',setAttribute(k,v){this[k]=v;},focus(){},scrollIntoView(){}});
    return elements.get(id);
  };
  const document={querySelector:s=>get(s.slice(1)),querySelectorAll:s=>{
    if(s==='[data-step]')return [1,2,3,4,5].map(step=>({...get(`step-button-${step}`),dataset:{step:String(step)}}));
    return [];
  },addEventListener:(name,fn)=>listeners[name]=fn,createElement:()=>({click(){},remove(){}})};
  const location={hash:'#decision'};
  vm.runInNewContext('globalThis.structuredClone=value=>JSON.parse(JSON.stringify(value));\n'+await buildBundle(),{document,location,Date,Math,Intl,Blob,crypto:{randomUUID:()=>`record-${blobs.length}-${storage.size}`},URL:{createObjectURL:b=>{blobs.push(b);return 'blob:test';},revokeObjectURL(){}},localStorage:{getItem:k=>{if(blocked)throw Error('blocked');return storage.get(k)||null;},setItem:(k,v)=>{if(blocked)throw Error('blocked');storage.set(k,v);}},setTimeout:fn=>fn(),clearTimeout(){},addEventListener(){}});
  const edit=(path,value,type='number')=>{const el={dataset:{path},value:String(value),type,setAttribute(){}};listeners.input({target:el});};
  const click=id=>get(id).onclick({preventDefault(){}});
  return {get,edit,click,storage,blobs,listeners};
}
test('offline app completes comparison, immutable record, review, export and report',async()=>{
  const app=await boot();
  assert.match(app.get('result-comparison').innerHTML,/保持现状/);
  app.edit('profile.income.fixedMonthly',16000);
  app.edit('life.body','<img src=x onerror=alert(1)>','text');
  app.get('confirm-facts').checked=true;
  app.click('save-record');
  assert.match(app.get('record-count').textContent,/^1 \/ 100/);
  const before=JSON.parse(app.storage.get('financial-human-workspace-v1.3')).workspace.records[0];
  app.edit('profile.cash',200000);
  const after=JSON.parse(app.storage.get('financial-human-workspace-v1.3')).workspace.records[0];
  assert.deepEqual(after,before);
  app.get('review-note').value='实际减去了部分通勤';
  app.click('append-review');
  app.click('download-report');
  const report=await app.blobs.at(-1).text();
  assert.match(report,/实际减去了部分通勤/);
  assert.doesNotMatch(report,/<img src=x/);
  app.click('export-data');
  assert.equal(JSON.parse(await app.blobs.at(-1).text()).format,'financial-human-workspace-v1.3');
  const reload=await boot(app.storage);
  assert.match(reload.get('record-count').textContent,/^1 \/ 100/);
});
test('invalid draft clears results and survives reload without overwriting good records',async()=>{
  const app=await boot();
  app.edit('profile.cash','');
  assert.equal(app.get('save-record').disabled,true);
  assert.equal(app.get('result-comparison').innerHTML,'');
  const reload=await boot(app.storage);
  assert.equal(reload.get('save-record').disabled,true);
  assert.equal(reload.get('validation-errors').hidden,false);
  app.edit('profile.cash',120000);
  assert.equal(app.get('save-record').disabled,false);
});
test('blocked local storage still computes, records in memory and exports',async()=>{
  const app=await boot(new Map(),true);
  assert.equal(app.get('storage-warning').hidden,false);
  app.get('confirm-facts').checked=true;app.click('save-record');app.click('export-data');
  assert.equal(JSON.parse(await app.blobs.at(-1).text()).records.length,1);
});
test('import validates before confirmation and does not overwrite on invalid file',async()=>{
  const app=await boot();app.click('export-data');const text=await app.blobs.at(-1).text();
  const file={size:text.length,text:async()=>text};app.get('import-data').files=[file];
  await app.get('import-data').onchange();
  assert.equal(app.get('import-preview').hidden,false);
  app.click('confirm-import');
  assert.equal(app.get('import-preview').hidden,true);
  const saved=app.storage.get('financial-human-workspace-v1.3');
  app.get('import-data').files=[{size:10,text:async()=>'{"format":"old"}'}];
  await app.get('import-data').onchange();
  assert.equal(app.storage.get('financial-human-workspace-v1.3'),saved);
});
test('import backs up the current invalid draft and latest records before replacement',async()=>{
  const app=await boot();app.edit('profile.cash',130000);app.click('export-data');const text=await app.blobs.at(-1).text();
  app.edit('profile.cash','');
  app.get('import-data').files=[{size:text.length,text:async()=>text}];await app.get('import-data').onchange();
  app.click('confirm-import');
  assert.equal(app.get('import-preview').hidden,true);
  const backup=JSON.parse(await app.blobs.at(-1).text());
  assert.equal(backup.draft.profile.cash,'');
  assert.equal(backup.workspace.decision.profile.cash,130000);
});
test('invalid drafts do not prevent reviews and deletions from surviving reload',async()=>{
  const app=await boot();app.get('confirm-facts').checked=true;app.click('save-record');app.edit('profile.cash','');
  app.get('review-note').value='草稿未完成时追加';app.click('append-review');
  const reload=await boot(app.storage);
  assert.match(reload.get('review-history').innerHTML,/草稿未完成时追加/);
  reload.get('confirm-delete').checked=true;reload.click('delete-record');
  const again=await boot(app.storage);assert.match(again.get('record-count').textContent,/^0 \/ 100/);
});
test('each edit writes one atomic local snapshot and normalizes inactive invalid income',async()=>{
  class CountMap extends Map {writes=0;set(k,v){this.writes++;return super.set(k,v);}}
  const storage=new CountMap(),app=await boot(storage);app.edit('profile.income.fixedMonthly','');
  assert.equal(storage.writes,1);
  app.edit('profile.income.mode','hourly','select');app.edit('profile.income.hourlyRate',100);app.edit('profile.income.paidHoursWeek',20);
  assert.equal(app.get('save-record').disabled,false);
});
test('sub-yuan cash shortfalls remain visible and storage failure is session-only',async()=>{
  const app=await boot(new Map(),true);app.edit('profile.cash',.4);app.edit('profile.debt',0);app.edit('profile.income.fixedMonthly',0);app.edit('profile.expenses',.8);
  assert.match(app.get('result-comparison').innerHTML,/不足 0\.4/);
  app.get('confirm-facts').checked=true;app.click('save-record');
  assert.match(app.get('operation').textContent,/本次|会话/);
});
test('switching records clears unsubmitted review values',async()=>{
  const app=await boot();app.get('confirm-facts').checked=true;app.click('save-record');
  app.get('review-note').value='上一条未提交';app.get('review-income').value='500';
  app.get('record-select').value=JSON.parse(app.storage.get('financial-human-workspace-v1.3')).workspace.records[0].id;
  app.get('record-select').onchange();assert.equal(app.get('review-note').value,'');assert.equal(app.get('review-income').value,'');
});
test('income form only asks for components used by its selected contract',async()=>{
  const app=await boot();
  assert.doesNotMatch(app.get('profile-income').innerHTML,/data-path="profile.income.hourlyRate"/);
  app.edit('profile.income.mode','hourly','select');
  assert.match(app.get('profile-income').innerHTML,/data-path="profile.income.hourlyRate"/);
  assert.doesNotMatch(app.get('profile-income').innerHTML,/data-path="profile.income.fixedMonthly"/);
});
test('nonfinite numeric drafts remain exportable and importable as unfinished input',async()=>{
  const app=await boot();app.edit('profile.cash','1e999');app.click('export-data');
  const text=await app.blobs.at(-1).text();app.get('import-data').files=[{size:text.length,text:async()=>text}];await app.get('import-data').onchange();
  assert.equal(app.get('import-preview').hidden,false);
  app.click('confirm-import');assert.equal(app.get('save-record').disabled,true);
});
test('a corrupt local draft does not discard a valid workspace or its archive on later edits',async()=>{
  const app=await boot();app.get('confirm-facts').checked=true;app.click('save-record');
  const snapshot=JSON.parse(app.storage.get('financial-human-workspace-v1.3'));snapshot.draft.profile=null;
  app.storage.set('financial-human-workspace-v1.3',JSON.stringify(snapshot));
  const reload=await boot(app.storage);assert.match(reload.get('record-count').textContent,/^1 \/ 100/);
  reload.edit('profile.cash',130000);
  const again=await boot(app.storage);assert.match(again.get('record-count').textContent,/^1 \/ 100/);
});
test('an unrecoverable local workspace is protected from normal edits and can be backed up raw',async()=>{
  const raw='{broken-json',storage=new Map([['financial-human-workspace-v1.3',raw]]),app=await boot(storage);
  app.edit('profile.cash',130000);assert.equal(storage.get('financial-human-workspace-v1.3'),raw);
  assert.equal(app.get('storage-warning').hidden,false);app.click('download-recovery');
  assert.equal(await app.blobs.at(-1).text(),raw);
});
