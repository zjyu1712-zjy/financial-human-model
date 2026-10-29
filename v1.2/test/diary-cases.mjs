import {DEFAULT_SCENARIO,clone} from '../src/schema.js';
import {mechanisms,clip} from '../src/model.js';
import {newDiary,dayNumber,diaryWeeks} from '../src/sleep-diary.js';

// Synthetic observations for isolated regression only, never personal data.
export function syntheticDiary(end='2026-10-25'){
  const s=clone(DEFAULT_SCENARIO),d=newDiary(),start=dayNumber(end)-42;
  const dateAt=n=>new Date(n*86400000).toISOString().slice(0,10);
  const row=(date,patch={})=>({date,hours:8,fatigue:2,quality:4,context:'ordinary',note:'',...patch});
  d.assumeZero=true;d.records=[row(dateAt(start),{fatigue:5})];
  let fatigue=50,debt=0;
  for(let i=0;i<6;i++){
    const hours=53+i*.4,plan={...s.plan,sleep:hours},state={...s.state,fatigue,sleepDebt:debt,sleepQuality:75};
    const m=mechanisms(state,plan,{...s.parameters,fatigueRecovery:.45});
    const next=clip(fatigue*(1-m.sleep.recovery)+.5*Math.max(0,plan.work+plan.learn+.5*plan.care-50)+m.sleep.debtFatigue+m.channels.healthWear-.12*Math.min(plan.exercise,5));
    for(let day=1;day<=7;day++)d.records.push(row(dateAt(start+i*7+day),{hours:hours/7,fatigue:(fatigue+(next-fatigue)*day/7)/10}));
    const w=diaryWeeks(d.records).at(-1);d.weeks.push({end:w.end,fingerprint:w.fingerprint,scenario:clone(s)});
    fatigue=next;debt=m.sleep.debtAfter;
  }
  return {d,s};
}
