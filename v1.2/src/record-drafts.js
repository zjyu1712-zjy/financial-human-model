import { clone } from './schema.js';
import { localDate } from './records.js';

export function newRecordDrafts(){
  const today=new Date(),later=new Date(today);later.setDate(later.getDate()+7);
  return {trial:{startDate:localDate(today),reviewDate:localDate(later),intent:'',stopRule:''},selectedId:'',reviews:[]};
}
export function decodeRecordDrafts(value){
  if(value===undefined)return newRecordDrafts();
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('试行草稿格式无效');
  const check=(object,fields)=>{
    if(!object||typeof object!=='object'||Array.isArray(object)||Object.keys(object).some(k=>!Object.hasOwn(fields,k)))throw new Error('试行草稿字段无效');
    for(const [key,max] of Object.entries(fields))if(typeof object[key]!=='string'||object[key].length>max)throw new Error('试行草稿内容过长或缺失');
  };
  check(value.trial,{startDate:10,reviewDate:10,intent:300,stopRule:200});
  if(typeof value.selectedId!=='string'||value.selectedId.length>80||!Array.isArray(value.reviews)||value.reviews.length>100)throw new Error('复盘草稿格式无效');
  const seen=new Set();
  for(const r of value.reviews){check(r,{trialId:80,date:10,execution:500,outcome:500,reason:500,nextStep:500});if(seen.has(r.trialId))throw new Error('复盘草稿重复');seen.add(r.trialId);}
  return clone(value);
}
