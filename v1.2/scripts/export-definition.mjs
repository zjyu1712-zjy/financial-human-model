import {writeFile} from 'node:fs/promises';
import {VERSION,STATE_GROUPS,PLAN_GROUPS,PARAM_FIELDS,UTILITY_LABELS,DEFAULT_SCENARIO} from '../src/schema.js';
import {DEFAULT_MARGINAL,MARGINAL_METRICS,MARGINAL_CONTRIBUTIONS} from '../src/marginal.js';
import {createLearningDemoScenario,DEMO_GOALS} from '../src/demo.js';
import {DEFAULT_GUIDE,GUIDE_GOALS,GUIDE_OPTIONS,GUIDE_STEPS,GUIDE_AMOUNT} from '../src/guide.js';
import {DEFAULT_LIMITS,LIMIT_FIELDS,DEFAULT_COMPARE_VIEW} from '../src/comparison.js';
import {PAGES} from '../src/navigation.js';
import {WORKSPACE_KEY,TRIAL_KEY} from '../src/workspace.js';
import {SLEEP_CASES} from '../src/sleep-comparison.js';
import {PLAIN_FIELDS,PLAIN_GROUPS} from '../src/copy.js';
const value={version:VERSION,status:'uncalibrated-research-prototype',units:{time:'hours/week',money:'CNY',state:'self-referenced 0-100 index'},stateGroups:STATE_GROUPS,planGroups:PLAN_GROUPS,parameters:PARAM_FIELDS,utilityDimensions:UTILITY_LABELS,defaults:DEFAULT_SCENARIO,formulaSource:'src/model.js',specification:'MODEL_SPEC.txt',baselineCommit:'7e0c11da4592e1b1e9d98c3c6d32571cca822f69'};
value.units.sleepDebt='hours of cumulative unmet need, model ledger';
value.units.sleepNeed='hours/day';
value.sleep={source:'src/sleep.js',specification:'SLEEP_MODEL.txt',legacySource:'src/legacy-model.js',changesCoreEquations:true,
  states:['sleepDebt','sleepQuality','fatigue'],parameters:['sleepNeed','fatigueRecovery','sleepDebtRepay','sleepDebtImpact'],
  debtIdentity:'nextDebt = debt + max(0, weeklyNeed - sleep) - repaid',qualityFixedWithinProjection:true,
  assumesDebtRepaymentNeedsSurplus:true,defaultDebtIsUnmeasured:true,empiricallyFitted:false,
  demonstration:{source:'src/sleep-comparison.js',cases:SLEEP_CASES,weeks:52,extraHours:12,sources:['unallocated','leisure'],usesOwnBaselinePerModel:true}};
value.marginalAnalysis={source:'src/marginal.js',scope:'time-allocation',method:'forward-finite-difference',path:'deterministic-z0',defaults:DEFAULT_MARGINAL,metrics:MARGINAL_METRICS,contributions:MARGINAL_CONTRIBUTIONS,stepFactors:[0.5,1,2,4],denominator:'step hours multiplied by the number of changed weeks',limitations:['Not an exact derivative or empirical causal estimate','No automatic optimal policy','Work income follows effective hours, not a fixed salary']};
value.interface={entry:'index.html',defaultPage:'guide',navigationSource:'src/navigation.js',mode:'single-entry hash-routed pages',pages:PAGES};
value.learningDemo={source:'src/demo.js',scenario:createLearningDemoScenario(),weeks:12,amounts:[1,2,4],sources:['work','sleep'],independentOfCurrentExperiment:true};
value.goalDemos={source:'src/demo.js',goals:DEMO_GOALS,scenario:createLearningDemoScenario(),weeks:12,amounts:[1,2,4],incomeRule:'effective hours multiplied by the same hourly wage; spending unchanged',independentOfCurrentExperiment:true,preservesSelectionPerGoalAcrossReload:true};
value.decisionGuide={source:'src/guide.js',defaults:DEFAULT_GUIDE,goals:GUIDE_GOALS,options:GUIDE_OPTIONS,comparisonWeeks:[4,12,26,52],trialWeeks:1,usesCurrentScenarioAndSchedule:true,automaticallyRecalculates:true,storageKey:TRIAL_KEY,legacyReadKeys:['financial-human-weekly-trial-v2','financial-human-weekly-trial-v1'],requiresGoalImprovement:true,incomeRequiresEffectiveHourlyPay:true,usesExistingMarginalEngine:true,automaticallyRanksPlans:false,automaticallyCalibratesFromNotes:false};
value.decisionGuide.interface={mode:'one-step-at-a-time',steps:GUIDE_STEPS,initialStep:1,revisitCompletedSteps:true,preservesDraftsAcrossReload:true,invalidatedPlansRequireReselection:true,savedTrialOpensAtStep:5};
value.decisionGuide.amount={...GUIDE_AMOUNT,unit:'hours/week',control:'range',zero:'keep the original plan; no marginal division or new trial'};
value.decisionGuide.comparison={source:'src/comparison.js',limits:LIMIT_FIELDS,defaultLimits:DEFAULT_LIMITS,defaultView:DEFAULT_COMPARE_VIEW,
  effort:'planned time transferred each week multiplied by the comparison horizon',effectiveLearning:'sum of weekly model-estimated effective learning hours',
  cashMargin:'minimum of initial and weekly closing cash minus minCash; not intraday liquidity',sleepMargin:'minimum actual weekly sleep minus minSleep, after weekly overrides',
  incomeMargin:'candidate cumulative work income minus baseline cumulative work income plus maxIncomeLoss',unsetLimit:null,zeroIsExplicitLimit:true,
  charts:{main:'two plans, baseline and adjusted values, signed deltas with a separate scale per metric',weekly:['cash','fatigue','effectiveLearn'],includesOriginalPlan:true,deterministic:true},
  percentage:{formula:'100 * (adjusted - original) / original',rounding:'one decimal, calculated before display rounding',undefinedWhen:'original <= 1e-9 or nonfinite',fatigueSign:'negative means a reduced index, not a validated percentage improvement in experienced fatigue'},
  processFatigue:{average:'sum of week-end fatigue for weeks 1..H divided by H',burden:'sum of week-end fatigue times a 1-week interval',burdenUnit:'index point-weeks',excludesInitialState:true,notIntradayIntegral:true},
  invalidLimitDraftsBlockResults:true,preservesComparisonAndExpandedState:true,changesCoreEquations:false};
value.workspace={source:'src/workspace.js',storageKey:WORKSPACE_KEY,exportFormat:WORKSPACE_KEY,autoSave:true,atomicImport:true,includes:['current','baseline','schedule','baselineSchedule','weeks','marginalConfig','decision','notes','selections','demoSettings','invalidFieldDrafts','scheduleDraft','marginalDraft'],legacyExperimentFormat:'financial-human-experiment-v0.3',historicalTrialSnapshotIncluded:false};
value.decisionGuide.legacyReadKeys.unshift('financial-human-weekly-trial-v3');
value.decisionGuide.comparison.charts.weekly.push('sleepDebt');
value.workspace.legacyFormats=['financial-human-workspace-v1','financial-human-experiment-v0.3','financial-human-experiment-v1.0'];
value.workspace.migrationDefaults={sleepDebt:0,sleepNeed:8,sleepDebtRepay:.8,sleepDebtImpact:6};
value.workspace.writesLegacyKeys=false;
value.decisionGuide.legacyReadKeys.unshift('financial-human-weekly-trial-v4');
value.workspace.legacyFormats.push('financial-human-workspace-v1.1','financial-human-experiment-v1.1');
value.workspace.includes.push('sleepDiary');
value.interface.language={source:'src/copy.js',fields:PLAIN_FIELDS,groups:PLAIN_GROUPS,reference:'LANGUAGE_RESEARCH.txt',professionalDefinitionsRetained:true};
value.sleep.changedInVersion='1.1.0';value.sleep.unchangedFrom11=true;
value.sleepDiary={source:'src/sleep-diary.js',ui:'src/sleep-diary-ui.js',specification:'SLEEP_DIARY.txt',
  fields:{date:'local YYYY-MM-DD',hours:'previous night plus date naps, 0..24',fatigue:'date bedtime, subjective 0..10',quality:'1..5 mapped to 0,25,50,75,100',context:['ordinary','free','special'],note:'optional, not fitted'},
  reference:{recentDays:28,minRecords:14,minRestedFreeDays:5,maxFatigue:3,minQuality:3,hoursRange:[4,12],statistic:'median rounded to 0.25h',validatedNeedEstimator:false},
  weeks:'Monday-Sunday plus preceding Sunday fatigue, no interpolation',debtStart:'zero per continuous segment, requires explicit acceptance',
  fit:{parameter:'fatigueRecovery',minWeeks:6,maxWeeks:12,latestAgeDays:28,grid:[.05,.8,.01],training:'first floor(2n/3)',holdout:'remaining chronological weeks',maxNearOptimalSpan:.2,minimumHoldoutMSEReduction:1,minimumRelativeReduction:.1,conditionalOnOtherInputs:true},
  adoption:'explicit click, then linked recalculation',recordsDoNotMutateModel:true,keepsFixedExamples:true,localOnly:true};
await writeFile(new URL('../model-definition.json',import.meta.url),JSON.stringify(value,null,2)+'\n');
console.log('model-definition.json exported');
