import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OptimizationResult, formatPeriod, formatCurrency } from "@/utils/parentalCalculations";
import { TimelineChart } from "./TimelineChart";
import { Calendar, TrendingUp, PiggyBank, Users, Clock } from "lucide-react";

interface OptimizationResultsProps {
  results: OptimizationResult[];
  minHouseholdIncome: number;
}

export function OptimizationResults({ results, minHouseholdIncome }: OptimizationResultsProps) {
  return (
    <div className="space-y-8">
      <div className="text-center space-y-2">
        <h2 className="text-3xl font-bold">Optimeringsförslag</h2>
        <p className="text-sm text-muted-foreground">
          * Föräldrapenning baseras på 7 dagar per vecka
        </p>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {results.map((result, index) => (
          <Card key={index} className="shadow-soft">
            <CardHeader className={`${result.strategy === 'save-days' ? 'bg-parent1/10' : 'bg-parent2/10'}`}>
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <CardTitle className="text-2xl">{result.title}</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {result.description}
                  </p>
                </div>
                {result.strategy === 'save-days' ? (
                  <PiggyBank className="h-8 w-8 text-parent1" />
                ) : (
                  <TrendingUp className="h-8 w-8 text-parent2" />
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-muted rounded-lg">
                    <div className="text-sm text-muted-foreground mb-1">Total inkomst</div>
                    <div className="text-xl font-bold">{formatCurrency(result.totalIncome)}</div>
                  </div>
                  <div className="p-4 bg-muted rounded-lg">
                    <div className="text-sm text-muted-foreground mb-1">Genomsnitt/mån</div>
                    <div className="text-xl font-bold">{formatCurrency(result.averageMonthlyIncome)}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-accent/10 rounded-lg border border-accent/20">
                    <div className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Dagar använda
                    </div>
                    <div className="text-xl font-bold">{result.daysUsed}</div>
                  </div>
                  <div className="p-4 bg-accent/10 rounded-lg border border-accent/20">
                    <div className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
                      <PiggyBank className="h-3 w-3" />
                      Dagar sparade
                    </div>
                    <div className="text-xl font-bold text-accent">{result.daysSaved}</div>
                  </div>
                </div>
              </div>
              
              <TimelineChart periods={result.periods} minHouseholdIncome={minHouseholdIncome} />

              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Calendar className="h-4 w-4" />
                  <span>Ledighetsperioder</span>
                </div>
                
                <div className="space-y-3">
                  {result.periods
                    .filter(period => period.benefitLevel !== 'none') // Only show leave periods, not work periods
                    .map((period, periodIndex) => {
                    const parentColor = 
                      period.parent === 'both' ? 'accent' :
                      period.parent === 'parent1' ? 'parent1' : 'parent2';
                    
                    const parentLabel = 
                      period.parent === 'both' ? 'Båda föräldrarna' :
                      period.parent === 'parent1' ? 'Förälder 1' : 'Förälder 2';
                    
                    const benefitLabel =
                      period.benefitLevel === 'parental-salary' ? 'Föräldralön (90%)' :
                      period.benefitLevel === 'high' ? 'Hög föräldrapenning (80%)' :
                      period.benefitLevel === 'low' ? 'Låg föräldrapenning' : 'Ingen ersättning';
                    
                    return (
                      <div
                        key={periodIndex}
                        className={`p-4 rounded-lg border-l-4 ${parentColor === 'accent' ? 'border-accent bg-accent/5' : parentColor === 'parent1' ? 'border-parent1 bg-parent1/5' : 'border-parent2 bg-parent2/5'}`}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Users className="h-4 w-4" />
                            <span className={`font-semibold ${parentColor === 'accent' ? 'text-accent' : parentColor === 'parent1' ? 'text-parent1' : 'text-parent2'}`}>
                              {parentLabel}
                            </span>
                          </div>
                          <Badge variant="secondary" className="text-xs">
                            {period.daysCount} dagar
                          </Badge>
                        </div>
                        
                        <div className="text-sm space-y-1">
                          <div className="text-muted-foreground">
                            {formatPeriod(period)}
                          </div>
                          <div className="font-medium">
                            {benefitLabel}
                          </div>
                          <div className="text-muted-foreground">
                            Hushållets dagsinkomst: {formatCurrency(period.dailyIncome)}
                          </div>
                          <div className="font-semibold text-sm mt-2">
                            Periodinkomst: {formatCurrency(period.dailyIncome * period.daysCount)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
