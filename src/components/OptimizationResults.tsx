import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OptimizationResult, formatPeriod, formatCurrency, LeavePeriod } from "@/utils/parentalCalculations";
import { TimelineChart } from "./TimelineChart";
import { Calendar, TrendingUp, PiggyBank, Users, Clock, ChevronDown, ChevronUp, Check, X, Save, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [overlayIndex, setOverlayIndex] = useState<number | null>(null);

  const togglePeriod = (resultIndex: number, periodIndex: number) => {
    const key = `${resultIndex}-${periodIndex}`;
    setExpandedPeriods(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleCardClick = (index: number) => {
    if (overlayOpen && overlayIndex !== null) {
      // If overlay is open, switch to the clicked strategy
      setOverlayIndex(index);
    } else {
      // Open overlay with clicked strategy
      setOverlayIndex(index);
      setOverlayOpen(true);
    }
  };

  const closeOverlay = () => {
    setOverlayOpen(false);
    setOverlayIndex(null);
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
    
    // Skip periods with benefitLevel 'none' entirely - they're calendar fillers
    // representing both parents working (no leave)
    if ((period.benefitLevel as string) === 'none') {
      return [];
    }
    
    // Only treat actual compensated days as benefit days
    const rawBenefitDays = Math.max(0, Math.round(period.benefitDaysUsed ?? period.daysCount));
    const totalBenefitDays = rawBenefitDays;

    const segments: MonthlyBreakdown[] = [];
    let cursor = new Date(startDate);

    const normalizedDaysPerWeek =
      period.daysPerWeek && period.daysPerWeek > 0
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
      period.daysPerWeek && period.daysPerWeek > 0
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

        const maxAllowedOtherIncome = Math.max(0, totalSegmentIncome - benefitIncome);

        otherParentIncome = Math.min(
          Math.max(0, Math.round(baseOtherIncome)),
          Math.max(0, Math.round(maxAllowedOtherIncome))
        );
      }

      // Leave parent's income representation for the breakdown
      let leaveParentIncome: number;
      if (period.parent === 'both') {
        leaveParentIncome = totalSegmentIncome;
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

    const sorted = [...periodList].sort((a, b) => {
      const dateA = a.startDate instanceof Date ? a.startDate : new Date(a.startDate);
      const dateB = b.startDate instanceof Date ? b.startDate : new Date(b.startDate);
      return dateA.getTime() - dateB.getTime();
    });
    const groups: PeriodGroup[] = [];

    sorted.forEach(period => {
      const lastGroup = groups[groups.length - 1];
      const lastSegment = lastGroup?.periods[lastGroup.periods.length - 1];

      const periodStartDate = period.startDate instanceof Date ? period.startDate : new Date(period.startDate);
      const lastEndDate = lastSegment?.endDate instanceof Date ? lastSegment.endDate : (lastSegment?.endDate ? new Date(lastSegment.endDate) : null);

      const canGroup =
        lastGroup &&
        lastEndDate &&
        lastGroup.parent === period.parent &&
        differenceInCalendarDays(periodStartDate, addDays(lastEndDate, 1)) === 0;

      if (canGroup) {
        lastGroup.periods.push(period);
      } else {
        groups.push({ parent: period.parent, periods: [period] });
      }
    });

    return groups;
  };

  // Render strategy card function
  const renderStrategyCard = (result: OptimizationResult, index: number, isInOverlay: boolean = false) => {
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

    const strategyIcon = result.strategy === 'save-days'
      ? <PiggyBank className="h-5 w-5 md:h-8 md:w-8 text-parent1 flex-shrink-0" />
      : <TrendingUp className="h-5 w-5 md:h-8 md:w-8 text-parent2 flex-shrink-0" />;

    return (
      <Card
        key={index}
        className={`shadow-soft transition-all cursor-pointer hover:shadow-lg ${
          selectedIndex === index
            ? 'ring-2 md:ring-4 ring-primary shadow-xl'
            : ''
        }`}
        onClick={() => !isInOverlay && handleCardClick(index)}
      >
        <CardHeader className={`${result.strategy === 'save-days' ? 'bg-parent1/10' : 'bg-parent2/10'} p-2 md:p-6 relative`}>
          {isInOverlay && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2 z-10"
              onClick={(e) => {
                e.stopPropagation();
                closeOverlay();
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-0.5 md:space-y-1 flex-1">
              <div className="flex items-center gap-2">
                {isInOverlay && strategyIcon}
                <CardTitle className="text-sm md:text-2xl">{result.title}</CardTitle>
              </div>
              <p className="text-[10px] md:text-sm text-muted-foreground">
                {result.description}
              </p>
            </div>
            <div className="flex items-center gap-1.5 md:gap-3">
              {!isInOverlay && (
                <>
                  <Button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectStrategy(index);
                    }}
                    variant={selectedIndex === index ? "default" : "outline"}
                    size="sm"
                    className="flex-shrink-0"
                  >
                    {selectedIndex === index ? (
                      <>
                        <Check className="h-3 w-3 md:h-4 md:w-4 mr-1" />
                        <span className="text-xs md:text-sm">Vald</span>
                      </>
                    ) : (
                      <span className="text-xs md:text-sm">Välj</span>
                    )}
                  </Button>
                  {strategyIcon}
                </>
              )}
            </div>
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
              {result.parent1HighDaysUsed !== undefined && (
                <div className="text-[8px] md:text-xs text-muted-foreground mt-0.5 space-y-1">
                  <div>
                    <div className="font-semibold">Förälder 1:</div>
                    <div>{result.parent1HighDaysUsed} vanliga, {result.parent1LowDaysUsed} lägstanivå</div>
                  </div>
                  <div>
                    <div className="font-semibold">Förälder 2:</div>
                    <div>{result.parent2HighDaysUsed} vanliga, {result.parent2LowDaysUsed} lägstanivå</div>
                  </div>
                </div>
              )}
            </div>
            <div className="p-1.5 md:p-4 bg-accent/10 rounded-lg border border-accent/20">
              <div className="text-[9px] md:text-sm text-muted-foreground mb-0.5 flex items-center gap-0.5 md:gap-1">
                <PiggyBank className="h-2 w-2 md:h-3 md:w-3" />
                Dagar sparade
              </div>
              <div className="text-xs md:text-xl font-bold text-accent">{result.daysSaved}</div>
              {result.parent1HighDaysSaved !== undefined && (
                <div className="text-[8px] md:text-xs text-muted-foreground mt-0.5 space-y-1">
                  <div>
                    <div className="font-semibold">Förälder 1:</div>
                    <div>{result.parent1HighDaysSaved} vanliga, {result.parent1LowDaysSaved} lägstanivå</div>
                  </div>
                  <div>
                    <div className="font-semibold">Förälder 2:</div>
                    <div>{result.parent2HighDaysSaved} vanliga, {result.parent2LowDaysSaved} lägstanivå</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {isInOverlay && result.warnings?.length ? (
            <div className="mt-2 md:mt-4 space-y-1">
              {result.warnings.map((warning, warningIndex) => (
                <div
                  key={warningIndex}
                  className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-100/80 p-1.5 md:p-2"
                >
                  <AlertTriangle className="mt-0.5 h-3 w-3 text-amber-600 md:h-4 md:w-4" />
                  <p className="text-[10px] md:text-sm text-amber-900 leading-snug">{warning}</p>
                </div>
              ))}
            </div>
          ) : null}
        </CardHeader>
        
        {/* Collapsible Details - Only in overlay */}
        {isInOverlay && (
          <CardContent className="pt-3 md:pt-6 space-y-3 md:space-y-6 p-2 md:p-6">
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
                <p className="text-xs text-muted-foreground">Detaljerad periodvy kommer snart.</p>
              </div>
            </div>

            {/* Save button in overlay */}
            <div className="flex justify-center pt-6 mt-6 border-t">
              <Button 
                size="lg"
                onClick={(e) => {
                  e.stopPropagation();
                  closeOverlay();
                  setTimeout(() => {
                    document.getElementById('save-plan-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }, 300);
                }}
                className="w-full md:w-auto"
              >
                <Save className="mr-2 h-5 w-5" />
                Spara denna plan
              </Button>
            </div>
          </CardContent>
        )}
      </Card>
    );
  };

  return (
    <>
      <div className="space-y-4 md:space-y-8">
        <div className="text-center space-y-1 md:space-y-2">
          <h2 className="text-lg md:text-3xl font-bold">Optimeringsförslag</h2>
          <p className="text-[10px] md:text-sm text-muted-foreground">
            * Föräldrapenning baseras på 7 dagar per vecka
          </p>
        </div>
        
        {/* Grid view - always visible */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-6">
          {results.map((result, index) => renderStrategyCard(result, index, false))}
        </div>
      </div>

      {/* Overlay */}
      {overlayOpen && overlayIndex !== null && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-fade-in"
          onClick={(e) => {
            // Allow clicking on background cards to switch
            if (e.target === e.currentTarget) {
              // Don't close, just ignore
            }
          }}
        >
          <div 
            className="w-full max-w-4xl max-h-[90vh] overflow-y-auto animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            {renderStrategyCard(results[overlayIndex], overlayIndex, true)}
          </div>
        </div>
      )}
    </>
  );
}
