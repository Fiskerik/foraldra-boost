import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/utils/parentalCalculations";

interface AvailableIncomeDisplayProps {
  parent1NetIncome: number;
  parent2NetIncome: number;
  parent1AvailableIncome: number;
  parent2AvailableIncome: number;
}

export function AvailableIncomeDisplay({
  parent1NetIncome,
  parent2NetIncome,
  parent1AvailableIncome,
  parent2AvailableIncome,
}: AvailableIncomeDisplayProps) {
  // Check if parents have collective agreement (föräldralön) based on if available income > benefit income
  const parent1HasParentalSalary = parent1AvailableIncome > (parent1NetIncome * 0.8);
  const parent2HasParentalSalary = parent2AvailableIncome > (parent2NetIncome * 0.8);
  
  return (
    <Card className="shadow-card bg-gradient-hero text-primary-foreground">
      <CardHeader className="p-2 md:p-6">
        <CardTitle className="text-sm md:text-2xl">Disponibel inkomst</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 md:space-y-6 p-2 md:p-6">
        <div className="grid grid-cols-2 gap-3 md:gap-6">
          <div className="space-y-2 md:space-y-3">
            <h3 className="text-xs md:text-lg font-semibold opacity-90">Förälder 1</h3>
            <div className="space-y-1 md:space-y-2 bg-white/10 rounded-lg p-2 md:p-4">
              <div className="flex justify-between items-center">
                <span className="text-[10px] md:text-sm opacity-80">Nettolön:</span>
                <span className="font-bold text-xs md:text-base">{formatCurrency(parent1NetIncome)}</span>
              </div>
              <div className="flex justify-between items-center pt-1 md:pt-2 border-t border-white/20">
                <span className="text-[10px] md:text-sm opacity-80">Under föräldraledighet:</span>
                <span className="font-bold text-sm md:text-lg">
                  {formatCurrency(parent1AvailableIncome)}
                </span>
              </div>
              {parent1HasParentalSalary && (
                <div className="text-[8px] md:text-xs opacity-70 italic mt-0.5 md:mt-1">
                  * Estimerad föräldralön inkluderat
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2 md:space-y-3">
            <h3 className="text-xs md:text-lg font-semibold opacity-90">Förälder 2</h3>
            <div className="space-y-1 md:space-y-2 bg-white/10 rounded-lg p-2 md:p-4">
              <div className="flex justify-between items-center">
                <span className="text-[10px] md:text-sm opacity-80">Nettolön:</span>
                <span className="font-bold text-xs md:text-base">{formatCurrency(parent2NetIncome)}</span>
              </div>
              <div className="flex justify-between items-center pt-1 md:pt-2 border-t border-white/20">
                <span className="text-[10px] md:text-sm opacity-80">Under föräldraledighet:</span>
                <span className="font-bold text-sm md:text-lg">
                  {formatCurrency(parent2AvailableIncome)}
                </span>
              </div>
              {parent2HasParentalSalary && (
                <div className="text-[8px] md:text-xs opacity-70 italic mt-0.5 md:mt-1">
                  * Estimerad föräldralön inkluderat
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="pt-2 md:pt-4 border-t border-white/20">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-1 sm:gap-2">
            <span className="text-[10px] md:text-base font-medium break-words">Total hushållsinkomst (arbete):</span>
            <span className="text-sm md:text-xl font-bold whitespace-nowrap">
              {formatCurrency(parent1NetIncome + parent2NetIncome)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
