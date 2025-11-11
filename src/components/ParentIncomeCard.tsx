import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCurrency } from "@/utils/parentalCalculations";

interface ParentIncomeCardProps {
  parentNumber: 1 | 2;
  income: number;
  hasCollectiveAgreement: boolean;
  onIncomeChange: (income: number) => void;
  onCollectiveAgreementChange: (hasAgreement: boolean) => void;
}

export function ParentIncomeCard({
  parentNumber,
  income,
  hasCollectiveAgreement,
  onIncomeChange,
  onCollectiveAgreementChange,
}: ParentIncomeCardProps) {
  const parentClass = parentNumber === 1 ? "parent1" : "parent2";
  
  return (
    <Card className="shadow-card">
      <CardHeader className="p-2 md:p-6">
        <CardTitle className={`text-sm md:text-lg ${parentNumber === 1 ? "text-parent1" : "text-parent2"}`}>
          Förälder {parentNumber}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 md:space-y-6 p-2 md:p-6">
        <div className="space-y-1 md:space-y-3">
          <Label htmlFor={`income-${parentNumber}`} className="text-[10px] md:text-base font-medium">
            Månadsinkomst
          </Label>
          <div className="space-y-2">
            <Slider
              id={`income-${parentNumber}`}
              min={0}
              max={120000}
              step={1000}
              value={[income]}
              onValueChange={(values) => onIncomeChange(values[0])}
              className={`slider-single ${parentNumber === 1 ? "[&_[role=slider]]:bg-parent1 [&_[role=slider]]:border-parent1" : "[&_[role=slider]]:bg-parent2 [&_[role=slider]]:border-parent2"}`}
            />
            <div className="text-right">
              <span className={`text-sm md:text-2xl font-bold ${parentNumber === 1 ? "text-parent1" : "text-parent2"}`}>
                {formatCurrency(income)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2 p-1.5 md:p-4 bg-muted rounded-lg opacity-50">
          <Checkbox
            id={`collective-${parentNumber}`}
            checked={hasCollectiveAgreement}
            onCheckedChange={(checked) =>
              onCollectiveAgreementChange(checked === true)
            }
            disabled
            className={parentNumber === 1 
              ? "data-[state=checked]:bg-parent1 data-[state=checked]:border-parent1 h-3 w-3 md:h-4 md:w-4" 
              : "data-[state=checked]:bg-parent2 data-[state=checked]:border-parent2 h-3 w-3 md:h-4 md:w-4"}
          />
          <Label
            htmlFor={`collective-${parentNumber}`}
            className="text-[10px] md:text-sm font-medium cursor-not-allowed"
            title="Föräldralön är tillfälligt inaktiverad - endast föräldrapenning används i beräkningarna"
          >
            Har du kollektivavtal? (inaktiverad)
          </Label>
        </div>
      </CardContent>
    </Card>
  );
}
