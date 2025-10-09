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

const PARENTAL_BENEFIT_CEILING = 38000; // SEK per month before tax
const HIGH_BENEFIT_DAYS = 390;
const LOW_BENEFIT_DAYS = 90;
const TOTAL_DAYS = 480;
const LOW_BENEFIT_AMOUNT = 180; // SEK per day
const HIGH_BENEFIT_RATE = 0.80; // 80% of income
const SGI_RATE = 0.97; // 97% of gross income for SGI calculation
const PRISBASBELOPP_2025 = 58800; // SEK per year
const PARENTAL_SALARY_THRESHOLD = (10 * PRISBASBELOPP_2025) / 12; // 49,000 kr/month

export function calculateNetIncome(grossIncome: number, taxRate: number): number {
  return grossIncome * (1 - taxRate / 100);
}

export function calculateDailyParentalBenefit(monthlyIncome: number): number {
  // First calculate SGI (97% of gross income)
  const sgi = monthlyIncome * SGI_RATE;
  // Cap SGI at the ceiling
  const cappedSGI = Math.min(sgi, PARENTAL_BENEFIT_CEILING);
  // Parental benefit is 80% of SGI
  return (cappedSGI * HIGH_BENEFIT_RATE) / 30;
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
  minHouseholdIncome: number,
  simultaneousMonths: number = 0
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
    birthDate,
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
    simultaneousMonths
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
  birthDate: Date,
  simultaneousMonths: number = 0
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
  
  // Add additional simultaneous period if requested
  if (simultaneousMonths > 0) {
    const simultaneousDays = simultaneousMonths * 30;
    const simultaneousPeriodEnd = addDays(currentDate, simultaneousDays - 1);
    const simultaneousIncome = (calc1.parentalBenefitPerDay + calc2.parentalBenefitPerDay) * simultaneousDays;
    periods.push({
      parent: 'both',
      startDate: new Date(currentDate),
      endDate: simultaneousPeriodEnd,
      daysCount: simultaneousDays,
      dailyBenefit: calc1.parentalBenefitPerDay + calc2.parentalBenefitPerDay,
      dailyIncome: simultaneousIncome / simultaneousDays,
      benefitLevel: 'high'
    });
    totalIncome += simultaneousIncome;
    currentDate = addDays(simultaneousPeriodEnd, 1);
  }
  
  // Strategy: Take turns to minimize days while meeting requirements
  // Prioritize lower earning parent first (maximize household income)
  const betterIncomeParent = calc1.netIncome > calc2.netIncome ? 'parent1' : 'parent2';
  const worseIncomeParent = betterIncomeParent === 'parent1' ? 'parent2' : 'parent1';
  
  const worseParentDays = worseIncomeParent === 'parent1' ? parent1Days : parent2Days;
  const worseCalc = worseIncomeParent === 'parent1' ? calc1 : calc2;
  const worseParentData = worseIncomeParent === 'parent1' ? parent1 : parent2;
  const betterCalc = betterIncomeParent === 'parent1' ? calc1 : calc2;
  
  // Use only high benefit days for worse income parent (skip parental salary to save days)
  const worseHighBenefitDays = Math.min(HIGH_BENEFIT_DAYS, worseParentDays);
  
  if (worseHighBenefitDays > 0) {
    const periodEnd = addDays(currentDate, worseHighBenefitDays - 1);
    const periodIncome = (worseCalc.parentalBenefitPerDay + betterCalc.netIncome / 30) * worseHighBenefitDays;
    periods.push({
      parent: worseIncomeParent,
      startDate: new Date(currentDate),
      endDate: periodEnd,
      daysCount: worseHighBenefitDays,
      dailyBenefit: worseCalc.parentalBenefitPerDay,
      dailyIncome: periodIncome / worseHighBenefitDays,
      benefitLevel: 'high'
    });
    totalIncome += periodIncome;
    currentDate = addDays(periodEnd, 1);
  }
  
  // Better income parent takes their turn with high benefit only
  const betterParentDays = betterIncomeParent === 'parent1' ? parent1Days : parent2Days;
  const remainingHighBenefitDays = HIGH_BENEFIT_DAYS - worseHighBenefitDays;
  const betterHighBenefitDays = Math.min(remainingHighBenefitDays, betterParentDays);
  
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
  
  const daysUsed = parent1Days + parent2Days + (simultaneousMonths * 30);
  const daysSaved = TOTAL_DAYS - daysUsed;
  const totalDaysInPeriods = periods.reduce((sum, p) => sum + p.daysCount, 0);
  const averageMonthlyIncome = totalDaysInPeriods > 0 ? (totalIncome / totalDaysInPeriods) * 30 : 0;
  
  return {
    strategy: 'save-days',
    title: 'Spara dagar',
    description: 'Använder endast höga föräldrapenningdagar för att maximera sparade dagar',
    periods,
    totalIncome,
    daysUsed,
    daysSaved,
    averageMonthlyIncome
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
  simultaneousMonths: number = 0
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
  
  // Add additional simultaneous period if requested
  if (simultaneousMonths > 0) {
    const simultaneousDays = simultaneousMonths * 30;
    const simultaneousPeriodEnd = addDays(currentDate, simultaneousDays - 1);
    const simultaneousIncome = (calc1.parentalBenefitPerDay + calc2.parentalBenefitPerDay) * simultaneousDays;
    periods.push({
      parent: 'both',
      startDate: new Date(currentDate),
      endDate: simultaneousPeriodEnd,
      daysCount: simultaneousDays,
      dailyBenefit: calc1.parentalBenefitPerDay + calc2.parentalBenefitPerDay,
      dailyIncome: simultaneousIncome / simultaneousDays,
      benefitLevel: 'high'
    });
    totalIncome += simultaneousIncome;
    currentDate = addDays(simultaneousPeriodEnd, 1);
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
  
  const daysUsed = parent1Days + parent2Days + (simultaneousMonths * 30);
  const daysSaved = TOTAL_DAYS - daysUsed;
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
