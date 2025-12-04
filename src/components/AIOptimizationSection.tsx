import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Lightbulb, CheckCircle2, TrendingUp, PiggyBank, Calendar, Info, X, ArrowRight, Users } from "lucide-react";

interface CurrentResults {
  totalIncome: number;
  averageMonthlyIncome: number;
  daysUsed: number;
  daysSaved: number;
  parent1Months: number;
  parent2Months: number;
  highestMonthIncome?: number;
  lowestMonthIncome?: number;
}

interface AIOptimizationSectionProps {
  result: {
    optimalParent1Months: number;
    explanation: string;
    tips: string[];
    expectedTotalIncome?: number;
    expectedDaysSaved?: number;
    expectedDaysUsed?: number;
    expectedAverageMonthly?: number;
    expectedHighestMonth?: number;
    expectedLowestMonth?: number;
  } | null;
  totalMonths: number;
  selectedStrategy: 'maximize-income' | 'save-days';
  currentResults?: CurrentResults | null;
  onApply: (parent1Months: number) => void;
  onDismiss: () => void;
  defaultsFootnote?: string | null;
}

function ComparisonRow({ 
  label, 
  currentValue, 
  aiValue, 
  format = 'number',
  highlight = 'higher'
}: { 
  label: string; 
  currentValue?: number; 
  aiValue?: number;
  format?: 'number' | 'currency' | 'days';
  highlight?: 'higher' | 'lower';
}) {
  if (currentValue === undefined || aiValue === undefined) return null;
  
  const formatValue = (val: number) => {
    if (format === 'currency') return `${Math.round(val).toLocaleString('sv-SE')} kr`;
    if (format === 'days') return `${val} dagar`;
    return val.toString();
  };

  const diff = aiValue - currentValue;
  const isAiBetter = highlight === 'higher' ? diff > 0 : diff < 0;
  const diffText = diff > 0 ? `+${formatValue(Math.abs(diff))}` : `-${formatValue(Math.abs(diff))}`;

  return (
    <div className="grid grid-cols-3 gap-2 py-2 border-b border-border/50 last:border-0">
      <span className="text-xs md:text-sm text-muted-foreground">{label}</span>
      <span className="text-xs md:text-sm text-center">{formatValue(currentValue)}</span>
      <div className="text-xs md:text-sm text-center flex items-center justify-center gap-1">
        <span className={isAiBetter ? "font-semibold text-primary" : ""}>{formatValue(aiValue)}</span>
        {diff !== 0 && (
          <span className={`text-[10px] ${isAiBetter ? "text-primary" : "text-muted-foreground"}`}>
            ({diffText})
          </span>
        )}
      </div>
    </div>
  );
}

export function AIOptimizationSection({
  result,
  totalMonths,
  selectedStrategy,
  currentResults,
  onApply,
  onDismiss,
  defaultsFootnote,
}: AIOptimizationSectionProps) {
  if (!result) return null;

  const parent2Months = totalMonths - result.optimalParent1Months;
  const strategyLabel = selectedStrategy === 'maximize-income' ? 'Maximera inkomst' : 'Spara dagar';
  const strategyColor = selectedStrategy === 'maximize-income' ? 'bg-secondary/20 text-secondary border-secondary/30' : 'bg-primary/20 text-primary border-primary/30';

  const showComparison = currentResults && (
    currentResults.parent1Months !== result.optimalParent1Months ||
    currentResults.totalIncome !== result.expectedTotalIncome
  );

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
        {/* Side-by-side comparison */}
        {showComparison && (
          <div className="bg-background rounded-xl p-4 space-y-3 border border-border/50">
            <h3 className="font-semibold text-sm md:text-base flex items-center gap-2">
              <ArrowRight className="h-4 w-4 text-primary" />
              Jämförelse: Nuvarande vs AI-förslag
            </h3>
            
            {/* Header */}
            <div className="grid grid-cols-3 gap-2 pb-2 border-b border-border">
              <span className="text-xs font-medium text-muted-foreground"></span>
              <span className="text-xs font-medium text-center">Nuvarande</span>
              <span className="text-xs font-medium text-center text-primary">AI-förslag</span>
            </div>

            {/* Distribution */}
            <div className="grid grid-cols-3 gap-2 py-2 border-b border-border/50">
              <span className="text-xs md:text-sm text-muted-foreground flex items-center gap-1">
                <Users className="h-3 w-3" /> Fördelning
              </span>
              <span className="text-xs md:text-sm text-center">
                {currentResults.parent1Months}/{currentResults.parent2Months} mån
              </span>
              <span className="text-xs md:text-sm text-center font-semibold text-primary">
                {result.optimalParent1Months}/{parent2Months} mån
              </span>
            </div>

            <ComparisonRow 
              label="Total inkomst" 
              currentValue={currentResults.totalIncome} 
              aiValue={result.expectedTotalIncome}
              format="currency"
              highlight="higher"
            />
            <ComparisonRow 
              label="Snitt/månad" 
              currentValue={currentResults.averageMonthlyIncome} 
              aiValue={result.expectedAverageMonthly}
              format="currency"
              highlight="higher"
            />
            <ComparisonRow 
              label="Använda dagar" 
              currentValue={currentResults.daysUsed} 
              aiValue={result.expectedDaysUsed}
              format="days"
              highlight="lower"
            />
            <ComparisonRow 
              label="Sparade dagar" 
              currentValue={currentResults.daysSaved} 
              aiValue={result.expectedDaysSaved}
              format="days"
              highlight="higher"
            />
            {currentResults.highestMonthIncome && result.expectedHighestMonth && (
              <ComparisonRow 
                label="Högsta månad" 
                currentValue={currentResults.highestMonthIncome} 
                aiValue={result.expectedHighestMonth}
                format="currency"
                highlight="higher"
              />
            )}
            {currentResults.lowestMonthIncome && result.expectedLowestMonth && (
              <ComparisonRow 
                label="Lägsta månad" 
                currentValue={currentResults.lowestMonthIncome} 
                aiValue={result.expectedLowestMonth}
                format="currency"
                highlight="higher"
              />
            )}
          </div>
        )}

        {/* Recommended distribution - simplified when comparison shown */}
        {!showComparison && (
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
        )}

        {/* Expected outcomes - only show when no comparison */}
        {!showComparison && (
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
        )}

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
