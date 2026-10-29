const report={version:'1.2.0',runnerVersion:'1.2-visibility-fix',runnerIntegrity:QA_BUILD.runnerIntegrity,integrity:QA_BUILD.integrity,userAgent:navigator.userAgent,startedAt:null,checks:[],errors:[]};
let frame,win,doc,width;
const prefix='financial-human-qa-'+Date.now()+'-';
const pause=()=>new Promise(resolve=>setTimeout(resolve,60));
const el=id=>doc.getElementById(id);
const assert=(value,message)=>{if(!value)throw new Error(message);};
const click=id=>el(id).click();
function input(id,value,type='input'){const target=el(id);assert(target,`Missing ${id}`);target.value=String(value);target.dispatchEvent(new win.Event(type,{bubbles:true}));}
async function page(key){win.location.hash=key;await pause();}
function step(n){click('guide-nav-'+n);}
function visible(element){return isRendered(element);}
function layout(label){assertLayout(doc,label);}
async function check(name,fn){
  try{await fn();report.checks.push({width,name,pass:true});}
  catch(error){report.checks.push({width,name,pass:false,error:error.message,...(error.diagnostics?{diagnostics:error.diagnostics}:{})});}
  document.getElementById('results').textContent=report.checks.map(c=>`${c.pass?'PASS':'FAIL'} ${c.width}px ${c.name}${c.error?'：'+c.error:''}`).join('\n');
}
window.__qaErrors=[];
window.__qaStorage={getItem:key=>localStorage.getItem(prefix+key),setItem:(key,value)=>localStorage.setItem(prefix+key,value)};
function clearTestStorage(){for(const key of Object.keys(localStorage))if(key.startsWith(prefix))localStorage.removeItem(key);}
async function load(){
  frame?.remove();frame=document.createElement('iframe');frame.style.width=width+'px';frame.title='回归测试视图';
  document.getElementById('preview').append(frame);
  const isolation=`<script>Object.defineProperty(window,'localStorage',{value:parent.__qaStorage});window.addEventListener('error',e=>parent.__qaErrors.push(e.message));<\/script>`;
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('页面加载超时')),8000);frame.onload=()=>{clearTimeout(timer);resolve();};frame.srcdoc=QA_BUILD.source.replace('<head>','<head>'+isolation);});
  win=frame.contentWindow;doc=frame.contentDocument;await pause();
}
const savedWorkspace=()=>JSON.parse(window.__qaStorage.getItem('financial-human-workspace-v1.2'));
function currentDiaryFixture(){
  const d=JSON.parse(JSON.stringify(QA_BUILD.diaryFixture)),now=new Date();
  const today=Date.UTC(now.getFullYear(),now.getMonth(),now.getDate());
  const lastSunday=today-new Date(today).getUTCDay()*86400000,oldEnd=Date.parse(d.records.at(-1).date+'T00:00:00Z');
  const shift=date=>new Date(Date.parse(date+'T00:00:00Z')+lastSunday-oldEnd).toISOString().slice(0,10);
  d.records.forEach(r=>r.date=shift(r.date));
  for(const w of d.weeks){w.end=shift(w.end);const end=Date.parse(w.end+'T00:00:00Z');w.fingerprint=JSON.stringify(d.records.filter(r=>{const t=Date.parse(r.date+'T00:00:00Z');return t>=end-7*86400000&&t<=end;}));}
  d.open=true;d.step=3;return d;
}
document.getElementById('run').onclick=async()=>{
  document.getElementById('run').disabled=true;report.startedAt=new Date().toISOString();report.checks=[];report.errors=[];window.__qaErrors=[];
  try{
    localStorage.setItem(prefix+'probe','1');localStorage.removeItem(prefix+'probe');
    for(width of [390,720,1024,1440]){
      clearTestStorage();await load();document.getElementById('status').textContent=`正在检查 ${width}px`;
      await check('启动与单步骤显示',()=>{assert(visible(el('guide-step-1')),'没有显示第一步');assert(!visible(el('guide-step-2')),'同时显示多个步骤');layout('第一步');});
      await check('0至48小时滑动、重算与刷新保留',async()=>{
        assert(el('guide-amount').type==='range'&&el('guide-amount').min==='0'&&el('guide-amount').max==='48'&&el('guide-amount').step==='1','滑块范围错误');
        for(const n of [0,3,5,12,24,48]){
          input('guide-amount',n);assert(el('guide-amount-value').textContent===String(n),'滑动时数字未更新');layout('调整'+n+'小时');
          assert(el('guide-amount').getBoundingClientRect().width<=doc.documentElement.clientWidth,'滑块越界');
          if(n===0){assert(el('guide-comparisons').innerHTML==='','0小时仍展示调整方案');assert(el('guide-next').disabled&&el('guide-save').disabled,'0小时仍可新增试行');}
          else assert(el('guide-target').textContent.includes(String(n*12)+' 小时'),'累计小时未同步');
        }
        await load();assert(el('guide-amount').value==='48','48小时未在刷新后保留');
        input('guide-amount',3);for(let i=0;i<3;i++)click('guide-next');
        doc.querySelector('[data-guide-choice="work"]').click();click('guide-next');input('guide-note','三小时草稿');
        step(1);input('guide-amount',5);input('guide-amount',3);assert(el('guide-note').value==='三小时草稿','来回修改时草稿丢失');
        input('guide-amount',2);
      });
      for(const [goal,choice] of [['learn','work'],['recover','work-to-leisure'],['income','leisure-to-work']]){
        await check(goal+' 五步完整流程',async()=>{
          await page('guide');step(1);click('guide-goal-'+goal);if(goal==='income')input('guide-income-mode','output','change');
          click('guide-next');layout('第二步');
          const helper=el('sleep-helper'),wasOpen=helper.open;
          helper.open=false;assert(!visible(el('diary-nav-1')),'收起的引导按钮仍被视为可见');layout('第二步收起引导');
          helper.open=true;assert(visible(el('diary-nav-1')),'展开后引导按钮未显示');layout('第二步展开引导');
          helper.open=wasOpen;input('personal-plan-work',40);assert(el('plan-work').value==='40','个人输入未镜像');
          click('guide-next');layout('第三步');assert(el('guide-comparisons').children.length>0,'没有候选结果');
          click('guide-next');layout('第四步');const radio=doc.querySelector('[data-guide-choice="'+choice+'"]');assert(radio,'缺少指定方案');radio.click();
          click('guide-next');assert(visible(el('guide-step-5')),'不能进入复盘');input('guide-note',goal+' 回归记录');layout('第五步');
          assert(!el('guide-save').disabled,'已选方案，但保存按钮仍被禁用');
          click('guide-save');assert(el('guide-message').textContent.includes('已保存'),'试行计划未保存：'+el('guide-message').textContent);
          const saved=JSON.parse(window.__qaStorage.getItem('financial-human-weekly-trial-v5'));
          assert(saved?.config.goal===goal&&saved.choiceId===choice&&saved.note===goal+' 回归记录','保存内容与当前方案不符');
        });
      }
      await check('百分比、过程疲劳与零基准',async()=>{
        await page('guide');step(1);click('guide-goal-recover');input('guide-amount',12);
        click('guide-next');input('guide-weeks',52,'change');click('guide-next');
        assert(el('guide-comparisons').textContent.includes('这段时间平均有多累'),'缺少过程疲劳');
        assert(el('guide-comparisons').textContent.includes('−8.6%'),'疲劳百分比未按原始数值计算');
        assert(el('guide-comparisons').textContent.includes('睡眠 +21.4%'),'时间投入百分比错误');
        assert(doc.querySelectorAll('.compare-percent').length>=8,'结果缺少变化百分比');layout('百分比与平均疲劳');
        const before=el('guide-comparisons').textContent;await page('model');await page('guide');await load();
        assert(el('guide-comparisons').textContent===before,'刷新后的百分比或平均疲劳改变');
        step(1);click('guide-goal-learn');input('guide-amount',2);click('guide-next');input('guide-weeks',12,'change');
        input('personal-plan-learn',0);click('guide-next');
        assert(el('guide-comparisons').textContent.includes('原值为0'),'零基准仍给出误导百分比');
        assert(!/NaN|Infinity/.test(el('guide-comparisons').textContent),'百分比出现非有限值');layout('零基准');
        input('plan-learn',6);
      });
      await check('投入回报图与两两方案对照',async()=>{
        await page('guide');step(1);click('guide-goal-learn');click('guide-next');click('guide-next');
        assert(el('guide-comparisons').textContent.includes('总共挪了多少时间'),'缺少投入对照');
        assert(el('guide-comparisons').textContent.includes('学习效果（折算小时）'),'缺少学习效果（折算）');
        assert(doc.querySelectorAll('.compare-delta-bar').length>=6,'没有收益代价横条');
        const a=el('guide-compare-a').value,b=el('guide-compare-b').value;
        input('guide-compare-a',b,'change');assert(el('guide-compare-b').value===a,'对照未交换或重复');
        assert(el('guide-direct-summary').textContent.includes('方案B比方案A'),'缺少直接差值');layout('直接对照');
      });
      await check('个人底线筛选、无效草稿与恢复',async()=>{
        click('guide-edit-limits');input('guide-limit-minCash',1000);input('guide-limit-minSleep',50);input('guide-limit-maxIncomeLoss',5000);
        click('guide-next');assert(el('guide-margins').textContent.includes('余量'),'未显示底线余量');layout('底线余量');
        click('guide-edit-limits');input('guide-limit-maxIncomeLoss',0);
        assert(!doc.querySelector('[data-guide-choice="work"]'),'越过收入底线的方案仍可选择');
        input('guide-limit-minCash',-1);assert(el('guide-comparisons').innerHTML==='','底线无效仍显示旧结果');
        await load();assert(el('guide-limit-minCash').value==='-1','底线草稿未恢复');
        input('guide-limit-minCash',1000);input('guide-limit-maxIncomeLoss',5000);layout('底线输入');
      });
      await check('逐周图表、展开明细及跨页刷新',async()=>{
        step(2);click('guide-next');el('guide-trend-details').open=true;el('guide-detail-details').open=true;await pause();
        for(const key of ['cash','fatigue','effectiveLearn','sleepDebt']){
          click('guide-trend-'+key);const paths=[...doc.querySelectorAll('[data-guide-series]')];
          assert(paths.length===3,'缺少原安排或备选曲线');assert(paths.every(p=>p.getTotalLength()>0),'空白曲线');
          const svg=el('guide-trend-chart').querySelector('svg'),bounds=svg.viewBox.baseVal;
          assert(paths.every(p=>{const b=p.getBBox();return b.x>=0&&b.y>=0&&b.x+b.width<=bounds.width+1&&b.y+b.height<=bounds.height+1;}),'曲线超出画布');
          layout('逐周'+key);
        }
        click('guide-trend-cash');assert(el('guide-trend-chart').textContent.includes('我的现金底线'),'缺少现金底线');
        const before=el('guide-trend-values').textContent;await page('model');await page('guide');await load();
        assert(el('guide-trend-details').open&&el('guide-detail-details').open,'展开状态丢失');
        assert(el('guide-trend-cash').checked&&el('guide-limit-minCash').value==='1000','指标或底线丢失');
        assert(el('guide-trend-values').textContent===before,'刷新后的图表数值不同');layout('展开对照');
      });
      await check('底层参数自动重算并保留文字',async()=>{
        step(1);click('guide-goal-learn');for(let i=0;i<3;i++)click('guide-next');doc.querySelector('[data-guide-choice="work"]').click();click('guide-next');
        input('guide-note','自动联动后的草稿');const before=el('guide-trial-plan').innerHTML;
        const knowledge=()=>[...el('guide-full-values').querySelectorAll('tbody tr')].find(row=>row.cells[0].textContent==='最后学到多少（分）')?.textContent;
        const knowledgeBefore=knowledge(),comparisonBefore=el('guide-comparisons').innerHTML;
        assert(knowledgeBefore,'缺少知识积累结果');
        await page('model');input('parameters-learningGain',2);await page('guide');
        assert(knowledge()!==knowledgeBefore,'调整学习系数后知识积累未更新');
        assert(el('guide-comparisons').innerHTML!==comparisonBefore,'调整学习系数后周期对照未更新');
        // Learning gain changes knowledge, not first-week effective hours or cash.
        assert(el('guide-trial-plan').innerHTML===before,'学习增益系数错误地改变了第一周投入或现金');
        const wage=Number(el('plan-wage').value);input('plan-wage',wage+10);
        assert(el('guide-trial-plan').innerHTML!==before,'调整时薪后第一周现金结果未更新');
        input('plan-wage',wage);assert(el('guide-trial-plan').innerHTML===before,'恢复时薪后第一周结果未恢复');
        assert(el('guide-note').value==='自动联动后的草稿','复盘丢失');
      });
      await check('方案失效、恢复与草稿',()=>{
        input('plan-work',0);assert(!doc.querySelector('[data-guide-choice="work"]'),'失效方案仍可选择');
        input('plan-work',40);assert(el('guide-note').value==='自动联动后的草稿','恢复输入后草稿丢失');
      });
      await check('无效输入不显示旧方案',()=>{
        input('plan-work','');assert(el('guide-comparisons').innerHTML==='','仍展示旧结果');assert(el('guide-save').disabled,'无效状态仍可保存试行');
        input('plan-work',40);assert(el('guide-comparisons').innerHTML!=='','修正后未恢复');
      });
      await check('刷新后输入和草稿恢复',async()=>{
        await load();assert(el('parameters-learningGain').value==='2','参数未恢复');assert(el('guide-note').value==='自动联动后的草稿','草稿未恢复');
      });
      await check('固定示例隔离与各档比较',async()=>{
        await page('demo');const before=el('demo-results').innerHTML;
        await page('model');input('parameters-learningGain',3);await page('demo');assert(el('demo-results').innerHTML===before,'个人参数改变了固定示例');
        for(const goal of ['learn','recover','income']){click('demo-goal-'+goal);for(const amount of ['1','2','4','all']){click('demo-'+amount);layout(goal+amount);assert(doc.querySelectorAll('[data-demo-option]').length===(amount==='all'?6:2),'示例数量错误');}}
      });
      for(const key of ['guide','decision','systems','model','marginal','evidence','files'])await check(key+' 页面布局',async()=>{await page(key);layout(key);});
      clearTestStorage();await load();
      await check('个人睡眠需求、估计欠的睡眠与恢复联动',async()=>{
        click('guide-goal-recover');input('guide-amount',12);click('guide-next');input('guide-weeks',52,'change');
        for(const [id,mirror,value] of [['personal-parameters-sleepNeed','parameters-sleepNeed',9],['personal-state-sleepDebt','state-sleepDebt',14],['personal-state-sleepQuality','state-sleepQuality',60],['personal-parameters-fatigueRecovery','parameters-fatigueRecovery',.4]]){
          const before=el('guide-comparisons').innerHTML;input(id,value);
          assert(el(mirror).value===String(value),'字段未镜像：'+id);
          assert(el('guide-comparisons').innerHTML!==before,'字段未重算：'+id);
        }
        layout('睡眠个人输入');click('guide-next');assert(el('guide-comparisons').textContent.includes('最后还差多少睡眠'),'没有估计欠的睡眠结果');
        el('guide-trend-details').open=true;click('guide-trend-sleepDebt');layout('估计欠的睡眠曲线');
      });
      await check('睡眠参数往返、无效输入与试行草稿',async()=>{
        click('guide-next');doc.querySelector('[data-guide-choice="unallocated-to-sleep"]').click();click('guide-next');input('guide-note','新版睡眠测试草稿');
        const before=el('guide-comparisons').innerHTML;await page('model');input('parameters-sleepDebtRepay',.3);layout('睡眠模型参数');
        assert(el('guide-comparisons').innerHTML!==before,'偿还效率未重算');
        input('parameters-sleepNeed','');assert(el('guide-comparisons').innerHTML==='','无效需求仍显示结果');await load();
        assert(el('parameters-sleepNeed').value==='','无效需求草稿丢失');input('parameters-sleepNeed',9);await page('guide');
        assert(el('guide-note').value==='新版睡眠测试草稿','睡眠复盘丢失');assert(el('parameters-sleepDebtRepay').value==='0.3','参数未恢复');
      });
      await check('新旧睡眠模型六种对照与曲线边界',async()=>{
        await page('demo');
        for(const key of ['original','higherNeed','existingDebt'])for(const source of ['unallocated','leisure']){
          click('sleep-case-'+key);input('sleep-demo-source',source,'change');
          const text=el('sleep-demo-results').textContent;
          assert(text.includes('旧模型 1.0')&&text.includes('现模型（1.1起）')&&text.includes('这段时间平均有多累'),'新旧对照缺失');
          assert(text.includes('未建模'),'旧版伪造估计欠的睡眠');assert(!/NaN|Infinity/.test(text),'无效结果');
          const paths=[...doc.querySelectorAll('[data-sleep-model]')],svg=el('sleep-demo-chart').querySelector('svg'),bounds=svg.viewBox.baseVal;
          assert(paths.length===2&&paths.every(p=>p.getTotalLength()>0),'新旧曲线为空');
          assert(paths.every(p=>{const b=p.getBBox();return b.x>=0&&b.y>=0&&b.x+b.width<=bounds.width+1&&b.y+b.height<=bounds.height+1;}),'新旧曲线越界');
          layout('新旧睡眠'+key+source);
        }
      });
      await check('睡眠固定示例隔离、切换与刷新保留',async()=>{
        const before=el('sleep-demo-results').innerHTML;await page('model');input('parameters-sleepNeed',10);input('state-sleepDebt',42);await page('demo');
        assert(el('sleep-demo-results').innerHTML===before,'个人输入污染固定示例');await load();await page('demo');
        assert(el('sleep-case-existingDebt').checked&&el('sleep-demo-source').value==='leisure','睡眠示例选择丢失');
        assert(el('sleep-demo-results').innerHTML===before,'示例刷新后结果改变');
        assert(el('personal-parameters-sleepNeed').value==='10'&&el('personal-state-sleepDebt').value==='42','个人输入被示例覆盖');
      });
      clearTestStorage();await load();
      await check('整站日常用语与睡眠引导逐步显示',async()=>{
        await page('marginal');assert(el('page-title').textContent==='多花一小时，值不值？','边际页仍是技术标题');
        await page('systems');assert(el('state-controls').textContent.includes('现在有多累'),'当前状态未使用日常用语');
        await page('model');el('model-language').open=true;el('model-diary').open=true;layout('完整定义');
        await page('guide');click('guide-next');el('sleep-helper').open=true;await pause();
        for(let n=1;n<=3;n++){click('diary-nav-'+n);assert([1,2,3].filter(i=>visible(el('diary-stage-'+i))).join()===String(n),'同时展示多个记录步骤');layout('记录引导'+n);}
        assert(el('diary-adopt-need').disabled&&el('diary-adopt-actual').disabled&&el('diary-adopt-recovery').disabled,'无数据时提供了采用操作');
      });
      await check('每日记录校验、保存与模型隔离',()=>{
        click('diary-nav-2');const before=JSON.stringify(savedWorkspace().experiment);
        input('diary-hours',7.5);input('diary-fatigue',4);click('diary-save');
        assert(savedWorkspace().sleepDiary.records.length===0,'缺少睡眠感受仍保存');
        input('diary-quality',4);input('diary-context','ordinary');input('diary-note','浏览器回归记录');click('diary-save');
        const d=savedWorkspace().sleepDiary;assert(d.records.length===1&&d.records[0].hours===7.5,'每日记录未正确保存');
        assert(JSON.stringify(savedWorkspace().experiment)===before,'保存记录偷偷修改模型');
        el('diary-history').closest('details').open=true;layout('记录表单和历史');
      });
      await check('按日期保留草稿、撤销删除与刷新',async()=>{
        const date=el('diary-date').value,prior=new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10);
        input('diary-hours','');input('diary-date',prior,'change');input('diary-hours',6.5);input('diary-date',date,'change');
        assert(el('diary-hours').value==='','切换日期后空值草稿被覆盖');
        doc.querySelector('[data-diary-delete="'+date+'"]').click();assert(savedWorkspace().sleepDiary.records.length===0,'删除未生效');
        click('diary-undo');assert(savedWorkspace().sleepDiary.records.length===1,'撤销未恢复记录');
        input('diary-hours',7.25);click('diary-to-summary');await page('files');await page('guide');await load();
        assert(el('diary-hours').value==='7.25'&&visible(el('diary-stage-3')),'刷新后草稿或步骤丢失');layout('记录刷新后');
      });
      await check('完整周恢复试算、采用与结果联动',async()=>{
        clearTestStorage();await load();const data=savedWorkspace();data.sleepDiary=currentDiaryFixture();data.decision.step=2;data.decision.reached=2;
        window.__qaStorage.setItem('financial-human-workspace-v1.2',JSON.stringify(data));await load();
        const demo=el('demo-results').innerHTML,before=el('guide-comparisons').innerHTML,baseline=JSON.stringify(savedWorkspace().experiment.baseline);
        assert(!el('diary-adopt-recovery').disabled,'合格的合成记录未提供恢复试算');
        click('diary-zero');assert(el('diary-adopt-recovery').disabled,'未确认起点仍可采用恢复设置');click('diary-zero');
        el('diary-fit-detail').closest('details').open=true;layout('记录修正结果');click('diary-adopt-recovery');
        assert(el('parameters-fatigueRecovery').value==='0.45','恢复设置未采用');assert(el('guide-comparisons').innerHTML!==before,'方案未自动重算');
        assert(el('demo-results').innerHTML===demo&&JSON.stringify(savedWorkspace().experiment.baseline)===baseline,'个人记录污染示例或对照');
      });
      await check('每周实际安排、跨周草稿与采用起点',async()=>{
        const d=savedWorkspace().sleepDiary,end=d.weeks.at(-1).end,prior=d.weeks.at(-2).end;
        el('diary-week-select').closest('details').open=true;input('diary-week-select',end,'change');input('diary-week-work',38);
        input('diary-week-select',prior,'change');input('diary-week-select',end,'change');assert(el('diary-week-work').value==='38','跨周草稿丢失');
        input('diary-week-work',168);click('diary-confirm-week');assert(el('diary-message').textContent.includes('168'),'超出一周仍被确认');
        input('diary-week-work',38);click('diary-confirm-week');click('diary-adopt-actual');
        assert(el('plan-work').value==='38'&&Number(el('plan-sleep').value)>54,'实际一周未进入个人输入');layout('采用后');
        await load();assert(el('personal-plan-work').value==='38'&&el('parameters-fatigueRecovery').value==='0.45','记录修正后刷新丢失');
        assert(savedWorkspace().sleepDiary.records.length===43,'采用修改了原始记录');
      });
    }
    report.errors=[...window.__qaErrors];
  }catch(error){report.errors.push(error.message);}
  finally{
    try{clearTestStorage();}catch(error){report.errors.push(error.message);}
    report.finishedAt=new Date().toISOString();report.passed=report.checks.length===120&&report.checks.every(c=>c.pass)&&report.errors.length===0;
    document.getElementById('status').textContent=`${report.passed?'检查通过':'检查发现问题'}：${report.checks.filter(c=>c.pass).length}/${report.checks.length} 项${report.errors.length?'；'+report.errors.join('；'):''}`;
    document.getElementById('download').disabled=false;document.getElementById('run').disabled=false;
  }
};
document.getElementById('download').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='financial-human-1.2-browser-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
