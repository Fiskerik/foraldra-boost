import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OptimizationResult, LeavePeriod, formatCurrency } from "@/utils/parentalCalculations";
import { TimelineChart } from "./TimelineChart";
import { TrendingUp, PiggyBank, Calendar, Users, Clock, AlertTriangle } from "lucide-react";
import { format, startOfMonth, endOfMonth, differenceInCalendarDays, addDays } from "date-fns";
import { sv } from "date-fns/locale";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { calculateStrategyIncomeSummary } from "@/utils/incomeSummary";

const capitalizeFirstLetter = (str: string) => {
  return str.charAt(0).toUpperCase() + str.slice(1);
};

interface StrategyDetailsProps {
  strategy: OptimizationResult;
  minHouseholdIncome: number;
  timelineMonths: number;
}

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
  parents: string[];
}

export function StrategyDetails({ strategy, minHouseholdIncome, timelineMonths }: StrategyDetailsProps) {
  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>({});

  const breakDownByMonth = (period: LeavePeriod): MonthlyBreakdown[] => {
    const startDate = new Date(period.startDate);
    const endDate = new Date(period.endDate);
    
    const rawBenefitDays = Math.max(0, Math.round(period.benefitDaysUsed ?? period.daysCount));
    const totalBenefitDays = rawBenefitDays;

    const segments: MonthlyBreakdown[] = [];
    let cursor = new Date(startDate);

    const normalizedDaysPerWeek = period.daysPerWeek && period.daysPerWeek > 0 ? period.daysPerWeek : 7;

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

    const daysPerWeek = period.daysPerWeek && period.daysPerWeek > 0 ? period.daysPerWeek : 7;
    const expectedBenefitDaysPerMonth = daysPerWeek * 4.33;

    let remainingBenefitDays = totalBenefitDays;

    segments.forEach((segment) => {
      if (remainingBenefitDays <= 0) {
        segment.benefitDays = 0;
      } else {
        const monthStart = startOfMonth(new Date(segment.startDate));
        const monthEndDate = endOfMonth(monthStart);
        const monthLength = Math.max(1, differenceInCalendarDays(monthEndDate, monthStart) + 1);
        const isFullMonth = segment.calendarDays >= monthLength;
        
        let allocated: number;
        if (isFullMonth) {
          allocated = Math.min(Math.round(expectedBenefitDaysPerMonth), 30, remainingBenefitDays);
        } else {
          const proportion = segment.calendarDays / monthLength;
          allocated = Math.min(Math.round(expectedBenefitDaysPerMonth * proportion), remainingBenefitDays);
        }
        
        segment.benefitDays = Math.max(0, allocated);
        remainingBenefitDays -= segment.benefitDays;
      }
      
      const benefitDaily = period.dailyBenefit;
      const monthStart = startOfMonth(new Date(segment.startDate));
      const monthEndDate = endOfMonth(monthStart);
      const monthLength = Math.max(1, differenceInCalendarDays(monthEndDate, monthStart) + 1);

      const isFullMonthSegment =
        segment.calendarDays >= monthLength &&
        new Date(segment.startDate).getDate() === 1 &&
        new Date(segment.endDate).getDate() === monthEndDate.getDate();

      // Handle "both parents on leave" case separately
      if (period.parent === 'both') {
        const totalIncome = Math.max(0, Math.round((period.dailyIncome || 0) * segment.calendarDays));
        segment.benefitIncome = totalIncome;
        segment.otherParentIncome = 0;
        segment.leaveParentIncome = totalIncome;
        segment.monthlyIncome = totalIncome;
        segment.daysPerWeekValue = normalizedDaysPerWeek;
        segment.otherParentMonthlyBase = 0;
        return;
      }

      // 1. Calculate working parent's income (exact net salary or prorated)
      let otherParentIncome = 0;
      if (period.otherParentMonthlyIncome) {
        if (isFullMonthSegment) {
          // Full month: use exact net salary
          otherParentIncome = period.otherParentMonthlyIncome;
        } else {
          // Partial month: prorate based on proportion of month
          const proportion = segment.calendarDays / monthLength;
          otherParentIncome = period.otherParentMonthlyIncome * proportion;
        }
        otherParentIncome = Math.max(0, Math.round(otherParentIncome));
      }

      // 2. Calculate benefit income
      let benefitIncome = 0;
      if (benefitDaily > 0 && segment.benefitDays > 0) {
        const benefitDaysForMonth = isFullMonthSegment ? Math.min(segment.benefitDays, 30) : segment.benefitDays;
        benefitIncome = benefitDaily * Math.max(0, Math.round(benefitDaysForMonth));
      }
      benefitIncome = Math.max(0, Math.round(benefitIncome));

      // 3. Calculate total monthly income
      const monthlyIncome = otherParentIncome + benefitIncome;

      // 4. Set segment data
      segment.benefitIncome = benefitIncome;
      segment.otherParentIncome = otherParentIncome;
      segment.leaveParentIncome = benefitIncome; // Leave parent only gets benefit
      segment.monthlyIncome = monthlyIncome;
      segment.daysPerWeekValue = normalizedDaysPerWeek;
      segment.otherParentMonthlyBase = period.otherParentMonthlyIncome || 0;
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
        const monthStart = startOfMonth(new Date(segment.startDate));
        const key = `${monthStart.getFullYear()}-${monthStart.getMonth()}`;
        const monthLength = differenceInCalendarDays(endOfMonth(monthStart), monthStart) + 1;
        const existing = monthMap.get(key);

        const parentLabel = period.parent === 'parent1' ? 'Parent 1' : period.parent === 'parent2' ? 'Parent 2' : 'Båda';

        if (!existing) {
          monthMap.set(key, {
            ...segment,
            startDate: new Date(segment.startDate),
            endDate: new Date(segment.endDate),
            monthKey: key,
            monthStart,
            monthLength,
            monthlyIncome: segment.monthlyIncome,
            daysPerWeekValues: [segment.daysPerWeekValue],
            benefitLevels: [segment.daysPerWeekValue > 0 ? period.benefitLevel : 'none'],
            benefitDaysByLevel: {
              [period.benefitLevel]: segment.benefitDays
            },
            parents: [parentLabel]
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
        
        if (!existing.benefitLevels.includes(period.benefitLevel)) {
          existing.benefitLevels.push(period.benefitLevel);
        }
        if (!existing.benefitDaysByLevel[period.benefitLevel]) {
          existing.benefitDaysByLevel[period.benefitLevel] = 0;
        }
        existing.benefitDaysByLevel[period.benefitLevel] += segment.benefitDays;
        
        if (!existing.parents.includes(parentLabel)) {
          existing.parents.push(parentLabel);
        }
      });
    });

    return Array.from(monthMap.values()).sort((a, b) => a.monthStart.getTime() - b.monthStart.getTime());
  };

  const filteredPeriods = strategy.periods;
  const monthlyBreakdown = createMonthlyBreakdownEntries(strategy.periods);
  const { lowestFullMonthIncome, hasEligibleFullMonths } = calculateStrategyIncomeSummary(filteredPeriods);
  const belowMinimum = hasEligibleFullMonths && (lowestFullMonthIncome ?? Infinity) < minHouseholdIncome;

  const getBenefitLevelLabel = (level: string): string => {
    switch (level) {
      case 'parental-salary': return 'Föräldrapenning + Föräldralön (90%)';
      case 'high': return 'Föräldrapenning (≈80%)';
      case 'low': return 'Lägstanivå (250 kr/dag)';
      default: return level;
    }
  };

  return (
    <div className="space-y-6">
      <Card className={`${strategy.strategy === 'save-days' ? 'border-parent1/30 bg-parent1/5' : 'border-parent2/30 bg-parent2/5'}`}>
        <CardHeader className={`${strategy.strategy === 'save-days' ? 'bg-parent1/10' : 'bg-parent2/10'}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-1 flex-1">
              <div className="flex items-center gap-2">
                <CardTitle className="text-2xl">{strategy.title}</CardTitle>
                {strategy.strategy === 'save-days' ? (
                  <PiggyBank className="h-6 w-6 text-parent1" />
                ) : (
                  <TrendingUp className="h-6 w-6 text-parent2" />
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {strategy.description}
              </p>
            </div>
          </div>
          
          <div className="grid grid-cols-3 gap-2 md:gap-4 mt-4">
            <div className="p-2 md:p-4 bg-background rounded-lg flex flex-col justify-between min-h-[80px] md:min-h-[100px]">
              <div className="text-xs md:text-sm text-muted-foreground mb-1">Total inkomst</div>
              <div className="text-xs md:text-xl font-bold break-words">{formatCurrency(strategy.totalIncome)}</div>
            </div>
            <div className="p-2 md:p-4 bg-background rounded-lg flex flex-col justify-between min-h-[80px] md:min-h-[100px]">
              <div className="text-xs md:text-sm text-muted-foreground mb-1">Dagar använda</div>
              <div className="text-xs md:text-xl font-bold break-words">{strategy.daysUsed}</div>
            </div>
            <div className="p-2 md:p-4 bg-background rounded-lg flex flex-col justify-between min-h-[80px] md:min-h-[100px]">
              <div className="text-xs md:text-sm text-muted-foreground mb-1">Dagar sparade</div>
              <div className="text-xs md:text-xl font-bold break-words">{strategy.daysSaved}</div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-6">
          {strategy.warnings?.map((warning, warningIndex) => (
            <Alert
              key={warningIndex}
              className="mb-4 border border-amber-300 bg-amber-50 text-amber-900"
            >
              <AlertTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Viktigt att veta
              </AlertTitle>
              <AlertDescription>{warning}</AlertDescription>
            </Alert>
          ))}

          {belowMinimum && (
            <Alert variant="destructive" className="mb-4">
              <AlertTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Under minimi-inkomst
              </AlertTitle>
              <AlertDescription>
                Minsta fulla månaden är {formatCurrency(lowestFullMonthIncome!)}. Dagar/vecka har ökats där det gick, men dagarna räckte inte. Ändra fördelning eller min-inkomst.
              </AlertDescription>
            </Alert>
          )}
          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Tidslinje
            </h3>
            <TimelineChart periods={filteredPeriods} minHouseholdIncome={minHouseholdIncome} calendarMonthsLimit={timelineMonths} />
          </div>

          <div className="mt-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Users className="h-5 w-5" />
              Månad för månad
            </h3>
            <div className="space-y-2">
              {monthlyBreakdown.map((month) => {
                const isExpanded = expandedMonths[month.monthKey] ?? false;
                const isFullMonth = month.calendarDays >= month.monthLength;

                return (
                  <Card 
                    key={month.monthKey}
                    className="cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => setExpandedMonths(prev => ({ ...prev, [month.monthKey]: !prev[month.monthKey] }))}
                  >
                    <CardContent className="p-3 md:p-4">
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                        <div className="flex-1 w-full">
                          <div className="font-semibold flex items-center gap-2 flex-wrap">
                            {capitalizeFirstLetter(format(month.monthStart, 'MMMM yyyy', { locale: sv }))}
                            {!isFullMonth && (
                              <Badge variant="outline" className="text-xs">
                                {month.calendarDays} dagar
                              </Badge>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-1 mt-2">
                            {month.parents.map((parent, idx) => (
                              <Badge 
                                key={idx}
                                className={
                                  parent === 'Parent 1' 
                                    ? 'bg-parent1/20 text-parent1 border-parent1/30' 
                                    : parent === 'Parent 2'
                                    ? 'bg-parent2/20 text-parent2 border-parent2/30'
                                    : 'bg-both/20 text-purple-700 border-purple-300'
                                }
                                variant="outline"
                              >
                                {parent}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <div className="text-left sm:text-right w-full sm:w-auto">
                          <div className="font-bold text-base md:text-lg">{formatCurrency(month.monthlyIncome)}</div>
                          <div className="text-xs md:text-sm text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {month.benefitDays} dagar
                          </div>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="mt-4 pt-4 border-t space-y-2">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <div className="text-sm text-muted-foreground">Föräldrapenning</div>
                              <div className="font-semibold">{formatCurrency(month.benefitIncome)}</div>
                            </div>
                            <div>
                              <div
                                className="text-sm text-muted-foreground"
                                title="Visar nettolönen för föräldern som jobbar. För hela månader: full nettolön. För brutna månader: proportionell del."
                              >
                                Arbetande förälder (lön)
                              </div>
                              <div className="font-semibold">{formatCurrency(month.otherParentIncome)}</div>
                            </div>
                          </div>
                          
                          <div className="mt-3">
                            <div className="text-sm text-muted-foreground mb-1">Typ av dagar:</div>
                            <div className="flex flex-wrap gap-2">
                              {Object.entries(month.benefitDaysByLevel).map(([level, days]) => (
                                days > 0 && (
                                  <Badge key={level} variant="secondary" className="text-xs">
                                    {getBenefitLevelLabel(level)}: {days} dagar
                                  </Badge>
                                )
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
