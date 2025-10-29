import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calendar, TrendingUp, Clock, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { sv } from 'date-fns/locale';

interface PlanCardProps {
  plan: {
    id: string;
    name: string;
    expected_birth_date: string;
    created_at: string;
    updated_at: string;
    selected_strategy_index: number;
    optimization_results: any;
  };
}

export const PlanCard = ({ plan }: PlanCardProps) => {
  const selectedStrategy = plan.optimization_results?.[plan.selected_strategy_index];
  
  const totalIncome = selectedStrategy?.totalIncome || 0;
  const daysUsed = selectedStrategy?.daysUsed || 0;
  const strategyType = selectedStrategy?.strategy || 'maximize-income';
  const strategyName = strategyType === 'save-days' ? 'Spara dagar' : 'Maximerad inkomst';
  
  const strategyColorClass = strategyType === 'save-days' 
    ? 'border-parent1/30 bg-parent1/5' 
    : 'border-parent2/30 bg-parent2/5';

  return (
    <Card className={`hover:shadow-lg transition-shadow ${strategyColorClass}`}>
      <CardContent className="p-6">
        {/* Header med plannamn och strategi badge */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex-1 min-w-0">
            <h3 className="text-xl font-semibold mb-1 truncate">{plan.name}</h3>
            <p className="text-sm text-muted-foreground flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="truncate">
                {format(new Date(plan.expected_birth_date), 'PPP', { locale: sv })}
              </span>
            </p>
          </div>
          <Badge 
            variant="outline" 
            className={`flex-shrink-0 ${strategyType === 'save-days' ? 'border-parent1 text-parent1 bg-parent1/10' : 'border-parent2 text-parent2 bg-parent2/10'}`}
          >
            {strategyName}
          </Badge>
        </div>

        {/* Stats grid - kompaktare */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-muted/50 rounded-lg p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Total inkomst</p>
            </div>
            <p className="text-lg font-bold">{Math.round(totalIncome).toLocaleString('sv-SE')} kr</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Dagar använda</p>
            </div>
            <p className="text-lg font-bold">{daysUsed}</p>
          </div>
        </div>

        <div className="text-xs text-muted-foreground mb-4 flex items-center gap-1">
          <Clock className="h-3 w-3" />
          Uppdaterad {format(new Date(plan.updated_at), 'd MMM yyyy', { locale: sv })}
        </div>

        {/* Action button */}
        <Link to={`/plan/${plan.id}`}>
          <Button className="w-full">
            Öppna plan
            <ChevronRight className="ml-2 h-4 w-4" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
};
