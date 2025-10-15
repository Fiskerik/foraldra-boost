import { addDays, differenceInCalendarDays, endOfMonth, startOfDay, startOfMonth } from "date-fns";
import { LeavePeriod } from "./parentalCalculations";

export interface StrategyIncomeSummary {
  lowestFullMonthIncome: number | null;
  hasEligibleFullMonths: boolean;
}

interface MonthlySegment {
  startDate: Date;
  endDate: Date;
  calendarDays: number;
  benefitDays: number;
  benefitIncome: number;
  otherParentIncome: number;
  monthlyIncome: number;
}

interface AggregatedMonthInfo {
  totalIncome: number;
  totalCalendarDays: number;
  monthStart: Date;
  monthLength: number;
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
    });

    cursor = addDays(segmentEnd, 1);
  }

  if (segments.length === 0) {
    return [];
  }

  const totalCalendarDays = segments.reduce((sum, segment) => sum + segment.calendarDays, 0) || 1;
  let remainingBenefitDays = totalBenefitDays;
  let carryOver = 0;

  segments.forEach((segment, index) => {
    if (remainingBenefitDays <= 0) {
      segment.benefitDays = 0;
    } else {
      const weight = segment.calendarDays / totalCalendarDays;
      const rawShare = totalBenefitDays * weight + carryOver;
      let allocated = index === segments.length - 1 ? remainingBenefitDays : Math.floor(rawShare);

      if (allocated < 0) {
        allocated = 0;
      }

      if (allocated === 0 && remainingBenefitDays > 0 && index !== segments.length - 1) {
        allocated = 1;
      }

      if (allocated > remainingBenefitDays) {
        allocated = remainingBenefitDays;
      }

      segment.benefitDays = allocated;
      remainingBenefitDays -= allocated;
      carryOver = rawShare - allocated;
    }

    const benefitDaily = period.dailyBenefit;
    const monthStart = startOfMonth(segment.startDate);
    const monthEnd = endOfMonth(monthStart);
    const monthLength = Math.max(1, differenceInCalendarDays(monthEnd, monthStart) + 1);

    const monthlyBaseFromOther = period.parent === "both" ? 0 : period.otherParentMonthlyIncome || 0;
    const dailyBaseFromOther = period.parent === "both" ? 0 : period.otherParentDailyIncome || 0;
    const computedMonthlyBase = monthlyBaseFromOther > 0
      ? monthlyBaseFromOther
      : dailyBaseFromOther > 0
        ? dailyBaseFromOther * 30
        : 0;

    const isFullMonthSegment =
      segment.calendarDays >= monthLength &&
      segment.startDate.getDate() === 1 &&
      segment.endDate.getDate() === monthEnd.getDate();

    let otherParentIncome = 0;
    if (period.parent !== "both" && computedMonthlyBase > 0) {
      if (isFullMonthSegment) {
        otherParentIncome = monthlyBaseFromOther > 0 ? computedMonthlyBase : dailyBaseFromOther * 30;
      } else {
        otherParentIncome = monthlyBaseFromOther > 0
          ? computedMonthlyBase * (segment.calendarDays / monthLength)
          : dailyBaseFromOther * segment.calendarDays;
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
        });
        return;
      }

      existing.totalIncome += segment.monthlyIncome;
      existing.totalCalendarDays += segment.calendarDays;
      existing.monthLength = monthLength;
    });

  return map;
}

export function calculateStrategyIncomeSummary(periods: LeavePeriod[]): StrategyIncomeSummary {
  if (!Array.isArray(periods) || periods.length === 0) {
    return { lowestFullMonthIncome: null, hasEligibleFullMonths: false };
  }

  const aggregatedMonthMap = aggregateMonthlyTotals(periods);

  if (aggregatedMonthMap.size === 0) {
    return { lowestFullMonthIncome: null, hasEligibleFullMonths: false };
  }

  const eligibleEntries = Array.from(aggregatedMonthMap.entries()).filter(([, info]) =>
    info.totalCalendarDays >= info.monthLength
  );

  if (eligibleEntries.length === 0) {
    return { lowestFullMonthIncome: null, hasEligibleFullMonths: false };
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
    return { lowestFullMonthIncome: null, hasEligibleFullMonths: false };
  }

  const lowestInfo = aggregatedMonthMap.get(lowestKey);

  if (!lowestInfo || !Number.isFinite(lowestInfo.totalIncome)) {
    return { lowestFullMonthIncome: null, hasEligibleFullMonths: false };
  }

  return {
    lowestFullMonthIncome: lowestInfo.totalIncome,
    hasEligibleFullMonths: true,
  };
}
