import {
  addDays,
  addMonths,
  eachMonthOfInterval,
  endOfMonth,
  startOfMonth,
} from "date-fns";

import { LeavePeriod } from "./parentalCalculations";
import { buildMonthlyBreakdownEntries } from "./incomeSummary";

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

  const monthlyBreakdownEntries = buildMonthlyBreakdownEntries(sortedPeriods);
  const breakdownByKey = new Map(
    monthlyBreakdownEntries.map(entry => [entry.monthKey, entry])
  );

  const months = eachMonthOfInterval({ start: startDate, end: chartEndDate });

  return months.map(month => {
    const monthStart = startOfMonth(month);
    const rawMonthEnd = endOfMonth(monthStart);
    const monthEnd = rawMonthEnd.getTime() > chartEndDate.getTime() ? chartEndDate : rawMonthEnd;
    const key = `${monthStart.getFullYear()}-${monthStart.getMonth()}`;
    const breakdown = breakdownByKey.get(key);

    return {
      monthDate: monthStart,
      labelStartDate: breakdown ? breakdown.startDate : monthStart,
      labelEndDate: breakdown ? breakdown.endDate : monthEnd,
      income: breakdown ? breakdown.monthlyIncome : 0,
      parent1Days: breakdown ? breakdown.parentDayTotals.parent1 : 0,
      parent2Days: breakdown ? breakdown.parentDayTotals.parent2 : 0,
      bothDays: breakdown ? breakdown.parentDayTotals.both : 0,
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
