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
  return (
    <Card className="shadow-card bg-gradient-hero text-primary-foreground">
      <CardHeader className="p-2 md:p-6">
        <CardTitle className="text-sm md:text-2xl">Disponibel inkomst</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 md:space-y-6 p-2 md:p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-6">
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
            </div>
          </div>
        </div>

        <div className="pt-2 md:pt-4 border-t border-white/20">
          <div className="flex justify-between items-center">
            <span className="text-xs md:text-lg font-medium">Total hushållsinkomst (arbete):</span>
            <span className="text-base md:text-2xl font-bold">
              {formatCurrency(parent1NetIncome + parent2NetIncome)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
