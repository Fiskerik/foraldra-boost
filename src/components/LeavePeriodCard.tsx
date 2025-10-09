import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Calendar, Users, DollarSign } from "lucide-react";

interface LeavePeriodCardProps {
  totalMonths: number;
  parent1Months: number;
  parent2Months: number;
  minHouseholdIncome: number;
  maxHouseholdIncome: number;
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
  onTotalMonthsChange,
  onDistributionChange,
  onMinIncomeChange,
  simultaneousLeave,
  simultaneousMonths,
  onSimultaneousLeaveChange,
  onSimultaneousMonthsChange,
}: LeavePeriodCardProps) {
  const handleMonthsInputChange = (value: string) => {
    const parsed = parseInt(value);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 16) {
      onTotalMonthsChange(parsed);
    }
  };

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
            min="1"
            max="16"
            value={totalMonths}
            onChange={(e) => handleMonthsInputChange(e.target.value)}
            className="text-lg font-semibold"
          />
          <p className="text-sm text-muted-foreground">
            Ange antal månader (max 16 månader = 480 dagar)
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
