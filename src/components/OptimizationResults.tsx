import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OptimizationResult, formatPeriod, formatCurrency, LeavePeriod } from "@/utils/parentalCalculations";
import { TimelineChart } from "./TimelineChart";
import { Calendar, TrendingUp, PiggyBank, Users, Clock, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { format, endOfMonth, differenceInCalendarDays, addDays } from "date-fns";

interface OptimizationResultsProps {
  results: OptimizationResult[];
  minHouseholdIncome: number;
  selectedIndex: number;
  onSelectStrategy: (index: number) => void;
  timelineMonths: number;
}

export function OptimizationResults({ results, minHouseholdIncome, selectedIndex, onSelectStrategy, timelineMonths }: OptimizationResultsProps) {
  const [expandedPeriods, setExpandedPeriods] = useState<Record<string, boolean>>({});

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
  }

  const breakDownByMonth = (period: LeavePeriod): MonthlyBreakdown[] => {
    const startDate = new Date(period.startDate);
    const endDate = new Date(period.endDate);
    const totalBenefitDays = Math.max(0, Math.round(period.daysCount));

    const segments: MonthlyBreakdown[] = [];
    let cursor = new Date(startDate);

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
      });

      cursor = addDays(monthEnd, 1);
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
        segment.monthlyIncome = 0;
        return;
      }

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
      
      // Calculate monthly income for this segment
      // dailyIncome is the household daily income rate
      // Multiply by actual calendar days to get the income for this segment
      const dailyIncomeRate = period.dailyIncome;
      const actualMonthlyIncome = dailyIncomeRate * segment.calendarDays;
      segment.monthlyIncome = actualMonthlyIncome;
      
      remainingBenefitDays -= allocated;
      carryOver = rawShare - allocated;
    });

    if (remainingBenefitDays !== 0 && segments.length > 0) {
      segments[segments.length - 1].benefitDays += remainingBenefitDays;
    }

    return segments;
  };

  const mergeMonthlySegments = (segments: MonthlyBreakdown[]): MonthlyBreakdown[] => {
    if (segments.length === 0) {
      return [];
    }

    const monthMap = new Map<string, MonthlyBreakdown>();

    segments.forEach(segment => {
      const key = `${segment.startDate.getFullYear()}-${segment.startDate.getMonth()}`;
      const existing = monthMap.get(key);

      if (!existing) {
        monthMap.set(key, { ...segment });
        return;
      }

      existing.startDate = existing.startDate < segment.startDate ? existing.startDate : segment.startDate;
      existing.endDate = existing.endDate > segment.endDate ? existing.endDate : segment.endDate;
      existing.calendarDays += segment.calendarDays;
      existing.benefitDays += segment.benefitDays;
      existing.monthlyIncome += segment.monthlyIncome;
    });

    return Array.from(monthMap.values()).sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
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
    <div className="space-y-8">
      <div className="text-center space-y-2">
        <h2 className="text-3xl font-bold">Optimeringsförslag</h2>
        <p className="text-sm text-muted-foreground">
          * Föräldrapenning baseras på 7 dagar per vecka
        </p>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {results.map((result, index) => {
          // Find the absolute lowest monthly income across ALL periods in this strategy
          // Only consider full months (calendarDays === 30) to avoid partial months
          const filteredPeriods = result.periods.filter(period => period.benefitLevel !== 'none');
          const periodGroups = groupConsecutivePeriods(filteredPeriods);
          const groupMonthlyBreakdowns = periodGroups.map(group =>
            mergeMonthlySegments(group.periods.flatMap(breakDownByMonth))
          );

          const allMonthlyBreakdowns: Array<MonthlyBreakdown & { groupIndex: number }> = [];
          groupMonthlyBreakdowns.forEach((months, groupIndex) => {
            months.forEach(month => {
              allMonthlyBreakdowns.push({ ...month, groupIndex });
            });
          });

          const fullMonths = allMonthlyBreakdowns.filter(m => m.calendarDays === 30);
          const lowestMonthlyIncome = fullMonths.length > 0
            ? Math.min(...fullMonths.map(m => m.monthlyIncome))
            : Infinity;

          const isLowestBelowMinimum = lowestMonthlyIncome < minHouseholdIncome;

          return (
          <Card
            key={index} 
            className={`shadow-soft cursor-pointer transition-all ${
              selectedIndex === index 
                ? 'ring-4 ring-primary shadow-xl scale-[1.02]' 
                : 'hover:shadow-lg'
            }`}
            onClick={() => onSelectStrategy(index)}
          >
            <CardHeader className={`${result.strategy === 'save-days' ? 'bg-parent1/10' : 'bg-parent2/10'}`}>
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <CardTitle className="text-2xl">{result.title}</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {result.description}
                  </p>
                </div>
                {result.strategy === 'save-days' ? (
                  <PiggyBank className="h-8 w-8 text-parent1" />
                ) : (
                  <TrendingUp className="h-8 w-8 text-parent2" />
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-muted rounded-lg">
                    <div className="text-sm text-muted-foreground mb-1">Total inkomst</div>
                    <div className="text-xl font-bold">{formatCurrency(result.totalIncome)}</div>
                  </div>
                  <div className="p-4 bg-muted rounded-lg">
                    <div className="text-sm text-muted-foreground mb-1">Genomsnitt/mån</div>
                    <div className="text-xl font-bold">{formatCurrency(result.averageMonthlyIncome)}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-accent/10 rounded-lg border border-accent/20">
                    <div className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Dagar använda
                    </div>
                    <div className="text-xl font-bold">{result.daysUsed}</div>
                  </div>
                  <div className="p-4 bg-accent/10 rounded-lg border border-accent/20">
                    <div className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
                      <PiggyBank className="h-3 w-3" />
                      Dagar sparade
                    </div>
                    <div className="text-xl font-bold text-accent">{result.daysSaved}</div>
                  </div>
                </div>
              </div>
              
              <TimelineChart
                periods={result.periods}
                minHouseholdIncome={minHouseholdIncome}
                calendarMonthsLimit={timelineMonths}
              />

              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Calendar className="h-4 w-4" />
                  <span>Ledighetsperioder</span>
                </div>
                
                <div className="space-y-3">
                  {periodGroups.map((group, groupIndex) => {
                    const firstPeriod = group.periods[0];
                    const lastPeriod = group.periods[group.periods.length - 1];
                    const parentColor =
                      group.parent === 'both' ? 'accent' :
                      group.parent === 'parent1' ? 'parent1' : 'parent2';

                    const parentLabel =
                      group.parent === 'both' ? 'Båda föräldrarna' :
                      group.parent === 'parent1' ? 'Förälder 1' : 'Förälder 2';

                    const uniqueBenefitLabels = Array.from(new Set(group.periods.map(segment =>
                      segment.benefitLevel === 'parental-salary'
                        ? 'Föräldralön (90%)'
                        : segment.benefitLevel === 'high'
                        ? 'Hög föräldrapenning (80%)'
                        : 'Låg föräldrapenning'
                    )));
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

                    const totalCalendarDays = group.periods.reduce((sum, segment) => {
                      const days = Math.max(1, differenceInCalendarDays(segment.endDate, segment.startDate) + 1);
                      return sum + days;
                    }, 0);
                    const totalHouseholdIncome = group.periods.reduce((sum, segment) => {
                      const days = Math.max(1, differenceInCalendarDays(segment.endDate, segment.startDate) + 1);
                      return sum + segment.dailyIncome * days;
                    }, 0);
                    const totalBenefitIncome = group.periods.reduce((sum, segment) => {
                      const days = Math.max(1, differenceInCalendarDays(segment.endDate, segment.startDate) + 1);
                      return sum + segment.dailyBenefit * days;
                    }, 0);
                    const totalOtherIncome = group.periods.reduce((sum, segment) => {
                      const days = Math.max(1, differenceInCalendarDays(segment.endDate, segment.startDate) + 1);
                      return sum + (segment.otherParentDailyIncome || 0) * days;
                    }, 0);

                    const householdMonthlyIncome = totalCalendarDays > 0 ? (totalHouseholdIncome / totalCalendarDays) * 30 : 0;
                    const leaveBenefitMonthly = totalCalendarDays > 0 ? (totalBenefitIncome / totalCalendarDays) * 30 : 0;
                    const otherParentMonthlyIncome = totalCalendarDays > 0 ? (totalOtherIncome / totalCalendarDays) * 30 : 0;
                    const leaveParentMonthlyIncome = householdMonthlyIncome - otherParentMonthlyIncome;

                    const monthlyBreakdown = groupMonthlyBreakdowns[groupIndex];
                    const periodTotalIncome = monthlyBreakdown.reduce((sum, month) => sum + month.monthlyIncome, 0);
                    const periodContainsLowest = monthlyBreakdown.some(
                      month => month.calendarDays === 30 && month.monthlyIncome === lowestMonthlyIncome
                    );
                    const shouldBeOrange = periodContainsLowest && isLowestBelowMinimum;

                    const expandKey = `${index}-${groupIndex}`;
                    const isExpanded = expandedPeriods[expandKey];
                    const hasMultipleMonths = monthlyBreakdown.length > 1;
                    const totalDaysUsed = group.periods.reduce((sum, segment) => sum + segment.daysCount, 0);
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
                              {totalDaysUsed} dagar
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
                                const isFullMonth = month.calendarDays === 30;
                                const isLowest = isFullMonth && month.monthlyIncome === lowestMonthlyIncome;
                                const isBelowMinimum = isFullMonth && month.monthlyIncome < minHouseholdIncome;
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
                                    <div className="font-medium">
                                      {format(month.startDate, 'd')} - {format(month.endDate, 'd MMM yyyy')}
                                    </div>
                                    <div className="text-muted-foreground">
                                      {month.calendarDays} kalenderdagar • {month.benefitDays} uttagna dagar
                                    </div>
                                    <div className={`font-semibold ${isLowest ? 'text-yellow-700 dark:text-yellow-400' : isBelowMinimum ? 'text-orange-700 dark:text-orange-400' : 'text-foreground'}`}>
                                      Hushållets inkomst: {formatCurrency(month.monthlyIncome)}
                                      {isLowest && <span className="ml-1 text-[9px]">(lägst)</span>}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {group.parent !== 'both' && (
                            <div className="mt-2 p-2 bg-muted/50 rounded space-y-1">
                              {uniqueDaysPerWeekLabels.every(label => label !== 'Heltid') ? (
                                <>
                                  <div className="text-xs text-muted-foreground">
                                    Lediga förälderns totala inkomst: {formatCurrency(leaveParentMonthlyIncome)}/mån
                                  </div>
                                  <div className="text-xs text-muted-foreground italic pl-2">
                                    (varav {formatCurrency(leaveBenefitMonthly)}/mån föräldrapenning)
                                  </div>
                                </>
                              ) : (
                                <div className="text-xs text-muted-foreground">
                                  Lediga förälderns ersättning: {formatCurrency(leaveBenefitMonthly)}/mån
                                </div>
                              )}
                              <div className="text-xs text-muted-foreground">
                                Arbetande förälderns lön (netto): {formatCurrency(otherParentMonthlyIncome)}/mån
                              </div>
                              <div className="text-xs font-semibold border-t border-border pt-1 mt-1">
                                Hushållets månadsinkomst: {formatCurrency(householdMonthlyIncome)}
                              </div>
                            </div>
                          )}
                          <div className="font-semibold text-sm mt-2 pt-2 border-t border-border">
                            Periodinkomst: {formatCurrency(periodTotalIncome)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>
          );
        })}
      </div>
    </div>
  );
}
