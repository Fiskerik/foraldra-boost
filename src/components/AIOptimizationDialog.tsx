import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles, Lightbulb, CheckCircle2, TrendingUp, PiggyBank, Info } from "lucide-react";

interface AIOptimizationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: {
    optimalParent1Months: number;
    explanation: string;
    tips: string[];
    expectedTotalIncome?: number;
    expectedDaysSaved?: number;
  } | null;
  totalMonths: number;
  onApply: (parent1Months: number) => void;
  defaultsFootnote?: string | null;
}

export function AIOptimizationDialog({
  open,
  onOpenChange,
  result,
  totalMonths,
  onApply,
  defaultsFootnote,
}: AIOptimizationDialogProps) {
  if (!result) return null;

  const parent2Months = totalMonths - result.optimalParent1Months;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Sparkles className="h-5 w-5 text-primary" />
            AI-rekommendation
          </DialogTitle>
          <DialogDescription>
            Baserat på era uppgifter och preferenser
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Recommended distribution */}
          <div className="bg-primary/10 rounded-xl p-4 space-y-3">
            <h3 className="font-semibold text-lg">Rekommenderad fördelning</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-background rounded-lg p-3 text-center">
                <p className="text-sm text-muted-foreground">Förälder 1</p>
                <p className="text-2xl font-bold text-primary">
                  {result.optimalParent1Months} mån
                </p>
              </div>
              <div className="bg-background rounded-lg p-3 text-center">
                <p className="text-sm text-muted-foreground">Förälder 2</p>
                <p className="text-2xl font-bold text-secondary-foreground">
                  {parent2Months} mån
                </p>
              </div>
            </div>
          </div>

          {/* Expected outcomes */}
          {(result.expectedTotalIncome || result.expectedDaysSaved) && (
            <div className="grid grid-cols-2 gap-4">
              {result.expectedTotalIncome && (
                <div className="bg-accent/50 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <TrendingUp className="h-4 w-4" />
                    Förväntad total inkomst
                  </div>
                  <p className="text-lg font-semibold">
                    {Math.round(result.expectedTotalIncome).toLocaleString('sv-SE')} kr
                  </p>
                </div>
              )}
              {result.expectedDaysSaved !== undefined && (
                <div className="bg-accent/50 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <PiggyBank className="h-4 w-4" />
                    Sparade dagar
                  </div>
                  <p className="text-lg font-semibold">
                    {result.expectedDaysSaved} dagar
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Explanation */}
          <div className="space-y-2">
            <h4 className="font-medium flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              Varför denna fördelning?
            </h4>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {result.explanation}
            </p>
          </div>

          {/* Tips */}
          {result.tips && result.tips.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-medium flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-amber-500" />
                Tips
              </h4>
              <ul className="space-y-1">
                {result.tips.map((tip, index) => (
                  <li key={index} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className="text-primary">•</span>
                    {tip}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Defaults footnote */}
          {defaultsFootnote && (
            <div className="bg-muted/50 rounded-lg p-3 flex items-start gap-2">
              <Info className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <p className="text-xs text-muted-foreground">
                {defaultsFootnote}
              </p>
            </div>
          )}
        </div>

        <div className="flex gap-3 justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Stäng
          </Button>
          <Button 
            onClick={() => {
              onApply(result.optimalParent1Months);
              onOpenChange(false);
            }}
            className="bg-gradient-hero"
          >
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Använd denna fördelning
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
