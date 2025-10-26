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
  const strategyName = selectedStrategy?.meta?.title || selectedStrategy?.title || 'Okänd strategi';

  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader>
        <div className="flex justify-between items-start">
          <div className="flex-1">
            <CardTitle className="text-xl mb-2">{plan.name}</CardTitle>
            <CardDescription className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Förväntat födelsedatum: {format(new Date(plan.expected_birth_date), 'PPP', { locale: sv })}
            </CardDescription>
          </div>
          <Badge variant="outline">{strategyName}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm text-muted-foreground">Total inkomst</p>
              <p className="font-semibold">{Math.round(totalIncome).toLocaleString('sv-SE')} kr</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm text-muted-foreground">Dagar använda</p>
              <p className="font-semibold">{daysUsed} dagar</p>
            </div>
          </div>
        </div>
        
        <div className="text-xs text-muted-foreground mb-4">
          Senast uppdaterad: {format(new Date(plan.updated_at), 'PPP', { locale: sv })}
        </div>

        <Link to={`/plan/${plan.id}`}>
          <Button className="w-full" variant="outline">
            Öppna plan
            <ChevronRight className="ml-2 h-4 w-4" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
};
