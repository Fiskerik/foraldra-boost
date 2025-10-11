import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/utils/parentalCalculations";
import { TrendingUp, Calendar, Clock, Sparkles, ChevronDown, ChevronUp } from "lucide-react";

interface InteractiveSlidersProps {
  householdIncome: number;
  maxHouseholdIncome: number;
  daysPerWeek: number;
  currentHouseholdIncome: number; // Calculated based on current plan
  totalIncome?: number;
  daysUsed?: number;
  daysSaved?: number;
  onHouseholdIncomeChange: (value: number) => void;
  onDaysPerWeekChange: (days: number) => void;
}

export function InteractiveSliders({
  householdIncome,
  maxHouseholdIncome,
  daysPerWeek,
  currentHouseholdIncome,
  totalIncome,
  daysUsed,
  daysSaved,
  onHouseholdIncomeChange,
  onDaysPerWeekChange,
}: InteractiveSlidersProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const totalDaysValue = Math.max(0, daysUsed ?? 0);

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
                  Hushållets inkomst
                </Label>
                <span className="text-sm font-bold text-primary">
                  {formatCurrency(householdIncome)}
                </span>
              </div>
              <Slider
                value={[householdIncome]}
                onValueChange={(values) => onHouseholdIncomeChange(values[0])}
                min={0}
                max={maxHouseholdIncome}
                step={1000}
                className="py-2"
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium flex items-center gap-1">
                  <Calendar className="h-3 w-3 text-primary" />
                  Använda dagar
                </Label>
                <span className="text-sm font-bold text-primary">{totalDaysValue} <span className="text-[10px] text-muted-foreground">av 480</span></span>
              </div>
              <Slider
                value={[totalDaysValue]}
                min={0}
                max={480}
                step={1}
                disabled
                className="py-2 cursor-not-allowed opacity-80"
              />
              <p className="text-[10px] text-muted-foreground">
                Uppdateras automatiskt utifrån valt inkomstkrav och uttag per vecka.
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
        )}
      </Card>
    </div>
  );
}
