import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OptimizationResult, formatPeriod, formatCurrency, LeavePeriod } from "@/utils/parentalCalculations";
import { TimelineChart } from "./TimelineChart";
import { Calendar, TrendingUp, PiggyBank, Users, Clock, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { format, endOfMonth, differenceInCalendarDays, addDays, startOfMonth } from "date-fns";

interface OptimizationResultsProps {
  results: OptimizationResult[];
  minHouseholdIncome: number;
  selectedIndex: number;
  onSelectStrategy: (index: number) => void;
  timelineMonths: number;
}

export function OptimizationResults({ results, minHouseholdIncome, selectedIndex, onSelectStrategy, timelineMonths }: OptimizationResultsProps) {
  const [expandedPeriods, setExpandedPeriods] = useState<Record<string, boolean>>({});
  const [expandedStrategies, setExpandedStrategies] = useState<Record<number, boolean>>({});

  const togglePeriod = (resultIndex: number, periodIndex: number) => {
    const key = `${resultIndex}-${periodIndex}`;
    setExpandedPeriods(prev => ({ ...prev, [key]: !prev[key] }));
  };

  interface MonthlyBreakdown {
    startDate: Date;
    endDate: Date;
    calendarDays: number;
    benefitDays: number;
    monthlyIncome: number;
    leaveParentIncome: number;
    otherParentIncome: number;
    benefitIncome: number;
    daysPerWeekValue: number;
    otherParentMonthlyBase: number;
  }

  interface MonthlyBreakdownEntry extends MonthlyBreakdown {
    monthKey: string;
    monthStart: Date;
    monthLength: number;
    daysPerWeekValues: number[];
    benefitLevels: Array<'parental-salary' | 'high' | 'low' | 'none'>;
    benefitDaysByLevel: Record<string, number>;
  }

  const breakDownByMonth = (period: LeavePeriod): MonthlyBreakdown[] => {
    const startDate = new Date(period.startDate);
    const endDate = new Date(period.endDate);
    // Only treat actual compensated days as benefit days; periods with benefitLevel 'none' should not allocate benefit days
    const rawBenefitDays = Math.max(0, Math.round(period.benefitDaysUsed ?? period.daysCount));
    const totalBenefitDays = period.benefitLevel === 'none' ? 0 : rawBenefitDays;
    
    // Debug logging for May-Aug 2026 periods
    if (startDate.getFullYear() === 2026 && startDate.getMonth() >= 4 && startDate.getMonth() <= 7) {
      console.log('May-Aug 2026 Period Debug:', {
        parent: period.parent,
        startDate: format(startDate, 'yyyy-MM-dd'),
        endDate: format(endDate, 'yyyy-MM-dd'),
        benefitLevel: period.benefitLevel,
        dailyBenefit: period.dailyBenefit,
        otherParentMonthlyIncome: period.otherParentMonthlyIncome,
        otherParentDailyIncome: period.otherParentDailyIncome,
        totalBenefitDays,
        rawBenefitDays
      });
    }

    const segments: MonthlyBreakdown[] = [];
    let cursor = new Date(startDate);

    const normalizedDaysPerWeek =
      period.benefitLevel === 'none'
        ? 0
        : period.daysPerWeek && period.daysPerWeek > 0
        ? period.daysPerWeek
        : 7;

    while (cursor <= endDate) {
      const monthStart = new Date(cursor);
      const monthEndCandidate = endOfMonth(monthStart);
      const monthEnd = monthEndCandidate < endDate ? monthEndCandidate : endDate;
      const calendarDays = Math.max(1, differenceInCalendarDays(monthEnd, monthStart) + 1);

      segments.push({
        startDate: monthStart,
        endDate: monthEnd,
        calendarDays,
        benefitDays: 0,
        monthlyIncome: 0,
        leaveParentIncome: 0,
        otherParentIncome: 0,
        benefitIncome: 0,
        daysPerWeekValue: normalizedDaysPerWeek,
        otherParentMonthlyBase: period.parent === 'both' ? 0 : period.otherParentMonthlyIncome || 0,
      });

      cursor = addDays(monthEnd, 1);
    }

    if (segments.length === 0) {
      return [];
    }

    const daysPerWeek =
      period.benefitLevel === 'none'
        ? 0
        : period.daysPerWeek && period.daysPerWeek > 0
        ? period.daysPerWeek
        : 7;
    const expectedBenefitDaysPerMonth = daysPerWeek * 4.33;

    const totalCalendarDays = segments.reduce((sum, segment) => sum + segment.calendarDays, 0) || 1;
    let remainingBenefitDays = totalBenefitDays;
    let carryOver = 0;

    segments.forEach((segment, index) => {
      if (remainingBenefitDays <= 0) {
        segment.benefitDays = 0;
      } else {
        const monthStart = startOfMonth(segment.startDate);
        const monthEndDate = endOfMonth(monthStart);
        const monthLength = Math.max(1, differenceInCalendarDays(monthEndDate, monthStart) + 1);
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
      
      // Calculate monthly income for this segment using the period's daily income to ensure
      // the full household income is represented, while still breaking out the benefit and
      // working parent contributions for display.
      const benefitDaily = period.dailyBenefit;
      const monthStart = startOfMonth(segment.startDate);
      const monthEndDate = endOfMonth(monthStart);
      const monthLength = Math.max(1, differenceInCalendarDays(monthEndDate, monthStart) + 1);

      const totalSegmentIncome = Math.max(0, Math.round((period.dailyIncome || 0) * segment.calendarDays));

      // Prefer monthly base from legacy; fallback to daily base (e.g., for filler 'none' periods)
      const monthlyBaseFromOther = period.parent === 'both' ? 0 : (period.otherParentMonthlyIncome || 0);
      const dailyBaseFromOther = period.parent === 'both' ? 0 : (period.otherParentDailyIncome || 0);
      const computedMonthlyBase = monthlyBaseFromOther > 0
        ? monthlyBaseFromOther
        : (dailyBaseFromOther > 0 ? dailyBaseFromOther * 30 : 0);

      const isFullMonthSegment =
        segment.calendarDays >= monthLength &&
        segment.startDate.getDate() === 1 &&
        segment.endDate.getDate() === monthEndDate.getDate();

      // Parental benefit: use allocated benefit days, with a max of 30 days for full months
      let benefitIncome = 0;
      if (benefitDaily > 0 && segment.benefitDays > 0) {
        const benefitDaysForMonth = isFullMonthSegment ? Math.min(segment.benefitDays, 30) : segment.benefitDays;
        benefitIncome = benefitDaily * Math.max(0, Math.round(benefitDaysForMonth));
      }
      benefitIncome = Math.min(totalSegmentIncome, Math.max(0, Math.round(benefitIncome)));

      // Working parent's monthly income (clamped so total matches household income)
      let otherParentIncome = 0;
      if (period.parent !== 'both') {
        let baseOtherIncome = 0;
        if (computedMonthlyBase > 0) {
          baseOtherIncome = isFullMonthSegment
            ? computedMonthlyBase
            : computedMonthlyBase * (segment.calendarDays / monthLength);
        } else if (dailyBaseFromOther > 0) {
          baseOtherIncome = dailyBaseFromOther * segment.calendarDays;
        }

        const maxAllowedOtherIncome = period.benefitLevel === 'none'
          ? totalSegmentIncome
          : Math.max(0, totalSegmentIncome - benefitIncome);

        otherParentIncome = Math.min(
          Math.max(0, Math.round(baseOtherIncome)),
          Math.max(0, Math.round(maxAllowedOtherIncome))
        );
      }

      // Leave parent's income representation for the breakdown
      let leaveParentIncome: number;
      if (period.parent === 'both') {
        leaveParentIncome = totalSegmentIncome;
      } else if (period.benefitLevel === 'none') {
        leaveParentIncome = Math.max(0, totalSegmentIncome - otherParentIncome);
      } else {
        leaveParentIncome = benefitIncome;
        const combinedDisplayed = otherParentIncome + benefitIncome;
        if (combinedDisplayed < totalSegmentIncome) {
          leaveParentIncome += totalSegmentIncome - combinedDisplayed;
        }
      }

      // Compose monthly totals
      segment.benefitIncome = benefitIncome;
      segment.otherParentIncome = otherParentIncome;
      segment.leaveParentIncome = Math.max(0, Math.round(leaveParentIncome));
      segment.monthlyIncome = totalSegmentIncome;
      segment.daysPerWeekValue = normalizedDaysPerWeek;
      segment.otherParentMonthlyBase = monthlyBaseFromOther > 0
        ? monthlyBaseFromOther
        : (dailyBaseFromOther > 0 ? dailyBaseFromOther * 30 : 0);
    });

    return segments;
  };

  const createMonthlyBreakdownEntries = (periodList: LeavePeriod[]): MonthlyBreakdownEntry[] => {
    if (periodList.length === 0) {
      return [];
    }

    const monthMap = new Map<string, MonthlyBreakdownEntry>();

    periodList.forEach(period => {
      breakDownByMonth(period).forEach(segment => {
        const monthStart = startOfMonth(segment.startDate);
        const key = `${monthStart.getFullYear()}-${monthStart.getMonth()}`;
        const monthLength = differenceInCalendarDays(endOfMonth(monthStart), monthStart) + 1;
        const existing = monthMap.get(key);

        if (!existing) {
          monthMap.set(key, {
            ...segment,
            startDate: new Date(segment.startDate),
            endDate: new Date(segment.endDate),
            monthKey: key,
            monthStart,
            monthLength,
            daysPerWeekValues: [segment.daysPerWeekValue],
            benefitLevels: [segment.daysPerWeekValue > 0 ? period.benefitLevel : 'none'],
            benefitDaysByLevel: {
              [period.benefitLevel]: segment.benefitDays
            }
          });
          return;
        }

        existing.startDate =
          existing.startDate.getTime() <= segment.startDate.getTime()
            ? existing.startDate
            : new Date(segment.startDate);
        existing.endDate =
          existing.endDate.getTime() >= segment.endDate.getTime()
            ? existing.endDate
            : new Date(segment.endDate);
        existing.calendarDays += segment.calendarDays;
        existing.benefitDays += segment.benefitDays;
        existing.monthlyIncome += segment.monthlyIncome;
        existing.monthLength = monthLength;
        existing.leaveParentIncome += segment.leaveParentIncome;
        existing.otherParentIncome += segment.otherParentIncome;
        existing.benefitIncome += segment.benefitIncome;
        if (!existing.daysPerWeekValues.includes(segment.daysPerWeekValue)) {
          existing.daysPerWeekValues.push(segment.daysPerWeekValue);
        }
        if (segment.otherParentMonthlyBase > existing.otherParentMonthlyBase) {
          existing.otherParentMonthlyBase = segment.otherParentMonthlyBase;
        }
        
        // Track benefit levels and days by level
        if (!existing.benefitLevels.includes(period.benefitLevel)) {
          existing.benefitLevels.push(period.benefitLevel);
        }
        if (!existing.benefitDaysByLevel[period.benefitLevel]) {
          existing.benefitDaysByLevel[period.benefitLevel] = 0;
        }
        existing.benefitDaysByLevel[period.benefitLevel] += segment.benefitDays;
      });
    });

    return Array.from(monthMap.values()).sort((a, b) => a.monthStart.getTime() - b.monthStart.getTime());
  };

  interface PeriodGroup {
    parent: LeavePeriod["parent"];
    periods: LeavePeriod[];
  }

  const groupConsecutivePeriods = (periodList: LeavePeriod[]): PeriodGroup[] => {
    if (periodList.length === 0) {
      return [];
    }

    const sorted = [...periodList].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
    const groups: PeriodGroup[] = [];

    sorted.forEach(period => {
      const lastGroup = groups[groups.length - 1];
      const lastSegment = lastGroup?.periods[lastGroup.periods.length - 1];

      const canGroup =
        lastGroup &&
        lastGroup.parent === period.parent &&
        differenceInCalendarDays(period.startDate, addDays(lastSegment.endDate, 1)) === 0;

      if (canGroup) {
        lastGroup.periods.push(period);
      } else {
        groups.push({ parent: period.parent, periods: [period] });
      }
    });

    return groups;
  };

  return (
    <div className="space-y-4 md:space-y-8">
      <div className="text-center space-y-1 md:space-y-2">
        <h2 className="text-lg md:text-3xl font-bold">Optimeringsförslag</h2>
        <p className="text-[10px] md:text-sm text-muted-foreground">
          * Föräldrapenning baseras på 7 dagar per vecka
        </p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-6">
        {results.map((result, index) => {
          // Find the absolute lowest monthly income across ALL periods in this strategy
          // Only consider full months (calendarDays === 30) to avoid partial months
          const filteredPeriods = result.periods.filter(period => period.benefitLevel !== 'none');
          const periodGroups = groupConsecutivePeriods(filteredPeriods);

          const initialTenDayGroupIndex = periodGroups.findIndex(group =>
            group.periods.length > 0 && group.periods.every(period => period.isInitialTenDayPeriod)
          );

          if (initialTenDayGroupIndex > 0) {
            const [initialGroup] = periodGroups.splice(initialTenDayGroupIndex, 1);
            periodGroups.unshift(initialGroup);
          }

          const groupMonthlyBreakdowns = periodGroups.map(group =>
            createMonthlyBreakdownEntries(group.periods)
          );

          const aggregatedMonthMap = new Map<string, {
            totalIncome: number;
            totalCalendarDays: number;
            monthStart: Date;
            monthLength: number;
          }>();

          // Build household totals from ALL periods (including 'none') so working income always counts
          const allMonthlyEntries = createMonthlyBreakdownEntries(result.periods);

          allMonthlyEntries.forEach(month => {
            const existing = aggregatedMonthMap.get(month.monthKey);

            if (!existing) {
              aggregatedMonthMap.set(month.monthKey, {
                totalIncome: month.monthlyIncome,
                totalCalendarDays: month.calendarDays,
                monthStart: month.monthStart,
                monthLength: month.monthLength,
              });
              return;
            }

            existing.totalIncome += month.monthlyIncome;
            existing.totalCalendarDays += month.calendarDays;
          });

          const eligibleAggregatedEntries = Array.from(aggregatedMonthMap.entries()).filter(([, info]) =>
            info.totalCalendarDays >= info.monthLength
          );

          let lowestAggregatedKey: string | null = null;
          let lowestAggregatedIncome = Infinity;

          eligibleAggregatedEntries.forEach(([key, info]) => {
            if (info.totalIncome < lowestAggregatedIncome - 0.5) {
              lowestAggregatedKey = key;
              lowestAggregatedIncome = info.totalIncome;
              return;
            }

            if (Math.abs(info.totalIncome - lowestAggregatedIncome) <= 0.5) {
              if (!lowestAggregatedKey) {
                lowestAggregatedKey = key;
                lowestAggregatedIncome = info.totalIncome;
                return;
              }

              const currentBest = aggregatedMonthMap.get(lowestAggregatedKey);
              if (currentBest && info.monthStart.getTime() < currentBest.monthStart.getTime()) {
                lowestAggregatedKey = key;
                lowestAggregatedIncome = info.totalIncome;
              }
            }
          });

          const lowestMonthlyIncome = lowestAggregatedKey
            ? aggregatedMonthMap.get(lowestAggregatedKey)?.totalIncome ?? Infinity
            : Infinity;

          const isLowestBelowMinimum =
            Number.isFinite(lowestMonthlyIncome) && lowestMonthlyIncome < minHouseholdIncome;

          const isExpanded = expandedStrategies[index] ?? false;

          return (
            <Card
              key={index}
              className={`shadow-soft transition-all ${
                selectedIndex === index && isExpanded
                  ? 'ring-2 md:ring-4 ring-primary shadow-xl'
                  : ''
            }`}
            >
              <CardHeader 
                className={`${result.strategy === 'save-days' ? 'bg-parent1/10' : 'bg-parent2/10'} p-2 md:p-6 cursor-pointer`}
                onClick={() => setExpandedStrategies(prev => ({ ...prev, [index]: !prev[index] }))}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5 md:space-y-1 flex-1">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm md:text-2xl">{result.title}</CardTitle>
                      {isExpanded ? <ChevronUp className="h-4 w-4 md:h-5 md:w-5" /> : <ChevronDown className="h-4 w-4 md:h-5 md:w-5" />}
                    </div>
                    <p className="text-[10px] md:text-sm text-muted-foreground">
                      {result.description}
                    </p>
                  </div>
                  {result.strategy === 'save-days' ? (
                    <PiggyBank className="h-5 w-5 md:h-8 md:w-8 text-parent1 flex-shrink-0" />
                  ) : (
                    <TrendingUp className="h-5 w-5 md:h-8 md:w-8 text-parent2 flex-shrink-0" />
                  )}
                </div>
                
                {/* Summary - Always Visible */}
                <div className="grid grid-cols-2 gap-1.5 md:gap-4 mt-2 md:mt-4">
                  <div className="p-1.5 md:p-4 bg-muted rounded-lg">
                    <div className="text-[9px] md:text-sm text-muted-foreground mb-0.5">Total inkomst</div>
                    <div className="text-xs md:text-xl font-bold">{formatCurrency(result.totalIncome)}</div>
                  </div>
                  <div className="p-1.5 md:p-4 bg-muted rounded-lg">
                    <div className="text-[9px] md:text-sm text-muted-foreground mb-0.5">Genomsnitt/mån</div>
                    <div className="text-xs md:text-xl font-bold">{formatCurrency(result.averageMonthlyIncome)}</div>
                  </div>
                  <div className="p-1.5 md:p-4 bg-accent/10 rounded-lg border border-accent/20">
                    <div className="text-[9px] md:text-sm text-muted-foreground mb-0.5 flex items-center gap-0.5 md:gap-1">
                      <Clock className="h-2 w-2 md:h-3 md:w-3" />
                      Dagar använda
                    </div>
                    <div className="text-xs md:text-xl font-bold">{result.daysUsed}</div>
                    {result.highBenefitDaysUsed !== undefined && result.lowBenefitDaysUsed !== undefined && (
                      <div className="text-[8px] md:text-xs text-muted-foreground mt-0.5 space-y-0">
                        <div>Vanliga: {result.highBenefitDaysUsed}</div>
                        <div>Lägstanivå: {result.lowBenefitDaysUsed}</div>
                      </div>
                    )}
                  </div>
                  <div className="p-1.5 md:p-4 bg-accent/10 rounded-lg border border-accent/20">
                    <div className="text-[9px] md:text-sm text-muted-foreground mb-0.5 flex items-center gap-0.5 md:gap-1">
                      <PiggyBank className="h-2 w-2 md:h-3 md:w-3" />
                      Dagar sparade
                    </div>
                    <div className="text-xs md:text-xl font-bold text-accent">{result.daysSaved}</div>
                    {result.highBenefitDaysSaved !== undefined && result.lowBenefitDaysSaved !== undefined && (
                      <div className="text-[8px] md:text-xs text-muted-foreground mt-0.5 space-y-0">
                        <div>Vanliga: {result.highBenefitDaysSaved}</div>
                        <div>Lägstanivå: {result.lowBenefitDaysSaved}</div>
                      </div>
                    )}
                  </div>
                </div>
              </CardHeader>
              
              {/* Collapsible Details */}
              {isExpanded && (
                <CardContent className="pt-3 md:pt-6 space-y-3 md:space-y-6 p-2 md:p-6"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectStrategy(index);
                  }}
                >
                <TimelineChart
                  periods={result.periods}
                  minHouseholdIncome={minHouseholdIncome}
                  calendarMonthsLimit={timelineMonths}
                />

                <div className="space-y-2 md:space-y-3">
                  <div className="flex items-center gap-1 md:gap-2 text-[10px] md:text-sm font-semibold">
                    <Calendar className="h-3 w-3 md:h-4 md:w-4" />
                    <span>Ledighetsperioder</span>
                  </div>
                  
                  <div className="space-y-2 md:space-y-3">
                  {periodGroups.map((group, groupIndex) => {
                    const firstPeriod = group.periods[0];
                    const lastPeriod = group.periods[group.periods.length - 1];
                    const parentColor =
                      group.parent === 'both' ? 'accent' :
                      group.parent === 'parent1' ? 'parent1' : 'parent2';

                    const parentLabel =
                      group.parent === 'both' ? 'Båda föräldrarna' :
                      group.parent === 'parent1' ? 'Förälder 1' : 'Förälder 2';

                    const uniqueBenefitLabels = Array.from(new Set(group.periods.map(segment => {
                      if (segment.benefitLevel === 'parental-salary') {
                        return 'Föräldralön (90%)';
                      }
                      if (segment.benefitLevel === 'high') {
                        return 'Föräldrapenning (80%)';
                      }
                      if (segment.benefitLevel === 'low') {
                        return 'Lägstanivå (180 kr/dag)';
                      }
                      return segment.isPreferenceFiller || segment.isInitialTenDayPeriod
                        ? 'Ingen ersättning'
                        : 'Ingen ersättning';
                    })));
                    const benefitLabel = uniqueBenefitLabels.length === 1
                      ? uniqueBenefitLabels[0]
                      : `Varierad ersättning: ${uniqueBenefitLabels.join(' → ')}`;

                    const uniqueDaysPerWeekLabels = Array.from(new Set(group.periods.map(segment =>
                      segment.daysPerWeek
                        ? `${segment.daysPerWeek} ${segment.daysPerWeek === 1 ? 'dag' : 'dagar'}/vecka`
                        : 'Heltid'
                    )));
                    const daysPerWeekLabel = uniqueDaysPerWeekLabels.length === 1
                      ? uniqueDaysPerWeekLabels[0]
                      : `Varierar: ${uniqueDaysPerWeekLabels.join(' → ')}`;

                    const monthlyBreakdown = groupMonthlyBreakdowns[groupIndex];
                    const totalCalendarDays = monthlyBreakdown.reduce((sum, month) => sum + month.calendarDays, 0);
                    const totalHouseholdIncome = monthlyBreakdown.reduce(
                      (sum, month) => sum + month.monthlyIncome,
                      0
                    );
                    const totalBenefitIncome = monthlyBreakdown.reduce(
                      (sum, month) => sum + month.benefitIncome,
                      0
                    );
                    const totalOtherIncome = monthlyBreakdown.reduce(
                      (sum, month) => sum + month.otherParentIncome,
                      0
                    );
                    const effectiveMonths = monthlyBreakdown.length > 0 ? monthlyBreakdown.length : 1;

                    const householdMonthlyIncome =
                      effectiveMonths > 0 ? totalHouseholdIncome / effectiveMonths : 0;
                    const leaveBenefitMonthly =
                      effectiveMonths > 0 ? totalBenefitIncome / effectiveMonths : 0;
                    const otherParentMonthlyIncome =
                      effectiveMonths > 0 ? totalOtherIncome / effectiveMonths : 0;
                    const leaveParentMonthlyIncome = householdMonthlyIncome - otherParentMonthlyIncome;
                    const periodTotalIncome = monthlyBreakdown.reduce((sum, month) => sum + month.monthlyIncome, 0);
                    const periodContainsLowest = lowestAggregatedKey
                      ? monthlyBreakdown.some(month => {
                          return month.monthKey === lowestAggregatedKey;
                        })
                      : false;
                    const shouldBeOrange = periodContainsLowest && isLowestBelowMinimum;

                    const expandKey = `${index}-${groupIndex}`;
                    const isExpanded = expandedPeriods[expandKey];
                    const hasMultipleMonths = monthlyBreakdown.length > 1;
                    const totalDaysUsed = group.periods.reduce((sum, segment) => sum + (segment.benefitDaysUsed ?? segment.daysCount), 0);
                    const isInitialTenDayGroup =
                      group.parent === 'both' && group.periods.every(segment => segment.isInitialTenDayPeriod);
                    const totalDaysLabel = isInitialTenDayGroup ? '2 x 10 dagar' : `${totalDaysUsed} dagar`;
                    const periodRangeLabel = formatPeriod({ ...firstPeriod, endDate: lastPeriod.endDate });

                    return (
                      <div
                        key={groupIndex}
                        className={`p-4 rounded-lg border-l-4 ${
                          shouldBeOrange
                            ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/20'
                            : parentColor === 'accent'
                            ? 'border-accent bg-accent/5'
                            : parentColor === 'parent1'
                            ? 'border-parent1 bg-parent1/5'
                            : 'border-parent2 bg-parent2/5'
                        }`}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Users className="h-4 w-4" />
                            <span className={`font-semibold ${parentColor === 'accent' ? 'text-accent' : parentColor === 'parent1' ? 'text-parent1' : 'text-parent2'}`}>
                              {parentLabel}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="text-xs">
                              {totalDaysLabel}
                            </Badge>
                            {hasMultipleMonths && (
                              <button
                                onClick={() => togglePeriod(index, groupIndex)}
                                className="p-1 hover:bg-muted rounded transition-colors"
                                aria-label={isExpanded ? "Dölj månader" : "Visa månader"}
                              >
                                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="text-sm space-y-1">
                          <div className="text-muted-foreground">
                            {periodRangeLabel}
                          </div>
                          <div className="font-medium">
                            {benefitLabel}
                          </div>
                          <div className="text-muted-foreground">
                            Uttag: {daysPerWeekLabel}
                          </div>

                          {isExpanded && hasMultipleMonths && (
                            <div className="mt-3 space-y-2 pl-4 border-l-2 border-muted">
                              {monthlyBreakdown.map((month, monthIdx) => {
                                const aggregatedInfo = aggregatedMonthMap.get(month.monthKey);
                                const isEligibleMonth = aggregatedInfo
                                  ? aggregatedInfo.totalCalendarDays >= aggregatedInfo.monthLength
                                  : false;
                                const aggregatedIncome = aggregatedInfo?.totalIncome ?? month.monthlyIncome;
                                const isLowest =
                                  lowestAggregatedKey !== null && month.monthKey === lowestAggregatedKey;
                                const isBelowMinimum = isEligibleMonth && aggregatedIncome < minHouseholdIncome;
                                const leaveParentLabel =
                                  group.parent === 'parent1'
                                    ? 'Förälder 1 (Hemma)'
                                    : group.parent === 'parent2'
                                    ? 'Förälder 2 (Hemma)'
                                    : 'Båda föräldrarna hemma';
                                const workingParentLabel =
                                  group.parent === 'parent1'
                                    ? 'Förälder 2 (Arbetar)'
                                    : 'Förälder 1 (Arbetar)';
                                const uniqueDayLabels = Array.from(
                                  new Set(
                                    month.daysPerWeekValues.map(value =>
                                      value >= 7
                                        ? 'Heltid'
                                        : `${value} ${value === 1 ? 'dag' : 'dagar'}/vecka`
                                    )
                                  )
                                );
                                const daysPerWeekText =
                                  uniqueDayLabels.length === 1
                                    ? uniqueDayLabels[0]
                                    : `Varierar: ${uniqueDayLabels.join(' → ')}`;
                                const leaveIncome =
                                  group.parent === 'both' ? month.monthlyIncome : month.leaveParentIncome;
                                const workingIncome = group.parent === 'both' ? 0 : month.otherParentIncome;
                                const benefitIncome = month.benefitIncome;
                                const baseWorkingIncome = month.otherParentMonthlyBase;
                                const monthLength = month.monthLength;
                                const isFullMonthWorking =
                                  month.calendarDays >= monthLength &&
                                  month.startDate.getDate() === 1 &&
                                  month.endDate.getDate() === monthLength;
                                const shouldShowProration =
                                  group.parent !== 'both' &&
                                  baseWorkingIncome > 0 &&
                                  workingIncome > 0 &&
                                  monthLength > 0 &&
                                  !isFullMonthWorking;
                                return (
                                  <div
                                    key={`${month.startDate.toISOString()}-${monthIdx}`}
                                    className={`text-xs p-2 rounded space-y-1 ${
                                      isLowest
                                        ? 'bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-400'
                                        : isBelowMinimum
                                        ? 'bg-orange-50 dark:bg-orange-900/20 border border-orange-300'
                                        : 'bg-muted/30'
                                    }`}
                                  >
                                     <div className="font-medium flex items-center gap-2">
                                      <span>{format(month.startDate, 'd')} - {format(month.endDate, 'd MMM yyyy')}</span>
                                      {group.periods.some(p => p.benefitLevel === 'low') && (
                                        <Badge variant="outline" className="text-[9px] px-1 py-0 bg-orange-100 dark:bg-orange-900/30 border-orange-400">
                                          Lägstanivå
                                        </Badge>
                                      )}
                                    </div>
                                    <div className="text-muted-foreground space-y-0.5">
                                      <div>{month.calendarDays} kalenderdagar</div>
                                      {isInitialTenDayGroup ? (
                                        <div className="text-[10px]">• 2 x 10 uttagna dagar</div>
                                      ) : (
                                        <>
                                          {month.benefitDays > 0 && (
                                            <div className="text-[10px]">• {month.benefitDays} uttagna dagar totalt</div>
                                          )}
                                          {Object.entries(month.benefitDaysByLevel || {}).map(([level, days]) => {
                                            if (days === 0 || level === 'none') return null;
                                            const label = 
                                              level === 'parental-salary' ? 'Föräldralön (90%)' :
                                              level === 'high' ? 'Vanliga (80%)' :
                                              level === 'low' ? 'Lägstanivå (180kr/dag)' : 'Ingen';
                                            const daysPerWeek = Math.round(days / 4.33);
                                            return (
                                              <div key={level} className="text-[10px] pl-2">
                                                → {days} dagar {label} ({daysPerWeek} d/v)
                                              </div>
                                            );
                                          })}
                                        </>
                                      )}
                                    </div>
                                    <div className={`font-semibold ${isLowest ? 'text-yellow-700 dark:text-yellow-400' : isBelowMinimum ? 'text-orange-700 dark:text-orange-400' : 'text-foreground'}`}>
                                      Hushållets inkomst: {formatCurrency(aggregatedIncome)}
                                      {isLowest && <span className="ml-1 text-[9px]">(lägst)</span>}
                                    </div>
                                     <div className="font-medium">
                                       {leaveParentLabel}: {formatCurrency(leaveIncome)}
                                       {group.parent !== 'both' && (
                                         <span className="ml-1 text-muted-foreground">{daysPerWeekText}</span>
                                       )}
                                       {group.periods.some(p => p.benefitLevel === 'low') && benefitIncome > 0 && (
                                         <span className="ml-1 text-[9px] text-orange-600 dark:text-orange-400">
                                           (inkl. lägstanivå)
                                         </span>
                                       )}
                                     </div>
                                    {group.parent !== 'both' && (
                                      <div className="text-muted-foreground">
                                        {workingParentLabel}: {formatCurrency(workingIncome)}
                                        {shouldShowProration && (
                                          <span className="ml-1">
                                            ({formatCurrency(baseWorkingIncome)} × {month.calendarDays}/{monthLength})
                                          </span>
                                        )}
                                      </div>
                                    )}
                                     <div className="text-muted-foreground italic">
                                      Föräldrapenning: {formatCurrency(benefitIncome)}
                                    </div>
                                  </div>
                                );
                              })}
                              {/* Add household income summary at the bottom */}
                              {monthlyBreakdown.length > 0 && (
                                <div className="mt-3 p-2 bg-primary/10 rounded border border-primary/20">
                                  <div className="text-sm font-semibold">
                                    Total hushållsinkomst (alla månader): {formatCurrency(
                                      monthlyBreakdown.reduce((sum, month) => {
                                        const aggregatedInfo = aggregatedMonthMap.get(month.monthKey);
                                        return sum + (aggregatedInfo?.totalIncome ?? month.monthlyIncome);
                                      }, 0)
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                           <div className="font-semibold text-sm mt-2 pt-2 border-t border-border">
                            Periodinkomst: {formatCurrency(totalHouseholdIncome)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
