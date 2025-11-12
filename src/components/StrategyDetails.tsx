import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OptimizationResult, formatCurrency } from "@/utils/parentalCalculations";
import { TimelineChart } from "./TimelineChart";
import { TrendingUp, PiggyBank, Calendar, Users, Clock, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import { useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { calculateStrategyIncomeSummary, buildMonthlyBreakdownEntries, MonthlyBreakdownEntry } from "@/utils/incomeSummary";

const capitalizeFirstLetter = (str: string) => {
  return str.charAt(0).toUpperCase() + str.slice(1);
};

interface StrategyDetailsProps {
  strategy: OptimizationResult;
  minHouseholdIncome: number;
  timelineMonths: number;
}

export function StrategyDetails({ strategy, minHouseholdIncome, timelineMonths }: StrategyDetailsProps) {
  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>({});
  const filteredPeriods = strategy.periods;
  const monthlyBreakdown = buildMonthlyBreakdownEntries(strategy.periods);
  const {
    lowestFullMonthIncome,
    hasEligibleFullMonths,
    lowestFullMonthLabel,
  } = calculateStrategyIncomeSummary(filteredPeriods);
  const belowMinimum = hasEligibleFullMonths && (lowestFullMonthIncome ?? Infinity) < minHouseholdIncome;
  const minimumDeficit = lowestFullMonthIncome != null
    ? Math.max(0, minHouseholdIncome - lowestFullMonthIncome)
    : 0;

  const minimumWarningVariant = useMemo<"destructive" | "warning">(() => {
    if (!belowMinimum || !lowestFullMonthIncome || minHouseholdIncome <= 0) {
      return "destructive";
    }

    const deficitRatio = (minHouseholdIncome - lowestFullMonthIncome) / minHouseholdIncome;
    if (deficitRatio <= 0.05) {
      return "warning";
    }

    return "destructive";
  }, [belowMinimum, lowestFullMonthIncome, minHouseholdIncome]);

  const minimumWarningSuggestion = useMemo(() => {
    if (!strategy.warnings?.length) {
      return null;
    }

    const target = strategy.warnings.find((warning) => {
      const normalized = warning.toLowerCase();
      return normalized.includes('minimikrav') || normalized.includes('minimi');
    });

    if (!target) {
      return null;
    }

    const lower = target.toLowerCase();
    const triggerKeywords = ['överväg', 'öka', 'justera', 'förkorta'];
    const triggerIndex = triggerKeywords
      .map(keyword => lower.indexOf(keyword))
      .filter(index => index >= 0)
      .sort((a, b) => a - b)[0];

    if (triggerIndex !== undefined) {
      return target.slice(triggerIndex).trim();
    }

    const secondSentenceIndex = target.indexOf('. ');
    if (secondSentenceIndex >= 0 && secondSentenceIndex + 2 < target.length) {
      return target.slice(secondSentenceIndex + 2).trim();
    }

    return target.trim();
  }, [strategy.warnings]);

  const getBenefitLevelLabel = (level: string): string => {
    switch (level) {
      case 'parental-salary': return 'Föräldrapenning + Föräldralön';
      case 'high': return 'Föräldrapenning';
      case 'low': return 'Lägstanivå (250 kr/dag)';
      default: return level;
    }
  };

  const getBenefitBadgeStyles = (level: string): string => {
    switch (level) {
      case 'parental-salary':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'low':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'high':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      default:
        return 'bg-muted text-muted-foreground border-muted';
    }
  };

  const incomeBreakdown = useMemo(() => {
    const totals = {
      parent1: { benefit: 0, salary: 0, wage: 0 },
      parent2: { benefit: 0, salary: 0, wage: 0 },
    };

    strategy.periods.forEach(period => {
      const calendarDays = Math.max(0, period.calendarDays ?? 0);
      const benefitDays = Math.max(0, period.benefitDaysUsed ?? period.daysCount ?? 0);
      const dailyBenefit = Math.max(0, period.dailyBenefit ?? 0);
      const benefitIncome = dailyBenefit * benefitDays;
      const parentalSalaryIncome = Math.max(0, period.collectiveAgreementTotalBonus ?? 0);
      const otherDailyIncome = Math.max(0, period.otherParentDailyIncome ?? 0);
      const otherIncome = otherDailyIncome * calendarDays;

      if (period.parent === "parent1") {
        totals.parent1.benefit += benefitIncome;
        totals.parent1.salary += parentalSalaryIncome;
        totals.parent2.wage += otherIncome;
      } else if (period.parent === "parent2") {
        totals.parent2.benefit += benefitIncome;
        totals.parent2.salary += parentalSalaryIncome;
        totals.parent1.wage += otherIncome;
      } else if (period.parent === "both") {
        const splitBenefit = benefitIncome / 2;
        const splitSalary = parentalSalaryIncome / 2;
        totals.parent1.benefit += splitBenefit;
        totals.parent2.benefit += splitBenefit;
        totals.parent1.salary += splitSalary;
        totals.parent2.salary += splitSalary;
      }
    });

    const normalize = (value: number) => Math.max(0, Math.round(value));

    return {
      parent1: {
        parentalBenefit: normalize(totals.parent1.benefit),
        parentalSalary: normalize(totals.parent1.salary),
        wage: normalize(totals.parent1.wage),
      },
      parent2: {
        parentalBenefit: normalize(totals.parent2.benefit),
        parentalSalary: normalize(totals.parent2.salary),
        wage: normalize(totals.parent2.wage),
      },
    };
  }, [strategy.periods]);

  const dayBreakdown = useMemo(() => {
    if (
      strategy.parent1HighDaysUsed === undefined ||
      strategy.parent1LowDaysUsed === undefined ||
      strategy.parent2HighDaysUsed === undefined ||
      strategy.parent2LowDaysUsed === undefined
    ) {
      return null;
    }

    return {
      parent1: {
        high: Math.max(0, strategy.parent1HighDaysUsed),
        low: Math.max(0, strategy.parent1LowDaysUsed),
      },
      parent2: {
        high: Math.max(0, strategy.parent2HighDaysUsed),
        low: Math.max(0, strategy.parent2LowDaysUsed),
      },
    };
  }, [
    strategy.parent1HighDaysUsed,
    strategy.parent1LowDaysUsed,
    strategy.parent2HighDaysUsed,
    strategy.parent2LowDaysUsed,
  ]);

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
            <div className="p-2 md:p-4 bg-background rounded-lg flex flex-col gap-2 min-h-[80px] md:min-h-[100px]">
              <div className="text-xs md:text-sm text-muted-foreground mb-1">Total inkomst</div>
              <div className="text-xs md:text-xl font-bold break-words">{formatCurrency(strategy.totalIncome)}</div>
              {strategy.parent1TotalIncome !== undefined && strategy.parent2TotalIncome !== undefined && (
                <div className="mt-2 space-y-1 text-[10px] md:text-xs text-muted-foreground">
                  <div>
                    <div className="font-semibold">Förälder 1: {formatCurrency(strategy.parent1TotalIncome)}</div>
                    <div className="ml-2 text-[9px] md:text-[11px] space-y-0.5">
                      <div>FP: {formatCurrency(incomeBreakdown.parent1.parentalBenefit)}</div>
                      {incomeBreakdown.parent1.parentalSalary > 0 && (
                        <div>FL: {formatCurrency(incomeBreakdown.parent1.parentalSalary)}</div>
                      )}
                      {incomeBreakdown.parent1.wage > 0 && (
                        <div>Lön: {formatCurrency(incomeBreakdown.parent1.wage)}</div>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="font-semibold">Förälder 2: {formatCurrency(strategy.parent2TotalIncome)}</div>
                    <div className="ml-2 text-[9px] md:text-[11px] space-y-0.5">
                      <div>FP: {formatCurrency(incomeBreakdown.parent2.parentalBenefit)}</div>
                      {incomeBreakdown.parent2.parentalSalary > 0 && (
                        <div>FL: {formatCurrency(incomeBreakdown.parent2.parentalSalary)}</div>
                      )}
                      {incomeBreakdown.parent2.wage > 0 && (
                        <div>Lön: {formatCurrency(incomeBreakdown.parent2.wage)}</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="p-2 md:p-4 bg-background rounded-lg flex flex-col gap-2 min-h-[80px] md:min-h-[100px]">
              <div className="text-xs md:text-sm text-muted-foreground mb-1">Dagar använda</div>
              <div className="text-xs md:text-xl font-bold break-words">{strategy.daysUsed}</div>
              {dayBreakdown && (
                <div className="mt-2 space-y-1 text-[10px] md:text-xs text-muted-foreground">
                  <div>
                    <div className="font-semibold">Förälder 1:</div>
                    <div className="text-[9px] md:text-[11px]">{dayBreakdown.parent1.high} vanliga, {dayBreakdown.parent1.low} lägsta</div>
                  </div>
                  <div>
                    <div className="font-semibold">Förälder 2:</div>
                    <div className="text-[9px] md:text-[11px]">{dayBreakdown.parent2.high} vanliga, {dayBreakdown.parent2.low} lägsta</div>
                  </div>
                </div>
              )}
            </div>
            <div className="p-2 md:p-4 bg-background rounded-lg flex flex-col justify-between min-h-[80px] md:min-h-[100px]">
              <div className="text-xs md:text-sm text-muted-foreground mb-1">Dagar sparade</div>
              <div className="text-xs md:text-xl font-bold break-words">{strategy.daysSaved}</div>
              {strategy.parent1HighDaysSaved !== undefined && (
                <div className="mt-2 space-y-1 text-[10px] md:text-xs text-muted-foreground">
                  <div>
                    <div className="font-semibold">Förälder 1:</div>
                    <div className="text-[9px] md:text-[11px]">{strategy.parent1HighDaysSaved} vanliga, {strategy.parent1LowDaysSaved} lägsta</div>
                  </div>
                  <div>
                    <div className="font-semibold">Förälder 2:</div>
                    <div className="text-[9px] md:text-[11px]">{strategy.parent2HighDaysSaved} vanliga, {strategy.parent2LowDaysSaved} lägsta</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-6">
          {belowMinimum && (
            <Alert variant={minimumWarningVariant} className="mb-4">
              <AlertTitle className="flex items-center gap-2">
                <AlertTriangle className={`h-4 w-4 ${minimumWarningVariant === 'warning' ? 'text-amber-500' : ''}`} />
                Under minimi-inkomst
              </AlertTitle>
              <AlertDescription>
                {lowestFullMonthLabel ? (
                  <>
                    Hushållets lägsta helmånad är {lowestFullMonthLabel} med en inkomst på {formatCurrency(lowestFullMonthIncome!)}.
                  </>
                ) : (
                  <>Minsta fulla månaden är {formatCurrency(lowestFullMonthIncome!)}.</>
                )}
                {minimumDeficit > 0 && (
                  <span className="block mt-1">
                    Det är {formatCurrency(minimumDeficit)} under minimikravet på {formatCurrency(minHouseholdIncome)}.
                  </span>
                )}
                <span className="block mt-1">
                  Dagar/vecka har ökats där det gick, men dagarna räckte inte. Överväg att justera fördelningen eller höj minimiinkomsten.
                </span>
                {minimumWarningSuggestion && (
                  <span className="block mt-2 text-sm text-muted-foreground">
                    {minimumWarningSuggestion}
                  </span>
                )}
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
                const lowLevelDays = Math.round(month.benefitDaysByLevel["low"] ?? 0);

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
                                    : 'bg-both/20 text-both border-both/30'
                                }
                                variant="outline"
                              >
                                {parent}
                              </Badge>
                            ))}
                          </div>
                          {lowLevelDays > 0 && (
                            <div className="mt-2 inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                              <span className="inline-block h-2 w-2 rounded-sm bg-amber-500" />
                              Lägstanivå: {lowLevelDays} dagar
                            </div>
                          )}
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
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                              <div className="text-sm text-muted-foreground">Föräldrapenning</div>
                              <div className="font-semibold">{formatCurrency(month.benefitIncome)}</div>
                            </div>
                            <div>
                              <div className="text-sm text-muted-foreground">Föräldralön</div>
                              <div
                                className={
                                  month.parentalSalaryIncome > 0
                                    ? 'font-semibold'
                                    : 'text-muted-foreground font-medium'
                                }
                              >
                                {month.parentalSalaryIncome > 0
                                  ? formatCurrency(month.parentalSalaryIncome)
                                  : '–'}
                              </div>
                            </div>
                            <div>
                              <div
                                className="text-sm text-muted-foreground"
                                title="Visar nettolönen för föräldern som jobbar. För hela månader: full nettolön. För brutna månader: proportionell del."
                              >
                                Arbetande förälder (lön)
                              </div>
                              <div className="font-semibold">{formatCurrency(month.otherParentIncome)}</div>
                              {!isFullMonth && month.otherParentIncome > 0 && (
                                <div className="mt-1 text-xs font-semibold text-amber-500">
                                  Bruten månadslön
                                </div>
                              )}
                            </div>
                          </div>

                        <div className="mt-3">
                          <div className="text-sm text-muted-foreground mb-1">Typ av dagar:</div>
                            <div className="flex flex-wrap gap-2">
                              {Object.entries(month.benefitDaysByLevel).map(([level, days]) => {
                                const roundedDays = Math.round(days);
                                if (roundedDays <= 0) {
                                  return null;
                                }
                                
                                // Skip showing "high" benefit badge if "parental-salary" exists
                                // because parental-salary already includes the high benefit
                                if (level === 'high' && month.benefitDaysByLevel['parental-salary'] > 0) {
                                  return null;
                                }

                                return (
                                  <Badge
                                    key={level}
                                    variant="outline"
                                    className={`text-xs ${getBenefitBadgeStyles(level)}`}
                                  >
                                    {getBenefitLevelLabel(level)}: {roundedDays} dagar
                                  </Badge>
                                );
                              })}
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
