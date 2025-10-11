import React from "react";
import { LeavePeriod, formatCurrency } from "@/utils/parentalCalculations";
import { format, eachMonthOfInterval, startOfMonth, endOfMonth, differenceInCalendarDays } from "date-fns";
import { sv } from "date-fns/locale";

interface TimelineChartProps {
  periods: LeavePeriod[];
  minHouseholdIncome: number;
}

export function TimelineChart({ periods, minHouseholdIncome }: TimelineChartProps) {
  const [hoveredPoint, setHoveredPoint] = React.useState<{ income: number; month: string } | null>(null);

  if (periods.length === 0) return null;

  const startDate = periods[0].startDate;
  const endDate = periods[periods.length - 1].endDate;
  
  // Generate monthly data based on overlap with each period
  const months = eachMonthOfInterval({ start: startDate, end: endDate });

  const monthlyData = months.map((month) => {
    const mStart = startOfMonth(month);
    const mEnd = endOfMonth(month);
    let incomeDaysSum = 0;
    let daysCovered = 0;
    let parent1Days = 0;
    let parent2Days = 0;
    let bothDays = 0;

    periods.forEach((period) => {
      const overlapStart = period.startDate > mStart ? period.startDate : mStart;
      const overlapEnd = period.endDate < mEnd ? period.endDate : mEnd;
      const hasOverlap = overlapStart <= overlapEnd;
      if (!hasOverlap) return;

      const daysInOverlap = differenceInCalendarDays(overlapEnd, overlapStart) + 1;
      incomeDaysSum += period.dailyIncome * daysInOverlap;
      daysCovered += daysInOverlap;

      if (period.parent === 'parent1') {
        parent1Days += daysInOverlap;
      } else if (period.parent === 'parent2') {
        parent2Days += daysInOverlap;
      } else if (period.parent === 'both' && period.benefitLevel !== 'none') {
        bothDays += daysInOverlap; // count only overlap days with compensation
      }
    });

    const avgDaily = daysCovered > 0 ? incomeDaysSum / daysCovered : 0;
    const income = avgDaily * 30; // normalize to 30-day month for a stable baseline

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
  const safeYMax = yMax > 0 ? yMax : 1;
  const chartBottomPadding = 32; // matches Tailwind bottom-8 spacing used for the x-axis labels

  const clampToUnitInterval = (value: number) => {
    if (value <= 0) return 0;
    if (value >= safeYMax) return 1;
    return value / safeYMax;
  };

  const getYPercent = (value: number) => 100 - clampToUnitInterval(value) * 100;

  const minIncomePosition = getYPercent(minHouseholdIncome);
  
  const getColorForData = (d: typeof monthlyData[number]) => {
    const maxDays = Math.max(d.parent1Days, d.parent2Days, d.bothDays);
    if (maxDays <= 0) return 'hsl(var(--muted-foreground))';
    if (d.bothDays === maxDays) return 'hsl(var(--accent))';
    if (d.parent1Days === maxDays) return 'hsl(var(--parent1))';
    return 'hsl(var(--parent2))';
  };
  
  if (import.meta.env.DEV) {
    // Debug: verify data passed to chart
    // eslint-disable-next-line no-console
    console.table(monthlyData);
  }
  
  return (
    <div className="space-y-4">
      <h3 className="text-xl font-semibold">Inkomsttidslinje</h3>
      
      <div className="relative h-64 bg-muted/30 rounded-lg p-4" aria-label="Inkomsttidslinje diagram">
        {/* Hover tooltip box - top right */}
        {hoveredPoint && (
          <div className="absolute top-4 right-4 bg-popover text-popover-foreground border border-border rounded-lg shadow-lg p-3 z-20">
            <div className="text-xs text-muted-foreground mb-1">{hoveredPoint.month}</div>
            <div className="text-sm font-bold">{formatCurrency(hoveredPoint.income)}</div>
          </div>
        )}
        
        {/* Y-axis labels */}
        <div
          className="absolute left-0 top-0 w-20 flex flex-col justify-between text-xs text-muted-foreground"
          style={{ bottom: chartBottomPadding }}
        >
          <span>{formatCurrency(yMax)}</span>
          <span>{formatCurrency(yMax * 0.75)}</span>
          <span>{formatCurrency(yMax * 0.5)}</span>
          <span>{formatCurrency(yMax * 0.25)}</span>
          <span>0 kr</span>
        </div>
        
        {/* Minimum income line */}
        {/* Chart canvas */}
        <div className="absolute left-20 right-0 top-0" style={{ bottom: chartBottomPadding }}>
          <div
            className="absolute left-0 right-0 border-t-2 border-destructive border-dashed z-10 pointer-events-none"
            style={{ top: `${minIncomePosition}%` }}
          >
            <span className="absolute -top-5 right-0 text-xs text-destructive font-medium">
              Min. inkomst
            </span>
          </div>

          <svg className="w-full h-full" preserveAspectRatio="none">
            {/* Draw lines between points (black baseline + colored overlay) */}
            {monthlyData.map((data, index) => {
              if (monthlyData.length < 2 || index === monthlyData.length - 1) return null;

              const x1 = monthlyData.length > 1 ? (index / (monthlyData.length - 1)) * 100 : 0;
              const x2 = monthlyData.length > 1 ? ((index + 1) / (monthlyData.length - 1)) * 100 : 0;
              const y1 = getYPercent(data.income);
              const y2 = getYPercent(monthlyData[index + 1].income);
              const color = getColorForData(data);
              
              return (
                <g key={index}>
                  <line
                    x1={`${x1}%`}
                    y1={`${y1}%`}
                    x2={`${x2}%`}
                    y2={`${y2}%`}
                    stroke={'hsl(0 0% 0%)'}
                    strokeWidth="3"
                    strokeLinecap="round"
                    opacity="0.7"
                  />
                  <line
                    x1={`${x1}%`}
                    y1={`${y1}%`}
                    x2={`${x2}%`}
                    y2={`${y2}%`}
                    stroke={color}
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </g>
              );
            })}
            
            {/* Draw points (colored only, no black dot) */}
            {monthlyData.map((data, index) => {
              const x = monthlyData.length > 1 ? (index / (monthlyData.length - 1)) * 100 : 0;
              const y = getYPercent(data.income);
              const color = getColorForData(data);

              return (
                <g key={index} className="group">
                  {/* Larger invisible hover area for accessibility */}
                  <circle
                    cx={`${x}%`}
                    cy={`${y}%`}
                    r="10"
                    fill="transparent"
                    onMouseEnter={() => setHoveredPoint({ income: data.income, month: data.month })}
                    onMouseLeave={() => setHoveredPoint(null)}
                  />
                  {/* Visible colored point */}
                  <circle
                    cx={`${x}%`}
                    cy={`${y}%`}
                    r="4"
                    fill={color}
                    stroke={color}
                    strokeWidth="1"
                    className="transition-all"
                    aria-label={`${data.month}: ${formatCurrency(data.income)}`}
                  />
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
          <span>Min. hushållsinkomst ({formatCurrency(minHouseholdIncome)})</span>
        </div>
      </div>
    </div>
  );
}
