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
  warnings?: string[];
}

export interface LeavePeriod {
  parent: 'parent1' | 'parent2' | 'both';
  startDate: Date;
  endDate: Date;
  daysCount: number;
  benefitDaysUsed: number;
  calendarDays: number;
  dailyBenefit: number;
  dailyIncome: number;
  benefitLevel: 'parental-salary' | 'high' | 'low' | 'none';
  daysPerWeek?: number;
  otherParentDailyIncome?: number;
  otherParentMonthlyIncome?: number;
  isInitialTenDayPeriod?: boolean;
  isPreferenceFiller?: boolean;
  transferredDays?: number;
  transferredFromParent?: 'parent1' | 'parent2';
  needsSequencing?: boolean;
  isTopUp?: boolean;
  monthlyIncome?: number;
}

const PARENTAL_BENEFIT_CEILING = 49000;
const HIGH_BENEFIT_DAYS = 390;
const LOW_BENEFIT_DAYS = 90;
export const TOTAL_BENEFIT_DAYS = HIGH_BENEFIT_DAYS + LOW_BENEFIT_DAYS;
const RESERVED_HIGH_BENEFIT_DAYS_PER_PARENT = 90;
const INITIAL_SHARED_WORKING_DAYS = 10;
const INITIAL_SHARED_CALENDAR_DAYS = 14;
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
}

const APPROX_CALENDAR_DAYS_PER_MONTH = 30;

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
  let coveredDays = 0;
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

    coveredDays += overlapDays;
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
    coveredDays,
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
      ? new Date(latestExistingEnd)
      : (limitDate ?? (latestExistingEnd ?? startOfDay(addMonths(timelineStart, 15))));

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
      const isFullMonth = metrics.coveredDays >= monthLength;

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

    const highDaily = owner === 'parent1' ? context.parent1HighDailyNet : context.parent2HighDailyNet;
    const lowDaily = owner === 'parent1' ? context.parent1MinDailyNet : context.parent2MinDailyNet;

    let effectiveLevel: 'high' | 'low' | null = null;
    let effectiveDaily = 0;

    if (availableHigh > 0 && highDaily > lowDaily) {
      effectiveLevel = 'high';
      effectiveDaily = highDaily;
    } else if (availableLow > 0 && lowDaily > 0) {
      effectiveLevel = 'low';
      effectiveDaily = lowDaily;
    } else if (availableHigh > 0 && highDaily > 0) {
      effectiveLevel = 'high';
      effectiveDaily = highDaily;
    }

    if (!effectiveLevel || effectiveDaily <= 0) {
      break;
    }

    const segmentDays = Math.max(1, differenceInCalendarDays(targetMonth.end, targetMonth.start) + 1);
    const maxMonthlyBenefitDays = Math.max(7, Math.round(7 * WEEKS_PER_MONTH));
    const availableBenefitDays = effectiveLevel === 'high' ? availableHigh : availableLow;
    const neededDays = Math.ceil(worstDeficit / effectiveDaily);
    const takeDays = Math.min(neededDays, availableBenefitDays, maxMonthlyBenefitDays);

    if (takeDays <= 0) {
      break;
    }

    const calendarDays = Math.min(segmentDays, Math.max(1, takeDays));
    const periodStart = new Date(targetMonth.start);
    let periodEnd = startOfDay(addDays(periodStart, calendarDays - 1));
    if (periodEnd.getTime() > targetMonth.end.getTime()) {
      periodEnd = new Date(targetMonth.end);
    }

    const topUpPeriod: LeavePeriod = {
      parent: owner,
      startDate: periodStart,
      endDate: periodEnd,
      daysCount: takeDays,
      benefitDaysUsed: takeDays,
      calendarDays,
      dailyBenefit: effectiveDaily,
      dailyIncome: effectiveDaily,
      benefitLevel: effectiveLevel,
      daysPerWeek: 7,
      otherParentDailyIncome: 0,
      otherParentMonthlyIncome: 0,
      isTopUp: true,
      needsSequencing: true,
    };

    if (sourceParent !== owner) {
      topUpPeriod.transferredDays = (topUpPeriod.transferredDays ?? 0) + takeDays;
      topUpPeriod.transferredFromParent = sourceParent;
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
    const benefitDays = period.benefitDaysUsed ?? period.daysCount ?? 0;
    if (!benefitDays || period.benefitLevel === 'none') {
      return;
    }

    if (period.parent === 'both') {
      const share = benefitDays / 2;
      if (period.benefitLevel === 'low') {
        usedLow.parent1 += share;
        usedLow.parent2 += share;
      } else if (period.benefitLevel === 'high' || period.benefitLevel === 'parental-salary') {
        usedHigh.parent1 += share;
        usedHigh.parent2 += share;
      }
      return;
    }

    const ownerKey: 'parent1' | 'parent2' = period.parent === 'parent1' ? 'parent1' : 'parent2';
    const transferSource =
      period.transferredFromParent && period.transferredFromParent !== ownerKey
        ? period.transferredFromParent
        : null;
    const transferCount = transferSource
      ? Math.max(0, Math.min(benefitDays, period.transferredDays ?? benefitDays))
      : 0;
    const ownerContribution = Math.max(0, benefitDays - transferCount);

    if (period.benefitLevel === 'low') {
      usedLow[ownerKey] += ownerContribution;
      if (transferSource && transferCount > 0) {
        usedLow[transferSource] += transferCount;
      }
    } else if (period.benefitLevel === 'high' || period.benefitLevel === 'parental-salary') {
      usedHigh[ownerKey] += ownerContribution;
      if (transferSource && transferCount > 0) {
        usedHigh[transferSource] += transferCount;
      }
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

      results.push({
        parent,
        startDate,
        endDate,
        daysCount: calendarDays,
        benefitDaysUsed: benefitDays,
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

    const order: Array<'high' | 'low'> = ['high', 'low'];

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
  parent1CutoffDate: Date | null
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

      if (effectiveBenefitLevel === 'low') {
        if (ownerHasParentalSalary) {
          return;
        }

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

    // Check if this month has parental salary periods for the owner
    const ownerHasParentalSalary = periods.some(p =>
      p.parent === owner &&
      p.benefitLevel === 'parental-salary' &&
      p.startDate <= monthEnd &&
      p.endDate >= monthStart
    );

    // Iteratively top up within this month until threshold is met or capacity/days are exhausted
    const order: Array<'high' | 'low'> = ['high', 'low'];

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

  if (totalPreferredMonths <= 0) {
    const halfTransferable = Math.round(transferable / 2);
    const halfIncome = baseReserved + halfTransferable;
    const halfLow = Math.round(LOW_BENEFIT_DAYS / 2);

    return {
      parent1IncomeDays: halfIncome,
      parent2IncomeDays: HIGH_BENEFIT_DAYS - halfIncome,
      parent1LowDays: halfLow,
      parent2LowDays: LOW_BENEFIT_DAYS - halfLow,
    };
  }

  const parent1Share = safeParent1Months / totalPreferredMonths;
  const parent1Transferable = Math.round(transferable * parent1Share);
  const parent1IncomeDays = Math.max(baseReserved, Math.min(baseReserved + transferable, baseReserved + parent1Transferable));
  const parent2IncomeDays = Math.max(baseReserved, HIGH_BENEFIT_DAYS - parent1IncomeDays);
  const parent1LowDays = Math.max(0, Math.round(LOW_BENEFIT_DAYS * parent1Share));

  return {
    parent1IncomeDays,
    parent2IncomeDays,
    parent1LowDays,
    parent2LowDays: Math.max(0, LOW_BENEFIT_DAYS - parent1LowDays),
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
  benefitLevel: 'parental-salary' | 'high' | 'low' | 'none';
  otherParentMonthlyIncome: number;
  usedDays: number;
  fallbackDaysPerWeek: number;
  benefitMonthly: number;
  leaveMonthlyIncome: number;
  preferredDaysPerWeek?: number;
  forceRecomputeWeeks?: boolean;
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
  let otherParentIncomeForPeriod: number;
  if (isFullMonthPeriod) {
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
  // When benefitLevel is 'none', there's no benefit income for the leave parent
  const effectiveLeaveMonthlyIncome = benefitLevel === 'none' ? 0 : leaveMonthlyIncome;
  const totalPeriodIncome = (effectiveLeaveMonthlyIncome / 30) * effectiveCalendarDays + otherParentIncomeForPeriod;
  const dailyIncome = totalPeriodIncome / Math.max(1, effectiveCalendarDays);
  // dailyBenefit should only represent actual parental benefits (föräldrapenning + föräldralön)
  // For periods with benefitLevel 'none', there's no benefit, so dailyBenefit should be 0
  const dailyBenefit = benefitLevel === 'none' ? 0 : benefitMonthly / 30;

  periods.push({
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
  });

  // Track qualifying high days usage
  if (parent !== 'both' && (benefitLevel === 'high' || benefitLevel === 'parental-salary')) {
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

  periods.push({
    parent: 'both',
    startDate: new Date(baseStartDate),
    endDate: initialEndDate,
    daysCount: initialBenefitDaysUsed,
    benefitDaysUsed: initialBenefitDaysUsed,
    calendarDays: initialCalendarDays,
    dailyBenefit: averageBenefitPerBenefitDay,
    dailyIncome: averageCalendarDailyIncome,
    benefitLevel: 'high',
    daysPerWeek: estimatedDaysPerWeek,
    otherParentDailyIncome: 0,
    otherParentMonthlyIncome: 0,
    isInitialTenDayPeriod: true,
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
    const overlapBenefitMonthly =
      beräknaMånadsinkomst(toNumber(legacyResult.dag1), toNumber(legacyResult.plan1Overlap?.dagarPerVecka), 0, 0, 0) +
      beräknaMånadsinkomst(toNumber(legacyResult.dag2), toNumber(legacyResult.plan1Overlap?.dagarPerVecka), 0, 0, 0);

    addSegment(periods, {
      plan: legacyResult.plan1Overlap,
      parent: 'both',
      benefitLevel: legacyResult.extra1 > 0 || legacyResult.extra2 > 0 ? 'parental-salary' : 'high',
      otherParentMonthlyIncome: 0,
      usedDays: overlapDaysUsed,
      fallbackDaysPerWeek: resolveDaysPerWeek(legacyResult.plan1Overlap?.dagarPerVecka),
      benefitMonthly: overlapBenefitMonthly,
      leaveMonthlyIncome: overlapParent1Monthly + overlapParent2Monthly,
      preferredDaysPerWeek: undefined,
      forceRecomputeWeeks: false,
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
    addSegment(periods, {
      plan: legacyResult.plan1,
      parent: 'parent1',
      benefitLevel: legacyResult.extra1 > 0 ? 'parental-salary' : 'high',
      otherParentMonthlyIncome: context.parent2NetIncome,
      usedDays: plan1ExtraDays,
      fallbackDaysPerWeek: fallbackDays,
      benefitMonthly,
      leaveMonthlyIncome,
      preferredDaysPerWeek: undefined,
      forceRecomputeWeeks: false,
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
    addSegment(periods, {
      plan: legacyResult.plan2,
      parent: 'parent2',
      benefitLevel: legacyResult.extra2 > 0 ? 'parental-salary' : 'high',
      otherParentMonthlyIncome: context.parent1NetIncome,
      usedDays: plan2ExtraDays,
      fallbackDaysPerWeek: fallbackDays,
      benefitMonthly,
      leaveMonthlyIncome,
      preferredDaysPerWeek: undefined,
      forceRecomputeWeeks: false,
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
    }, segmentContext, parentData);
  }

  // No filler periods - we strictly adhere to the total months specified
  // The periods should end when we've reached the target total months

  // Merge consecutive periods with same parent and benefit level
  const mergedPeriods: LeavePeriod[] = [];
  for (const period of periods) {
    const last = mergedPeriods[mergedPeriods.length - 1];

    // Don't merge parental-salary with high, or initial periods with other periods
    const shouldNotMerge = 
      (last?.benefitLevel === 'parental-salary' && period.benefitLevel === 'high') ||
      (last?.benefitLevel === 'high' && period.benefitLevel === 'parental-salary') ||
      (last?.isInitialTenDayPeriod !== period.isInitialTenDayPeriod);

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
    const otherParentDailyIncome = parent === 'parent1'
      ? context.parent2NetIncome / 30
      : context.parent1NetIncome / 30;
    const ownDailyIncome = parent === 'parent1'
      ? context.parent1NetIncome / 30
      : context.parent2NetIncome / 30;

    mergedPeriods.push({
      parent,
      startDate,
      endDate,
      daysCount: effectiveDays,
      benefitDaysUsed: 0,
      calendarDays: Math.max(1, differenceInCalendarDays(endDate, startDate) + 1),
      dailyBenefit: 0,
      dailyIncome: ownDailyIncome + otherParentDailyIncome,
      benefitLevel: 'none',
      daysPerWeek: 0,
      otherParentDailyIncome,
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
    parent1CutoffDate
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
          
          const hasParentalSalary = mergedPeriods.some(p =>
            p.parent === owner &&
            p.benefitLevel === 'parental-salary' &&
            p.startDate <= monthEnd &&
            p.endDate >= monthStart
          );

          worstDeficit = deficit;
          worstMonth = {
            start: monthStart,
            end: monthEnd,
            owner,
            usedDaysPerWeek: Math.min(7, Math.max(0, Math.round(parentMaxDaysPerWeek[owner] || 0))),
            hasParentalSalary
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
      parent1CutoffDate
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

      addOption('high', ownerKey, ownerHighDaily, remainingHighDays[ownerKey]);
      addOption('high', alternateParent, ownerHighDaily, remainingHighDays[alternateParent]);

      if (!mustPrioritizeHighDays) {
        addOption('low', ownerKey, ownerLowDaily, remainingLowDays[ownerKey]);
        addOption('low', alternateParent, ownerLowDaily, remainingLowDays[alternateParent]);
      }

      if (!options.length) {
        return false;
      }

      options.sort((a, b) => {
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
        const availableFromSource = pool[option.source];
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

        const newPeriod: LeavePeriod = {
          parent: ownerKey,
          startDate: periodStart,
          endDate: periodEnd,
          daysCount: takeDays,
          benefitDaysUsed: takeDays,
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

  const totalIncome = mergedPeriods.reduce((sum, period) => {
    if (period.benefitLevel === 'none') return sum;
    const daysToCount = period.benefitDaysUsed ?? period.daysCount;
    return sum + period.dailyIncome * daysToCount;
  }, 0);
  
  // Calculate days used by benefit level
  const highBenefitDaysUsed = mergedPeriods.reduce((sum, period) => {
    if (period.benefitLevel === 'high' || period.benefitLevel === 'parental-salary') {
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

  const allowFullWeekForSave = normalizedDaysPerWeek > baseDaysPerWeek;
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
  const parent1HighDailyNet = calc1.parentalBenefitPerDay + calc1.parentalSalaryPerDay;
  const parent2HighDailyNet = calc2.parentalBenefitPerDay + calc2.parentalSalaryPerDay;

  const conversionContext: ConversionContext = {
    parent1,
    parent2,
    parent1NetIncome: calc1.netIncome,
    parent2NetIncome: calc2.netIncome,
    parent1LeaveDailyIncome: calc1.parentalBenefitPerDay + calc1.parentalSalaryPerDay,
    parent2LeaveDailyIncome: calc2.parentalBenefitPerDay + calc2.parentalSalaryPerDay,
    parent1MinDailyNet,
    parent2MinDailyNet,
    parent1HighDailyNet,
    parent2HighDailyNet,
    parent1LowTotalDays: dayAllocation.parent1LowDays,
    parent2LowTotalDays: dayAllocation.parent2LowDays,
    parent1HighTotalDays: dayAllocation.parent1IncomeDays,
    parent2HighTotalDays: dayAllocation.parent2IncomeDays,
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
  const savePreferences = buildPreferences(saveDaysMeta.legacyKey, minHouseholdIncome, allowFullWeekForSave);
  const saveLegacyResult = optimizeParentalLeave(savePreferences, legacyInputs);
  const saveResult = convertLegacyResult(saveDaysMeta, saveLegacyResult, conversionContext, { parent1, parent2 });

  const maximizeMeta = strategies.find((strategy) => strategy.key === 'maximize-income')!;
  const maximizeTargets = [
    Math.round(Math.max(minHouseholdIncome, calc1.netIncome + calc2.netIncome)),
    Math.round(calc1.availableIncome + calc2.availableIncome),
  ].filter((target) => Number.isFinite(target) && target > 0);

  const candidateStrategyKeys: LegacyStrategyKey[] = ['maximize_parental_salary', 'maximize'];
  const maximizeCandidates: OptimizationResult[] = [];

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
