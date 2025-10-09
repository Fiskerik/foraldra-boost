import { LeavePeriod, formatCurrency } from "@/utils/parentalCalculations";
import { format, eachMonthOfInterval } from "date-fns";
import { sv } from "date-fns/locale";

interface TimelineChartProps {
  periods: LeavePeriod[];
  minHouseholdIncome: number;
}

export function TimelineChart({ periods, minHouseholdIncome }: TimelineChartProps) {
  if (periods.length === 0) return null;

  const startDate = periods[0].startDate;
  const endDate = periods[periods.length - 1].endDate;
  
  // Generate monthly data
  const months = eachMonthOfInterval({ start: startDate, end: endDate });
  
  // Calculate income for each month
  const monthlyData = months.map(month => {
    let income = 0;
    let parent1Days = 0;
    let parent2Days = 0;
    let bothDays = 0;
    
    periods.forEach(period => {
      if (period.startDate <= month && period.endDate >= month) {
        const daysInMonth = 30; // Simplified
        income = period.dailyIncome;
        
        if (period.parent === 'parent1') parent1Days = daysInMonth;
        else if (period.parent === 'parent2') parent2Days = daysInMonth;
        else bothDays = daysInMonth;
      }
    });
    
    return {
      month: format(month, 'MMM yyyy', { locale: sv }),
      income,
      parent1Days,
      parent2Days,
      bothDays,
    };
  });
  
  const maxIncome = Math.max(...monthlyData.map(d => d.income), minHouseholdIncome);
  
  return (
    <div className="space-y-4">
      <h3 className="text-xl font-semibold">Inkomsttidslinje</h3>
      
      <div className="relative h-64 bg-muted/30 rounded-lg p-4">
        {/* Y-axis labels */}
        <div className="absolute left-0 top-0 bottom-0 w-20 flex flex-col justify-between text-xs text-muted-foreground">
          <span>{formatCurrency(maxIncome)}</span>
          <span>{formatCurrency(maxIncome * 0.75)}</span>
          <span>{formatCurrency(maxIncome * 0.5)}</span>
          <span>{formatCurrency(maxIncome * 0.25)}</span>
          <span>0 kr</span>
        </div>
        
        {/* Minimum income line */}
        <div 
          className="absolute left-20 right-0 border-t-2 border-destructive border-dashed z-10"
          style={{ 
            bottom: `${(minHouseholdIncome / maxIncome) * 100}%`,
          }}
        >
          <span className="absolute -top-5 right-0 text-xs text-destructive font-medium">
            Min. inkomst
          </span>
        </div>
        
        {/* Bars */}
        <div className="absolute left-20 right-0 top-0 bottom-8 flex items-end gap-1">
          {monthlyData.map((data, index) => {
            const height = (data.income / maxIncome) * 100;
            let barColor = 'bg-accent';
            
            if (data.parent1Days > 0 && data.parent2Days === 0 && data.bothDays === 0) {
              barColor = 'bg-parent1';
            } else if (data.parent2Days > 0 && data.parent1Days === 0 && data.bothDays === 0) {
              barColor = 'bg-parent2';
            }
            
            return (
              <div key={index} className="flex-1 flex flex-col items-center group relative">
                <div 
                  className={`w-full ${barColor} rounded-t transition-all hover:opacity-80`}
                  style={{ height: `${height}%` }}
                >
                  <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block bg-popover text-popover-foreground text-xs p-2 rounded shadow-lg whitespace-nowrap z-20">
                    {formatCurrency(data.income)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        
        {/* X-axis labels */}
        <div className="absolute left-20 right-0 bottom-0 h-8 flex items-center text-xs text-muted-foreground">
          {monthlyData.map((data, index) => {
            if (index % Math.ceil(monthlyData.length / 8) === 0 || index === monthlyData.length - 1) {
              return (
                <div key={index} className="flex-1 text-center">
                  {data.month}
                </div>
              );
            }
            return <div key={index} className="flex-1" />;
          })}
        </div>
      </div>
      
      {/* Legend */}
      <div className="flex flex-wrap gap-4 justify-center text-sm">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-parent1 rounded"></div>
          <span>Förälder 1 hemma</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-parent2 rounded"></div>
          <span>Förälder 2 hemma</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-accent rounded"></div>
          <span>Båda hemma</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-8 h-0.5 border-t-2 border-destructive border-dashed"></div>
          <span>Min. hushållsinkomst</span>
        </div>
      </div>
    </div>
  );
}
