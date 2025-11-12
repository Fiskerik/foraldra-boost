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
  bothParentDays: number;
}

export interface MonthlyBreakdownEntry {
  monthKey: string;
  monthStart: Date;
  monthLength: number;
  startDate: Date;
  endDate: Date;
  calendarDays: number;
  benefitDays: number;
  monthlyIncome: number;
  leaveParentIncome: number;
  otherParentIncome: number;
  benefitIncome: number;
  parentalSalaryIncome: number;
  daysPerWeekValues: number[];
  benefitLevels: Array<"parental-salary" | "high" | "low" | "none">;
  benefitDaysByLevel: Record<string, number>;
  parents: string[];
  parentDayTotals: Record<"parent1" | "parent2" | "both", number>;
  otherParentMonthlyBase: number;
}

interface MonthlySegment {
  startDate: Date;
  endDate: Date;
  calendarDays: number;
  benefitDays: number;
  monthlyIncome: number;
  leaveParentIncome: number;
  otherParentIncome: number;
  benefitIncome: number;
  parentalSalaryIncome: number;
  caEligibleCalendarDays: number;
  caEligibleBenefitDays: number;
  daysPerWeekValue: number;
  otherParentMonthlyBase: number;
  parent: "parent1" | "parent2" | "both";
}

interface AggregatedMonthInfo {
  totalIncome: number;
  totalCalendarDays: number;
  monthStart: Date;
  monthLength: number;
  exclusiveParent1Days: number;
  exclusiveParent2Days: number;
  bothParentDays: number;
}

type InternalMonthlyBreakdownEntry = MonthlyBreakdownEntry & {
  uniqueCalendarDays: Set<number>;
};

function addCalendarRangeToSet(target: Set<number>, start: Date, end: Date): void {
  let cursor = startOfDay(new Date(start));
  const last = startOfDay(new Date(end));

  while (cursor.getTime() <= last.getTime()) {
    target.add(cursor.getTime());
    cursor = startOfDay(addDays(cursor, 1));
  }
}

function breakDownPeriodByMonth(period: LeavePeriod): MonthlySegment[] {
  const periodStart = startOfDay(new Date(period.startDate));
  const periodEnd = startOfDay(new Date(period.endDate));

  if (periodEnd.getTime() < periodStart.getTime()) {
    return [];
  }

  const rawBenefitDays = Math.max(0, Math.round(period.benefitDaysUsed ?? period.daysCount));
  const totalBenefitDays = rawBenefitDays;

  const segments: MonthlySegment[] = [];
  let cursor = new Date(periodStart);
  const normalizedDaysPerWeek = period.daysPerWeek && period.daysPerWeek > 0 ? period.daysPerWeek : 7;

  while (cursor.getTime() <= periodEnd.getTime()) {
    const monthStart = startOfMonth(cursor);
    const monthEndCandidate = endOfMonth(monthStart);
    const segmentEnd = monthEndCandidate.getTime() < periodEnd.getTime() ? monthEndCandidate : periodEnd;
    const calendarDays = Math.max(1, differenceInCalendarDays(segmentEnd, cursor) + 1);

    segments.push({
      startDate: new Date(cursor),
      endDate: new Date(segmentEnd),
      calendarDays,
      benefitDays: 0,
      monthlyIncome: 0,
      leaveParentIncome: 0,
      otherParentIncome: 0,
      benefitIncome: 0,
      parentalSalaryIncome: 0,
      caEligibleCalendarDays: 0,
      caEligibleBenefitDays: 0,
      daysPerWeekValue: normalizedDaysPerWeek,
      otherParentMonthlyBase: period.parent === "both" ? 0 : period.otherParentMonthlyIncome || 0,
      parent: period.parent,
    });

    cursor = startOfDay(addDays(segmentEnd, 1));
  }

  if (segments.length === 0) {
    return [];
  }

  const totalCalendarDays = segments.reduce((sum, segment) => sum + segment.calendarDays, 0) || 1;

  if (segments.length === 1) {
    segments[0].benefitDays = Math.min(totalBenefitDays, segments[0].calendarDays);
  } else if (totalBenefitDays > 0) {
    const allocations = segments.map(segment => {
      const proportion = segment.calendarDays / totalCalendarDays;
      const rawAllocation = totalBenefitDays * proportion;
      const baseAllocation = Math.floor(rawAllocation);
      return {
        segment,
        baseAllocation,
        remainder: rawAllocation - baseAllocation,
      };
    });

    let allocated = 0;
    allocations.forEach(({ segment, baseAllocation }) => {
      const capped = Math.min(segment.calendarDays, baseAllocation);
      segment.benefitDays = capped;
      allocated += capped;
    });

    let remaining = Math.max(0, totalBenefitDays - allocated);

    if (remaining > 0) {
      const sorted = allocations.slice().sort((a, b) => b.remainder - a.remainder);
      for (const { segment } of sorted) {
        if (remaining <= 0) break;
        if (segment.benefitDays >= segment.calendarDays) continue;
        segment.benefitDays += 1;
        remaining -= 1;
      }
    }

    if (remaining > 0 && allocations.length > 0) {
      let index = 0;
      while (remaining > 0) {
        const target = allocations[index % allocations.length].segment;
        target.benefitDays += 1;
        remaining -= 1;
        index += 1;
      }
    }
  }

  const totalCACalendarDays = Math.max(0, period.collectiveAgreementEligibleCalendarDays ?? 0);
  const totalCABenefitDays = Math.max(0, period.collectiveAgreementEligibleBenefitDays ?? 0);
  const totalCABonus = Math.max(0, period.collectiveAgreementTotalBonus ?? 0);

  let remainingCACalendarDays = totalCACalendarDays;
  let remainingCABenefitDays = totalCABenefitDays;

  segments.forEach(segment => {
    if (remainingCACalendarDays <= 0) {
      segment.caEligibleCalendarDays = 0;
      segment.caEligibleBenefitDays = 0;
      return;
    }

    const caCalendar = Math.min(segment.calendarDays, remainingCACalendarDays);
    segment.caEligibleCalendarDays = caCalendar;
    remainingCACalendarDays -= caCalendar;

    if (caCalendar <= 0 || segment.benefitDays <= 0 || remainingCABenefitDays <= 0) {
      segment.caEligibleBenefitDays = 0;
      return;
    }

    const calendarFraction = segment.calendarDays > 0 ? caCalendar / segment.calendarDays : 0;
    const rawBenefit = segment.benefitDays * calendarFraction;
    const assignedBenefit = Math.min(rawBenefit, remainingCABenefitDays);
    segment.caEligibleBenefitDays = assignedBenefit;
    remainingCABenefitDays -= assignedBenefit;
  });

  if (remainingCABenefitDays > 1e-6) {
    const firstWithCA = segments.find(segment => segment.caEligibleCalendarDays > 0);
    if (firstWithCA) {
      firstWithCA.caEligibleBenefitDays += remainingCABenefitDays;
    }
  }

  const bonusPerBenefitDay = totalCABenefitDays > 0 ? totalCABonus / totalCABenefitDays : 0;

  segments.forEach(segment => {
    const benefitDaily = period.dailyBenefit;
    const monthStart = startOfMonth(segment.startDate);
    const monthEndDate = endOfMonth(monthStart);
    const monthLength = Math.max(1, differenceInCalendarDays(monthEndDate, monthStart) + 1);

    const isFullMonthSegment =
      segment.calendarDays >= monthLength &&
      segment.startDate.getDate() === 1 &&
      segment.endDate.getDate() === monthEndDate.getDate();

    if (period.parent === "both") {
      const baseDaily = period.baseDailyIncome ?? period.dailyIncome ?? 0;
      const totalIncome = Math.max(0, Math.round(baseDaily * segment.calendarDays));
      segment.benefitIncome = totalIncome;
      segment.leaveParentIncome = totalIncome;
      segment.otherParentIncome = 0;
      segment.parentalSalaryIncome = 0;
      segment.monthlyIncome = totalIncome;
      return;
    }

    let otherParentIncome = 0;
    if (period.otherParentMonthlyIncome) {
      if (isFullMonthSegment) {
        otherParentIncome = period.otherParentMonthlyIncome;
      } else {
        const proportion = segment.calendarDays / monthLength;
        otherParentIncome = period.otherParentMonthlyIncome * proportion;
      }
      otherParentIncome = Math.max(0, Math.round(otherParentIncome));
    }

    let benefitIncome = 0;
    if (benefitDaily > 0 && segment.benefitDays > 0) {
      const benefitDaysForMonth = isFullMonthSegment
        ? Math.min(segment.benefitDays, 30)
        : segment.benefitDays;
      benefitIncome = benefitDaily * Math.max(0, Math.round(benefitDaysForMonth));
    }
    benefitIncome = Math.max(0, Math.round(benefitIncome));

    let parentalSalaryIncome = 0;
    if (bonusPerBenefitDay > 0 && segment.caEligibleBenefitDays > 0) {
      parentalSalaryIncome = segment.caEligibleBenefitDays * bonusPerBenefitDay;
    }

    const leaveParentIncome = benefitIncome + parentalSalaryIncome;
    const monthlyIncome = leaveParentIncome + otherParentIncome;

    segment.benefitIncome = benefitIncome;
    segment.otherParentIncome = otherParentIncome;
    segment.parentalSalaryIncome = Math.max(0, Math.round(parentalSalaryIncome));
    segment.leaveParentIncome = Math.max(0, Math.round(leaveParentIncome));
    segment.monthlyIncome = Math.max(0, Math.round(monthlyIncome));
  });

  return segments;
}

export function buildMonthlyBreakdownEntries(periods: LeavePeriod[]): MonthlyBreakdownEntry[] {
  if (!Array.isArray(periods) || periods.length === 0) {
    return [];
  }

  const monthMap = new Map<string, InternalMonthlyBreakdownEntry>();

  periods.forEach(period => {
    breakDownPeriodByMonth(period).forEach(segment => {
      const monthStart = startOfMonth(new Date(segment.startDate));
      const key = `${monthStart.getFullYear()}-${monthStart.getMonth()}`;
      const monthLength = differenceInCalendarDays(endOfMonth(monthStart), monthStart) + 1;

      const parentLabel = period.parent === "parent1" ? "Parent 1" : period.parent === "parent2" ? "Parent 2" : "Båda";

      const getParentKey = (parent: typeof period.parent): keyof MonthlyBreakdownEntry["parentDayTotals"] => {
        if (parent === "parent1") return "parent1";
        if (parent === "parent2") return "parent2";
        return "both";
      };

      const existing = monthMap.get(key);

      if (!existing) {
        const initialBenefitLevels: Array<"parental-salary" | "high" | "low" | "none"> = [];
        const initialBenefitDaysByLevel: Record<string, number> = {};

        if (segment.benefitDays > 0) {
          initialBenefitLevels.push(period.benefitLevel);
          initialBenefitDaysByLevel[period.benefitLevel] = segment.benefitDays;
          if (segment.parentalSalaryIncome > 0 && segment.caEligibleBenefitDays > 0) {
            initialBenefitLevels.push("parental-salary");
            initialBenefitDaysByLevel["parental-salary"] = Math.max(0, Math.round(segment.caEligibleBenefitDays));
          }
        } else {
          initialBenefitLevels.push("none");
        }

        const uniqueCalendarDays = new Set<number>();
        addCalendarRangeToSet(uniqueCalendarDays, segment.startDate, segment.endDate);

        monthMap.set(key, {
          monthKey: key,
          monthStart,
          monthLength,
          startDate: new Date(segment.startDate),
          endDate: new Date(segment.endDate),
          calendarDays: uniqueCalendarDays.size,
          benefitDays: segment.benefitDays,
          monthlyIncome: segment.monthlyIncome,
          leaveParentIncome: segment.leaveParentIncome,
          otherParentIncome: segment.otherParentIncome,
          benefitIncome: segment.benefitIncome,
          parentalSalaryIncome: segment.parentalSalaryIncome,
          daysPerWeekValues: [segment.daysPerWeekValue],
          benefitLevels: initialBenefitLevels,
          benefitDaysByLevel: initialBenefitDaysByLevel,
          parents: [parentLabel],
          parentDayTotals: {
            parent1: period.parent === "parent1" ? segment.calendarDays : 0,
            parent2: period.parent === "parent2" ? segment.calendarDays : 0,
            both: period.parent === "both" ? segment.calendarDays : 0,
          },
          otherParentMonthlyBase: segment.otherParentMonthlyBase,
          uniqueCalendarDays,
        });
        return;
      }

      addCalendarRangeToSet(existing.uniqueCalendarDays, segment.startDate, segment.endDate);

      existing.startDate =
        existing.startDate.getTime() <= segment.startDate.getTime()
          ? existing.startDate
          : new Date(segment.startDate);
      existing.endDate =
        existing.endDate.getTime() >= segment.endDate.getTime()
          ? existing.endDate
          : new Date(segment.endDate);
      existing.calendarDays = existing.uniqueCalendarDays.size;
      existing.benefitDays += segment.benefitDays;
      existing.monthlyIncome += segment.monthlyIncome;
      existing.leaveParentIncome += segment.leaveParentIncome;
      existing.otherParentIncome += segment.otherParentIncome;
      existing.benefitIncome += segment.benefitIncome;
      existing.parentalSalaryIncome += segment.parentalSalaryIncome;
      existing.monthLength = monthLength;

      if (!existing.daysPerWeekValues.includes(segment.daysPerWeekValue)) {
        existing.daysPerWeekValues.push(segment.daysPerWeekValue);
      }

      if (segment.otherParentMonthlyBase > existing.otherParentMonthlyBase) {
        existing.otherParentMonthlyBase = segment.otherParentMonthlyBase;
      }

      const ensureLevel = (level: "parental-salary" | "high" | "low" | "none") => {
        if (!existing.benefitLevels.includes(level)) {
          existing.benefitLevels.push(level);
        }
      };

      if (segment.benefitDays > 0) {
        existing.benefitLevels = existing.benefitLevels.filter(level => level !== "none");
        ensureLevel(period.benefitLevel);
        if (!existing.benefitDaysByLevel[period.benefitLevel]) {
          existing.benefitDaysByLevel[period.benefitLevel] = 0;
        }
        existing.benefitDaysByLevel[period.benefitLevel] += segment.benefitDays;

        if (segment.parentalSalaryIncome > 0 && segment.caEligibleBenefitDays > 0) {
          ensureLevel("parental-salary");
          if (!existing.benefitDaysByLevel["parental-salary"]) {
            existing.benefitDaysByLevel["parental-salary"] = 0;
          }
          existing.benefitDaysByLevel["parental-salary"] += Math.max(0, Math.round(segment.caEligibleBenefitDays));
        }
      }

      const parentKey = getParentKey(period.parent);
      existing.parentDayTotals[parentKey] += segment.calendarDays;

      if (!existing.parents.includes(parentLabel)) {
        existing.parents.push(parentLabel);
      }
    });
  });

  return Array.from(monthMap.values())
    .map(({ uniqueCalendarDays, ...entry }) => ({
      ...entry,
      calendarDays: uniqueCalendarDays.size,
    }))
    .sort((a, b) => a.monthStart.getTime() - b.monthStart.getTime());
}

function aggregateMonthlyTotals(periods: LeavePeriod[]): Map<string, AggregatedMonthInfo> {
  const map = new Map<string, AggregatedMonthInfo>();

  buildMonthlyBreakdownEntries(periods).forEach(entry => {
    const monthStart = entry.monthStart;
    const key = entry.monthKey;

    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        totalIncome: entry.monthlyIncome,
        totalCalendarDays: entry.calendarDays,
        monthStart,
        monthLength: entry.monthLength,
        exclusiveParent1Days: entry.parentDayTotals.parent1,
        exclusiveParent2Days: entry.parentDayTotals.parent2,
        bothParentDays: entry.parentDayTotals.both,
      });
      return;
    }

    existing.totalIncome += entry.monthlyIncome;
    existing.totalCalendarDays += entry.calendarDays;
    existing.monthLength = entry.monthLength;
    existing.exclusiveParent1Days += entry.parentDayTotals.parent1;
    existing.exclusiveParent2Days += entry.parentDayTotals.parent2;
    existing.bothParentDays += entry.parentDayTotals.both;
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
      bothParentDays: info.bothParentDays,
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
