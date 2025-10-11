import { addDays, format } from 'date-fns';
import { sv } from 'date-fns/locale';

import {
  optimizeParentalLeave,
  beräknaMånadsinkomst,
} from './legacyCalculations';
import { MINIMUM_RATE } from './legacyConfig';

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

const PARENTAL_BENEFIT_CEILING = 49000;
const HIGH_BENEFIT_DAYS = 390;
const LOW_BENEFIT_DAYS = 90;
export const TOTAL_BENEFIT_DAYS = HIGH_BENEFIT_DAYS + LOW_BENEFIT_DAYS;
const MAX_PARENTAL_BENEFIT_PER_DAY = 1250;
const HIGH_BENEFIT_RATE = 0.8;
const SGI_RATE = 0.97;
const PRISBASBELOPP_2025 = 58800;
const PARENTAL_SALARY_THRESHOLD = (10 * PRISBASBELOPP_2025) / 12;

export function calculateMaxLeaveMonths(
  daysPerWeek: number,
  totalBenefitDays: number = TOTAL_BENEFIT_DAYS
): number {
  const safeDaysPerWeek = Math.max(1, Math.round(daysPerWeek));
  const weeksAvailable = totalBenefitDays / safeDaysPerWeek;
  const months = weeksAvailable / WEEKS_PER_MONTH;

  if (!Number.isFinite(months) || months <= 0) {
    return 1;
  }

  return Math.ceil(months * 2) / 2;
}
export const WEEKS_PER_MONTH = 4.33;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function calculateNetIncome(grossIncome: number, taxRate: number): number {
  if (!isFiniteNumber(grossIncome) || grossIncome <= 0) {
    return 0;
  }

  return grossIncome * (1 - taxRate / 100);
}

export function calculateDailyParentalBenefit(monthlyIncome: number): number {
  if (!isFiniteNumber(monthlyIncome) || monthlyIncome <= 0) {
    return 0;
  }

  if (monthlyIncome < 9800) {
    return 250;
  }

  const sgiMonthly = monthlyIncome * SGI_RATE;
  const cappedMonthly = Math.min(sgiMonthly, PARENTAL_BENEFIT_CEILING);
  const daily = (cappedMonthly * 12 * HIGH_BENEFIT_RATE) / 365;

  return Math.min(MAX_PARENTAL_BENEFIT_PER_DAY, Math.max(MINIMUM_RATE, daily));
}

function calculateParentalSalaryMonthly(monthlyIncome: number): number {
  if (!isFiniteNumber(monthlyIncome) || monthlyIncome <= 0) {
    return 0;
  }

  if (monthlyIncome <= PARENTAL_SALARY_THRESHOLD) {
    return monthlyIncome * 0.1;
  }

  const basePart = PARENTAL_SALARY_THRESHOLD * 0.1;
  const excessPart = (monthlyIncome - PARENTAL_SALARY_THRESHOLD) * 0.9;
  return basePart + excessPart;
}

export function calculateAvailableIncome(parent: ParentData): CalculationResult {
  const netIncome = calculateNetIncome(parent.income, parent.taxRate);
  const parentalBenefitGrossPerDay = calculateDailyParentalBenefit(parent.income);
  const parentalBenefitNetPerDay = calculateNetIncome(parentalBenefitGrossPerDay * 30, parent.taxRate) / 30;

  let parentalSalaryPerDay = 0;
  if (parent.hasCollectiveAgreement) {
    const parentalSalaryMonthlyGross = calculateParentalSalaryMonthly(parent.income);
    const parentalSalaryMonthlyNet = calculateNetIncome(parentalSalaryMonthlyGross, parent.taxRate);
    parentalSalaryPerDay = parentalSalaryMonthlyNet / 30;
  }

  const availableIncome = (parentalBenefitNetPerDay + parentalSalaryPerDay) * 30;

  return {
    netIncome,
    availableIncome,
    parentalBenefitPerDay: parentalBenefitNetPerDay,
    parentalSalaryPerDay,
  };
}

interface StrategyMeta {
  key: 'save-days' | 'maximize-income';
  legacyKey: 'longer' | 'maximize';
  title: string;
  description: string;
}

type LegacyStrategyKey = StrategyMeta['legacyKey'] | 'maximize_parental_salary';

interface ConversionContext {
  parent1: ParentData;
  parent2: ParentData;
  parent1NetIncome: number;
  parent2NetIncome: number;
  adjustedTotalMonths: number;
  requestedDaysPerWeek: number;
}

type LegacyPlan = Record<string, unknown> | undefined;

type LegacyResult = Record<string, any>;

function toNumber(value: unknown): number {
  return isFiniteNumber(value) ? value : 0;
}

function computeDaysFromPlan(plan: LegacyPlan, fallbackDaysPerWeek: number): number {
  if (!plan) return 0;
  const weeks = toNumber(plan.weeks);
  const daysPerWeek = toNumber(plan.dagarPerVecka || fallbackDaysPerWeek);
  if (weeks <= 0 || daysPerWeek <= 0) {
    return 0;
  }
  return Math.round(weeks * daysPerWeek);
}

function extractDays(plan: LegacyPlan, property: string, fallbackDaysPerWeek: number): number {
  if (!plan) return 0;
  const stored = toNumber(plan[property as keyof typeof plan]);
  if (stored > 0) {
    return Math.round(stored);
  }
  return computeDaysFromPlan(plan, fallbackDaysPerWeek);
}

function getInkomstDays(plan: LegacyPlan, fallbackDaysPerWeek: number): number {
  return extractDays(plan, 'användaInkomstDagar', fallbackDaysPerWeek);
}

function getMinDays(plan: LegacyPlan, fallbackDaysPerWeek: number): number {
  return extractDays(plan, 'användaMinDagar', fallbackDaysPerWeek);
}

interface SegmentConfig {
  plan: LegacyPlan;
  parent: 'parent1' | 'parent2' | 'both';
  benefitLevel: 'parental-salary' | 'high' | 'low' | 'none';
  otherParentMonthlyIncome: number;
  usedDays: number;
  fallbackDaysPerWeek: number;
  benefitMonthly: number;
  leaveMonthlyIncome: number;
}

function addSegment(
  periods: LeavePeriod[],
  currentDate: Date,
  config: SegmentConfig,
  calendarDaysAccumulator: { value: number }
): Date {
  const {
    plan,
    parent,
    benefitLevel,
    otherParentMonthlyIncome,
    usedDays,
    fallbackDaysPerWeek,
    benefitMonthly,
    leaveMonthlyIncome,
  } = config;

  if (!plan || usedDays <= 0) {
    return currentDate;
  }

  const weeks = toNumber(plan.weeks) || (fallbackDaysPerWeek > 0 ? usedDays / fallbackDaysPerWeek : 0);
  const dagarPerVecka = toNumber(plan.dagarPerVecka || fallbackDaysPerWeek);
  if (weeks <= 0 || dagarPerVecka <= 0) {
    return currentDate;
  }

  const calendarDays = Math.max(1, Math.round(weeks * 7));
  const daysCount = Math.max(1, Math.round(usedDays));
  const startDate = new Date(currentDate);
  const endDate = addDays(startDate, calendarDays - 1);
  const otherDailyIncome = otherParentMonthlyIncome / 30;
  const householdMonthlyIncome = leaveMonthlyIncome + otherParentMonthlyIncome;
  const dailyIncome = householdMonthlyIncome / 30;
  const dailyBenefit = benefitMonthly / 30;

  periods.push({
    parent,
    startDate,
    endDate,
    daysCount,
    dailyBenefit,
    dailyIncome,
    benefitLevel,
    daysPerWeek: Math.round(dagarPerVecka),
    otherParentDailyIncome: parent === 'both' ? 0 : otherDailyIncome,
  });

  calendarDaysAccumulator.value += calendarDays;
  return addDays(endDate, 1);
}

function convertLegacyResult(
  meta: StrategyMeta,
  legacyResult: LegacyResult,
  context: ConversionContext
): OptimizationResult {
  const periods: LeavePeriod[] = [];
  let currentDate = new Date();
  
  // Add initial 10 days (both parents) from child's birth
  const initialEndDate = addDays(currentDate, 9); // 10 days total (0-9)
  const parent1NetDaily = context.parent1NetIncome / 30;
  const parent2NetDaily = context.parent2NetIncome / 30;
  
  periods.push({
    parent: 'both',
    startDate: new Date(currentDate),
    endDate: initialEndDate,
    daysCount: 10,
    dailyBenefit: 0,
    dailyIncome: parent1NetDaily + parent2NetDaily,
    benefitLevel: 'none',
    daysPerWeek: 0,
    otherParentDailyIncome: parent2NetDaily,
  });
  
  currentDate = addDays(initialEndDate, 1);
  const calendarDaysAccumulator = { value: 10 }; // Start with 10 days already used

  const resolveDaysPerWeek = (...values: unknown[]): number => {
    for (const value of values) {
      const candidate = toNumber(value);
      if (candidate > 0) {
        return candidate;
      }
    }
    const normalized = Math.max(1, Math.round(context.requestedDaysPerWeek));
    return normalized > 0 ? normalized : 5;
  };

  const plan1DaysPerWeek = resolveDaysPerWeek(legacyResult.plan1?.dagarPerVecka);
  const plan1TotalInkomstDays = getInkomstDays(legacyResult.plan1, plan1DaysPerWeek);
  const plan1NoExtraDays = getInkomstDays(
    legacyResult.plan1NoExtra,
    resolveDaysPerWeek(legacyResult.plan1NoExtra?.dagarPerVecka, legacyResult.plan1?.dagarPerVecka)
  );
  const plan1ExtraDays = Math.max(0, plan1TotalInkomstDays - plan1NoExtraDays);
  const plan1MinDays = getMinDays(legacyResult.plan1, plan1DaysPerWeek);
  const plan1MinContinuationDays = getMinDays(
    legacyResult.plan1MinDagar,
    resolveDaysPerWeek(legacyResult.plan1MinDagar?.dagarPerVecka, legacyResult.plan1?.dagarPerVecka)
  );

  const plan2DaysPerWeek = resolveDaysPerWeek(legacyResult.plan2?.dagarPerVecka);
  const plan2TotalInkomstDays = getInkomstDays(legacyResult.plan2, plan2DaysPerWeek);
  const plan2NoExtraDays = getInkomstDays(
    legacyResult.plan2NoExtra,
    resolveDaysPerWeek(legacyResult.plan2NoExtra?.dagarPerVecka, legacyResult.plan2?.dagarPerVecka)
  );
  const plan2ExtraDays = Math.max(0, plan2TotalInkomstDays - plan2NoExtraDays);
  const plan2MinDays = getMinDays(legacyResult.plan2, plan2DaysPerWeek);
  const plan2MinContinuationDays = getMinDays(
    legacyResult.plan2MinDagar,
    resolveDaysPerWeek(legacyResult.plan2MinDagar?.dagarPerVecka, legacyResult.plan2?.dagarPerVecka)
  );

  const overlapDaysUsed = computeDaysFromPlan(
    legacyResult.plan1Overlap,
    resolveDaysPerWeek(legacyResult.plan1Overlap?.dagarPerVecka)
  );

  const usedInkomstDays1 = plan1ExtraDays + plan1NoExtraDays;
  const usedMinDays1 = plan1MinDays + plan1MinContinuationDays;
  const usedInkomstDays2 = plan2ExtraDays + plan2NoExtraDays + overlapDaysUsed;
  const usedMinDays2 = plan2MinDays + plan2MinContinuationDays;

  const totalDaysUsed =
    usedInkomstDays1 +
    usedMinDays1 +
    usedInkomstDays2 +
    usedMinDays2;

  const daysUsedRounded = Math.max(0, Math.round(totalDaysUsed));
  const clampedDaysUsed = Math.min(TOTAL_BENEFIT_DAYS, daysUsedRounded);
  const daysSaved = Math.max(0, TOTAL_BENEFIT_DAYS - clampedDaysUsed);

  if (overlapDaysUsed > 0) {
    const overlapParent1Monthly = toNumber(legacyResult.plan1Overlap?.inkomst);
    const overlapParent2Monthly = beräknaMånadsinkomst(
      toNumber(legacyResult.dag2),
      toNumber(legacyResult.plan1Overlap?.dagarPerVecka),
      toNumber(legacyResult.extra2),
      0,
      0
    );
    const overlapBenefitMonthly =
      beräknaMånadsinkomst(toNumber(legacyResult.dag1), toNumber(legacyResult.plan1Overlap?.dagarPerVecka), 0, 0, 0) +
      beräknaMånadsinkomst(toNumber(legacyResult.dag2), toNumber(legacyResult.plan1Overlap?.dagarPerVecka), 0, 0, 0);

    currentDate = addSegment(periods, currentDate, {
      plan: legacyResult.plan1Overlap,
      parent: 'both',
      benefitLevel: legacyResult.extra1 > 0 || legacyResult.extra2 > 0 ? 'parental-salary' : 'high',
      otherParentMonthlyIncome: 0,
      usedDays: overlapDaysUsed,
      fallbackDaysPerWeek: resolveDaysPerWeek(legacyResult.plan1Overlap?.dagarPerVecka),
      benefitMonthly: overlapBenefitMonthly,
      leaveMonthlyIncome: overlapParent1Monthly + overlapParent2Monthly,
    }, calendarDaysAccumulator);
  }

  if (plan1ExtraDays > 0) {
    const benefitMonthly = toNumber(legacyResult.plan1?.inkomstUtanExtra ?? legacyResult.plan1?.inkomst);
    const leaveMonthlyIncome = toNumber(legacyResult.plan1?.inkomst);
    currentDate = addSegment(periods, currentDate, {
      plan: legacyResult.plan1,
      parent: 'parent1',
      benefitLevel: legacyResult.extra1 > 0 ? 'parental-salary' : 'high',
      otherParentMonthlyIncome: toNumber(legacyResult.arbetsInkomst2),
      usedDays: plan1ExtraDays,
      fallbackDaysPerWeek: resolveDaysPerWeek(legacyResult.plan1?.dagarPerVecka),
      benefitMonthly,
      leaveMonthlyIncome,
    }, calendarDaysAccumulator);
  }

  if (plan1NoExtraDays > 0) {
    const benefitMonthly = toNumber(legacyResult.plan1NoExtra?.inkomst);
    currentDate = addSegment(periods, currentDate, {
      plan: legacyResult.plan1NoExtra,
      parent: 'parent1',
      benefitLevel: 'high',
      otherParentMonthlyIncome: toNumber(legacyResult.arbetsInkomst2),
      usedDays: plan1NoExtraDays,
      fallbackDaysPerWeek: resolveDaysPerWeek(
        legacyResult.plan1NoExtra?.dagarPerVecka,
        legacyResult.plan1?.dagarPerVecka
      ),
      benefitMonthly,
      leaveMonthlyIncome: benefitMonthly,
    }, calendarDaysAccumulator);
  }

  const totalPlan1MinDays = plan1MinDays + plan1MinContinuationDays;
  if (totalPlan1MinDays > 0) {
    const benefitMonthly = toNumber(legacyResult.plan1MinDagar?.inkomst);
    currentDate = addSegment(periods, currentDate, {
      plan: legacyResult.plan1MinDagar,
      parent: 'parent1',
      benefitLevel: 'low',
      otherParentMonthlyIncome: toNumber(legacyResult.arbetsInkomst2),
      usedDays: totalPlan1MinDays,
      fallbackDaysPerWeek: resolveDaysPerWeek(
        legacyResult.plan1MinDagar?.dagarPerVecka,
        legacyResult.plan1?.dagarPerVecka
      ),
      benefitMonthly,
      leaveMonthlyIncome: benefitMonthly,
    }, calendarDaysAccumulator);
  }

  if (plan2ExtraDays > 0) {
    const benefitMonthly = toNumber(legacyResult.plan2?.inkomstUtanExtra ?? legacyResult.plan2?.inkomst);
    const leaveMonthlyIncome = toNumber(legacyResult.plan2?.inkomst);
    currentDate = addSegment(periods, currentDate, {
      plan: legacyResult.plan2,
      parent: 'parent2',
      benefitLevel: legacyResult.extra2 > 0 ? 'parental-salary' : 'high',
      otherParentMonthlyIncome: toNumber(legacyResult.arbetsInkomst1),
      usedDays: plan2ExtraDays,
      fallbackDaysPerWeek: resolveDaysPerWeek(legacyResult.plan2?.dagarPerVecka),
      benefitMonthly,
      leaveMonthlyIncome,
    }, calendarDaysAccumulator);
  }

  if (plan2NoExtraDays > 0) {
    const benefitMonthly = toNumber(legacyResult.plan2NoExtra?.inkomst);
    currentDate = addSegment(periods, currentDate, {
      plan: legacyResult.plan2NoExtra,
      parent: 'parent2',
      benefitLevel: 'high',
      otherParentMonthlyIncome: toNumber(legacyResult.arbetsInkomst1),
      usedDays: plan2NoExtraDays,
      fallbackDaysPerWeek: resolveDaysPerWeek(
        legacyResult.plan2NoExtra?.dagarPerVecka,
        legacyResult.plan2?.dagarPerVecka
      ),
      benefitMonthly,
      leaveMonthlyIncome: benefitMonthly,
    }, calendarDaysAccumulator);
  }

  const totalPlan2MinDays = plan2MinDays + plan2MinContinuationDays;
  if (totalPlan2MinDays > 0) {
    const benefitMonthly = toNumber(legacyResult.plan2MinDagar?.inkomst);
    currentDate = addSegment(periods, currentDate, {
      plan: legacyResult.plan2MinDagar,
      parent: 'parent2',
      benefitLevel: 'low',
      otherParentMonthlyIncome: toNumber(legacyResult.arbetsInkomst1),
      usedDays: totalPlan2MinDays,
      fallbackDaysPerWeek: resolveDaysPerWeek(
        legacyResult.plan2MinDagar?.dagarPerVecka,
        legacyResult.plan2?.dagarPerVecka
      ),
      benefitMonthly,
      leaveMonthlyIncome: benefitMonthly,
    }, calendarDaysAccumulator);
  }

  // No filler periods - we strictly adhere to the total months specified
  // The periods should end when we've reached the target total months

  // Merge consecutive periods with same parent and benefit level
  const mergedPeriods: LeavePeriod[] = [];
  for (const period of periods) {
    const last = mergedPeriods[mergedPeriods.length - 1];
    
    // Check if we can merge with the previous period
    if (
      last &&
      last.parent === period.parent &&
      last.benefitLevel === period.benefitLevel &&
      last.daysPerWeek === period.daysPerWeek &&
      Math.abs(last.dailyIncome - period.dailyIncome) < 1 && // Same income
      Math.abs(last.dailyBenefit - period.dailyBenefit) < 1 && // Same benefit
      Math.abs((last.otherParentDailyIncome || 0) - (period.otherParentDailyIncome || 0)) < 1 // Same other parent income
    ) {
      // Merge with previous period
      last.endDate = period.endDate;
      last.daysCount += period.daysCount;
    } else {
      mergedPeriods.push({ ...period });
    }
  }

  const totalIncome = mergedPeriods.reduce((sum, period) => sum + period.dailyIncome * period.daysCount, 0);
  const averageMonthlyIncome = calendarDaysAccumulator.value > 0
    ? (totalIncome / calendarDaysAccumulator.value) * 30
    : 0;

  return {
    strategy: meta.key,
    title: meta.title,
    description: meta.description,
    periods: mergedPeriods,
    totalIncome,
    daysUsed: clampedDaysUsed,
    daysSaved,
    averageMonthlyIncome,
  };
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

  const normalizedDaysPerWeek = Math.max(1, Math.min(7, Math.round(daysPerWeek)));
  const baseDaysPerWeek = 5;
  const scaleFactor = baseDaysPerWeek / normalizedDaysPerWeek;

  const scaledParent1Months = parent1Months * scaleFactor;
  const scaledParent2Months = parent2Months * scaleFactor;
  const effectiveParent1Months = Math.max(parent1Months, scaledParent1Months);
  const effectiveParent2Months = Math.max(parent2Months, scaledParent2Months);

  const combinedNetIncome = calc1.netIncome + calc2.netIncome;
  const combinedAvailableIncome = calc1.availableIncome + calc2.availableIncome;

  const baseInputs = {
    inkomst1: parent1.income,
    inkomst2: parent2.income,
    avtal1: parent1.hasCollectiveAgreement ? 'ja' : 'nej',
    avtal2: parent2.hasCollectiveAgreement ? 'ja' : 'nej',
    anställningstid1: '>1',
    anställningstid2: '>1',
    vårdnad: 'gemensam',
    beräknaPartner: 'ja',
    planeradeBarn: 1,
  };

  const strategies: StrategyMeta[] = [
    {
      key: 'save-days',
      legacyKey: 'longer',
      title: 'Spara dagar',
      description: 'Minimerar uttaget per vecka för att hushållets inkomst ska nå målet med färre förbrukade dagar.',
    },
    {
      key: 'maximize-income',
      legacyKey: 'maximize',
      title: 'Maximera inkomst',
      description: 'Använder fler dagar per vecka för att maximera hushållets månadsinkomst under ledigheten.',
    },
  ];

  const preferredParent1Months = effectiveParent1Months;
  const preferredParent2Months = effectiveParent2Months;
  const adjustedTotalMonths = preferredParent1Months + preferredParent2Months + simultaneousMonths;

  const allowFullWeekForSave = normalizedDaysPerWeek > baseDaysPerWeek;
  const allowFullWeekForMax = normalizedDaysPerWeek >= baseDaysPerWeek;

  const buildPreferences = (strategyKey: LegacyStrategyKey, minIncome: number, allowFullWeek: boolean) => ({
    deltid: allowFullWeek ? 'nej' : 'ja',
    ledigTid1: preferredParent1Months,
    ledigTid2: preferredParent2Months,
    minInkomst: Math.max(0, Math.round(minIncome)),
    strategy: strategyKey,
  });

  const conversionContext: ConversionContext = {
    parent1,
    parent2,
    parent1NetIncome: calc1.netIncome,
    parent2NetIncome: calc2.netIncome,
    adjustedTotalMonths,
    requestedDaysPerWeek: normalizedDaysPerWeek,
  };

  const saveDaysMeta = strategies.find((strategy) => strategy.key === 'save-days')!;
  const savePreferences = buildPreferences(saveDaysMeta.legacyKey, minHouseholdIncome, allowFullWeekForSave);
  const saveLegacyResult = optimizeParentalLeave(savePreferences, baseInputs);
  const saveResult = convertLegacyResult(saveDaysMeta, saveLegacyResult, conversionContext);

  const maximizeMeta = strategies.find((strategy) => strategy.key === 'maximize-income')!;

  const incomeTargets = new Set<number>();
  incomeTargets.add(Math.max(minHouseholdIncome, Math.round(combinedAvailableIncome)));
  incomeTargets.add(Math.max(minHouseholdIncome, Math.round(combinedNetIncome)));
  if (incomeTargets.size === 0) {
    incomeTargets.add(Math.max(0, Math.round(minHouseholdIncome)));
  }

  const candidateStrategyKeys: LegacyStrategyKey[] = ['maximize', 'maximize_parental_salary'];
  const maximizeCandidates: OptimizationResult[] = [];

  incomeTargets.forEach((target) => {
    candidateStrategyKeys.forEach((strategyKey) => {
      const preferences = buildPreferences(strategyKey, target, allowFullWeekForMax);
      const legacyResult = optimizeParentalLeave(preferences, baseInputs);
      const converted = convertLegacyResult(maximizeMeta, legacyResult, conversionContext);
      maximizeCandidates.push(converted);
    });
  });

  if (maximizeCandidates.length === 0) {
    const fallbackPreferences = buildPreferences(maximizeMeta.legacyKey, minHouseholdIncome, allowFullWeekForMax);
    const fallbackLegacy = optimizeParentalLeave(fallbackPreferences, baseInputs);
    maximizeCandidates.push(convertLegacyResult(maximizeMeta, fallbackLegacy, conversionContext));
  }

  const pickBetter = (best: OptimizationResult, current: OptimizationResult) => {
    if (current.daysUsed !== best.daysUsed) {
      return current.daysUsed > best.daysUsed ? current : best;
    }
    if (current.totalIncome !== best.totalIncome) {
      return current.totalIncome > best.totalIncome ? current : best;
    }
    return current.averageMonthlyIncome > best.averageMonthlyIncome ? current : best;
  };

  let maximizeResult = maximizeCandidates.reduce(pickBetter);

  if (maximizeResult.daysUsed <= saveResult.daysUsed) {
    const pushTarget = Math.max(minHouseholdIncome, Math.round(combinedAvailableIncome * 1.1));
    const extraPreferences = buildPreferences('maximize_parental_salary', pushTarget, allowFullWeekForMax);
    const extraLegacy = optimizeParentalLeave(extraPreferences, baseInputs);
    const extraResult = convertLegacyResult(maximizeMeta, extraLegacy, conversionContext);
    maximizeResult = pickBetter(maximizeResult, extraResult);
  }

  return [saveResult, maximizeResult];
}

export function formatPeriod(period: LeavePeriod): string {
  return `${format(period.startDate, 'd MMM yyyy', { locale: sv })} - ${format(period.endDate, 'd MMM yyyy', { locale: sv })}`;
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('sv-SE', {
    style: 'currency',
    currency: 'SEK',
    maximumFractionDigits: 0,
  }).format(amount);
}
