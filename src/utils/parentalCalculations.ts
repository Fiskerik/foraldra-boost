import { addDays, addMonths, format, differenceInDays } from 'date-fns';
import { sv } from 'date-fns/locale';

export interface ParentData {
  income: number;
  hasCollectiveAgreement: boolean;
  taxRate: number;
}

export interface CalculationResult {
  netIncome: number;
  availableIncome: number;
  parentalBenefitPerDay: number;
  parentalSalaryPerDay: number;
}

export interface OptimizationResult {
  strategy: 'save-days' | 'maximize-income';
  title: string;
  description: string;
  periods: LeavePeriod[];
  totalIncome: number;
  daysUsed: number;
  daysSaved: number;
  averageMonthlyIncome: number;
}

export interface LeavePeriod {
  parent: 'parent1' | 'parent2' | 'both';
  startDate: Date;
  endDate: Date;
  daysCount: number;
  dailyBenefit: number;
  dailyIncome: number;
  benefitLevel: 'parental-salary' | 'high' | 'low' | 'none';
}

const PARENTAL_BENEFIT_CEILING = 49000; // SEK per month before tax
const HIGH_BENEFIT_DAYS = 390;
const LOW_BENEFIT_DAYS = 90;
const TOTAL_DAYS = 480;
const LOW_BENEFIT_AMOUNT = 180; // SEK per day
const HIGH_BENEFIT_RATE = 0.80; // 80% of income
const SGI_RATE = 0.97; // 97% of gross income for SGI calculation
const PRISBASBELOPP_2025 = 58800; // SEK per year
const PARENTAL_SALARY_THRESHOLD = (10 * PRISBASBELOPP_2025) / 12; // 49,000 kr/month
// Additional statutory thresholds
const GRUNDNIVA_MONTHLY_THRESHOLD = 9800; // SEK per month
const GRUNDNIVA_DAILY = 250; // SEK per day when income below threshold
const MAX_PARENTAL_BENEFIT_PER_DAY = 1250; // SEK per day cap

export function calculateNetIncome(grossIncome: number, taxRate: number): number {
  return grossIncome * (1 - taxRate / 100);
}

export function calculateDailyParentalBenefit(monthlyIncome: number): number {
  // Grundnivå om inkomsten är under tröskeln
  if (monthlyIncome < GRUNDNIVA_MONTHLY_THRESHOLD) {
    return GRUNDNIVA_DAILY;
  }
  // Beräkna SGI (97% av månadsinkomst) och tillämpa taket
  const sgiMonthly = monthlyIncome * SGI_RATE;
  const cappedMonthly = Math.min(sgiMonthly, PARENTAL_BENEFIT_CEILING);
  // Föräldrapenning = 80% av årsinkomsten/365
  const daily = (cappedMonthly * 12 * HIGH_BENEFIT_RATE) / 365;
  // Golv och tak enligt regler
  return Math.min(MAX_PARENTAL_BENEFIT_PER_DAY, Math.max(LOW_BENEFIT_AMOUNT, daily));
}

export function calculateParentalSalary(monthlyIncome: number): number {
  // Kollektivavtalslön enligt svenska regler 2025
  if (monthlyIncome <= PARENTAL_SALARY_THRESHOLD) {
    // 10% av lön upp till 10 prisbasbelopp/12
    return (monthlyIncome * 0.10) / 30;
  } else {
    // 10% upp till gränsen + 90% på delen över gränsen
    const basePart = PARENTAL_SALARY_THRESHOLD * 0.10;
    const excessPart = (monthlyIncome - PARENTAL_SALARY_THRESHOLD) * 0.90;
    return (basePart + excessPart) / 30;
  }
}

export function calculateAvailableIncome(
  parent: ParentData
): CalculationResult {
  const netIncome = calculateNetIncome(parent.income, parent.taxRate);
  const parentalBenefitPerDay = calculateDailyParentalBenefit(parent.income);
  const netParentalBenefitPerDay = calculateNetIncome(parentalBenefitPerDay * 30, parent.taxRate) / 30;
  
  let parentalSalaryPerDay = 0;
  let availableIncome = netParentalBenefitPerDay * 30; // default: endast FP
  
  if (parent.hasCollectiveAgreement) {
    parentalSalaryPerDay = calculateParentalSalary(parent.income);
    const netParentalSalaryPerDay = calculateNetIncome(parentalSalaryPerDay * 30, parent.taxRate) / 30;
    // Disponibel inkomst under föräldralönsperioden = FP + föräldralön (per dag)
    availableIncome = (netParentalBenefitPerDay + netParentalSalaryPerDay) * 30;
  }
  
  return {
    netIncome,
    availableIncome,
    parentalBenefitPerDay: netParentalBenefitPerDay,
    parentalSalaryPerDay: parentalSalaryPerDay > 0 ? calculateNetIncome(parentalSalaryPerDay * 30, parent.taxRate) / 30 : 0,
  };
}

export function optimizeLeave(
  parent1: ParentData,
  parent2: ParentData,
  totalMonths: number,
  parent1Months: number,
  parent2Months: number,
  minHouseholdIncome: number,
  simultaneousMonths: number = 0
): OptimizationResult[] {
  const calc1 = calculateAvailableIncome(parent1);
  const calc2 = calculateAvailableIncome(parent2);
  
  const totalDays = totalMonths * 30;
  const parent1Days = parent1Months * 30;
  const parent2Days = parent2Months * 30;
  
  const birthDate = new Date();
  const fixedEndDate = addMonths(birthDate, totalMonths);
  
  // Strategy 1: Save as many days as possible (minimize days used)
  const saveDaysResult = generateSaveDaysStrategy(
    parent1,
    parent2,
    calc1,
    calc2,
    parent1Days,
    parent2Days,
    minHouseholdIncome,
    birthDate,
    fixedEndDate,
    simultaneousMonths
  );
  
  // Strategy 2: Maximize income (use more days but optimize income)
  const maxIncomeResult = generateMaxIncomeStrategy(
    parent1,
    parent2,
    calc1,
    calc2,
    parent1Days,
    parent2Days,
    minHouseholdIncome,
    birthDate,
    fixedEndDate,
    simultaneousMonths
  );
  
  // Normalize both strategies to cover the same calendar period for fair comparison
  const sharedEndDate = fixedEndDate;

  const normalize = (result: OptimizationResult): OptimizationResult => {
    const periods = [...result.periods];
    const lastEnd = periods[periods.length - 1]?.endDate ?? birthDate;

    // Extend with non-leave (both working) period if this strategy ends earlier
    if (lastEnd < sharedEndDate) {
      const remainingDays = differenceInDays(sharedEndDate, lastEnd);
      if (remainingDays > 0) {
        const start = addDays(lastEnd, 1);
        periods.push({
          parent: 'both',
          startDate: start,
          endDate: sharedEndDate,
          daysCount: remainingDays,
          dailyBenefit: 0,
          dailyIncome: (calc1.netIncome + calc2.netIncome) / 30,
          benefitLevel: 'none'
        });
      }
    }

    // Recalculate metrics over the common horizon
    const totalIncome = periods.reduce((sum, p) => sum + p.dailyIncome * p.daysCount, 0);
    const leaveDaysUsed = periods
      .filter(p => p.benefitLevel !== 'none')
      .reduce((sum, p) => sum + (p.parent === 'both' ? p.daysCount * 2 : p.daysCount), 0);
    const daysSaved = Math.max(0, TOTAL_DAYS - leaveDaysUsed);
    const totalCalendarDays = differenceInDays(sharedEndDate, birthDate) + 1;
    const averageMonthlyIncome = totalCalendarDays > 0 ? (totalIncome / totalCalendarDays) * 30 : 0;

    return { ...result, periods, totalIncome, daysUsed: leaveDaysUsed, daysSaved, averageMonthlyIncome };
  };

  const normalizedSaveDays = normalize(saveDaysResult);
  const normalizedMaxIncome = normalize(maxIncomeResult);

  return [normalizedSaveDays, normalizedMaxIncome];
}

function generateSaveDaysStrategy(
  parent1: ParentData,
  parent2: ParentData,
  calc1: CalculationResult,
  calc2: CalculationResult,
  parent1Days: number,
  parent2Days: number,
  minHouseholdIncome: number,
  birthDate: Date,
  endDate: Date,
  simultaneousMonths: number = 0
): OptimizationResult {
  const periods: LeavePeriod[] = [];
  let currentDate = new Date(birthDate);
  let totalIncome = 0;

  // 1) ONLY the first 10 days are double days
  const bothPeriodEnd = addDays(currentDate, 10 - 1);
  const bothPeriodIncome = (calc1.parentalBenefitPerDay + calc2.parentalBenefitPerDay) * 10;
  periods.push({
    parent: 'both',
    startDate: new Date(currentDate),
    endDate: bothPeriodEnd,
    daysCount: 10,
    dailyBenefit: calc1.parentalBenefitPerDay + calc2.parentalBenefitPerDay,
    dailyIncome: bothPeriodIncome / 10,
    benefitLevel: 'high'
  });
  totalIncome += bothPeriodIncome;
  currentDate = addDays(bothPeriodEnd, 1);

  // Remaining leave-day pools (do NOT allow more simultaneous leave beyond the initial 10 days)
  let p1Remaining = Math.max(0, parent1Days - 10);
  let p2Remaining = Math.max(0, parent2Days - 10);

  // Target month counts derived from requested days
  const targetP1Months = Math.round(parent1Days / 30);
  const targetP2Months = Math.round(parent2Days / 30);
  let p1MonthsAssigned = 0;
  let p2MonthsAssigned = 0;

  // Daily income when both work
  const bothWorkDaily = (calc1.netIncome + calc2.netIncome) / 30;

  // Helper to compute months left from a date (ceil by 30)
  const monthsLeftFrom = (d: Date) => {
    const daysLeft = differenceInDays(endDate, d) + 1;
    return Math.max(0, Math.ceil(daysLeft / 30));
  };

  // 2) Month-by-month plan: meet min income with MINIMUM days/week, no double days
  while (currentDate <= endDate) {
    const daysLeft = differenceInDays(endDate, currentDate) + 1;
    if (daysLeft <= 0) break;

    const monthDays = Math.min(30, daysLeft);
    const monthsLeft = monthsLeftFrom(currentDate);

    // Remaining month slots per parent
    const p1MonthsLeft = Math.max(0, targetP1Months - p1MonthsAssigned);
    const p2MonthsLeft = Math.max(0, targetP2Months - p2MonthsAssigned);

    // Decide which parent must/should take this month to satisfy the month-distribution (Prio 2)
    // Hard constraints first
    let forcedParent: 'parent1' | 'parent2' | null = null;
    if (p1MonthsLeft > 0 && p2MonthsLeft === 0) forcedParent = 'parent1';
    else if (p2MonthsLeft > 0 && p1MonthsLeft === 0) forcedParent = 'parent2';
    else if (p1MonthsLeft === monthsLeft && p1MonthsLeft > 0) forcedParent = 'parent1';
    else if (p2MonthsLeft === monthsLeft && p2MonthsLeft > 0) forcedParent = 'parent2';

    type ParentPlan = {
      parent: 'parent1' | 'parent2';
      daysPerWeek: number;
      leaveDays: number;
      monthlyIncome: number;
      meetsRequirement: boolean;
    };

    const plans: ParentPlan[] = [];

    const evaluateParent = (who: 'parent1' | 'parent2') => {
      const hasRemaining = who === 'parent1' ? p1Remaining > 0 : p2Remaining > 0;
      if (!hasRemaining) return;

      const remaining = who === 'parent1' ? p1Remaining : p2Remaining;
      const whoCalc = who === 'parent1' ? calc1 : calc2;
      const otherCalc = who === 'parent1' ? calc2 : calc1;

      // Try 0..7 days/week and pick the FIRST that meets min income (Prio 3: as few as possible)
      for (let dpw = 0; dpw <= 7; dpw++) {
        const leaveDays = Math.min(Math.floor((dpw * monthDays) / 7), remaining);
        const workDays = monthDays - leaveDays;
        const leaveIncome = leaveDays * (whoCalc.parentalBenefitPerDay + otherCalc.netIncome / 30);
        const workIncome = workDays * bothWorkDaily;
        const monthlyIncome = leaveIncome + workIncome;
        plans.push({
          parent: who,
          daysPerWeek: dpw,
          leaveDays,
          monthlyIncome,
          meetsRequirement: monthlyIncome >= minHouseholdIncome,
        });
        if (monthlyIncome >= minHouseholdIncome) break; // minimal dpw found for this parent
      }
    };

    evaluateParent('parent1');
    evaluateParent('parent2');

    // Choose a plan
    let selected: ParentPlan | undefined;

    if (forcedParent) {
      // If forced by month distribution, take that parent's minimal plan
      const candidates = plans.filter(p => p.parent === forcedParent);
      // Prefer one that meets requirement with least days/week, else best income
      selected = candidates
        .filter(p => p.meetsRequirement)
        .sort((a,b) => a.daysPerWeek - b.daysPerWeek)[0]
        || candidates.sort((a,b) => b.monthlyIncome - a.monthlyIncome)[0];
    } else {
      // Otherwise prefer any plan that meets requirement with fewer days/week
      const valid = plans.filter(p => p.meetsRequirement);
      if (valid.length > 0) {
        // If tie on days/week, prefer the parent with higher monthlyIncome (closer above target)
        selected = valid.sort((a,b) => a.daysPerWeek - b.daysPerWeek || b.monthlyIncome - a.monthlyIncome)[0];
      } else {
        // Fallback: pick plan with highest monthly income (still no double days)
        selected = plans.sort((a,b) => b.monthlyIncome - a.monthlyIncome)[0];
      }
    }

    if (!selected) {
      // No plan possible (no remaining days). Everyone works this month.
      periods.push({
        parent: 'both',
        startDate: new Date(currentDate),
        endDate: addDays(currentDate, monthDays - 1),
        daysCount: monthDays,
        dailyBenefit: 0,
        dailyIncome: bothWorkDaily,
        benefitLevel: 'none',
      });
      totalIncome += monthDays * bothWorkDaily;
      currentDate = addDays(currentDate, monthDays);
      continue;
    }

    // If the selected plan doesn't need any leave to meet target but we MUST allocate this month
    // to satisfy the month-distribution, enforce the minimum: 1 day/week (rounded by month)
    const mustAllocateThisMonth = selected.parent === 'parent1' ? (p1MonthsLeft > 0) : (p2MonthsLeft > 0);
    let leaveDaysThisMonth = selected.leaveDays;
    if (leaveDaysThisMonth === 0 && mustAllocateThisMonth) {
      const minDays = Math.min(Math.ceil(monthDays / 7), selected.parent === 'parent1' ? p1Remaining : p2Remaining);
      leaveDaysThisMonth = Math.max(0, minDays);
    }

    // Create leave period (single parent only)
    if (leaveDaysThisMonth > 0) {
      const whoCalc = selected.parent === 'parent1' ? calc1 : calc2;
      const otherCalc = selected.parent === 'parent1' ? calc2 : calc1;
      const leavePeriodEnd = addDays(currentDate, leaveDaysThisMonth - 1);
      const leaveDailyIncome = whoCalc.parentalBenefitPerDay + otherCalc.netIncome / 30;
      periods.push({
        parent: selected.parent,
        startDate: new Date(currentDate),
        endDate: leavePeriodEnd,
        daysCount: leaveDaysThisMonth,
        dailyBenefit: whoCalc.parentalBenefitPerDay,
        dailyIncome: leaveDailyIncome,
        benefitLevel: 'high',
      });
      totalIncome += leaveDaysThisMonth * leaveDailyIncome;

      if (selected.parent === 'parent1') {
        p1Remaining -= leaveDaysThisMonth;
        p1MonthsAssigned += 1; // counts as a month with leave for parent1
      } else {
        p2Remaining -= leaveDaysThisMonth;
        p2MonthsAssigned += 1; // counts as a month with leave for parent2
      }

      // Remaining work days for the month
      const workDays = monthDays - leaveDaysThisMonth;
      if (workDays > 0) {
        periods.push({
          parent: 'both',
          startDate: addDays(leavePeriodEnd, 1),
          endDate: addDays(currentDate, monthDays - 1),
          daysCount: workDays,
          dailyBenefit: 0,
          dailyIncome: bothWorkDaily,
          benefitLevel: 'none',
        });
        totalIncome += workDays * bothWorkDaily;
      }
    } else {
      // No leave this month -> both work (this should be rare due to distribution enforcement)
      periods.push({
        parent: 'both',
        startDate: new Date(currentDate),
        endDate: addDays(currentDate, monthDays - 1),
        daysCount: monthDays,
        dailyBenefit: 0,
        dailyIncome: bothWorkDaily,
        benefitLevel: 'none',
      });
      totalIncome += monthDays * bothWorkDaily;
    }

    currentDate = addDays(currentDate, monthDays);
  }

  // Metrics
  const daysUsed = periods
    .filter(p => p.benefitLevel !== 'none')
    .reduce((sum, p) => sum + (p.parent === 'both' ? p.daysCount * 2 : p.daysCount), 0);
  const daysSaved = Math.max(0, TOTAL_DAYS - daysUsed);
  const totalDaysInPeriods = periods.reduce((sum, p) => sum + p.daysCount, 0);
  const averageMonthlyIncome = totalDaysInPeriods > 0 ? (totalIncome / totalDaysInPeriods) * 30 : 0;

  return {
    strategy: 'save-days',
    title: 'Spara dagar',
    description: 'Möt minimiinkomst varje månad, uppfyll fördelning och minimera dagar/vecka utan dubbeldagar',
    periods,
    totalIncome,
    daysUsed,
    daysSaved,
    averageMonthlyIncome,
  };
}

function generateMaxIncomeStrategy(
  parent1: ParentData,
  parent2: ParentData,
  calc1: CalculationResult,
  calc2: CalculationResult,
  parent1Days: number,
  parent2Days: number,
  minHouseholdIncome: number,
  birthDate: Date,
  endDate: Date,
  simultaneousMonths: number = 0
): OptimizationResult {
  const periods: LeavePeriod[] = [];
  let currentDate = new Date(birthDate);
  let totalIncome = 0;
  
  // First 10 days - both parents home
  const bothPeriodEnd = addDays(currentDate, 10 - 1);
  const bothPeriodIncome = (calc1.parentalBenefitPerDay + calc2.parentalBenefitPerDay) * 10;
  periods.push({
    parent: 'both',
    startDate: new Date(currentDate),
    endDate: bothPeriodEnd,
    daysCount: 10,
    dailyBenefit: calc1.parentalBenefitPerDay + calc2.parentalBenefitPerDay,
    dailyIncome: bothPeriodIncome / 10,
    benefitLevel: 'high'
  });
  totalIncome += bothPeriodIncome;
  currentDate = addDays(bothPeriodEnd, 1);
  
  // Add additional simultaneous period if requested (cap to available days per parent)
  if (simultaneousMonths > 0) {
    const requestedSimultaneousDays = simultaneousMonths * 30;
    const allowedSimultaneousDays = Math.max(
      0,
      Math.min(requestedSimultaneousDays, Math.max(0, parent1Days - 10), Math.max(0, parent2Days - 10))
    );
    if (allowedSimultaneousDays > 0) {
      const simultaneousPeriodEnd = addDays(currentDate, allowedSimultaneousDays - 1);
      const simultaneousIncome = (calc1.parentalBenefitPerDay + calc2.parentalBenefitPerDay) * allowedSimultaneousDays;
      periods.push({
        parent: 'both',
        startDate: new Date(currentDate),
        endDate: simultaneousPeriodEnd,
        daysCount: allowedSimultaneousDays,
        dailyBenefit: calc1.parentalBenefitPerDay + calc2.parentalBenefitPerDay,
        dailyIncome: simultaneousIncome / allowedSimultaneousDays,
        benefitLevel: 'high'
      });
      totalIncome += simultaneousIncome;
      currentDate = addDays(simultaneousPeriodEnd, 1);
    }
  }
  
  // Prioritize using parental salary days first (highest income)
  // Then use high benefit days
  // Alternate between parents to maximize household income
  
  const parent1HasSalary = parent1.hasCollectiveAgreement;
  const parent2HasSalary = parent2.hasCollectiveAgreement;
  
  let parent1RemainingDays = parent1Days;
  let parent2RemainingDays = parent2Days;
  let parent1SalaryDaysLeft = parent1HasSalary ? 180 : 0;
  let parent2SalaryDaysLeft = parent2HasSalary ? 180 : 0;
  let highBenefitDaysLeft = HIGH_BENEFIT_DAYS;
  
  // Use parental salary days first (highest income), 6 months contiguous, lower earner first
  const orderSalary: ('parent1' | 'parent2')[] = [];
  if (parent1HasSalary) orderSalary.push('parent1');
  if (parent2HasSalary) orderSalary.push('parent2');
  const salaryCalc = (who: 'parent1' | 'parent2') => who === 'parent1' ? calc1.netIncome : calc2.netIncome;
  orderSalary.sort((a,b) => salaryCalc(a) - salaryCalc(b));

  for (const who of orderSalary) {
    const hasLeft = who === 'parent1' ? parent1SalaryDaysLeft : parent2SalaryDaysLeft;
    const remaining = who === 'parent1' ? parent1RemainingDays : parent2RemainingDays;
    const daysToUse = Math.min(180, hasLeft, remaining, highBenefitDaysLeft); // max 6 months contiguous
    if (daysToUse > 0) {
      const periodEnd = addDays(currentDate, daysToUse - 1);
      const whoCalc = who === 'parent1' ? calc1 : calc2;
      const otherCalc = who === 'parent1' ? calc2 : calc1;
      const dailyLeaveIncome = whoCalc.parentalBenefitPerDay + whoCalc.parentalSalaryPerDay + otherCalc.netIncome / 30;
      const periodIncome = dailyLeaveIncome * daysToUse;
      periods.push({
        parent: who,
        startDate: new Date(currentDate),
        endDate: periodEnd,
        daysCount: daysToUse,
        dailyBenefit: whoCalc.parentalBenefitPerDay + whoCalc.parentalSalaryPerDay,
        dailyIncome: dailyLeaveIncome,
        benefitLevel: 'parental-salary'
      });
      totalIncome += periodIncome;
      if (who === 'parent1') {
        parent1RemainingDays -= daysToUse;
        parent1SalaryDaysLeft -= daysToUse;
      } else {
        parent2RemainingDays -= daysToUse;
        parent2SalaryDaysLeft -= daysToUse;
      }
      highBenefitDaysLeft -= daysToUse;
      currentDate = addDays(periodEnd, 1);
    }
  }
  
  // Use remaining high benefit days: lower earner first to maximize household income
  const orderHigh = (['parent1','parent2'] as ('parent1' | 'parent2')[]).sort((a,b) => (a==='parent1'?calc1.netIncome:calc2.netIncome) - (b==='parent1'?calc1.netIncome:calc2.netIncome));
  for (const who of orderHigh) {
    if ((who === 'parent1' ? parent1RemainingDays : parent2RemainingDays) > 0 && highBenefitDaysLeft > 0) {
      const daysToUse = Math.min(highBenefitDaysLeft, who === 'parent1' ? parent1RemainingDays : parent2RemainingDays);
      const periodEnd = addDays(currentDate, daysToUse - 1);
      const whoCalc = who === 'parent1' ? calc1 : calc2;
      const otherCalc = who === 'parent1' ? calc2 : calc1;
      const periodIncome = (whoCalc.parentalBenefitPerDay + otherCalc.netIncome / 30) * daysToUse;
      periods.push({
        parent: who,
        startDate: new Date(currentDate),
        endDate: periodEnd,
        daysCount: daysToUse,
        dailyBenefit: whoCalc.parentalBenefitPerDay,
        dailyIncome: periodIncome / daysToUse,
        benefitLevel: 'high'
      });
      totalIncome += periodIncome;
      if (who === 'parent1') {
        parent1RemainingDays -= daysToUse;
      } else {
        parent2RemainingDays -= daysToUse;
      }
      highBenefitDaysLeft -= daysToUse;
      currentDate = addDays(periodEnd, 1);
    }
  }
  
const daysUsed = periods.reduce((sum, p) => sum + (p.parent === 'both' ? p.daysCount * 2 : p.daysCount), 0);
const daysSaved = Math.max(0, TOTAL_DAYS - daysUsed);
const totalDaysInPeriods = periods.reduce((sum, p) => sum + p.daysCount, 0);
  const averageMonthlyIncome = totalDaysInPeriods > 0 ? (totalIncome / totalDaysInPeriods) * 30 : 0;
  
  return {
    strategy: 'maximize-income',
    title: 'Maximera inkomst',
    description: 'Optimerat för att få ut maximal inkomst under föräldraledigheten',
    periods,
    totalIncome,
    daysUsed,
    daysSaved,
    averageMonthlyIncome
  };
}

export function formatPeriod(period: LeavePeriod): string {
  return `${format(period.startDate, 'd MMM yyyy', { locale: sv })} - ${format(period.endDate, 'd MMM yyyy', { locale: sv })}`;
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('sv-SE', {
    style: 'currency',
    currency: 'SEK',
    maximumFractionDigits: 0
  }).format(amount);
}
