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
      <CardHeader>
        <CardTitle className={`text-${parentClass}`}>
          Förälder {parentNumber}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <Label htmlFor={`income-${parentNumber}`} className="text-base font-medium">
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
              className={`slider-single [&_[role=slider]]:bg-${parentClass} [&_[role=slider]]:border-${parentClass}`}
            />
            <div className="text-right">
              <span className={`text-2xl font-bold text-${parentClass}`}>
                {formatCurrency(income)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2 p-4 bg-muted rounded-lg">
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
            className="text-sm font-medium cursor-pointer"
          >
            Har du kollektivavtal?
          </Label>
        </div>
      </CardContent>
    </Card>
  );
}
