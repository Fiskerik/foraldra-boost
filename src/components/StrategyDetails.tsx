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
          {belowMinimum && (
            <Alert variant="destructive" className="mb-4">
              <AlertTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
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
                            {month.parentalSalaryIncome > 0 && (
                              <div>
                                <div className="text-sm text-muted-foreground">Föräldralön</div>
                                <div className="font-semibold">{formatCurrency(month.parentalSalaryIncome)}</div>
                              </div>
                            )}
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
