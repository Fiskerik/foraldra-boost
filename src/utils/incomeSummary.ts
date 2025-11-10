import { addDays, differenceInCalendarDays, endOfMonth, format, startOfDay, startOfMonth } from "date-fns";
import { sv } from "date-fns/locale";
import { LeavePeriod } from "./parentalCalculations";

export interface StrategyIncomeSummary {
  lowestFullMonthIncome: number | null;
  hasEligibleFullMonths: boolean;
  lowestFullMonthLabel: string | null;
  lowestFullMonthStart: Date | null;
}

export interface MonthlyIncomeTotals {
  monthStart: Date;
  monthLength: number;
  totalIncome: number;
  totalCalendarDays: number;
  exclusiveParent1Days: number;
  exclusiveParent2Days: number;
}

interface MonthlySegment {
  startDate: Date;
  endDate: Date;
  calendarDays: number;
  benefitDays: number;
  benefitIncome: number;
  otherParentIncome: number;
  monthlyIncome: number;
  parent: "parent1" | "parent2" | "both";
}

interface AggregatedMonthInfo {
  totalIncome: number;
  totalCalendarDays: number;
  monthStart: Date;
  monthLength: number;
  exclusiveParent1Days: number;
  exclusiveParent2Days: number;
}

function breakDownPeriodByMonth(period: LeavePeriod): MonthlySegment[] {
  const periodStart = startOfDay(new Date(period.startDate));
  const periodEnd = startOfDay(new Date(period.endDate));

  if (periodEnd.getTime() < periodStart.getTime()) {
    return [];
  }

  const rawBenefitDays = Math.max(0, Math.round(period.benefitDaysUsed ?? period.daysCount));
  const totalBenefitDays = period.benefitLevel === "none" ? 0 : rawBenefitDays;

  const segments: MonthlySegment[] = [];
  let cursor = new Date(periodStart);

  while (cursor.getTime() <= periodEnd.getTime()) {
    const segmentStart = new Date(cursor);
    const monthStart = startOfMonth(segmentStart);
    const monthEnd = endOfMonth(monthStart);
    const segmentEnd = monthEnd.getTime() < periodEnd.getTime() ? monthEnd : periodEnd;
    const calendarDays = Math.max(1, differenceInCalendarDays(segmentEnd, segmentStart) + 1);

    segments.push({
      startDate: segmentStart,
      endDate: new Date(segmentEnd),
      calendarDays,
      benefitDays: 0,
      benefitIncome: 0,
      otherParentIncome: 0,
      monthlyIncome: 0,
      parent: period.parent,
    });

    cursor = addDays(segmentEnd, 1);
  }

  if (segments.length === 0) {
    return [];
  }

  const daysPerWeek = period.daysPerWeek && period.daysPerWeek > 0 ? period.daysPerWeek : 7;
  const expectedBenefitDaysPerMonth = daysPerWeek * 4.33;

  const totalCalendarDays = segments.reduce((sum, segment) => sum + segment.calendarDays, 0) || 1;
  let remainingBenefitDays = totalBenefitDays;

  segments.forEach(segment => {
    if (remainingBenefitDays <= 0) {
      segment.benefitDays = 0;
    } else {
      const monthStart = startOfMonth(segment.startDate);
      const monthEnd = endOfMonth(monthStart);
      const monthLength = Math.max(1, differenceInCalendarDays(monthEnd, monthStart) + 1);
      const isFullMonth = segment.calendarDays >= monthLength;
      
      let allocated: number;
      if (isFullMonth) {
        // Full month: use expectedBenefitDaysPerMonth (max 30)
        allocated = Math.min(
          Math.round(expectedBenefitDaysPerMonth),
          30,
          remainingBenefitDays
        );
      } else {
        // Partial month: proportional based on how much of the month it is
        const proportion = segment.calendarDays / monthLength;
        allocated = Math.min(
          Math.round(expectedBenefitDaysPerMonth * proportion),
          remainingBenefitDays
        );
      }
      
      segment.benefitDays = Math.max(0, allocated);
      remainingBenefitDays -= segment.benefitDays;
    }

    const benefitDaily = period.dailyBenefit;
    const monthStart = startOfMonth(segment.startDate);
    const monthEnd = endOfMonth(monthStart);
    const monthLength = Math.max(1, differenceInCalendarDays(monthEnd, monthStart) + 1);

    const monthlyBaseFromOther = period.parent === "both" ? 0 : period.otherParentMonthlyIncome || 0;
    const dailyBaseFromOther = period.parent === "both" ? 0 : period.otherParentDailyIncome || 0;

    const isFullMonthSegment =
      segment.calendarDays >= monthLength &&
      segment.startDate.getDate() === 1 &&
      segment.endDate.getDate() === monthEnd.getDate();

    let otherParentIncome = 0;
    if (period.parent !== "both") {
      if (dailyBaseFromOther > 0) {
        otherParentIncome = dailyBaseFromOther * segment.calendarDays;
      } else if (monthlyBaseFromOther > 0) {
        const share = isFullMonthSegment ? 1 : segment.calendarDays / totalCalendarDays;
        otherParentIncome = monthlyBaseFromOther * share;
      }
    }

    let benefitIncome = 0;
    if (benefitDaily > 0 && segment.benefitDays > 0) {
      const benefitDaysForMonth = isFullMonthSegment
        ? Math.min(segment.benefitDays, 30)
        : segment.benefitDays;
      benefitIncome = benefitDaily * Math.max(0, Math.round(benefitDaysForMonth));
    }

    segment.otherParentIncome = otherParentIncome;
    segment.benefitIncome = benefitIncome;
    segment.monthlyIncome = otherParentIncome + benefitIncome;
  });

  return segments;
}

function aggregateMonthlyTotals(periods: LeavePeriod[]): Map<string, AggregatedMonthInfo> {
  const map = new Map<string, AggregatedMonthInfo>();

  periods
    .flatMap(breakDownPeriodByMonth)
    .forEach(segment => {
      const monthStart = startOfMonth(segment.startDate);
      const key = `${monthStart.getFullYear()}-${monthStart.getMonth()}`;
      const monthLength = differenceInCalendarDays(endOfMonth(monthStart), monthStart) + 1;

      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          totalIncome: segment.monthlyIncome,
          totalCalendarDays: segment.calendarDays,
          monthStart,
          monthLength,
          exclusiveParent1Days: segment.parent === "parent1" ? segment.calendarDays : 0,
          exclusiveParent2Days: segment.parent === "parent2" ? segment.calendarDays : 0,
        });
        return;
      }

      existing.totalIncome += segment.monthlyIncome;
      existing.totalCalendarDays += segment.calendarDays;
      existing.monthLength = monthLength;
      if (segment.parent === "parent1") {
        existing.exclusiveParent1Days += segment.calendarDays;
      } else if (segment.parent === "parent2") {
        existing.exclusiveParent2Days += segment.calendarDays;
      }
    });

  return map;
}

export function getMonthlyIncomeTotals(periods: LeavePeriod[]): MonthlyIncomeTotals[] {
  const aggregatedMonthMap = aggregateMonthlyTotals(periods);

  return Array.from(aggregatedMonthMap.values())
    .map((info) => ({
      monthStart: new Date(info.monthStart),
      monthLength: info.monthLength,
      totalIncome: info.totalIncome,
      totalCalendarDays: info.totalCalendarDays,
      exclusiveParent1Days: info.exclusiveParent1Days,
      exclusiveParent2Days: info.exclusiveParent2Days,
    }))
    .sort((a, b) => a.monthStart.getTime() - b.monthStart.getTime());
}

export function calculateStrategyIncomeSummary(periods: LeavePeriod[]): StrategyIncomeSummary {
  if (!Array.isArray(periods) || periods.length === 0) {
    return {
      lowestFullMonthIncome: null,
      hasEligibleFullMonths: false,
      lowestFullMonthLabel: null,
      lowestFullMonthStart: null,
    };
  }

  const aggregatedMonthMap = aggregateMonthlyTotals(periods);

  if (aggregatedMonthMap.size === 0) {
    return {
      lowestFullMonthIncome: null,
      hasEligibleFullMonths: false,
      lowestFullMonthLabel: null,
      lowestFullMonthStart: null,
    };
  }

  const eligibleEntries = Array.from(aggregatedMonthMap.entries()).filter(([, info]) =>
    info.totalCalendarDays >= info.monthLength &&
    !(info.exclusiveParent1Days > 0 && info.exclusiveParent2Days > 0)
  );

  if (eligibleEntries.length === 0) {
    return {
      lowestFullMonthIncome: null,
      hasEligibleFullMonths: false,
      lowestFullMonthLabel: null,
      lowestFullMonthStart: null,
    };
  }

  let lowestKey: string | null = null;
  let lowestIncome = Infinity;

  eligibleEntries.forEach(([key, info]) => {
    if (info.totalIncome < lowestIncome - 0.5) {
      lowestIncome = info.totalIncome;
      lowestKey = key;
      return;
    }

    if (Math.abs(info.totalIncome - lowestIncome) <= 0.5 && lowestKey) {
      const currentBest = aggregatedMonthMap.get(lowestKey);
      if (!currentBest || info.monthStart.getTime() < currentBest.monthStart.getTime()) {
        lowestIncome = info.totalIncome;
        lowestKey = key;
      }
    }
  });

  if (!lowestKey) {
    return {
      lowestFullMonthIncome: null,
      hasEligibleFullMonths: false,
      lowestFullMonthLabel: null,
      lowestFullMonthStart: null,
    };
  }

  const lowestInfo = aggregatedMonthMap.get(lowestKey);

  if (!lowestInfo || !Number.isFinite(lowestInfo.totalIncome)) {
    return {
      lowestFullMonthIncome: null,
      hasEligibleFullMonths: false,
      lowestFullMonthLabel: null,
      lowestFullMonthStart: null,
    };
  }

  return {
    lowestFullMonthIncome: lowestInfo.totalIncome,
    hasEligibleFullMonths: true,
    lowestFullMonthLabel: format(lowestInfo.monthStart, "MMMM yyyy", { locale: sv }),
    lowestFullMonthStart: lowestInfo.monthStart,
  };
}
