import { useEffect, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Calendar, Users, DollarSign } from "lucide-react";
import { TOTAL_BENEFIT_DAYS } from "@/utils/parentalCalculations";

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
}: LeavePeriodCardProps) {
  const [monthsInputValue, setMonthsInputValue] = useState(() =>
    Number.isInteger(totalMonths) ? totalMonths.toString() : totalMonths.toFixed(1)
  );

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

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="text-2xl">Ledighetsperiod</CardTitle>
      </CardHeader>
      <CardContent className="space-y-8">
        <div className="space-y-3">
          <Label htmlFor="total-months" className="text-base font-medium flex items-center gap-2">
            <Calendar className="h-4 w-4" />
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
            className="text-lg font-semibold"
          />
          <p className="text-sm text-muted-foreground">
            Ange antal månader (upp till {formattedMaxLeaveMonths} månader baserat på {TOTAL_BENEFIT_DAYS} dagar)
          </p>
        </div>

        {totalMonths > 0 && (
          <>
            <div className="space-y-4">
              <Label className="text-base font-medium flex items-center gap-2">
                <Users className="h-4 w-4" />
                Hur vill ni dela upp ledigheten?
              </Label>
              <div className="space-y-3">
                <div className="relative h-12 rounded-full overflow-hidden bg-parent2">
                  <div
                    className="absolute top-0 left-0 h-full bg-parent1 transition-all duration-300"
                    style={{
                      width: `${(parent1Months / totalMonths) * 100}%`,
                    }}
                  />
                  <div className="absolute inset-0 flex items-center justify-between px-6 text-sm font-bold text-white">
                    <span className="z-10">Förälder 1</span>
                    <span className="z-10">Förälder 2</span>
                  </div>
                </div>
                <Slider
                  min={0}
                  max={totalMonths}
                  step={0.5}
                  value={[parent1Months]}
                  onValueChange={(values) => onDistributionChange(values[0])}
                  className="[&_[role=slider]]:bg-primary [&_[role=slider]]:border-primary"
                />
                <div className="flex justify-between text-sm font-medium">
                  <span className="text-parent1">
                    {parent1Months.toFixed(1)} månader
                  </span>
                  <span className="text-parent2">
                    {parent2Months.toFixed(1)} månader
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2 text-base">
                  <Users className="h-4 w-4" />
                  Vill ni vara hemma samtidigt?
                </Label>
                <Switch
                  checked={simultaneousLeave}
                  onCheckedChange={onSimultaneousLeaveChange}
                />
              </div>
              
              {simultaneousLeave && (
                <div className="space-y-2 pl-6 animate-fade-in">
                  <Label>Antal månader samtidigt</Label>
                  <Input
                    type="number"
                    min={0}
                    max={Math.floor(totalMonths / 2)}
                    value={simultaneousMonths}
                    onChange={(e) => onSimultaneousMonthsChange(Number(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Utöver de 10 obligatoriska dagarna
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <Label htmlFor="min-income" className="text-base font-medium flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                Hushållets minimum inkomst per månad (netto)
              </Label>
              <div className="space-y-2">
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
                  <span className="text-xl font-bold text-accent">
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
