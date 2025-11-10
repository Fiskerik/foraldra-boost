import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  eachMonthOfInterval,
  endOfMonth,
  startOfMonth,
} from "date-fns";

import { LeavePeriod } from "./parentalCalculations";

export interface TimelinePoint {
  monthDate: Date;
  labelStartDate: Date;
  labelEndDate: Date;
  income: number;
  parent1Days: number;
  parent2Days: number;
  bothDays: number;
  aggregatedSpan?: number;
  aggregationKind?: "average" | "minimum";
}

function computeLimitDate(base: Date, months: number): Date {
  const safeMonths = Math.max(0, months);
  const wholeMonths = Math.floor(safeMonths);
  const fractional = safeMonths - wholeMonths;
  let limit = addMonths(base, wholeMonths);
  if (fractional > 0) {
    limit = addDays(limit, Math.round(fractional * 30));
  }
  return limit;
}

function calculateWorkingParentIncome(
  period: LeavePeriod,
  daysInOverlap: number,
  monthStart: Date,
  monthEnd: Date
): number {
  if (period.parent === "both") {
    return 0;
  }

  const workingParentMonthlyIncome = period.otherParentMonthlyIncome || 0;
  if (workingParentMonthlyIncome <= 0) {
    return 0;
  }

  const monthLength = Math.max(1, differenceInCalendarDays(monthEnd, monthStart) + 1);
  const proportion = daysInOverlap / monthLength;
  return workingParentMonthlyIncome * proportion;
}

function calculateBenefitIncome(period: LeavePeriod, daysInOverlap: number): number {
  if (period.parent === "both") {
    return (period.dailyIncome || 0) * daysInOverlap;
  }

  const benefitDaily = period.dailyBenefit || 0;
  if (benefitDaily <= 0) {
    return 0;
  }

  const expectedBenefitDaysPerDay = (period.daysPerWeek || 7) / 7;
  const benefitDays = Math.round(daysInOverlap * expectedBenefitDaysPerDay);
  return benefitDaily * benefitDays;
}

export function computeTimelineMonthlyData(
  periods: LeavePeriod[],
  monthsLimit?: number | null
): TimelinePoint[] {
  if (!periods.length) {
    return [];
  }

  const sortedPeriods = [...periods].sort(
    (a, b) => a.startDate.getTime() - b.startDate.getTime()
  );

  const startDate = startOfMonth(sortedPeriods[0].startDate);
  const rawEndDate = sortedPeriods[sortedPeriods.length - 1].endDate;

  let chartEndDate = rawEndDate;
  if (monthsLimit && monthsLimit > 0) {
    const limitCandidate = computeLimitDate(startDate, monthsLimit);
    if (limitCandidate.getTime() > chartEndDate.getTime()) {
      chartEndDate = limitCandidate;
    }
  }

  if (chartEndDate.getTime() < startDate.getTime()) {
    chartEndDate = startDate;
  }

  const months = eachMonthOfInterval({ start: startDate, end: chartEndDate });

  return months.map((month) => {
    const monthStart = startOfMonth(month);
    const rawMonthEnd = endOfMonth(monthStart);
    const monthEnd = rawMonthEnd.getTime() > chartEndDate.getTime() ? chartEndDate : rawMonthEnd;

    let totalIncome = 0;
    let parent1Days = 0;
    let parent2Days = 0;
    let bothDays = 0;

    sortedPeriods.forEach((period) => {
      if (period.startDate.getTime() > chartEndDate.getTime()) {
        return;
      }

      const boundedEnd =
        period.endDate.getTime() > chartEndDate.getTime() ? chartEndDate : period.endDate;
      const overlapStart = period.startDate > monthStart ? period.startDate : monthStart;
      const overlapEnd = boundedEnd < monthEnd ? boundedEnd : monthEnd;
      const hasOverlap = overlapStart <= overlapEnd;
      if (!hasOverlap) {
        return;
      }

      const daysInOverlap = differenceInCalendarDays(overlapEnd, overlapStart) + 1;

      const workingIncome = calculateWorkingParentIncome(
        period,
        daysInOverlap,
        monthStart,
        monthEnd
      );
      const benefitIncome = calculateBenefitIncome(period, daysInOverlap);
      totalIncome += workingIncome + benefitIncome;

      if (period.parent === "parent1" && period.benefitLevel !== "none") {
        parent1Days += daysInOverlap;
      } else if (period.parent === "parent2" && period.benefitLevel !== "none") {
        parent2Days += daysInOverlap;
      } else if (period.parent === "both") {
        bothDays += daysInOverlap;
      }
    });

    return {
      monthDate: monthStart,
      labelStartDate: monthStart,
      labelEndDate: monthEnd,
      income: totalIncome,
      parent1Days,
      parent2Days,
      bothDays,
    } satisfies TimelinePoint;
  });
}

export function condenseTimelinePoints(
  points: TimelinePoint[],
  maxDesktopPoints: number = 15
): TimelinePoint[] {
  if (points.length <= maxDesktopPoints) {
    return points;
  }

  const aggregated: TimelinePoint[] = [];
  for (let index = 0; index < points.length; index += 2) {
    const slice = points.slice(index, index + 2);
    if (slice.length === 0) {
      continue;
    }

    const totalIncome = slice.reduce((sum, item) => sum + item.income, 0);
    const totalParent1Days = slice.reduce((sum, item) => sum + item.parent1Days, 0);
    const totalParent2Days = slice.reduce((sum, item) => sum + item.parent2Days, 0);
    const totalBothDays = slice.reduce((sum, item) => sum + item.bothDays, 0);
    const aggregatedSpan = slice.reduce(
      (sum, item) => sum + (item.aggregatedSpan ?? 1),
      0
    );

    aggregated.push({
      monthDate: slice[0].monthDate,
      labelStartDate: slice[0].labelStartDate,
      labelEndDate: slice[slice.length - 1].labelEndDate,
      income: totalIncome / slice.length,
      parent1Days: totalParent1Days,
      parent2Days: totalParent2Days,
      bothDays: totalBothDays,
      aggregatedSpan,
      aggregationKind: "average",
    });
  }

  return aggregated;
}

export function aggregateForMobile(
  points: TimelinePoint[],
  maxPoints: number = 8
): TimelinePoint[] {
  if (points.length <= maxPoints) {
    return points;
  }

  const groupSize = Math.ceil(points.length / maxPoints);
  const aggregated: TimelinePoint[] = [];

  for (let index = 0; index < points.length; index += groupSize) {
    const slice = points.slice(index, index + groupSize);
    if (slice.length === 0) {
      continue;
    }

    const totalIncome = slice.reduce((sum, item) => sum + item.income, 0);
    const totalParent1Days = slice.reduce((sum, item) => sum + item.parent1Days, 0);
    const totalParent2Days = slice.reduce((sum, item) => sum + item.parent2Days, 0);
    const totalBothDays = slice.reduce((sum, item) => sum + item.bothDays, 0);
    const aggregatedSpan = slice.reduce(
      (sum, item) => sum + (item.aggregatedSpan ?? 1),
      0
    );

    aggregated.push({
      monthDate: slice[0].monthDate,
      labelStartDate: slice[0].labelStartDate,
      labelEndDate: slice[slice.length - 1].labelEndDate,
      income: totalIncome / slice.length,
      parent1Days: totalParent1Days,
      parent2Days: totalParent2Days,
      bothDays: totalBothDays,
      aggregatedSpan,
      aggregationKind: "average",
    });
  }

  return aggregated;
}
