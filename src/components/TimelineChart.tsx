import { LeavePeriod, formatCurrency } from "@/utils/parentalCalculations";
import { format, eachMonthOfInterval, startOfMonth, endOfMonth, differenceInCalendarDays } from "date-fns";
import { sv } from "date-fns/locale";

interface TimelineChartProps {
  periods: LeavePeriod[];
  minHouseholdIncome: number;
}

export function TimelineChart({ periods, minHouseholdIncome }: TimelineChartProps) {
  if (periods.length === 0) return null;

  const startDate = periods[0].startDate;
  const endDate = periods[periods.length - 1].endDate;
  
// Generate monthly data based on overlap with each period
const months = eachMonthOfInterval({ start: startDate, end: endDate });

const monthlyData = months.map((month) => {
  const mStart = startOfMonth(month);
  const mEnd = endOfMonth(month);
  let income = 0;
  let parent1Days = 0;
  let parent2Days = 0;
  let bothDays = 0;

  periods.forEach((period) => {
    const overlapStart = period.startDate > mStart ? period.startDate : mStart;
    const overlapEnd = period.endDate < mEnd ? period.endDate : mEnd;
    const hasOverlap = overlapStart <= overlapEnd;
    if (!hasOverlap) return;

    const daysInOverlap = differenceInCalendarDays(overlapEnd, overlapStart) + 1;
    income += period.dailyIncome * daysInOverlap;

    if (period.parent === 'parent1') parent1Days += daysInOverlap;
    else if (period.parent === 'parent2') parent2Days += daysInOverlap;
    else if (period.parent === 'both' && period.benefitLevel !== 'none') bothDays += daysInOverlap; // count only true double-leave
  });

  return {
    month: format(month, 'MMM yyyy', { locale: sv }),
    income,
    parent1Days,
    parent2Days,
    bothDays,
  };
});
  
  // Calculate Y-axis domain: max monthly income + 20%, rounded to nice intervals
  const maxIncome = Math.max(...monthlyData.map(d => d.income));
  const yAxisMax = maxIncome * 1.2;
  
  // Round to nearest 5000 or 10000 for clean scale
  const roundToNice = (value: number) => {
    if (value <= 50000) return Math.ceil(value / 5000) * 5000;
    return Math.ceil(value / 10000) * 10000;
  };
  
  const yMax = roundToNice(yAxisMax);
  
  if (import.meta.env.DEV) {
    // Debug: verify data passed to chart
    // eslint-disable-next-line no-console
    console.table(monthlyData);
  }
  
  return (
    <div className="space-y-4">
      <h3 className="text-xl font-semibold">Inkomsttidslinje</h3>
      
      <div className="relative h-64 bg-muted/30 rounded-lg p-4" aria-label="Inkomsttidslinje diagram">
        {/* Y-axis labels */}
        <div className="absolute left-0 top-0 bottom-0 w-20 flex flex-col justify-between text-xs text-muted-foreground">
          <span>{formatCurrency(yMax)}</span>
          <span>{formatCurrency(yMax * 0.75)}</span>
          <span>{formatCurrency(yMax * 0.5)}</span>
          <span>{formatCurrency(yMax * 0.25)}</span>
          <span>0 kr</span>
        </div>
        
        {/* Minimum income line */}
        <div 
          className="absolute left-20 right-0 border-t-2 border-destructive border-dashed z-10 pointer-events-none"
          style={{ 
            bottom: `calc(${(minHouseholdIncome / yMax) * 100}% + 32px)`,
          }}
        >
          <span className="absolute -top-5 right-0 text-xs text-destructive font-medium">
            Min. inkomst
          </span>
        </div>
        
        {/* Line chart */}
        <div className="absolute left-20 right-0 top-0 bottom-8">
          <svg className="w-full h-full" preserveAspectRatio="none">
            {/* Draw lines between points */}
            {monthlyData.map((data, index) => {
              if (index === monthlyData.length - 1) return null;
              
              const x1 = (index / (monthlyData.length - 1)) * 100;
              const x2 = ((index + 1) / (monthlyData.length - 1)) * 100;
              const y1 = 100 - (data.income / yMax) * 100;
              const y2 = 100 - (monthlyData[index + 1].income / yMax) * 100;
              
              let strokeColor = 'hsl(var(--accent))';
              if (data.parent1Days > 0 && data.parent2Days === 0 && data.bothDays === 0) {
                strokeColor = 'hsl(var(--parent1))';
              } else if (data.parent2Days > 0 && data.parent1Days === 0 && data.bothDays === 0) {
                strokeColor = 'hsl(var(--parent2))';
              }
              
              return (
                <line
                  key={index}
                  x1={`${x1}%`}
                  y1={`${y1}%`}
                  x2={`${x2}%`}
                  y2={`${y2}%`}
                  stroke={strokeColor}
                  strokeWidth="2"
                />
              );
            })}
            
            {/* Draw points */}
            {monthlyData.map((data, index) => {
              const x = (index / (monthlyData.length - 1)) * 100;
              const y = 100 - (data.income / yMax) * 100;
              
              let fillColor = 'hsl(var(--accent))';
              if (data.parent1Days > 0 && data.parent2Days === 0 && data.bothDays === 0) {
                fillColor = 'hsl(var(--parent1))';
              } else if (data.parent2Days > 0 && data.parent1Days === 0 && data.bothDays === 0) {
                fillColor = 'hsl(var(--parent2))';
              }
              
              return (
                <g key={index} className="group">
                  <circle
                    cx={`${x}%`}
                    cy={`${y}%`}
                    r="4"
                    fill={fillColor}
                    className="transition-all hover:r-6"
                  />
                  <foreignObject
                    x={`${x}%`}
                    y={`${y}%`}
                    width="120"
                    height="40"
                    className="overflow-visible pointer-events-none"
                    style={{ transform: 'translate(-60px, -50px)' }}
                  >
                    <div className="hidden group-hover:block bg-popover text-popover-foreground text-xs p-2 rounded shadow-lg whitespace-nowrap">
                      {formatCurrency(data.income)}
                    </div>
                  </foreignObject>
                </g>
              );
            })}
          </svg>
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
          <span>Båda hemma (endast 10 första dagar)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-8 h-0.5 border-t-2 border-destructive border-dashed"></div>
          <span>Min. hushållsinkomst</span>
        </div>
      </div>
    </div>
  );
}
