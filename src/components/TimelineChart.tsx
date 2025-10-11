import React from "react";
import { LeavePeriod, formatCurrency } from "@/utils/parentalCalculations";
import {
  format,
  eachMonthOfInterval,
  startOfMonth,
  endOfMonth,
  differenceInCalendarDays,
  addMonths,
  subDays,
} from "date-fns";
import { sv } from "date-fns/locale";
import { useIsMobile } from "@/hooks/use-mobile";

interface TimelineChartProps {
  periods: LeavePeriod[];
  minHouseholdIncome: number;
  calendarMonthsLimit?: number;
}

interface MonthlyPoint {
  month: string;
  monthDate: Date;
  income: number;
  parent1Days: number;
  parent2Days: number;
  bothDays: number;
}

export function TimelineChart({ periods, minHouseholdIncome, calendarMonthsLimit }: TimelineChartProps) {
  const isMobile = useIsMobile();
  const [hoveredPoint, setHoveredPoint] = React.useState<{ income: number; month: string } | null>(null);

  if (periods.length === 0) return null;

  const startDate = periods[0].startDate;
  const rawEndDate = periods[periods.length - 1].endDate;
  const monthsLimit = calendarMonthsLimit && calendarMonthsLimit > 0 ? calendarMonthsLimit : null;

  let chartEndDate = rawEndDate;
  if (monthsLimit) {
    const limitCandidate = subDays(addMonths(startDate, monthsLimit), 1);
    if (limitCandidate.getTime() >= startDate.getTime() && limitCandidate.getTime() < chartEndDate.getTime()) {
      chartEndDate = limitCandidate;
    }
  }

  if (chartEndDate.getTime() < startDate.getTime()) {
    chartEndDate = startDate;
  }

  // Generate monthly data based on overlap with each period
  const months = eachMonthOfInterval({ start: startDate, end: chartEndDate });

  const monthlyData: MonthlyPoint[] = months.map((month) => {
    const mStart = startOfMonth(month);
    const rawMonthEnd = endOfMonth(month);
    const mEnd = rawMonthEnd.getTime() > chartEndDate.getTime() ? chartEndDate : rawMonthEnd;
    let incomeDaysSum = 0;
    let daysCovered = 0;
    let parent1Days = 0;
    let parent2Days = 0;
    let bothDays = 0;

    periods.forEach((period) => {
      if (period.startDate.getTime() > chartEndDate.getTime()) {
        return;
      }

      const boundedPeriodEnd = period.endDate.getTime() > chartEndDate.getTime() ? chartEndDate : period.endDate;
      const overlapStart = period.startDate > mStart ? period.startDate : mStart;
      const overlapEnd = boundedPeriodEnd < mEnd ? boundedPeriodEnd : mEnd;
      const hasOverlap = overlapStart <= overlapEnd;
      if (!hasOverlap) return;

      const daysInOverlap = differenceInCalendarDays(overlapEnd, overlapStart) + 1;
      incomeDaysSum += period.dailyIncome * daysInOverlap;
      daysCovered += daysInOverlap;

      if (period.parent === "parent1") {
        parent1Days += daysInOverlap;
      } else if (period.parent === "parent2") {
        parent2Days += daysInOverlap;
      } else if (period.parent === "both" && period.benefitLevel !== "none") {
        bothDays += daysInOverlap; // count only overlap days with compensation
      }
    });

    const avgDaily = daysCovered > 0 ? incomeDaysSum / daysCovered : 0;
    const income = avgDaily * 30; // normalize to 30-day month for a stable baseline

    return {
      month: format(month, "MMM yyyy", { locale: sv }),
      monthDate: month,
      income,
      parent1Days,
      parent2Days,
      bothDays,
    };
  });

  const chartData = React.useMemo(() => {
    if (!isMobile) {
      return monthlyData;
    }

    const maxPoints = 8;
    if (monthlyData.length <= maxPoints) {
      return monthlyData;
    }

    const groupSize = Math.ceil(monthlyData.length / maxPoints);
    const aggregated: MonthlyPoint[] = [];

    for (let index = 0; index < monthlyData.length; index += groupSize) {
      const slice = monthlyData.slice(index, index + groupSize);
      if (slice.length === 0) {
        continue;
      }

      const totalIncome = slice.reduce((sum, item) => sum + item.income, 0);
      const parent1Total = slice.reduce((sum, item) => sum + item.parent1Days, 0);
      const parent2Total = slice.reduce((sum, item) => sum + item.parent2Days, 0);
      const bothTotal = slice.reduce((sum, item) => sum + item.bothDays, 0);
      const labelStart = slice[0].month;
      const labelEnd = slice[slice.length - 1].month;

      aggregated.push({
        month: slice.length === 1 ? labelStart : `${labelStart} – ${labelEnd}`,
        monthDate: slice[0].monthDate,
        income: totalIncome / slice.length,
        parent1Days: parent1Total,
        parent2Days: parent2Total,
        bothDays: bothTotal,
      });
    }

    return aggregated;
  }, [isMobile, monthlyData]);

  const chartBottomPadding = 32; // matches Tailwind bottom-8 spacing used for the x-axis labels
  const axisWidth = 80;

  const allIncomeValues = monthlyData.map((d) => d.income);
  const maxIncome = Math.max(minHouseholdIncome, ...allIncomeValues, 0);

  const getNiceStep = (maxValue: number) => {
    if (maxValue <= 0) {
      return 1000;
    }

    const roughStep = maxValue / 4;
    const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
    const residual = roughStep / magnitude;

    if (residual >= 5) return 5 * magnitude;
    if (residual >= 3) return 2.5 * magnitude;
    if (residual >= 2) return 2 * magnitude;
    if (residual >= 1) return magnitude;
    return 0.5 * magnitude;
  };

  const step = getNiceStep(maxIncome * 1.1);
  const safeStep = step > 0 ? step : 1000;
  const yMax = Math.max(safeStep, Math.ceil((maxIncome * 1.1) / safeStep) * safeStep);
  const safeYMax = yMax > 0 ? yMax : 1;

  const baseTicks: number[] = [];
  for (let value = 0; value <= yMax; value += safeStep) {
    baseTicks.push(Math.round(value));
  }

  if (!baseTicks.includes(Math.round(minHouseholdIncome))) {
    baseTicks.push(minHouseholdIncome);
  }

  const yTicks = Array.from(new Set(baseTicks)).filter((value) => value >= 0).sort((a, b) => b - a);

  const clampToUnitInterval = (value: number) => {
    if (value <= 0) return 0;
    if (value >= safeYMax) return 1;
    return value / safeYMax;
  };

  const getYPercent = (value: number) => 100 - clampToUnitInterval(value) * 100;

  const minIncomePosition = getYPercent(minHouseholdIncome);

  const getColorForData = (d: MonthlyPoint) => {
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

  const maxLabels = isMobile ? 4 : 8;
  const computeLabelStride = () => {
    if (!isMobile) {
      return Math.max(1, Math.ceil(chartData.length / maxLabels));
    }

    if (chartData.length > 12) {
      return 3;
    }

    if (chartData.length > 6) {
      return 2;
    }

    return 1;
  };

  const labelStride = computeLabelStride();

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
          className="absolute top-0 text-xs text-muted-foreground"
          style={{ left: 0, bottom: chartBottomPadding, width: axisWidth }}
        >
          {yTicks.map((tick) => (
            <div
              key={tick}
              className="absolute left-0"
              style={{ top: `${getYPercent(tick)}%`, transform: "translateY(-50%)" }}
            >
              {formatCurrency(tick)}
            </div>
          ))}
        </div>

        {/* Chart canvas */}
        <div className="absolute right-0 top-0" style={{ left: axisWidth, bottom: chartBottomPadding }}>
          {yTicks.map((tick) => (
            <div
              key={`grid-${tick}`}
              className="absolute left-0 right-0 border-t border-muted/40"
              style={{ top: `${getYPercent(tick)}%` }}
            />
          ))}
          <div
            className="absolute left-0 right-0 border-t-2 border-destructive border-dashed z-10 pointer-events-none"
            style={{ top: `${minIncomePosition}%` }}
          >
            <span className="absolute -top-6 right-0 rounded bg-background/80 px-2 py-0.5 text-xs text-destructive font-medium shadow-sm">
              Min. hushållsinkomst ({formatCurrency(minHouseholdIncome)})
            </span>
          </div>

          <svg className="w-full h-full" preserveAspectRatio="none">
            {/* Draw lines between points (black baseline + colored overlay) */}
            {chartData.map((data, index) => {
              if (chartData.length < 2 || index === chartData.length - 1) return null;

              const x1 = chartData.length > 1 ? (index / (chartData.length - 1)) * 100 : 0;
              const x2 = chartData.length > 1 ? ((index + 1) / (chartData.length - 1)) * 100 : 0;
              const y1 = getYPercent(data.income);
              const y2 = getYPercent(chartData[index + 1].income);
              const color = getColorForData(data);

              return (
                <g key={index}>
                  <line
                    x1={`${x1}%`}
                    y1={`${y1}%`}
                    x2={`${x2}%`}
                    y2={`${y2}%`}
                    stroke={"hsl(0 0% 0%)"}
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
            {chartData.map((data, index) => {
              const x = chartData.length > 1 ? (index / (chartData.length - 1)) * 100 : 0;
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
          {chartData.map((data, index) => {
            if (index % labelStride === 0 || index === chartData.length - 1) {
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
