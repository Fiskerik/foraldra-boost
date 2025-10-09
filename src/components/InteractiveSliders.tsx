import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/utils/parentalCalculations";
import { TrendingUp, Users, Calendar, Sparkles } from "lucide-react";

interface InteractiveSlidersProps {
  householdIncome: number;
  maxHouseholdIncome: number;
  totalMonths: number;
  parent1Months: number;
  daysPerWeek: number;
  currentHouseholdIncome: number; // Calculated based on current plan
  totalIncome?: number;
  daysUsed?: number;
  daysSaved?: number;
  onHouseholdIncomeChange: (value: number) => void;
  onDistributionChange: (parent1Months: number) => void;
  onDaysPerWeekChange: (days: number) => void;
}

export function InteractiveSliders({
  householdIncome,
  maxHouseholdIncome,
  totalMonths,
  parent1Months,
  daysPerWeek,
  currentHouseholdIncome,
  totalIncome,
  daysUsed,
  daysSaved,
  onHouseholdIncomeChange,
  onDistributionChange,
  onDaysPerWeekChange,
}: InteractiveSlidersProps) {
  const parent2Months = totalMonths - parent1Months;

  return (
    <Card className="p-6 space-y-8 bg-card/50 backdrop-blur border-2">
      <div className="space-y-2">
        <h3 className="text-2xl font-bold flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-primary" />
          Justera plan
        </h3>
        <p className="text-sm text-muted-foreground">
          Justera parametrarna nedan för att se hur de påverkar er ekonomi
        </p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-primary/10 border border-primary/30 rounded-lg p-4">
          <p className="text-xs text-muted-foreground">Snitt månadsinkomst</p>
          <p className="text-2xl font-bold text-primary">{formatCurrency(currentHouseholdIncome)}</p>
        </div>
        <div className="bg-accent/10 border border-accent/30 rounded-lg p-4">
          <p className="text-xs text-muted-foreground">Total inkomst under perioden</p>
          <p className="text-2xl font-bold text-accent">{formatCurrency(totalIncome || 0)}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground">Använda dagar / Dagar kvar</p>
          <p className="text-2xl font-bold">{(daysUsed ?? 0)} / {(daysSaved ?? 0)}</p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <Label className="text-sm font-medium">Hushållets inkomst</Label>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="text-xl font-bold text-primary">
              {formatCurrency(householdIncome)}
            </span>
          </div>
        </div>
        <Slider
          value={[householdIncome]}
          onValueChange={(values) => onHouseholdIncomeChange(values[0])}
          min={0}
          max={maxHouseholdIncome}
          step={1000}
          className="py-4"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>0 kr</span>
          <span>{formatCurrency(maxHouseholdIncome)}</span>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <Label className="text-sm font-medium">Fördelning mellan föräldrar</Label>
          </div>
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
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-primary" />
            <Label className="text-sm font-medium">Uttag av dagar per vecka</Label>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold text-accent">
              {daysPerWeek} {daysPerWeek === 1 ? 'dag' : 'dagar'}
            </span>
          </div>
        </div>
        <Slider
          value={[daysPerWeek]}
          onValueChange={(values) => onDaysPerWeekChange(values[0])}
          min={1}
          max={7}
          step={1}
          className="py-4"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>1 dag/vecka</span>
          <span>7 dagar/vecka</span>
        </div>
      </div>
    </Card>
  );
}
