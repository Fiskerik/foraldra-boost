import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { formatCurrency, LeavePeriod, calculateMaxLeaveMonths, TOTAL_BENEFIT_DAYS } from "@/utils/parentalCalculations";
import { StrategyIncomeSummary, calculateStrategyIncomeSummary } from "@/utils/incomeSummary";
import { TrendingUp, Calendar, Clock, Sparkles, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";

interface InteractiveSlidersProps {
  householdIncome: number;
  maxHouseholdIncome: number;
  daysPerWeek: number;
  totalMonths: number;
  currentHouseholdIncome: number; // Calculated based on current plan
  periods: LeavePeriod[];
  totalIncome?: number;
  daysUsed?: number;
  daysSaved?: number;
  strategyIncomeSummary?: StrategyIncomeSummary;
  hasUnappliedChanges: boolean;
  onHouseholdIncomeChange: (value: number) => void;
  onDaysPerWeekChange: (days: number) => void;
  onTotalMonthsChange: (months: number) => void;
  onRecalculate: () => void;
}

export function InteractiveSliders({
  householdIncome,
  maxHouseholdIncome,
  daysPerWeek,
  totalMonths,
  currentHouseholdIncome,
  periods,
  totalIncome,
  daysUsed,
  daysSaved,
  strategyIncomeSummary,
  hasUnappliedChanges,
  onHouseholdIncomeChange,
  onDaysPerWeekChange,
  onTotalMonthsChange,
  onRecalculate,
}: InteractiveSlidersProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const computedSummary = useMemo<StrategyIncomeSummary>(() => {
    if (strategyIncomeSummary) {
      return strategyIncomeSummary;
    }
    return calculateStrategyIncomeSummary(periods);
  }, [strategyIncomeSummary, periods]);

  const hasEligibleMonths =
    computedSummary.hasEligibleFullMonths &&
    computedSummary.lowestFullMonthIncome !== null &&
    Number.isFinite(computedSummary.lowestFullMonthIncome);

  const lowestMonthlyIncome = hasEligibleMonths && computedSummary.lowestFullMonthIncome !== null
    ? computedSummary.lowestFullMonthIncome
    : currentHouseholdIncome;

  const isBelowMinimum = hasEligibleMonths && lowestMonthlyIncome < householdIncome;

  // Calculate break-point on income slider - show where the lowest month is
  const incomeBreakPoint = hasEligibleMonths && computedSummary.lowestFullMonthIncome !== null
    ? computedSummary.lowestFullMonthIncome
    : null;
  const incomeBreakPointPercent = incomeBreakPoint !== null
    ? Math.max(0, Math.min(100, (incomeBreakPoint / Math.max(maxHouseholdIncome, 1)) * 100))
    : null;

  // Calculate recommended days per week if income requirement is below lowest month
  const recommendedDaysPerWeek = useMemo(() => {
    if (!isBelowMinimum || !hasEligibleMonths || computedSummary.lowestFullMonthIncome === null) return null;
    
    // Find the weakest period (where other parent earns the least when they're working)
    const periodsWithOtherIncome = periods.filter(p => 
      p.parent !== 'both' && (p.otherParentMonthlyIncome || 0) > 0
    );
    
    if (periodsWithOtherIncome.length === 0) return null;
    
    const weakestPeriod = periodsWithOtherIncome.reduce((min, p) => 
      (p.otherParentMonthlyIncome || 0) < (min.otherParentMonthlyIncome || 0) ? p : min
    );
    
    // Calculate income gap
    const incomeGap = householdIncome - (weakestPeriod.otherParentMonthlyIncome || 0);
    
    if (incomeGap <= 0) return null; // No gap = current setup works
    
    // Use actual dailyBenefit from the period
    const dailyBenefit = weakestPeriod.dailyBenefit || (1250 * 0.698);
    
    // Calculate how many days per month are needed
    const daysPerMonthNeeded = incomeGap / dailyBenefit;
    
    // Convert to days per week (4.33 weeks per month)
    const daysPerWeekNeeded = daysPerMonthNeeded / 4.33;
    
    // Round up to nearest whole number, max 7 days
    const recommended = Math.ceil(Math.max(1, Math.min(7, daysPerWeekNeeded)));
    
    return recommended;
  }, [isBelowMinimum, hasEligibleMonths, householdIncome, periods, computedSummary.lowestFullMonthIncome]);

  const recommendedDaysPercent = recommendedDaysPerWeek !== null
    ? ((recommendedDaysPerWeek - 1) / 6) * 100
    : null;

  const maxLeaveMonths = calculateMaxLeaveMonths(daysPerWeek);
  const monthsSliderMax = Math.max(maxLeaveMonths, totalMonths, 1);

  const formattedTotalMonths = Number.isInteger(totalMonths)
    ? totalMonths
    : totalMonths.toFixed(1);

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 animate-slide-in-bottom flex justify-center px-4 pb-4">
      <div className="w-full max-w-5xl">
        <Card className="w-full rounded-t-2xl rounded-b-none border-t-2 border-x-0 border-b-0 bg-card/95 backdrop-blur-lg shadow-2xl">
          {/* Header - Always visible */}
          <div className="flex items-center justify-between p-3 border-b cursor-pointer hover:bg-accent/5 transition-colors" onClick={() => setIsExpanded(!isExpanded)}>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-bold">Justera plan</h3>
          </div>
          <div className="flex items-center gap-4">
            {/* KPI Chips - Compact */}
            <div className="hidden md:flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Snitt:</span>
              <span className="font-bold text-primary">{formatCurrency(currentHouseholdIncome)}</span>
              <span className="text-muted-foreground mx-1">|</span>
              <span className="text-muted-foreground">Total:</span>
              <span className="font-bold text-accent">{formatCurrency(totalIncome || 0)}</span>
              <span className="text-muted-foreground mx-1">|</span>
              <span className="font-bold">{(daysUsed ?? 0)} / {(daysSaved ?? 0)} dagar</span>
            </div>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </Button>
          </div>
        </div>

          {/* Expandable Content */}
          {isExpanded && (
            <div className="p-3 space-y-3 max-h-[70vh] overflow-y-auto">
            {/* Mobile KPI Row */}
            <div className="grid grid-cols-3 gap-2 md:hidden">
              <div className="bg-primary/10 border border-primary/30 rounded p-2">
                <p className="text-[10px] text-muted-foreground">Snitt/mån</p>
                <p className="text-xs font-bold text-primary">{formatCurrency(currentHouseholdIncome)}</p>
              </div>
              <div className="bg-accent/10 border border-accent/30 rounded p-2">
                <p className="text-[10px] text-muted-foreground">Total</p>
                <p className="text-xs font-bold text-accent">{formatCurrency(totalIncome || 0)}</p>
              </div>
              <div className="bg-card border border-border rounded p-2">
                <p className="text-[10px] text-muted-foreground">Dagar</p>
                <p className="text-xs font-bold">{(daysUsed ?? 0)} / {(daysSaved ?? 0)}</p>
              </div>
            </div>

            {/* Sliders - Compact */}
            <div className="space-y-0.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium flex items-center gap-1">
                  <TrendingUp className="h-3 w-3 text-primary" />
                  Min hushållsinkomst
                </Label>
                <span className="text-sm font-bold text-primary">
                  {formatCurrency(householdIncome)}
                </span>
              </div>
              {hasUnappliedChanges && (
                <div className="flex items-center gap-1 text-[10px] text-destructive font-medium animate-fade-in">
                  <AlertTriangle className="h-3 w-3" />
                  <span>Förutsättningarna har ändrats</span>
                </div>
              )}

              {isBelowMinimum && (
                <div className="flex items-center justify-center gap-2 rounded-lg bg-amber-50 border border-amber-200 p-2 mb-3 max-w-fit mx-auto animate-fade-in">
                  <AlertTriangle className="h-3 w-3 text-amber-600 flex-shrink-0" />
                  <p className="text-[10px] text-amber-800">
                    Målet går inte ihop • Tryck på en pil <span className="text-green-600 font-bold">▼</span> för att justera
                  </p>
                </div>
              )}

              <div className="relative pt-1 pb-8">
                <Slider
                  value={[householdIncome]}
                  onValueChange={(values) => onHouseholdIncomeChange(values[0])}
                  min={0}
                  max={maxHouseholdIncome}
                  step={1000}
                  className="py-2"
                />
                <div className="pointer-events-none absolute left-0 right-0 bottom-4 h-px bg-border" />
                {incomeBreakPointPercent !== null && incomeBreakPoint !== null && (
                  <div
                    className="absolute left-0 right-0 bottom-4 cursor-pointer transition-transform hover:scale-110 z-10"
                    style={{ left: `${incomeBreakPointPercent}%`, transform: "translateX(-50%)" }}
                    onClick={() => onHouseholdIncomeChange(Math.round(incomeBreakPoint))}
                    title={`Klicka för att sänka till ${formatCurrency(incomeBreakPoint)}`}
                  >
              <div className="h-5 w-1 bg-amber-500" />
              <div className="mt-0.5 text-[14px] font-bold text-amber-600 pointer-events-none leading-none">
                ▼
              </div>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-0.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium flex items-center gap-1">
                  <Calendar className="h-3 w-3 text-primary" />
                  Månader lediga
                </Label>
                <span className="text-sm font-bold text-primary">
                  {formattedTotalMonths} {totalMonths === 1 ? 'månad' : 'månader'}
                </span>
              </div>
              <Slider
                value={[totalMonths]}
                onValueChange={(values) => onTotalMonthsChange(values[0])}
                min={0}
                max={monthsSliderMax}
                step={0.5}
                className="py-2"
              />
              <p className="text-[10px] text-muted-foreground">
                Totalt antal månader lediga. {daysUsed ?? 0} av {TOTAL_BENEFIT_DAYS} dagar används.
              </p>
            </div>

            <div className="space-y-0.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium flex items-center gap-1">
                  <Clock className="h-3 w-3 text-primary" />
                  Uttag per vecka
                </Label>
                <span className="text-sm font-bold text-accent">
                  {daysPerWeek} {daysPerWeek === 1 ? 'dag' : 'dagar'}
                </span>
              </div>
              <div className="relative pt-1 pb-8">
                <Slider
                  value={[daysPerWeek]}
                  onValueChange={(values) => onDaysPerWeekChange(values[0])}
                  min={1}
                  max={7}
                  step={1}
                  className="py-2"
                />
                <div className="pointer-events-none absolute left-0 right-0 bottom-4 h-px bg-border" />
                {recommendedDaysPercent !== null && recommendedDaysPerWeek !== null && isBelowMinimum && (
                  <div
                    className="absolute left-0 right-0 bottom-4 cursor-pointer transition-transform hover:scale-110 z-10"
                    style={{ left: `${recommendedDaysPercent}%`, transform: "translateX(-50%)" }}
                    onClick={() => onDaysPerWeekChange(recommendedDaysPerWeek)}
                    title={`Klicka för att använda ${recommendedDaysPerWeek} dagar/vecka`}
                  >
              <div className="h-5 w-1 bg-green-500" />
              <div className="mt-0.5 text-[14px] font-bold text-green-600 pointer-events-none leading-none">
                ▼
              </div>
                  </div>
                )}
              </div>
            </div>


          </div>
          )}
        </Card>
      </div>
    </div>
  );
}
