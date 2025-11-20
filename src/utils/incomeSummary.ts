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
  parentLeaveIncomeByParent: Record<"parent1" | "parent2", number>;
  parentBenefitIncomeByParent: Record<"parent1" | "parent2", number>;
  parentParentalSalaryIncomeByParent: Record<"parent1" | "parent2", number>;
  parentBenefitDaysByParent: Record<"parent1" | "parent2", number>;
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
  parentLeaveIncomeByParent: Record<"parent1" | "parent2", number>;
  parentBenefitIncomeByParent: Record<"parent1" | "parent2", number>;
  parentParentalSalaryIncomeByParent: Record<"parent1" | "parent2", number>;
  parentBenefitDaysByParent: Record<"parent1" | "parent2", number>;
  caEligibleCalendarDays: number;
  caEligibleBenefitDays: number;
  daysPerWeekValue: number;
  otherParentMonthlyBase: number;
  parent: "parent1" | "parent2" | "both";
  highBenefitDays: number;
  lowBenefitDays: number;
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
  parentDaySets: Record<'parent1' | 'parent2' | 'both', Set<number>>;
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

  const fallbackBenefitDays = Math.max(0, Math.round(period.benefitDaysUsed ?? period.daysCount));
  let highBenefitDays = Math.max(
    0,
    Math.round(
      period.highBenefitDaysUsed ?? (period.benefitLevel === "high" ? fallbackBenefitDays : 0)
    )
  );
  let lowBenefitDays = Math.max(
    0,
    Math.round(
      period.lowBenefitDaysUsed ?? (period.benefitLevel === "low" ? fallbackBenefitDays : 0)
    )
  );
  let totalBenefitDays = highBenefitDays + lowBenefitDays;
  if (totalBenefitDays <= 0 && fallbackBenefitDays > 0) {
    totalBenefitDays = fallbackBenefitDays;
    if (period.benefitLevel === "high") {
      highBenefitDays = fallbackBenefitDays;
      lowBenefitDays = 0;
    } else if (period.benefitLevel === "low") {
      lowBenefitDays = fallbackBenefitDays;
      highBenefitDays = 0;
    }
  }

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
      parentLeaveIncomeByParent: { parent1: 0, parent2: 0 },
      parentBenefitIncomeByParent: { parent1: 0, parent2: 0 },
      parentParentalSalaryIncomeByParent: { parent1: 0, parent2: 0 },
      parentBenefitDaysByParent: { parent1: 0, parent2: 0 },
      caEligibleCalendarDays: 0,
      caEligibleBenefitDays: 0,
      daysPerWeekValue: normalizedDaysPerWeek,
      otherParentMonthlyBase: period.parent === "both" ? 0 : period.otherParentMonthlyIncome || 0,
      parent: period.parent,
      highBenefitDays: 0,
      lowBenefitDays: 0,
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

  if (totalBenefitDays > 0) {
    const totalAllocated = segments.reduce((sum, seg) => sum + seg.benefitDays, 0) || 1;
    let remainingHigh = highBenefitDays;
    let remainingLow = lowBenefitDays;

    // Allocate high benefit days proportionally
    for (let idx = 0; idx < segments.length; idx++) {
      const segment = segments[idx];
      if (segment.benefitDays <= 0) {
        segment.highBenefitDays = 0;
        segment.lowBenefitDays = 0;
        continue;
      }

      const proportion = segment.benefitDays / totalAllocated;
      let highAlloc = Math.min(
        remainingHigh,
        Math.round(highBenefitDays * proportion),
        segment.benefitDays
      );
      if (idx === segments.length - 1) {
        highAlloc = Math.min(segment.benefitDays, remainingHigh);
      }
      segment.highBenefitDays = highAlloc;
      remainingHigh -= highAlloc;
    }

    // Distribute any remaining high benefit days
    if (remainingHigh > 0) {
      for (let idx = 0; idx < segments.length; idx++) {
        if (remainingHigh <= 0) break;
        const segment = segments[idx];
        const capacity = segment.benefitDays - segment.highBenefitDays;
        if (capacity <= 0) continue;
        const add = Math.min(capacity, remainingHigh);
        segment.highBenefitDays += add;
        remainingHigh -= add;
      }
    }

    // Allocate low benefit days proportionally
    for (let idx = 0; idx < segments.length; idx++) {
      const segment = segments[idx];
      const capacity = Math.max(0, segment.benefitDays - segment.highBenefitDays);
      if (capacity <= 0 || remainingLow <= 0) {
        segment.lowBenefitDays = 0;
        continue;
      }
      const proportion = segment.benefitDays / totalAllocated;
      let lowAlloc = Math.min(
        remainingLow,
        Math.round(lowBenefitDays * proportion),
        capacity
      );
      if (idx === segments.length - 1) {
        lowAlloc = Math.min(capacity, remainingLow);
      }
      segment.lowBenefitDays = lowAlloc;
      remainingLow -= lowAlloc;
    }

    // Distribute any remaining low benefit days
    if (remainingLow > 0) {
      for (let idx = 0; idx < segments.length; idx++) {
        if (remainingLow <= 0) break;
        const segment = segments[idx];
        const capacity = Math.max(0, segment.benefitDays - segment.highBenefitDays - segment.lowBenefitDays);
        if (capacity <= 0) continue;
        const add = Math.min(capacity, remainingLow);
        segment.lowBenefitDays += add;
        remainingLow -= add;
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
    // CRITICAL: Cap CA eligible benefit days at actual benefit days used
    segment.caEligibleBenefitDays = Math.min(segment.benefitDays, assignedBenefit);
    remainingCABenefitDays -= segment.caEligibleBenefitDays;
  });

  if (remainingCABenefitDays > 1e-6) {
    const firstWithCA = segments.find(segment => segment.caEligibleCalendarDays > 0);
    if (firstWithCA) {
      firstWithCA.caEligibleBenefitDays += remainingCABenefitDays;
    }
  }

  const bonusPerBenefitDay = totalCABenefitDays > 0 ? totalCABonus / totalCABenefitDays : 0;

  const sanitize = (value: unknown, fallback: number = 0): number => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    return fallback;
  };

  const benefitDaily = period.dailyBenefit;

  const baseMonthlyIncome = sanitize(period.monthlyIncome);
  const totalParent1Income = sanitize(
    period.parent1Income,
    baseMonthlyIncome > 0 ? baseMonthlyIncome / 2 : 0
  );
  const totalParent2Income = sanitize(
    period.parent2Income,
    Math.max(0, baseMonthlyIncome - totalParent1Income)
  );

  const totalParent1ParentalSalary = sanitize(
    period.parent1ParentalSalary,
    Math.max(0, totalParent1Income - sanitize(period.parent1BenefitIncome, totalParent1Income))
  );
  const totalParent2ParentalSalary = sanitize(
    period.parent2ParentalSalary,
    Math.max(0, totalParent2Income - sanitize(period.parent2BenefitIncome, totalParent2Income))
  );

  const totalParent1BenefitIncome = sanitize(
    period.parent1BenefitIncome,
    Math.max(0, totalParent1Income - totalParent1ParentalSalary)
  );
  const totalParent2BenefitIncome = sanitize(
    period.parent2BenefitIncome,
    Math.max(0, totalParent2Income - totalParent2ParentalSalary)
  );

  const totalParent1BenefitDays = sanitize(
    period.parent1BenefitDays,
    Math.max(0, sanitize(period.benefitDaysUsed, period.daysCount) / 2)
  );
  const totalParent2BenefitDays = sanitize(
    period.parent2BenefitDays,
    Math.max(0, sanitize(period.benefitDaysUsed, period.daysCount) / 2)
  );

  const totalSegmentCalendarDays = segments.reduce((sum, segment) => sum + segment.calendarDays, 0) || 1;
  const totalOtherParentIncome = Math.max(
    0,
    sanitize(period.otherParentIncomeForPeriod, period.otherParentMonthlyIncome)
  );
  const totalSegmentBenefitDays = segments.reduce((sum, segment) => sum + segment.benefitDays, 0);

  const totalCombinedBenefitDays = segments.reduce((sum, s) => sum + s.benefitDays, 0);

  segments.forEach(segment => {
    const monthStart = startOfMonth(segment.startDate);
    const monthEndDate = endOfMonth(monthStart);
    const monthLength = Math.max(1, differenceInCalendarDays(monthEndDate, monthStart) + 1);

    const isFullMonthSegment =
      segment.calendarDays >= monthLength &&
      segment.startDate.getDate() === 1 &&
      segment.endDate.getDate() === monthEndDate.getDate();

    if (period.parent === "both") {
      const effectiveTotalBenefitDays = totalCombinedBenefitDays > 0 ? totalCombinedBenefitDays : segments.length;
      const benefitShare = effectiveTotalBenefitDays > 0
        ? segment.benefitDays / effectiveTotalBenefitDays
        : 1 / Math.max(1, segments.length);

      const parent1BenefitIncome = totalParent1BenefitIncome * benefitShare;
      const parent2BenefitIncome = totalParent2BenefitIncome * benefitShare;
      const parent1ParentalSalary = totalParent1ParentalSalary * benefitShare;
      const parent2ParentalSalary = totalParent2ParentalSalary * benefitShare;
      const parent1TotalIncome = parent1BenefitIncome + parent1ParentalSalary;
      const parent2TotalIncome = parent2BenefitIncome + parent2ParentalSalary;

      const parent1BenefitDays = totalParent1BenefitDays * benefitShare;
      const parent2BenefitDays = totalParent2BenefitDays * benefitShare;

      segment.benefitIncome = parent1BenefitIncome + parent2BenefitIncome;
      segment.parentalSalaryIncome = parent1ParentalSalary + parent2ParentalSalary;
      segment.leaveParentIncome = parent1TotalIncome + parent2TotalIncome;
      segment.otherParentIncome = 0;
      segment.monthlyIncome = segment.leaveParentIncome;

      segment.parentLeaveIncomeByParent.parent1 = parent1TotalIncome;
      segment.parentLeaveIncomeByParent.parent2 = parent2TotalIncome;
      segment.parentBenefitIncomeByParent.parent1 = parent1BenefitIncome;
      segment.parentBenefitIncomeByParent.parent2 = parent2BenefitIncome;
      segment.parentParentalSalaryIncomeByParent.parent1 = parent1ParentalSalary;
      segment.parentParentalSalaryIncomeByParent.parent2 = parent2ParentalSalary;
      segment.parentBenefitDaysByParent.parent1 = parent1BenefitDays;
      segment.parentBenefitDaysByParent.parent2 = parent2BenefitDays;
      return;
    }

    const calendarShare = totalSegmentCalendarDays > 0 ? segment.calendarDays / totalSegmentCalendarDays : 0;
    const otherParentIncome = Math.max(0, Math.round(totalOtherParentIncome * calendarShare));

    let segmentBenefitIncome = 0;
    if (benefitDaily > 0 && segment.benefitDays > 0) {
      const benefitDaysForMonth = isFullMonthSegment
        ? Math.min(segment.benefitDays, 31)
        : segment.benefitDays;
      segmentBenefitIncome = benefitDaily * Math.max(0, Math.round(benefitDaysForMonth));
    }
    segmentBenefitIncome = Math.max(0, Math.round(segmentBenefitIncome));

    let segmentParentalSalaryIncome = 0;
    if (bonusPerBenefitDay > 0 && segment.caEligibleBenefitDays > 0) {
      segmentParentalSalaryIncome = segment.caEligibleBenefitDays * bonusPerBenefitDay;
    }
    if (segmentParentalSalaryIncome <= 0 && totalCABonus > 0) {
      const calendarShare = totalSegmentCalendarDays > 0 ? segment.calendarDays / totalSegmentCalendarDays : 0;
      if (calendarShare > 0) {
        segmentParentalSalaryIncome = totalCABonus * calendarShare;
      }
    }

    const leaveParentIncome = segmentBenefitIncome + segmentParentalSalaryIncome;
    const monthlyIncome = leaveParentIncome + otherParentIncome;

    segment.benefitIncome = segmentBenefitIncome;
    segment.otherParentIncome = otherParentIncome;
    segment.parentalSalaryIncome = Math.max(0, Math.round(segmentParentalSalaryIncome));
    segment.leaveParentIncome = Math.max(0, Math.round(leaveParentIncome));
    segment.monthlyIncome = Math.max(0, Math.round(monthlyIncome));
  });

  if (totalCABonus > 0) {
    const distributedParentalSalary = segments.reduce((sum, segment) => sum + segment.parentalSalaryIncome, 0);
    const bonusGap = Math.round(totalCABonus) - distributedParentalSalary;
    if (bonusGap !== 0) {
      const target = segments.find(segment => segment.parentalSalaryIncome > 0) ?? segments[0];
      if (target) {
        target.parentalSalaryIncome = Math.max(0, target.parentalSalaryIncome + bonusGap);
      }
    }
  }

  const totalSegmentBenefitIncome = segments.reduce((sum, segment) => sum + segment.benefitIncome, 0);
  const totalSegmentParentalSalaryIncome = segments.reduce((sum, segment) => sum + segment.parentalSalaryIncome, 0);
  const totalSegmentLeaveIncome = segments.reduce((sum, segment) => sum + segment.leaveParentIncome, 0);

  const resolveParentLeaveTotals = (parentKey: 'parent1' | 'parent2'): number => {
    if (period.parent === parentKey) {
      return totalSegmentLeaveIncome;
    }

    if (period.parent === 'both') {
      const declared = parentKey === 'parent1' ? period.parent1Income : period.parent2Income;
      if (Number.isFinite(declared) && declared !== undefined) {
        return Math.max(0, declared);
      }

      // Fallback: split remaining leave income equally
      return Math.max(0, totalSegmentLeaveIncome / 2);
    }

    return 0;
  };

  const resolveParentBenefitTotals = (parentKey: 'parent1' | 'parent2', leaveTotal: number): number => {
    if (period.parent === parentKey) {
      return totalSegmentBenefitIncome;
    }

    if (period.parent === 'both') {
      const declared = parentKey === 'parent1' ? period.parent1BenefitIncome : period.parent2BenefitIncome;
      if (Number.isFinite(declared) && declared !== undefined) {
        return Math.max(0, declared);
      }

      // Fallback: assume proportional to leave income
      if (totalSegmentLeaveIncome > 0) {
        const proportion = leaveTotal / totalSegmentLeaveIncome;
        return Math.max(0, totalSegmentBenefitIncome * proportion);
      }

      return Math.max(0, totalSegmentBenefitIncome / 2);
    }

    return 0;
  };

  const parent1LeaveTotal = resolveParentLeaveTotals('parent1');
  const parent2LeaveTotal = resolveParentLeaveTotals('parent2');
  const parent1BenefitTotal = resolveParentBenefitTotals('parent1', parent1LeaveTotal);
  const parent2BenefitTotal = resolveParentBenefitTotals('parent2', parent2LeaveTotal);
  const parent1ParentalSalaryTotal = (() => {
    if (period.parent === 'parent1') {
      return totalSegmentParentalSalaryIncome > 0
        ? totalSegmentParentalSalaryIncome
        : totalCABonus;
    }
    if (period.parent === 'both') {
      const declared = period.parent1ParentalSalary;
      if (Number.isFinite(declared) && declared !== undefined && declared > 0) {
        return Math.max(0, declared);
      }
      if (totalCABonus > 0) {
        const combinedBenefit = parent1BenefitTotal + parent2BenefitTotal;
        const share = combinedBenefit > 0 ? parent1BenefitTotal / combinedBenefit : 0.5;
        return totalCABonus * share;
      }
      return Math.max(0, parent1LeaveTotal - parent1BenefitTotal);
    }
    return 0;
  })();
  const parent2ParentalSalaryTotal = (() => {
    if (period.parent === 'parent2') {
      return totalSegmentParentalSalaryIncome > 0
        ? totalSegmentParentalSalaryIncome
        : totalCABonus;
    }
    if (period.parent === 'both') {
      const declared = period.parent2ParentalSalary;
      if (Number.isFinite(declared) && declared !== undefined && declared > 0) {
        return Math.max(0, declared);
      }
      if (totalCABonus > 0) {
        const combinedBenefit = parent1BenefitTotal + parent2BenefitTotal;
        const share = combinedBenefit > 0 ? parent2BenefitTotal / combinedBenefit : 0.5;
        return totalCABonus * share;
      }
      return Math.max(0, parent2LeaveTotal - parent2BenefitTotal);
    }
    return 0;
  })();

  segments.forEach(segment => {
    const calendarShare = totalSegmentCalendarDays > 0 ? segment.calendarDays / totalSegmentCalendarDays : 0;
    const benefitShare = totalSegmentBenefitDays > 0 ? segment.benefitDays / totalSegmentBenefitDays : calendarShare;

    if (period.parent === 'parent1') {
      segment.parentLeaveIncomeByParent.parent1 = segment.leaveParentIncome;
      segment.parentBenefitIncomeByParent.parent1 = segment.benefitIncome;
      segment.parentParentalSalaryIncomeByParent.parent1 = segment.parentalSalaryIncome;
      segment.parentBenefitDaysByParent.parent1 = segment.benefitDays;
      segment.parentBenefitDaysByParent.parent2 = 0;
      return;
    }

    if (period.parent === 'parent2') {
      segment.parentLeaveIncomeByParent.parent2 = segment.leaveParentIncome;
      segment.parentBenefitIncomeByParent.parent2 = segment.benefitIncome;
      segment.parentParentalSalaryIncomeByParent.parent2 = segment.parentalSalaryIncome;
      segment.parentBenefitDaysByParent.parent1 = 0;
      segment.parentBenefitDaysByParent.parent2 = segment.benefitDays;
      return;
    }

    // Both parents are on leave simultaneously
    segment.parentLeaveIncomeByParent.parent1 = parent1LeaveTotal * calendarShare;
    segment.parentLeaveIncomeByParent.parent2 = parent2LeaveTotal * calendarShare;
    segment.parentBenefitIncomeByParent.parent1 = parent1BenefitTotal * benefitShare;
    segment.parentBenefitIncomeByParent.parent2 = parent2BenefitTotal * benefitShare;
    segment.parentParentalSalaryIncomeByParent.parent1 = parent1ParentalSalaryTotal * benefitShare;
    segment.parentParentalSalaryIncomeByParent.parent2 = parent2ParentalSalaryTotal * benefitShare;
    segment.parentBenefitDaysByParent.parent1 = totalParent1BenefitDays * benefitShare;
    segment.parentBenefitDaysByParent.parent2 = totalParent2BenefitDays * benefitShare;
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
          if (segment.highBenefitDays > 0) {
            initialBenefitLevels.push("high");
            initialBenefitDaysByLevel["high"] = segment.highBenefitDays;
          }
          if (segment.lowBenefitDays > 0) {
            initialBenefitLevels.push("low");
            initialBenefitDaysByLevel["low"] = segment.lowBenefitDays;
          }
          if (segment.highBenefitDays <= 0 && segment.lowBenefitDays <= 0) {
            initialBenefitLevels.push(period.benefitLevel);
            initialBenefitDaysByLevel[period.benefitLevel] = segment.benefitDays;
          }
          const parentalSalaryDisplayDays = segment.parentalSalaryIncome > 0
            ? Math.max(0, Math.round(segment.benefitDays))
            : 0;

          if (segment.parentalSalaryIncome > 0 && parentalSalaryDisplayDays > 0) {
            initialBenefitLevels.push("parental-salary");
            initialBenefitDaysByLevel["parental-salary"] = parentalSalaryDisplayDays;
          }
        } else {
          initialBenefitLevels.push("none");
        }

        const uniqueCalendarDays = new Set<number>();
        addCalendarRangeToSet(uniqueCalendarDays, segment.startDate, segment.endDate);

        const parentDaySets: Record<'parent1' | 'parent2' | 'both', Set<number>> = {
          parent1: new Set<number>(),
          parent2: new Set<number>(),
          both: new Set<number>(),
        };

        if (period.parent === 'parent1') {
          addCalendarRangeToSet(parentDaySets.parent1, segment.startDate, segment.endDate);
        }
        if (period.parent === 'parent2') {
          addCalendarRangeToSet(parentDaySets.parent2, segment.startDate, segment.endDate);
        }
        if (period.parent === 'both') {
          addCalendarRangeToSet(parentDaySets.both, segment.startDate, segment.endDate);
        }

        monthMap.set(key, {
          monthKey: key,
          monthStart,
          monthLength,
          startDate: new Date(segment.startDate),
          endDate: new Date(segment.endDate),
          calendarDays: uniqueCalendarDays.size,
          benefitDays: segment.benefitDays,
          monthlyIncome: segment.monthlyIncome,
          leaveParentIncome: segment.benefitIncome,
          otherParentIncome: segment.otherParentIncome,
          benefitIncome: segment.benefitIncome,
          parentalSalaryIncome: segment.parentalSalaryIncome,
          parentLeaveIncomeByParent: { ...segment.parentLeaveIncomeByParent },
          parentBenefitIncomeByParent: { ...segment.parentBenefitIncomeByParent },
          parentParentalSalaryIncomeByParent: { ...segment.parentParentalSalaryIncomeByParent },
          parentBenefitDaysByParent: { ...segment.parentBenefitDaysByParent },
          daysPerWeekValues: [segment.daysPerWeekValue],
          benefitLevels: initialBenefitLevels,
          benefitDaysByLevel: initialBenefitDaysByLevel,
          parents: [parentLabel],
          parentDayTotals: {
            parent1: parentDaySets.parent1.size,
            parent2: parentDaySets.parent2.size,
            both: parentDaySets.both.size,
          },
          otherParentMonthlyBase: segment.otherParentMonthlyBase,
          uniqueCalendarDays,
          parentDaySets,
        });
        return;
      }

      addCalendarRangeToSet(existing.uniqueCalendarDays, segment.startDate, segment.endDate);
      if (period.parent === "parent1") {
        addCalendarRangeToSet(existing.parentDaySets.parent1, segment.startDate, segment.endDate);
      }
      if (period.parent === "parent2") {
        addCalendarRangeToSet(existing.parentDaySets.parent2, segment.startDate, segment.endDate);
      }
      if (period.parent === "both") {
        addCalendarRangeToSet(existing.parentDaySets.both, segment.startDate, segment.endDate);
      }

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
      existing.leaveParentIncome += segment.benefitIncome;
      existing.otherParentIncome += segment.otherParentIncome;
      existing.benefitIncome += segment.benefitIncome;
      existing.parentalSalaryIncome += segment.parentalSalaryIncome;
      existing.parentLeaveIncomeByParent.parent1 += segment.parentLeaveIncomeByParent.parent1;
      existing.parentLeaveIncomeByParent.parent2 += segment.parentLeaveIncomeByParent.parent2;
      existing.parentBenefitIncomeByParent.parent1 += segment.parentBenefitIncomeByParent.parent1;
      existing.parentBenefitIncomeByParent.parent2 += segment.parentBenefitIncomeByParent.parent2;
      existing.parentParentalSalaryIncomeByParent.parent1 += segment.parentParentalSalaryIncomeByParent.parent1;
      existing.parentParentalSalaryIncomeByParent.parent2 += segment.parentParentalSalaryIncomeByParent.parent2;
      existing.parentBenefitDaysByParent.parent1 += segment.parentBenefitDaysByParent.parent1;
      existing.parentBenefitDaysByParent.parent2 += segment.parentBenefitDaysByParent.parent2;
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

        const addLevelDays = (level: "high" | "low", amount: number) => {
          if (amount <= 0) {
            return;
          }
          ensureLevel(level);
          if (!existing.benefitDaysByLevel[level]) {
            existing.benefitDaysByLevel[level] = 0;
          }
          existing.benefitDaysByLevel[level] += amount;
        };

        if (segment.highBenefitDays > 0) {
          addLevelDays("high", segment.highBenefitDays);
        }
        if (segment.lowBenefitDays > 0) {
          addLevelDays("low", segment.lowBenefitDays);
        }

        if (segment.highBenefitDays <= 0 && segment.lowBenefitDays <= 0) {
          addLevelDays(period.benefitLevel === "high" ? "high" : "low", segment.benefitDays);
        }

        const parentalSalaryDisplayDays = segment.parentalSalaryIncome > 0
          ? Math.max(0, Math.round(segment.benefitDays))
          : 0;

        if (segment.parentalSalaryIncome > 0 && parentalSalaryDisplayDays > 0) {
          ensureLevel("parental-salary");
          if (!existing.benefitDaysByLevel["parental-salary"]) {
            existing.benefitDaysByLevel["parental-salary"] = 0;
          }
          existing.benefitDaysByLevel["parental-salary"] += parentalSalaryDisplayDays;
        }
      }

      const parentKey = getParentKey(period.parent);
      existing.parentDayTotals[parentKey] = existing.parentDaySets[parentKey].size;

      if (period.parent === "both") {
        existing.parentDayTotals.parent1 = existing.parentDaySets.parent1.size;
        existing.parentDayTotals.parent2 = existing.parentDaySets.parent2.size;
        existing.parentDayTotals.both = existing.parentDaySets.both.size;
      }

      if (!existing.parents.includes(parentLabel)) {
        existing.parents.push(parentLabel);
      }
    });
  });

  return Array.from(monthMap.values())
    .map(({ uniqueCalendarDays, parentDaySets, ...entry }) => {
      const cappedOtherIncome = Math.max(
        0,
        Math.min(entry.otherParentMonthlyBase, entry.otherParentIncome)
      );
      const recalculatedMonthlyIncome = Math.max(
        0,
        Math.round(entry.leaveParentIncome + entry.parentalSalaryIncome + cappedOtherIncome)
      );

      return {
        ...entry,
        calendarDays: uniqueCalendarDays.size,
        otherParentIncome: cappedOtherIncome,
        monthlyIncome: recalculatedMonthlyIncome,
      };
    })
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
