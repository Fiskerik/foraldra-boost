import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/utils/parentalCalculations";

interface AvailableIncomeDisplayProps {
  parent1NetIncome: number;
  parent2NetIncome: number;
  parent1AvailableIncome: number;
  parent2AvailableIncome: number;
  parent1ParentalSalaryPerDay: number;
  parent2ParentalSalaryPerDay: number;
}

export function AvailableIncomeDisplay({
  parent1NetIncome,
  parent2NetIncome,
  parent1AvailableIncome,
  parent2AvailableIncome,
  parent1ParentalSalaryPerDay,
  parent2ParentalSalaryPerDay,
}: AvailableIncomeDisplayProps) {
  const DAYS_PER_MONTH = 30;
  const parent1ParentalSalaryMonthly = Math.max(0, parent1ParentalSalaryPerDay * DAYS_PER_MONTH);
  const parent2ParentalSalaryMonthly = Math.max(0, parent2ParentalSalaryPerDay * DAYS_PER_MONTH);

  const parent1HasParentalSalary = parent1ParentalSalaryPerDay > 0.01;
  const parent2HasParentalSalary = parent2ParentalSalaryPerDay > 0.01;

  return (
    <Card className="shadow-card bg-gradient-hero text-primary-foreground">
      <CardHeader className="p-2 md:p-6">
        <CardTitle className="text-xs md:text-2xl">Disponibel inkomst</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 md:space-y-6 p-2 md:p-6">
        <div className="grid grid-cols-2 gap-2 md:gap-6">
          <div className="space-y-1 md:space-y-3">
            <h3 className="text-[10px] md:text-lg font-semibold opacity-90">Förälder 1</h3>
            <div className="space-y-1 md:space-y-2 bg-white/10 rounded-lg p-1.5 md:p-4">
              <div className="flex justify-between items-center gap-1">
                <span className="text-[8px] md:text-sm opacity-80">Nettolön:</span>
                <span className="font-bold text-[10px] md:text-base">{formatCurrency(parent1NetIncome)}</span>
              </div>
              <div className="flex justify-between items-center pt-0.5 md:pt-2 border-t border-white/20 gap-1">
                <span className="text-[8px] md:text-sm opacity-80">Under föräldral.:</span>
                <span className="font-bold text-[11px] md:text-lg">
                  {formatCurrency(parent1AvailableIncome)}
                </span>
              </div>
              {parent1HasParentalSalary && (
                <div className="flex justify-between items-center gap-1 text-[7px] md:text-xs opacity-80">
                  <span>Föräldralön (est.):</span>
                  <span className="font-semibold">{formatCurrency(parent1ParentalSalaryMonthly)}</span>
                </div>
              )}
              {parent1HasParentalSalary && (
                <div className="text-[7px] md:text-xs opacity-70 italic mt-0.5 md:mt-1">
                  * Föräldralön ingår första 6 mån sammanhängande ledighet
                </div>
              )}
            </div>
          </div>

          <div className="space-y-1 md:space-y-3">
            <h3 className="text-[10px] md:text-lg font-semibold opacity-90">Förälder 2</h3>
            <div className="space-y-1 md:space-y-2 bg-white/10 rounded-lg p-1.5 md:p-4">
              <div className="flex justify-between items-center gap-1">
                <span className="text-[8px] md:text-sm opacity-80">Nettolön:</span>
                <span className="font-bold text-[10px] md:text-base">{formatCurrency(parent2NetIncome)}</span>
              </div>
              <div className="flex justify-between items-center pt-0.5 md:pt-2 border-t border-white/20 gap-1">
                <span className="text-[8px] md:text-sm opacity-80">Under föräldral.:</span>
                <span className="font-bold text-[11px] md:text-lg">
                  {formatCurrency(parent2AvailableIncome)}
                </span>
              </div>
              {parent2HasParentalSalary && (
                <div className="flex justify-between items-center gap-1 text-[7px] md:text-xs opacity-80">
                  <span>Föräldralön (est.):</span>
                  <span className="font-semibold">{formatCurrency(parent2ParentalSalaryMonthly)}</span>
                </div>
              )}
              {parent2HasParentalSalary && (
                <div className="text-[7px] md:text-xs opacity-70 italic mt-0.5 md:mt-1">
                  * Föräldralön ingår första 6 mån sammanhängande ledighet
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="pt-1.5 md:pt-4 border-t border-white/20">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-0.5 sm:gap-2">
            <span className="text-[9px] md:text-base font-medium">Total hushållsinkomst:</span>
            <span className="text-xs md:text-xl font-bold whitespace-nowrap">
              {formatCurrency(parent1NetIncome + parent2NetIncome)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
