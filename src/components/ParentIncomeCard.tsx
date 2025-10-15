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
      <CardHeader className="p-3 md:p-6">
        <CardTitle className={`text-base md:text-lg ${parentNumber === 1 ? "text-parent1" : "text-parent2"}`}>
          Förälder {parentNumber}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 md:space-y-6 p-3 md:p-6">
        <div className="space-y-2 md:space-y-3">
          <Label htmlFor={`income-${parentNumber}`} className="text-xs md:text-base font-medium">
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
              <span className={`text-lg md:text-2xl font-bold ${parentNumber === 1 ? "text-parent1" : "text-parent2"}`}>
                {formatCurrency(income)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2 p-2 md:p-4 bg-muted rounded-lg">
          <Checkbox
            id={`collective-${parentNumber}`}
            checked={hasCollectiveAgreement}
            onCheckedChange={(checked) =>
              onCollectiveAgreementChange(checked === true)
            }
            className={parentNumber === 1 
              ? "data-[state=checked]:bg-parent1 data-[state=checked]:border-parent1" 
              : "data-[state=checked]:bg-parent2 data-[state=checked]:border-parent2"}
          />
          <Label
            htmlFor={`collective-${parentNumber}`}
            className="text-xs md:text-sm font-medium cursor-pointer"
          >
            Har du kollektivavtal?
          </Label>
        </div>
      </CardContent>
    </Card>
  );
}
