import { addDays, addMonths, differenceInCalendarDays, format, startOfDay, startOfMonth, endOfMonth } from 'date-fns';
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
  highBenefitDaysUsed?: number;
  lowBenefitDaysUsed?: number;
  highBenefitDaysSaved?: number;
  lowBenefitDaysSaved?: number;
  parent1HighDaysUsed?: number;
  parent1LowDaysUsed?: number;
  parent2HighDaysUsed?: number;
  parent2LowDaysUsed?: number;
  parent1HighDaysSaved?: number;
  parent1LowDaysSaved?: number;
  parent2HighDaysSaved?: number;
  parent2LowDaysSaved?: number;
  parent1TotalIncome?: number;
  parent2TotalIncome?: number;
  parent1BenefitIncomeTotal?: number;
  parent2BenefitIncomeTotal?: number;
  parent1ParentalSalaryTotal?: number;
  parent2ParentalSalaryTotal?: number;
  parent1WorkingIncomeTotal?: number;
  parent2WorkingIncomeTotal?: number;
  transferredToParent1?: number;
  transferredToParent2?: number;
  warnings?: string[];
}

export interface LeavePeriod {
  parent: 'parent1' | 'parent2' | 'both';
  startDate: Date;
  endDate: Date;
  daysCount: number;
  benefitDaysUsed: number;
  highBenefitDaysUsed?: number;
  lowBenefitDaysUsed?: number;
  calendarDays: number;
  dailyBenefit: number;
  dailyIncome: number;
  benefitLevel: 'high' | 'low' | 'none';
  daysPerWeek?: number;
  otherParentDailyIncome?: number;
  otherParentMonthlyIncome?: number;
  otherParentIncomeForPeriod?: number;
  isInitialTenDayPeriod?: boolean;
  isPreferenceFiller?: boolean;
  transferredDays?: number;
  transferredFromParent?: 'parent1' | 'parent2';
  transferredHighDays?: number;
  transferredLowDays?: number;
  needsSequencing?: boolean;
  isTopUp?: boolean;
  monthlyIncome?: number;
  baseDailyIncome?: number;
  collectiveAgreementEligibleCalendarDays?: number;
  collectiveAgreementEligibleBenefitDays?: number;
  collectiveAgreementTotalBonus?: number;
  isSimultaneous?: boolean;
  parent1BenefitDays?: number;
  parent2BenefitDays?: number;
  parent1Income?: number;
  parent2Income?: number;
  parent1BenefitIncome?: number;
  parent2BenefitIncome?: number;
  parent1ParentalSalary?: number;
  parent2ParentalSalary?: number;
}

const PARENTAL_BENEFIT_CEILING = 49000;
const HIGH_BENEFIT_DAYS = 390;
const LOW_BENEFIT_DAYS = 90;
export const TOTAL_BENEFIT_DAYS = HIGH_BENEFIT_DAYS + LOW_BENEFIT_DAYS;
const RESERVED_HIGH_BENEFIT_DAYS_PER_PARENT = 90;
const INITIAL_SHARED_WORKING_DAYS = 10;
const INITIAL_SHARED_CALENDAR_DAYS = 14;
const MAX_BENEFIT_DAYS_PER_MONTH = 31;
const MAX_PARENTAL_BENEFIT_PER_DAY = 1250;
const HIGH_BENEFIT_RATE = 0.8;
const SGI_RATE = 0.97;
const PRISBASBELOPP_2025 = 58800;
const PARENTAL_SALARY_THRESHOLD = (10 * PRISBASBELOPP_2025) / 12;

interface MonthlyUsageStats {
  monthLength: number;
  parent1Days: number;
  parent2Days: number;
  simultaneousCalendarDays: number;
}

interface CandidateEvaluation {
  simultaneousCoverage: number;
  hasOverflow: boolean;
  parent1ParentalSalaryTotal: number;
  parent2ParentalSalaryTotal: number;
}

function computeMonthlyUsageStats(periods: LeavePeriod[]): Map<string, MonthlyUsageStats> {
  const stats = new Map<string, MonthlyUsageStats>();

  periods.forEach(period => {
    const periodStart = startOfDay(new Date(period.startDate));
    const periodEnd = startOfDay(new Date(period.endDate));

    if (periodEnd.getTime() < periodStart.getTime()) {
      return;
    }

    const segments: Array<{
      monthKey: string;
      monthLength: number;
      calendarDays: number;
      benefitDays: number;
    }> = [];

    let cursor = new Date(periodStart);
    while (cursor.getTime() <= periodEnd.getTime()) {
      const monthStart = startOfMonth(cursor);
      const monthEndCandidate = endOfMonth(monthStart);
      const segmentEnd = monthEndCandidate.getTime() < periodEnd.getTime() ? monthEndCandidate : periodEnd;
      const calendarDays = Math.max(1, differenceInCalendarDays(segmentEnd, cursor) + 1);
      const monthLength = differenceInCalendarDays(monthEndCandidate, monthStart) + 1;

      segments.push({
        monthKey: `${monthStart.getFullYear()}-${monthStart.getMonth()}`,
        monthLength,
        calendarDays,
        benefitDays: 0,
      });

      cursor = startOfDay(addDays(segmentEnd, 1));
    }

    if (segments.length === 0) {
      return;
    }

    const totalCalendarDays = segments.reduce((sum, segment) => sum + segment.calendarDays, 0) || 1;
    const totalBenefitDays = Math.max(0, Math.round(period.benefitDaysUsed ?? period.daysCount ?? 0));
    const maxMultiplier = period.parent === 'both' ? 2 : 1;

    if (segments.length === 1) {
      segments[0].benefitDays = Math.min(totalBenefitDays, segments[0].calendarDays * maxMultiplier);
    } else if (totalBenefitDays > 0) {
      const allocations = segments.map(segment => {
        const proportion = segment.calendarDays / totalCalendarDays;
        const raw = totalBenefitDays * proportion;
        const base = Math.floor(raw);
        return {
          segment,
          base,
          remainder: raw - base,
        };
      });

      let allocated = 0;
      allocations.forEach(({ segment, base }) => {
        const cap = segment.calendarDays * maxMultiplier;
        const cappedBase = Math.min(cap, base);
        segment.benefitDays = cappedBase;
        allocated += cappedBase;
      });

      let remaining = Math.max(0, totalBenefitDays - allocated);

      if (remaining > 0) {
        const sorted = allocations.slice().sort((a, b) => b.remainder - a.remainder);
        for (const { segment } of sorted) {
          if (remaining <= 0) break;
          const cap = segment.calendarDays * maxMultiplier;
          if (segment.benefitDays >= cap) continue;
          segment.benefitDays += 1;
          allocated += 1;
          remaining -= 1;
        }
      }

      if (allocated < totalBenefitDays) {
        const last = allocations[allocations.length - 1]?.segment;
        if (last) {
          const cap = last.calendarDays * maxMultiplier;
          const additional = Math.min(cap - last.benefitDays, totalBenefitDays - allocated);
          if (additional > 0) {
            last.benefitDays += additional;
            allocated += additional;
          }
        }
      }

      if (allocated < totalBenefitDays) {
        const first = allocations[0]?.segment;
        if (first) {
          const cap = first.calendarDays * maxMultiplier;
          const additional = Math.min(cap - first.benefitDays, totalBenefitDays - allocated);
          if (additional > 0) {
            first.benefitDays += additional;
            allocated += additional;
          }
        }
      }
    }

    segments.forEach(segment => {
      const existing = stats.get(segment.monthKey) ?? {
        monthLength: segment.monthLength,
        parent1Days: 0,
        parent2Days: 0,
        simultaneousCalendarDays: 0,
      };

      existing.monthLength = segment.monthLength;

      if (period.parent === 'parent1') {
        existing.parent1Days += segment.benefitDays;
      } else if (period.parent === 'parent2') {
        existing.parent2Days += segment.benefitDays;
      } else {
        const parentShare = segment.benefitDays / 2;
        existing.parent1Days += parentShare;
        existing.parent2Days += parentShare;
        if (!period.isInitialTenDayPeriod) {
          existing.simultaneousCalendarDays += segment.calendarDays;
        }
      }

      stats.set(segment.monthKey, existing);
    });
  });

  return stats;
}

function countFullSimultaneousMonths(stats: Map<string, MonthlyUsageStats>): number {
  let count = 0;
  stats.forEach(entry => {
    if (entry.simultaneousCalendarDays >= entry.monthLength - 0.5 && entry.simultaneousCalendarDays > 0) {
      count += 1;
    }
  });
  return count;
}

function hasMonthlyOverflow(stats: Map<string, MonthlyUsageStats>): boolean {
  let overflow = false;
  stats.forEach(entry => {
    const threshold = entry.monthLength + 0.5;
    if (entry.parent1Days > threshold || entry.parent2Days > threshold) {
      overflow = true;
    }
  });
  return overflow;
}

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

function clampDaysPerWeek(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  if (value <= 0) {
    return 0;
  }

  if (value >= 7) {
    return 7;
  }

  return Math.min(7, Math.max(1, Math.ceil(value)));
}

interface MonthlySegment {
  start: Date;
  end: Date;
  calendarDays: number;
  daysInMonth: number;
  proportion: number;
}

function splitIntoMonthlySegments(start: Date, end: Date): MonthlySegment[] {
  const normalizedStart = startOfDay(start);
  const normalizedEnd = startOfDay(end);
  if (normalizedStart.getTime() > normalizedEnd.getTime()) {
    return [];
  }

  const segments: MonthlySegment[] = [];
  let cursor = new Date(normalizedStart);

  while (cursor.getTime() <= normalizedEnd.getTime()) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const monthStart = startOfDay(new Date(year, month, 1));
    const monthEnd = startOfDay(new Date(year, month + 1, 0));
    const segmentEnd = monthEnd.getTime() > normalizedEnd.getTime() ? new Date(normalizedEnd) : monthEnd;
    const calendarDays = Math.max(1, differenceInCalendarDays(segmentEnd, cursor) + 1);
    const daysInMonth = Math.max(1, differenceInCalendarDays(monthEnd, monthStart) + 1);
    const proportion = Math.min(1, Math.max(0, calendarDays / daysInMonth));

    segments.push({
      start: new Date(cursor),
      end: segmentEnd,
      calendarDays,
      daysInMonth,
      proportion,
    });

    cursor = startOfDay(addDays(segmentEnd, 1));
  }

  return segments;
}

function calculateOwnerMonthlyBenefitUsage(
  periods: LeavePeriod[],
  owner: 'parent1' | 'parent2',
  monthStart: Date,
  monthEnd: Date
): number {
  const safeStart = startOfDay(monthStart);
  const safeEnd = startOfDay(monthEnd);

  if (safeEnd.getTime() < safeStart.getTime()) {
    return 0;
  }

  let total = 0;

  periods.forEach(period => {
    if (!period || !period.startDate || !period.endDate) {
      return;
    }

    if (period.benefitLevel === 'none') {
      return;
    }

    const periodStart = startOfDay(new Date(period.startDate));
    const periodEnd = startOfDay(new Date(period.endDate));

    if (periodEnd.getTime() < safeStart.getTime() || periodStart.getTime() > safeEnd.getTime()) {
      return;
    }

    const overlapStart = periodStart.getTime() > safeStart.getTime() ? periodStart : safeStart;
    const overlapEnd = periodEnd.getTime() < safeEnd.getTime() ? periodEnd : safeEnd;
    const overlapDays = Math.max(0, differenceInCalendarDays(overlapEnd, overlapStart) + 1);

    if (overlapDays <= 0) {
      return;
    }

    const rawBenefitDays = toNumber(period.benefitDaysUsed ?? period.daysCount);
    const totalBenefitDays = Math.max(0, Number.isFinite(rawBenefitDays) ? rawBenefitDays : 0);

    if (totalBenefitDays <= 0) {
      return;
    }

    const periodCalendarDays = Math.max(1, differenceInCalendarDays(periodEnd, periodStart) + 1);
    const proportionalBenefit = Math.min(totalBenefitDays, (totalBenefitDays * overlapDays) / periodCalendarDays);

    if (period.parent === owner) {
      total += proportionalBenefit;
    } else if (period.parent === 'both') {
      total += proportionalBenefit / 2;
    }
  });

  return total;
}

type RemainingBenefitDays = Record<'parent1' | 'parent2', number>;

interface TopUpOptions {
  parent: 'parent1' | 'parent2';
  start: Date;
  end: Date;
  context: ConversionContext;
  baseDaysPerWeek: number;
  remainingLowDays: RemainingBenefitDays;
  remainingHighDays: RemainingBenefitDays;
  parent1CutoffDate?: Date | null;
  parentCalendarUsage: Record<'parent1' | 'parent2', number>;
  parentCalendarCaps: Record<'parent1' | 'parent2', number>;
  prioritizeLowBenefit?: boolean;
}

const APPROX_CALENDAR_DAYS_PER_MONTH = 30;
const DAYS_PER_YEAR = 365;
const MONTHS_PER_YEAR = 12;
const AVERAGE_DAYS_PER_MONTH = DAYS_PER_YEAR / MONTHS_PER_YEAR;
const COLLECTIVE_AGREEMENT_MAX_MONTHS = 6;
const COLLECTIVE_MAX_CALENDAR_DAYS = Math.round(COLLECTIVE_AGREEMENT_MAX_MONTHS * AVERAGE_DAYS_PER_MONTH);
const COLLECTIVE_GAP_ALLOWANCE_DAYS = 1;

interface MonthMetrics {
  totalIncome: number;
  parentDayTotals: Record<'parent1' | 'parent2', number>;
  parentMaxDaysPerWeek: Record<'parent1' | 'parent2', number>;
  coveredDays: number;
  hasInitialTenDay: boolean;
  hasNonInitialOwnerLeave: boolean;
  overlappingPeriods: LeavePeriod[];
}

function computeMonthMetrics(
  periods: LeavePeriod[],
  monthStart: Date,
  monthEnd: Date
): MonthMetrics {
  const parentDayTotals: Record<'parent1' | 'parent2', number> = { parent1: 0, parent2: 0 };
  const parentMaxDaysPerWeek: Record<'parent1' | 'parent2', number> = { parent1: 0, parent2: 0 };
  let totalIncome = 0;
  const coveredDaySet = new Set<number>();
  let hasInitialTenDay = false;
  let hasNonInitialOwnerLeave = false;
  const overlappingPeriods: LeavePeriod[] = [];

  for (const period of periods) {
    const periodStart = startOfDay(period.startDate);
    const periodEnd = startOfDay(period.endDate);

    if (periodEnd.getTime() < monthStart.getTime() || periodStart.getTime() > monthEnd.getTime()) {
      continue;
    }

    const overlapStart = periodStart.getTime() > monthStart.getTime() ? periodStart : monthStart;
    const overlapEnd = periodEnd.getTime() < monthEnd.getTime() ? periodEnd : monthEnd;
    const overlapDays = Math.max(0, differenceInCalendarDays(overlapEnd, overlapStart) + 1);

    if (overlapDays <= 0) {
      continue;
    }

    for (let offset = 0; offset < overlapDays; offset++) {
      const dayIndex = differenceInCalendarDays(addDays(overlapStart, offset), monthStart);
      if (dayIndex >= 0) {
        coveredDaySet.add(dayIndex);
      }
    }

    totalIncome += (period.dailyIncome || 0) * overlapDays;

    if (period.parent === 'parent1' || period.parent === 'parent2') {
      parentDayTotals[period.parent] += overlapDays;
      const safeDaysPerWeek = Number.isFinite(period.daysPerWeek) ? (period.daysPerWeek as number) : 0;
      parentMaxDaysPerWeek[period.parent] = Math.max(parentMaxDaysPerWeek[period.parent], safeDaysPerWeek);
    } else if (period.parent === 'both') {
      parentDayTotals.parent1 += overlapDays;
      parentDayTotals.parent2 += overlapDays;
      const safeDaysPerWeek = Number.isFinite(period.daysPerWeek) ? (period.daysPerWeek as number) : 0;
      parentMaxDaysPerWeek.parent1 = Math.max(parentMaxDaysPerWeek.parent1, safeDaysPerWeek);
      parentMaxDaysPerWeek.parent2 = Math.max(parentMaxDaysPerWeek.parent2, safeDaysPerWeek);
    }

    if (period.isInitialTenDayPeriod) {
      hasInitialTenDay = true;
    }

    if (!period.isInitialTenDayPeriod && (period.parent === 'parent1' || period.parent === 'parent2')) {
      hasNonInitialOwnerLeave = true;
    }

    overlappingPeriods.push(period);
  }

  return {
    totalIncome,
    parentDayTotals,
    parentMaxDaysPerWeek,
    coveredDays: coveredDaySet.size,
    hasInitialTenDay,
    hasNonInitialOwnerLeave,
    overlappingPeriods,
  };
}

function detectMinimumIncomeWarnings(
  periods: LeavePeriod[],
  context: ConversionContext,
  timelineLimit: Date | null,
  parent1CutoffDate: Date | null
): string[] {
  if (!context.minHouseholdIncome || context.minHouseholdIncome <= 0) {
    return [];
  }

  const warnings: string[] = [];
  const timelineStart = startOfDay(new Date(context.baseStartDate.getFullYear(), context.baseStartDate.getMonth(), 1));
  const limitDate = timelineLimit ? startOfDay(timelineLimit) : null;
  const latestExistingEnd = periods.reduce<Date | null>((latest, period) => {
    const periodEnd = startOfDay(period.endDate);
    if (!latest || periodEnd.getTime() > latest.getTime()) {
      return periodEnd;
    }
    return latest;
  }, null);

  const timelineEnd = limitDate && latestExistingEnd && latestExistingEnd.getTime() < limitDate.getTime()
    ? new Date(latestExistingEnd)
    : (limitDate ?? (latestExistingEnd ?? startOfDay(addMonths(timelineStart, 15))));

  const remainingTotals = calculateRemainingBenefitDays(periods, context);
  const remainingByParent: Record<'parent1' | 'parent2', number> = {
    parent1: (remainingTotals.low.parent1 ?? 0) + (remainingTotals.high.parent1 ?? 0),
    parent2: (remainingTotals.low.parent2 ?? 0) + (remainingTotals.high.parent2 ?? 0),
  };

  let cursor = new Date(timelineStart);
  const deficitMonths: {
    monthStart: Date;
    monthLabel: string;
    monthIncome: number;
    dominantParent: 'parent1' | 'parent2';
  }[] = [];
  const splitMonthThreshold = 5;

  while (cursor.getTime() <= timelineEnd.getTime()) {
    const monthStart = startOfDay(cursor);
    const monthEndCandidate = startOfDay(new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0));
    const monthEnd = limitDate && monthEndCandidate.getTime() > limitDate.getTime()
      ? new Date(limitDate)
      : monthEndCandidate;

    if (parent1CutoffDate && monthStart.getTime() >= startOfDay(parent1CutoffDate).getTime()) {
      // Parent 1 may be restricted after cutoff, but we still evaluate income shortfall.
    }

    const metrics = computeMonthMetrics(periods, monthStart, monthEnd);
    const monthLength = Math.max(1, differenceInCalendarDays(monthEndCandidate, monthStart) + 1);
    const isFullMonth = metrics.coveredDays >= monthLength;

    if (isFullMonth && metrics.hasNonInitialOwnerLeave) {
      const hasSimultaneousOnly =
        metrics.overlappingPeriods.length > 0 &&
        metrics.overlappingPeriods.every(period => period.parent === 'both');
      const parent1Days = metrics.parentDayTotals.parent1;
      const parent2Days = metrics.parentDayTotals.parent2;
      const isSplitMonth =
        !hasSimultaneousOnly &&
        parent1Days >= splitMonthThreshold &&
        parent2Days >= splitMonthThreshold;

      if (isSplitMonth) {
        cursor = startOfDay(addMonths(monthStart, 1));
        continue;
      }

      const monthIncome = metrics.totalIncome;
      if (monthIncome + 1 < context.minHouseholdIncome) {
        const monthLabel = format(monthStart, 'MMMM yyyy', { locale: sv });
        const dominantParent: 'parent1' | 'parent2' = parent1Days >= parent2Days ? 'parent1' : 'parent2';
        const dominantMaxDaysPerWeek = metrics.parentMaxDaysPerWeek[dominantParent];
        if (dominantMaxDaysPerWeek < 5) {
          cursor = startOfDay(addMonths(monthStart, 1));
          continue;
        }

        deficitMonths.push({
          monthStart: monthStart,
          monthLabel,
          monthIncome,
          dominantParent,
        });
      }
    }

    cursor = startOfDay(addMonths(monthStart, 1));
  }

  if (deficitMonths.length === 0) {
    return warnings;
  }

  const worstMonth = deficitMonths.reduce((worst, current) => {
    if (!worst) {
      return current;
    }

    if (current.monthIncome < worst.monthIncome - 0.5) {
      return current;
    }

    if (Math.abs(current.monthIncome - worst.monthIncome) <= 0.5) {
      return current.monthStart.getTime() < worst.monthStart.getTime() ? current : worst;
    }

    return worst;
  }, deficitMonths[0]);

  const formattedIncome = formatCurrency(Math.max(0, worstMonth.monthIncome));
  const formattedMinimum = formatCurrency(Math.max(0, context.minHouseholdIncome));
  const dominantParentLabel = worstMonth.dominantParent === 'parent1' ? 'Förälder 1' : 'Förälder 2';
  const alternateParent: 'parent1' | 'parent2' = worstMonth.dominantParent === 'parent1' ? 'parent2' : 'parent1';
  const alternateLabel = alternateParent === 'parent1' ? 'Förälder 1' : 'Förälder 2';
  const remainingParent1 = remainingByParent.parent1;
  const remainingParent2 = remainingByParent.parent2;
  const alternateRemaining = remainingByParent[alternateParent];
  const dominantRemaining = remainingByParent[worstMonth.dominantParent];

  const baseMessage = `Hushållets inkomst i ${worstMonth.monthLabel} är ${formattedIncome}, vilket är under minimiinkomsten ${formattedMinimum}.`;

  let suggestion: string;
  if (remainingParent1 <= 0 && remainingParent2 <= 0) {
    suggestion = 'Inga föräldrapenningdagar finns kvar att omfördela.';
  } else if (alternateRemaining > 0) {
    suggestion = `Överväg att låta ${alternateLabel} vara hemma fler dagar under ${worstMonth.monthLabel} för att öka inkomsten.`;
  } else if (dominantRemaining > 0) {
    suggestion = `Överväg att öka uttaget för ${dominantParentLabel} under ${worstMonth.monthLabel}.`;
  } else {
    suggestion = 'Justera fördelningen av dagar mellan föräldrarna för att nå upp till miniminivån.';
  }

  warnings.push(`${baseMessage} ${suggestion}`);

  return warnings;
}

function enforceMonthlyMinimumIncome(
  periods: LeavePeriod[],
  context: ConversionContext,
  remainingLowDays: RemainingBenefitDays,
  remainingHighDays: RemainingBenefitDays,
  timelineLimit: Date | null,
  parent1CutoffDate: Date | null
): void {
  if (!context.minHouseholdIncome || context.minHouseholdIncome <= 0) {
    return;
  }

  const MAX_ITERATIONS = 24;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const recalculatedRemaining = calculateRemainingBenefitDays(periods, context);
    remainingLowDays.parent1 = recalculatedRemaining.low.parent1;
    remainingLowDays.parent2 = recalculatedRemaining.low.parent2;
    remainingHighDays.parent1 = recalculatedRemaining.high.parent1;
    remainingHighDays.parent2 = recalculatedRemaining.high.parent2;

    const timelineStart = startOfDay(new Date(context.baseStartDate.getFullYear(), context.baseStartDate.getMonth(), 1));
    const limitDate = timelineLimit ? startOfDay(timelineLimit) : null;
    const latestExistingEnd = periods.reduce<Date | null>((latest, period) => {
      const periodEnd = startOfDay(period.endDate);
      if (!latest || periodEnd.getTime() > latest.getTime()) {
        return periodEnd;
      }
      return latest;
    }, null);

    const timelineEnd = limitDate && latestExistingEnd && latestExistingEnd.getTime() < limitDate.getTime()
      ? addMonths(new Date(limitDate), 1)
      : (limitDate ?? (latestExistingEnd ? addMonths(latestExistingEnd, 1) : startOfDay(addMonths(timelineStart, 16))));

    let cursor = new Date(timelineStart);
    let worstDeficit = 0;
    let targetMonth: {
      start: Date;
      end: Date;
      owner: 'parent1' | 'parent2';
      metrics: MonthMetrics;
    } | null = null;

    while (cursor.getTime() <= timelineEnd.getTime()) {
      const monthStart = startOfDay(cursor);
      const monthEndCandidate = startOfDay(new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0));
      const monthEnd = limitDate && monthEndCandidate.getTime() > limitDate.getTime()
        ? new Date(limitDate)
        : monthEndCandidate;

      const metrics = computeMonthMetrics(periods, monthStart, monthEnd);
      const monthLength = Math.max(1, differenceInCalendarDays(monthEndCandidate, monthStart) + 1);
      const isFullMonth = metrics.coveredDays >= Math.floor(monthLength * 0.85);

      if (isFullMonth && metrics.hasNonInitialOwnerLeave) {
        const deficit = context.minHouseholdIncome - metrics.totalIncome;
        if (deficit > worstDeficit + 1) {
          const owner = metrics.parentDayTotals.parent1 >= metrics.parentDayTotals.parent2 ? 'parent1' : 'parent2';
          // Respect parent 1 cutoff if present
          if (owner === 'parent1' && parent1CutoffDate) {
            const cutoffDay = startOfDay(parent1CutoffDate);
            if (monthStart.getTime() >= cutoffDay.getTime()) {
              cursor = startOfDay(addMonths(monthStart, 1));
              continue;
            }
          }
          worstDeficit = deficit;
          targetMonth = { start: monthStart, end: monthEnd, owner, metrics };
        }
      }

      cursor = startOfDay(addMonths(monthStart, 1));
    }

    if (!targetMonth || worstDeficit <= 0) {
      break;
    }

    let owner = targetMonth.owner;
    const alternateOwner: 'parent1' | 'parent2' = owner === 'parent1' ? 'parent2' : 'parent1';
    let availableHigh = Math.max(0, remainingHighDays[owner]);
    let availableLow = Math.max(0, remainingLowDays[owner]);

    let sourceParent: 'parent1' | 'parent2' = owner;

    if (availableHigh <= 0 && availableLow <= 0) {
      const altHigh = Math.max(0, remainingHighDays[alternateOwner]);
      const altLow = Math.max(0, remainingLowDays[alternateOwner]);
      if (altHigh > 0 || altLow > 0) {
        sourceParent = alternateOwner;
        availableHigh = altHigh;
        availableLow = altLow;
      }
    }

    const ownerInfo = owner === 'parent1' ? context.parent1 : context.parent2;
    const workingParent: 'parent1' | 'parent2' = owner === 'parent1' ? 'parent2' : 'parent1';
    const workingParentNetMonthly = workingParent === 'parent1'
      ? context.parent1NetIncome
      : context.parent2NetIncome;

    const ownerHighDailyBase = owner === 'parent1'
      ? context.parent1HighDailyNet
      : context.parent2HighDailyNet;
    const ownerLowDaily = owner === 'parent1'
      ? context.parent1MinDailyNet
      : context.parent2MinDailyNet;

    const ownerBonusPerBenefitDay = ownerInfo.hasCollectiveAgreement && ownerHighDailyBase > 0
      ? computeCollectiveAgreementBonusPerBenefitDay(ownerInfo, ownerHighDailyBase)
      : 0;
    const ownerHighDailyEffective = ownerHighDailyBase + ownerBonusPerBenefitDay;

    let effectiveLevel: 'high' | 'low' | null = null;
    let effectiveDaily = 0;
    let benefitDailyBase = 0;
    let bonusPerBenefitDay = 0;

    if (availableHigh > 0 && ownerHighDailyEffective > ownerLowDaily) {
      effectiveLevel = 'high';
      effectiveDaily = ownerHighDailyEffective;
      benefitDailyBase = ownerHighDailyBase;
      bonusPerBenefitDay = ownerBonusPerBenefitDay;
    } else if (availableLow > 0 && ownerLowDaily > 0) {
      effectiveLevel = 'low';
      effectiveDaily = ownerLowDaily;
      benefitDailyBase = ownerLowDaily;
      bonusPerBenefitDay = 0;
    } else if (availableHigh > 0 && ownerHighDailyEffective > 0) {
      effectiveLevel = 'high';
      effectiveDaily = ownerHighDailyEffective;
      benefitDailyBase = ownerHighDailyBase;
      bonusPerBenefitDay = ownerBonusPerBenefitDay;
    }

    if (!effectiveLevel || effectiveDaily <= 0) {
      break;
    }

    const segmentDays = Math.max(1, differenceInCalendarDays(targetMonth.end, targetMonth.start) + 1);
    const monthStart = startOfMonth(targetMonth.start);
    const monthEndCandidate = endOfMonth(monthStart);
    const monthLength = Math.max(1, differenceInCalendarDays(monthEndCandidate, monthStart) + 1);
    const existingOwnerUsage = calculateOwnerMonthlyBenefitUsage(periods, owner, monthStart, monthEndCandidate);
    const monthlyCap = Math.min(MAX_BENEFIT_DAYS_PER_MONTH, monthLength);
    const remainingMonthlyCapacity = Math.max(0, monthlyCap - existingOwnerUsage);

    const availableBenefitDays = effectiveLevel === 'high' ? availableHigh : availableLow;
    const neededDays = Math.ceil(worstDeficit / effectiveDaily);
    const takeDays = Math.min(neededDays, availableBenefitDays, remainingMonthlyCapacity);

    if (takeDays <= 0) {
      break;
    }

    const calendarDays = Math.min(segmentDays, Math.max(1, Math.round(takeDays)));
    const periodStart = new Date(targetMonth.start);
    let periodEnd = startOfDay(addDays(periodStart, calendarDays - 1));
    if (periodEnd.getTime() > targetMonth.end.getTime()) {
      periodEnd = new Date(targetMonth.end);
    }

    const benefitIncome = benefitDailyBase * takeDays;
    const bonusIncome = bonusPerBenefitDay > 0 ? bonusPerBenefitDay * takeDays : 0;

    const totalPeriodIncome = benefitIncome + bonusIncome;
    const normalizedCalendarDays = Math.max(1, calendarDays);
    const otherParentDailyIncome = 0;
    const totalDailyIncome = totalPeriodIncome / normalizedCalendarDays;

    const topUpPeriod: LeavePeriod = {
      parent: owner,
      startDate: periodStart,
      endDate: periodEnd,
      daysCount: takeDays,
      benefitDaysUsed: takeDays,
      calendarDays,
      dailyBenefit: benefitDailyBase,
      dailyIncome: totalDailyIncome,
      benefitLevel: effectiveLevel,
      daysPerWeek: 7,
      otherParentDailyIncome,
      otherParentMonthlyIncome: workingParentNetMonthly,
      isTopUp: true,
      needsSequencing: true,
      monthlyIncome: totalPeriodIncome,
    };

    if (sourceParent !== owner) {
      topUpPeriod.transferredDays = (topUpPeriod.transferredDays ?? 0) + takeDays;
      topUpPeriod.transferredFromParent = sourceParent;
      if (effectiveLevel === 'high') {
        topUpPeriod.transferredHighDays = (topUpPeriod.transferredHighDays ?? 0) + takeDays;
      } else if (effectiveLevel === 'low') {
        topUpPeriod.transferredLowDays = (topUpPeriod.transferredLowDays ?? 0) + takeDays;
      }
    }

    periods.push(topUpPeriod);

    if (effectiveLevel === 'high') {
      if (owner === 'parent1') {
        parent1ChronologicalHighDays.count += takeDays;
      } else {
        parent2ChronologicalHighDays.count += takeDays;
      }
    }
  }
}

function computeParentCalendarCap(preferredMonths: number): number {
  if (!Number.isFinite(preferredMonths) || preferredMonths <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  const baseDays = Math.max(0, Math.round(preferredMonths * APPROX_CALENDAR_DAYS_PER_MONTH));
  return baseDays + INITIAL_SHARED_WORKING_DAYS;
}

function calculateParentCalendarUsage(periods: LeavePeriod[]): Record<'parent1' | 'parent2', number> {
  const usage: Record<'parent1' | 'parent2', number> = { parent1: 0, parent2: 0 };

  periods.forEach(period => {
    const calendarDays = period.calendarDays ?? Math.max(0, differenceInCalendarDays(period.endDate, period.startDate) + 1);
    if (!calendarDays) {
      return;
    }

    if (period.parent === 'parent1') {
      usage.parent1 += calendarDays;
    } else if (period.parent === 'parent2') {
      usage.parent2 += calendarDays;
    } else if (period.parent === 'both') {
      usage.parent1 += calendarDays;
      usage.parent2 += calendarDays;
    }
  });

  return usage;
}

function calculateRemainingBenefitDays(
  periods: LeavePeriod[],
  context: ConversionContext
): { low: RemainingBenefitDays; high: RemainingBenefitDays } {
  const usedLow: RemainingBenefitDays = { parent1: 0, parent2: 0 };
  const usedHigh: RemainingBenefitDays = { parent1: 0, parent2: 0 };

  periods.forEach(period => {
    const rawBenefitDays = period.benefitDaysUsed ?? period.daysCount ?? 0;
    const roundedBenefitDays = Math.max(0, Math.round(rawBenefitDays));
    if (!roundedBenefitDays || period.benefitLevel === 'none') {
      return;
    }

    if (period.parent === 'both') {
      const highDays = Math.max(0, Math.round(period.highBenefitDaysUsed ?? (period.benefitLevel === 'high' ? roundedBenefitDays : 0)));
      const lowDays = Math.max(0, Math.round(period.lowBenefitDaysUsed ?? (period.benefitLevel === 'low' ? roundedBenefitDays : 0)));
      const highShare = highDays > 0 ? highDays / 2 : 0;
      const lowShare = lowDays > 0 ? lowDays / 2 : 0;
      if (highShare > 0) {
        usedHigh.parent1 += highShare;
        usedHigh.parent2 += highShare;
      }
      if (lowShare > 0) {
        usedLow.parent1 += lowShare;
        usedLow.parent2 += lowShare;
      }
      return;
    }

    const ownerKey: 'parent1' | 'parent2' = period.parent === 'parent1' ? 'parent1' : 'parent2';
    const transferSource =
      period.transferredFromParent && period.transferredFromParent !== ownerKey
        ? period.transferredFromParent
        : null;
    const highDays = Math.max(0, Math.round(period.highBenefitDaysUsed ?? (period.benefitLevel === 'high' ? roundedBenefitDays : 0)));
    const lowDays = Math.max(0, Math.round(period.lowBenefitDaysUsed ?? (period.benefitLevel === 'low' ? roundedBenefitDays : 0)));

    let transferHigh = 0;
    let transferLow = 0;
    if (transferSource) {
      const explicitHigh = Math.max(0, Math.round(period.transferredHighDays ?? 0));
      const explicitLow = Math.max(0, Math.round(period.transferredLowDays ?? 0));

      if (explicitHigh > 0 || explicitLow > 0) {
        transferHigh = Math.max(0, Math.min(highDays, explicitHigh));
        transferLow = Math.max(0, Math.min(lowDays, explicitLow));
      } else if (period.benefitLevel === 'low') {
        transferLow = Math.max(0, Math.min(lowDays, Math.round(period.transferredDays ?? lowDays)));
      } else {
        transferHigh = Math.max(0, Math.min(highDays, Math.round(period.transferredDays ?? highDays)));
      }
    }

    const ownerHigh = Math.max(0, highDays - transferHigh);
    const ownerLow = Math.max(0, lowDays - transferLow);

    if (ownerHigh > 0) {
      usedHigh[ownerKey] += ownerHigh;
    }
    if (ownerLow > 0) {
      usedLow[ownerKey] += ownerLow;
    }

    if (transferSource && transferHigh > 0) {
      usedHigh[transferSource] += transferHigh;
    }
    if (transferSource && transferLow > 0) {
      usedLow[transferSource] += transferLow;
    }
  });

  return {
    low: {
      parent1: Math.max(0, context.parent1LowTotalDays - usedLow.parent1),
      parent2: Math.max(0, context.parent2LowTotalDays - usedLow.parent2),
    },
    high: {
      parent1: Math.max(0, context.parent1HighTotalDays - usedHigh.parent1),
      parent2: Math.max(0, context.parent2HighTotalDays - usedHigh.parent2),
    },
  };
}

function maximizeHighBenefitUsageForMaximizeStrategy(
  periods: LeavePeriod[],
  context: ConversionContext,
): void {
  if (!Array.isArray(periods) || periods.length === 0) {
    return;
  }

  const highDayTotals: RemainingBenefitDays = {
    parent1: Math.max(0, Math.round(context.parent1HighTotalDays || 0)),
    parent2: Math.max(0, Math.round(context.parent2HighTotalDays || 0)),
  };

  const initiallyUsed: RemainingBenefitDays = {
    parent1: INITIAL_SHARED_WORKING_DAYS,
    parent2: INITIAL_SHARED_WORKING_DAYS,
  };

  periods.forEach(period => {
    if (period.benefitLevel !== 'high') {
      return;
    }

    const highDays = Math.max(0, Math.round(period.highBenefitDaysUsed ?? period.benefitDaysUsed ?? period.daysCount ?? 0));
    if (highDays <= 0) {
      return;
    }

    if (period.parent === 'parent1') {
      initiallyUsed.parent1 += highDays;
    } else if (period.parent === 'parent2') {
      initiallyUsed.parent2 += highDays;
    }
  });

  const remaining: RemainingBenefitDays = {
    parent1: Math.max(0, highDayTotals.parent1 - initiallyUsed.parent1),
    parent2: Math.max(0, highDayTotals.parent2 - initiallyUsed.parent2),
  };

  if (remaining.parent1 <= 0 && remaining.parent2 <= 0) {
    return;
  }

  const sortable = periods
    .filter(period => (period.parent === 'parent1' || period.parent === 'parent2') && period.benefitLevel === 'high')
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  sortable.forEach(period => {
    const parentKey = period.parent as 'parent1' | 'parent2';
    const available = remaining[parentKey];
    if (available <= 0) {
      return;
    }

    const calendarDays = Math.max(
      1,
      Number.isFinite(period.calendarDays)
        ? Math.round(period.calendarDays)
        : differenceInCalendarDays(period.endDate, period.startDate) + 1,
    );

    const currentHighDays = Math.max(
      0,
      Math.round(period.highBenefitDaysUsed ?? period.benefitDaysUsed ?? period.daysCount ?? 0)
    );
    const currentDays = currentHighDays;
    if (currentDays >= calendarDays) {
      return;
    }

    const additional = Math.min(calendarDays - currentDays, available);
    if (additional <= 0) {
      return;
    }

    const newDays = currentDays + additional;
    period.benefitDaysUsed = newDays;
    period.daysCount = newDays;
    period.highBenefitDaysUsed = newDays;

    const otherParentDailyIncome = Number.isFinite(period.otherParentDailyIncome)
      ? (period.otherParentDailyIncome as number)
      : 0;
    const otherParentIncome = otherParentDailyIncome * calendarDays;
    const leaveIncome = period.dailyBenefit * newDays;
    const totalIncome = leaveIncome + otherParentIncome;

    period.dailyIncome = calendarDays > 0 ? totalIncome / calendarDays : period.dailyIncome;
    period.monthlyIncome = totalIncome;

    const recalculatedDaysPerWeek = Math.round((newDays / calendarDays) * 7);
    if (recalculatedDaysPerWeek > 0) {
      period.daysPerWeek = Math.min(7, Math.max(1, recalculatedDaysPerWeek));
    }

    remaining[parentKey] = Math.max(0, available - additional);
  });
}

function applyCollectiveAgreementBonuses(
  periods: LeavePeriod[],
  context: ConversionContext
): void {
  const parentKeys: Array<'parent1' | 'parent2'> = ['parent1', 'parent2'];

  for (const parentKey of parentKeys) {
    const parentInfo = parentKey === 'parent1' ? context.parent1 : context.parent2;
    if (!parentInfo.hasCollectiveAgreement) {
      continue;
    }

    const parentEntries = periods
      .map((period) => {
        if (period.benefitLevel === 'none') {
          return null;
        }

        if (period.parent !== parentKey && period.parent !== 'both') {
          return null;
        }

        const periodStart = startOfDay(new Date(period.startDate));
        const periodEnd = startOfDay(new Date(period.endDate));
        const calendarDays = Math.max(
          1,
          period.calendarDays ?? differenceInCalendarDays(periodEnd, periodStart) + 1
        );
        const totalBenefitDays = Math.max(0, period.benefitDaysUsed ?? period.daysCount ?? 0);

        if (totalBenefitDays <= 0) {
          return null;
        }

        const declaredParentBenefitIncome = parentKey === 'parent1'
          ? period.parent1BenefitIncome
          : period.parent2BenefitIncome;
        const declaredOtherBenefitIncome = parentKey === 'parent1'
          ? period.parent2BenefitIncome
          : period.parent1BenefitIncome;

        let parentShareBase = Number.isFinite(declaredParentBenefitIncome)
          ? Math.max(0, declaredParentBenefitIncome as number)
          : 0;
        let otherShareBase = Number.isFinite(declaredOtherBenefitIncome)
          ? Math.max(0, declaredOtherBenefitIncome as number)
          : 0;

        if (parentShareBase <= 0 && otherShareBase <= 0) {
          const declaredParentLeaveIncome = parentKey === 'parent1'
            ? period.parent1Income
            : period.parent2Income;
          const declaredOtherLeaveIncome = parentKey === 'parent1'
            ? period.parent2Income
            : period.parent1Income;

          parentShareBase = Number.isFinite(declaredParentLeaveIncome)
            ? Math.max(0, declaredParentLeaveIncome as number)
            : 0;
          otherShareBase = Number.isFinite(declaredOtherLeaveIncome)
            ? Math.max(0, declaredOtherLeaveIncome as number)
            : 0;
        }

        let parentBenefitDays = totalBenefitDays;

        if (period.parent === 'both') {
          const totalShare = parentShareBase + otherShareBase;
          if (totalShare > 0) {
            parentBenefitDays = totalBenefitDays * (parentShareBase / totalShare);
          } else {
            parentBenefitDays = totalBenefitDays / 2;
          }
        } else if (period.parent !== parentKey) {
          return null;
        }

        if (parentBenefitDays <= 0) {
          return null;
        }

        const baseDailyBenefit = Number.isFinite(period.dailyBenefit)
          ? Math.max(0, period.dailyBenefit)
          : 0;

        return {
          period,
          start: periodStart,
          end: periodEnd,
          calendarDays,
          parentBenefitDays,
          baseDailyBenefit,
        };
      })
      .filter((entry): entry is {
        period: LeavePeriod;
        start: Date;
        end: Date;
        calendarDays: number;
        parentBenefitDays: number;
        baseDailyBenefit: number;
      } => entry !== null)
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    let consumedCalendarDays = 0;
    let lastBenefitEnd: Date | null = null;
    let sequenceClosed = false;

    for (const entry of parentEntries) {
      if (sequenceClosed) {
        break;
      }

      if (lastBenefitEnd) {
        const allowedResumeDay = startOfDay(addDays(lastBenefitEnd, 1));
        const gapDays = differenceInCalendarDays(entry.start, allowedResumeDay);
        if (gapDays > COLLECTIVE_GAP_ALLOWANCE_DAYS) {
          sequenceClosed = true;
          break;
        }
      }

      const effectiveCalendarDays = Math.max(
        1,
        entry.calendarDays
      );
      const remainingBonusDays = Math.max(0, COLLECTIVE_MAX_CALENDAR_DAYS - consumedCalendarDays);

      if (remainingBonusDays <= 0) {
        sequenceClosed = true;
        break;
      }

      const eligibleDays = Math.min(remainingBonusDays, effectiveCalendarDays);
      if (eligibleDays <= 0) {
        lastBenefitEnd = entry.end;
        continue;
      }

      const bonusPerBenefitDay = computeCollectiveAgreementBonusPerBenefitDay(
        parentInfo,
        entry.baseDailyBenefit
      );

      if (bonusPerBenefitDay <= 0) {
        lastBenefitEnd = entry.end;
        continue;
      }

      const eligibleFraction = eligibleDays / effectiveCalendarDays;
      const eligibleBenefitDays = entry.parentBenefitDays * eligibleFraction;

      if (eligibleBenefitDays <= 0) {
        lastBenefitEnd = entry.end;
        continue;
      }

      const totalBonus = bonusPerBenefitDay * eligibleBenefitDays;
      if (totalBonus > 0) {
        entry.period.collectiveAgreementEligibleCalendarDays =
          (entry.period.collectiveAgreementEligibleCalendarDays ?? 0) + eligibleDays;
        entry.period.collectiveAgreementEligibleBenefitDays =
          (entry.period.collectiveAgreementEligibleBenefitDays ?? 0) + eligibleBenefitDays;
        entry.period.collectiveAgreementTotalBonus =
          (entry.period.collectiveAgreementTotalBonus ?? 0) + totalBonus;

        const bonusPerCalendarDay = totalBonus / Math.max(1, effectiveCalendarDays);
        entry.period.dailyIncome = (entry.period.dailyIncome ?? 0) + bonusPerCalendarDay;

        if (entry.period.monthlyIncome !== undefined) {
          entry.period.monthlyIncome = (entry.period.monthlyIncome ?? 0) + totalBonus;
        }
      }

      consumedCalendarDays += eligibleDays;
      lastBenefitEnd = entry.end;

      if (consumedCalendarDays >= COLLECTIVE_MAX_CALENDAR_DAYS) {
        sequenceClosed = true;
      }
    }
  }
}

function backfillCollectiveAgreementIncome(periods: LeavePeriod[]): void {
  periods.forEach(period => {
    const totalBonus = Math.max(0, period.collectiveAgreementTotalBonus ?? 0);
    if (totalBonus <= 0) {
      return;
    }

    const parent1Existing = Math.max(0, period.parent1ParentalSalary ?? 0);
    const parent2Existing = Math.max(0, period.parent2ParentalSalary ?? 0);

    let targetParent1 = parent1Existing;
    let targetParent2 = parent2Existing;

    if (period.parent === 'parent1') {
      targetParent1 = Math.max(parent1Existing, totalBonus);
      targetParent2 = 0;
    } else if (period.parent === 'parent2') {
      targetParent2 = Math.max(parent2Existing, totalBonus);
      targetParent1 = 0;
    } else {
      const combinedExisting = parent1Existing + parent2Existing;
      if (combinedExisting < totalBonus - 1e-6) {
        const parent1Benefit = Math.max(0, period.parent1BenefitIncome ?? 0);
        const parent2Benefit = Math.max(0, period.parent2BenefitIncome ?? 0);
        const combinedBenefit = parent1Benefit + parent2Benefit;
        const parent1Share = combinedBenefit > 0 ? parent1Benefit / combinedBenefit : 0.5;
        targetParent1 = totalBonus * parent1Share;
        targetParent2 = totalBonus - targetParent1;
      }
    }

    const applyShare = (
      parentKey: 'parent1' | 'parent2',
      targetAmount: number,
      existingAmount: number
    ) => {
      const normalizedTarget = Math.max(0, targetAmount);
      const previousAmount = Math.max(0, existingAmount);

      if (normalizedTarget <= previousAmount + 1e-6) {
        if (previousAmount > 0) {
          if (parentKey === 'parent1') {
            period.parent1ParentalSalary = previousAmount;
          } else {
            period.parent2ParentalSalary = previousAmount;
          }
        }
        return;
      }

      const delta = normalizedTarget - previousAmount;
      if (parentKey === 'parent1') {
        period.parent1ParentalSalary = normalizedTarget;
      } else {
        period.parent2ParentalSalary = normalizedTarget;
      }

      const parentOnLeave = parentKey === 'parent1'
        ? period.parent === 'parent1' || period.parent === 'both'
        : period.parent === 'parent2' || period.parent === 'both';

      if (!parentOnLeave || delta <= 0) {
        return;
      }

      if (parentKey === 'parent1') {
        const currentIncome = Math.max(0, period.parent1Income ?? 0);
        period.parent1Income = currentIncome + delta;
      } else {
        const currentIncome = Math.max(0, period.parent2Income ?? 0);
        period.parent2Income = currentIncome + delta;
      }
    };

    applyShare('parent1', targetParent1, parent1Existing);
    applyShare('parent2', targetParent2, parent2Existing);
  });
}

function createTopUpPeriods({
  parent,
  start,
  end,
  context,
  baseDaysPerWeek,
  remainingLowDays,
  remainingHighDays,
  parent1CutoffDate,
  parentCalendarUsage,
  parentCalendarCaps,
  prioritizeLowBenefit = false,
}: TopUpOptions): LeavePeriod[] {
  const normalizedStart = startOfDay(start);
  const normalizedEnd = startOfDay(end);

  const cutoff = parent1CutoffDate ? startOfDay(parent1CutoffDate) : null;
  let effectiveStart = normalizedStart;
  let effectiveEnd = normalizedEnd;

  if (cutoff) {
    if (parent === 'parent1') {
      const lastAllowed = startOfDay(addDays(cutoff, -1));
      if (lastAllowed.getTime() < effectiveStart.getTime()) {
        return [];
      }
      if (effectiveEnd.getTime() >= cutoff.getTime()) {
        effectiveEnd = lastAllowed;
      }
    } else if (parent === 'parent2' && effectiveStart.getTime() < cutoff.getTime()) {
      effectiveStart = cutoff;
    }
  }

  if (effectiveStart.getTime() > effectiveEnd.getTime()) {
    return [];
  }

  const segments = splitIntoMonthlySegments(effectiveStart, effectiveEnd);
  if (!segments.length) {
    return [];
  }

  const otherParentKey = parent === 'parent1' ? 'parent2' : 'parent1';
  const otherParentNetMonthly = otherParentKey === 'parent1' ? context.parent1NetIncome : context.parent2NetIncome;
  const lowDailyNet = parent === 'parent1' ? context.parent1MinDailyNet : context.parent2MinDailyNet;
  const highDailyNet = parent === 'parent1' ? context.parent1HighDailyNet : context.parent2HighDailyNet;
  const normalizedBase = Math.min(7, Math.max(0, Number.isFinite(baseDaysPerWeek) ? baseDaysPerWeek : 0));
  const results: LeavePeriod[] = [];
  const totalCalendarCap = parentCalendarCaps[parent];
  let remainingCalendarCapForParent = Number.isFinite(totalCalendarCap)
    ? Math.max(0, totalCalendarCap - parentCalendarUsage[parent])
    : Number.POSITIVE_INFINITY;

  for (const segment of segments) {
    if (Number.isFinite(remainingCalendarCapForParent) && remainingCalendarCapForParent <= 0) {
      break;
    }

    const proportion = segment.proportion;
    const requiredIncome = context.minHouseholdIncome * proportion;
    const monthOtherIncomeTotal = otherParentNetMonthly * proportion;
    let deficit = Math.max(0, requiredIncome - monthOtherIncomeTotal);
    let remainingCapacity = Math.max(0, Math.round((7 - normalizedBase) * WEEKS_PER_MONTH * proportion));
    let remainingCalendarDays = segment.calendarDays;
    let remainingOtherIncome = monthOtherIncomeTotal;
    let cursor = new Date(segment.start);

    const pushPeriod = (
      benefitLevel: LeavePeriod['benefitLevel'],
      benefitDaysUsed: number,
      dailyBenefit: number,
      calendarDays: number,
      daysPerWeekValue: number,
      allocatedOtherIncome: number
    ) => {
      if (calendarDays <= 0) {
        return;
      }

      const startDate = startOfDay(cursor);
      const endDate = startOfDay(addDays(startDate, calendarDays - 1));
      const safeOtherIncome = Math.max(0, Math.min(remainingOtherIncome, allocatedOtherIncome));
      remainingOtherIncome = Math.max(0, remainingOtherIncome - safeOtherIncome);
      const isNoneLevel = benefitLevel === 'none';
      const benefitDays = isNoneLevel ? 0 : benefitDaysUsed;
      const totalIncome = safeOtherIncome + (isNoneLevel ? 0 : dailyBenefit * benefitDaysUsed);
      const dailyIncome = calendarDays > 0 ? totalIncome / calendarDays : 0;
      const normalizedRequested = Number.isFinite(daysPerWeekValue) ? Number(daysPerWeekValue) : normalizedBase;
      const fallbackDaysPerWeek = Math.max(0, Number.isFinite(normalizedRequested) ? normalizedRequested : normalizedBase);
      const effectiveDaysPerWeek = isNoneLevel
        ? 0
        : Math.min(7, Math.max(fallbackDaysPerWeek > 0 ? fallbackDaysPerWeek : 1, 1));
      const highDaysUsed = !isNoneLevel && benefitLevel === 'high' ? benefitDays : 0;
      const lowDaysUsed = !isNoneLevel && benefitLevel === 'low' ? benefitDays : 0;

      results.push({
        parent,
        startDate,
        endDate,
        daysCount: calendarDays,
        benefitDaysUsed: benefitDays,
        highBenefitDaysUsed: highDaysUsed,
        lowBenefitDaysUsed: lowDaysUsed,
        calendarDays,
        dailyBenefit: isNoneLevel ? 0 : dailyBenefit,
        dailyIncome,
        benefitLevel,
        daysPerWeek: effectiveDaysPerWeek,
        otherParentDailyIncome: safeOtherIncome && calendarDays > 0 ? safeOtherIncome / calendarDays : 0,
        otherParentMonthlyIncome: safeOtherIncome,
        isPreferenceFiller: true,
        needsSequencing: true,  // Allow "none" periods to be reordered by top-ups
      });

      cursor = startOfDay(addDays(endDate, 1));
      remainingCalendarDays = Math.max(0, remainingCalendarDays - calendarDays);
    };

    const availableCalendarCap = Number.isFinite(remainingCalendarCapForParent)
      ? Math.max(0, Math.floor(remainingCalendarCapForParent))
      : Number.POSITIVE_INFINITY;

    const order: Array<'high' | 'low'> = prioritizeLowBenefit ? ['low', 'high'] : ['high', 'low'];

    for (const benefitType of order) {
      if (deficit <= 0 || remainingCapacity <= 0 || availableCalendarCap <= 0) {
        break;
      }

      const dailyNet = benefitType === 'high' ? highDailyNet : lowDailyNet;
      const remainingDaysPool = benefitType === 'high' ? remainingHighDays : remainingLowDays;

      if (dailyNet <= 0 || remainingDaysPool[parent] <= 0) {
        continue;
      }

      const needed = Math.ceil(deficit / dailyNet);
      const takeCandidate = Math.min(needed, remainingDaysPool[parent], remainingCapacity, availableCalendarCap);
      const take = Math.max(0, Math.floor(takeCandidate));

      if (take > 0) {
        const periodShare = segment.calendarDays > 0 ? Math.min(1, Math.max(0, availableCalendarCap / segment.calendarDays)) : 0;
        const effectiveProportion = Math.max(0.01, proportion * Math.max(periodShare, 0.01));
        const daysPerWeek = clampDaysPerWeek(take / (WEEKS_PER_MONTH * effectiveProportion));
        const weeksUsed = daysPerWeek > 0 ? take / daysPerWeek : 0;
        const calendarDaysForBenefit = Math.min(
          remainingCalendarDays,
          Math.max(1, Math.round(weeksUsed * 7)),
          availableCalendarCap
        );

        if (calendarDaysForBenefit > 0) {
          const otherIncome = monthOtherIncomeTotal * (calendarDaysForBenefit / segment.calendarDays);

          pushPeriod(benefitType, take, dailyNet, calendarDaysForBenefit, daysPerWeek, otherIncome);

          remainingDaysPool[parent] = Math.max(0, remainingDaysPool[parent] - take);
          remainingCapacity = Math.max(0, remainingCapacity - take);
          deficit = Math.max(0, deficit - take * dailyNet);
          if (Number.isFinite(remainingCalendarCapForParent)) {
            remainingCalendarCapForParent = Math.max(0, remainingCalendarCapForParent - calendarDaysForBenefit);
          }
          parentCalendarUsage[parent] += calendarDaysForBenefit;
        }
      }
    }

    if (remainingCalendarDays > 0) {
      const otherIncomeForNone = Math.max(0, remainingOtherIncome);
      pushPeriod('none', remainingCalendarDays, 0, remainingCalendarDays, 0, otherIncomeForNone);
      deficit = 0;
    }
  }

  return results;
}

function ensureMinimumIncomePerMonth(
  periods: LeavePeriod[],
  context: ConversionContext,
  remainingLowDays: RemainingBenefitDays,
  remainingHighDays: RemainingBenefitDays,
  timelineLimit: Date | null,
  parent1CutoffDate: Date | null,
  preferLowBenefit: boolean,
  reservedHighDays: RemainingBenefitDays
): void {
  if (!context.minHouseholdIncome || context.minHouseholdIncome <= 0) {
    return;
  }

  const timelineStart = startOfDay(new Date(context.baseStartDate.getFullYear(), context.baseStartDate.getMonth(), 1));
  const limitDate = timelineLimit ? startOfDay(timelineLimit) : null;
  let fallbackEnd: Date;

  const latestExistingEnd = periods.reduce<Date | null>((latest, period) => {
    const periodEnd = startOfDay(period.endDate);
    if (!latest || periodEnd.getTime() > latest.getTime()) {
      return periodEnd;
    }
    return latest;
  }, null);

  if (limitDate) {
    fallbackEnd = new Date(limitDate);
  } else if (latestExistingEnd) {
    fallbackEnd = new Date(latestExistingEnd);
  } else {
    fallbackEnd = startOfDay(addMonths(timelineStart, 15));
  }

  const timelineEnd = limitDate && latestExistingEnd && latestExistingEnd.getTime() < limitDate.getTime()
    ? new Date(latestExistingEnd)
    : fallbackEnd;

  const months: { start: Date; end: Date }[] = [];
  let cursor = new Date(timelineStart);

  while (cursor.getTime() <= timelineEnd.getTime()) {
    const monthStart = startOfDay(cursor);
    const monthEndCandidate = startOfDay(new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0));
    const cappedEnd = monthEndCandidate.getTime() > timelineEnd.getTime() ? new Date(timelineEnd) : monthEndCandidate;
    months.push({ start: monthStart, end: cappedEnd });
    cursor = startOfDay(addMonths(monthStart, 1));
  }

  if (!months.length) {
    return;
  }

  // Build map of months with full coverage info to determine which months qualify for minimum income guarantee
  // Only full calendar months (where coverage >= month length) are eligible
  // Months with only initial 10-day periods are excluded
  interface MonthInfo {
    start: Date;
    end: Date;
    monthLength: number;
    coveredDays: number;
    isFullMonth: boolean;
    hasInitialTenDayOnly: boolean;
  }
  
  const monthInfoMap = new Map<string, MonthInfo>();
  
  for (const { start: monthStart, end: monthEnd } of months) {
    const fullMonthStart = startOfDay(new Date(monthStart.getFullYear(), monthStart.getMonth(), 1));
    const fullMonthEnd = startOfDay(new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0));
    const monthLength = Math.max(1, differenceInCalendarDays(fullMonthEnd, fullMonthStart) + 1);
    
    let coveredDays = 0;
    const hasInitialTenDay = periods.some(p =>
      p.isInitialTenDayPeriod &&
      p.startDate <= monthEnd &&
      p.endDate >= monthStart
    );
    const hasNonInitialOwnerLeave = periods.some(p =>
      !p.isInitialTenDayPeriod &&
      (p.parent === 'parent1' || p.parent === 'parent2') &&
      p.startDate <= monthEnd &&
      p.endDate >= monthStart
    );
    
    // Calculate actual coverage from periods
    for (const period of periods) {
      const periodStart = startOfDay(period.startDate);
      const periodEnd = startOfDay(period.endDate);
      
      if (periodEnd.getTime() < monthStart.getTime() || periodStart.getTime() > monthEnd.getTime()) {
        continue;
      }
      
      const overlapStart = periodStart.getTime() > monthStart.getTime() ? periodStart : monthStart;
      const overlapEnd = periodEnd.getTime() < monthEnd.getTime() ? periodEnd : monthEnd;
      const overlapDays = Math.max(0, differenceInCalendarDays(overlapEnd, overlapStart) + 1);
      
      coveredDays += overlapDays;
    }
    
    const monthKey = `${fullMonthStart.getFullYear()}-${fullMonthStart.getMonth()}`;
    const isFullMonth = coveredDays >= monthLength;
    const hasInitialTenDayOnly = hasInitialTenDay && !hasNonInitialOwnerLeave;
    
    monthInfoMap.set(monthKey, {
      start: monthStart,
      end: monthEnd,
      monthLength,
      coveredDays,
      isFullMonth,
      hasInitialTenDayOnly,
    });
  }

  const cutoff = parent1CutoffDate ? startOfDay(parent1CutoffDate) : null;
  const lastParent1Day = cutoff ? startOfDay(addDays(cutoff, -1)) : null;

  const monthSegments: { start: Date; end: Date; forcedOwner?: 'parent1' | 'parent2'; monthKey: string }[] = [];

  for (const { start: monthStart, end: monthEnd } of months) {
    const fullMonthStart = startOfDay(new Date(monthStart.getFullYear(), monthStart.getMonth(), 1));
    const monthKey = `${fullMonthStart.getFullYear()}-${fullMonthStart.getMonth()}`;
    const monthInfo = monthInfoMap.get(monthKey);

    // Consider full calendar months based on calendar boundaries (not existing periods)
    const endOfCalMonth = startOfDay(new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0));
    const isFullCalendarMonth = monthStart.getDate() === 1 && monthEnd.getDate() === endOfCalMonth.getDate();

    // Skip months that are not full calendar months or are only initial 10-day periods
    if (!isFullCalendarMonth || (monthInfo && monthInfo.hasInitialTenDayOnly)) {
      continue;
    }
    
    if (!cutoff) {
      monthSegments.push({ start: monthStart, end: monthEnd, monthKey });
      continue;
    }

    if (cutoff.getTime() <= monthStart.getTime()) {
      monthSegments.push({ start: monthStart, end: monthEnd, forcedOwner: 'parent2', monthKey });
      continue;
    }

    if (cutoff.getTime() > monthEnd.getTime()) {
      monthSegments.push({ start: monthStart, end: monthEnd, forcedOwner: 'parent1', monthKey });
      continue;
    }

    if (lastParent1Day && lastParent1Day.getTime() >= monthStart.getTime()) {
      const forcedEnd = lastParent1Day.getTime() < monthEnd.getTime() ? lastParent1Day : monthEnd;
      if (forcedEnd.getTime() >= monthStart.getTime()) {
        monthSegments.push({ start: monthStart, end: forcedEnd, forcedOwner: 'parent1', monthKey });
      }
    }

    const segmentStart = cutoff.getTime() > monthStart.getTime() ? cutoff : monthStart;
    if (segmentStart.getTime() <= monthEnd.getTime()) {
      monthSegments.push({ start: segmentStart, end: monthEnd, forcedOwner: 'parent2', monthKey });
    }
  }

  if (!monthSegments.length) {
    return;
  }

  const parentCalendarCaps: Record<'parent1' | 'parent2', number> = {
    parent1: computeParentCalendarCap(context.preferredParent1Months),
    parent2: computeParentCalendarCap(context.preferredParent2Months),
  };

  const parentCalendarUsage = calculateParentCalendarUsage(periods);

  const getRemainingCalendarFor = (parent: 'parent1' | 'parent2') => {
    const cap = parentCalendarCaps[parent];
    if (!Number.isFinite(cap)) {
      return Number.POSITIVE_INFINITY;
    }
    return Math.max(0, cap - parentCalendarUsage[parent]);
  };

  const remainingPreferredMonths: Record<'parent1' | 'parent2', number> = {
    parent1: Math.max(0, context.preferredParent1Months),
    parent2: Math.max(0, context.preferredParent2Months),
  };

  const parentLowDaily: Record<'parent1' | 'parent2', number> = {
    parent1: Math.max(0, context.parent1MinDailyNet),
    parent2: Math.max(0, context.parent2MinDailyNet),
  };

  const parentHighDaily: Record<'parent1' | 'parent2', number> = {
    parent1: Math.max(0, context.parent1HighDailyNet),
    parent2: Math.max(0, context.parent2HighDailyNet),
  };

  for (const { start: monthStart, end: monthEnd, forcedOwner, monthKey } of monthSegments) {
    const segmentDays = Math.max(1, differenceInCalendarDays(monthEnd, monthStart) + 1);
    const fullMonthStart = startOfDay(new Date(monthStart.getFullYear(), monthStart.getMonth(), 1));
    const fullMonthEnd = startOfDay(new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0));
    const fullMonthDays = Math.max(1, differenceInCalendarDays(fullMonthEnd, fullMonthStart) + 1);
    const monthShare = Math.min(1, segmentDays / fullMonthDays);

    const parentDayTotals: Record<'parent1' | 'parent2', number> = { parent1: 0, parent2: 0 };
    const parentMaxDaysPerWeek: Record<'parent1' | 'parent2', number> = { parent1: 0, parent2: 0 };
    let monthIncome = 0;

    for (const period of periods) {
      const periodStart = startOfDay(period.startDate);
      const periodEnd = startOfDay(period.endDate);

      if (periodEnd.getTime() < monthStart.getTime() || periodStart.getTime() > monthEnd.getTime()) {
        continue;
      }

      const overlapStart = periodStart.getTime() > monthStart.getTime() ? periodStart : monthStart;
      const overlapEnd = periodEnd.getTime() < monthEnd.getTime() ? periodEnd : monthEnd;
      const overlapDays = Math.max(0, differenceInCalendarDays(overlapEnd, overlapStart) + 1);

      if (overlapDays <= 0) {
        continue;
      }

      // Use dailyIncome which already includes both benefit and working parent income correctly
      const totalIncomeForOverlap = (period.dailyIncome || 0) * overlapDays;
      monthIncome += totalIncomeForOverlap;

      if (period.parent === 'parent1' || period.parent === 'parent2') {
        parentDayTotals[period.parent] += overlapDays;
        const safeDaysPerWeek = Number.isFinite(period.daysPerWeek) ? (period.daysPerWeek as number) : 0;
        parentMaxDaysPerWeek[period.parent] = Math.max(parentMaxDaysPerWeek[period.parent], safeDaysPerWeek);
      } else if (period.parent === 'both') {
        parentDayTotals.parent1 += overlapDays;
        parentDayTotals.parent2 += overlapDays;
        const safeDaysPerWeek = Number.isFinite(period.daysPerWeek) ? (period.daysPerWeek as number) : 0;
        parentMaxDaysPerWeek.parent1 = Math.max(parentMaxDaysPerWeek.parent1, safeDaysPerWeek);
        parentMaxDaysPerWeek.parent2 = Math.max(parentMaxDaysPerWeek.parent2, safeDaysPerWeek);
      }
    }

    const targetIncome = context.minHouseholdIncome * monthShare;
    const deficit = Math.max(0, targetIncome - monthIncome);
    if (deficit <= 0) {
      continue;
    }

    const ignoreCalendarCapsThisMonth = deficit > 0;
    const hasBenefitDays = (parentKey: 'parent1' | 'parent2') =>
      remainingLowDays[parentKey] > 0 || remainingHighDays[parentKey] > 0;

    let owner: 'parent1' | 'parent2';

    const monthKey = format(monthStart, 'yyyy-MM');
    const preAssignedOwner = forcedOwner ?? context.monthOwnership?.get(monthKey);

    if (preAssignedOwner) {
      owner = preAssignedOwner;
    } else if (parentDayTotals.parent1 > parentDayTotals.parent2 + 0.5) {
      owner = 'parent1';
    } else if (parentDayTotals.parent2 > parentDayTotals.parent1 + 0.5) {
      owner = 'parent2';
    } else if (remainingPreferredMonths.parent1 > remainingPreferredMonths.parent2) {
      owner = 'parent1';
    } else if (remainingPreferredMonths.parent2 > remainingPreferredMonths.parent1) {
      owner = 'parent2';
    } else {
      owner = 'parent1';
    }

    const otherParent: 'parent1' | 'parent2' = owner === 'parent1' ? 'parent2' : 'parent1';
    let ownerRemainingCalendar = getRemainingCalendarFor(owner);

    if (ownerRemainingCalendar <= 0) {
      const alternateRemaining = getRemainingCalendarFor(otherParent);
      if (alternateRemaining > 0 && (!forcedOwner || forcedOwner !== owner)) {
        owner = otherParent;
        ownerRemainingCalendar = alternateRemaining;
      } else if (!ignoreCalendarCapsThisMonth || !hasBenefitDays(owner)) {
        continue;
      }
    }

    if (ownerRemainingCalendar < segmentDays && (!forcedOwner || forcedOwner !== owner)) {
      const alternateRemaining = getRemainingCalendarFor(otherParent);
      if (alternateRemaining >= segmentDays) {
        owner = otherParent;
        ownerRemainingCalendar = alternateRemaining;
      }
    }

    // NEW: if chosen owner has no benefit days but the other parent does, switch owner for this month
    if (!hasBenefitDays(owner) && hasBenefitDays(otherParent) && (!forcedOwner || forcedOwner !== owner)) {
      owner = otherParent;
      ownerRemainingCalendar = getRemainingCalendarFor(owner);
    }

    ownerRemainingCalendar = getRemainingCalendarFor(owner);

    if (ownerRemainingCalendar <= 0 && (!ignoreCalendarCapsThisMonth || !hasBenefitDays(owner))) {
      continue;
    }

    if (!hasBenefitDays(owner)) {
      // Neither owner has benefit days, skip
      if (!hasBenefitDays(otherParent)) {
        continue;
      }
      // Fallback: try alternate owner explicitly
      owner = otherParent;
      ownerRemainingCalendar = getRemainingCalendarFor(owner);
      if (ownerRemainingCalendar <= 0 && (!ignoreCalendarCapsThisMonth || !hasBenefitDays(owner))) {
        continue;
      }
    }

    if (remainingPreferredMonths[owner] > 0) {
      remainingPreferredMonths[owner] = Math.max(0, remainingPreferredMonths[owner] - monthShare);
    }

    const usedDaysPerWeek = Math.min(7, Math.max(0, Math.round(parentMaxDaysPerWeek[owner] || 0)));
    const capacityDaysPerWeek = Math.max(0, 7 - usedDaysPerWeek);
    let remainingCapacityDays = Math.max(0, Math.round(capacityDaysPerWeek * WEEKS_PER_MONTH));

    if (remainingCapacityDays <= 0) {
      remainingCapacityDays = segmentDays;
    }

    const ownerCalendarLimit = getRemainingCalendarFor(owner);
    const calendarLimitAsDays = ignoreCalendarCapsThisMonth
      ? segmentDays
      : Number.isFinite(ownerCalendarLimit)
      ? Math.max(0, Math.floor(ownerCalendarLimit))
      : segmentDays;

    if (calendarLimitAsDays <= 0) {
      continue;
    }

    remainingCapacityDays = Math.min(remainingCapacityDays, segmentDays, calendarLimitAsDays);

    const lowDaily = parentLowDaily[owner];
    const highDaily = parentHighDaily[owner];

    let remainingDeficit = deficit;

    const allocateTopUp = (benefitLevel: 'low' | 'high', benefitDaily: number) => {
      if (remainingDeficit <= 0 || benefitDaily <= 0 || remainingCapacityDays <= 0) {
        return;
      }

      let effectiveBenefitLevel: 'low' | 'high' = benefitLevel;
      let effectiveBenefitDaily = benefitDaily;

      if (benefitLevel === 'low') {
        const parentInfo = owner === 'parent1' ? context.parent1 : context.parent2;
        const chronologicalTracker = owner === 'parent1' ? parent1ChronologicalHighDays : parent2ChronologicalHighDays;
        if (parentInfo) {
          const minHighDays = getMinHighDaysBeforeLow(parentInfo.hasCollectiveAgreement);
          if (
            chronologicalTracker.count < minHighDays &&
            parentHighDaily[owner] > 0 &&
            remainingHighDays[owner] > 0
          ) {
            effectiveBenefitLevel = 'high';
            effectiveBenefitDaily = parentHighDaily[owner];
          }
        }
      }

      if (effectiveBenefitDaily <= 0) {
        return;
      }

      const remainingDaysPool = effectiveBenefitLevel === 'low' ? remainingLowDays : remainingHighDays;
      if (remainingDaysPool[owner] <= 0) {
        return;
      }

      let ownerCalendarRemaining = getRemainingCalendarFor(owner);
      if (ignoreCalendarCapsThisMonth) {
        if (!Number.isFinite(ownerCalendarRemaining)) {
          ownerCalendarRemaining = segmentDays;
        } else {
          ownerCalendarRemaining = Math.max(ownerCalendarRemaining, segmentDays);
        }
      }

      if (ownerCalendarRemaining <= 0 && !ignoreCalendarCapsThisMonth) {
        return;
      } else if (ownerCalendarRemaining <= 0) {
        ownerCalendarRemaining = segmentDays;
      }

      let calendarCap = Number.isFinite(ownerCalendarRemaining)
        ? Math.max(0, Math.floor(ownerCalendarRemaining))
        : Math.max(segmentDays, remainingCapacityDays);

      if (ignoreCalendarCapsThisMonth) {
        calendarCap = Math.max(calendarCap, Math.min(segmentDays, remainingCapacityDays));
        if (calendarCap <= 0) {
          calendarCap = Math.min(segmentDays, remainingCapacityDays);
        }
      }

      if (calendarCap <= 0) {
        return;
      }

      const maximumPossibleDays = Math.min(
        remainingDaysPool[owner],
        remainingCapacityDays,
        calendarCap,
        segmentDays
      );

      if (maximumPossibleDays <= 0) {
        return;
      }

      if (effectiveBenefitLevel === 'low' && !preferLowBenefit) {
        const potentialIncome = maximumPossibleDays * effectiveBenefitDaily;
        if (potentialIncome < remainingDeficit) {
          return;
        }
      }

      const neededDays = Math.ceil(remainingDeficit / effectiveBenefitDaily);
      const takeDays = Math.min(neededDays, maximumPossibleDays);

      if (takeDays <= 0) {
        return;
      }

      const daysPerWeek = clampDaysPerWeek(takeDays / WEEKS_PER_MONTH);
      const weeksUsed = daysPerWeek > 0 ? takeDays / daysPerWeek : 0;
      let calendarDays = Math.max(1, Math.round(weeksUsed * 7));
      calendarDays = Math.min(calendarDays, calendarCap, segmentDays);

      const periodStart = new Date(monthStart);
      let periodEnd = startOfDay(addDays(periodStart, calendarDays - 1));
      if (periodEnd.getTime() > monthEnd.getTime()) {
        periodEnd = new Date(monthEnd);
        calendarDays = Math.max(1, differenceInCalendarDays(periodEnd, periodStart) + 1);
      }

      const totalBenefitIncome = takeDays * effectiveBenefitDaily;
      const otherParentMonthlyNet = owner === 'parent1'
        ? context.parent2NetIncome
        : context.parent1NetIncome;
      // Use actual month length instead of fixed 30 days
      const monthLength = Math.max(1, differenceInCalendarDays(fullMonthEnd, fullMonthStart) + 1);
      const otherParentDailyNet = otherParentMonthlyNet > 0 ? otherParentMonthlyNet / monthLength : 0;
      const totalOtherIncome = otherParentDailyNet * calendarDays;
      const combinedDailyIncome = calendarDays > 0
        ? (totalBenefitIncome + totalOtherIncome) / calendarDays
        : 0;

      periods.push({
        parent: owner,
        startDate: periodStart,
        endDate: periodEnd,
        daysCount: takeDays,
        benefitDaysUsed: takeDays,
        highBenefitDaysUsed: effectiveBenefitLevel === 'high' ? takeDays : 0,
        lowBenefitDaysUsed: effectiveBenefitLevel === 'low' ? takeDays : 0,
        calendarDays,
        dailyBenefit: effectiveBenefitDaily,
        dailyIncome: combinedDailyIncome,
        benefitLevel: effectiveBenefitLevel,
        daysPerWeek,
        otherParentDailyIncome: otherParentDailyNet,
        otherParentMonthlyIncome: otherParentMonthlyNet,
        isPreferenceFiller: true,
        needsSequencing: true,
      });

      remainingDaysPool[owner] = Math.max(0, remainingDaysPool[owner] - takeDays);
      remainingCapacityDays = Math.max(0, remainingCapacityDays - takeDays);
      // Only reduce deficit by benefit income, not other parent income (already counted in monthIncome)
      remainingDeficit = Math.max(0, remainingDeficit - totalBenefitIncome);

      if (effectiveBenefitLevel === 'high') {
        const chronologicalTracker = owner === 'parent1'
          ? parent1ChronologicalHighDays
          : parent2ChronologicalHighDays;
        chronologicalTracker.count += takeDays;
      }

      parentCalendarUsage[owner] += calendarDays;
    };

    // Iteratively top up within this month until threshold is met or capacity/days are exhausted
    const order: Array<'high' | 'low'> = preferLowBenefit ? ['low', 'high'] : ['high', 'low'];

    let safetyCounter = 0;
    while (
      remainingDeficit > 0 &&
      remainingCapacityDays > 0 &&
      (remainingLowDays[owner] > 0 || remainingHighDays[owner] > 0) &&
      safetyCounter < 6
    ) {
      const capBefore = remainingCapacityDays;
      const deficitBefore = remainingDeficit;

      for (const level of order) {
        if (remainingDeficit <= 0 || remainingCapacityDays <= 0) break;
        const daily = level === 'high' ? highDaily : lowDaily;
        allocateTopUp(level, daily);
      }

      // No progress -> break to avoid infinite loop
      if (deficitBefore === remainingDeficit || capBefore === remainingCapacityDays) {
        break;
      }
      safetyCounter += 1;
    }

    // Escalation: If deficit remains and days are available, try increasing daysPerWeek for existing top-ups
    if (remainingDeficit > 5 && (remainingLowDays[owner] > 0 || remainingHighDays[owner] > 0)) {
      let escalationAttempts = 0;
      const maxEscalationAttempts = 3;

      while (remainingDeficit > 5 && escalationAttempts < maxEscalationAttempts) {
        const monthTopUps = periods.filter(p => 
          p.parent === owner &&
          p.isPreferenceFiller &&
          p.startDate >= monthStart &&
          p.endDate <= monthEnd &&
          p.benefitLevel !== 'none' &&
          (p.daysPerWeek ?? 0) < 7
        );
        
        if (monthTopUps.length === 0) break;
        
        let anyIncreased = false;
        for (const topUp of monthTopUps) {
          const currentDaysPerWeek = topUp.daysPerWeek ?? 0;
          if (currentDaysPerWeek < 7 && remainingDeficit > 0) {
            const newDaysPerWeek = Math.min(7, currentDaysPerWeek + 1);
            const additionalWeeks = WEEKS_PER_MONTH;
            const additionalDays = (newDaysPerWeek - currentDaysPerWeek) * additionalWeeks;
            
            const remainingPool = topUp.benefitLevel === 'high' ? remainingHighDays : remainingLowDays;
            if (remainingPool[owner] >= additionalDays) {
              topUp.daysPerWeek = newDaysPerWeek;
              topUp.benefitDaysUsed = (topUp.benefitDaysUsed || 0) + additionalDays;
              remainingPool[owner] = Math.max(0, remainingPool[owner] - additionalDays);
              
              const benefitDaily = topUp.benefitLevel === 'high' ? highDaily : lowDaily;
              const additionalIncome = additionalDays * benefitDaily;
              remainingDeficit = Math.max(0, remainingDeficit - additionalIncome);
              anyIncreased = true;
            }
          }
        }
        
        if (!anyIncreased) break;
        escalationAttempts++;
      }
    }

    if (
      remainingDeficit > 0 &&
      (remainingHighDays[owner] > 0 || remainingLowDays[owner] > 0)
    ) {
      const hasHighDaysAvailable = remainingHighDays[owner] > 0 && parentHighDaily[owner] > 0;
      const hasLowDaysAvailable = remainingLowDays[owner] > 0 && parentLowDaily[owner] > 0;

      const chosenLevel: 'high' | 'low' | null = hasHighDaysAvailable
        ? 'high'
        : hasLowDaysAvailable
        ? 'low'
        : null;

      if (chosenLevel) {
        const benefitDaily = chosenLevel === 'high' ? parentHighDaily[owner] : parentLowDaily[owner];

        if (benefitDaily > 0) {
          const takeDays = 1;
          const periodStart = new Date(monthEnd);
          const periodEnd = new Date(monthEnd);
          const monthLength = Math.max(1, differenceInCalendarDays(fullMonthEnd, fullMonthStart) + 1);
          const otherParentMonthlyNet = owner === 'parent1'
            ? context.parent2NetIncome
            : context.parent1NetIncome;
          const otherParentDailyNet = otherParentMonthlyNet > 0 ? otherParentMonthlyNet / monthLength : 0;
          const totalBenefitIncome = benefitDaily * takeDays;
          const totalOtherIncome = otherParentDailyNet * takeDays;
          const combinedDailyIncome = takeDays > 0
            ? (totalBenefitIncome + totalOtherIncome) / takeDays
            : 0;

          periods.push({
            parent: owner,
            startDate: periodStart,
            endDate: periodEnd,
            daysCount: takeDays,
            benefitDaysUsed: takeDays,
            highBenefitDaysUsed: chosenLevel === 'high' ? takeDays : 0,
            lowBenefitDaysUsed: chosenLevel === 'low' ? takeDays : 0,
            calendarDays: takeDays,
            dailyBenefit: benefitDaily,
            dailyIncome: combinedDailyIncome,
            benefitLevel: chosenLevel,
            daysPerWeek: 1,
            otherParentDailyIncome: otherParentDailyNet,
            otherParentMonthlyIncome: otherParentMonthlyNet,
            isPreferenceFiller: true,
            needsSequencing: true,
          });

          if (chosenLevel === 'high') {
            remainingHighDays[owner] = Math.max(0, remainingHighDays[owner] - takeDays);
            const chronologicalTracker = owner === 'parent1'
              ? parent1ChronologicalHighDays
              : parent2ChronologicalHighDays;
            chronologicalTracker.count += takeDays;
          } else {
            remainingLowDays[owner] = Math.max(0, remainingLowDays[owner] - takeDays);
          }

          parentCalendarUsage[owner] += takeDays;
          remainingDeficit = Math.max(0, remainingDeficit - totalBenefitIncome);
        }
      }
    }

    if (remainingDeficit > 0 && process.env.NODE_ENV !== 'production') {
      console.warn(
        `Month ${format(monthStart, 'MMM yyyy', { locale: sv })} remains ${Math.round(remainingDeficit)} kr below minimum after top-up attempts`
      );
    }
  }

  periods.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
}

interface ParentDayAllocation {
  parent1IncomeDays: number;
  parent2IncomeDays: number;
  parent1LowDays: number;
  parent2LowDays: number;
}

function deriveParentDayAllocation(parent1Months: number, parent2Months: number): ParentDayAllocation {
  const safeParent1Months = Math.max(0, parent1Months);
  const safeParent2Months = Math.max(0, parent2Months);
  const totalPreferredMonths = safeParent1Months + safeParent2Months;

  const baseReserved = Math.min(RESERVED_HIGH_BENEFIT_DAYS_PER_PARENT, Math.floor(HIGH_BENEFIT_DAYS / 2));
  const transferable = Math.max(0, HIGH_BENEFIT_DAYS - baseReserved * 2);
  const evenLowSplit = Math.floor(LOW_BENEFIT_DAYS / 2);
  const defaultLowAllocation = {
    parent1: evenLowSplit,
    parent2: Math.max(0, LOW_BENEFIT_DAYS - evenLowSplit),
  };

  if (totalPreferredMonths <= 0) {
    const halfTransferable = Math.round(transferable / 2);
    const halfIncome = baseReserved + halfTransferable;

    return {
      parent1IncomeDays: halfIncome,
      parent2IncomeDays: HIGH_BENEFIT_DAYS - halfIncome,
      parent1LowDays: defaultLowAllocation.parent1,
      parent2LowDays: defaultLowAllocation.parent2,
    };
  }

  const parent1Share = safeParent1Months / totalPreferredMonths;
  const parent1Transferable = Math.round(transferable * parent1Share);
  const parent1IncomeDays = Math.max(baseReserved, Math.min(baseReserved + transferable, baseReserved + parent1Transferable));
  const parent2IncomeDays = Math.max(baseReserved, HIGH_BENEFIT_DAYS - parent1IncomeDays);

  let parent1LowDays = defaultLowAllocation.parent1;
  let parent2LowDays = defaultLowAllocation.parent2;

  const lowRemainder = LOW_BENEFIT_DAYS - (parent1LowDays + parent2LowDays);
  if (lowRemainder !== 0) {
    if (parent1Share >= 0.5) {
      parent1LowDays += lowRemainder;
    } else {
      parent2LowDays += lowRemainder;
    }
  }

  return {
    parent1IncomeDays,
    parent2IncomeDays,
    parent1LowDays,
    parent2LowDays,
  };
}

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

function computeCollectiveAgreementBonusPerBenefitDay(parent: ParentData, baseDailyBenefit: number): number {
  if (!parent.hasCollectiveAgreement) {
    return 0;
  }

  const normalizedDailyBenefit = Number.isFinite(baseDailyBenefit) ? Math.max(0, baseDailyBenefit) : 0;
  if (normalizedDailyBenefit <= 0) {
    return 0;
  }

  const baseBonus = normalizedDailyBenefit * 0.1;
  const normalizedMonthlyIncome = Number.isFinite(parent.income) ? Math.max(0, parent.income) : 0;
  const excessMonthly = Math.max(0, normalizedMonthlyIncome - PARENTAL_SALARY_THRESHOLD);
  const monthlyExtraAboveGross = excessMonthly * 0.9;
  const monthlyExtraAboveNet = calculateNetIncome(monthlyExtraAboveGross, parent.taxRate);
  const extraAbovePerBenefitDay = monthlyExtraAboveNet * (MONTHS_PER_YEAR / DAYS_PER_YEAR);

  return Math.max(0, baseBonus + extraAbovePerBenefitDay);
}

export function calculateAvailableIncome(parent: ParentData): CalculationResult {
  const netIncome = calculateNetIncome(parent.income, parent.taxRate);
  const parentalBenefitGrossPerDay = calculateDailyParentalBenefit(parent.income);
  const parentalBenefitNetPerDay = calculateNetIncome(parentalBenefitGrossPerDay * 30, parent.taxRate) / 30;

  const parentalSalaryPerDay = computeCollectiveAgreementBonusPerBenefitDay(parent, parentalBenefitNetPerDay);

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
  parent1LeaveDailyIncome: number;
  parent2LeaveDailyIncome: number;
  parent1MinDailyNet: number;
  parent2MinDailyNet: number;
  parent1HighDailyNet: number;
  parent2HighDailyNet: number;
  parent1LowTotalDays: number;
  parent2LowTotalDays: number;
  parent1HighTotalDays: number;
  parent2HighTotalDays: number;
  parent1ReservedHighDays: number;
  parent2ReservedHighDays: number;
  minHouseholdIncome: number;
  baseStartDate: Date;
  adjustedTotalMonths: number;
  requestedDaysPerWeek: number;
  preferredParent1Months: number;
  preferredParent2Months: number;
  simultaneousMonths: number;
  transferredToParent1?: number;
  transferredToParent2?: number;
  monthOwnership?: Map<string, 'parent1' | 'parent2'>;
}

type LegacyPlan = Record<string, unknown> | undefined;

type LegacyResult = Record<string, any>;

function toNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return 0;
    }

    const withoutSpacing = trimmed.replace(/[\s\u00A0_]/g, '');
    let normalized = withoutSpacing.replace(/,/g, '.');

    const dotMatches = normalized.match(/\./g);
    if (dotMatches && dotMatches.length > 1) {
      const lastDotIndex = normalized.lastIndexOf('.');
      normalized =
        normalized.slice(0, lastDotIndex).replace(/\./g, '') + normalized.slice(lastDotIndex);
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  if (typeof value === 'bigint') {
    const converted = Number(value);
    return Number.isFinite(converted) ? converted : 0;
  }

  return 0;
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

function extractDays(
  plan: LegacyPlan,
  property: string,
  fallbackDaysPerWeek: number,
  allowFallback: boolean = true
): number {
  if (!plan) return 0;

  const rawValue = plan[property as keyof typeof plan];

  if (rawValue !== undefined && rawValue !== null) {
    const stored = toNumber(rawValue);
    if (stored > 0) {
      return Math.round(stored);
    }

    if (!allowFallback) {
      return 0;
    }
  } else if (!allowFallback) {
    return 0;
  }

  if (!allowFallback) {
    return 0;
  }

  return computeDaysFromPlan(plan, fallbackDaysPerWeek);
}

function getInkomstDays(plan: LegacyPlan, fallbackDaysPerWeek: number): number {
  return extractDays(plan, 'användaInkomstDagar', fallbackDaysPerWeek, true);
}

function getMinDays(plan: LegacyPlan, fallbackDaysPerWeek: number): number {
  return extractDays(plan, 'användaMinDagar', fallbackDaysPerWeek, false);
}

interface SegmentConfig {
  plan: LegacyPlan;
  parent: 'parent1' | 'parent2' | 'both';
  benefitLevel: 'high' | 'low' | 'none';
  otherParentMonthlyIncome: number;
  usedDays: number;
  fallbackDaysPerWeek: number;
  benefitMonthly: number;
  leaveMonthlyIncome: number;
  preferredDaysPerWeek?: number;
  forceRecomputeWeeks?: boolean;
  baseDailyBenefit?: number;
  monthlyExtraIncome?: number;
  parent1LeaveIncome?: number;
  parent2LeaveIncome?: number;
  parent1BenefitIncome?: number;
  parent2BenefitIncome?: number;
  parent1ParentalSalaryIncome?: number;
  parent2ParentalSalaryIncome?: number;
}

interface SegmentContext {
  baseStartDate: Date;
  timelineLimit?: Date | null;
  parentLastEndDates: Record<'parent1' | 'parent2' | 'both', Date | null>;
  parentEarliestStart: Record<'parent1' | 'parent2' | 'both', Date | null>;
  parent1CutoffDate?: Date | null;
}

// Track qualifying high days used by each parent (globally accessible)
const parent1QualifyingHighDaysUsed = { count: 10 }; // Initialize with 10 from shared period
const parent2QualifyingHighDaysUsed = { count: 10 }; // Initialize with 10 from shared period

// Track chronological high days for collective agreement enforcement
const parent1ChronologicalHighDays = { count: 10 };
const parent2ChronologicalHighDays = { count: 10 };

function getMinHighDaysBeforeLow(hasCollectiveAgreement: boolean): number {
  if (hasCollectiveAgreement) {
    return 130; // 6 months of high benefit days (≈6 × 21.5 working days)
  }
  return 90; // Standard rule
}

function addSegment(
  periods: LeavePeriod[],
  config: SegmentConfig,
  context: SegmentContext,
  parentData?: { parent1?: ParentData; parent2?: ParentData }
): void {
  const {
    plan,
    parent,
    benefitLevel: requestedBenefitLevel,
    otherParentMonthlyIncome,
    usedDays,
    fallbackDaysPerWeek,
    benefitMonthly,
    leaveMonthlyIncome,
    preferredDaysPerWeek,
    forceRecomputeWeeks,
    baseDailyBenefit,
    monthlyExtraIncome,
  } = config;

  const { baseStartDate, parentLastEndDates, parentEarliestStart } = context;

  if (!plan || usedDays <= 0) {
    return;
  }

  // Enforce 90/130-day rule for low benefit level
  let benefitLevel = requestedBenefitLevel;
  if (requestedBenefitLevel === 'low' && parent !== 'both' && parentData) {
    const parentInfo = parent === 'parent1' ? parentData.parent1 : parentData.parent2;
    const chronologicalTracker = parent === 'parent1' 
      ? parent1ChronologicalHighDays 
      : parent2ChronologicalHighDays;
    
    if (parentInfo) {
      const minHighDays = getMinHighDaysBeforeLow(parentInfo.hasCollectiveAgreement);
      
      // Force high benefit if chronological threshold not yet met
      if (chronologicalTracker.count < minHighDays) {
        benefitLevel = 'high';
      }
    }
  }

  const preferredDays = preferredDaysPerWeek && preferredDaysPerWeek > 0 ? Math.round(preferredDaysPerWeek) : undefined;
  const planDaysPerWeek = toNumber(plan.dagarPerVecka);
  let dagarPerVecka = planDaysPerWeek > 0 ? planDaysPerWeek : fallbackDaysPerWeek;

  if ((!Number.isFinite(dagarPerVecka) || dagarPerVecka <= 0) && typeof preferredDays === 'number' && Number.isFinite(preferredDays)) {
    dagarPerVecka = preferredDays;
  }

  if (!Number.isFinite(dagarPerVecka) || dagarPerVecka <= 0) {
    dagarPerVecka = fallbackDaysPerWeek;
  }

  let weeks = toNumber(plan.weeks);
  if (!weeks || weeks <= 0 || forceRecomputeWeeks) {
    weeks = dagarPerVecka > 0 ? usedDays / dagarPerVecka : 0;
  }

  if (!Number.isFinite(weeks)) {
    weeks = 0;
  }

  if (weeks <= 0 || dagarPerVecka <= 0) {
    return;
  }

  const calendarDays = Math.max(1, Math.ceil(weeks * 7));
  const daysCount = Math.max(1, Math.round(usedDays));
  const startWeek = toNumber(plan.startWeek);
  const offsetDays = Number.isFinite(startWeek) ? Math.max(0, Math.round(startWeek * 7)) : 0;
  let startDate = startOfDay(addDays(baseStartDate, offsetDays));

  const earliestStart = parentEarliestStart[parent];
  if (earliestStart && startDate.getTime() < earliestStart.getTime()) {
    startDate = startOfDay(earliestStart);
  }

  // Ensure periods don't overlap by checking all relevant previous periods
  const lastEnd = parentLastEndDates[parent];
  const bothEnd = parent !== 'both' ? parentLastEndDates.both : null;
  const otherParentEnd = parent === 'parent1' ? parentLastEndDates.parent2 : parent === 'parent2' ? parentLastEndDates.parent1 : null;
  
  // Find the latest relevant end date to prevent overlaps
  let relevantLastEnd = lastEnd;
  if (bothEnd && (!relevantLastEnd || bothEnd.getTime() > relevantLastEnd.getTime())) {
    relevantLastEnd = bothEnd;
  }
  // For non-simultaneous periods, also check the other parent's end date
  if (otherParentEnd && parent !== 'both' && (!relevantLastEnd || otherParentEnd.getTime() > relevantLastEnd.getTime())) {
    relevantLastEnd = otherParentEnd;
  }
  
  if (relevantLastEnd) {
    const potentialStart = startOfDay(addDays(relevantLastEnd, 1));
    if (potentialStart.getTime() > startDate.getTime()) {
      startDate = potentialStart;
    }
  }

  if (earliestStart && startDate.getTime() < earliestStart.getTime()) {
    startDate = startOfDay(earliestStart);
  }

  const { timelineLimit: limit, parent1CutoffDate } = context;

  if (limit && startDate.getTime() > limit.getTime()) {
    return;
  }

  let effectiveCalendarDays = calendarDays;
  let endDate = addDays(startDate, effectiveCalendarDays - 1);

  const cutoff = parent1CutoffDate ? startOfDay(parent1CutoffDate) : null;

  if (parent === 'parent1' && cutoff) {
    const lastAllowedDay = startOfDay(addDays(cutoff, -1));
    if (lastAllowedDay.getTime() < startDate.getTime()) {
      return;
    }

    if (endDate.getTime() >= cutoff.getTime()) {
      endDate = lastAllowedDay;
      effectiveCalendarDays = Math.max(1, differenceInCalendarDays(endDate, startDate) + 1);
    }
  }

  if (limit && endDate.getTime() > limit.getTime()) {
    endDate = startOfDay(limit);
    effectiveCalendarDays = Math.max(1, differenceInCalendarDays(endDate, startDate) + 1);
  }

  const ratio = effectiveCalendarDays / calendarDays;
  const adjustedDaysCount = Math.max(1, Math.round(daysCount * ratio));
  const benefitDaysUsed = adjustedDaysCount;
  const calendarDaysUsed = effectiveCalendarDays;
  
  // Calculate if this is a full month or partial month period
  // A period is considered "full month" if it starts on day 1 and ends on the last day of a month
  const periodStartDay = startDate.getDate();
  const periodEndDay = endDate.getDate();
  const periodStartMonth = startDate.getMonth();
  const periodEndMonth = endDate.getMonth();
  const periodStartYear = startDate.getFullYear();
  const periodEndYear = endDate.getFullYear();
  
  // Get the last day of the end month
  const lastDayOfEndMonth = new Date(periodEndYear, periodEndMonth + 1, 0).getDate();
  
  // Check if this period covers full month(s) or is partial
  const isFullMonthPeriod = periodStartDay === 1 && periodEndDay === lastDayOfEndMonth;
  
  // Calculate other parent's income contribution
  // For "none" benefit level (parent is working), other parent is on leave receiving benefits
  // So their income should not be added here (it's tracked in their own benefit periods)
  let otherParentIncomeForPeriod: number;
  if (benefitLevel === 'none') {
    otherParentIncomeForPeriod = 0;
  } else if (isFullMonthPeriod) {
    // Full month(s): use full monthly salary regardless of days
    const monthsInPeriod = (periodEndYear - periodStartYear) * 12 + (periodEndMonth - periodStartMonth) + 1;
    otherParentIncomeForPeriod = otherParentMonthlyIncome * monthsInPeriod;
  } else {
    // Partial month: prorate the salary based on days in the month
    const daysInMonth = new Date(periodStartYear, periodStartMonth + 1, 0).getDate();
    const daysInPeriod = Math.max(1, differenceInCalendarDays(endDate, startDate) + 1);
    otherParentIncomeForPeriod = otherParentMonthlyIncome * (daysInPeriod / daysInMonth);
  }
  
  const otherDailyIncome = otherParentIncomeForPeriod / Math.max(1, effectiveCalendarDays);
  const normalizedDaysPerWeek = Math.max(1, Math.round(dagarPerVecka));
  const benefitDaysPerMonth = normalizedDaysPerWeek * WEEKS_PER_MONTH;
  const roundedBenefitDaysPerMonth = Math.max(1, Math.round(benefitDaysPerMonth));
  const resolvedMonthlyExtra = Number.isFinite(monthlyExtraIncome)
    ? Math.max(0, Number(monthlyExtraIncome))
    : 0;
  const baseBenefitPerDay = benefitLevel === 'none'
    ? 0
    : Number.isFinite(baseDailyBenefit)
    ? (baseDailyBenefit as number)
    : benefitMonthly > 0
    ? benefitMonthly / roundedBenefitDaysPerMonth
    : 0;
  const extraBenefitPerDay = benefitLevel === 'none'
    ? 0
    : resolvedMonthlyExtra / roundedBenefitDaysPerMonth;
  const totalBenefitIncome = baseBenefitPerDay * benefitDaysUsed;
  const totalExtraIncome = benefitLevel === 'none' ? 0 : extraBenefitPerDay * benefitDaysUsed;
  const totalLeaveIncome = benefitLevel === 'none' ? 0 : totalBenefitIncome + totalExtraIncome;
  const hasCollectiveAgreementBonus = totalExtraIncome > 0;
  const totalPeriodIncome = totalLeaveIncome + otherParentIncomeForPeriod;
  const dailyIncome = totalPeriodIncome / Math.max(1, effectiveCalendarDays);
  const dailyBenefit = benefitLevel === 'none' ? 0 : baseBenefitPerDay;

  const leavePeriodEntry: LeavePeriod = {
    parent,
    startDate,
    endDate,
    daysCount: benefitDaysUsed,
    benefitDaysUsed,
    calendarDays: calendarDaysUsed,
    dailyBenefit,
    dailyIncome,
    benefitLevel,
    daysPerWeek: Math.round(dagarPerVecka),
    otherParentDailyIncome: parent === 'both' ? 0 : otherDailyIncome,
    otherParentMonthlyIncome: parent === 'both' ? 0 : otherParentMonthlyIncome,
    otherParentIncomeForPeriod: parent === 'both' ? 0 : otherParentIncomeForPeriod,
    monthlyIncome: totalPeriodIncome,
    collectiveAgreementEligibleCalendarDays: hasCollectiveAgreementBonus ? calendarDaysUsed : 0,
    collectiveAgreementEligibleBenefitDays: hasCollectiveAgreementBonus ? benefitDaysUsed : 0,
    collectiveAgreementTotalBonus: hasCollectiveAgreementBonus ? totalExtraIncome : 0,
  };

  if (parent === 'parent1') {
    leavePeriodEntry.parent1Income = totalLeaveIncome;
    leavePeriodEntry.parent1BenefitIncome = totalBenefitIncome;
    leavePeriodEntry.parent1ParentalSalary = totalExtraIncome;
  } else if (parent === 'parent2') {
    leavePeriodEntry.parent2Income = totalLeaveIncome;
    leavePeriodEntry.parent2BenefitIncome = totalBenefitIncome;
    leavePeriodEntry.parent2ParentalSalary = totalExtraIncome;
  } else {
    const parent1Leave = Number.isFinite(config.parent1LeaveIncome)
      ? Math.max(0, config.parent1LeaveIncome as number)
      : Math.max(0, totalLeaveIncome / 2);
    const parent2Leave = Number.isFinite(config.parent2LeaveIncome)
      ? Math.max(0, config.parent2LeaveIncome as number)
      : Math.max(0, totalLeaveIncome - parent1Leave);
    const parent1Benefit = Number.isFinite(config.parent1BenefitIncome)
      ? Math.max(0, config.parent1BenefitIncome as number)
      : Math.max(0, Math.min(parent1Leave, totalBenefitIncome / 2));
    const parent2Benefit = Number.isFinite(config.parent2BenefitIncome)
      ? Math.max(0, config.parent2BenefitIncome as number)
      : Math.max(0, Math.min(parent2Leave, totalBenefitIncome - parent1Benefit));
    const parent1ParentalSalary = Number.isFinite(config.parent1ParentalSalaryIncome)
      ? Math.max(0, config.parent1ParentalSalaryIncome as number)
      : Math.max(0, parent1Leave - parent1Benefit);
    const parent2ParentalSalary = Number.isFinite(config.parent2ParentalSalaryIncome)
      ? Math.max(0, config.parent2ParentalSalaryIncome as number)
      : Math.max(0, parent2Leave - parent2Benefit);

    leavePeriodEntry.parent1Income = parent1Leave;
    leavePeriodEntry.parent2Income = parent2Leave;
    leavePeriodEntry.parent1BenefitIncome = parent1Benefit;
    leavePeriodEntry.parent2BenefitIncome = parent2Benefit;
    leavePeriodEntry.parent1ParentalSalary = parent1ParentalSalary;
    leavePeriodEntry.parent2ParentalSalary = parent2ParentalSalary;
  }

  periods.push(leavePeriodEntry);

  // Track qualifying high days usage
  if (parent !== 'both' && benefitLevel === 'high') {
    const qualifyingDaysTracker = parent === 'parent1' ? parent1QualifyingHighDaysUsed : parent2QualifyingHighDaysUsed;
    const chronologicalTracker = parent === 'parent1' ? parent1ChronologicalHighDays : parent2ChronologicalHighDays;
    
    qualifyingDaysTracker.count += benefitDaysUsed;
    chronologicalTracker.count += benefitDaysUsed;
  }

  parentLastEndDates[parent] = new Date(endDate);
}

function convertLegacyResult(
  meta: StrategyMeta,
  legacyResult: LegacyResult,
  context: ConversionContext,
  parentData: { parent1: ParentData; parent2: ParentData }
): OptimizationResult {
  // Reset qualifying days trackers for each strategy
  parent1QualifyingHighDaysUsed.count = 10; // Reset to 10 from initial shared period
  parent2QualifyingHighDaysUsed.count = 10; // Reset to 10 from initial shared period
  parent1ChronologicalHighDays.count = 10;
  parent2ChronologicalHighDays.count = 10;

  const periods: LeavePeriod[] = [];
  const warnings: string[] = [];
  const computeLimitDate = (start: Date, months: number) => {
    const safeMonths = Math.max(0, months);
    const wholeMonths = Math.floor(safeMonths);
    const fractional = safeMonths - wholeMonths;
    let limit = startOfDay(addMonths(start, wholeMonths));
    if (fractional > 0) {
      limit = startOfDay(addDays(limit, Math.round(fractional * 30)));
    }
    return limit;
  };

  const baseStartDate = startOfDay(context.baseStartDate);
  const shouldLimitTimeline = context.adjustedTotalMonths > 0;
  const rawTimelineLimit =
    shouldLimitTimeline && context.adjustedTotalMonths > 0
      ? computeLimitDate(baseStartDate, context.adjustedTotalMonths)
      : null;
  const timelineLimit =
    rawTimelineLimit && rawTimelineLimit.getTime() < baseStartDate.getTime() ? new Date(baseStartDate) : rawTimelineLimit;
  const parentLastEndDates: Record<'parent1' | 'parent2' | 'both', Date | null> = {
    parent1: null,
    parent2: null,
    both: null,
  };
  // Add initial simultaneous period (2 x 10 days)
  const plannedInitialEnd = addDays(baseStartDate, INITIAL_SHARED_CALENDAR_DAYS - 1);
  let initialEndDate = startOfDay(plannedInitialEnd);
  if (timelineLimit && initialEndDate.getTime() > timelineLimit.getTime()) {
    initialEndDate = startOfDay(timelineLimit);
  }

  const initialCalendarDays = Math.max(1, differenceInCalendarDays(initialEndDate, baseStartDate) + 1);
  const initialWorkingDays = initialCalendarDays > 0 ? INITIAL_SHARED_WORKING_DAYS : 0;
  const initialBenefitDaysUsed = initialWorkingDays * 2;
  const combinedLeaveDailyIncome = context.parent1LeaveDailyIncome + context.parent2LeaveDailyIncome;
  const totalInitialBenefitIncome = combinedLeaveDailyIncome * initialWorkingDays;
  const averageBenefitPerBenefitDay = initialBenefitDaysUsed > 0
    ? totalInitialBenefitIncome / initialBenefitDaysUsed
    : 0;
  const averageCalendarDailyIncome = initialCalendarDays > 0
    ? totalInitialBenefitIncome / initialCalendarDays
    : 0;
  const estimatedDaysPerWeek = initialCalendarDays > 0
    ? Math.min(7, Math.max(1, Math.round((initialWorkingDays / initialCalendarDays) * 7)))
    : 0;
  const parent1InitialIncome = Math.max(0, Math.round(context.parent1LeaveDailyIncome * initialWorkingDays));
  const parent2InitialIncome = Math.max(0, Math.round(context.parent2LeaveDailyIncome * initialWorkingDays));

  periods.push({
    parent: 'both',
    startDate: new Date(baseStartDate),
    endDate: initialEndDate,
    daysCount: initialBenefitDaysUsed,
    benefitDaysUsed: initialBenefitDaysUsed,
    highBenefitDaysUsed: initialBenefitDaysUsed,
    lowBenefitDaysUsed: 0,
    calendarDays: initialCalendarDays,
    dailyBenefit: averageBenefitPerBenefitDay,
    dailyIncome: averageCalendarDailyIncome,
    benefitLevel: 'high',
    daysPerWeek: estimatedDaysPerWeek,
    otherParentDailyIncome: 0,
    otherParentMonthlyIncome: 0,
    isInitialTenDayPeriod: true,
    parent1Income: parent1InitialIncome,
    parent2Income: parent2InitialIncome,
    parent1BenefitIncome: parent1InitialIncome,
    parent2BenefitIncome: parent2InitialIncome,
    parent1ParentalSalary: 0,
    parent2ParentalSalary: 0,
  });
  parentLastEndDates.both = new Date(initialEndDate);

  const sharedInitialWorkingDays = initialWorkingDays;

  const parent1EarliestStart = startOfDay(addDays(initialEndDate, 1));
  const parent1CutoffDate = startOfDay(
    computeLimitDate(parent1EarliestStart, Math.max(0, context.preferredParent1Months))
  );
  const parent2EarliestStartCandidate = parent1CutoffDate;
  const parent2EarliestStart =
    parent2EarliestStartCandidate.getTime() < parent1EarliestStart.getTime()
      ? parent1EarliestStart
      : parent2EarliestStartCandidate;

  const parentEarliestStart: Record<'parent1' | 'parent2' | 'both', Date | null> = {
    parent1: parent1EarliestStart,
    parent2: parent2EarliestStart,
    both: parent1EarliestStart,
  };

  const segmentContext: SegmentContext = {
    baseStartDate,
    timelineLimit,
    parentLastEndDates,
    parentEarliestStart,
    parent1CutoffDate,
  };

  const fallbackRequestedDays = clampDaysPerWeek(context.requestedDaysPerWeek);

  const resolveDaysPerWeek = (...values: unknown[]): number => {
    for (const value of values) {
      const numeric = toNumber(value);
      if (numeric > 0) {
        return clampDaysPerWeek(numeric);
      }
    }
    return fallbackRequestedDays;
  };

  const dag1 = toNumber(legacyResult.dag1);
  const extra1 = toNumber(legacyResult.extra1);
  const dag2 = toNumber(legacyResult.dag2);
  const extra2 = toNumber(legacyResult.extra2);

  const plan1DaysPerWeek = resolveDaysPerWeek(legacyResult.plan1?.dagarPerVecka);
  const plan1TotalInkomstDays = getInkomstDays(legacyResult.plan1, plan1DaysPerWeek);
  const plan1NoExtraDays = getInkomstDays(
    legacyResult.plan1NoExtra,
    resolveDaysPerWeek(legacyResult.plan1NoExtra?.dagarPerVecka, legacyResult.plan1?.dagarPerVecka)
  );
  const plan1ExtraDays = Math.max(0, plan1TotalInkomstDays - plan1NoExtraDays);

  const plan1MinPlanDaysPerWeek = resolveDaysPerWeek(
    legacyResult.plan1MinDagar?.dagarPerVecka,
    legacyResult.plan1?.dagarPerVecka
  );
  const plan1MinPlanDays = getMinDays(legacyResult.plan1MinDagar, plan1MinPlanDaysPerWeek);
  const plan1EmbeddedMinDays = getMinDays(legacyResult.plan1, plan1DaysPerWeek);
  const totalPlan1MinDays = plan1MinPlanDays > 0 ? plan1MinPlanDays : plan1EmbeddedMinDays;
  const activePlan1MinPlan =
    totalPlan1MinDays > 0
      ? (plan1MinPlanDays > 0 ? legacyResult.plan1MinDagar : legacyResult.plan1)
      : undefined;

  const plan2DaysPerWeek = resolveDaysPerWeek(legacyResult.plan2?.dagarPerVecka);
  const plan2TotalInkomstDays = getInkomstDays(legacyResult.plan2, plan2DaysPerWeek);
  const plan2NoExtraDays = getInkomstDays(
    legacyResult.plan2NoExtra,
    resolveDaysPerWeek(legacyResult.plan2NoExtra?.dagarPerVecka, legacyResult.plan2?.dagarPerVecka)
  );
  const plan2ExtraDays = Math.max(0, plan2TotalInkomstDays - plan2NoExtraDays);

  const plan2MinPlanDaysPerWeek = resolveDaysPerWeek(
    legacyResult.plan2MinDagar?.dagarPerVecka,
    legacyResult.plan2?.dagarPerVecka
  );
  const plan2MinPlanDays = getMinDays(legacyResult.plan2MinDagar, plan2MinPlanDaysPerWeek);
  const plan2EmbeddedMinDays = getMinDays(legacyResult.plan2, plan2DaysPerWeek);
  const totalPlan2MinDays = plan2MinPlanDays > 0 ? plan2MinPlanDays : plan2EmbeddedMinDays;
  const activePlan2MinPlan =
    totalPlan2MinDays > 0
      ? (plan2MinPlanDays > 0 ? legacyResult.plan2MinDagar : legacyResult.plan2)
      : undefined;

  const overlapDaysUsed = computeDaysFromPlan(
    legacyResult.plan1Overlap,
    resolveDaysPerWeek(legacyResult.plan1Overlap?.dagarPerVecka)
  );
  const allowSimultaneousSegments = context.simultaneousMonths > 0;
  const simultaneousOverlapDays = allowSimultaneousSegments ? overlapDaysUsed : 0;

  const usedInkomstDays1 = plan1ExtraDays + plan1NoExtraDays + sharedInitialWorkingDays + simultaneousOverlapDays;
  const usedMinDays1 = totalPlan1MinDays;
  const usedInkomstDays2 = plan2ExtraDays + plan2NoExtraDays + sharedInitialWorkingDays + simultaneousOverlapDays;
  const usedMinDays2 = totalPlan2MinDays;

  const totalDaysUsed =
    usedInkomstDays1 +
    usedMinDays1 +
    usedInkomstDays2 +
    usedMinDays2;

  const daysUsedRounded = Math.max(0, Math.round(totalDaysUsed));
  let clampedDaysUsed = Math.min(TOTAL_BENEFIT_DAYS, daysUsedRounded);
  let daysSaved = Math.max(0, TOTAL_BENEFIT_DAYS - clampedDaysUsed);

  if (allowSimultaneousSegments && overlapDaysUsed > 0) {
    const overlapParent1Monthly = toNumber(legacyResult.plan1Overlap?.inkomst);
    const overlapParent2Monthly = beräknaMånadsinkomst(
      toNumber(legacyResult.dag2),
      toNumber(legacyResult.plan1Overlap?.dagarPerVecka),
      toNumber(legacyResult.extra2),
      0,
      0
    );
    const overlapParent1BenefitMonthly = beräknaMånadsinkomst(
      toNumber(legacyResult.dag1),
      toNumber(legacyResult.plan1Overlap?.dagarPerVecka),
      0,
      0,
      0
    );
    const overlapParent2BenefitMonthly = beräknaMånadsinkomst(
      toNumber(legacyResult.dag2),
      toNumber(legacyResult.plan1Overlap?.dagarPerVecka),
      0,
      0,
      0
    );
    const overlapBenefitMonthly = overlapParent1BenefitMonthly + overlapParent2BenefitMonthly;

    addSegment(periods, {
      plan: legacyResult.plan1Overlap,
      parent: 'both',
      benefitLevel: 'high',
      otherParentMonthlyIncome: 0,
      usedDays: overlapDaysUsed,
      fallbackDaysPerWeek: resolveDaysPerWeek(legacyResult.plan1Overlap?.dagarPerVecka),
      benefitMonthly: overlapBenefitMonthly,
      leaveMonthlyIncome: overlapParent1Monthly + overlapParent2Monthly,
      preferredDaysPerWeek: undefined,
      forceRecomputeWeeks: false,
      parent1LeaveIncome: overlapParent1Monthly,
      parent2LeaveIncome: overlapParent2Monthly,
      parent1BenefitIncome: overlapParent1BenefitMonthly,
      parent2BenefitIncome: overlapParent2BenefitMonthly,
      parent1ParentalSalaryIncome: Math.max(0, overlapParent1Monthly - overlapParent1BenefitMonthly),
      parent2ParentalSalaryIncome: Math.max(0, overlapParent2Monthly - overlapParent2BenefitMonthly),
    }, segmentContext, parentData);
  }

  const ensurePositive = (value: number, fallback: () => number) => {
    const numeric = Number.isFinite(value) ? value : 0;
    if (numeric > 0) {
      return numeric;
    }
    const fallbackValue = fallback();
    return Number.isFinite(fallbackValue) && fallbackValue > 0 ? fallbackValue : 0;
  };

  const resolveBaseDailyBenefit = (
    parentKey: 'parent1' | 'parent2',
    level: 'high' | 'low' | 'none'
  ): number => {
    if (level === 'none') {
      return 0;
    }

    if (level === 'high') {
      return parentKey === 'parent1' ? context.parent1HighDailyNet : context.parent2HighDailyNet;
    }

    return parentKey === 'parent1' ? context.parent1MinDailyNet : context.parent2MinDailyNet;
  };

  const computeMonthlyExtraIncome = (benefitMonthlyValue: number, leaveMonthlyValue: number): number => {
    if (!Number.isFinite(leaveMonthlyValue) || leaveMonthlyValue <= 0) {
      return 0;
    }

    const normalizedBenefit = Number.isFinite(benefitMonthlyValue) ? Math.max(0, benefitMonthlyValue) : 0;
    return Math.max(0, leaveMonthlyValue - normalizedBenefit);
  };

  if (plan1ExtraDays > 0) {
    const fallbackDays = Math.max(1, Math.round(plan1DaysPerWeek));
    const benefitMonthly = ensurePositive(
      toNumber(legacyResult.plan1?.inkomstUtanExtra ?? legacyResult.plan1?.inkomst),
      () => Math.round(beräknaMånadsinkomst(dag1, fallbackDays, 0, 0, 0))
    );
    const leaveMonthlyIncome = ensurePositive(
      toNumber(legacyResult.plan1?.inkomst),
      () => Math.round(beräknaMånadsinkomst(dag1, fallbackDays, extra1, 0, 0))
    );
    const baseDailyBenefit = resolveBaseDailyBenefit('parent1', 'high');
    addSegment(periods, {
      plan: legacyResult.plan1,
      parent: 'parent1',
      benefitLevel: 'high',
      otherParentMonthlyIncome: context.parent2NetIncome,
      usedDays: plan1ExtraDays,
      fallbackDaysPerWeek: fallbackDays,
      benefitMonthly,
      leaveMonthlyIncome,
      preferredDaysPerWeek: undefined,
      forceRecomputeWeeks: false,
      baseDailyBenefit,
      monthlyExtraIncome: computeMonthlyExtraIncome(benefitMonthly, leaveMonthlyIncome),
    }, segmentContext, parentData);
  }

  if (plan1NoExtraDays > 0) {
    const fallbackDays = Math.max(
      1,
      Math.round(
        resolveDaysPerWeek(
          legacyResult.plan1NoExtra?.dagarPerVecka,
          legacyResult.plan1?.dagarPerVecka
        )
      )
    );
    const benefitMonthly = ensurePositive(
      toNumber(legacyResult.plan1NoExtra?.inkomst),
      () => Math.round(beräknaMånadsinkomst(dag1, fallbackDays, 0, 0, 0))
    );
    const segment = {
      plan: legacyResult.plan1NoExtra,
      parent: 'parent1' as const,
      benefitLevel: 'high' as const,
      otherParentMonthlyIncome: context.parent2NetIncome,
      usedDays: plan1NoExtraDays,
      fallbackDaysPerWeek: fallbackDays,
      benefitMonthly,
      leaveMonthlyIncome: benefitMonthly,
      preferredDaysPerWeek: undefined,
      forceRecomputeWeeks: false,
      baseDailyBenefit: resolveBaseDailyBenefit('parent1', 'high'),
      monthlyExtraIncome: computeMonthlyExtraIncome(benefitMonthly, benefitMonthly),
    };
    addSegment(periods, segment, segmentContext, parentData);
  }

  if (totalPlan1MinDays > 0 && activePlan1MinPlan) {
    const fallbackDays = Math.max(
      1,
      Math.round(
        resolveDaysPerWeek(
          activePlan1MinPlan?.dagarPerVecka,
          legacyResult.plan1?.dagarPerVecka
        )
      )
    );
    const benefitMonthly = ensurePositive(
      toNumber(activePlan1MinPlan?.inkomst),
      () => Math.round(beräknaMånadsinkomst(MINIMUM_RATE, fallbackDays, 0, 0, 0))
    );
    addSegment(periods, {
      plan: activePlan1MinPlan,
      parent: 'parent1',
      benefitLevel: 'low',
      otherParentMonthlyIncome: context.parent2NetIncome,
      usedDays: totalPlan1MinDays,
      fallbackDaysPerWeek: fallbackDays,
      benefitMonthly,
      leaveMonthlyIncome: benefitMonthly,
      preferredDaysPerWeek: undefined,
      forceRecomputeWeeks: false,
      baseDailyBenefit: resolveBaseDailyBenefit('parent1', 'low'),
      monthlyExtraIncome: 0,
    }, segmentContext, parentData);
  }

  if (plan2ExtraDays > 0) {
    const fallbackDays = Math.max(1, Math.round(plan2DaysPerWeek));
    const benefitMonthly = ensurePositive(
      toNumber(legacyResult.plan2?.inkomstUtanExtra ?? legacyResult.plan2?.inkomst),
      () => Math.round(beräknaMånadsinkomst(dag2, fallbackDays, 0, 0, 0))
    );
    const leaveMonthlyIncome = ensurePositive(
      toNumber(legacyResult.plan2?.inkomst),
      () => Math.round(beräknaMånadsinkomst(dag2, fallbackDays, extra2, 0, 0))
    );
    const baseDailyBenefit = resolveBaseDailyBenefit('parent2', 'high');
    addSegment(periods, {
      plan: legacyResult.plan2,
      parent: 'parent2',
      benefitLevel: 'high',
      otherParentMonthlyIncome: context.parent1NetIncome,
      usedDays: plan2ExtraDays,
      fallbackDaysPerWeek: fallbackDays,
      benefitMonthly,
      leaveMonthlyIncome,
      preferredDaysPerWeek: undefined,
      forceRecomputeWeeks: false,
      baseDailyBenefit,
      monthlyExtraIncome: computeMonthlyExtraIncome(benefitMonthly, leaveMonthlyIncome),
    }, segmentContext, parentData);
  }

  if (plan2NoExtraDays > 0) {
    const fallbackDays = Math.max(
      1,
      Math.round(
        resolveDaysPerWeek(
          legacyResult.plan2NoExtra?.dagarPerVecka,
          legacyResult.plan2?.dagarPerVecka
        )
      )
    );
    const benefitMonthly = ensurePositive(
      toNumber(legacyResult.plan2NoExtra?.inkomst),
      () => Math.round(beräknaMånadsinkomst(dag2, fallbackDays, 0, 0, 0))
    );
    const segment = {
      plan: legacyResult.plan2NoExtra,
      parent: 'parent2' as const,
      benefitLevel: 'high' as const,
      otherParentMonthlyIncome: context.parent1NetIncome,
      usedDays: plan2NoExtraDays,
      fallbackDaysPerWeek: fallbackDays,
      benefitMonthly,
      leaveMonthlyIncome: benefitMonthly,
      preferredDaysPerWeek: undefined,
      forceRecomputeWeeks: false,
      baseDailyBenefit: resolveBaseDailyBenefit('parent2', 'high'),
      monthlyExtraIncome: 0,
    };
    addSegment(periods, segment, segmentContext, parentData);
  }

  if (totalPlan2MinDays > 0 && activePlan2MinPlan) {
    const fallbackDays = Math.max(
      1,
      Math.round(
        resolveDaysPerWeek(
          activePlan2MinPlan?.dagarPerVecka,
          legacyResult.plan2?.dagarPerVecka
        )
      )
    );
    const benefitMonthly = ensurePositive(
      toNumber(activePlan2MinPlan?.inkomst),
      () => Math.round(beräknaMånadsinkomst(MINIMUM_RATE, fallbackDays, 0, 0, 0))
    );
    addSegment(periods, {
      plan: activePlan2MinPlan,
      parent: 'parent2',
      benefitLevel: 'low',
      otherParentMonthlyIncome: context.parent1NetIncome,
      usedDays: totalPlan2MinDays,
      fallbackDaysPerWeek: fallbackDays,
      benefitMonthly,
      leaveMonthlyIncome: benefitMonthly,
      preferredDaysPerWeek: plan2MinPlanDaysPerWeek,
      forceRecomputeWeeks: false,
      baseDailyBenefit: resolveBaseDailyBenefit('parent2', 'low'),
      monthlyExtraIncome: 0,
    }, segmentContext, parentData);
  }

  // No filler periods - we strictly adhere to the total months specified
  // The periods should end when we've reached the target total months

  // Merge consecutive periods with same parent and benefit level
  const mergedPeriods: LeavePeriod[] = [];
  for (const period of periods) {
    const last = mergedPeriods[mergedPeriods.length - 1];

    // Don't merge initial periods with other periods
    const shouldNotMerge = (last?.isInitialTenDayPeriod !== period.isInitialTenDayPeriod);

    // Check if we can merge with the previous period
    if (
      last &&
      last.parent === period.parent &&
      last.benefitLevel === period.benefitLevel &&
      last.daysPerWeek === period.daysPerWeek &&
      !shouldNotMerge &&
      Math.abs(last.dailyIncome - period.dailyIncome) < 1 && // Same income
      Math.abs(last.dailyBenefit - period.dailyBenefit) < 1 && // Same benefit
      Math.abs((last.otherParentDailyIncome || 0) - (period.otherParentDailyIncome || 0)) < 1 // Same other parent income
    ) {
      // Merge with previous period
      last.endDate = period.endDate;
      last.calendarDays += period.calendarDays;
      last.daysCount += period.daysCount;
      last.benefitDaysUsed += period.benefitDaysUsed;

      const computeIncomeTotal = (p: LeavePeriod) => {
        const calendarDays = p.calendarDays ?? Math.max(1, differenceInCalendarDays(p.endDate, p.startDate) + 1);
        return Number.isFinite(p.monthlyIncome)
          ? (p.monthlyIncome as number)
          : (p.dailyIncome ?? 0) * calendarDays;
      };

      const computedPeriodIncome = computeIncomeTotal(period);
      const computedLastIncome = computeIncomeTotal(last);

      last.monthlyIncome = computedLastIncome + computedPeriodIncome;
      last.otherParentIncomeForPeriod = (last.otherParentIncomeForPeriod ?? 0) + (period.otherParentIncomeForPeriod ?? 0);
      last.collectiveAgreementEligibleCalendarDays =
        (last.collectiveAgreementEligibleCalendarDays ?? 0) +
        (period.collectiveAgreementEligibleCalendarDays ?? 0);
      last.collectiveAgreementEligibleBenefitDays =
        (last.collectiveAgreementEligibleBenefitDays ?? 0) +
        (period.collectiveAgreementEligibleBenefitDays ?? 0);
      last.collectiveAgreementTotalBonus =
        (last.collectiveAgreementTotalBonus ?? 0) + (period.collectiveAgreementTotalBonus ?? 0);

      last.parent1Income = (last.parent1Income ?? 0) + (period.parent1Income ?? 0);
      last.parent2Income = (last.parent2Income ?? 0) + (period.parent2Income ?? 0);
      last.parent1BenefitIncome = (last.parent1BenefitIncome ?? 0) + (period.parent1BenefitIncome ?? 0);
      last.parent2BenefitIncome = (last.parent2BenefitIncome ?? 0) + (period.parent2BenefitIncome ?? 0);
      last.parent1ParentalSalary = (last.parent1ParentalSalary ?? 0) + (period.parent1ParentalSalary ?? 0);
      last.parent2ParentalSalary = (last.parent2ParentalSalary ?? 0) + (period.parent2ParentalSalary ?? 0);
    } else {
      mergedPeriods.push({ ...period });
    }
  }

  const parentCalendarDays: Record<'parent1' | 'parent2', number> = { parent1: 0, parent2: 0 };
  const parentCalendarCaps: Record<'parent1' | 'parent2', number> = {
    parent1: computeParentCalendarCap(context.preferredParent1Months),
    parent2: computeParentCalendarCap(context.preferredParent2Months),
  };
  const initialBothDays = mergedPeriods
    .filter(period => period.isInitialTenDayPeriod)
    .reduce((sum, period) => {
      return sum + (period.calendarDays ?? Math.max(1, differenceInCalendarDays(period.endDate, period.startDate) + 1));
    }, 0);
  const accumulateParentDays = (period: LeavePeriod) => {
    const days = period.calendarDays ?? Math.max(1, differenceInCalendarDays(period.endDate, period.startDate) + 1);
    if (period.parent === 'parent1') {
      parentCalendarDays.parent1 += days;
    } else if (period.parent === 'parent2') {
      parentCalendarDays.parent2 += days;
    } else if (period.parent === 'both') {
      parentCalendarDays.parent1 += days;
      parentCalendarDays.parent2 += days;
    }
  };

  mergedPeriods.forEach(accumulateParentDays);

  const totalPreferredMonths = context.preferredParent1Months + context.preferredParent2Months;
  const averageTargetParent1Days = Math.max(0, Math.round(context.preferredParent1Months * 30));
  const averageTargetParent2Days = Math.max(0, Math.round(context.preferredParent2Months * 30));

  let targetParent1Days = averageTargetParent1Days;
  let targetParent2Days = averageTargetParent2Days;

  if (timelineLimit) {
    const totalTimelineDays = Math.max(1, differenceInCalendarDays(timelineLimit, baseStartDate) + 1);
    const exclusiveTimelineDays = Math.max(0, totalTimelineDays - initialBothDays);

    if (exclusiveTimelineDays > 0) {
      if (totalPreferredMonths > 0) {
        const parent1Share = context.preferredParent1Months / totalPreferredMonths;
        const parent1ExclusiveTarget = Math.round(exclusiveTimelineDays * parent1Share);
        const parent2ExclusiveTarget = exclusiveTimelineDays - parent1ExclusiveTarget;
        targetParent1Days = Math.max(targetParent1Days, parent1ExclusiveTarget + initialBothDays);
        targetParent2Days = Math.max(targetParent2Days, parent2ExclusiveTarget + initialBothDays);
      } else {
        const halfExclusive = Math.round(exclusiveTimelineDays / 2);
        targetParent1Days = Math.max(targetParent1Days, halfExclusive + initialBothDays);
        targetParent2Days = Math.max(targetParent2Days, exclusiveTimelineDays - halfExclusive + initialBothDays);
      }
    }
  }

  const enforceCap = (target: number, cap: number): number => {
    if (!Number.isFinite(cap)) {
      return target;
    }
    return Math.min(target, Math.max(0, Math.floor(cap)));
  };

  targetParent1Days = enforceCap(targetParent1Days, parentCalendarCaps.parent1);
  targetParent2Days = enforceCap(targetParent2Days, parentCalendarCaps.parent2);

  const getParentShortfall = () => ({
    parent1: targetParent1Days - parentCalendarDays.parent1,
    parent2: targetParent2Days - parentCalendarDays.parent2,
  });

  const getGlobalLastEndDate = () => {
    let latest: Date | null = null;
    for (const period of mergedPeriods) {
      const periodEnd = startOfDay(period.endDate);
      if (!latest || periodEnd.getTime() > latest.getTime()) {
        latest = periodEnd;
      }
    }
    return latest;
  };

  const appendFiller = (parent: 'parent1' | 'parent2', missingDays: number) => {
    if (!Number.isFinite(missingDays) || missingDays <= 0) {
      return;
    }

    let effectiveDays = Math.round(missingDays);
    if (effectiveDays <= 0) {
      return;
    }

    const cap = parentCalendarCaps[parent];
    const remainingCap = Number.isFinite(cap)
      ? Math.max(0, Math.floor(cap - parentCalendarDays[parent]))
      : Number.POSITIVE_INFINITY;

    if (Number.isFinite(cap) && remainingCap <= 0) {
      return;
    }

    if (Number.isFinite(cap)) {
      effectiveDays = Math.min(effectiveDays, remainingCap);
    }

    const parentPeriods = mergedPeriods
      .filter(period => period.parent === parent)
      .sort((a, b) => a.endDate.getTime() - b.endDate.getTime());
    const lastParentPeriod = parentPeriods[parentPeriods.length - 1];
    const globalLastEnd = getGlobalLastEndDate();

    let startDate = lastParentPeriod
      ? startOfDay(addDays(lastParentPeriod.endDate, 1))
      : globalLastEnd
        ? startOfDay(addDays(globalLastEnd, 1))
        : startOfDay(baseStartDate);

    const earliestStart = parentEarliestStart[parent];
    const ensureEarliestStart = () => {
      if (earliestStart && startDate.getTime() < earliestStart.getTime()) {
        startDate = startOfDay(earliestStart);
      }
    };

    ensureEarliestStart();

    const cutoff = parent1CutoffDate ? startOfDay(parent1CutoffDate) : null;
    if (cutoff) {
      if (parent === 'parent1') {
        const lastAllowed = startOfDay(addDays(cutoff, -1));
        if (startDate.getTime() >= cutoff.getTime()) {
          return;
        }

        const maxDays = differenceInCalendarDays(lastAllowed, startDate) + 1;
        if (maxDays <= 0) {
          return;
        }

        effectiveDays = Math.min(effectiveDays, maxDays);
      } else if (parent === 'parent2' && startDate.getTime() < cutoff.getTime()) {
        startDate = startOfDay(cutoff);
      }
    }

    if (timelineLimit) {
      const latestStart = startOfDay(addDays(timelineLimit, 1 - effectiveDays));
      if (startDate.getTime() > latestStart.getTime()) {
        startDate = latestStart;
      }
      if (startDate.getTime() > timelineLimit.getTime()) {
        startDate = startOfDay(timelineLimit);
      }
      if (startDate.getTime() < baseStartDate.getTime()) {
        startDate = startOfDay(baseStartDate);
      }

      ensureEarliestStart();

      const remainingDays = differenceInCalendarDays(timelineLimit, startDate) + 1;
      if (remainingDays <= 0) {
        return;
      }
      effectiveDays = Math.min(effectiveDays, remainingDays);
    }

    if (effectiveDays <= 0) {
      return;
    }

    const endDate = startOfDay(addDays(startDate, effectiveDays - 1));
    // For "none" periods (parent is working), the other parent is on parental leave
    // and receives parental benefits (not salary), so otherParent income should be 0
    // to avoid double-counting (their parental benefits are tracked in their own periods)
    const otherParentMonthlyIncome = 0;
    const otherParentDailyIncome = 0;
    const ownDailyIncome = parent === 'parent1'
      ? context.parent1NetIncome / 30
      : context.parent2NetIncome / 30;

    const calendarDays = Math.max(1, differenceInCalendarDays(endDate, startDate) + 1);
    const otherParentIncomeForPeriod = 0;

    mergedPeriods.push({
      parent,
      startDate,
      endDate,
      daysCount: effectiveDays,
      benefitDaysUsed: 0,
      calendarDays,
      dailyBenefit: 0,
      dailyIncome: ownDailyIncome + otherParentDailyIncome,
      benefitLevel: 'none',
      daysPerWeek: 0,
      otherParentDailyIncome,
      otherParentMonthlyIncome,
      otherParentIncomeForPeriod,
      isPreferenceFiller: true,
    });

    if (parent === 'parent1') {
      parentCalendarDays.parent1 += effectiveDays;
    } else {
      parentCalendarDays.parent2 += effectiveDays;
    }

  };

  if (timelineLimit) {
    let safetyCounter = 0;
    while (safetyCounter < 4) {
      const latest = getGlobalLastEndDate();
      if (!latest) {
        break;
      }

      const remaining = differenceInCalendarDays(startOfDay(timelineLimit), startOfDay(latest));
      if (remaining <= 0) {
        break;
      }

      const shortfall = getParentShortfall();
      let fillerParent: 'parent1' | 'parent2';

      if (shortfall.parent1 > shortfall.parent2 && shortfall.parent1 > 0) {
        fillerParent = 'parent1';
      } else if (shortfall.parent2 > shortfall.parent1 && shortfall.parent2 > 0) {
        fillerParent = 'parent2';
      } else if (shortfall.parent1 > 0) {
        fillerParent = 'parent1';
      } else if (shortfall.parent2 > 0) {
        fillerParent = 'parent2';
      } else {
        fillerParent = context.preferredParent1Months >= context.preferredParent2Months ? 'parent1' : 'parent2';
      }

      appendFiller(fillerParent, remaining);
      safetyCounter += 1;
    }
  }

  const remainingBenefitDays = calculateRemainingBenefitDays(mergedPeriods, context);
  const remainingLowDays: RemainingBenefitDays = remainingBenefitDays.low;
  const remainingHighDays: RemainingBenefitDays = remainingBenefitDays.high;
  const reservedHighDays: RemainingBenefitDays = {
    parent1: Math.min(context.parent1HighTotalDays, context.parent1ReservedHighDays),
    parent2: Math.min(context.parent2HighTotalDays, context.parent2ReservedHighDays),
  };

  const monthOwnershipMap = new Map<string, 'parent1' | 'parent2'>();
  const timelineStart = startOfDay(baseStartDate);
  const timelineEndDate = timelineLimit
    ? startOfDay(timelineLimit)
    : startOfDay(addMonths(timelineStart, 15));

  let ownershipCursor = new Date(timelineStart);
  while (ownershipCursor.getTime() <= timelineEndDate.getTime()) {
    const monthKey = format(ownershipCursor, 'yyyy-MM');
    const monthStart = startOfDay(ownershipCursor);
    const rawMonthEnd = startOfDay(new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0));
    const monthEnd = rawMonthEnd.getTime() > timelineEndDate.getTime() ? new Date(timelineEndDate) : rawMonthEnd;

    const parentDayTotals: Record<'parent1' | 'parent2', number> = { parent1: 0, parent2: 0 };

    for (const period of mergedPeriods) {
      const periodStart = startOfDay(period.startDate);
      const periodEnd = startOfDay(period.endDate);

      if (periodEnd.getTime() < monthStart.getTime() || periodStart.getTime() > monthEnd.getTime()) {
        continue;
      }

      const overlapStart = periodStart.getTime() > monthStart.getTime() ? periodStart : monthStart;
      const overlapEnd = periodEnd.getTime() < monthEnd.getTime() ? periodEnd : monthEnd;
      const overlapDays = Math.max(0, differenceInCalendarDays(overlapEnd, overlapStart) + 1);

      if (overlapDays <= 0) {
        continue;
      }

      if (period.parent === 'parent1' || period.parent === 'parent2') {
        parentDayTotals[period.parent] += overlapDays;
      } else if (period.parent === 'both') {
        parentDayTotals.parent1 += overlapDays;
        parentDayTotals.parent2 += overlapDays;
      }
    }

    if (parentDayTotals.parent1 > parentDayTotals.parent2 + 0.5) {
      monthOwnershipMap.set(monthKey, 'parent1');
    } else if (parentDayTotals.parent2 > parentDayTotals.parent1 + 0.5) {
      monthOwnershipMap.set(monthKey, 'parent2');
    }

    ownershipCursor = startOfDay(addMonths(monthStart, 1));
  }

  context.monthOwnership = monthOwnershipMap;

  ensureMinimumIncomePerMonth(
    mergedPeriods,
    context,
    remainingLowDays,
    remainingHighDays,
    timelineLimit ?? null,
    parent1CutoffDate,
    meta.key === 'save-days',
    reservedHighDays
  );

  // Escalation loop: increase days/week for the lowest-income month until threshold is met
  const MAX_ESCALATION_PASSES = 7;
  for (let pass = 0; pass < MAX_ESCALATION_PASSES; pass++) {
    // Recompute remaining days after each pass
    const recomputedRemaining = calculateRemainingBenefitDays(mergedPeriods, context);

    remainingLowDays.parent1 = recomputedRemaining.low.parent1;
    remainingLowDays.parent2 = recomputedRemaining.low.parent2;
    remainingHighDays.parent1 = recomputedRemaining.high.parent1;
    remainingHighDays.parent2 = recomputedRemaining.high.parent2;

    // Find month with largest deficit
    const timelineStart = startOfDay(new Date(context.baseStartDate.getFullYear(), context.baseStartDate.getMonth(), 1));
    const limitDate = timelineLimit ? startOfDay(timelineLimit) : null;
    const latestExistingEnd = mergedPeriods.reduce<Date | null>((latest, period) => {
      const periodEnd = startOfDay(period.endDate);
      if (!latest || periodEnd.getTime() > latest.getTime()) return periodEnd;
      return latest;
    }, null);
    
    const timelineEnd = limitDate && latestExistingEnd && latestExistingEnd.getTime() < limitDate.getTime()
      ? new Date(latestExistingEnd)
      : (limitDate ?? (latestExistingEnd ?? startOfDay(addMonths(timelineStart, 15))));

    let cursor = new Date(timelineStart);
    let worstDeficit = 0;
    let worstMonth: { start: Date; end: Date; owner: 'parent1' | 'parent2'; usedDaysPerWeek: number; hasParentalSalary: boolean } | null = null;

    while (cursor.getTime() <= timelineEnd.getTime()) {
      const monthStart = startOfDay(cursor);
      const monthEndCandidate = startOfDay(new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0));
      const monthEnd = monthEndCandidate.getTime() > timelineEnd.getTime() ? new Date(timelineEnd) : monthEndCandidate;

      // Skip birth month if it only has initial periods
      const hasInitialTenDay = mergedPeriods.some(p =>
        p.isInitialTenDayPeriod &&
        p.startDate <= monthEnd &&
        p.endDate >= monthStart
      );
      const hasNonInitialOwnerLeave = mergedPeriods.some(p =>
        !p.isInitialTenDayPeriod &&
        (p.parent === 'parent1' || p.parent === 'parent2') &&
        p.startDate <= monthEnd &&
        p.endDate >= monthStart
      );

      if (!hasInitialTenDay || hasNonInitialOwnerLeave) {
        const segmentDays = Math.max(1, differenceInCalendarDays(monthEnd, monthStart) + 1);
        const fullMonthStart = startOfDay(new Date(monthStart.getFullYear(), monthStart.getMonth(), 1));
        const fullMonthEnd = startOfDay(new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0));
        const fullMonthDays = Math.max(1, differenceInCalendarDays(fullMonthEnd, fullMonthStart) + 1);
        const monthShare = Math.min(1, segmentDays / fullMonthDays);

        const parentDayTotals: Record<'parent1' | 'parent2', number> = { parent1: 0, parent2: 0 };
        const parentMaxDaysPerWeek: Record<'parent1' | 'parent2', number> = { parent1: 0, parent2: 0 };
        let monthIncome = 0;

        for (const period of mergedPeriods) {
          const periodStart = startOfDay(period.startDate);
          const periodEnd = startOfDay(period.endDate);

          if (periodEnd.getTime() < monthStart.getTime() || periodStart.getTime() > monthEnd.getTime()) {
            continue;
          }

          const overlapStart = periodStart.getTime() > monthStart.getTime() ? periodStart : monthStart;
          const overlapEnd = periodEnd.getTime() < monthEnd.getTime() ? periodEnd : monthEnd;
          const overlapDays = Math.max(0, differenceInCalendarDays(overlapEnd, overlapStart) + 1);

          if (overlapDays <= 0) continue;

          monthIncome += (period.dailyIncome || 0) * overlapDays;

          if (period.parent === 'parent1' || period.parent === 'parent2') {
            parentDayTotals[period.parent] += overlapDays;
            const safeDaysPerWeek = Number.isFinite(period.daysPerWeek) ? (period.daysPerWeek as number) : 0;
            parentMaxDaysPerWeek[period.parent] = Math.max(parentMaxDaysPerWeek[period.parent], safeDaysPerWeek);
          } else if (period.parent === 'both') {
            parentDayTotals.parent1 += overlapDays;
            parentDayTotals.parent2 += overlapDays;
            const safeDaysPerWeek = Number.isFinite(period.daysPerWeek) ? (period.daysPerWeek as number) : 0;
            parentMaxDaysPerWeek.parent1 = Math.max(parentMaxDaysPerWeek.parent1, safeDaysPerWeek);
            parentMaxDaysPerWeek.parent2 = Math.max(parentMaxDaysPerWeek.parent2, safeDaysPerWeek);
          }
        }

        const targetIncome = context.minHouseholdIncome * monthShare;
        const deficit = Math.max(0, targetIncome - monthIncome);

        if (deficit > worstDeficit) {
          const monthKey = format(monthStart, 'yyyy-MM');
          const owner = context.monthOwnership?.get(monthKey) ??
            (parentDayTotals.parent1 > parentDayTotals.parent2 + 0.5 ? 'parent1' : 'parent2');

          worstDeficit = deficit;
          worstMonth = {
            start: monthStart,
            end: monthEnd,
            owner,
            usedDaysPerWeek: Math.min(7, Math.max(0, Math.round(parentMaxDaysPerWeek[owner] || 0))),
            hasParentalSalary: false
          };
        }
      }

      cursor = startOfDay(addMonths(monthStart, 1));
    }

    // If no deficit found, we're done
    if (!worstMonth || worstDeficit <= 0) {
      break;
    }

    // If owner already uses 7 days/week, can't escalate further
    if (worstMonth.usedDaysPerWeek >= 7) {
      break;
    }

    // Check if owner has any remaining days
    const ownerHasRemainingDays = 
      (remainingLowDays[worstMonth.owner] > 0) || 
      (remainingHighDays[worstMonth.owner] > 0);

    if (!ownerHasRemainingDays) {
      break;
    }

    // Call ensureMinimumIncomePerMonth again to add more days
    const periodCountBefore = mergedPeriods.length;
    ensureMinimumIncomePerMonth(
      mergedPeriods,
      context,
      remainingLowDays,
      remainingHighDays,
      timelineLimit ?? null,
      parent1CutoffDate,
      meta.key === 'save-days',
      reservedHighDays
    );

    // Check for progress
    if (mergedPeriods.length === periodCountBefore) {
      // No new periods added, break to avoid infinite loop
      break;
    }
  }

  const recomputedRemainingAfterEscalation = calculateRemainingBenefitDays(mergedPeriods, context);
  remainingLowDays.parent1 = recomputedRemainingAfterEscalation.low.parent1;
  remainingLowDays.parent2 = recomputedRemainingAfterEscalation.low.parent2;
  remainingHighDays.parent1 = recomputedRemainingAfterEscalation.high.parent1;
  remainingHighDays.parent2 = recomputedRemainingAfterEscalation.high.parent2;

  const guaranteeTimelineStart = startOfDay(new Date(context.baseStartDate.getFullYear(), context.baseStartDate.getMonth(), 1));
  const guaranteeLimitDate = timelineLimit ? startOfDay(timelineLimit) : null;
  const guaranteeLatestEnd = mergedPeriods.reduce<Date | null>((latest, period) => {
    const periodEnd = startOfDay(period.endDate);
    if (!latest || periodEnd.getTime() > latest.getTime()) {
      return periodEnd;
    }
    return latest;
  }, null);
  const guaranteeTimelineEnd = guaranteeLimitDate && guaranteeLatestEnd && guaranteeLatestEnd.getTime() < guaranteeLimitDate.getTime()
    ? new Date(guaranteeLatestEnd)
    : (guaranteeLimitDate ?? (guaranteeLatestEnd ?? startOfDay(addMonths(guaranteeTimelineStart, 15))));

  const hasRemainingDaysForParent = (parentKey: 'parent1' | 'parent2') => {
    if (remainingLowDays[parentKey] > 0 || remainingHighDays[parentKey] > 0) {
      return true;
    }

    const alternateParent: 'parent1' | 'parent2' = parentKey === 'parent1' ? 'parent2' : 'parent1';
    return remainingLowDays[alternateParent] > 0 || remainingHighDays[alternateParent] > 0;
  };

  const isParentAllowedForMonth = (parentKey: 'parent1' | 'parent2', monthStart: Date) => {
    if (!parent1CutoffDate || parentKey === 'parent2') {
      return true;
    }
    const cutoffDay = startOfDay(parent1CutoffDate);
    return monthStart.getTime() < cutoffDay.getTime();
  };

  const computeMonthStats = (monthStart: Date, monthEnd: Date) => {
    const parentDayTotals: Record<'parent1' | 'parent2', number> = { parent1: 0, parent2: 0 };
    const parentMaxDaysPerWeek: Record<'parent1' | 'parent2', number> = { parent1: 0, parent2: 0 };
    let monthIncome = 0;

    for (const period of mergedPeriods) {
      const periodStart = startOfDay(period.startDate);
      const periodEnd = startOfDay(period.endDate);

      if (periodEnd.getTime() < monthStart.getTime() || periodStart.getTime() > monthEnd.getTime()) {
        continue;
      }

      const overlapStart = periodStart.getTime() > monthStart.getTime() ? periodStart : monthStart;
      const overlapEnd = periodEnd.getTime() < monthEnd.getTime() ? periodEnd : monthEnd;
      const overlapDays = Math.max(0, differenceInCalendarDays(overlapEnd, overlapStart) + 1);

      if (overlapDays <= 0) {
        continue;
      }

      monthIncome += (period.dailyIncome || 0) * overlapDays;

      const safeDaysPerWeek = Number.isFinite(period.daysPerWeek) ? (period.daysPerWeek as number) : 0;

      if (period.parent === 'parent1' || period.parent === 'parent2') {
        parentDayTotals[period.parent] += overlapDays;
        parentMaxDaysPerWeek[period.parent] = Math.max(parentMaxDaysPerWeek[period.parent], safeDaysPerWeek);
      } else if (period.parent === 'both') {
        parentDayTotals.parent1 += overlapDays;
        parentDayTotals.parent2 += overlapDays;
        parentMaxDaysPerWeek.parent1 = Math.max(parentMaxDaysPerWeek.parent1, safeDaysPerWeek);
        parentMaxDaysPerWeek.parent2 = Math.max(parentMaxDaysPerWeek.parent2, safeDaysPerWeek);
      }
    }

    return { monthIncome, parentDayTotals, parentMaxDaysPerWeek };
  };

  let guaranteeCursor = new Date(guaranteeTimelineStart);

  while (guaranteeCursor.getTime() <= guaranteeTimelineEnd.getTime()) {
    const monthStart = startOfDay(guaranteeCursor);
    const monthEndCandidate = startOfDay(new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0));
    const monthEnd = monthEndCandidate.getTime() > guaranteeTimelineEnd.getTime() ? new Date(guaranteeTimelineEnd) : monthEndCandidate;

    const segmentDays = Math.max(1, differenceInCalendarDays(monthEnd, monthStart) + 1);
    const fullMonthStart = startOfDay(new Date(monthStart.getFullYear(), monthStart.getMonth(), 1));
    const fullMonthEnd = startOfDay(new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0));
    const fullMonthDays = Math.max(1, differenceInCalendarDays(fullMonthEnd, fullMonthStart) + 1);
    const monthShare = Math.min(1, segmentDays / fullMonthDays);

    const isFullMonth = monthShare >= 0.999;

    const hasInitialTenDay = mergedPeriods.some(p =>
      p.isInitialTenDayPeriod &&
      p.startDate <= monthEnd &&
      p.endDate >= monthStart
    );
    const hasNonInitialOwnerLeave = mergedPeriods.some(p =>
      !p.isInitialTenDayPeriod &&
      (p.parent === 'parent1' || p.parent === 'parent2') &&
      p.startDate <= monthEnd &&
      p.endDate >= monthStart
    );

    if (!isFullMonth || (hasInitialTenDay && !hasNonInitialOwnerLeave)) {
      guaranteeCursor = startOfDay(addMonths(monthStart, 1));
      continue;
    }

    const targetIncome = context.minHouseholdIncome * monthShare;

    const attemptTopUpForOwner = (
      ownerKey: 'parent1' | 'parent2',
      deficitForOwner: number,
      ownerUsedDaysPerWeek: number
    ): boolean => {
      if (!isParentAllowedForMonth(ownerKey, monthStart)) {
        return false;
      }

      const capacityDaysPerWeek = Math.max(0, 7 - Math.min(7, Math.max(0, Math.round(ownerUsedDaysPerWeek || 0))));
      let remainingCapacityDays = Math.max(0, Math.round(capacityDaysPerWeek * WEEKS_PER_MONTH));
      if (remainingCapacityDays <= 0) {
        remainingCapacityDays = segmentDays;
      }

      const alternateParent: 'parent1' | 'parent2' = ownerKey === 'parent1' ? 'parent2' : 'parent1';
      const ownerHighDaily = ownerKey === 'parent1' ? context.parent1HighDailyNet : context.parent2HighDailyNet;
      const ownerLowDaily = ownerKey === 'parent1' ? context.parent1MinDailyNet : context.parent2MinDailyNet;
      const ownerInfo = ownerKey === 'parent1' ? context.parent1 : context.parent2;
      const chronologicalTracker = ownerKey === 'parent1' ? parent1ChronologicalHighDays : parent2ChronologicalHighDays;
      const minHighDaysBeforeLow = ownerInfo
        ? getMinHighDaysBeforeLow(ownerInfo.hasCollectiveAgreement)
        : getMinHighDaysBeforeLow(false);
      const hasHighDaysAvailable =
        remainingHighDays[ownerKey] > 0 || remainingHighDays[alternateParent] > 0;
      const mustPrioritizeHighDays =
        chronologicalTracker.count < minHighDaysBeforeLow && ownerHighDaily > 0 && hasHighDaysAvailable;

      type BenefitOption = {
        level: 'high' | 'low';
        source: 'parent1' | 'parent2';
        daily: number;
        available: number;
      };

      const options: BenefitOption[] = [];
      const resolveHighAvailability = (source: 'parent1' | 'parent2', owner: 'parent1' | 'parent2') => {
        const remaining = Math.max(0, Math.round(remainingHighDays[source] ?? 0));
        if (source === owner) {
          return remaining;
        }
        const reserved = Math.max(0, Math.round(reservedHighDays[source] ?? 0));
        return Math.max(0, remaining - reserved);
      };

      const addOption = (
        level: 'high' | 'low',
        source: 'parent1' | 'parent2',
        daily: number,
        available: number
      ) => {
        if (daily <= 0 || available <= 0) {
          return;
        }
        options.push({ level, source, daily, available });
      };

      addOption('high', ownerKey, ownerHighDaily, resolveHighAvailability(ownerKey, ownerKey));
      addOption('high', alternateParent, ownerHighDaily, resolveHighAvailability(alternateParent, ownerKey));

      if (!mustPrioritizeHighDays) {
        addOption('low', ownerKey, ownerLowDaily, Math.max(0, remainingLowDays[ownerKey]));
        addOption('low', alternateParent, ownerLowDaily, Math.max(0, remainingLowDays[alternateParent]));
      }

      if (!options.length) {
        return false;
      }

      const isSaveDaysStrategy = meta.key === 'save-days';
      const canLowOptionCoverDeficit = (option: BenefitOption): boolean => {
        if (!isSaveDaysStrategy || option.level !== 'low') {
          return false;
        }

        const maxUsable = Math.min(option.available, remainingCapacityDays);
        if (maxUsable <= 0 || option.daily <= 0) {
          return false;
        }

        const potentialIncome = maxUsable * option.daily;
        return potentialIncome >= deficitForOwner;
      };

      options.sort((a, b) => {
        const aLowPriority = canLowOptionCoverDeficit(a);
        const bLowPriority = canLowOptionCoverDeficit(b);

        if (aLowPriority && !bLowPriority) {
          return -1;
        }

        if (!aLowPriority && bLowPriority) {
          return 1;
        }

        if (isSaveDaysStrategy && a.level !== b.level) {
          if (a.level === 'low' && b.level === 'high') {
            return -1;
          }
          if (a.level === 'high' && b.level === 'low') {
            return 1;
          }
        }

        if (b.daily !== a.daily) {
          return b.daily - a.daily;
        }
        if (a.level !== b.level) {
          return a.level === 'high' ? -1 : 1;
        }
        if (a.source === ownerKey && b.source !== ownerKey) {
          return -1;
        }
        if (b.source === ownerKey && a.source !== ownerKey) {
          return 1;
        }
        return 0;
      });

      for (const option of options) {
        const pool = option.level === 'low' ? remainingLowDays : remainingHighDays;
        let availableFromSource = Math.max(0, pool[option.source]);
        if (availableFromSource <= 0) {
          continue;
        }

        if (option.level === 'high' && option.source !== ownerKey) {
          const reserved = Math.max(0, reservedHighDays[option.source] ?? 0);
          const transferable = Math.max(0, availableFromSource - reserved);
          availableFromSource = Math.min(transferable, option.available);
        } else {
          availableFromSource = Math.min(availableFromSource, option.available);
        }

        if (availableFromSource <= 0) {
          continue;
        }

        const neededDays = Math.ceil(deficitForOwner / option.daily);
        const takeDays = Math.min(neededDays, availableFromSource, remainingCapacityDays);

        if (takeDays <= 0) {
          continue;
        }

        const daysPerWeek = clampDaysPerWeek(takeDays / WEEKS_PER_MONTH);
        const weeksUsed = daysPerWeek > 0 ? takeDays / daysPerWeek : 0;
        let calendarDays = Math.max(1, Math.round(weeksUsed * 7));
        calendarDays = Math.min(calendarDays, segmentDays);

        const periodStart = new Date(monthStart);
        let periodEnd = startOfDay(addDays(periodStart, calendarDays - 1));
        if (periodEnd.getTime() > monthEnd.getTime()) {
          periodEnd = new Date(monthEnd);
          calendarDays = Math.max(1, differenceInCalendarDays(periodEnd, periodStart) + 1);
        }

        const otherParentMonthlyNet = ownerKey === 'parent1' ? context.parent2NetIncome : context.parent1NetIncome;
        const otherParentDailyNet = otherParentMonthlyNet > 0 ? otherParentMonthlyNet / 30 : 0;
        const totalBenefitIncome = takeDays * option.daily;
        const totalOtherIncome = otherParentDailyNet * calendarDays;
        const combinedDailyIncome = calendarDays > 0
          ? (totalBenefitIncome + totalOtherIncome) / calendarDays
          : 0;
        const highDaysUsed = option.level === 'high' ? takeDays : 0;
        const lowDaysUsed = option.level === 'low' ? takeDays : 0;

        const newPeriod: LeavePeriod = {
          parent: ownerKey,
          startDate: periodStart,
          endDate: periodEnd,
          daysCount: takeDays,
          benefitDaysUsed: takeDays,
          highBenefitDaysUsed: highDaysUsed,
          lowBenefitDaysUsed: lowDaysUsed,
          calendarDays,
          dailyBenefit: option.daily,
          dailyIncome: combinedDailyIncome,
          benefitLevel: option.level,
          daysPerWeek,
          otherParentDailyIncome: otherParentDailyNet,
          otherParentMonthlyIncome: otherParentMonthlyNet,
          isPreferenceFiller: true,
          needsSequencing: true,
        };

        if (option.source !== ownerKey) {
          newPeriod.transferredDays = (newPeriod.transferredDays ?? 0) + takeDays;
          newPeriod.transferredFromParent = option.source;
          if (option.level === 'high') {
            newPeriod.transferredHighDays = (newPeriod.transferredHighDays ?? 0) + takeDays;
          } else if (option.level === 'low') {
            newPeriod.transferredLowDays = (newPeriod.transferredLowDays ?? 0) + takeDays;
          }
        }

        mergedPeriods.push(newPeriod);

        pool[option.source] = Math.max(0, pool[option.source] - takeDays);
        remainingCapacityDays = Math.max(0, remainingCapacityDays - takeDays);

        if (option.level === 'high') {
          chronologicalTracker.count += takeDays;
        }

        return true;
      }

      return false;
    };

    let additions = 0;
    const MAX_GUARANTEE_ADDITIONS = 8;

    while (additions < MAX_GUARANTEE_ADDITIONS) {
      const { monthIncome, parentDayTotals, parentMaxDaysPerWeek } = computeMonthStats(monthStart, monthEnd);
      const currentDeficit = Math.max(0, targetIncome - monthIncome);

      if (currentDeficit <= 0) {
        break;
      }

      const monthKey = format(monthStart, 'yyyy-MM');
      const preferredOwner = context.monthOwnership?.get(monthKey) ??
        (parentDayTotals.parent1 > parentDayTotals.parent2 + 0.5 ? 'parent1' : 'parent2');
      const alternateOwner: 'parent1' | 'parent2' = preferredOwner === 'parent1' ? 'parent2' : 'parent1';

      const candidates: ('parent1' | 'parent2')[] = [];

      const addCandidate = (ownerKey: 'parent1' | 'parent2') => {
        if (!candidates.includes(ownerKey) && hasRemainingDaysForParent(ownerKey) && isParentAllowedForMonth(ownerKey, monthStart)) {
          candidates.push(ownerKey);
        }
      };

      addCandidate(preferredOwner);
      addCandidate(alternateOwner);

      if (!candidates.length) {
        break;
      }

      let added = false;
      for (const candidate of candidates) {
        const ownerUsedDaysPerWeek = Math.min(7, Math.max(0, Math.round(parentMaxDaysPerWeek[candidate] || 0)));
        if (attemptTopUpForOwner(candidate, currentDeficit, ownerUsedDaysPerWeek)) {
          added = true;
          additions += 1;
          break;
        }
      }

      if (!added) {
        break;
      }
    }

    guaranteeCursor = startOfDay(addMonths(monthStart, 1));
  }

  // For "Spara dagar" strategy, we avoid trimming days if it risks falling below the minimum income threshold.
  if (meta.key === 'save-days') {
    // Intentionally left blank to ensure the minimum household income guarantee is preserved.
  }

  // Separate periods that need sequencing from those with fixed dates
  const fixedDatePeriods = mergedPeriods.filter(p => !p.needsSequencing);
  const floatingPeriods = mergedPeriods.filter(p => p.needsSequencing);

  // Sort fixed-date periods chronologically
  const sortedFixedPeriods = fixedDatePeriods.sort((a, b) => {
    const ta = a.startDate.getTime();
    const tb = b.startDate.getTime();
    if (ta !== tb) return ta - tb;
    // Initial 2x10 first when equal start
    const ai = a.isInitialTenDayPeriod ? 1 : 0;
    const bi = b.isInitialTenDayPeriod ? 1 : 0;
    return bi - ai;
  });

  const sequentialPeriods: LeavePeriod[] = [];
  let cursor = startOfDay(baseStartDate);
  const limitDate = timelineLimit ? startOfDay(timelineLimit) : null;
  const cutoffDate = parent1CutoffDate ? startOfDay(parent1CutoffDate) : null;
  const lastAllowedParent1 = cutoffDate ? startOfDay(addDays(cutoffDate, -1)) : null;

  let floatingIndex = 0;
  let fixedIndex = 0;

  // Interleave fixed and floating periods to fill gaps
  while (fixedIndex < sortedFixedPeriods.length || floatingIndex < floatingPeriods.length) {
    if (limitDate && cursor.getTime() > limitDate.getTime()) {
      break;
    }

    const nextFixed = sortedFixedPeriods[fixedIndex];
    const nextFloating = floatingPeriods[floatingIndex];

    // Determine which period to place next
    let period: LeavePeriod;
    let startDate: Date;
    
    if (nextFixed && nextFloating) {
      const fixedStart = startOfDay(nextFixed.startDate);
      
      // If there's a gap before the next fixed period, fill it with floating
      if (cursor.getTime() < fixedStart.getTime()) {
        period = nextFloating;
        startDate = new Date(cursor);
        floatingIndex++;
      } else {
        // Place the fixed period
        period = nextFixed;
        startDate = fixedStart.getTime() < cursor.getTime() ? new Date(cursor) : fixedStart;
        fixedIndex++;
      }
    } else if (nextFixed) {
      // Only fixed periods remaining
      period = nextFixed;
      const fixedStart = startOfDay(nextFixed.startDate);
      startDate = fixedStart.getTime() < cursor.getTime() ? new Date(cursor) : fixedStart;
      fixedIndex++;
    } else if (nextFloating) {
      // Only floating periods remaining
      period = nextFloating;
      startDate = new Date(cursor);
      floatingIndex++;
    } else {
      break;
    }

    const plannedCalendarDays = Math.max(1, period.calendarDays || Math.round(period.daysCount));
    let endDate = startOfDay(addDays(startDate, plannedCalendarDays - 1));

    if (limitDate && endDate.getTime() > limitDate.getTime()) {
      endDate = new Date(limitDate);
    }

    if (limitDate && startDate.getTime() > limitDate.getTime()) {
      continue;
    }

    if (period.parent === 'parent1' && lastAllowedParent1) {
      if (startDate.getTime() > lastAllowedParent1.getTime()) {
        continue;
      }

      if (endDate.getTime() > lastAllowedParent1.getTime()) {
        endDate = new Date(lastAllowedParent1);
      }
    }

    if (endDate.getTime() < startDate.getTime()) {
      continue;
    }

    const actualCalendarDays = Math.max(1, differenceInCalendarDays(endDate, startDate) + 1);
    const plannedBenefitDays = period.benefitDaysUsed ?? period.daysCount;
    const plannedCalendarReference = period.calendarDays || plannedCalendarDays;
    const calendarRatio = plannedCalendarReference > 0 ? actualCalendarDays / plannedCalendarReference : 1;
    const adjustedBenefitDays = Math.max(1, Math.round(plannedBenefitDays * calendarRatio));
    const adjustedPeriod: LeavePeriod = {
      ...period,
      startDate,
      endDate,
      daysCount: adjustedBenefitDays,
      benefitDaysUsed: adjustedBenefitDays,
      calendarDays: actualCalendarDays,
    };

    sequentialPeriods.push(adjustedPeriod);
    cursor = startOfDay(addDays(endDate, 1));
  }

  mergedPeriods.splice(0, mergedPeriods.length, ...sequentialPeriods);

  if (timelineLimit) {
    const limitDate = startOfDay(timelineLimit);
    const lastSequentialPeriod = mergedPeriods[mergedPeriods.length - 1] ?? null;
    const lastSequentialEnd = lastSequentialPeriod
      ? startOfDay(lastSequentialPeriod.endDate)
      : null;

    if (!lastSequentialEnd || lastSequentialEnd.getTime() < limitDate.getTime()) {
      const fillerStartBase = lastSequentialPeriod
        ? startOfDay(addDays(lastSequentialPeriod.endDate, 1))
        : startOfDay(baseStartDate);
      const fillerStart = fillerStartBase.getTime() < baseStartDate.getTime()
        ? startOfDay(baseStartDate)
        : fillerStartBase;

      if (fillerStart.getTime() <= limitDate.getTime()) {
        const fillerDays = differenceInCalendarDays(limitDate, fillerStart) + 1;

        if (fillerDays > 0) {
          const recomputedParentDays: Record<'parent1' | 'parent2', number> = {
            parent1: 0,
            parent2: 0,
          };

          mergedPeriods.forEach(period => {
            const days = period.calendarDays ?? Math.max(1, differenceInCalendarDays(period.endDate, period.startDate) + 1);
            if (period.parent === 'parent1') {
              recomputedParentDays.parent1 += days;
            } else if (period.parent === 'parent2') {
              recomputedParentDays.parent2 += days;
            } else if (period.parent === 'both') {
              recomputedParentDays.parent1 += days;
              recomputedParentDays.parent2 += days;
            }
          });

          const shortfallAfterSequential = {
            parent1: targetParent1Days - recomputedParentDays.parent1,
            parent2: targetParent2Days - recomputedParentDays.parent2,
          };

          let fillerParent: 'parent1' | 'parent2' = 'parent1';

          if (shortfallAfterSequential.parent1 <= 0 && shortfallAfterSequential.parent2 > 0) {
            fillerParent = 'parent2';
          } else if (shortfallAfterSequential.parent2 <= 0 && shortfallAfterSequential.parent1 > 0) {
            fillerParent = 'parent1';
          } else if (shortfallAfterSequential.parent2 > shortfallAfterSequential.parent1) {
            fillerParent = 'parent2';
          }

          const baseDaysPerWeek = Number.isFinite(lastSequentialPeriod?.daysPerWeek)
            ? (lastSequentialPeriod?.daysPerWeek as number)
            : context.requestedDaysPerWeek;

          const currentCalendarUsage = calculateParentCalendarUsage(mergedPeriods);

          const fillerTopUps = createTopUpPeriods({
            parent: fillerParent,
            start: fillerStart,
            end: limitDate,
            context,
            baseDaysPerWeek: baseDaysPerWeek ?? 0,
            remainingLowDays,
            remainingHighDays,
            parent1CutoffDate,
            parentCalendarUsage: currentCalendarUsage,
            parentCalendarCaps,
            prioritizeLowBenefit: meta.key === 'save-days',
          });

          for (const topUpPeriod of fillerTopUps) {
            const trailing = mergedPeriods[mergedPeriods.length - 1];
            if (
              trailing &&
              trailing.parent === topUpPeriod.parent &&
              trailing.benefitLevel === topUpPeriod.benefitLevel &&
              trailing.daysPerWeek === topUpPeriod.daysPerWeek &&
              Math.abs(trailing.dailyIncome - topUpPeriod.dailyIncome) < 1 &&
              Math.abs((trailing.otherParentDailyIncome || 0) - (topUpPeriod.otherParentDailyIncome || 0)) < 1
            ) {
              trailing.endDate = topUpPeriod.endDate;
              trailing.calendarDays += topUpPeriod.calendarDays;
              trailing.daysCount += topUpPeriod.daysCount;
              trailing.benefitDaysUsed += topUpPeriod.benefitDaysUsed;
            } else {
              mergedPeriods.push(topUpPeriod);
            }
          }
        }
      }
    }
  }

  if (mergedPeriods.length > 0) {
    const expectedStart = baseStartDate;
    const earliest = mergedPeriods[0];
    const offsetDays = differenceInCalendarDays(earliest.startDate, expectedStart);

    if (offsetDays > 0) {
      mergedPeriods.forEach(period => {
        period.startDate = startOfDay(addDays(period.startDate, -offsetDays));
        period.endDate = startOfDay(addDays(period.endDate, -offsetDays));
      });
    }
  }

  if (meta.key === 'maximize-income') {
    maximizeHighBenefitUsageForMaximizeStrategy(mergedPeriods, context);
  }

  mergedPeriods.forEach(period => {
    period.baseDailyIncome = period.dailyIncome;
    period.collectiveAgreementEligibleCalendarDays = 0;
    period.collectiveAgreementEligibleBenefitDays = 0;
    period.collectiveAgreementTotalBonus = 0;
  });

  applyCollectiveAgreementBonuses(mergedPeriods, context);

  enforceMonthlyMinimumIncome(
    mergedPeriods,
    context,
    remainingLowDays,
    remainingHighDays,
    timelineLimit ?? null,
    parent1CutoffDate
  );

  warnings.push(
    ...detectMinimumIncomeWarnings(
      mergedPeriods,
      context,
      timelineLimit ?? null,
      parent1CutoffDate
    )
  );

  backfillCollectiveAgreementIncome(mergedPeriods);

  const totalIncome = mergedPeriods.reduce((sum, period) => {
    const calendarDays = period.calendarDays ?? Math.max(1, differenceInCalendarDays(period.endDate, period.startDate) + 1);
    const monthlyIncome = Number.isFinite(period.monthlyIncome)
      ? (period.monthlyIncome as number)
      : (period.dailyIncome ?? 0) * calendarDays;
    return sum + monthlyIncome;
  }, 0);
  
  // Calculate days used by benefit level
  const highBenefitDaysUsed = mergedPeriods.reduce((sum, period) => {
    if (period.benefitLevel === 'high') {
      return sum + (period.benefitDaysUsed ?? period.daysCount);
    }
    return sum;
  }, 0);
  
  const lowBenefitDaysUsed = mergedPeriods.reduce((sum, period) => {
    if (period.benefitLevel === 'low') {
      return sum + (period.benefitDaysUsed ?? period.daysCount);
    }
    return sum;
  }, 0);
  
  const benefitDaysUsed = mergedPeriods.reduce((sum, period) => {
    if (period.benefitLevel === 'none') {
      return sum;
    }
    return sum + (period.benefitDaysUsed ?? period.daysCount);
  }, 0);
  clampedDaysUsed = Math.min(TOTAL_BENEFIT_DAYS, Math.max(0, Math.round(benefitDaysUsed)));
  daysSaved = Math.max(0, TOTAL_BENEFIT_DAYS - clampedDaysUsed);
  
  const clampedHighBenefitDaysUsed = Math.min(HIGH_BENEFIT_DAYS, Math.max(0, Math.round(highBenefitDaysUsed)));
  const clampedLowBenefitDaysUsed = Math.min(LOW_BENEFIT_DAYS, Math.max(0, Math.round(lowBenefitDaysUsed)));
  const highBenefitDaysSaved = Math.max(0, HIGH_BENEFIT_DAYS - clampedHighBenefitDaysUsed);
  const lowBenefitDaysSaved = Math.max(0, LOW_BENEFIT_DAYS - clampedLowBenefitDaysUsed);

  const coverageRanges = mergedPeriods
    .map(period => ({
      start: startOfDay(period.startDate).getTime(),
      end: startOfDay(period.endDate).getTime(),
    }))
    .sort((a, b) => a.start - b.start);

  let coveredDays = 0;
  let activeStart: number | null = null;
  let activeEnd: number | null = null;

  const finalizeCoverage = () => {
    if (activeStart === null || activeEnd === null) {
      return;
    }
    coveredDays += Math.max(1, differenceInCalendarDays(new Date(activeEnd), new Date(activeStart)) + 1);
    activeStart = null;
    activeEnd = null;
  };

  coverageRanges.forEach(range => {
    if (activeStart === null || activeEnd === null) {
      activeStart = range.start;
      activeEnd = range.end;
      return;
    }

    const gap = differenceInCalendarDays(new Date(range.start), new Date(activeEnd));
    if (gap <= 1) {
      if (range.end > activeEnd) {
        activeEnd = range.end;
      }
      return;
    }

    finalizeCoverage();
    activeStart = range.start;
    activeEnd = range.end;
  });

  finalizeCoverage();

  const averageMonthlyIncome = coveredDays > 0 ? (totalIncome / coveredDays) * 30 : 0;

  // Calculate per-parent day breakdowns
  const usage = { parent1High: 0, parent1Low: 0, parent2High: 0, parent2Low: 0 };
  mergedPeriods.forEach(period => {
    const highDays = Math.max(0, Math.round(period.highBenefitDaysUsed ?? (period.benefitLevel === 'high' ? period.benefitDaysUsed ?? period.daysCount ?? 0 : 0)));
    const lowDays = Math.max(0, Math.round(period.lowBenefitDaysUsed ?? (period.benefitLevel === 'low' ? period.benefitDaysUsed ?? period.daysCount ?? 0 : 0)));

    if (period.parent === 'parent1') {
      usage.parent1High += highDays;
      usage.parent1Low += lowDays;
    } else if (period.parent === 'parent2') {
      usage.parent2High += highDays;
      usage.parent2Low += lowDays;
    } else if (period.parent === 'both') {
      const highShare = highDays / 2;
      const lowShare = lowDays / 2;
      if (highShare > 0) {
        usage.parent1High += highShare;
        usage.parent2High += highShare;
      }
      if (lowShare > 0) {
        usage.parent1Low += lowShare;
        usage.parent2Low += lowShare;
      }
    }
  });

  const parentIncomeBreakdown = mergedPeriods.reduce(
    (acc, period) => {
      const parent1Benefit = Math.max(0, period.parent1BenefitIncome ?? 0);
      const parent2Benefit = Math.max(0, period.parent2BenefitIncome ?? 0);
      const parent1ParentalSalary = Math.max(0, period.parent1ParentalSalary ?? 0);
      const parent2ParentalSalary = Math.max(0, period.parent2ParentalSalary ?? 0);
      const otherParentIncome = Math.max(
        0,
        period.otherParentIncomeForPeriod ?? period.otherParentMonthlyIncome ?? 0
      );
      const monthlyIncomeForPeriod = Number.isFinite(period.monthlyIncome)
        ? (period.monthlyIncome as number)
        : (period.dailyIncome ?? 0) * Math.max(1, period.calendarDays ?? differenceInCalendarDays(period.endDate, period.startDate) + 1);

      acc.parent1.benefit += parent1Benefit;
      acc.parent2.benefit += parent2Benefit;
      acc.parent1.parentalSalary += parent1ParentalSalary;
      acc.parent2.parentalSalary += parent2ParentalSalary;

      if (period.parent === 'parent1') {
        const remaining = Math.max(0, monthlyIncomeForPeriod - parent1Benefit - parent1ParentalSalary);
        acc.parent2.working += Math.min(otherParentIncome, remaining);
      } else if (period.parent === 'parent2') {
        const remaining = Math.max(0, monthlyIncomeForPeriod - parent2Benefit - parent2ParentalSalary);
        acc.parent1.working += Math.min(otherParentIncome, remaining);
      } else if (period.parent === 'both') {
        const parent1Income = Math.max(0, period.parent1Income ?? 0);
        const parent2Income = Math.max(0, period.parent2Income ?? 0);
        const parent1Working = Math.max(0, parent1Income - parent1Benefit - parent1ParentalSalary);
        const parent2Working = Math.max(0, parent2Income - parent2Benefit - parent2ParentalSalary);
        acc.parent1.working += parent1Working;
        acc.parent2.working += parent2Working;
      }

      return acc;
    },
    {
      parent1: { benefit: 0, parentalSalary: 0, working: 0 },
      parent2: { benefit: 0, parentalSalary: 0, working: 0 },
    }
  );

  const parent1TotalIncome =
    parentIncomeBreakdown.parent1.benefit +
    parentIncomeBreakdown.parent1.parentalSalary +
    parentIncomeBreakdown.parent1.working;
  const parent2TotalIncome =
    parentIncomeBreakdown.parent2.benefit +
    parentIncomeBreakdown.parent2.parentalSalary +
    parentIncomeBreakdown.parent2.working;

  return {
    strategy: meta.key,
    title: meta.title,
    description: meta.description,
    periods: mergedPeriods,
    totalIncome,
    daysUsed: clampedDaysUsed,
    daysSaved,
    averageMonthlyIncome,
    highBenefitDaysUsed: clampedHighBenefitDaysUsed,
    lowBenefitDaysUsed: clampedLowBenefitDaysUsed,
    highBenefitDaysSaved,
    lowBenefitDaysSaved,
    warnings: warnings.length ? warnings : undefined,
    parent1HighDaysUsed: Math.round(usage.parent1High),
    parent1LowDaysUsed: Math.round(usage.parent1Low),
    parent2HighDaysUsed: Math.round(usage.parent2High),
    parent2LowDaysUsed: Math.round(usage.parent2Low),
    parent1HighDaysSaved: Math.max(0, context.parent1HighTotalDays - Math.round(usage.parent1High)),
    parent1LowDaysSaved: Math.max(0, context.parent1LowTotalDays - Math.round(usage.parent1Low)),
    parent2HighDaysSaved: Math.max(0, context.parent2HighTotalDays - Math.round(usage.parent2High)),
    parent2LowDaysSaved: Math.max(0, context.parent2LowTotalDays - Math.round(usage.parent2Low)),
    parent1TotalIncome,
    parent2TotalIncome,
    parent1BenefitIncomeTotal: parentIncomeBreakdown.parent1.benefit,
    parent2BenefitIncomeTotal: parentIncomeBreakdown.parent2.benefit,
    parent1ParentalSalaryTotal: parentIncomeBreakdown.parent1.parentalSalary,
    parent2ParentalSalaryTotal: parentIncomeBreakdown.parent2.parentalSalary,
    parent1WorkingIncomeTotal: parentIncomeBreakdown.parent1.working,
    parent2WorkingIncomeTotal: parentIncomeBreakdown.parent2.working,
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
  simultaneousMonths: number = 0,
  isFirstOptimization: boolean = false
): OptimizationResult[] {
  const calc1 = calculateAvailableIncome(parent1);
  const calc2 = calculateAvailableIncome(parent2);

  const normalizedDaysPerWeek = Math.max(1, Math.min(7, Math.round(daysPerWeek)));
  const baseDaysPerWeek = 5;
  const safeParent1Months = Math.max(0, parent1Months);
  const safeParent2Months = Math.max(0, parent2Months);
  const safeTotalMonths = Math.max(0, totalMonths);

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

  const preferredParent1Months = safeParent1Months;
  const preferredParent2Months = safeParent2Months;
  const adjustedTotalMonths = safeTotalMonths + Math.max(0, simultaneousMonths);

  const allowFullWeekForMax = true;

  const buildPreferences = (strategyKey: LegacyStrategyKey, minIncome: number, allowFullWeek: boolean) => {
    // When first optimization, enforce stricter adherence to preferred months
    const ledigTid1 = isFirstOptimization ? preferredParent1Months : Math.max(0, preferredParent1Months);
    const ledigTid2 = isFirstOptimization ? preferredParent2Months : Math.max(0, preferredParent2Months);
    
    return {
      deltid: allowFullWeek ? 'nej' : 'ja',
      ledigTid1,
      ledigTid2,
      minInkomst: Math.max(0, Math.round(minIncome)),
      strategy: strategyKey,
    };
  };

  const baseStartDate = startOfDay(new Date());

  const dayAllocation = deriveParentDayAllocation(preferredParent1Months, preferredParent2Months);
  const parent1MinDailyNet = calculateNetIncome(MINIMUM_RATE * 30, parent1.taxRate) / 30;
  const parent2MinDailyNet = calculateNetIncome(MINIMUM_RATE * 30, parent2.taxRate) / 30;
  // Only using parental benefit (Föräldrapenning), not parental salary (Föräldralön)
  const parent1HighDailyNet = calc1.parentalBenefitPerDay;
  const parent2HighDailyNet = calc2.parentalBenefitPerDay;
  const parent1ReservedHighDays = Math.min(dayAllocation.parent1IncomeDays, RESERVED_HIGH_BENEFIT_DAYS_PER_PARENT);
  const parent2ReservedHighDays = Math.min(dayAllocation.parent2IncomeDays, RESERVED_HIGH_BENEFIT_DAYS_PER_PARENT);

  const conversionContext: ConversionContext = {
    parent1,
    parent2,
    parent1NetIncome: calc1.netIncome,
    parent2NetIncome: calc2.netIncome,
    // Only using parental benefit (Föräldrapenning), not parental salary
    parent1LeaveDailyIncome: calc1.parentalBenefitPerDay,
    parent2LeaveDailyIncome: calc2.parentalBenefitPerDay,
    parent1MinDailyNet,
    parent2MinDailyNet,
    parent1HighDailyNet,
    parent2HighDailyNet,
    parent1LowTotalDays: dayAllocation.parent1LowDays,
    parent2LowTotalDays: dayAllocation.parent2LowDays,
    parent1HighTotalDays: dayAllocation.parent1IncomeDays,
    parent2HighTotalDays: dayAllocation.parent2IncomeDays,
    parent1ReservedHighDays,
    parent2ReservedHighDays,
    minHouseholdIncome: minHouseholdIncome,
    baseStartDate,
    adjustedTotalMonths,
    requestedDaysPerWeek: normalizedDaysPerWeek,
    preferredParent1Months,
    preferredParent2Months,
    simultaneousMonths,
  };

  const allocationInputs = {
    förälder1InkomstDagar: dayAllocation.parent1IncomeDays,
    förälder2InkomstDagar: dayAllocation.parent2IncomeDays,
    förälder1MinDagar: dayAllocation.parent1LowDays,
    förälder2MinDagar: dayAllocation.parent2LowDays,
  };

  const legacyInputs = {
    ...baseInputs,
    ...allocationInputs,
  };

  const saveDaysMeta = strategies.find((strategy) => strategy.key === 'save-days')!;
  
  // Auto-optimize distribution when collective agreement is involved
  let optimizedParent1Months = preferredParent1Months;
  let optimizedParent2Months = preferredParent2Months;
  
  const shouldOptimizeDistribution = 
    (conversionContext.parent1.hasCollectiveAgreement || conversionContext.parent2.hasCollectiveAgreement) &&
    !isFirstOptimization;
  
  if (shouldOptimizeDistribution) {
    const CA_OPTIMAL_MONTHS = 6;
    const parent1HasCA = conversionContext.parent1.hasCollectiveAgreement;
    const parent2HasCA = conversionContext.parent2.hasCollectiveAgreement;
    const parent1Income = conversionContext.parent1NetIncome;
    const parent2Income = conversionContext.parent2NetIncome;
    
    // If both have CA, give each parent close to 6 months for optimal CA usage
    if (parent1HasCA && parent2HasCA) {
      const totalExclusive = preferredParent1Months + preferredParent2Months;
      if (totalExclusive > CA_OPTIMAL_MONTHS * 2) {
        // Split evenly if both have CA
        optimizedParent1Months = Math.min(preferredParent1Months, CA_OPTIMAL_MONTHS);
        optimizedParent2Months = totalExclusive - optimizedParent1Months;
      }
    } else if (parent1HasCA && !parent2HasCA) {
      // Give Parent 1 (with CA) up to 6 months optimally
      const totalExclusive = preferredParent1Months + preferredParent2Months;
      if (preferredParent1Months > CA_OPTIMAL_MONTHS + 1) {
        optimizedParent1Months = CA_OPTIMAL_MONTHS;
        optimizedParent2Months = totalExclusive - optimizedParent1Months;
      }
    } else if (!parent1HasCA && parent2HasCA) {
      // Give Parent 2 (with CA) up to 6 months optimally
      const totalExclusive = preferredParent1Months + preferredParent2Months;
      if (preferredParent2Months > CA_OPTIMAL_MONTHS + 1) {
        optimizedParent2Months = CA_OPTIMAL_MONTHS;
        optimizedParent1Months = totalExclusive - optimizedParent2Months;
      }
    }
  }
  
  const saveResult = buildSimplePlanResult(saveDaysMeta, conversionContext, {
    parent1Months: optimizedParent1Months,
    parent2Months: optimizedParent2Months,
    simultaneousMonths,
  });

  const maximizeMeta = strategies.find((strategy) => strategy.key === 'maximize-income')!;
  const maximizeTargets = [
    Math.round(Math.max(minHouseholdIncome, calc1.netIncome + calc2.netIncome)),
    Math.round(calc1.availableIncome + calc2.availableIncome),
  ].filter((target) => Number.isFinite(target) && target > 0);

  const candidateStrategyKeys: LegacyStrategyKey[] = ['maximize_parental_salary', 'maximize'];
  const maximizeCandidates: OptimizationResult[] = [];
  const requiredSimultaneousMonths = Math.max(0, Math.round(simultaneousMonths));
  const evaluationCache = new WeakMap<OptimizationResult, CandidateEvaluation>();

  const evaluateCandidate = (result: OptimizationResult): CandidateEvaluation => {
    const cached = evaluationCache.get(result);
    if (cached) {
      return cached;
    }

    const usageStats = computeMonthlyUsageStats(result.periods);
    const evaluation: CandidateEvaluation = {
      simultaneousCoverage: countFullSimultaneousMonths(usageStats),
      hasOverflow: hasMonthlyOverflow(usageStats),
      parent1ParentalSalaryTotal: Math.max(0, result.parent1ParentalSalaryTotal ?? 0),
      parent2ParentalSalaryTotal: Math.max(0, result.parent2ParentalSalaryTotal ?? 0),
    };

    evaluationCache.set(result, evaluation);
    return evaluation;
  };

  maximizeCandidates.push(
    buildSimplePlanResult(maximizeMeta, conversionContext, {
      parent1Months: optimizedParent1Months,
      parent2Months: optimizedParent2Months,
      simultaneousMonths,
    })
  );

  if (maximizeTargets.length === 0) {
    maximizeTargets.push(Math.max(minHouseholdIncome, 1));
  }

  maximizeTargets.forEach((target) => {
    candidateStrategyKeys.forEach((strategyKey) => {
      const preferences = buildPreferences(strategyKey, target, allowFullWeekForMax);
      const legacyResult = optimizeParentalLeave(preferences, legacyInputs);
      const converted = convertLegacyResult(maximizeMeta, legacyResult, conversionContext, { parent1, parent2 });
      maximizeCandidates.push(converted);
    });
  });

  if (maximizeCandidates.length === 0) {
    const fallbackPreferences = buildPreferences(maximizeMeta.legacyKey, minHouseholdIncome, allowFullWeekForMax);
    const fallbackLegacy = optimizeParentalLeave(fallbackPreferences, legacyInputs);
    maximizeCandidates.push(convertLegacyResult(maximizeMeta, fallbackLegacy, conversionContext, { parent1, parent2 }));
  }

  const pickBetter = (best: OptimizationResult, current: OptimizationResult) => {
    const bestEval = evaluateCandidate(best);
    const currentEval = evaluateCandidate(current);

    const bestMeetsSim = bestEval.simultaneousCoverage >= requiredSimultaneousMonths;
    const currentMeetsSim = currentEval.simultaneousCoverage >= requiredSimultaneousMonths;

    if (currentMeetsSim !== bestMeetsSim) {
      return currentMeetsSim ? current : best;
    }

    if (bestEval.hasOverflow !== currentEval.hasOverflow) {
      return bestEval.hasOverflow ? current : best;
    }

    if (parent1.hasCollectiveAgreement && currentEval.parent1ParentalSalaryTotal !== bestEval.parent1ParentalSalaryTotal) {
      return currentEval.parent1ParentalSalaryTotal > bestEval.parent1ParentalSalaryTotal ? current : best;
    }

    if (parent2.hasCollectiveAgreement && currentEval.parent2ParentalSalaryTotal !== bestEval.parent2ParentalSalaryTotal) {
      return currentEval.parent2ParentalSalaryTotal > bestEval.parent2ParentalSalaryTotal ? current : best;
    }

    if (currentEval.simultaneousCoverage !== bestEval.simultaneousCoverage) {
      return currentEval.simultaneousCoverage > bestEval.simultaneousCoverage ? current : best;
    }

    if (current.totalIncome !== best.totalIncome) {
      return current.totalIncome > best.totalIncome ? current : best;
    }
    if (current.daysUsed !== best.daysUsed) {
      return current.daysUsed > best.daysUsed ? current : best;
    }
    return current.averageMonthlyIncome > best.averageMonthlyIncome ? current : best;
  };

  const maximizeResult = maximizeCandidates.reduce(pickBetter);

  return [saveResult, maximizeResult];
}

interface SimpleSavePlanOptions {
  parent1Months: number;
  parent2Months: number;
  simultaneousMonths: number;
}

/**
 * Detects if distribution causes suboptimal income due to collective agreement expiration.
 * Returns a warning message if the distribution is suboptimal, null otherwise.
 */
function detectSuboptimalDistribution(
  context: ConversionContext,
  parent1Months: number,
  parent2Months: number
): string | null {
  const CA_MONTHS_LIMIT = 6;
  
  // Check if either parent has collective agreement
  const parent1HasCA = context.parent1.hasCollectiveAgreement;
  const parent2HasCA = context.parent2.hasCollectiveAgreement;
  
  if (!parent1HasCA && !parent2HasCA) {
    return null; // No collective agreement, no issue
  }
  
  // Check if distribution causes CA to expire mid-leave for higher earner
  const parent1Income = context.parent1NetIncome;
  const parent2Income = context.parent2NetIncome;
  const higherEarner = parent1Income > parent2Income ? 'parent1' : 'parent2';
  const higherEarnerHasCA = higherEarner === 'parent1' ? parent1HasCA : parent2HasCA;
  const higherEarnerMonths = higherEarner === 'parent1' ? parent1Months : parent2Months;
  
  // If higher earner has CA and takes more than 6 months, suggest adjustment
  if (higherEarnerHasCA && higherEarnerMonths > CA_MONTHS_LIMIT + 1) {
    const optimalMonths = CA_MONTHS_LIMIT;
    const parentLabel = higherEarner === 'parent1' ? 'Förälder 1' : 'Förälder 2';
    const otherLabel = higherEarner === 'parent1' ? 'Förälder 2' : 'Förälder 1';
    
    return `${parentLabel} har kollektivavtal men tar ${Math.round(higherEarnerMonths)} månader ledigt. ` +
           `Föräldralön gäller bara i 6 månader, vilket ger lägre inkomst efter månad 6. ` +
           `För optimal inkomst, överväg att ge ${parentLabel} max ${optimalMonths} månader och ${otherLabel} resten.`;
  }
  
  // Check if parent with CA takes too few months (less than 4) - might be wasting CA benefit
  if (parent1HasCA && parent1Months > 0 && parent1Months < 4) {
    return `Förälder 1 har kollektivavtal men tar bara ${Math.round(parent1Months)} månader. ` +
           `Överväg att öka till minst 4-6 månader för att maximera föräldralön-fördelen.`;
  }
  
  if (parent2HasCA && parent2Months > 0 && parent2Months < 4) {
    return `Förälder 2 har kollektivavtal men tar bara ${Math.round(parent2Months)} månader. ` +
           `Överväg att öka till minst 4-6 månader för att maximera föräldralön-fördelen.`;
  }
  
  return null;
}

function buildSimplePlanResult(
  meta: StrategyMeta,
  context: ConversionContext,
  options: SimpleSavePlanOptions,
): OptimizationResult {
  const { parent1Months, parent2Months, simultaneousMonths } = options;

  const baseStart = startOfMonth(startOfDay(context.baseStartDate));
  const safeParent1Months = Math.max(0, Math.round(parent1Months));
  const safeParent2Months = Math.max(0, Math.round(parent2Months));
  const totalExclusiveMonths = safeParent1Months + safeParent2Months;
  const totalMonths = Math.max(0, totalExclusiveMonths + Math.max(0, Math.round(simultaneousMonths)));

  const periods: LeavePeriod[] = [];
  const warnings: string[] = [];
  
  // Check for suboptimal distribution warning
  const distributionWarning = detectSuboptimalDistribution(context, safeParent1Months, safeParent2Months);
  if (distributionWarning) {
    warnings.push(distributionWarning);
  }

  let totalIncome = 0;
  let totalBenefitDays = 0;

  const remainingHighDays: RemainingBenefitDays = {
    parent1: Math.max(0, context.parent1HighTotalDays),
    parent2: Math.max(0, context.parent2HighTotalDays),
  };

  const usedHighDays: RemainingBenefitDays = { parent1: 0, parent2: 0 };
  const quotaHighDaysUsed: RemainingBenefitDays = { parent1: 0, parent2: 0 };
  const remainingLowDays: RemainingBenefitDays = {
    parent1: Math.max(0, context.parent1LowTotalDays),
    parent2: Math.max(0, context.parent2LowTotalDays),
  };
  const usedLowDays: RemainingBenefitDays = { parent1: 0, parent2: 0 };
  const quotaLowDaysUsed: RemainingBenefitDays = { parent1: 0, parent2: 0 };

  let transferredToParent1 = 0;
  let transferredToParent2 = 0;

  // Track collective agreement remaining days per parent (6 months = ~183 days)
  const caRemainingCalendarDays: RemainingBenefitDays = {
    parent1: context.parent1.hasCollectiveAgreement ? COLLECTIVE_MAX_CALENDAR_DAYS : 0,
    parent2: context.parent2.hasCollectiveAgreement ? COLLECTIVE_MAX_CALENDAR_DAYS : 0,
  };

  const isSaveDaysStrategy = meta.key === 'save-days';
  const isMaximizeStrategy = meta.key === 'maximize-income';

  const minIncomeThreshold = Math.max(0, context.minHouseholdIncome || 0);

  // Track worst month for consolidated warning
  let worstMonth: { date: Date; income: number; deficit: number } | null = null;

  const resolveWorkingNet = (parent: 'parent1' | 'parent2'): number =>
    parent === 'parent1' ? context.parent1NetIncome : context.parent2NetIncome;

  const resolveDailyBenefit = (parent: 'parent1' | 'parent2'): number =>
    parent === 'parent1' ? context.parent1LeaveDailyIncome : context.parent2LeaveDailyIncome;

  const resolveOtherDaily = (parent: 'parent1' | 'parent2', calendarDays: number): number => {
    const net = resolveWorkingNet(parent);
    return calendarDays > 0 ? net / calendarDays : 0;
  };

  let monthIndex = 0;

  while (monthIndex < totalMonths) {
    const monthStart = startOfMonth(addMonths(baseStart, monthIndex));
    const monthEnd = endOfMonth(monthStart);
    const calendarDays = Math.max(1, differenceInCalendarDays(monthEnd, monthStart) + 1);
    const monthlyCapacity = Math.min(MAX_BENEFIT_DAYS_PER_MONTH, calendarDays);

    // Determine if this is a simultaneous period
    const isSimultaneousPeriod = monthIndex > 0 && monthIndex <= simultaneousMonths;

    let activeParent: 'parent1' | 'parent2' | 'both';

    if (isSimultaneousPeriod) {
      activeParent = 'both';
    } else {
      // After simultaneous period, distribute remaining months
      const exclusiveStartIndex = simultaneousMonths + 1;
      const adjustedIndex = monthIndex - simultaneousMonths;

      if (adjustedIndex < safeParent1Months) {
        activeParent = 'parent1';
      } else {
        activeParent = 'parent2';
      }
    }

    if (activeParent === 'both') {
      const perParentMaxDays = Math.min(MAX_BENEFIT_DAYS_PER_MONTH, calendarDays);

      const parent1HighAvailable = Math.max(0, remainingHighDays.parent1);
      const parent2HighAvailable = Math.max(0, remainingHighDays.parent2);
      const maxSharedHighDays = Math.min(perParentMaxDays, parent1HighAvailable, parent2HighAvailable);

      const parent1LowAvailable = Math.max(0, remainingLowDays.parent1);
      const parent2LowAvailable = Math.max(0, remainingLowDays.parent2);

      const parent1HighDaily = resolveDailyBenefit('parent1');
      const parent2HighDaily = resolveDailyBenefit('parent2');
      const combinedHighDaily = Math.max(0, parent1HighDaily) + Math.max(0, parent2HighDaily);

      const parent1BonusPerDay =
        context.parent1.hasCollectiveAgreement && parent1HighDaily > 0
          ? computeCollectiveAgreementBonusPerBenefitDay(context.parent1, parent1HighDaily)
          : 0;
      const parent2BonusPerDay =
        context.parent2.hasCollectiveAgreement && parent2HighDaily > 0
          ? computeCollectiveAgreementBonusPerBenefitDay(context.parent2, parent2HighDaily)
          : 0;

      const parent1EligibleCADays = parent1BonusPerDay > 0
        ? Math.min(caRemainingCalendarDays.parent1, calendarDays)
        : 0;
      const parent2EligibleCADays = parent2BonusPerDay > 0
        ? Math.min(caRemainingCalendarDays.parent2, calendarDays)
        : 0;

      const parent1CAFraction = calendarDays > 0 ? Math.min(1, parent1EligibleCADays / calendarDays) : 0;
      const parent2CAFraction = calendarDays > 0 ? Math.min(1, parent2EligibleCADays / calendarDays) : 0;

      const combinedHighWithCA =
        combinedHighDaily + parent1BonusPerDay * parent1CAFraction + parent2BonusPerDay * parent2CAFraction;

      let highDaysUsedPerParent = 0;
      if (maxSharedHighDays > 0) {
        if (isMaximizeStrategy && combinedHighWithCA > 0) {
          highDaysUsedPerParent = Math.min(maxSharedHighDays, perParentMaxDays);
        } else if (minIncomeThreshold > 0 && combinedHighWithCA > 0) {
          const neededHigh = Math.ceil(minIncomeThreshold / combinedHighWithCA);
          highDaysUsedPerParent = Math.min(maxSharedHighDays, neededHigh);
        } else if (combinedHighWithCA > 0) {
          highDaysUsedPerParent = Math.min(maxSharedHighDays, perParentMaxDays);
        }
      }

      highDaysUsedPerParent = Math.min(
        perParentMaxDays,
        Math.max(0, Math.round(highDaysUsedPerParent))
      );

      const parent1HighIncome = parent1HighDaily * highDaysUsedPerParent;
      const parent2HighIncome = parent2HighDaily * highDaysUsedPerParent;

      let parent1BenefitIncome = parent1HighIncome;
      let parent2BenefitIncome = parent2HighIncome;

      let monthlyBenefitIncome = parent1BenefitIncome + parent2BenefitIncome;
      let monthlyParentalSalaryIncome = 0;
      let monthlyTotalIncome = monthlyBenefitIncome;

      const combinedLowDaily = context.parent1MinDailyNet + context.parent2MinDailyNet;
      let lowDaysUsedPerParent = 0;

      const remainingCapacity = Math.max(0, perParentMaxDays - highDaysUsedPerParent);
      if (remainingCapacity > 0 && combinedLowDaily > 0) {
        const maxSharedLowDays = Math.min(remainingCapacity, parent1LowAvailable, parent2LowAvailable);
        if (maxSharedLowDays > 0) {
          if (minIncomeThreshold > monthlyTotalIncome) {
            const neededLow = Math.ceil((minIncomeThreshold - monthlyTotalIncome) / combinedLowDaily);
            lowDaysUsedPerParent = Math.min(maxSharedLowDays, neededLow);
          } else if (isSaveDaysStrategy) {
            lowDaysUsedPerParent = maxSharedLowDays;
          }

          if (isMaximizeStrategy) {
            const extraCapacity = Math.max(0, maxSharedLowDays - lowDaysUsedPerParent);
            lowDaysUsedPerParent += extraCapacity;
          }
        }
      }

      const maxLowCapacity = Math.max(0, perParentMaxDays - highDaysUsedPerParent);
      lowDaysUsedPerParent = Math.min(
        maxLowCapacity,
        Math.max(0, Math.round(lowDaysUsedPerParent))
      );

      if (lowDaysUsedPerParent > 0) {
        parent1BenefitIncome += context.parent1MinDailyNet * lowDaysUsedPerParent;
        parent2BenefitIncome += context.parent2MinDailyNet * lowDaysUsedPerParent;
      }

      monthlyBenefitIncome = parent1BenefitIncome + parent2BenefitIncome;

      const parent1CAEligibleDays =
        context.parent1.hasCollectiveAgreement && monthlyBenefitIncome > 0
          ? Math.min(calendarDays, caRemainingCalendarDays.parent1)
          : 0;
      const parent2CAEligibleDays =
        context.parent2.hasCollectiveAgreement && monthlyBenefitIncome > 0
          ? Math.min(calendarDays, caRemainingCalendarDays.parent2)
          : 0;

      const parent1CACoverage = calendarDays > 0 ? Math.min(1, parent1CAEligibleDays / calendarDays) : 0;
      const parent2CACoverage = calendarDays > 0 ? Math.min(1, parent2CAEligibleDays / calendarDays) : 0;

      const parent1ParentalSalary = parent1CAEligibleDays > 0 && parent1BenefitIncome > 0
        ? Math.round(parent1BenefitIncome * 0.1)
        : 0;
      const parent2ParentalSalary = parent2CAEligibleDays > 0 && parent2BenefitIncome > 0
        ? Math.round(parent2BenefitIncome * 0.1)
        : 0;

      monthlyParentalSalaryIncome = parent1ParentalSalary + parent2ParentalSalary;
      monthlyTotalIncome = monthlyBenefitIncome + monthlyParentalSalaryIncome;

      if (parent1ParentalSalary > 0 && parent1CAEligibleDays > 0) {
        caRemainingCalendarDays.parent1 = Math.max(0, caRemainingCalendarDays.parent1 - parent1CAEligibleDays);
      }

      if (parent2ParentalSalary > 0 && parent2CAEligibleDays > 0) {
        caRemainingCalendarDays.parent2 = Math.max(0, caRemainingCalendarDays.parent2 - parent2CAEligibleDays);
      }



      if (minIncomeThreshold > 0 && monthlyTotalIncome < minIncomeThreshold) {
        const deficit = minIncomeThreshold - monthlyTotalIncome;
        if (!worstMonth || deficit > worstMonth.deficit) {
          worstMonth = { date: monthStart, income: monthlyTotalIncome, deficit };
        }
      }

      if (highDaysUsedPerParent > 0) {
        remainingHighDays.parent1 = Math.max(0, remainingHighDays.parent1 - highDaysUsedPerParent);
        remainingHighDays.parent2 = Math.max(0, remainingHighDays.parent2 - highDaysUsedPerParent);
        usedHighDays.parent1 += highDaysUsedPerParent;
        usedHighDays.parent2 += highDaysUsedPerParent;
        quotaHighDaysUsed.parent1 += highDaysUsedPerParent;
        quotaHighDaysUsed.parent2 += highDaysUsedPerParent;
      }

      if (lowDaysUsedPerParent > 0) {
        remainingLowDays.parent1 = Math.max(0, remainingLowDays.parent1 - lowDaysUsedPerParent);
        remainingLowDays.parent2 = Math.max(0, remainingLowDays.parent2 - lowDaysUsedPerParent);
        usedLowDays.parent1 += lowDaysUsedPerParent;
        usedLowDays.parent2 += lowDaysUsedPerParent;
        quotaLowDaysUsed.parent1 += lowDaysUsedPerParent;
        quotaLowDaysUsed.parent2 += lowDaysUsedPerParent;
      }

      if (parent1ParentalSalary > 0 && parent1CAEligibleDays > 0) {
        caRemainingCalendarDays.parent1 = Math.max(0, caRemainingCalendarDays.parent1 - parent1CAEligibleDays);
      }

      if (parent2ParentalSalary > 0 && parent2CAEligibleDays > 0) {
        caRemainingCalendarDays.parent2 = Math.max(0, caRemainingCalendarDays.parent2 - parent2CAEligibleDays);
      }

      const perParentBenefitDays = highDaysUsedPerParent + lowDaysUsedPerParent;
      const combinedBenefitDays = perParentBenefitDays * 2;
      const combinedHighDaysUsed = highDaysUsedPerParent * 2;
      const combinedLowDaysUsed = lowDaysUsedPerParent * 2;

      const averageBenefitPerDay = combinedBenefitDays > 0 ? monthlyBenefitIncome / combinedBenefitDays : 0;
      const dailyIncome = calendarDays > 0 ? monthlyTotalIncome / calendarDays : 0;
      const daysPerWeek = perParentBenefitDays > 0
        ? Math.min(7, Math.max(1, Math.round(perParentBenefitDays / WEEKS_PER_MONTH)))
        : 0;

      periods.push({
        parent: 'both',
        startDate: monthStart,
        endDate: monthEnd,
        daysCount: combinedBenefitDays,
        benefitDaysUsed: combinedBenefitDays,
        highBenefitDaysUsed: combinedHighDaysUsed || undefined,
        lowBenefitDaysUsed: combinedLowDaysUsed || undefined,
        calendarDays,
        dailyBenefit: averageBenefitPerDay,
        dailyIncome,
        benefitLevel: combinedHighDaysUsed > 0 ? 'high' : combinedLowDaysUsed > 0 ? 'low' : 'none',
        daysPerWeek: daysPerWeek || undefined,
        otherParentDailyIncome: 0,
        otherParentMonthlyIncome: 0,
        monthlyIncome: monthlyTotalIncome,
        collectiveAgreementEligibleCalendarDays: parent1CAEligibleDays + parent2CAEligibleDays,
        collectiveAgreementEligibleBenefitDays:
          parent1BenefitIncome + parent2BenefitIncome > 0
            ? Math.round((highDaysUsedPerParent + lowDaysUsedPerParent) * (parent1CACoverage + parent2CACoverage))
            : 0,
        collectiveAgreementTotalBonus: monthlyParentalSalaryIncome > 0 ? monthlyParentalSalaryIncome : 0,
        isSimultaneous: true,
        parent1BenefitDays: perParentBenefitDays > 0 ? perParentBenefitDays : undefined,
        parent2BenefitDays: perParentBenefitDays > 0 ? perParentBenefitDays : undefined,
        parent1Income: parent1BenefitIncome + parent1ParentalSalary,
        parent2Income: parent2BenefitIncome + parent2ParentalSalary,
        parent1BenefitIncome: parent1BenefitIncome,
        parent2BenefitIncome: parent2BenefitIncome,
        parent1ParentalSalary: parent1ParentalSalary > 0 ? parent1ParentalSalary : undefined,
        parent2ParentalSalary: parent2ParentalSalary > 0 ? parent2ParentalSalary : undefined,
      });

      totalIncome += monthlyTotalIncome;
      totalBenefitDays += combinedBenefitDays;
      monthIndex += 1;
      continue;
    }

    // === EXISTING SINGLE-PARENT LOGIC ===
    const singleParent = activeParent as 'parent1' | 'parent2';
    const workingParent: 'parent1' | 'parent2' = singleParent === 'parent1' ? 'parent2' : 'parent1';
    const workingNetMonthly = resolveWorkingNet(workingParent);
    const leaveDailyIncome = resolveDailyBenefit(singleParent);

    // Calculate effective daily income including Föräldralön if eligible
    let effectiveDailyIncome = leaveDailyIncome;
    let eligibleCalendarDaysForCA = 0;
    let bonusPerBenefitDay = 0;
    let caEligibleFraction = 0;

    const activeParentInfo = singleParent === 'parent1' ? context.parent1 : context.parent2;
    if (activeParentInfo.hasCollectiveAgreement && caRemainingCalendarDays[singleParent] > 0 && leaveDailyIncome > 0) {
      eligibleCalendarDaysForCA = Math.min(caRemainingCalendarDays[singleParent], calendarDays);
      bonusPerBenefitDay = computeCollectiveAgreementBonusPerBenefitDay(activeParentInfo, leaveDailyIncome);
      // Use full bonus for benefit days while CA is active, regardless of partial month
      caEligibleFraction = eligibleCalendarDaysForCA > 0 ? 1 : 0;
      effectiveDailyIncome = leaveDailyIncome + (bonusPerBenefitDay * caEligibleFraction);
    }

    const initialDeficit = Math.max(0, minIncomeThreshold - workingNetMonthly);
    let remainingDeficit = initialDeficit;

    const otherParent: 'parent1' | 'parent2' = workingParent;

    let ownHighDays = 0;
    let borrowedHighDays = 0;
    let totalHighDaysUsed = 0;

    if (remainingDeficit > 0 && effectiveDailyIncome > 0) {
      const maxHighNeeded = Math.min(
        monthlyCapacity,
        Math.ceil(remainingDeficit / effectiveDailyIncome)
      );

      if (maxHighNeeded > 0) {
        const availableOwnHigh = Math.max(0, remainingHighDays[singleParent]);
        ownHighDays = Math.min(maxHighNeeded, availableOwnHigh);

        if (ownHighDays > 0) {
          remainingHighDays[singleParent] = Math.max(0, remainingHighDays[singleParent] - ownHighDays);
          quotaHighDaysUsed[singleParent] += ownHighDays;
          totalHighDaysUsed += ownHighDays;
          remainingDeficit = Math.max(0, remainingDeficit - ownHighDays * effectiveDailyIncome);
        }

        const highCapacityLeft = Math.max(0, monthlyCapacity - totalHighDaysUsed);
        if (remainingDeficit > 0 && highCapacityLeft > 0) {
          const reservedBaseline = otherParent === 'parent1'
            ? Math.max(0, context.parent1ReservedHighDays)
            : Math.max(0, context.parent2ReservedHighDays);
          const reservedRemaining = Math.max(0, reservedBaseline - quotaHighDaysUsed[otherParent]);
          const transferableHigh = Math.max(0, remainingHighDays[otherParent] - reservedRemaining);

          if (transferableHigh > 0) {
            const borrowHigh = Math.min(
              highCapacityLeft,
              transferableHigh,
              Math.ceil(remainingDeficit / effectiveDailyIncome)
            );

            if (borrowHigh > 0) {
              borrowedHighDays = borrowHigh;
              totalHighDaysUsed += borrowHigh;
              remainingHighDays[otherParent] = Math.max(0, remainingHighDays[otherParent] - borrowHigh);
              quotaHighDaysUsed[otherParent] += borrowHigh;
              remainingDeficit = Math.max(0, remainingDeficit - borrowHigh * effectiveDailyIncome);
              if (singleParent === 'parent1') {
                transferredToParent1 += borrowHigh;
              } else {
                transferredToParent2 += borrowHigh;
              }
            }
          }
        }
      }
    }

    if (totalHighDaysUsed > 0) {
      usedHighDays[singleParent] += totalHighDaysUsed;
    }

    const lowDailyIncome = singleParent === 'parent1' ? context.parent1MinDailyNet : context.parent2MinDailyNet;
    let ownLowDays = 0;
    let borrowedLowDays = 0;
    let totalLowDaysUsed = 0;
    const lowCapacityBase = Math.max(0, monthlyCapacity - totalHighDaysUsed);

    if (remainingDeficit > 0 && lowDailyIncome > 0 && lowCapacityBase > 0) {
      const neededLow = Math.min(
        lowCapacityBase,
        Math.ceil(remainingDeficit / lowDailyIncome)
      );

      if (neededLow > 0) {
        const availableOwnLow = Math.max(0, remainingLowDays[singleParent]);
        ownLowDays = Math.min(neededLow, availableOwnLow);

        if (ownLowDays > 0) {
          remainingLowDays[singleParent] = Math.max(0, remainingLowDays[singleParent] - ownLowDays);
          quotaLowDaysUsed[singleParent] += ownLowDays;
          totalLowDaysUsed += ownLowDays;
          remainingDeficit = Math.max(0, remainingDeficit - ownLowDays * lowDailyIncome);
        }

        const lowCapacityLeft = lowCapacityBase - ownLowDays;
        if (remainingDeficit > 0 && lowCapacityLeft > 0) {
          const transferableLow = Math.max(0, remainingLowDays[otherParent]);
          if (transferableLow > 0) {
            const borrowLow = Math.min(
              lowCapacityLeft,
              transferableLow,
              Math.ceil(remainingDeficit / lowDailyIncome)
            );

            if (borrowLow > 0) {
              borrowedLowDays = borrowLow;
              totalLowDaysUsed += borrowLow;
              remainingLowDays[otherParent] = Math.max(0, remainingLowDays[otherParent] - borrowLow);
              quotaLowDaysUsed[otherParent] += borrowLow;
              remainingDeficit = Math.max(0, remainingDeficit - borrowLow * lowDailyIncome);
              if (singleParent === 'parent1') {
                transferredToParent1 += borrowLow;
              } else {
                transferredToParent2 += borrowLow;
              }
            }
          }
        }
      }
    }

    if (totalLowDaysUsed > 0) {
      usedLowDays[singleParent] += totalLowDaysUsed;
    }

    const monthlyHighBenefitIncome = leaveDailyIncome * totalHighDaysUsed;
    const monthlyLowBenefitIncome = lowDailyIncome * totalLowDaysUsed;
    const monthlyBenefitIncome = monthlyHighBenefitIncome + monthlyLowBenefitIncome;

    const caEligibleCalendarDays = eligibleCalendarDaysForCA > 0
      ? Math.min(calendarDays, caRemainingCalendarDays[singleParent], eligibleCalendarDaysForCA)
      : 0;

    const caCoverage = calendarDays > 0 ? Math.min(1, caEligibleCalendarDays / calendarDays) : 0;
    const monthlyParentalSalaryIncome = activeParentInfo.hasCollectiveAgreement && 
      caRemainingCalendarDays[singleParent] > 0 && monthlyBenefitIncome > 0
      ? Math.round(monthlyBenefitIncome * 0.1)
      : 0;
    const caBenefitDays = monthlyParentalSalaryIncome > 0
      ? Math.min(totalHighDaysUsed + totalLowDaysUsed, Math.round((totalHighDaysUsed + totalLowDaysUsed) * caCoverage))
      : 0;

    if (monthlyParentalSalaryIncome > 0 && caEligibleCalendarDays > 0) {
      caRemainingCalendarDays[singleParent] = Math.max(
        0,
        caRemainingCalendarDays[singleParent] - caEligibleCalendarDays
      );
    }

    const monthlyTotalIncome = workingNetMonthly + monthlyBenefitIncome + monthlyParentalSalaryIncome;

    if (minIncomeThreshold > 0 && monthlyTotalIncome < minIncomeThreshold) {
      const deficit = minIncomeThreshold - monthlyTotalIncome;
      if (!worstMonth || deficit > worstMonth.deficit) {
        worstMonth = { date: monthStart, income: monthlyTotalIncome, deficit };
      }
    }

    const dailyIncome = calendarDays > 0 ? monthlyTotalIncome / calendarDays : 0;
    const totalBenefitDaysForMonth = totalHighDaysUsed + totalLowDaysUsed;
    const daysPerWeek = totalBenefitDaysForMonth > 0
      ? Math.min(7, Math.max(1, Math.round(totalBenefitDaysForMonth / WEEKS_PER_MONTH)))
      : 0;
    const averageBenefitPerDay = totalBenefitDaysForMonth > 0
      ? monthlyBenefitIncome / totalBenefitDaysForMonth
      : 0;
    const effectiveBenefitLevel = totalHighDaysUsed > 0
      ? 'high'
      : totalLowDaysUsed > 0
        ? 'low'
        : 'none';

    const transferredTotal = borrowedHighDays + borrowedLowDays;

    periods.push({
      parent: singleParent,
      startDate: monthStart,
      endDate: monthEnd,
      daysCount: totalBenefitDaysForMonth,
      benefitDaysUsed: totalBenefitDaysForMonth,
      highBenefitDaysUsed: totalHighDaysUsed,
      lowBenefitDaysUsed: totalLowDaysUsed,
      calendarDays,
      dailyBenefit: averageBenefitPerDay,
      dailyIncome,
      benefitLevel: effectiveBenefitLevel,
      daysPerWeek: daysPerWeek || undefined,
      otherParentDailyIncome: resolveOtherDaily(workingParent, calendarDays),
      otherParentMonthlyIncome: workingNetMonthly,
      monthlyIncome: monthlyTotalIncome,
      collectiveAgreementEligibleCalendarDays:
        monthlyParentalSalaryIncome > 0 ? caEligibleCalendarDays : 0,
      collectiveAgreementEligibleBenefitDays:
        monthlyParentalSalaryIncome > 0 ? caBenefitDays : 0,
      collectiveAgreementTotalBonus:
        monthlyParentalSalaryIncome > 0 ? monthlyParentalSalaryIncome : 0,
      transferredDays: transferredTotal > 0 ? transferredTotal : undefined,
      transferredFromParent: transferredTotal > 0 ? otherParent : undefined,
      transferredHighDays: borrowedHighDays > 0 ? borrowedHighDays : undefined,
      transferredLowDays: borrowedLowDays > 0 ? borrowedLowDays : undefined,
      parent1Income:
        singleParent === 'parent1'
          ? monthlyBenefitIncome + monthlyParentalSalaryIncome
          : workingParent === 'parent1'
            ? workingNetMonthly
            : 0,
      parent2Income:
        singleParent === 'parent2'
          ? monthlyBenefitIncome + monthlyParentalSalaryIncome
          : workingParent === 'parent2'
            ? workingNetMonthly
            : 0,
      parent1BenefitIncome: singleParent === 'parent1' ? monthlyBenefitIncome : 0,
      parent2BenefitIncome: singleParent === 'parent2' ? monthlyBenefitIncome : 0,
      parent1ParentalSalary:
        singleParent === 'parent1' && monthlyParentalSalaryIncome > 0
          ? monthlyParentalSalaryIncome
          : undefined,
      parent2ParentalSalary:
        singleParent === 'parent2' && monthlyParentalSalaryIncome > 0
          ? monthlyParentalSalaryIncome
          : undefined,
      parent1BenefitDays: singleParent === 'parent1' ? totalBenefitDaysForMonth : undefined,
      parent2BenefitDays: singleParent === 'parent2' ? totalBenefitDaysForMonth : undefined,
    });

    totalIncome += monthlyTotalIncome;
    totalBenefitDays += totalBenefitDaysForMonth;
    monthIndex += 1;
  }

  const topUpSingleParentPeriods = () => {
    const singleParentPeriods = periods
      .filter(period => period.parent === 'parent1' || period.parent === 'parent2')
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

    singleParentPeriods.forEach(period => {
      const leaveParent = period.parent as 'parent1' | 'parent2';
      const calendarDays = period.calendarDays ?? Math.max(1, differenceInCalendarDays(period.endDate, period.startDate) + 1);
      const monthlyCapacity = Math.min(MAX_BENEFIT_DAYS_PER_MONTH, calendarDays);
      let currentHigh = Math.max(0, period.highBenefitDaysUsed ?? 0);
      let currentLow = Math.max(0, period.lowBenefitDaysUsed ?? 0);
      let currentTotalBenefitDays = currentHigh + currentLow;
      let remainingCapacity = Math.max(0, monthlyCapacity - currentTotalBenefitDays);
      let currentMonthlyIncome = Math.max(0, period.monthlyIncome ?? 0);
      const targetMonthlyIncome = Math.max(minIncomeThreshold > 0 ? minIncomeThreshold : 0, currentMonthlyIncome);

      if (remainingCapacity <= 0 && currentMonthlyIncome >= targetMonthlyIncome) {
        return;
      }
      
      if (remainingCapacity <= 0 && currentMonthlyIncome < targetMonthlyIncome) {
        const monthStart = startOfMonth(period.startDate);
        const deficit = targetMonthlyIncome - currentMonthlyIncome;
        warnings.push(`Varning: Kan inte nå ${formatCurrency(targetMonthlyIncome)} för ${format(monthStart, 'MMMM yyyy', { locale: sv })} - alla ${monthlyCapacity} dagar är redan använda. Underskott: ${formatCurrency(deficit)}.`);
        return;
      }

      const leaveDailyIncome = resolveDailyBenefit(leaveParent);
      const lowDailyIncome = leaveParent === 'parent1' ? context.parent1MinDailyNet : context.parent2MinDailyNet;
      const existingParentalSalary = leaveParent === 'parent1'
        ? Math.max(0, period.parent1ParentalSalary ?? 0)
        : Math.max(0, period.parent2ParentalSalary ?? 0);

      const allocateHighDays = () => {
        if (remainingCapacity <= 0) {
          return;
        }

        const availableHigh = Math.max(0, remainingHighDays[leaveParent]);
        if (availableHigh <= 0) {
          return;
        }

        const remainingGap = Math.max(0, targetMonthlyIncome - currentMonthlyIncome);
        const maxNeeded = leaveDailyIncome > 0 ? Math.ceil(remainingGap / leaveDailyIncome) : 0;
        const extraHigh = Math.min(remainingCapacity, availableHigh, maxNeeded > 0 ? maxNeeded : availableHigh);
        if (extraHigh <= 0) {
          return;
        }

        remainingHighDays[leaveParent] = Math.max(0, availableHigh - extraHigh);
        period.highBenefitDaysUsed = currentHigh + extraHigh;
        currentTotalBenefitDays += extraHigh;
        remainingCapacity -= extraHigh;

        const extraHighIncome = leaveDailyIncome * extraHigh;
        period.monthlyIncome = (period.monthlyIncome ?? 0) + extraHighIncome;
        currentMonthlyIncome += extraHighIncome;

        if (leaveParent === 'parent1') {
          period.parent1BenefitIncome = (period.parent1BenefitIncome ?? 0) + extraHighIncome;
          period.parent1Income = (period.parent1Income ?? 0) + extraHighIncome;
        } else {
          period.parent2BenefitIncome = (period.parent2BenefitIncome ?? 0) + extraHighIncome;
          period.parent2Income = (period.parent2Income ?? 0) + extraHighIncome;
        }

        currentHigh += extraHigh;
      };

      const allocateLowDays = () => {
        if (remainingCapacity <= 0) {
          return;
        }

        const availableLow = Math.max(0, remainingLowDays[leaveParent]);
        if (availableLow <= 0) {
          return;
        }

        const remainingGap = Math.max(0, targetMonthlyIncome - currentMonthlyIncome);
        const maxNeeded = lowDailyIncome > 0 ? Math.ceil(remainingGap / lowDailyIncome) : 0;
        const extraLow = Math.min(remainingCapacity, availableLow, maxNeeded > 0 ? maxNeeded : availableLow);
        if (extraLow <= 0) {
          return;
        }

        remainingLowDays[leaveParent] = Math.max(0, availableLow - extraLow);
        period.lowBenefitDaysUsed = currentLow + extraLow;
        currentTotalBenefitDays += extraLow;
        remainingCapacity -= extraLow;

        const extraLowIncome = lowDailyIncome * extraLow;
        period.monthlyIncome = (period.monthlyIncome ?? 0) + extraLowIncome;
        currentMonthlyIncome += extraLowIncome;

        if (leaveParent === 'parent1') {
          period.parent1BenefitIncome = (period.parent1BenefitIncome ?? 0) + extraLowIncome;
          period.parent1Income = (period.parent1Income ?? 0) + extraLowIncome;
        } else {
          period.parent2BenefitIncome = (period.parent2BenefitIncome ?? 0) + extraLowIncome;
          period.parent2Income = (period.parent2Income ?? 0) + extraLowIncome;
        }

        currentLow += extraLow;
      };

      allocateHighDays();
      allocateLowDays();

      const updatedBenefitDays = Math.min(monthlyCapacity, Math.max(0, currentHigh + currentLow));
      if (updatedBenefitDays !== Math.max(0, period.benefitDaysUsed ?? period.daysCount ?? 0)) {
        period.benefitDaysUsed = updatedBenefitDays;
        period.daysCount = updatedBenefitDays;
        const updatedDaysPerWeek = updatedBenefitDays > 0
          ? Math.min(7, Math.max(1, Math.round(updatedBenefitDays / WEEKS_PER_MONTH)))
          : 0;
        period.daysPerWeek = updatedDaysPerWeek || undefined;
      }

      const totalBenefitIncomeForParent = (leaveParent === 'parent1'
        ? (period.parent1BenefitIncome ?? 0)
        : (period.parent2BenefitIncome ?? 0));
      const updatedTotalBenefitDays = Math.max(0, period.highBenefitDaysUsed ?? 0) + Math.max(0, period.lowBenefitDaysUsed ?? 0);
      period.dailyBenefit = updatedTotalBenefitDays > 0
        ? totalBenefitIncomeForParent / updatedTotalBenefitDays
        : period.dailyBenefit;

      const availableCADays = caRemainingCalendarDays[leaveParent];
      const caEligibleCalendarDays = Math.min(calendarDays, availableCADays);
      const hasCollectiveAgreement = leaveParent === 'parent1' 
        ? context.parent1.hasCollectiveAgreement 
        : context.parent2.hasCollectiveAgreement;
      const recalculatedParentalSalary = hasCollectiveAgreement && 
        caEligibleCalendarDays > 0 && totalBenefitIncomeForParent > 0
        ? Math.round(totalBenefitIncomeForParent * 0.1)
        : 0;
      const caCalendarUsed = recalculatedParentalSalary > 0 ? caEligibleCalendarDays : 0;
      if (caCalendarUsed > 0) {
        caRemainingCalendarDays[leaveParent] = Math.max(0, availableCADays - caCalendarUsed);
      }

      const updatedMonthlyIncomeWithoutCA = Math.max(0, (period.monthlyIncome ?? 0) - existingParentalSalary);
      const updatedMonthlyIncome = updatedMonthlyIncomeWithoutCA + recalculatedParentalSalary;

      period.collectiveAgreementEligibleCalendarDays = recalculatedParentalSalary > 0 ? caCalendarUsed : 0;
      period.collectiveAgreementEligibleBenefitDays = recalculatedParentalSalary > 0
        ? updatedTotalBenefitDays
        : 0;
      period.collectiveAgreementTotalBonus = recalculatedParentalSalary;

      if (leaveParent === 'parent1') {
        period.parent1ParentalSalary = recalculatedParentalSalary > 0 ? recalculatedParentalSalary : undefined;
        period.parent1Income = (period.parent1Income ?? 0) - existingParentalSalary + recalculatedParentalSalary;
      } else {
        period.parent2ParentalSalary = recalculatedParentalSalary > 0 ? recalculatedParentalSalary : undefined;
        period.parent2Income = (period.parent2Income ?? 0) - existingParentalSalary + recalculatedParentalSalary;
      }

      period.monthlyIncome = updatedMonthlyIncome;

      period.dailyIncome = calendarDays > 0
        ? updatedMonthlyIncome / calendarDays
        : period.dailyIncome;
    });
  };

  topUpSingleParentPeriods();

  totalIncome = 0;
  totalBenefitDays = 0;
  const recomputedHighUsage: RemainingBenefitDays = { parent1: 0, parent2: 0 };
  const recomputedLowUsage: RemainingBenefitDays = { parent1: 0, parent2: 0 };

  periods.forEach(period => {
    const monthlyIncome = Number.isFinite(period.monthlyIncome)
      ? (period.monthlyIncome as number)
      : (period.dailyIncome ?? 0) * Math.max(1, period.calendarDays ?? differenceInCalendarDays(period.endDate, period.startDate) + 1);
    totalIncome += monthlyIncome;

    const highDays = Math.max(0, period.highBenefitDaysUsed ?? 0);
    const lowDays = Math.max(0, period.lowBenefitDaysUsed ?? 0);
    totalBenefitDays += highDays + lowDays;

    if (period.parent === 'parent1') {
      recomputedHighUsage.parent1 += highDays;
      recomputedLowUsage.parent1 += lowDays;
    } else if (period.parent === 'parent2') {
      recomputedHighUsage.parent2 += highDays;
      recomputedLowUsage.parent2 += lowDays;
    } else if (period.parent === 'both') {
      const parent1HighShare = highDays > 0 ? highDays / 2 : 0;
      const parent2HighShare = highDays > 0 ? highDays / 2 : 0;
      const parent1LowShare = lowDays > 0 ? lowDays / 2 : 0;
      const parent2LowShare = lowDays > 0 ? lowDays / 2 : 0;
      recomputedHighUsage.parent1 += parent1HighShare;
      recomputedHighUsage.parent2 += parent2HighShare;
      recomputedLowUsage.parent1 += parent1LowShare;
      recomputedLowUsage.parent2 += parent2LowShare;
    }
  });

  const parent1HighUsed = recomputedHighUsage.parent1;
  const parent2HighUsed = recomputedHighUsage.parent2;
  const parent1LowUsed = recomputedLowUsage.parent1;
  const parent2LowUsed = recomputedLowUsage.parent2;

  const highBenefitDaysUsed = parent1HighUsed + parent2HighUsed;
  const lowBenefitDaysUsed = parent1LowUsed + parent2LowUsed;

  const totalHighDaysAvailable = Math.max(0, context.parent1HighTotalDays + context.parent2HighTotalDays);
  const totalLowDaysAvailable = Math.max(0, context.parent1LowTotalDays + context.parent2LowTotalDays);

  const averageMonthlyIncome = totalMonths > 0 ? totalIncome / totalMonths : 0;
  const highBenefitDaysSaved = Math.max(0, totalHighDaysAvailable - highBenefitDaysUsed);
  const lowBenefitDaysSaved = Math.max(0, totalLowDaysAvailable - lowBenefitDaysUsed);
  const daysSaved = Math.max(0, TOTAL_BENEFIT_DAYS - totalBenefitDays);
  const parent1HighDaysSaved = Math.max(0, context.parent1HighTotalDays - parent1HighUsed);
  const parent2HighDaysSaved = Math.max(0, context.parent2HighTotalDays - parent2HighUsed);
  const parent1LowDaysSaved = Math.max(0, context.parent1LowTotalDays - parent1LowUsed);
  const parent2LowDaysSaved = Math.max(0, context.parent2LowTotalDays - parent2LowUsed);

  const parentIncomeBreakdown = periods.reduce(
    (acc, period) => {
      const parent1Benefit = Math.max(0, period.parent1BenefitIncome ?? 0);
      const parent2Benefit = Math.max(0, period.parent2BenefitIncome ?? 0);
      const periodTotalBonus = Math.max(0, period.collectiveAgreementTotalBonus ?? 0);
      const parent1RecordedParentalSalary = Math.max(0, period.parent1ParentalSalary ?? 0);
      const parent2RecordedParentalSalary = Math.max(0, period.parent2ParentalSalary ?? 0);
      let parent1ParentalSalary = parent1RecordedParentalSalary;
      let parent2ParentalSalary = parent2RecordedParentalSalary;
      const otherParentIncome = Math.max(
        0,
        period.otherParentIncomeForPeriod ?? period.otherParentMonthlyIncome ?? 0
      );
      const monthlyIncomeForPeriod = Number.isFinite(period.monthlyIncome)
        ? (period.monthlyIncome as number)
        : (period.dailyIncome ?? 0) * Math.max(1, period.calendarDays ?? differenceInCalendarDays(period.endDate, period.startDate) + 1);

      if (periodTotalBonus > 0) {
        if (period.parent === 'parent1' && parent1ParentalSalary <= 0) {
          parent1ParentalSalary = periodTotalBonus;
        } else if (period.parent === 'parent2' && parent2ParentalSalary <= 0) {
          parent2ParentalSalary = periodTotalBonus;
        } else if (period.parent === 'both') {
          const parent1HasRecordedBonus = parent1RecordedParentalSalary > 0;
          const parent2HasRecordedBonus = parent2RecordedParentalSalary > 0;

          if (!parent1HasRecordedBonus && !parent2HasRecordedBonus) {
            const combinedBenefit = parent1Benefit + parent2Benefit;
            const parent1Share = combinedBenefit > 0 ? parent1Benefit / combinedBenefit : 0.5;
            const parent2Share = combinedBenefit > 0 ? parent2Benefit / combinedBenefit : 0.5;
            parent1ParentalSalary = periodTotalBonus * parent1Share;
            parent2ParentalSalary = periodTotalBonus * parent2Share;
          }
        }
      }

      acc.parent1.benefit += parent1Benefit;
      acc.parent2.benefit += parent2Benefit;
      acc.parent1.parentalSalary += parent1ParentalSalary;
      acc.parent2.parentalSalary += parent2ParentalSalary;

      if (period.parent === 'parent1') {
        const remaining = Math.max(0, monthlyIncomeForPeriod - parent1Benefit - parent1ParentalSalary);
        acc.parent2.working += Math.min(otherParentIncome, remaining);
      } else if (period.parent === 'parent2') {
        const remaining = Math.max(0, monthlyIncomeForPeriod - parent2Benefit - parent2ParentalSalary);
        acc.parent1.working += Math.min(otherParentIncome, remaining);
      } else if (period.parent === 'both') {
        const parent1Income = Math.max(0, period.parent1Income ?? 0);
        const parent2Income = Math.max(0, period.parent2Income ?? 0);
        const parent1Working = Math.max(0, parent1Income - parent1Benefit - parent1ParentalSalary);
        const parent2Working = Math.max(0, parent2Income - parent2Benefit - parent2ParentalSalary);
        acc.parent1.working += parent1Working;
        acc.parent2.working += parent2Working;
      }

      return acc;
    },
    {
      parent1: { benefit: 0, parentalSalary: 0, working: 0 },
      parent2: { benefit: 0, parentalSalary: 0, working: 0 },
    }
  );

  const parent1TotalIncome =
    parentIncomeBreakdown.parent1.benefit +
    parentIncomeBreakdown.parent1.parentalSalary +
    parentIncomeBreakdown.parent1.working;
  const parent2TotalIncome =
    parentIncomeBreakdown.parent2.benefit +
    parentIncomeBreakdown.parent2.parentalSalary +
    parentIncomeBreakdown.parent2.working;

  // Generate consolidated warning for worst month
  if (worstMonth) {
    const remainingTotal =
      remainingHighDays.parent1 +
      remainingHighDays.parent2 +
      remainingLowDays.parent1 +
      remainingLowDays.parent2;
    const suggestion = remainingTotal > 0
      ? "Öka antalet dagar per vecka eller omfördela månader mellan föräldrarna."
      : "Du behöver förkorta din föräldraledighet eller sänka ditt minimikrav.";
      
    warnings.push(
      `Hushållets lägsta helnmånad är ${format(worstMonth.date, 'MMMM yyyy', { locale: sv })} ` +
      `med en inkomst på ${formatCurrency(worstMonth.income)}. ` +
      `Detta är ${formatCurrency(worstMonth.deficit)} under minimikravet på ${formatCurrency(minIncomeThreshold)}. ` +
      suggestion
    );
  }

  const result: OptimizationResult = {
    strategy: meta.key,
    title: meta.title,
    description: meta.description,
    periods,
    totalIncome,
    daysUsed: totalBenefitDays,
    daysSaved,
    averageMonthlyIncome,
    highBenefitDaysUsed,
    lowBenefitDaysUsed,
    highBenefitDaysSaved,
    lowBenefitDaysSaved,
    parent1HighDaysUsed: parent1HighUsed,
    parent1LowDaysUsed: parent1LowUsed,
    parent2HighDaysUsed: parent2HighUsed,
    parent2LowDaysUsed: parent2LowUsed,
    parent1HighDaysSaved,
    parent1LowDaysSaved,
    parent2HighDaysSaved,
    parent2LowDaysSaved,
    parent1TotalIncome,
    parent2TotalIncome,
    parent1BenefitIncomeTotal: parentIncomeBreakdown.parent1.benefit,
    parent2BenefitIncomeTotal: parentIncomeBreakdown.parent2.benefit,
    parent1ParentalSalaryTotal: parentIncomeBreakdown.parent1.parentalSalary,
    parent2ParentalSalaryTotal: parentIncomeBreakdown.parent2.parentalSalary,
    parent1WorkingIncomeTotal: parentIncomeBreakdown.parent1.working,
    parent2WorkingIncomeTotal: parentIncomeBreakdown.parent2.working,
    transferredToParent1: transferredToParent1 > 0 ? transferredToParent1 : undefined,
    transferredToParent2: transferredToParent2 > 0 ? transferredToParent2 : undefined,
  };

  if (warnings.length > 0) {
    result.warnings = Array.from(new Set(warnings));
  }

  return result;
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

export function quickOptimize(params: {
  parent1: ParentData;
  parent2: ParentData;
  minHouseholdIncome: number;
  parent1Months: number;
  parent2Months: number;
  daysPerWeek: number;
  simultaneousLeave: boolean;
  simultaneousMonths: number;
  strategy: string;
}): {
  totalIncome: number;
  daysUsed: number;
} {
  const totalMonths = params.parent1Months + params.parent2Months;
  
  const results = optimizeLeave(
    params.parent1,
    params.parent2,
    totalMonths,
    params.parent1Months,
    params.parent2Months,
    params.minHouseholdIncome,
    params.daysPerWeek,
    params.simultaneousLeave ? params.simultaneousMonths : 0,
    false // Not first optimization for quick tests
  );
  
  const strategyResult = results.find(r => r.strategy === params.strategy);
  if (!strategyResult) return { totalIncome: 0, daysUsed: 0 };
  
  const totalIncome = strategyResult.totalIncome || 0;
  const daysUsed = strategyResult.daysUsed || 0;
  
  return { totalIncome, daysUsed };
}
