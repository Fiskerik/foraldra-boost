import { useEffect, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Calendar, Users, DollarSign, LineChart, Target } from "lucide-react";
import { TOTAL_BENEFIT_DAYS, ParentData, optimizeLeave } from "@/utils/parentalCalculations";
import { IncomeDistributionGraph } from "./IncomeDistributionGraph";

interface LeavePeriodCardProps {
  totalMonths: number;
  parent1Months: number;
  parent2Months: number;
  minHouseholdIncome: number;
  maxHouseholdIncome: number;
  maxLeaveMonths: number;
  onTotalMonthsChange: (months: number) => void;
  onDistributionChange: (parent1Months: number) => void;
  onMinIncomeChange: (income: number) => void;
  simultaneousLeave: boolean;
  simultaneousMonths: number;
  onSimultaneousLeaveChange: (value: boolean) => void;
  onSimultaneousMonthsChange: (months: number) => void;
  parent1Data?: ParentData;
  parent2Data?: ParentData;
  selectedStrategy?: 'maximize-income' | 'save-days';
  onStrategyPreferenceSelect?: (strategy: 'maximize-income' | 'save-days') => void;
}

export function LeavePeriodCard({
  totalMonths,
  parent1Months,
  parent2Months,
  minHouseholdIncome,
  maxHouseholdIncome,
  maxLeaveMonths,
  onTotalMonthsChange,
  onDistributionChange,
  onMinIncomeChange,
  simultaneousLeave,
  simultaneousMonths,
  onSimultaneousLeaveChange,
  onSimultaneousMonthsChange,
  parent1Data,
  parent2Data,
  selectedStrategy = 'maximize-income',
  onStrategyPreferenceSelect,
}: LeavePeriodCardProps) {
  const [monthsInputValue, setMonthsInputValue] = useState(() =>
    Number.isInteger(totalMonths) ? totalMonths.toString() : totalMonths.toFixed(1)
  );
  const [showGraph, setShowGraph] = useState(false);

  useEffect(() => {
    const formatted = Number.isInteger(totalMonths)
      ? totalMonths.toString()
      : totalMonths.toFixed(1);
    setMonthsInputValue(formatted);
  }, [totalMonths]);

  const sanitizeMonthsValue = (value: string) => value.replace(',', '.');

  const isParsableNumber = (value: string) => {
    if (value.trim() === "") {
      return false;
    }
    const normalized = sanitizeMonthsValue(value);
    if (normalized.endsWith(".")) {
      return false;
    }
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed);
  };

  const clampMonths = (value: number) => {
    const safeValue = Math.max(0, value);
    return Math.min(safeValue, maxLeaveMonths);
  };

  const handleMonthsInputChange = (value: string) => {
    setMonthsInputValue(value);

    if (!isParsableNumber(value)) {
      return;
    }

    const parsed = Number.parseFloat(sanitizeMonthsValue(value));
    if (parsed >= 0 && parsed <= maxLeaveMonths) {
      onTotalMonthsChange(parsed);
    }
  };

  const handleMonthsInputBlur = () => {
    const normalized = sanitizeMonthsValue(monthsInputValue);
    const parsed = Number.parseFloat(normalized);

    if (!Number.isFinite(parsed)) {
      const formatted = Number.isInteger(totalMonths)
        ? totalMonths.toString()
        : totalMonths.toFixed(1);
      setMonthsInputValue(formatted);
      return;
    }

    const clamped = clampMonths(parsed);
    onTotalMonthsChange(clamped);
  };

  const formattedMaxLeaveMonths = Number.isInteger(maxLeaveMonths)
    ? maxLeaveMonths.toString()
    : maxLeaveMonths.toFixed(1);

  const findOptimalDistribution = (
    strategy: 'maximize-income' | 'save-days'
  ): number | null => {
    if (!parent1Data || !parent2Data || totalMonths <= 0) {
      return null;
    }

    const step = totalMonths > 12 ? 1 : 0.5;
    let bestValue = -Infinity;
    let bestSecondaryValue = -Infinity;
    let bestParent1Months: number | null = null;

    for (let parent1M = 0; parent1M <= totalMonths; parent1M += step) {
      const parent2M = totalMonths - parent1M;
      const results = optimizeLeave(
        parent1Data,
        parent2Data,
        totalMonths,
        parent1M,
        parent2M,
        minHouseholdIncome,
        7,
        simultaneousLeave ? simultaneousMonths : 0,
        false
      );

      const target = results.find(result => result.strategy === strategy);
      if (!target) {
        continue;
      }

      const isSaveDays = strategy === 'save-days';
      const primaryValue = isSaveDays ? target.daysSaved : target.totalIncome;
      const fallbackDaysSaved = TOTAL_BENEFIT_DAYS - (target.daysUsed ?? 0);
      const safePrimaryValue = Number.isFinite(primaryValue)
        ? primaryValue
        : isSaveDays
          ? fallbackDaysSaved
          : 0;
      const secondaryValue = isSaveDays
        ? target.totalIncome
        : Number.isFinite(target.daysSaved)
          ? target.daysSaved
          : fallbackDaysSaved;

      if (
        safePrimaryValue > bestValue ||
        (safePrimaryValue === bestValue && secondaryValue > bestSecondaryValue)
      ) {
        bestValue = safePrimaryValue;
        bestSecondaryValue = secondaryValue;
        bestParent1Months = parent1M;
      }
    }

    return bestParent1Months;
  };

  const handleStrategyButtonClick = (strategy: 'maximize-income' | 'save-days') => {
    const optimalParent1Months = findOptimalDistribution(strategy);
    if (optimalParent1Months !== null) {
      onDistributionChange(optimalParent1Months);
    }

    if (onStrategyPreferenceSelect) {
      onStrategyPreferenceSelect(strategy);
    }
  };

  return (
    <Card className="shadow-card">
      <CardHeader className="p-2 md:p-6">
        <CardTitle className="text-sm md:text-2xl">Ledighetsperiod</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 md:space-y-8 p-2 md:p-6">
        <div className="space-y-1 md:space-y-3">
          <Label htmlFor="total-months" className="text-[10px] md:text-base font-medium flex items-center gap-1">
            <Calendar className="h-2.5 md:h-4 w-2.5 md:w-4" />
            Hur länge vill ni vara lediga?
          </Label>
          <Input
            id="total-months"
            type="number"
            step="0.5"
            inputMode="decimal"
            value={monthsInputValue}
            onChange={(e) => handleMonthsInputChange(e.target.value)}
            onBlur={handleMonthsInputBlur}
            className="text-xs md:text-lg font-semibold"
          />
          <p className="text-[10px] md:text-sm text-muted-foreground">
            Ange antal månader (upp till {formattedMaxLeaveMonths} månader baserat på {TOTAL_BENEFIT_DAYS} dagar)
          </p>
        </div>

        {totalMonths > 0 && (
          <>
            <div className="space-y-3 md:space-y-4 pt-4 md:pt-6 border-t border-border">
              <div className="space-y-1.5 md:space-y-2">
                <Label className="text-[10px] md:text-base font-medium flex items-center gap-1">
                  <Target className="h-2.5 md:h-4 w-2.5 md:w-4" />
                  Klicka på det som passar er bäst
                </Label>
                <p className="text-[10px] md:text-sm text-muted-foreground">
                  Föredrar ni att spara dagar, eller att få ut så mycket ersättning som möjligt under föräldraledigheten?
                </p>
                <div className="flex flex-col md:flex-row gap-2 md:gap-3">
                  <Button
                    type="button"
                    className={`flex-1 bg-green-600 hover:bg-green-700 text-white ${selectedStrategy === 'save-days' ? 'ring-2 ring-green-300' : ''}`}
                    onClick={() => handleStrategyButtonClick('save-days')}
                  >
                    Spara dagar
                  </Button>
                  <Button
                    type="button"
                    className={`flex-1 bg-blue-600 hover:bg-blue-700 text-white ${selectedStrategy === 'maximize-income' ? 'ring-2 ring-blue-300' : ''}`}
                    onClick={() => handleStrategyButtonClick('maximize-income')}
                  >
                    Maximera inkomst
                  </Button>
                </div>
              </div>

              <div className="space-y-2 md:space-y-4 pt-4 md:pt-6 border-t border-border">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1 text-[10px] md:text-base">
                    <Users className="h-2.5 md:h-4 w-2.5 md:w-4" />
                    Vill ni vara hemma samtidigt?
                  </Label>
                  <Switch
                    checked={simultaneousLeave}
                    onCheckedChange={onSimultaneousLeaveChange}
                  />
                </div>

                {simultaneousLeave && (
                  <div className="space-y-2 pl-3 md:pl-6 animate-fade-in">
                    <Label className="text-[10px] md:text-sm">Antal månader samtidigt</Label>
                    <Input
                      type="number"
                      step={1}
                      min={0}
                      max={Math.floor(totalMonths / 2)}
                      value={simultaneousMonths}
                      onChange={(e) => {
                        const parsed = Math.max(0, Math.round(Number(e.target.value)));
                        onSimultaneousMonthsChange(Number.isFinite(parsed) ? parsed : 0);
                      }}
                    />
                    <p className="text-xs text-muted-foreground">
                      När ni är hemma samtidigt använder båda föräldrar dagar från sina egna pooler samtidigt. Ingen lön utbetalas, men båda får föräldrapenning. Om en förälder planerar att vara hemma totalt minst 6 månader i följd (samtidig + egen ledighet) tas föräldralön automatiskt under den samtidiga perioden.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2 md:space-y-4 pt-4 md:pt-6 border-t border-border">
              <Label className="text-[10px] md:text-base font-medium flex items-center gap-1">
                <Users className="h-2.5 md:h-4 w-2.5 md:w-4" />
                Hur vill ni dela upp ledigheten?
              </Label>
              <div className="space-y-1.5 md:space-y-3 -mx-2 md:-mx-6 px-2 md:px-6">
                <div className="relative h-6 md:h-12 rounded-full overflow-hidden bg-parent2">
                  <div
                    className="absolute top-0 left-0 h-full bg-parent1 transition-all duration-300"
                    style={{
                      width: `${(parent1Months / totalMonths) * 100}%`,
                    }}
                  />
                  <div className="absolute inset-0 flex items-center justify-between px-2 md:px-6 text-[10px] md:text-sm font-bold text-white">
                    <span className="z-10">Förälder 1</span>
                    <span className="z-10">Förälder 2</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 md:gap-4">
                  <div className="flex-1">
                    <Slider
                      min={0}
                      max={totalMonths}
                      step={1}
                      value={[parent1Months]}
                      onValueChange={(values) => onDistributionChange(values[0])}
                      className="[&_[role=slider]]:bg-primary [&_[role=slider]]:border-primary"
                    />
                  </div>
                  {parent1Data && parent2Data && (
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setShowGraph(!showGraph)}
                      className="h-8 w-8 md:h-10 md:w-10 shrink-0"
                    >
                      <LineChart className="h-3 w-3 md:h-4 md:w-4" />
                    </Button>
                  )}
                </div>
                <div className="flex justify-between text-[10px] md:text-sm font-medium">
                  <span className="text-parent1">
                    {Math.round(parent1Months)} månader
                  </span>
                  <span className="text-parent2">
                    {Math.round(parent2Months)} månader
                  </span>
                </div>
                {showGraph && parent1Data && parent2Data && (
                  <div className="pb-10 md:pb-0">
                    <IncomeDistributionGraph
                      totalMonths={totalMonths}
                      currentParent1Months={parent1Months}
                      minHouseholdIncome={minHouseholdIncome}
                      parent1Data={parent1Data}
                      parent2Data={parent2Data}
                      simultaneousLeave={simultaneousLeave}
                      simultaneousMonths={simultaneousMonths}
                      selectedStrategy={selectedStrategy}
                      onDistributionClick={(months) => onDistributionChange(months)}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-1.5 md:space-y-3 pt-4 md:pt-6 border-t border-border">
              <Label htmlFor="min-income" className="text-[10px] md:text-base font-medium flex items-center gap-1">
                <DollarSign className="h-2.5 md:h-4 w-2.5 md:w-4" />
                Hushållets minimum inkomst per månad (netto)
              </Label>
              <div className="space-y-1 md:space-y-2">
                <Slider
                  id="min-income"
                  min={0}
                  max={maxHouseholdIncome}
                  step={1000}
                  value={[minHouseholdIncome]}
                  onValueChange={(values) => onMinIncomeChange(values[0])}
                  className="slider-single"
                />
                <div className="text-right">
                  <span className="text-sm md:text-xl font-bold text-accent">
                    {new Intl.NumberFormat('sv-SE', {
                      style: 'currency',
                      currency: 'SEK',
                      maximumFractionDigits: 0
                    }).format(minHouseholdIncome)}
                  </span>
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
