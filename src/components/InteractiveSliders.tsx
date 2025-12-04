import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatCurrency, LeavePeriod, calculateMaxLeaveMonths, TOTAL_BENEFIT_DAYS, quickOptimize, ParentData, WEEKS_PER_MONTH } from "@/utils/parentalCalculations";
import { StrategyIncomeSummary, calculateStrategyIncomeSummary } from "@/utils/incomeSummary";
import { TrendingUp, Calendar, Clock, Sparkles, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

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
  selectedStrategy: 'maximize-income' | 'save-days' | 'balanced';
  parent1: ParentData;
  parent2: ParentData;
  currentTotalIncome: number;
  currentDaysUsed: number;
  onHouseholdIncomeChange: (value: number) => void;
  onDaysPerWeekChange: (days: number) => void;
  onTotalMonthsChange: (months: number) => void;
  onRecalculate: () => void;
  onDistributionChange: (newParent1Months: number) => void;
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
  selectedStrategy,
  parent1,
  parent2,
  currentTotalIncome,
  currentDaysUsed,
  onHouseholdIncomeChange,
  onDaysPerWeekChange,
  onTotalMonthsChange,
  onRecalculate,
  onDistributionChange,
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

  const maxLeaveMonths = calculateMaxLeaveMonths(daysPerWeek);
  const monthsSliderMax = Math.max(maxLeaveMonths, totalMonths, 1);

  const totalIncomeBasis = useMemo(() => {
    const derivedTotalIncome = totalIncome ?? currentHouseholdIncome * totalMonths;
    if (Number.isFinite(derivedTotalIncome) && derivedTotalIncome > 0) {
      return derivedTotalIncome;
    }

    return Math.max(0, householdIncome * Math.max(totalMonths, 1));
  }, [totalIncome, currentHouseholdIncome, totalMonths, householdIncome]);

  const minimumIncomeBreakMonths = useMemo(() => {
    if (!householdIncome || householdIncome <= 0) return null;
    const breakpointMonths = totalIncomeBasis / householdIncome;
    if (!Number.isFinite(breakpointMonths) || breakpointMonths <= 0) return null;

    return Math.min(monthsSliderMax, Math.max(0, Math.round(breakpointMonths * 2) / 2));
  }, [householdIncome, totalIncomeBasis, monthsSliderMax]);

  const minimumIncomeBreakDaysPerWeek = useMemo(() => {
    if (!minimumIncomeBreakMonths || minimumIncomeBreakMonths <= 0) return null;

    const availableDays = daysUsed ?? TOTAL_BENEFIT_DAYS;
    const estimatedDaysPerWeek = availableDays / (minimumIncomeBreakMonths * WEEKS_PER_MONTH);

    if (!Number.isFinite(estimatedDaysPerWeek)) return null;

    return Math.min(7, Math.max(1, Math.round(estimatedDaysPerWeek * 10) / 10));
  }, [minimumIncomeBreakMonths, daysUsed]);

  // Calculate current parent 1 months from periods
  const currentParent1Months = useMemo(() => {
    if (!periods || periods.length === 0) return 0;
    
    // Calculate total calendar days for parent1, then convert to months
    const parent1CalendarDays = periods
      .filter(p => p.parent === 'parent1')
      .reduce((sum, p) => sum + p.calendarDays, 0);
    
    // Convert calendar days to months (30 days per month)
    return parent1CalendarDays / 30;
  }, [periods]);

  // Calculate alternative distributions with strategy-specific suggestions
  const alternativeDistributions = useMemo(() => {
    if (!parent1 || !parent2 || !periods || periods.length === 0) return [];
    
    const alternatives: Array<{
      parent1Months: number;
      parent2Months: number;
      daysSaved?: number;
      incomeGain?: number;
      message: string;
    }> = [];
    
    // Test +/- 1, 2, 3 months for parent 1
    for (const delta of [-3, -2, -1, 1, 2, 3]) {
      const testParent1Months = currentParent1Months + delta;
      const testParent2Months = totalMonths - testParent1Months;
      
      // Skip if invalid values
      if (testParent1Months < 0 || testParent2Months < 0) continue;
      if (testParent1Months > totalMonths || testParent2Months > totalMonths) continue;
      
      try {
        const testResult = quickOptimize({
          parent1,
          parent2,
          minHouseholdIncome: householdIncome,
          parent1Months: testParent1Months,
          parent2Months: testParent2Months,
          daysPerWeek,
          simultaneousLeave: false,
          simultaneousMonths: 0,
          strategy: selectedStrategy,
        });
        
        if (selectedStrategy === 'save-days') {
          const daysSaved = currentDaysUsed - testResult.daysUsed;
          if (daysSaved > 10) { // At least 10 days gain to be worth showing
            alternatives.push({
              parent1Months: testParent1Months,
              parent2Months: testParent2Months,
              daysSaved,
              message: `Om förälder 1 är hemma ${testParent1Months} månader istället för ${currentParent1Months} sparar ni ${daysSaved} dagar till`,
            });
          }
        } else if (selectedStrategy === 'maximize-income') {
          const incomeGain = testResult.totalIncome - currentTotalIncome;
          if (incomeGain > 5000) { // At least 5000 SEK gain to be worth showing
            alternatives.push({
              parent1Months: testParent1Months,
              parent2Months: testParent2Months,
              incomeGain,
              message: `Om förälder 1 är hemma ${testParent1Months} månader istället för ${currentParent1Months} blir total inkomsten ${Math.round(incomeGain).toLocaleString('sv-SE')} kr högre`,
            });
          }
        }
      } catch (error) {
        console.warn('Failed to calculate alternative distribution:', error);
      }
    }
    
    // Sort and return best alternative
    if (selectedStrategy === 'save-days') {
      return alternatives
        .sort((a, b) => (b.daysSaved || 0) - (a.daysSaved || 0))
        .slice(0, 1);
    } else {
      return alternatives
        .sort((a, b) => (b.incomeGain || 0) - (a.incomeGain || 0))
        .slice(0, 1);
    }
  }, [
    periods, 
    totalMonths, 
    selectedStrategy, 
    currentTotalIncome, 
    currentDaysUsed, 
    currentParent1Months,
    parent1,
    parent2,
    householdIncome,
    daysPerWeek,
  ]);

  const formattedTotalMonths = Number.isInteger(totalMonths)
    ? totalMonths
    : totalMonths.toFixed(1);

  const handleHouseholdIncomeChangeInternal = (value: number) => {
    const clamped = Math.min(Math.max(value, 0), maxHouseholdIncome);
    onHouseholdIncomeChange(clamped);
  };

  const handleTotalMonthsChangeInternal = (value: number) => {
    const nextMonths = Math.max(0, Math.min(value, monthsSliderMax));
    const dilutedIncome = totalIncomeBasis / Math.max(nextMonths || 1, 0.5);
    const adjustedIncome = Math.min(maxHouseholdIncome, Math.round(dilutedIncome));

    onTotalMonthsChange(nextMonths);

    if (adjustedIncome !== householdIncome) {
      onHouseholdIncomeChange(adjustedIncome);
    }
  };

  const handleDaysPerWeekChangeInternal = (value: number) => {
    const clampedDays = Math.max(1, Math.min(7, Math.round(value)));
    const availableDays = daysUsed ?? TOTAL_BENEFIT_DAYS;
    const newMaxMonths = calculateMaxLeaveMonths(clampedDays, availableDays);
    const adjustedMonths = Math.min(Math.max(totalMonths, 0), newMaxMonths);

    const concentratedIncome = totalIncomeBasis / Math.max(adjustedMonths || 1, 0.5);
    const adjustedIncome = Math.min(maxHouseholdIncome, Math.round(concentratedIncome));

    onDaysPerWeekChange(clampedDays);

    if (adjustedMonths !== totalMonths) {
      onTotalMonthsChange(adjustedMonths);
    }

    if (adjustedIncome !== householdIncome) {
      onHouseholdIncomeChange(adjustedIncome);
    }
  };

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
                <Input
                  type="number"
                  value={householdIncome}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 0;
                    handleHouseholdIncomeChangeInternal(val);
                  }}
                  onBlur={(e) => {
                    const val = parseInt(e.target.value);
                    if (isNaN(val)) handleHouseholdIncomeChangeInternal(0);
                  }}
                  min={0}
                  max={maxHouseholdIncome}
                  step={1000}
                  className="text-right text-sm font-bold text-primary border-0 bg-transparent p-0 h-auto w-28 focus-visible:ring-0 focus-visible:ring-offset-0"
                />
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
                    Målet går inte ihop • Justera värdena nedan för att nå målet
                  </p>
                </div>
              )}

              <div className="flex gap-2 md:gap-4 items-end">
                <div className="flex-1 relative pt-1 pb-4">
                  <Slider
                    value={[householdIncome]}
                    onValueChange={(values) => handleHouseholdIncomeChangeInternal(values[0])}
                    min={0}
                    max={maxHouseholdIncome}
                    step={1000}
                    className="py-2"
                  />
                </div>
                <div className="hidden md:block w-28 mb-4">
                  <Input
                    type="number"
                    value={householdIncome}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      handleHouseholdIncomeChangeInternal(val);
                    }}
                    onBlur={(e) => {
                      const val = parseInt(e.target.value);
                      if (isNaN(val)) handleHouseholdIncomeChangeInternal(0);
                    }}
                    min={0}
                    max={maxHouseholdIncome}
                    step={1000}
                    className="text-right text-xs md:text-sm h-8 md:h-10"
                  />
                </div>
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
              <div className="relative pt-1 pb-4">
                <Slider
                  value={[totalMonths]}
                  onValueChange={(values) => handleTotalMonthsChangeInternal(values[0])}
                  min={0}
                  max={monthsSliderMax}
                  step={0.5}
                  className="py-2"
                />
              </div>
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
              <div className="relative pt-1 pb-4">
                <Slider
                  value={[daysPerWeek]}
                  onValueChange={(values) => handleDaysPerWeekChangeInternal(values[0])}
                  min={1}
                  max={7}
                  step={1}
                  className="py-2"
                />
              </div>
            </div>


          </div>
          )}
        </Card>
      </div>
    </div>
  );
}
