// Weekly hypothesis model. Coefficients are not fitted clinical estimates.
export function sleepTransition(state,plan,parameters){
  const need=7*parameters.sleepNeed,hours=plan.sleep,debtBefore=state.sleepDebt;
  const deficit=Math.max(0,need-hours),surplus=Math.max(0,hours-need);
  const qualityFactor=.5+.5*state.sleepQuality/100;
  const availableDebt=debtBefore+deficit;
  const repaymentBudget=parameters.sleepDebtRepay*qualityFactor*surplus;
  const repaid=availableDebt>0?availableDebt*(-Math.expm1(-repaymentBudget/availableDebt)):0;
  const debtAfter=Math.max(0,availableDebt-repaid),meanDebt=(debtBefore+debtAfter)/2;
  // At personal need, adequacy=1. Above need it rises smoothly with diminishing returns.
  const adequacy=-Math.expm1(-hours/need)/(-Math.expm1(-1));
  const recovery=-Math.expm1(Math.log1p(-parameters.fatigueRecovery*qualityFactor)*adequacy);
  const debtFatigue=parameters.sleepDebtImpact*(-Math.expm1(-meanDebt/need));
  return {need,hours,deficit,surplus,debtBefore,availableDebt,repaymentBudget,repaid,debtAfter,meanDebt,
    qualityFactor,adequacy,recovery,debtFatigue,balanceResidual:debtAfter-(debtBefore+deficit-repaid)};
}
