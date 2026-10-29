import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {DEFAULT_SCENARIO,TIME_KEYS,upgradeScenario} from '../src/schema.js';
import {boot} from './fixture.mjs';
import {DEMO_GOALS,buildDecisionDemo,buildLearningDemo,createLearningDemoScenario} from '../src/demo.js';
import {DEFAULT_MARGINAL,marginalEffects} from '../src/marginal.js';
import {DEFAULT_GUIDE,buildDecisionGuide} from '../src/guide.js';
import {PAGES,resolvePage} from '../src/navigation.js';
import {buildOffline} from '../scripts/build-offline.mjs';
import {WORKSPACE_KEY} from '../src/workspace.js';

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const storedExperiment=storage=>JSON.stringify(JSON.parse(storage.get(WORKSPACE_KEY)).experiment);

test('demo inputs are isolated copies and match both previously supplied examples',async()=>{
  const original=JSON.stringify(DEFAULT_SCENARIO),scenario=createLearningDemoScenario();
  for(const source of ['work','sleep']){
    const file=JSON.parse(await readFile(new URL(`../examples/marginal-${source}-to-learning.json`,import.meta.url),'utf8'));
    assert.deepEqual(scenario,upgradeScenario(file.current));
  }
  scenario.state.cash=0;scenario.plan.work=0;scenario.parameters.beta=.8;
  assert.equal(JSON.stringify(DEFAULT_SCENARIO),original);
  assert.equal(createLearningDemoScenario().state.cash,30000);
});

test('all six demo cases recalculate migrated example inputs and conserve the 168-hour budget',async()=>{
  const demo=buildLearningDemo();assert.equal(demo.weeks,12);assert.deepEqual(demo.rows.map(r=>r.amount),[1,2,4]);
  for(const source of ['work','sleep']){
    const file=JSON.parse(await readFile(new URL(`../examples/marginal-${source}-to-learning.json`,import.meta.url),'utf8'));
    for(const row of demo.rows){
      const p=row[source],expected=marginalEffects(upgradeScenario(file.current),12,{}, {...DEFAULT_MARGINAL,source,step:row.amount}).primary;
      assert.equal(p.feasible,true);assert.deepEqual(p.delta,expected.delta);
      assert.equal(TIME_KEYS.reduce((n,k)=>n+p.plan[k],0),168);assert.equal(p.totalHours,row.amount*12);
      assert.equal(p.plan.learn,6+row.amount);assert.equal(p.plan[source],demo.scenario.plan[source]-row.amount);
    }
  }
});

test('demo computes marginal segments for 0→1, 1→2, 2→4 instead of summing average rates',()=>{
  const demo=buildLearningDemo();let previous={work:demo.baseline,sleep:demo.baseline},amount=0;
  for(const row of demo.rows){
    assert.equal(row.from,amount);assert.equal(row.additionalHours,(row.amount-amount)*12);
    for(const source of ['work','sleep']){
      near(row[source].increment.knowledge,(row[source].metrics.knowledge-previous[source].knowledge)/row.additionalHours);
      previous[source]=row[source].metrics;
    }
    near(row.difference.cash,row.sleep.metrics.cash-row.work.metrics.cash);amount=row.amount;
  }
  near(demo.rows[2].difference.cash,401.82923074445716);
});

test('navigation resolves all pages and preserves old bookmark destinations',()=>{
  assert.equal(Object.keys(PAGES).length,8);
  for(const key of Object.keys(PAGES))assert.equal(resolvePage('#'+key),key);
  for(const hash of ['','#','unknown','#__proto__','#constructor'])assert.equal(resolvePage(hash),'guide');
  assert.equal(resolvePage('#summary'),'decision');assert.equal(resolvePage('#relations'),'model');
  assert.equal(resolvePage('#purpose'),'model');assert.equal(resolvePage('#emotion'),'systems');
});

test('offline demo uses the same live calculations as the source module',async()=>{
  const offline=vm.runInNewContext(await buildOffline('demo'));
  assert.equal(JSON.stringify(offline.buildLearningDemo()),JSON.stringify(buildLearningDemo()));
  for(const goal of Object.keys(DEMO_GOALS))assert.equal(JSON.stringify(offline.buildDecisionDemo(goal)),JSON.stringify(buildDecisionDemo(goal)));
});

test('demo defaults to two comparisons; one click shows 2, 4 hours or all six without JSON import',async()=>{
  const {get,select}=await boot('#demo');
  assert.equal(get('demo').hidden,false);assert.equal(get('experiment-controls').hidden,true);
  assert.match(get('demo-baseline').textContent,/35,135.15/);
  for(const choice of ['1','2','4','all']){
    select(choice);const html=get('demo-results').innerHTML;
    assert.equal((html.match(/data-demo-source=/g)||[]).length,choice==='all'?6:2);
    assert.doesNotMatch(html,/不是“免费多学”|不代表学习不累|demo-explanation|demo-benefit/);
    assert.match(html,/最后剩多少钱变化/);assert.match(html,/第一周、最后和每小时的结果/);
    if(choice==='4'){
      assert.match(html,/401.83/);assert.match(html,/19.43/);assert.match(html,/0.168/);
      assert.match(get('demo-status').textContent,/累计转入 48 小时/);
    }
  }
});

test('all 18 goal demo cases use the existing engine and conserve time without changing shared inputs',()=>{
  const defaults=JSON.stringify(DEFAULT_SCENARIO),definitions=JSON.stringify(DEMO_GOALS);
  for(const goal of Object.keys(DEMO_GOALS)){
    const data=buildDecisionDemo(goal),previous=Object.fromEntries(data.options.map(o=>[o.id,data.baseline]));
    for(const row of data.rows){
      for(const {id,source,target} of data.options){
        const p=row[id],expected=marginalEffects(data.scenario,12,{}, {...DEFAULT_MARGINAL,source,target,step:row.amount}).primary;
        assert.equal(p.feasible,true);assert.deepEqual(p.delta,expected.delta);assert.deepEqual(p.firstDelta,expected.firstDelta);
        assert.deepEqual(p.perHour,expected.perHour);assert.equal(p.totalHours,12*row.amount);
        assert.equal(TIME_KEYS.reduce((n,k)=>n+p.plan[k],0),168);
        for(const k of TIME_KEYS)assert.equal(p.plan[k],data.scenario.plan[k]+(k===target?row.amount:k===source?-row.amount:0));
        for(const k of data.metrics)near(p.increment[k],(p.metrics[k]-previous[id][k])/row.additionalHours);
        previous[id]=p.metrics;
        if(goal==='recover')assert.ok(p.delta.fatigue<0);
        if(goal==='income')assert.ok(p.delta.income>0);
      }
      const [a,b]=data.options.map(o=>row[o.id]);
      for(const k of data.metrics)near(row.difference[k],b.metrics[k]-a.metrics[k]);
    }
    data.scenario.plan.work=1;data.options[0].source='care';data.metrics.length=0;
    assert.equal(buildDecisionDemo(goal).scenario.plan.work,40);
  }
  assert.equal(JSON.stringify(DEFAULT_SCENARIO),defaults);assert.equal(JSON.stringify(DEMO_GOALS),definitions);
  for(const invalid of ['fixed','constructor','__proto__','',null])assert.throws(()=>buildDecisionDemo(invalid),/目标无效/);
});

test('all demo goals switch 1, 2, 4 hours and overview while retaining their own selection',async()=>{
  const {get,go,select,listeners,storage}=await boot('#demo');
  const changeGoal=key=>{get('demo-goal-'+key).checked=true;get('demo-goal-'+key).onchange();};
  listeners.input({target:{value:'36',dataset:{group:'plan',key:'work'},setAttribute(){}}});
  get('guide-note').value='未保存的主线草稿';get('save').onclick();const original=storedExperiment(storage);
  for(const key of Object.keys(DEMO_GOALS)){
    changeGoal(key);const data=buildDecisionDemo(key);
    assert.equal(get('demo-action').textContent,data.action);
    assert.match(get('demo-pay').textContent,/80 元\/有效小时/);
    assert.match(get('demo-start').textContent,/工作 40/);
    for(const amount of ['1','2','4','all']){
      select(amount);const html=get('demo-results').innerHTML;
      assert.equal((html.match(/data-demo-option=/g)||[]).length,amount==='all'?6:2);
      assert.match(html,new RegExp(`data-count="${data.metrics.length}"`));
      for(const option of data.options){assert.ok(html.includes(option.label));assert.ok(html.includes(`data-demo-target="${option.target}"`));}
      if(amount!=='all'){
        const row=data.rows.find(r=>r.amount===Number(amount));
        for(const option of data.options){
          const value=row[option.id].delta.cash,formatted=value.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
          assert.ok(html.includes(formatted));
        }
      }
    }
    select({learn:'4',recover:'2',income:'all'}[key]);
  }
  for(const key of ['learn','recover','income']){
    changeGoal(key);const selected={learn:'4',recover:'2',income:'all'}[key];
    assert.equal(get('demo-'+selected).checked,true);
    const html=get('demo-results').innerHTML;go('model');go('guide');go('demo');assert.equal(get('demo-results').innerHTML,html);
  }
  assert.match(get('demo-baseline').textContent,/累计收入/);
  assert.match(get('demo-results').innerHTML,/<dt>这段时间赚的钱变化<\/dt>/);
  assert.equal(get('guide-note').value,'未保存的主线草稿');get('save').onclick();assert.equal(storedExperiment(storage),original);
});

test('operational pages keep data and errors while full explanations belong to the model page',async()=>{
  const {get,go,listeners}=await boot('#decision');
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const model=html.slice(html.indexOf('<section id="model"'),html.indexOf('<section id="files"'));
  for(const text of ['不是现实置信区间','有效工作小时','没有加班报酬的固定工资','未指定的周沿用基础安排','共用一份个人数据','正贡献提高J'])assert.ok(model.includes(text));
  assert.match(get('demo-model-definitions').innerHTML,/少累一点/);assert.match(get('demo-model-definitions').innerHTML,/增加收入/);
  for(const page of Object.keys(PAGES)){go(page);assert.equal(get('page-description').hidden,page!=='model');}
  assert.doesNotMatch(get('summary').innerHTML,/受个人权重|越低表示|0–100/);
  assert.doesNotMatch(get('state-controls').innerHTML,/影响路径/);assert.match(get('system-equations').innerHTML,/有效投入/);
  assert.equal(get('verdict').textContent,'');assert.equal(get('marginal-verdict').textContent,'');
  assert.doesNotMatch(get('marginal-contributions').innerHTML,/会计分解/);
  get('analyze').onclick();assert.match(get('uncertainty').innerHTML,/时间或钱不够的情况占比/);assert.match(get('uncertainty').innerHTML,/两种安排都能完成时/);
  assert.doesNotMatch(get('uncertainty').innerHTML,/不是现实置信区间/);assert.doesNotMatch(get('sensitivity').innerHTML,/这是参数扰动/);
  assert.match(get('uncertainty').innerHTML,/0 \/ 80/);
  listeners.input({target:{value:'168',dataset:{group:'plan',key:'work'},setAttribute(){}}});
  assert.match(get('verdict').innerHTML,/不可执行/);assert.match(get('marginal-verdict').textContent,/不可行/);
  get('analyze').onclick();assert.match(get('uncertainty').innerHTML,/没有两种安排都能完成的情况/);assert.doesNotMatch(get('uncertainty').innerHTML,/0 \/ 0/);
  listeners.input({target:{value:'40',dataset:{group:'plan',key:'work'},setAttribute(){}}});
  listeners.input({target:{value:'2',dataset:{group:'weights',key:'safety'},setAttribute(){}}});
  assert.match(get('verdict').textContent,/重视的事情不同/);get('analyze').onclick();assert.match(get('uncertainty').innerHTML,/口径不同/);
  listeners.input({target:{value:'',dataset:{group:'plan',key:'work'},setAttribute(){}}});assert.equal(get('export').disabled,false);
  assert.match(html,/导入并替换数据/);
});

test('only one page is visible and hash navigation leaves input, baseline, schedule and drafts untouched',async()=>{
  const {get,go,select,listeners,storage}=await boot('#marginal');
  const visible=()=>Object.keys(PAGES).filter(k=>!get(k).hidden);
  assert.deepEqual(visible(),['marginal']);
  get('schedule').value='{"2":{"work":32,"leisure":20}}';get('schedule-apply').onclick();
  listeners.input({target:{value:'36',dataset:{group:'plan',key:'work'},setAttribute(){}}});
  get('pin').onclick();get('save').onclick();const snapshot=storedExperiment(storage),summary=get('summary').innerHTML;
  for(const page of Object.keys(PAGES)){
    go(page);assert.deepEqual(visible(),[page]);assert.equal(get('nav-'+page)['aria-current'],'page');
    assert.equal(get('page-title').textContent,PAGES[page].title);
    assert.equal(get('experiment-controls').hidden,!PAGES[page].controls);
  }
  go('demo');select('all');go('decision');assert.equal(get('summary').innerHTML,summary);
  get('save').onclick();assert.equal(storedExperiment(storage),snapshot);
  listeners.input({target:{value:'',dataset:{group:'plan',key:'work'},setAttribute(){}}});
  go('demo');select('4');assert.match(get('demo-results').innerHTML,/401.83/);
  go('systems');assert.equal(get('export').disabled,false);assert.match(get('error').textContent,/工作/);
  go('relations');assert.deepEqual(visible(),['model']);
  assert.equal(get('page-title').focused,true);
});

test('the default page follows goal, boundaries, choices and a one-week trial',async()=>{
  const {get,go,listeners,storage}=await boot('');
  assert.equal(get('guide').hidden,false);assert.equal(get('experiment-controls').hidden,true);
  assert.match(get('guide-options').innerHTML,/data-guide-choice="work"/);
  assert.match(get('guide-options').innerHTML,/data-guide-choice="leisure"/);
  assert.doesNotMatch(get('guide-options').innerHTML,/data-guide-choice="sleep"/);
  assert.match(get('guide-excluded').innerHTML,/睡眠不减少/);
  get('save').onclick();const original=storedExperiment(storage);
  listeners.change({target:{checked:true,dataset:{guideChoice:'sleep'}}});assert.equal(get('guide-trial').hidden,true);
  listeners.change({target:{checked:true,dataset:{guideChoice:'work'}}});
  assert.equal(get('guide-trial').hidden,false);assert.match(get('guide-trial-plan').innerHTML,/学习 8 小时/);
  assert.match(get('guide-trial-plan').innerHTML,/第 1 周模拟变化/);
  get('guide-note').value='本周学习两章，记录实际时数。';
  go('model');go('guide');assert.equal(get('guide-note').value,'本周学习两章，记录实际时数。');
  assert.equal(get('guide-trial').hidden,false);
  get('guide-save').onclick();const record=JSON.parse(storage.get('financial-human-weekly-trial-v5'));
  assert.equal(record.choiceId,'work');assert.equal(record.config.amount,2);assert.equal(record.note,'本周学习两章，记录实际时数。');
  get('guide-cancel').onclick();assert.equal(get('guide-trial').hidden,true);
  get('guide-load').onclick();assert.equal(get('guide-note').value,record.note);assert.equal(get('guide-trial').hidden,false);
  get('save').onclick();assert.equal(storedExperiment(storage),original);
});

test('changing a boundary clears the trial and does not silently adopt excluded or malformed saved plans',async()=>{
  const {get,listeners,storage}=await boot('');
  listeners.change({target:{checked:true,dataset:{guideChoice:'work'}}});get('guide-save').onclick();
  const saved=storage.get('financial-human-weekly-trial-v5');
  get('guide-protect-work').checked=true;get('guide-protect-work').onchange();
  assert.equal(get('guide-trial').hidden,true);assert.doesNotMatch(get('guide-options').innerHTML,/data-guide-choice="work"/);
  const invalid=JSON.parse(saved);invalid.config.protectWork=true;storage.set('financial-human-weekly-trial-v5',JSON.stringify(invalid));
  get('guide-load').onclick();assert.match(get('guide-message').textContent,/不满足当前约束/);
  assert.equal(get('guide-trial').hidden,true);assert.equal(get('guide-protect-work').checked,true);
  storage.set('financial-human-weekly-trial-v5','null');get('guide-load').onclick();assert.match(get('guide-message').textContent,/格式不完整/);
  get('guide-protect-sleep').checked=false;get('guide-protect-sleep').onchange();
  assert.match(get('guide-options').innerHTML,/data-guide-choice="sleep"/);
  get('guide-amount').value=4;get('guide-amount').onchange();assert.match(get('guide-target').textContent,/48 小时/);
});

test('personal inputs and weekly overrides are linked without a copy action',async()=>{
  const {get,go,listeners}=await boot('');
  assert.match(get('guide-options').innerHTML,/data-guide-choice="unallocated"/);
  const before=get('guide-comparisons').innerHTML;
  get('schedule').value='{"2":{"work":32}}';get('schedule-apply').onclick();
  assert.notEqual(get('guide-comparisons').innerHTML,before);
  assert.match(get('guide-period').textContent,/含逐周安排/);
  get('schedule').value='{"2":{"work":';go('model');go('decision');assert.equal(get('schedule').value,'{"2":{"work":');
  listeners.input({target:{value:'',dataset:{group:'plan',key:'work'},setAttribute(){}}});
  assert.equal(get('guide-comparisons').innerHTML,'');assert.equal(get('guide-save').disabled,true);
});

test('unsaved trial notes stay attached to their original arrangement when exploring other options',async()=>{
  const {get,listeners}=await boot('');
  const choose=source=>listeners.change({target:{checked:true,dataset:{guideChoice:source}}});
  choose('work');get('guide-note').value='两小时方案的未保存记录';
  get('guide-amount').value=4;get('guide-amount').onchange();choose('work');assert.equal(get('guide-note').value,'');
  get('guide-note').value='四小时方案的记录';
  get('guide-amount').value=2;get('guide-amount').onchange();choose('work');assert.equal(get('guide-note').value,'两小时方案的未保存记录');
  choose('leisure');assert.equal(get('guide-note').value,'');choose('work');assert.equal(get('guide-note').value,'两小时方案的未保存记录');
});

test('switching goals changes candidates, lead outcomes and reflection without mixing drafts',async()=>{
  const {get,goal,listeners}=await boot('');
  const choose=id=>listeners.change({target:{checked:true,dataset:{guideChoice:id}}});
  choose('work');get('guide-note').value='学习计划草稿';
  goal('recover');assert.equal(get('guide-trial').hidden,true);assert.equal(get('guide-income-setting').hidden,true);
  assert.match(get('guide-comparisons').innerHTML,/<th scope="row">最后一周有多累/);
  assert.match(get('guide-options').innerHTML,/data-guide-choice="work-to-leisure"/);
  assert.doesNotMatch(get('guide-options').innerHTML,/data-guide-choice="work"/);
  choose('work-to-leisure');assert.equal(get('guide-note').value,'');get('guide-note').value='休息计划草稿';
  assert.match(get('guide-trial-plan').innerHTML,/为了少累一点/);assert.match(get('guide-note-label').textContent,/怎样休息/);
  goal('income');assert.equal(get('guide-income-setting').hidden,false);assert.equal(get('guide-options').innerHTML,'');
  assert.match(get('guide-status').textContent,/先确认/);
  get('guide-income-mode').value='output';get('guide-income-mode').onchange();
  assert.match(get('guide-comparisons').innerHTML,/<th scope="row">这段时间赚的钱/);
  choose('learn-to-work');get('guide-note').value='增收计划草稿';
  assert.match(get('guide-trial-plan').innerHTML,/为了增加收入/);assert.match(get('guide-note-label').textContent,/有报酬/);
  goal('learn');choose('work');assert.equal(get('guide-note').value,'学习计划草稿');
  goal('recover');choose('work-to-leisure');assert.equal(get('guide-note').value,'休息计划草稿');
  goal('income');choose('learn-to-work');assert.equal(get('guide-note').value,'增收计划草稿');
  get('guide-income-mode').value='fixed';get('guide-income-mode').onchange();
  assert.equal(get('guide-trial').hidden,true);assert.equal(get('guide-options').innerHTML,'');
  assert.match(get('guide-status').textContent,/固定工资/);
  choose('learn-to-work');assert.equal(get('guide-trial').hidden,true);
});

test('all goals save and reload their own choices and preserve professional inputs across pages',async()=>{
  const {get,go,goal,listeners,storage}=await boot('');
  get('save').onclick();const original=storedExperiment(storage);
  for(const [key,id] of [['learn','work'],['recover','work-to-sleep'],['income','leisure-to-work']]){
    goal(key);if(key==='income'){get('guide-income-mode').value='output';get('guide-income-mode').onchange();}
    listeners.change({target:{checked:true,dataset:{guideChoice:id}}});
    const note=`${key} 试行记录 <b>原样保存</b>`;get('guide-note').value=note;
    for(const page of Object.keys(PAGES))go(page);
    go('guide');assert.equal(get('guide-note').value,note);assert.equal(get('guide-goal-'+key).checked,true);
    get('guide-save').onclick();const saved=JSON.parse(storage.get('financial-human-weekly-trial-v5'));
    assert.equal(saved.config.goal,key);assert.equal(saved.choiceId,id);
    goal(key==='learn'?'recover':'learn');get('guide-load').onclick();
    assert.equal(get('guide-goal-'+key).checked,true);assert.equal(get('guide-note').value,note);
    assert.match(get('guide-options').innerHTML,new RegExp(`data-guide-choice="${id}" checked`));
  }
  get('save').onclick();assert.equal(storedExperiment(storage),original);
});

test('old learning records load explicitly, remain intact, and do not mask a broken new save',async()=>{
  const {get,goal,storage}=await boot('');
  const old={format:'financial-human-weekly-trial-v1',scenario:createLearningDemoScenario(),config:{amount:2,protectSleep:true,protectWork:false},source:'work',note:'以前的复盘'};
  const raw=JSON.stringify(old);storage.set(old.format,raw);goal('income');get('guide-load').onclick();
  assert.equal(get('guide-goal-learn').checked,true);assert.equal(get('guide-note').value,old.note);
  assert.match(get('guide-message').textContent,/旧版学习/);
  get('guide-save').onclick();assert.equal(storage.get(old.format),raw);
  storage.set('financial-human-weekly-trial-v5','null');goal('recover');get('guide-load').onclick();
  assert.equal(get('guide-goal-recover').checked,true);assert.match(get('guide-message').textContent,/格式不完整/);
});

const visibleGuideSteps=get=>[1,2,3,4,5].filter(i=>!get('guide-step-'+i).hidden);
const nextGuide=get=>get('guide-next').onclick();

test('wizard reveals only one step, prevents skipping and requires a choice before the trial',async()=>{
  const {get,listeners}=await boot('#guide');
  assert.deepEqual(visibleGuideSteps(get),[1]);assert.equal(get('guide-back').hidden,true);
  assert.equal(get('guide-nav-1')['aria-current'],'step');
  for(const n of [2,3,4,5]){assert.equal(get('guide-nav-'+n).disabled,true);get('guide-nav-'+n).onclick();assert.deepEqual(visibleGuideSteps(get),[1]);}
  for(const n of [2,3,4]){
    nextGuide(get);assert.deepEqual(visibleGuideSteps(get),[n]);
    assert.equal(get('guide-nav-'+n)['aria-current'],'step');assert.equal(get('guide-back').hidden,false);
  }
  assert.equal(get('guide-next').disabled,true);nextGuide(get);assert.deepEqual(visibleGuideSteps(get),[4]);
  assert.match(get('guide-step-hint').textContent,/选择一项/);
  assert.doesNotMatch(get('guide-comparisons').innerHTML,/type="radio"/);
  listeners.change({target:{checked:true,dataset:{guideChoice:'work'}}});
  assert.equal(get('guide-next').disabled,false);assert.deepEqual(visibleGuideSteps(get),[4]);
  nextGuide(get);assert.deepEqual(visibleGuideSteps(get),[5]);assert.equal(get('guide-next').hidden,true);
  assert.equal(get('guide-review-title').focused,true);assert.match(get('guide-trial-plan').innerHTML,/学习 8 小时/);
});

test('wizard back, completed-step navigation and page changes retain choices, settings and drafts',async()=>{
  const {get,go,listeners,storage}=await boot('#guide');
  get('guide-amount').value='4';get('guide-amount').onchange();
  for(let i=0;i<3;i++)nextGuide(get);
  listeners.change({target:{checked:true,dataset:{guideChoice:'work'}}});nextGuide(get);
  get('guide-note').value='尚未保存：周五做两次练习';
  const trial=get('guide-trial-plan').innerHTML;
  get('guide-back').onclick();assert.deepEqual(visibleGuideSteps(get),[4]);
  get('guide-nav-1').onclick();assert.deepEqual(visibleGuideSteps(get),[1]);
  assert.equal(get('guide-amount').value,'4');
  // Reconfirming an unchanged input must not invalidate later steps.
  get('guide-amount').onchange();get('guide-nav-5').onclick();assert.deepEqual(visibleGuideSteps(get),[5]);
  for(const page of ['model','demo','systems','guide'])go(page);
  assert.deepEqual(visibleGuideSteps(get),[5]);assert.equal(get('guide-note').value,'尚未保存：周五做两次练习');
  assert.equal(get('guide-trial-plan').innerHTML,trial);
  assert.equal(storage.has('financial-human-weekly-trial-v5'),false);
});

test('wizard rechecks changed boundaries, retains valid choices and restores invalidated drafts on undo',async()=>{
  const {get,listeners}=await boot('#guide');
  for(let i=0;i<3;i++)nextGuide(get);
  listeners.change({target:{checked:true,dataset:{guideChoice:'work'}}});nextGuide(get);
  get('guide-note').value='原安排的复盘';
  get('guide-nav-2').onclick();get('guide-protect-learn').checked=true;get('guide-protect-learn').onchange();
  assert.equal(get('guide-note').value,'原安排的复盘');
  assert.match(get('guide-options').innerHTML,/data-guide-choice="work" checked/);
  assert.equal(get('guide-nav-5').disabled,true);get('guide-nav-5').onclick();assert.deepEqual(visibleGuideSteps(get),[2]);
  get('guide-protect-work').checked=true;get('guide-protect-work').onchange();
  assert.equal(get('guide-trial').hidden,true);assert.equal(get('guide-note').value,'');
  assert.match(get('guide-message').textContent,/原记录仍保留/);
  assert.doesNotMatch(get('guide-options').innerHTML,/data-guide-choice="work"/);
  get('guide-protect-work').checked=false;get('guide-protect-work').onchange();
  assert.equal(get('guide-note').value,'原安排的复盘');
  for(let i=0;i<3;i++)nextGuide(get);
  assert.deepEqual(visibleGuideSteps(get),[5]);assert.equal(get('guide-note').value,'原安排的复盘');
});

test('wizard income blockers are visible on the first step and cannot be bypassed',async()=>{
  const {get,goal}=await boot('#guide');goal('income');
  for(const mode of ['unknown','fixed']){
    get('guide-income-mode').value=mode;get('guide-income-mode').onchange();
    assert.equal(get('guide-step-hint').hidden,false);assert.equal(get('guide-next').disabled,true);
    nextGuide(get);get('guide-nav-3').onclick();assert.deepEqual(visibleGuideSteps(get),[1]);
  }
  assert.match(get('guide-step-hint').textContent,/固定工资/);
  get('guide-income-mode').value='output';get('guide-income-mode').onchange();
  assert.equal(get('guide-next').disabled,false);nextGuide(get);assert.deepEqual(visibleGuideSteps(get),[2]);
});

test('wizard empty comparisons stop progression without relaxing boundaries and can recover',async()=>{
  const {get,listeners}=await boot('#guide');nextGuide(get);
  listeners.input({target:{value:'0',dataset:{group:'state',key:'cash'},setAttribute(){}}});
  listeners.input({target:{value:'0',dataset:{group:'plan',key:'wage'},setAttribute(){}}});
  nextGuide(get);
  assert.deepEqual(visibleGuideSteps(get),[3]);assert.equal(get('guide-comparisons').innerHTML,'');
  assert.equal(get('guide-next').disabled,true);assert.equal(get('guide-protect-sleep').checked,true);
  nextGuide(get);assert.deepEqual(visibleGuideSteps(get),[3]);
  get('guide-back').onclick();get('reset').onclick();nextGuide(get);
  assert.equal(get('guide-next').disabled,false);assert.notEqual(get('guide-comparisons').innerHTML,'');
});

test('wizard saves and resumes all three goals at reflection, with all earlier steps revisitable',async()=>{
  for(const [key,id] of [['learn','work'],['recover','work-to-sleep'],['income','leisure-to-work']]){
    const {get,goal,listeners,storage}=await boot('#guide');goal(key);
    if(key==='income'){get('guide-income-mode').value='output';get('guide-income-mode').onchange();}
    for(let i=0;i<3;i++)nextGuide(get);
    listeners.change({target:{checked:true,dataset:{guideChoice:id}}});nextGuide(get);
    get('guide-note').value=key+' 本周记录';get('guide-save').onclick();
    assert.equal(JSON.parse(storage.get('financial-human-weekly-trial-v5')).choiceId,id);
    get('guide-cancel').onclick();assert.deepEqual(visibleGuideSteps(get),[4]);assert.equal(get('guide-next').disabled,true);
    get('guide-load').onclick();assert.deepEqual(visibleGuideSteps(get),[5]);assert.equal(get('guide-note').value,key+' 本周记录');
    for(const n of [4,3,2,1,5]){assert.equal(get('guide-nav-'+n).disabled,false);get('guide-nav-'+n).onclick();assert.deepEqual(visibleGuideSteps(get),[n]);}
  }
});

test('wizard changed goal or amount requires reviewing again while former drafts stay recoverable',async()=>{
  const {get,goal,listeners}=await boot('#guide');
  for(let i=0;i<3;i++)nextGuide(get);
  listeners.change({target:{checked:true,dataset:{guideChoice:'work'}}});nextGuide(get);get('guide-note').value='两小时的记录';
  get('guide-nav-1').onclick();get('guide-amount').value=4;get('guide-amount').onchange();
  assert.deepEqual(visibleGuideSteps(get),[1]);assert.equal(get('guide-nav-5').disabled,true);assert.equal(get('guide-note').value,'');
  assert.match(get('guide-message').textContent,/原复盘草稿保留/);
  get('guide-amount').value=2;get('guide-amount').onchange();assert.equal(get('guide-note').value,'两小时的记录');
  goal('recover');assert.equal(get('guide-trial').hidden,true);
  goal('learn');assert.equal(get('guide-note').value,'两小时的记录');assert.equal(get('guide-nav-5').disabled,true);
});

test('returning to edit recomputes comparison amounts and the one-week plan from the same model',async()=>{
  const {get,listeners}=await boot('#guide');
  for(let i=0;i<3;i++)nextGuide(get);
  listeners.change({target:{checked:true,dataset:{guideChoice:'work'}}});nextGuide(get);
  const old=get('guide-comparisons').innerHTML;
  get('guide-note').value='两小时试行的记录';get('guide-nav-1').onclick();
  get('guide-amount').value=4;get('guide-amount').onchange();
  assert.notEqual(get('guide-comparisons').innerHTML,old);
  const expected=buildDecisionGuide(DEFAULT_SCENARIO,{...DEFAULT_GUIDE,amount:4}).available.find(x=>x.id==='work');
  const money=Math.abs(expected.point.delta.cash).toLocaleString('zh-CN',{minimumFractionDigits:0,maximumFractionDigits:0});
  assert.ok(get('guide-comparisons').innerHTML.includes(`少 ${money} 元`));
  assert.match(get('guide-options').innerHTML,/工作 40 → 36 小时/);
  assert.match(get('guide-trial-plan').innerHTML,/学习 10 小时/);
  assert.match(get('guide-trial-plan').innerHTML,/工作 36 小时/);
  assert.equal(get('guide-nav-5').disabled,true);
  for(let i=0;i<4;i++)nextGuide(get);
  assert.deepEqual(visibleGuideSteps(get),[5]);
  get('guide-nav-1').onclick();get('guide-amount').value=2;get('guide-amount').onchange();
  assert.equal(get('guide-comparisons').innerHTML,old);assert.equal(get('guide-note').value,'两小时试行的记录');
});

test('tiny nonzero money effects are not presented as zero improvement',async()=>{
  const {get,goal,listeners}=await boot('#guide');goal('income');
  get('guide-income-mode').value='output';get('guide-income-mode').onchange();nextGuide(get);
  listeners.input({target:{value:'0.001',dataset:{group:'plan',key:'wage'},setAttribute(){}}});
  nextGuide(get);
  const html=get('guide-comparisons').innerHTML;
  assert.match(html,/多不到 1 元/);assert.doesNotMatch(html,/多 0 元/);
});

test('progress styling and direct comparison charts track the active review state',async()=>{
  const {get,goal}=await boot('#guide');
  assert.equal(get('guide-nav-1')['data-complete'],'false');nextGuide(get);
  assert.equal(get('guide-nav-1')['data-complete'],'true');assert.equal(get('guide-nav-2')['data-complete'],'false');
  get('guide-nav-1').onclick();goal('income');
  assert.equal(get('guide-nav-1')['data-complete'],'false');assert.equal(get('guide-nav-2').disabled,true);
  get('guide-income-mode').value='output';get('guide-income-mode').onchange();
  assert.equal(get('guide-comparisons')['data-goal'],'income');
  assert.match(get('guide-comparisons').innerHTML,/compare-delta-bar/);
  assert.match(get('guide-comparisons').innerHTML,/<table class="guide-compare-table"/);
  assert.equal(get('professional-title').textContent,'更多工具');
});

test('guide keeps numerical tradeoffs and blockers without repeated explanatory copy',async()=>{
  const {get,go,goal,listeners}=await boot('#guide');
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const guide=html.slice(html.indexOf('<section id="guide"'),html.indexOf('<section id="decision"'));
  assert.doesNotMatch(guide,/guide-goal-hint|知识分不是|数字用于比较取舍|不是个人预测/);
  assert.match(guide,/相对原安排 · 观察\s*12\s*周/);
  assert.equal(get('page-description').hidden,true);go('model');assert.equal(get('page-description').hidden,false);go('guide');
  for(const [key,id] of [['learn','work'],['recover','work-to-leisure'],['income','leisure-to-work']]){
    goal(key);
    if(key==='income'){
      assert.equal(get('guide-next').disabled,true);assert.match(get('guide-step-hint').textContent,/先确认/);
      get('guide-income-mode').value='output';get('guide-income-mode').onchange();
      assert.match(get('guide-income-assumption').textContent,/80 元\/有效小时/);
    }
    const comparison=get('guide-comparisons').innerHTML;
    assert.doesNotMatch(comparison,/guide-cost|不代表|不是免费|情绪调节的空间/);
    assert.match(comparison,/最后剩多少钱/);assert.match(comparison,/最后一周有多累/);assert.match(comparison,/学习效果（折算小时）/);
    assert.match(get('guide-full-values').innerHTML,/最后学到多少/);
    assert.match(comparison,/小时/);assert.match(get('guide-excluded').innerHTML,/不减少|来源只有|均满足/);
    assert.doesNotMatch(get('guide-target').textContent,/不是保证/);
    for(let i=0;i<3;i++)nextGuide(get);
    listeners.change({target:{checked:true,dataset:{guideChoice:id}}});nextGuide(get);
    assert.deepEqual(visibleGuideSteps(get),[5]);
    assert.match(get('guide-trial-plan').innerHTML,/第 1 周模拟变化/);
    assert.doesNotMatch(get('guide-trial-plan').innerHTML,/不承诺|先修正假设|一周后回看/);
    assert.equal(get('guide-choice-summary').textContent.includes('不自动'),false);
  }
});
