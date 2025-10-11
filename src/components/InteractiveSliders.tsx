import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { formatCurrency, LeavePeriod, calculateMaxLeaveMonths, TOTAL_BENEFIT_DAYS } from "@/utils/parentalCalculations";
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
  onHouseholdIncomeChange: (value: number) => void;
  onDaysPerWeekChange: (days: number) => void;
  onTotalMonthsChange: (months: number) => void;
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
  onHouseholdIncomeChange,
  onDaysPerWeekChange,
  onTotalMonthsChange,
}: InteractiveSlidersProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  
  // Calculate monthly income for each period
  // Monthly income = dailyIncome * days per month (approximated by daysPerWeek * 4.33)
  const calculatePeriodMonthlyIncome = (period: LeavePeriod): number => {
    const daysPerWeek = period.daysPerWeek || 5;
    const weeksPerMonth = 4.33;
    const householdDailyIncome = period.dailyIncome + (period.otherParentDailyIncome || 0);
    return householdDailyIncome * daysPerWeek * weeksPerMonth;
  };
  
  // Check if ANY individual period falls below minimum income requirement
  const lowestMonthlyIncome = periods.length > 0 
    ? Math.min(...periods.map(p => calculatePeriodMonthlyIncome(p)))
    : currentHouseholdIncome;
  
  const isBelowMinimum = lowestMonthlyIncome < householdIncome;
  
  // Calculate break-point on income slider - show where the lowest month is
  const incomeBreakPoint = isBelowMinimum ? lowestMonthlyIncome : null;
  const incomeBreakPointPercent = incomeBreakPoint
    ? Math.max(
        0,
        Math.min(100, ((incomeBreakPoint - 0) / (maxHouseholdIncome - 0)) * 100)
      )
    : null;

  const maxLeaveMonths = calculateMaxLeaveMonths(daysPerWeek);
  const monthsSliderMax = Math.max(maxLeaveMonths, totalMonths, 1);

  const formattedTotalMonths = Number.isInteger(totalMonths)
    ? totalMonths
    : totalMonths.toFixed(1);

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 animate-slide-in-bottom">
      <Card className="rounded-t-2xl rounded-b-none border-t-2 border-x-0 border-b-0 bg-card/95 backdrop-blur-lg shadow-2xl">
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
          <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
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
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium flex items-center gap-1">
                  <TrendingUp className="h-3 w-3 text-primary" />
                  Min hushållsinkomst
                </Label>
                <span className="text-sm font-bold text-primary">
                  {formatCurrency(householdIncome)}
                </span>
              </div>
              {isBelowMinimum && (
                <div className="flex items-center gap-1 text-[10px] text-destructive">
                  <AlertTriangle className="h-3 w-3" />
                  <span>Lägsta månaden: {formatCurrency(lowestMonthlyIncome)}. Sänk kravet eller öka uttag/vecka.</span>
                </div>
              )}
              <div className="relative pt-2 pb-10">
                <Slider
                  value={[householdIncome]}
                  onValueChange={(values) => onHouseholdIncomeChange(values[0])}
                  min={0}
                  max={maxHouseholdIncome}
                  step={1000}
                  className="py-2"
                />
                <div className="pointer-events-none absolute left-0 right-0 bottom-4 h-px bg-border" />
                {incomeBreakPointPercent !== null && isBelowMinimum && (
                  <div
                    className="pointer-events-none absolute left-0 right-0 bottom-4"
                    title={`Lägsta månad: ${formatCurrency(lowestMonthlyIncome)}`}
                  >
                    <div
                      className="absolute flex flex-col items-center"
                      style={{
                        left: `${incomeBreakPointPercent}%`,
                        transform: "translateX(-50%)",
                      }}
                    >
                      <div className="h-3 w-px bg-destructive" />
                      <div className="mt-1 rounded bg-background/90 px-1 text-[9px] font-semibold text-destructive whitespace-nowrap">
                        {formatCurrency(lowestMonthlyIncome)}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium flex items-center gap-1">
                  <Calendar className="h-3 w-3 text-primary" />
                  Månader lediga
                </Label>
                <span className="text-sm font-bold text-primary">
                  {formattedTotalMonths} {totalMonths === 1 ? 'månad' : 'månader'}
                </span>
              </div>
              {isBelowMinimum && (
                <div className="text-[10px] text-muted-foreground">
                  Minska antalet månader lediga för att öka inkomsten per månad
                </div>
              )}
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

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium flex items-center gap-1">
                  <Clock className="h-3 w-3 text-primary" />
                  Uttag per vecka
                </Label>
                <span className="text-sm font-bold text-accent">
                  {daysPerWeek} {daysPerWeek === 1 ? 'dag' : 'dagar'}
                </span>
              </div>
              {isBelowMinimum && (
                <div className="text-[10px] text-muted-foreground">
                  Öka uttag per vecka för att nå inkomstmålet snabbare
                </div>
              )}
              <div className="relative">
                <Slider
                  value={[daysPerWeek]}
                  onValueChange={(values) => onDaysPerWeekChange(values[0])}
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
  );
}
