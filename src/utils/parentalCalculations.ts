import { addDays, format, differenceInDays } from 'date-fns';
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

const PARENTAL_BENEFIT_CEILING = 38000; // SEK per month before tax
const HIGH_BENEFIT_DAYS = 390;
const LOW_BENEFIT_DAYS = 90;
const TOTAL_DAYS = 480;
const LOW_BENEFIT_AMOUNT = 180; // SEK per day
const HIGH_BENEFIT_RATE = 0.80; // 80% of income

export function calculateNetIncome(grossIncome: number, taxRate: number): number {
  return grossIncome * (1 - taxRate / 100);
}

export function calculateDailyParentalBenefit(monthlyIncome: number): number {
  const cappedIncome = Math.min(monthlyIncome, PARENTAL_BENEFIT_CEILING);
  return (cappedIncome * HIGH_BENEFIT_RATE) / 30;
}

export function calculateParentalSalary(monthlyIncome: number): number {
  // Generell kollektivavtalslön: 90% av lön i 180 dagar (6 månader)
  return (monthlyIncome * 0.90) / 30;
}

export function calculateAvailableIncome(
  parent: ParentData
): CalculationResult {
  const netIncome = calculateNetIncome(parent.income, parent.taxRate);
  const parentalBenefitPerDay = calculateDailyParentalBenefit(parent.income);
  const netParentalBenefitPerDay = calculateNetIncome(parentalBenefitPerDay * 30, parent.taxRate) / 30;
  
  let parentalSalaryPerDay = 0;
  let availableIncome = netIncome;
  
  if (parent.hasCollectiveAgreement) {
    parentalSalaryPerDay = calculateParentalSalary(parent.income);
    const netParentalSalaryPerDay = calculateNetIncome(parentalSalaryPerDay * 30, parent.taxRate) / 30;
    // Available income during parental salary period (6 months = 180 days)
    availableIncome = netParentalSalaryPerDay * 30;
  } else {
    availableIncome = netParentalBenefitPerDay * 30;
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
  minHouseholdIncome: number
): OptimizationResult[] {
  const calc1 = calculateAvailableIncome(parent1);
  const calc2 = calculateAvailableIncome(parent2);
  
  const totalDays = totalMonths * 30;
  const parent1Days = parent1Months * 30;
  const parent2Days = parent2Months * 30;
  
  const birthDate = new Date();
  
  // Strategy 1: Save as many days as possible (minimize days used)
  const saveDaysResult = generateSaveDaysStrategy(
    parent1,
    parent2,
    calc1,
    calc2,
    parent1Days,
    parent2Days,
    minHouseholdIncome,
    birthDate
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
    birthDate
  );
  
  return [saveDaysResult, maxIncomeResult];
}

function generateSaveDaysStrategy(
  parent1: ParentData,
  parent2: ParentData,
  calc1: CalculationResult,
  calc2: CalculationResult,
  parent1Days: number,
  parent2Days: number,
  minHouseholdIncome: number,
  birthDate: Date
): OptimizationResult {
  const periods: LeavePeriod[] = [];
  let currentDate = new Date(birthDate);
  let totalIncome = 0;
  
  // First 10 days - both parents home
  const bothPeriodEnd = addDays(currentDate, 10);
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
  
  // Determine who has better income to stay working
  const betterIncomeParent = calc1.netIncome > calc2.netIncome ? 'parent1' : 'parent2';
  const worseIncomeParent = betterIncomeParent === 'parent1' ? 'parent2' : 'parent1';
  
  // Worse income parent stays home first (to save better income)
  const worseParentDays = worseIncomeParent === 'parent1' ? parent1Days : parent2Days;
  const worseCalc = worseIncomeParent === 'parent1' ? calc1 : calc2;
  const worseParentData = worseIncomeParent === 'parent1' ? parent1 : parent2;
  const betterCalc = betterIncomeParent === 'parent1' ? calc1 : calc2;
  
  // Calculate parental salary period for worse income parent
  const parentalSalaryDays = worseParentData.hasCollectiveAgreement ? Math.min(180, worseParentDays) : 0;
  const highBenefitDays = Math.min(HIGH_BENEFIT_DAYS - parentalSalaryDays, worseParentDays - parentalSalaryDays);
  
  if (parentalSalaryDays > 0) {
    const periodEnd = addDays(currentDate, parentalSalaryDays - 1);
    const periodIncome = (worseCalc.parentalSalaryPerDay + betterCalc.netIncome / 30) * parentalSalaryDays;
    periods.push({
      parent: worseIncomeParent,
      startDate: new Date(currentDate),
      endDate: periodEnd,
      daysCount: parentalSalaryDays,
      dailyBenefit: worseCalc.parentalSalaryPerDay,
      dailyIncome: periodIncome / parentalSalaryDays,
      benefitLevel: 'parental-salary'
    });
    totalIncome += periodIncome;
    currentDate = addDays(periodEnd, 1);
  }
  
  if (highBenefitDays > 0) {
    const periodEnd = addDays(currentDate, highBenefitDays - 1);
    const periodIncome = (worseCalc.parentalBenefitPerDay + betterCalc.netIncome / 30) * highBenefitDays;
    periods.push({
      parent: worseIncomeParent,
      startDate: new Date(currentDate),
      endDate: periodEnd,
      daysCount: highBenefitDays,
      dailyBenefit: worseCalc.parentalBenefitPerDay,
      dailyIncome: periodIncome / highBenefitDays,
      benefitLevel: 'high'
    });
    totalIncome += periodIncome;
    currentDate = addDays(periodEnd, 1);
  }
  
  // Better income parent takes their turn
  const betterParentDays = betterIncomeParent === 'parent1' ? parent1Days : parent2Days;
  const betterParentData = betterIncomeParent === 'parent1' ? parent1 : parent2;
  const betterParentSalaryDays = betterParentData.hasCollectiveAgreement ? Math.min(180, betterParentDays) : 0;
  const betterHighBenefitDays = Math.min(HIGH_BENEFIT_DAYS - parentalSalaryDays - highBenefitDays - betterParentSalaryDays, betterParentDays - betterParentSalaryDays);
  
  if (betterParentSalaryDays > 0) {
    const periodEnd = addDays(currentDate, betterParentSalaryDays - 1);
    const periodIncome = (betterCalc.parentalSalaryPerDay + worseCalc.netIncome / 30) * betterParentSalaryDays;
    periods.push({
      parent: betterIncomeParent,
      startDate: new Date(currentDate),
      endDate: periodEnd,
      daysCount: betterParentSalaryDays,
      dailyBenefit: betterCalc.parentalSalaryPerDay,
      dailyIncome: periodIncome / betterParentSalaryDays,
      benefitLevel: 'parental-salary'
    });
    totalIncome += periodIncome;
    currentDate = addDays(periodEnd, 1);
  }
  
  if (betterHighBenefitDays > 0) {
    const periodEnd = addDays(currentDate, betterHighBenefitDays - 1);
    const periodIncome = (betterCalc.parentalBenefitPerDay + worseCalc.netIncome / 30) * betterHighBenefitDays;
    periods.push({
      parent: betterIncomeParent,
      startDate: new Date(currentDate),
      endDate: periodEnd,
      daysCount: betterHighBenefitDays,
      dailyBenefit: betterCalc.parentalBenefitPerDay,
      dailyIncome: periodIncome / betterHighBenefitDays,
      benefitLevel: 'high'
    });
    totalIncome += periodIncome;
  }
  
  const daysUsed = parent1Days + parent2Days;
  const daysSaved = TOTAL_DAYS - daysUsed;
  
  return {
    strategy: 'save-days',
    title: 'Spara dagar',
    description: 'Optimerat för att spara så många föräldradagar som möjligt till senare',
    periods,
    totalIncome,
    daysUsed,
    daysSaved
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
  birthDate: Date
): OptimizationResult {
  const periods: LeavePeriod[] = [];
  let currentDate = new Date(birthDate);
  let totalIncome = 0;
  
  // First 10 days - both parents home
  const bothPeriodEnd = addDays(currentDate, 10);
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
  
  // Use parental salary days first (highest income)
  if (parent1SalaryDaysLeft > 0) {
    const daysToUse = Math.min(parent1SalaryDaysLeft, parent1RemainingDays);
    const periodEnd = addDays(currentDate, daysToUse - 1);
    const periodIncome = (calc1.parentalSalaryPerDay + calc2.netIncome / 30) * daysToUse;
    periods.push({
      parent: 'parent1',
      startDate: new Date(currentDate),
      endDate: periodEnd,
      daysCount: daysToUse,
      dailyBenefit: calc1.parentalSalaryPerDay,
      dailyIncome: periodIncome / daysToUse,
      benefitLevel: 'parental-salary'
    });
    totalIncome += periodIncome;
    parent1RemainingDays -= daysToUse;
    parent1SalaryDaysLeft -= daysToUse;
    currentDate = addDays(periodEnd, 1);
  }
  
  if (parent2SalaryDaysLeft > 0 && parent2RemainingDays > 0) {
    const daysToUse = Math.min(parent2SalaryDaysLeft, parent2RemainingDays);
    const periodEnd = addDays(currentDate, daysToUse - 1);
    const periodIncome = (calc2.parentalSalaryPerDay + calc1.netIncome / 30) * daysToUse;
    periods.push({
      parent: 'parent2',
      startDate: new Date(currentDate),
      endDate: periodEnd,
      daysCount: daysToUse,
      dailyBenefit: calc2.parentalSalaryPerDay,
      dailyIncome: periodIncome / daysToUse,
      benefitLevel: 'parental-salary'
    });
    totalIncome += periodIncome;
    parent2RemainingDays -= daysToUse;
    parent2SalaryDaysLeft -= daysToUse;
    currentDate = addDays(periodEnd, 1);
  }
  
  // Use remaining high benefit days
  if (parent1RemainingDays > 0 && highBenefitDaysLeft > 0) {
    const daysToUse = Math.min(highBenefitDaysLeft, parent1RemainingDays);
    const periodEnd = addDays(currentDate, daysToUse - 1);
    const periodIncome = (calc1.parentalBenefitPerDay + calc2.netIncome / 30) * daysToUse;
    periods.push({
      parent: 'parent1',
      startDate: new Date(currentDate),
      endDate: periodEnd,
      daysCount: daysToUse,
      dailyBenefit: calc1.parentalBenefitPerDay,
      dailyIncome: periodIncome / daysToUse,
      benefitLevel: 'high'
    });
    totalIncome += periodIncome;
    parent1RemainingDays -= daysToUse;
    highBenefitDaysLeft -= daysToUse;
    currentDate = addDays(periodEnd, 1);
  }
  
  if (parent2RemainingDays > 0 && highBenefitDaysLeft > 0) {
    const daysToUse = Math.min(highBenefitDaysLeft, parent2RemainingDays);
    const periodEnd = addDays(currentDate, daysToUse - 1);
    const periodIncome = (calc2.parentalBenefitPerDay + calc1.netIncome / 30) * daysToUse;
    periods.push({
      parent: 'parent2',
      startDate: new Date(currentDate),
      endDate: periodEnd,
      daysCount: daysToUse,
      dailyBenefit: calc2.parentalBenefitPerDay,
      dailyIncome: periodIncome / daysToUse,
      benefitLevel: 'high'
    });
    totalIncome += periodIncome;
    parent2RemainingDays -= daysToUse;
    highBenefitDaysLeft -= daysToUse;
  }
  
  const daysUsed = parent1Days + parent2Days;
  const daysSaved = TOTAL_DAYS - daysUsed;
  
  return {
    strategy: 'maximize-income',
    title: 'Maximera inkomst',
    description: 'Optimerat för att få ut maximal inkomst under föräldraledigheten',
    periods,
    totalIncome,
    daysUsed,
    daysSaved
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
