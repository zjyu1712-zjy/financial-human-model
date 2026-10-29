import vm from 'node:vm';
import {buildOffline} from '../scripts/build-offline.mjs';

// Event/value fixture only. Browser layout is verified separately by browser-check.html.
export async function boot(hash='#guide',storage=new Map(),storageError=false){
  const elements=new Map(),events={},listeners={},eventHandlers={},location={hash},blobs=[];
  const presets=['recover','spend','invest'].map(p=>({dataset:{preset:p}}));
  const get=id=>{
    if(!elements.has(id))elements.set(id,{id,_value:'',_html:'',textContent:'',hidden:false,disabled:false,checked:false,dataset:{},
      get value(){return this._value;},set value(v){this._value=String(v);},
      get innerHTML(){return this._html;},set innerHTML(v){this._html=v;
        for(const match of v.matchAll(/<input\b[^>]*>/g)){
          const attrs=Object.fromEntries([...match[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
          if(attrs.id){const el=get(attrs.id);el.value=attrs.value??'';el.dataset={group:attrs['data-group'],key:attrs['data-key'],diaryWeek:attrs['data-diary-week']};}
        }
      },selectedOptions:[{text:'累的程度 · 分'}],setAttribute(k,v){this[k]=v;},focus(){this.focused=true;}});
    return elements.get(id);
  };
  get('question').value='week';get('weeks').value='12';get('chart-metric').value='fatigue';
  const document={querySelector:q=>get(q.slice(1)),querySelectorAll:q=>q==='[data-group]'?[...elements.values()].filter(e=>e.dataset.group):presets,
    addEventListener:(type,cb)=>{(eventHandlers[type]??=[]).push(cb);listeners[type]=event=>eventHandlers[type].forEach(fn=>fn(event));},createElement:()=>({click(){}})};
  vm.runInNewContext(await buildOffline(),{document,location,addEventListener:(name,cb)=>events[name]=cb,scrollTo(){},setTimeout:()=>{},Blob,
    URL:{createObjectURL:b=>{blobs.push(b);return 'blob:test';},revokeObjectURL(){}},
    localStorage:{getItem:k=>{if(storageError)throw new Error('Storage denied');return storage.get(k)??null;},setItem:(k,v)=>{if(storageError)throw new Error('Storage denied');storage.set(k,v);}}});
  const go=key=>{location.hash='#'+key;events.hashchange();};
  const select=choice=>{get('demo-'+choice).checked=true;get('demo-'+choice).onchange();};
  const goal=key=>{get('guide-goal-'+key).checked=true;get('guide-goal-'+key).onchange();};
  const edit=(group,key,value,prefix='')=>{const el=get(prefix+group+'-'+key);el.dataset={group,key};el.value=value;listeners.input({target:el});};
  const choose=id=>listeners.change({target:{checked:true,dataset:{guideChoice:id}}});
  const saved=()=>JSON.parse(storage.get('financial-human-workspace-v1.2'));
  return {get,go,select,listeners,storage,goal,edit,choose,saved,blobs,presets};
}
