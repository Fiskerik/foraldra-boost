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

  // Include all periods for income calculation
  const relevantPeriods = periods;

  if (relevantPeriods.length === 0) {
    return { lowestFullMonthIncome: null, hasEligibleFullMonths: false };
  }

  const monthlyTotals = new Map<string, { totalIncome: number; coveredDays: Set<string>; monthLength: number }>();

  relevantPeriods.forEach(period => {
    const periodStart = startOfDay(new Date(period.startDate));
    const periodEnd = startOfDay(new Date(period.endDate));

    // Iterate through each day in the period
    let currentDay = new Date(periodStart);
    while (currentDay.getTime() <= periodEnd.getTime()) {
      const monthStart = startOfMonth(currentDay);
      const monthKey = `${monthStart.getFullYear()}-${monthStart.getMonth()}`;
      const monthEnd = endOfMonth(monthStart);
      const monthLength = differenceInCalendarDays(monthEnd, monthStart) + 1;
      const dayKey = `${currentDay.getFullYear()}-${currentDay.getMonth()}-${currentDay.getDate()}`;

      const existing = monthlyTotals.get(monthKey);
      if (existing) {
        // Only count each day once, even if multiple periods cover it
        if (!existing.coveredDays.has(dayKey)) {
          existing.totalIncome += period.dailyIncome;
          existing.coveredDays.add(dayKey);
        }
        existing.monthLength = monthLength;
      } else {
        const coveredDays = new Set<string>();
        coveredDays.add(dayKey);
        monthlyTotals.set(monthKey, {
          totalIncome: period.dailyIncome,
          coveredDays,
          monthLength,
        });
      }

      currentDay = addDays(currentDay, 1);
    }
  });

  // Filter for months that are fully covered
  const eligibleEntries = Array.from(monthlyTotals.values()).filter(
    entry => entry.coveredDays.size >= entry.monthLength
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
