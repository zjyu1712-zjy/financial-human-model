export const VERSION = '1.2.0';
const f = (key, label, unit, min, max, value, meaning) => ({key,label,unit,min,max,value,meaning});
export const STATE_GROUPS = [
  {id:'body',name:'身体与恢复',fields:[
    f('health','基础健康','分',0,100,80,'主观功能状态，不是疾病诊断；100 为本人健康参照'),
    f('sleepQuality','睡眠质量','分',0,100,75,'最近一周自评睡眠恢复质量'),
    f('fatigue','累积疲劳','分',0,100,30,'跨周保留；越高表示越疲惫'),
    f('sleepDebt','期初睡眠债','小时',0,10000,0,'尚未补足的累计睡眠时长差额；0为默认假设，不是实测结论；与金融债务分开')
  ]},
  {id:'cognition',name:'认知与判断',fields:[
    f('knowledge','任务相关知识','分',0,100,60,'相对当前任务所需知识，不是智商'),
    f('calibration','判断校准','分',0,100,60,'预测与结果吻合程度；无记录时为自评'),
    f('metacognition','复盘与自知','分',0,100,65,'识别错误和修正假设的能力'),
    f('bias','判断偏差','分',0,100,30,'冲动、确认偏误等的汇总代理；越高越不利')
  ]},
  {id:'emotion',name:'情绪与动机',fields:[
    f('regulation','调节能力','分',0,100,65,'识别情绪、暂停反应和求助能力'),
    f('rumination','反刍程度','分',0,100,30,'重复思考造成的注意力占用'),
    f('stress','累积压力','分',0,100,30,'跨周保留的情绪负荷'),
    f('motivation','内在动机','分',0,100,65,'行动与个人意愿一致时的持续动力')
  ]},
  {id:'social',name:'关系与支持',fields:[
    f('support','可用支持','分',0,100,65,'需要时可实际获得的帮助'),
    f('trust','关系信任','分',0,100,65,'可靠、互惠和边界的综合评价'),
    f('network','机会触达','分',0,100,50,'相关领域的连接质量'),
    f('conflict','关系冲突','分',0,100,25,'未解决冲突与关系消耗')
  ]},
  {id:'finance',name:'资金与负债',fields:[
    f('cash','现金余额','元',0,100000000,30000,'不含风险资产；不得通过截断掩盖负余额'),
    f('assets','风险资产市值','元',0,100000000,20000,'单一汇总风险资产；买入是资产转换而非收益'),
    f('debt','债务本金','元',0,100000000,10000,'计息负债；本金偿还不是净财富损失')
  ]},
  {id:'desire',name:'欲望与自主',fields:[
    f('clarity','价值清晰度','分',0,100,65,'能否辨别自己真正想要什么'),
    f('agency','选择自主感','分',0,100,65,'相同时间安排也可能是自愿或被迫'),
    f('comparison','比较与身份压力','分',0,100,40,'外部比较的驱动力；也进入情绪负荷'),
    f('targetSpend','期望品质支出','元/周',0,1000000,500,'在必要支出之外，希望维持的品质消费水平')
  ]}
];
export const PLAN_GROUPS = [
  {id:'time',name:'每周时间',fields:[
    f('sleep','睡眠','小时/周',0,168,56,'睡眠实际时长'),f('work','工作','小时/周',0,168,40,'投入时长；收入受有效工作效率影响'),
    f('learn','学习','小时/周',0,168,6,'投入时长；产出受身体、动机和偏差影响'),f('exercise','运动','小时/周',0,168,3,'适度活动投入；收益饱和'),
    f('relation','关系投入','小时/周',0,168,6,'陪伴、沟通与合作'),f('leisure','自主休闲','小时/周',0,168,12,'自愿安排的休闲时间'),
    f('care','照护与必要事务','小时/周',0,168,21,'家务、通勤及照护，不直接算作自主时间')
  ]},
  {id:'money',name:'每周资金安排',fields:[
    f('wage','标准时薪','元/有效小时',0,100000,80,'研究示例按有效小时计酬；固定薪资需另建收入规则'),
    f('essential','必要支出','元/周',1,1000000,800,'基础生活、住房等必要开支'),f('discretionary','品质消费','元/周',0,1000000,300,'不含学习支出和情绪性额外支出'),
    f('learningSpend','学习支出','元/周',0,1000000,100,'课程或训练支出，仅记账；不保证学习增益'),
    f('buy','买入风险资产','元/周',0,10000000,500,'以现金购买；与卖出不可同时为正'),f('sell','卖出风险资产','元/周',0,10000000,0,'仅可卖出当前持有的市值'),
    f('repay','偿还本金','元/周',0,10000000,100,'最多偿还剩余本金，末周自动减少'),
    f('valueFit','行动价值匹配','分',0,100,75,'该安排是否符合自己的价值，不由花钱多少替代')
  ]},
  {id:'shocks',name:'第一周外部冲击',fields:[
    f('marketShock','市场收益冲击','比例',-0.8,0.8,0,'例如 -0.10 表示当周额外下跌 10%，随后衰减'),
    f('healthShock','健康损耗','分',0,50,0,'外部健康事件造成的状态减量'),f('incomeShock','收入变动','比例',-1,1,0,'与市场、健康冲击分开定义')
  ]}
];
export const PARAM_FIELDS = [
  f('fatigueRecovery','基础疲劳恢复率','比例/周',0.05,0.8,0.30,'睡到个人需求且质量为100分时的每周恢复比例；有效恢复率另由时长和质量计算'),
  f('learningGain','学习增益系数','分/根号有效小时',0.1,4,1.2,'学习饱和增益；可试拟合'),
  f('annualReturn','风险资产期望年收益','比例/年',-0.3,0.4,0.05,'纯情景假设，不代表市场预测'),
  f('annualVol','风险资产年波动','比例/根号年',0.01,1,0.20,'年度标准差；按根号 52 换算周波动'),
  f('debtAPR','债务年利率','比例/年',0,0.5,0.08,'周利息=期初本金×年利率/52'),
  f('bufferWeeks','现金缓冲目标','周',1,52,8,'必要支出的目标覆盖周数，偏好而非建议'),
  f('riskTolerance','额外损失容忍比例','比例',0,0.5,0.1,'对正净财富的主观容忍比例'),
  f('beta','每周贴现因子','比例',0.8,1,0.99,'时间偏好；不是生理恢复系数'),
  f('shockRetention','冲击留存率','比例/周',0,1,0.5,'仅衰减外部指定冲击'),
  f('emotionRate','情绪不适权重','效用分/负荷分',0,1,0.12,'只评价即时情绪不适，不再扣实际金钱损失'),
  f('healthRate','疲劳不适权重','效用分/疲劳分',0,1,0.10,'只评价高疲劳当期不适'),
  f('desireRate','欲望失配权重','效用分/失配分',0,1,0.10,'品质缺口与价值偏离的体验成本'),
  f('riskRate','风险不适权重','效用分/压力分',0,1,0.08,'风险敞口的主观不适，不重复扣市场亏损'),
  f('sleepNeed','个人睡眠需求','小时/天',4,12,8,'个人假设，换算成7天需求；输入边界不是医学建议，默认8小时待核对'),
  f('sleepDebtRepay','补眠偿还效率','债小时/超需睡眠小时',0,1,0.8,'超出个人需求的睡眠可逐步偿还睡眠债；上限1，不把补眠机械等同于逐小时偿还'),
  f('sleepDebtImpact','睡眠债疲劳强度','分/周',0,30,6,'历史睡眠债对每周疲劳的平滑饱和增量上限；需真实连续记录校准')
];
export const UTILITY_LABELS = {safety:'安全',autonomy:'自主',quality:'品质',relation:'关系',growth:'成长',meaning:'意义'};
export const SYSTEM_LABELS = {body:'身体',cognition:'认知',emotion:'情绪',social:'关系',finance:'金融',desire:'欲望'};
export const TIME_KEYS = ['sleep','work','learn','exercise','relation','leisure','care'];
export const DEFAULT_SCENARIO = {
  version:VERSION,
  state:Object.fromEntries(STATE_GROUPS.flatMap(g=>g.fields).map(f=>[f.key,f.value])),
  plan:Object.fromEntries(PLAN_GROUPS.flatMap(g=>g.fields).map(f=>[f.key,f.value])),
  parameters:Object.fromEntries(PARAM_FIELDS.map(f=>[f.key,f.value])),
  weights:Object.fromEntries(Object.keys(UTILITY_LABELS).map(k=>[k,1]))
};
export function clone(value){return JSON.parse(JSON.stringify(value));}
export function validateScenario(input){
  const errors=[];
  if(!input || input.version!==VERSION) return ['文件版本不匹配，需使用1.1数据或导入旧版数据'];
  const check=(group,fields)=>{
    const object=input[group];
    if(!object || typeof object!=='object' || Array.isArray(object)){errors.push(`${group} 缺失`);return;}
    const allowed=new Set(fields.map(f=>f.key));
    for(const key of Object.keys(object)) if(!allowed.has(key))errors.push(`${group}.${key} 未定义`);
    for(const f of fields) if(!Number.isFinite(object[f.key]) || object[f.key]<f.min || object[f.key]>f.max) errors.push(`${f.label}需在 ${f.min}–${f.max} ${f.unit}之间`);
  };
  check('state',STATE_GROUPS.flatMap(g=>g.fields));check('plan',PLAN_GROUPS.flatMap(g=>g.fields));check('parameters',PARAM_FIELDS);
  check('weights',Object.entries(UTILITY_LABELS).map(([key,label])=>({key,label,min:0,max:10})));
  if(input.weights && Object.values(input.weights).every(v=>v===0))errors.push('至少一项效用权重大于零');
  if(input.plan?.buy>0 && input.plan?.sell>0)errors.push('同一周不能同时设置买入和卖出');
  return errors;
}
export function upgradeScenario(input){
  if(!input || ![VERSION,'1.1.0','1.0.0','0.3.0-research'].includes(input.version))throw new Error('不支持的数据版本');
  const scenario={...clone(input),version:VERSION};
  if(input.version!==VERSION){
    scenario.state={...scenario.state,sleepDebt:scenario.state?.sleepDebt??0};
    scenario.parameters={sleepNeed:8,sleepDebtRepay:.8,sleepDebtImpact:6,...scenario.parameters};
  }
  const errors=validateScenario(scenario);
  if(errors.length)throw new Error(errors.join('；'));
  return scenario;
}
