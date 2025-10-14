import { addDays, differenceInCalendarDays, endOfMonth, startOfDay, startOfMonth } from "date-fns";
import { LeavePeriod } from "./parentalCalculations";

export interface StrategyIncomeSummary {
  lowestFullMonthIncome: number | null;
  hasEligibleFullMonths: boolean;
}

export function calculateStrategyIncomeSummary(periods: LeavePeriod[]): StrategyIncomeSummary {
  if (!Array.isArray(periods) || periods.length === 0) {
    return { lowestFullMonthIncome: null, hasEligibleFullMonths: false };
  }

  const relevantPeriods = periods.filter(period =>
    period.benefitLevel !== "none" || period.isInitialTenDayPeriod || period.isPreferenceFiller
  );

  if (relevantPeriods.length === 0) {
    return { lowestFullMonthIncome: null, hasEligibleFullMonths: false };
  }

  const monthlyTotals = new Map<string, { totalIncome: number; calendarDays: number; monthLength: number }>();

  relevantPeriods.forEach(period => {
    const periodStart = startOfDay(new Date(period.startDate));
    const periodEnd = startOfDay(new Date(period.endDate));

    let segmentStart = new Date(periodStart);
    while (segmentStart.getTime() <= periodEnd.getTime()) {
      const monthStart = startOfMonth(segmentStart);
      const monthEnd = endOfMonth(monthStart);
      const segmentEnd = periodEnd.getTime() < monthEnd.getTime() ? periodEnd : monthEnd;
      const segmentDays = Math.max(1, differenceInCalendarDays(segmentEnd, segmentStart) + 1);
      const monthKey = `${monthStart.getFullYear()}-${monthStart.getMonth()}`;
      const monthLength = differenceInCalendarDays(monthEnd, monthStart) + 1;

      const existing = monthlyTotals.get(monthKey);
      if (existing) {
        existing.totalIncome += period.dailyIncome * segmentDays;
        existing.calendarDays += segmentDays;
        existing.monthLength = monthLength;
      } else {
        monthlyTotals.set(monthKey, {
          totalIncome: period.dailyIncome * segmentDays,
          calendarDays: segmentDays,
          monthLength,
        });
      }

      segmentStart = addDays(segmentEnd, 1);
    }
  });

  const eligibleEntries = Array.from(monthlyTotals.values()).filter(
    entry => entry.calendarDays >= entry.monthLength
  );

  if (eligibleEntries.length === 0) {
    return { lowestFullMonthIncome: null, hasEligibleFullMonths: false };
  }

  let lowestIncome = Infinity;
  eligibleEntries.forEach(entry => {
    if (entry.totalIncome < lowestIncome) {
      lowestIncome = entry.totalIncome;
    }
  });

  if (!Number.isFinite(lowestIncome)) {
    return { lowestFullMonthIncome: null, hasEligibleFullMonths: false };
  }

  return {
    lowestFullMonthIncome: lowestIncome,
    hasEligibleFullMonths: true,
  };
}
