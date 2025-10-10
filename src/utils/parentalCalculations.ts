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
  daysPerWeek?: number;
  otherParentDailyIncome?: number;
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
const WEEKS_PER_MONTH = 4.3;

export function calculateNetIncome(grossIncome: number, taxRate: number): number {
  return grossIncome * (1 - taxRate / 100);
}

export function calculateDailyParentalBenefit(monthlyIncome: number): number {
  if (monthlyIncome <= 0) {
    return 0;
  }

  if (monthlyIncome < GRUNDNIVA_MONTHLY_THRESHOLD) {
    return GRUNDNIVA_DAILY;
  }

  const sgiMonthly = monthlyIncome * SGI_RATE;
  const cappedMonthly = Math.min(sgiMonthly, PARENTAL_BENEFIT_CEILING);
  const daily = (cappedMonthly * 12 * HIGH_BENEFIT_RATE) / 365;

  return Math.min(MAX_PARENTAL_BENEFIT_PER_DAY, Math.max(LOW_BENEFIT_AMOUNT, daily));
}

function calculateParentalSalaryMonthly(monthlyIncome: number): number {
  if (monthlyIncome <= 0) {
    return 0;
  }

  if (monthlyIncome <= PARENTAL_SALARY_THRESHOLD) {
    return monthlyIncome * 0.10;
  }

  const basePart = PARENTAL_SALARY_THRESHOLD * 0.10;
  const excessPart = (monthlyIncome - PARENTAL_SALARY_THRESHOLD) * 0.90;
  return basePart + excessPart;
}

function calculateParentMonthlyIncomeDuringLeave(
  calc: Pick<CalculationResult, 'netIncome' | 'parentalBenefitPerDay' | 'parentalSalaryPerDay'>,
  daysPerWeek: number,
  includeParentalSalary: boolean
): number {
  if (daysPerWeek <= 0) {
    return calc.netIncome;
  }

  const leaveDaysPerMonth = Math.min(30, Math.max(0, daysPerWeek * WEEKS_PER_MONTH));
  const leaveDailyNet = calc.parentalBenefitPerDay + (includeParentalSalary ? calc.parentalSalaryPerDay : 0);
  const leaveIncome = leaveDailyNet * leaveDaysPerMonth;
  const workDays = Math.max(0, 30 - leaveDaysPerMonth);
  const workDailyNet = calc.netIncome / 30;
  const workIncome = workDailyNet * workDays;

  return leaveIncome + workIncome;
}

export function calculateAvailableIncome(parent: ParentData): CalculationResult {
  const netIncome = calculateNetIncome(parent.income, parent.taxRate);
  const grossParentalBenefitPerDay = calculateDailyParentalBenefit(parent.income);
  const netParentalBenefitPerDay = calculateNetIncome(grossParentalBenefitPerDay * 30, parent.taxRate) / 30;

  let parentalSalaryPerDay = 0;
  if (parent.hasCollectiveAgreement) {
    const parentalSalaryMonthlyGross = calculateParentalSalaryMonthly(parent.income);
    const parentalSalaryMonthlyNet = calculateNetIncome(parentalSalaryMonthlyGross, parent.taxRate);
    parentalSalaryPerDay = parentalSalaryMonthlyNet / 30;
  }

  const base: CalculationResult = {
    netIncome,
    availableIncome: 0,
    parentalBenefitPerDay: netParentalBenefitPerDay,
    parentalSalaryPerDay,
  };

  const availableIncome = calculateParentMonthlyIncomeDuringLeave(
    base,
    7,
    parent.hasCollectiveAgreement
  );

  return { ...base, availableIncome };
}

export function optimizeLeave(
  parent1: ParentData,
  parent2: ParentData,
  totalMonths: number,
  parent1Months: number,
  parent2Months: number,
  minHouseholdIncome: number,
  daysPerWeek: number,
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
    daysPerWeek,
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
    daysPerWeek,
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
          benefitLevel: 'none',
          daysPerWeek: 0,
          otherParentDailyIncome: calc2.netIncome / 30
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
  daysPerWeek: number,
  birthDate: Date,
  endDate: Date,
  simultaneousMonths: number = 0
): OptimizationResult {
  const periods: LeavePeriod[] = [];
  let currentDate = new Date(birthDate);
  let totalIncome = 0;

  // 1. First 10 days - both parents home with parental benefit
  const bothPeriodEnd = addDays(currentDate, 9);
  const bothDailyBenefit =
    calc1.parentalBenefitPerDay + (parent1.hasCollectiveAgreement ? calc1.parentalSalaryPerDay : 0) +
    calc2.parentalBenefitPerDay + (parent2.hasCollectiveAgreement ? calc2.parentalSalaryPerDay : 0);
  const bothPeriodIncome = bothDailyBenefit * 10;
  periods.push({
    parent: 'both',
    startDate: new Date(currentDate),
    endDate: bothPeriodEnd,
    daysCount: 10,
    dailyBenefit: bothDailyBenefit,
    dailyIncome: bothPeriodIncome / 10,
    benefitLevel: parent1.hasCollectiveAgreement ? 'parental-salary' : 'high',
    daysPerWeek: 7,
    otherParentDailyIncome: 0
  });
  totalIncome += bothPeriodIncome;
  currentDate = addDays(bothPeriodEnd, 1);

  // 2. Parent 1 home for their allocated months
  let parent1RemainingDays = parent1Days - 10; // Subtract the initial 10 days
  const parent1Months = Math.floor(parent1RemainingDays / 30);
  
  // First 6 months with parental salary (if applicable)
  const parent1SalaryMonths = Math.min(6, parent1Months);
  if (parent1SalaryMonths > 0 && parent1.hasCollectiveAgreement) {
    const salaryDays = parent1SalaryMonths * 30;
    const salaryPeriodEnd = addDays(currentDate, salaryDays - 1);
const leaveDaysPerMonth = Math.min(30, Math.max(0, daysPerWeek * WEEKS_PER_MONTH));
const leaveDailyNetWithSalary = calc1.parentalBenefitPerDay + calc1.parentalSalaryPerDay;
const monthlyBenefit = leaveDailyNetWithSalary * leaveDaysPerMonth;
const leaveParentMonthlyIncome = calculateParentMonthlyIncomeDuringLeave(calc1, daysPerWeek, true);
const householdMonthlyIncome = leaveParentMonthlyIncome + calc2.netIncome;
const dailyIncomeAvg = householdMonthlyIncome / 30;
const dailyBenefitAvg = monthlyBenefit / 30;

periods.push({
  parent: 'parent1',
  startDate: new Date(currentDate),
  endDate: salaryPeriodEnd,
  daysCount: salaryDays,
  dailyBenefit: dailyBenefitAvg,
  dailyIncome: dailyIncomeAvg,
  benefitLevel: 'parental-salary',
  daysPerWeek: daysPerWeek,
  otherParentDailyIncome: calc2.netIncome / 30
});

totalIncome += salaryDays * dailyIncomeAvg;
currentDate = addDays(salaryPeriodEnd, 1);
parent1RemainingDays -= salaryDays;
  }

  // 3. Parent 1 continues without parental salary (if they have more months)
  if (parent1RemainingDays > 0) {
    const remainingPeriodEnd = addDays(currentDate, parent1RemainingDays - 1);
const leaveDaysPerMonth = Math.min(30, Math.max(0, daysPerWeek * WEEKS_PER_MONTH));
const leaveDailyNet = calc1.parentalBenefitPerDay;
const monthlyBenefit = leaveDailyNet * leaveDaysPerMonth;
const leaveParentMonthlyIncome = calculateParentMonthlyIncomeDuringLeave(calc1, daysPerWeek, false);
const householdMonthlyIncome = leaveParentMonthlyIncome + calc2.netIncome;
const dailyIncomeAvg = householdMonthlyIncome / 30;
const dailyBenefitAvg = monthlyBenefit / 30;

periods.push({
  parent: 'parent1',
  startDate: new Date(currentDate),
  endDate: remainingPeriodEnd,
  daysCount: parent1RemainingDays,
  dailyBenefit: dailyBenefitAvg,
  dailyIncome: dailyIncomeAvg,
  benefitLevel: 'high',
  daysPerWeek: daysPerWeek,
  otherParentDailyIncome: calc2.netIncome / 30
});

totalIncome += parent1RemainingDays * dailyIncomeAvg;
currentDate = addDays(remainingPeriodEnd, 1);
  }

  // 4. Parent 2 home for their allocated months
  let parent2RemainingDays = parent2Days - 10; // Subtract the initial 10 days
  const parent2Months = Math.floor(parent2RemainingDays / 30);
  
  // First 6 months with parental salary (if applicable)
  const parent2SalaryMonths = Math.min(6, parent2Months);
  if (parent2SalaryMonths > 0 && parent2.hasCollectiveAgreement) {
    const salaryDays = parent2SalaryMonths * 30;
    const salaryPeriodEnd = addDays(currentDate, salaryDays - 1);
const leaveDaysPerMonth = Math.min(30, Math.max(0, daysPerWeek * WEEKS_PER_MONTH));
const leaveDailyNetWithSalary = calc2.parentalBenefitPerDay + calc2.parentalSalaryPerDay;
const monthlyBenefit = leaveDailyNetWithSalary * leaveDaysPerMonth;
const leaveParentMonthlyIncome = calculateParentMonthlyIncomeDuringLeave(calc2, daysPerWeek, true);
const householdMonthlyIncome = leaveParentMonthlyIncome + calc1.netIncome;
const dailyIncomeAvg = householdMonthlyIncome / 30;
const dailyBenefitAvg = monthlyBenefit / 30;

periods.push({
  parent: 'parent2',
  startDate: new Date(currentDate),
  endDate: salaryPeriodEnd,
  daysCount: salaryDays,
  dailyBenefit: dailyBenefitAvg,
  dailyIncome: dailyIncomeAvg,
  benefitLevel: 'parental-salary',
  daysPerWeek: daysPerWeek,
  otherParentDailyIncome: calc1.netIncome / 30
});

totalIncome += salaryDays * dailyIncomeAvg;
currentDate = addDays(salaryPeriodEnd, 1);
parent2RemainingDays -= salaryDays;
  }

  // Parent 2 continues without parental salary (if they have more months)
  if (parent2RemainingDays > 0) {
    const remainingPeriodEnd = addDays(currentDate, parent2RemainingDays - 1);
const leaveDaysPerMonth = Math.min(30, Math.max(0, daysPerWeek * WEEKS_PER_MONTH));
const leaveDailyNet = calc2.parentalBenefitPerDay;
const monthlyBenefit = leaveDailyNet * leaveDaysPerMonth;
const leaveParentMonthlyIncome = calculateParentMonthlyIncomeDuringLeave(calc2, daysPerWeek, false);
const householdMonthlyIncome = leaveParentMonthlyIncome + calc1.netIncome;
const dailyIncomeAvg = householdMonthlyIncome / 30;
const dailyBenefitAvg = monthlyBenefit / 30;

periods.push({
  parent: 'parent2',
  startDate: new Date(currentDate),
  endDate: remainingPeriodEnd,
  daysCount: parent2RemainingDays,
  dailyBenefit: dailyBenefitAvg,
  dailyIncome: dailyIncomeAvg,
  benefitLevel: 'high',
  daysPerWeek: daysPerWeek,
  otherParentDailyIncome: calc1.netIncome / 30
});

totalIncome += parent2RemainingDays * dailyIncomeAvg;
currentDate = addDays(remainingPeriodEnd, 1);
  }

  // If there's remaining time until endDate, both work
  if (currentDate <= endDate) {
    const remainingDays = differenceInDays(endDate, currentDate) + 1;
    if (remainingDays > 0) {
      const bothWorkDaily = (calc1.netIncome + calc2.netIncome) / 30;
      periods.push({
        parent: 'both',
        startDate: new Date(currentDate),
        endDate: endDate,
        daysCount: remainingDays,
        dailyBenefit: 0,
        dailyIncome: bothWorkDaily,
        benefitLevel: 'none',
        daysPerWeek: 0,
        otherParentDailyIncome: calc2.netIncome / 30
      });
      totalIncome += remainingDays * bothWorkDaily;
    }
  }

  // Count actual leave days
  const daysUsed = periods
    .filter(p => p.benefitLevel !== 'none')
    .reduce((sum, p) => {
      if (p.parent === 'both') {
        return sum + (p.daysCount * 2);
      } else {
        return sum + p.daysCount;
      }
    }, 0);
  
  const daysSaved = Math.max(0, TOTAL_DAYS - daysUsed);
  const totalDaysInPeriods = periods.reduce((sum, p) => sum + p.daysCount, 0);
  const averageMonthlyIncome = totalDaysInPeriods > 0 ? (totalIncome / totalDaysInPeriods) * 30 : 0;

  return {
    strategy: 'save-days',
    title: 'Spara dagar',
    description: 'Sekventiell fördelning: Första 10 dagar båda hemma, sedan förälder 1, sedan förälder 2',
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
  daysPerWeek: number,
  birthDate: Date,
  endDate: Date,
  simultaneousMonths: number = 0
): OptimizationResult {
  const periods: LeavePeriod[] = [];
  let currentDate = new Date(birthDate);
  let totalIncome = 0;
  
  // 1. First 10 days - both parents home with parental benefit
  const bothPeriodEnd = addDays(currentDate, 9);
  const bothDailyBenefit =
    calc1.parentalBenefitPerDay + (parent1.hasCollectiveAgreement ? calc1.parentalSalaryPerDay : 0) +
    calc2.parentalBenefitPerDay + (parent2.hasCollectiveAgreement ? calc2.parentalSalaryPerDay : 0);
  const bothPeriodIncome = bothDailyBenefit * 10;
  periods.push({
    parent: 'both',
    startDate: new Date(currentDate),
    endDate: bothPeriodEnd,
    daysCount: 10,
    dailyBenefit: bothDailyBenefit,
    dailyIncome: bothPeriodIncome / 10,
    benefitLevel: parent1.hasCollectiveAgreement ? 'parental-salary' : 'high',
    daysPerWeek: 7,
    otherParentDailyIncome: 0
  });
  totalIncome += bothPeriodIncome;
  currentDate = addDays(bothPeriodEnd, 1);

  // 2. Parent 1 home for their allocated months
  let parent1RemainingDays = parent1Days - 10;
  const parent1Months = Math.floor(parent1RemainingDays / 30);
  
  // First 6 months with parental salary (if applicable)
  const parent1SalaryMonths = Math.min(6, parent1Months);
  if (parent1SalaryMonths > 0 && parent1.hasCollectiveAgreement) {
    const salaryDays = parent1SalaryMonths * 30;
    const salaryPeriodEnd = addDays(currentDate, salaryDays - 1);
const daysPw = 7;
const leaveDaysPerMonth = 30;
const leaveDailyNetWithSalary = calc1.parentalBenefitPerDay + calc1.parentalSalaryPerDay;
const monthlyBenefit = leaveDailyNetWithSalary * leaveDaysPerMonth;
const leaveParentMonthlyIncome = calculateParentMonthlyIncomeDuringLeave(calc1, daysPw, true);
const householdMonthlyIncome = leaveParentMonthlyIncome + calc2.netIncome;
const dailyIncomeAvg = householdMonthlyIncome / 30;
const dailyBenefitAvg = monthlyBenefit / 30;

periods.push({
  parent: 'parent1',
  startDate: new Date(currentDate),
  endDate: salaryPeriodEnd,
  daysCount: salaryDays,
  dailyBenefit: dailyBenefitAvg,
  dailyIncome: dailyIncomeAvg,
  benefitLevel: 'parental-salary',
  daysPerWeek: daysPw,
  otherParentDailyIncome: calc2.netIncome / 30
});

totalIncome += salaryDays * dailyIncomeAvg;
currentDate = addDays(salaryPeriodEnd, 1);
parent1RemainingDays -= salaryDays;
  }

  // 3. Parent 1 continues without parental salary (if they have more months)
  if (parent1RemainingDays > 0) {
    const remainingPeriodEnd = addDays(currentDate, parent1RemainingDays - 1);
const daysPw = 7;
const leaveDaysPerMonth = 30;
const leaveDailyNet = calc1.parentalBenefitPerDay;
const monthlyBenefit = leaveDailyNet * leaveDaysPerMonth;
const leaveParentMonthlyIncome = calculateParentMonthlyIncomeDuringLeave(calc1, daysPw, false);
const householdMonthlyIncome = leaveParentMonthlyIncome + calc2.netIncome;
const dailyIncomeAvg = householdMonthlyIncome / 30;
const dailyBenefitAvg = monthlyBenefit / 30;
    
periods.push({
  parent: 'parent1',
  startDate: new Date(currentDate),
  endDate: remainingPeriodEnd,
  daysCount: parent1RemainingDays,
  dailyBenefit: dailyBenefitAvg,
  dailyIncome: dailyIncomeAvg,
  benefitLevel: 'high',
  daysPerWeek: daysPw,
  otherParentDailyIncome: calc2.netIncome / 30
});
 totalIncome += parent1RemainingDays * dailyIncomeAvg;
 currentDate = addDays(remainingPeriodEnd, 1);
  }

  // 4. Parent 2 home for their allocated months
  let parent2RemainingDays = parent2Days - 10;
  const parent2Months = Math.floor(parent2RemainingDays / 30);
  
  // First 6 months with parental salary (if applicable)
  const parent2SalaryMonths = Math.min(6, parent2Months);
  if (parent2SalaryMonths > 0 && parent2.hasCollectiveAgreement) {
    const salaryDays = parent2SalaryMonths * 30;
    const salaryPeriodEnd = addDays(currentDate, salaryDays - 1);
const daysPw = 7;
const leaveDaysPerMonth = 30;
const leaveDailyNetWithSalary = calc2.parentalBenefitPerDay + calc2.parentalSalaryPerDay;
const monthlyBenefit = leaveDailyNetWithSalary * leaveDaysPerMonth;
const leaveParentMonthlyIncome = calculateParentMonthlyIncomeDuringLeave(calc2, daysPw, true);
const householdMonthlyIncome = leaveParentMonthlyIncome + calc1.netIncome;
const dailyIncomeAvg = householdMonthlyIncome / 30;
const dailyBenefitAvg = monthlyBenefit / 30;
    
periods.push({
  parent: 'parent2',
  startDate: new Date(currentDate),
  endDate: salaryPeriodEnd,
  daysCount: salaryDays,
  dailyBenefit: dailyBenefitAvg,
  dailyIncome: dailyIncomeAvg,
  benefitLevel: 'parental-salary',
  daysPerWeek: daysPw,
  otherParentDailyIncome: calc1.netIncome / 30
});
 totalIncome += salaryDays * dailyIncomeAvg;
 currentDate = addDays(salaryPeriodEnd, 1);
 parent2RemainingDays -= salaryDays;
  }

  // Parent 2 continues without parental salary (if they have more months)
  if (parent2RemainingDays > 0) {
    const remainingPeriodEnd = addDays(currentDate, parent2RemainingDays - 1);
const daysPw = 7;
const leaveDaysPerMonth = 30;
const leaveDailyNet = calc2.parentalBenefitPerDay;
const monthlyBenefit = leaveDailyNet * leaveDaysPerMonth;
const leaveParentMonthlyIncome = calculateParentMonthlyIncomeDuringLeave(calc2, daysPw, false);
const householdMonthlyIncome = leaveParentMonthlyIncome + calc1.netIncome;
const dailyIncomeAvg = householdMonthlyIncome / 30;
const dailyBenefitAvg = monthlyBenefit / 30;
    
periods.push({
  parent: 'parent2',
  startDate: new Date(currentDate),
  endDate: remainingPeriodEnd,
  daysCount: parent2RemainingDays,
  dailyBenefit: dailyBenefitAvg,
  dailyIncome: dailyIncomeAvg,
  benefitLevel: 'high',
  daysPerWeek: daysPw,
  otherParentDailyIncome: calc1.netIncome / 30
});
 totalIncome += parent2RemainingDays * dailyIncomeAvg;
 currentDate = addDays(remainingPeriodEnd, 1);
  }

  // If there's remaining time until endDate, both work
  if (currentDate <= endDate) {
    const remainingDays = differenceInDays(endDate, currentDate) + 1;
    if (remainingDays > 0) {
      const bothWorkDaily = (calc1.netIncome + calc2.netIncome) / 30;
      periods.push({
        parent: 'both',
        startDate: new Date(currentDate),
        endDate: endDate,
        daysCount: remainingDays,
        dailyBenefit: 0,
        dailyIncome: bothWorkDaily,
        benefitLevel: 'none',
        daysPerWeek: 0,
        otherParentDailyIncome: calc2.netIncome / 30
      });
      totalIncome += remainingDays * bothWorkDaily;
    }
  }

  // Count actual leave days
  const daysUsed = periods
    .filter(p => p.benefitLevel !== 'none')
    .reduce((sum, p) => {
      if (p.parent === 'both') {
        return sum + (p.daysCount * 2);
      } else {
        return sum + p.daysCount;
      }
    }, 0);
  
  const daysSaved = Math.max(0, TOTAL_DAYS - daysUsed);
  const totalDaysInPeriods = periods.reduce((sum, p) => sum + p.daysCount, 0);
  const averageMonthlyIncome = totalDaysInPeriods > 0 ? (totalIncome / totalDaysInPeriods) * 30 : 0;
  
  return {
    strategy: 'maximize-income',
    title: 'Maximera inkomst',
    description: 'Sekventiell fördelning: Första 10 dagar båda hemma, sedan förälder 1, sedan förälder 2',
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
