import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/utils/parentalCalculations";

interface InteractiveSlidersProps {
  minHouseholdIncome: number;
  maxHouseholdIncome: number;
  totalMonths: number;
  parent1Months: number;
  daysPerWeek: number;
  onMinIncomeChange: (value: number) => void;
  onDistributionChange: (parent1Months: number) => void;
  onDaysPerWeekChange: (days: number) => void;
}

export function InteractiveSliders({
  minHouseholdIncome,
  maxHouseholdIncome,
  totalMonths,
  parent1Months,
  daysPerWeek,
  onMinIncomeChange,
  onDistributionChange,
  onDaysPerWeekChange,
}: InteractiveSlidersProps) {
  const parent2Months = totalMonths - parent1Months;

  return (
    <Card className="p-6 space-y-6 bg-card/50 backdrop-blur">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Hushållets minimiinkomst</Label>
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold text-primary">
              {formatCurrency(minHouseholdIncome)}
            </span>
          </div>
        </div>
        <Slider
          value={[minHouseholdIncome]}
          onValueChange={(values) => onMinIncomeChange(values[0])}
          min={10000}
          max={maxHouseholdIncome}
          step={1000}
          className="py-4"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>10 000 kr</span>
          <span>{formatCurrency(maxHouseholdIncome)}</span>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Fördelning mellan föräldrar</Label>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-parent1">
              F1: {parent1Months} mån
            </span>
            <span className="text-muted-foreground">•</span>
            <span className="text-sm font-semibold text-parent2">
              F2: {parent2Months} mån
            </span>
          </div>
        </div>
        <Slider
          value={[parent1Months]}
          onValueChange={(values) => onDistributionChange(values[0])}
          min={0}
          max={totalMonths}
          step={1}
          className="py-4"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Endast F2</span>
          <span>Endast F1</span>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Uttag av dagar per vecka</Label>
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold text-accent">
              {daysPerWeek} {daysPerWeek === 1 ? 'dag' : 'dagar'}
            </span>
          </div>
        </div>
        <Slider
          value={[daysPerWeek]}
          onValueChange={(values) => onDaysPerWeekChange(values[0])}
          min={0}
          max={7}
          step={1}
          className="py-4"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Inga dagar</span>
          <span>Alla dagar</span>
        </div>
      </div>

      <div className="pt-4 border-t">
        <p className="text-xs text-muted-foreground">
          Justera en parameter så anpassas de andra automatiskt för att optimera er ekonomi
        </p>
      </div>
    </Card>
  );
}
