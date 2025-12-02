import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OptimizationResult, formatCurrency } from "@/utils/parentalCalculations";
import {
  TrendingUp,
  PiggyBank,
  Clock,
  AlertTriangle,
  X,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMemo, useState } from "react";

interface OptimizationResultsProps {
  results: OptimizationResult[];
  minHouseholdIncome: number;
  selectedIndex: number;
  onSelectStrategy: (index: number) => void;
  timelineMonths: number;
}

export function OptimizationResults({ results, minHouseholdIncome, selectedIndex, onSelectStrategy, timelineMonths }: OptimizationResultsProps) {
  if (!Array.isArray(results) || results.length === 0) {
    return null;
  }
  const [compareOpen, setCompareOpen] = useState(false);

  const openComparison = () => {
    setCompareOpen(true);
  };

  const closeComparison = () => setCompareOpen(false);

  type ComparisonMetric = {
    key: string;
    label: string;
    formatValue: (value: number, result: OptimizationResult) => string;
    preferLower: boolean;
    extract: (result: OptimizationResult) => number;
  };

  const comparisonMetrics: ComparisonMetric[] = useMemo(
    () => [
      {
        key: "totalIncome",
        label: "Total inkomst",
        formatValue: (value: number) => formatCurrency(value),
        preferLower: false,
        extract: (result: OptimizationResult) => result.totalIncome,
      },
      {
        key: "averageMonthlyIncome",
        label: "Genomsnitt/månad",
        formatValue: (value: number) => formatCurrency(value),
        preferLower: false,
        extract: (result: OptimizationResult) => result.averageMonthlyIncome,
      },
      {
        key: "daysSaved",
        label: "Sparade dagar (Sjukpenning/Lägstanivå)",
        formatValue: (_value: number, result: OptimizationResult) => {
          const highDays = Math.max(0, Math.round(result.highBenefitDaysSaved ?? 0));
          const lowDays = Math.max(0, Math.round(result.lowBenefitDaysSaved ?? 0));
          return `(${highDays}/${lowDays}) dagar`;
        },
        preferLower: false,
        extract: (result: OptimizationResult) => result.daysSaved,
      },
    ],
    []
  );

  // Render strategy card function
  const renderStrategyCard = (result: OptimizationResult | undefined, index: number) => {
    if (!result) {
      console.log("renderStrategyCard: missing result at index", index, results);
      return null;
    }

    const strategyIcon = result.strategy === 'save-days'
      ? <PiggyBank className="h-5 w-5 md:h-8 md:w-8 text-parent1 flex-shrink-0" />
      : <TrendingUp className="h-5 w-5 md:h-8 md:w-8 text-parent2 flex-shrink-0" />;

    return (
      <Card
        key={index}
        className={`relative shadow-soft transition-all hover:shadow-lg ${
          selectedIndex === index
            ? `ring-2 md:ring-4 ${result.strategy === 'maximize-income' ? 'ring-blue-500' : 'ring-primary'} shadow-xl`
            : ''
        }`}
      >
        <CardHeader className={`${result.strategy === 'save-days' ? 'bg-parent1/10' : 'bg-parent2/10'} p-2 md:p-6 relative`}>
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-0.5 md:space-y-1 flex-1">
              <div className="flex items-center gap-2">
                {strategyIcon}
                <CardTitle className="text-sm md:text-2xl">{result.title}</CardTitle>
              </div>
              <p className="text-[10px] md:text-sm text-muted-foreground">
                {result.description}
              </p>
            </div>
          </div>
          
          {/* Summary - Always Visible */}
          <div className="grid grid-cols-2 gap-1.5 md:gap-4 mt-2 md:mt-4">
            <div className="p-1.5 md:p-4 bg-muted rounded-lg flex flex-col gap-1">
              <div className="text-[9px] md:text-sm text-muted-foreground mb-0.5 min-h-[18px] md:min-h-[24px]">
                Total inkomst
              </div>
              <div className="text-xs md:text-xl font-bold leading-none md:leading-tight">
                {formatCurrency(result.totalIncome)}
              </div>
            </div>
            <div className="p-1.5 md:p-4 bg-muted rounded-lg flex flex-col gap-1">
              <div className="text-[9px] md:text-sm text-muted-foreground mb-0.5 min-h-[18px] md:min-h-[24px]">
                Genomsnitt/mån
              </div>
              <div className="text-xs md:text-xl font-bold leading-none md:leading-tight">
                {formatCurrency(result.averageMonthlyIncome)}
              </div>
            </div>
            <div className="p-1.5 md:p-4 bg-accent/10 rounded-lg border border-accent/20 flex flex-col gap-1">
              <div className="text-[9px] md:text-sm text-muted-foreground mb-0.5 flex items-center gap-0.5 md:gap-1 min-h-[18px] md:min-h-[24px]">
                <Clock className="h-2 w-2 md:h-3 md:w-3" />
                Dagar använda
              </div>
              <div className="text-xs md:text-xl font-bold leading-none md:leading-tight">
                {result.daysUsed}
              </div>
            </div>
            <div className="p-1.5 md:p-4 bg-accent/10 rounded-lg border border-accent/20 flex flex-col gap-1">
              <div className="text-[9px] md:text-sm text-muted-foreground mb-0.5 flex items-center gap-0.5 md:gap-1 min-h-[18px] md:min-h-[24px]">
                <PiggyBank className="h-2 w-2 md:h-3 md:w-3" />
                Dagar sparade
              </div>
              <div className="text-xs md:text-xl font-bold text-accent leading-none md:leading-tight">
                {result.daysSaved}
              </div>
            </div>
          </div>

          {result.warnings?.length ? (
            <div className="mt-2 md:mt-4 space-y-1">
              {result.warnings.map((warning, warningIndex) => (
                <div
                  key={warningIndex}
                  className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-100/80 p-1.5 md:p-2"
                >
                  <AlertTriangle className="mt-0.5 h-3 w-3 text-amber-600 md:h-4 md:w-4" />
                  <p className="text-[10px] md:text-sm text-amber-900 leading-snug">{warning}</p>
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-4 flex justify-center">
            <Button
              onClick={() => onSelectStrategy(index)}
              className="w-full md:w-auto"
            >
              Välj denna strategi
            </Button>
          </div>
        </CardHeader>
      </Card>
    );
  };

  return (
    <div className="space-y-3 md:space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 md:gap-4">
        <h2 className="text-lg md:text-2xl font-bold">Optimeringsförslag</h2>
        <p className="text-[10px] md:text-sm text-muted-foreground">
          * Föräldrapenning baseras på {results[0]?.periods[0]?.daysPerWeek || 7} dagar per vecka
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-6">
        {results.map((result, index) => renderStrategyCard(result, index))}
      </div>

      {/* Comparison Modal */}
      {compareOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-in fade-in-0"
          onClick={closeComparison}
        >
          <Card
            className="max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>Jämför strategier</CardTitle>
                <Button variant="ghost" size="icon" onClick={closeComparison}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {comparisonMetrics.map((metric) => {
                  const values = results.map((result) => ({
                    result,
                    value: metric.extract(result),
                  }));
                  const bestValue = metric.preferLower
                    ? Math.min(...values.map((v) => v.value))
                    : Math.max(...values.map((v) => v.value));

                  return (
                    <div key={metric.key} className="space-y-2">
                      <h3 className="font-semibold text-sm">{metric.label}</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {values.map(({ result, value }, idx) => {
                          const isBest = Math.abs(value - bestValue) < 0.01;
                          return (
                            <div
                              key={idx}
                              className={`p-3 rounded-lg border flex items-center justify-between ${
                                isBest
                                  ? "bg-accent/20 border-accent"
                                  : "bg-muted/50"
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                {result.strategy === 'save-days' ? (
                                  <PiggyBank className="h-4 w-4 text-parent1" />
                                ) : (
                                  <TrendingUp className="h-4 w-4 text-parent2" />
                                )}
                                <span className="text-sm font-medium">
                                  {result.title}
                                </span>
                              </div>
                              <div className="flex items-center gap-1">
                                <span className="text-sm font-bold">
                                  {metric.formatValue(value, result)}
                                </span>
                                {isBest && (
                                  <Check className="h-4 w-4 text-accent" />
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
