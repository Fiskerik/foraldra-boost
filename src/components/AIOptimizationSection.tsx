import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Lightbulb, CheckCircle2, TrendingUp, PiggyBank, Calendar, Info, X } from "lucide-react";

interface AIOptimizationSectionProps {
  result: {
    optimalParent1Months: number;
    explanation: string;
    tips: string[];
    expectedTotalIncome?: number;
    expectedDaysSaved?: number;
    expectedDaysUsed?: number;
  } | null;
  totalMonths: number;
  selectedStrategy: 'maximize-income' | 'save-days';
  onApply: (parent1Months: number) => void;
  onDismiss: () => void;
  defaultsFootnote?: string | null;
}

export function AIOptimizationSection({
  result,
  totalMonths,
  selectedStrategy,
  onApply,
  onDismiss,
  defaultsFootnote,
}: AIOptimizationSectionProps) {
  if (!result) return null;

  const parent2Months = totalMonths - result.optimalParent1Months;
  const strategyLabel = selectedStrategy === 'maximize-income' ? 'Maximera inkomst' : 'Spara dagar';
  const strategyColor = selectedStrategy === 'maximize-income' ? 'bg-secondary/20 text-secondary border-secondary/30' : 'bg-primary/20 text-primary border-primary/30';

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-secondary/5">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="flex items-center gap-2 text-lg md:text-xl">
                <Sparkles className="h-5 w-5 text-primary" />
                AI-rekommendation
              </CardTitle>
              <Badge variant="outline" className={strategyColor}>
                {strategyLabel}
              </Badge>
            </div>
            <CardDescription className="mt-1">
              Baserat på era uppgifter och preferenser
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onDismiss}
            className="h-8 w-8 rounded-full"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Stäng</span>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Recommended distribution */}
        <div className="bg-primary/10 rounded-xl p-4 space-y-3">
          <h3 className="font-semibold text-base md:text-lg">Rekommenderad fördelning</h3>
          <div className="grid grid-cols-2 gap-3 md:gap-4">
            <div className="bg-background rounded-lg p-3 text-center">
              <p className="text-xs md:text-sm text-muted-foreground">Förälder 1</p>
              <p className="text-xl md:text-2xl font-bold text-primary">
                {result.optimalParent1Months} mån
              </p>
            </div>
            <div className="bg-background rounded-lg p-3 text-center">
              <p className="text-xs md:text-sm text-muted-foreground">Förälder 2</p>
              <p className="text-xl md:text-2xl font-bold text-secondary">
                {parent2Months} mån
              </p>
            </div>
          </div>
        </div>

        {/* Expected outcomes - always show all three */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
          {result.expectedTotalIncome !== undefined && (
            <div className="bg-secondary/10 rounded-lg p-3">
              <div className="flex items-center gap-2 text-xs md:text-sm text-muted-foreground mb-1">
                <TrendingUp className="h-4 w-4 text-secondary" />
                Total periodinkomst
              </div>
              <p className="text-base md:text-lg font-semibold">
                {Math.round(result.expectedTotalIncome).toLocaleString('sv-SE')} kr
              </p>
            </div>
          )}
          {result.expectedDaysUsed !== undefined && (
            <div className="bg-primary/10 rounded-lg p-3">
              <div className="flex items-center gap-2 text-xs md:text-sm text-muted-foreground mb-1">
                <Calendar className="h-4 w-4 text-primary" />
                Använda dagar
              </div>
              <p className="text-base md:text-lg font-semibold">
                {result.expectedDaysUsed} dagar
              </p>
            </div>
          )}
          {result.expectedDaysSaved !== undefined && (
            <div className="bg-primary/10 rounded-lg p-3">
              <div className="flex items-center gap-2 text-xs md:text-sm text-muted-foreground mb-1">
                <PiggyBank className="h-4 w-4 text-primary" />
                Sparade dagar
              </div>
              <p className="text-base md:text-lg font-semibold">
                {result.expectedDaysSaved} dagar
              </p>
            </div>
          )}
        </div>

        {/* Explanation */}
        <div className="space-y-2">
          <h4 className="font-medium flex items-center gap-2 text-sm md:text-base">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            Varför denna fördelning?
          </h4>
          <p className="text-xs md:text-sm text-muted-foreground leading-relaxed">
            {result.explanation}
          </p>
        </div>

        {/* Tips */}
        {result.tips && result.tips.length > 0 && (
          <div className="space-y-2">
            <h4 className="font-medium flex items-center gap-2 text-sm md:text-base">
              <Lightbulb className="h-4 w-4 text-amber-500" />
              Tips
            </h4>
            <ul className="space-y-1">
              {result.tips.map((tip, index) => (
                <li key={index} className="text-xs md:text-sm text-muted-foreground flex items-start gap-2">
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
            <p className="text-[10px] md:text-xs text-muted-foreground">
              {defaultsFootnote}
            </p>
          </div>
        )}

        {/* Action button */}
        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <Button 
            onClick={() => onApply(result.optimalParent1Months)}
            className="w-full sm:w-auto bg-gradient-hero"
          >
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Använd denna fördelning
          </Button>
          <Button 
            variant="outline" 
            onClick={onDismiss}
            className="w-full sm:w-auto"
          >
            Stäng
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
