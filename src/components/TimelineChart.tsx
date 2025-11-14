import React, { useRef, useEffect } from "react";
import { LeavePeriod, formatCurrency } from "@/utils/parentalCalculations";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import { useIsMobile } from "@/hooks/use-mobile";
import { TimelinePoint, aggregateForMobile, computeTimelineMonthlyData, condenseTimelinePoints } from "@/utils/timeline";
const capitalizeFirstLetter = (str: string) => {
  return str.charAt(0).toUpperCase() + str.slice(1);
};
type ChartPoint = TimelinePoint & {
  month: string;
  period?: LeavePeriod;
};
const formatTimelineLabel = (point: TimelinePoint & {
  month?: string;
}): string => {
  const startLabel = capitalizeFirstLetter(format(point.labelStartDate, "MMM yyyy", {
    locale: sv
  }));
  const endLabel = capitalizeFirstLetter(format(point.labelEndDate, "MMM yyyy", {
    locale: sv
  }));
  if ((point.aggregatedSpan ?? 1) > 1) {
    if (startLabel === endLabel) {
      return `${startLabel} (snitt)`;
    }
    return `${startLabel} – ${endLabel} (snitt)`;
  }
  return startLabel;
};
interface TimelineChartProps {
  periods: LeavePeriod[];
  minHouseholdIncome: number;
  calendarMonthsLimit?: number;
}
export function TimelineChart({
  periods,
  minHouseholdIncome,
  calendarMonthsLimit
}: TimelineChartProps) {
  const isMobile = useIsMobile();
  const [hoveredPoint, setHoveredPoint] = React.useState<{
    income: number;
    month: string;
    parent1Days: number;
    parent2Days: number;
    bothDays: number;
  } | null>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handlePointHover = (data: { income: number; month: string; parent1Days: number; parent2Days: number; bothDays: number } | null) => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredPoint(data);
    }, 150);
  };

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);
  if (periods.length === 0) return null;
  const monthsLimit = calendarMonthsLimit && calendarMonthsLimit > 0 ? calendarMonthsLimit : null;
  const rawMonthlyPoints = computeTimelineMonthlyData(periods, monthsLimit);
  const monthlyData: ChartPoint[] = rawMonthlyPoints.map(point => ({
    ...point,
    month: capitalizeFirstLetter(format(point.monthDate, "MMM yyyy", {
      locale: sv
    }))
  }));
  const desktopBasePoints: TimelinePoint[] = condenseTimelinePoints(rawMonthlyPoints, 19);
  const chartData = React.useMemo<ChartPoint[]>(() => {
    const formattedDesktopPoints: ChartPoint[] = desktopBasePoints.map(point => ({
      ...point,
      month: formatTimelineLabel(point)
    }));
    if (!isMobile) {
      return formattedDesktopPoints;
    }
    const mobileAggregated: ChartPoint[] = aggregateForMobile(desktopBasePoints, 8).map(point => ({
      ...point,
      month: formatTimelineLabel(point)
    }));
    return mobileAggregated;
  }, [desktopBasePoints, isMobile]);
  const chartBottomPadding = isMobile ? 110 : 80;
  const axisWidth = isMobile ? 68 : 80;
  const allIncomeValues = rawMonthlyPoints.map(d => d.income);
  const incomePool = allIncomeValues.length > 0 ? [...allIncomeValues] : [0];
  incomePool.push(minHouseholdIncome);
  const minIncomeValue = Math.min(...incomePool);
  const maxIncomeValue = Math.max(...incomePool);
  const paddingBelow = minIncomeValue > 0 ? minIncomeValue * 0.25 : 0;
  const rawYMin = Math.max(0, minIncomeValue - paddingBelow);
  const baseRange = Math.max(1, maxIncomeValue - rawYMin);
  const paddedMax = maxIncomeValue + baseRange * 0.1;
  const getNiceStep = (rangeValue: number) => {
    if (rangeValue <= 0) {
      return 1000;
    }
    const roughStep = rangeValue / 4;
    const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
    const residual = roughStep / magnitude;
    if (residual >= 5) return 5 * magnitude;
    if (residual >= 3) return 2.5 * magnitude;
    if (residual >= 2) return 2 * magnitude;
    if (residual >= 1) return magnitude;
    return 0.5 * magnitude;
  };
  const step = getNiceStep(paddedMax - rawYMin);
  const safeStep = step > 0 ? step : 1000;
  const yMin = Math.max(0, Math.floor(rawYMin / safeStep) * safeStep);
  const yMax = Math.max(yMin + safeStep, Math.ceil(paddedMax / safeStep) * safeStep);
  const safeRange = Math.max(1, yMax - yMin);
  const baseTicks: number[] = [];
  for (let value = yMin; value <= yMax + safeStep / 2; value += safeStep) {
    baseTicks.push(Math.round(value));
  }
  if (!baseTicks.includes(Math.round(minHouseholdIncome))) {
    baseTicks.push(minHouseholdIncome);
  }
  const yTicks = Array.from(new Set(baseTicks)).sort((a, b) => b - a);
  const clampToUnitInterval = (value: number) => {
    if (value <= yMin) return 0;
    if (value >= yMax) return 1;
    return (value - yMin) / safeRange;
  };
  const getYPercent = (value: number) => 100 - clampToUnitInterval(value) * 100;
  const minIncomePosition = getYPercent(minHouseholdIncome);
  const getColorForData = (d: ChartPoint) => {
    // Check if this point is from a simultaneous period
    if (d.period?.isSimultaneous) {
      return '#6B21A8'; // Dark purple for simultaneous leave
    }
    
    const maxDays = Math.max(d.parent1Days, d.parent2Days, d.bothDays);
    if (maxDays <= 0) return "hsl(var(--muted-foreground))";
    if (d.bothDays === maxDays) return "hsl(var(--accent))";
    if (d.parent1Days === maxDays) return "hsl(var(--parent1))";
    return "hsl(var(--parent2))";
  };
  if (chartData.length === 0) {
    return null;
  }
  if (import.meta.env.DEV) {
    // Debug: verify data passed to chart
    console.table(monthlyData);
  }
  const computeLabelStride = () => {
    if (isMobile) {
      // Show maximum 2 labels on mobile for better spacing
      const maxLabels = 2;
      return Math.max(1, Math.floor(chartData.length / maxLabels));
    } else {
      // Desktop: show more labels
      const maxLabels = 8;
      return Math.max(1, Math.ceil(chartData.length / maxLabels));
    }
  };
  const labelStride = computeLabelStride();
  return <div id="timeline-chart" className="space-y-4">
      <h3 className="sr-only" id="income-timeline-heading">Inkomsttidslinje</h3>

      <div className="flex w-full justify-end">
        <div className="bg-white dark:bg-card rounded-lg shadow-lg p-3 min-w-[200px] border border-border">
          {hoveredPoint ? <>
              <div className="text-xs text-muted-foreground mb-1">{hoveredPoint.month}</div>
              <div className="text-lg font-semibold text-foreground">{formatCurrency(hoveredPoint.income)}</div>
              <div className="text-xs text-muted-foreground mt-2">
                {hoveredPoint.parent1Days > 0 && "Förälder 1"}
                {hoveredPoint.parent1Days > 0 && hoveredPoint.parent2Days > 0 && " & "}
                {hoveredPoint.parent2Days > 0 && "Förälder 2"}
                {hoveredPoint.bothDays > 0 && hoveredPoint.parent1Days === 0 && hoveredPoint.parent2Days === 0 && "Båda föräldrar"}
              </div>
            </> : <div className="text-sm text-muted-foreground">Hovra över grafen för att se detaljer</div>}
        </div>
      </div>

      <div className="relative h-64 bg-muted/30 rounded-lg p-4" aria-labelledby="income-timeline-heading">
        {/* Y-axis labels */}
        <div className="absolute top-0 text-xs text-muted-foreground" style={{
        left: 0,
        bottom: chartBottomPadding,
        width: axisWidth
      }}>
          {yTicks.map(tick => <div key={tick} className={`absolute left-0 ${tick === minHouseholdIncome ? 'font-bold text-destructive' : ''}`} style={{
          top: `${getYPercent(tick)}%`,
          transform: "translateY(-50%)"
        }}>
              {formatCurrency(tick)}
            </div>)}
        </div>

        {/* Chart canvas */}
        <div className="absolute right-0 top-0" style={{
        left: axisWidth,
        bottom: chartBottomPadding
      }}>
          {yTicks.map(tick => <div key={`grid-${tick}`} className="absolute left-0 right-0 border-t border-muted/40" style={{
          top: `${getYPercent(tick)}%`
        }} />)}
          <div className="absolute left-0 right-0 border-t-2 border-destructive border-dashed z-10 pointer-events-none" style={{
          top: `${minIncomePosition}%`
        }} />

          <svg className="w-full h-full" preserveAspectRatio="none">
            {/* Draw lines between points (black baseline + colored overlay) */}
            {chartData.map((data, index) => {
            if (chartData.length < 2 || index === chartData.length - 1) return null;
            const x1 = chartData.length > 1 ? index / (chartData.length - 1) * 100 : 0;
            const x2 = chartData.length > 1 ? (index + 1) / (chartData.length - 1) * 100 : 0;
            const y1 = getYPercent(data.income);
            const y2 = getYPercent(chartData[index + 1].income);
            const color = getColorForData(data);
            return <g key={index}>
                  <line x1={`${x1}%`} y1={`${y1}%`} x2={`${x2}%`} y2={`${y2}%`} stroke={"hsl(0 0% 0%)"} strokeWidth="3" strokeLinecap="round" opacity="0.7" />
                  <line x1={`${x1}%`} y1={`${y1}%`} x2={`${x2}%`} y2={`${y2}%`} stroke={color} strokeWidth="2" strokeLinecap="round" />
                </g>;
          })}

            {/* Draw points (colored only, no black dot) */}
            {chartData.map((data, index) => {
            const x = chartData.length > 1 ? index / (chartData.length - 1) * 100 : 0;
            const y = getYPercent(data.income);
            const color = getColorForData(data);
            return <g key={index} className="group">
                  {/* Larger invisible hover area for accessibility */}
                  <circle cx={`${x}%`} cy={`${y}%`} r="16" fill="transparent" onMouseEnter={() => handlePointHover({
                income: data.income,
                month: data.month,
                parent1Days: data.parent1Days,
                parent2Days: data.parent2Days,
                bothDays: data.bothDays
              })} onMouseLeave={() => {}} className="cursor-pointer" />
                  {/* Visible colored point */}
                  <circle cx={`${x}%`} cy={`${y}%`} r="4" fill={color} stroke={color} strokeWidth="1" className="transition-all" aria-label={`${data.month}: ${formatCurrency(data.income)}`} />
                </g>;
          })}
          </svg>
        </div>

        {/* X-axis labels */}
        <div className={`absolute bottom-0 flex items-end text-xs text-muted-foreground ${isMobile ? "h-24 text-[7px]" : "h-16 text-xs"}`} style={{
        left: axisWidth,
        right: 0
      }}>
          {chartData.map((data, index) => {
          if (index % labelStride === 0 || index === chartData.length - 1) {
            const sameMonth = data.labelStartDate.getFullYear() === data.labelEndDate.getFullYear() && data.labelStartDate.getMonth() === data.labelEndDate.getMonth();
            const sameYear = data.labelStartDate.getFullYear() === data.labelEndDate.getFullYear();
            const labelLines: string[] = (() => {
              if (sameMonth) {
                return [capitalizeFirstLetter(format(data.labelStartDate, isMobile ? "MMM yy" : "MMM yyyy", {
                  locale: sv
                }))];
              }
              if (sameYear) {
                if (isMobile) {
                  // Simplified format for mobile: just start month
                  return [capitalizeFirstLetter(format(data.labelStartDate, "MMM yy", {
                    locale: sv
                  }))];
                }
                return [`${capitalizeFirstLetter(format(data.labelStartDate, "MMM", {
                  locale: sv
                }))} – ${capitalizeFirstLetter(format(data.labelEndDate, "MMM yyyy", {
                  locale: sv
                }))}`];
              }
              if (isMobile) {
                // Show just start date on mobile to save space
                return [capitalizeFirstLetter(format(data.labelStartDate, "MMM yy", {
                  locale: sv
                }))];
              }
              return [`${capitalizeFirstLetter(format(data.labelStartDate, "MMM yyyy", {
                locale: sv
              }))}`, `${capitalizeFirstLetter(format(data.labelEndDate, "MMM yyyy", {
                locale: sv
              }))}`];
            })();
            const labelKey = `${index}-label`;
            return <div key={index} className="relative flex-1 h-full">
                  <div className={`absolute bottom-0 left-1/2 flex -translate-x-1/2 origin-bottom flex-col items-center gap-0.5 ${isMobile ? "rotate-[-45deg]" : "rotate-[-60deg]"}`} style={{
                transformOrigin: "bottom center"
              }} aria-hidden="true">
                    {labelLines.map((line, lineIndex) => <span key={`${labelKey}-${lineIndex}`} className="block whitespace-nowrap py-[60px] px-0">
                        {line}
                      </span>)}
                  </div>
                </div>;
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
          <div className="w-4 h-4 rounded" style={{ backgroundColor: '#6B21A8' }}></div>
          <span>Båda samtidigt</span>
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
    </div>;
}