import React from "react";
import { LeavePeriod, formatCurrency } from "@/utils/parentalCalculations";
import {
  format,
  eachMonthOfInterval,
  startOfMonth,
  endOfMonth,
  differenceInCalendarDays,
  addMonths,
  addDays,
} from "date-fns";
import { sv } from "date-fns/locale";
import { useIsMobile } from "@/hooks/use-mobile";

const capitalizeFirstLetter = (str: string) => {
  return str.charAt(0).toUpperCase() + str.slice(1);
};

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
  labelStartDate: Date;
  labelEndDate: Date;
}

export function TimelineChart({ periods, minHouseholdIncome, calendarMonthsLimit }: TimelineChartProps) {
  const isMobile = useIsMobile();
  const [hoveredPoint, setHoveredPoint] = React.useState<{ income: number; month: string } | null>(null);

  if (periods.length === 0) return null;

  const startDate = periods[0].startDate;
  const rawEndDate = periods[periods.length - 1].endDate;
  const monthsLimit = calendarMonthsLimit && calendarMonthsLimit > 0 ? calendarMonthsLimit : null;

  const computeLimitDate = (base: Date, months: number) => {
    const safeMonths = Math.max(0, months);
    const wholeMonths = Math.floor(safeMonths);
    const fractional = safeMonths - wholeMonths;
    let limit = addMonths(base, wholeMonths);
    if (fractional > 0) {
      limit = addDays(limit, Math.round(fractional * 30));
    }
    return limit;
  };

  let chartEndDate = rawEndDate;
  if (monthsLimit !== null) {
    const limitCandidate = computeLimitDate(startDate, monthsLimit);
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
    let totalIncome = 0;

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
      
      // Calculate income for this overlap period
      if (period.parent === 'both') {
        // Both parents on leave: use dailyIncome
        totalIncome += period.dailyIncome * daysInOverlap;
        bothDays += daysInOverlap;
      } else {
        // One parent working, one on leave
        // Calculate working parent's income (prorated for this overlap)
        const monthLength = differenceInCalendarDays(mEnd, mStart) + 1;
        const proportion = daysInOverlap / monthLength;
        const workingParentIncome = (period.otherParentMonthlyIncome || 0) * proportion;
        
        // Calculate benefit income
        const benefitDaily = period.dailyBenefit || 0;
        const expectedBenefitDaysPerDay = (period.daysPerWeek || 7) / 7;
        const benefitDays = Math.round(daysInOverlap * expectedBenefitDaysPerDay);
        const benefitIncome = benefitDaily * benefitDays;
        
        totalIncome += workingParentIncome + benefitIncome;
        
        if (period.parent === "parent1" && period.benefitLevel !== "none") {
          parent1Days += daysInOverlap;
        } else if (period.parent === "parent2" && period.benefitLevel !== "none") {
          parent2Days += daysInOverlap;
        }
      }
    });

    const income = totalIncome;

    return {
      month: format(month, "MMM yyyy", { locale: sv }),
      monthDate: month,
      income,
      parent1Days,
      parent2Days,
      bothDays,
      labelStartDate: mStart,
      labelEndDate: mEnd,
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
      const labelStartDate = slice[0].labelStartDate;
      const labelEndDate = slice[slice.length - 1].labelEndDate;

      const minIncome = Math.min(...slice.map((s) => s.income));

      aggregated.push({
        month: slice.length === 1 ? labelStart : `${labelStart} – ${labelEnd} (min i perioden)`,
        monthDate: slice[0].monthDate,
        income: minIncome,
        parent1Days: parent1Total,
        parent2Days: parent2Total,
        bothDays: bothTotal,
        labelStartDate,
        labelEndDate,
      });
    }

    return aggregated;
  }, [isMobile, monthlyData]);

  const chartBottomPadding = isMobile ? 92 : 64;
  const axisWidth = isMobile ? 68 : 80;

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
              className={`absolute left-0 ${
                tick === minHouseholdIncome 
                  ? 'font-bold text-destructive' 
                  : ''
              }`}
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
          />

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
        <div
          className={`absolute bottom-0 flex items-end text-xs text-muted-foreground ${
            isMobile ? "h-24 text-[7px]" : "h-16 text-xs"
          }`}
          style={{ left: axisWidth, right: 0 }}
        >
          {chartData.map((data, index) => {
            if (index % labelStride === 0 || index === chartData.length - 1) {
              const sameMonth =
                data.labelStartDate.getFullYear() === data.labelEndDate.getFullYear() &&
                data.labelStartDate.getMonth() === data.labelEndDate.getMonth();
              const sameYear = data.labelStartDate.getFullYear() === data.labelEndDate.getFullYear();
              const labelLines: string[] = (() => {
                if (sameMonth) {
                  return [capitalizeFirstLetter(format(data.labelStartDate, isMobile ? "MMM yy" : "MMM yyyy", { locale: sv }))];
                }

                if (sameYear) {
                  if (isMobile) {
                    // Simplified format for mobile: just start month
                    return [capitalizeFirstLetter(format(data.labelStartDate, "MMM yy", { locale: sv }))];
                  }

                  return [
                    `${capitalizeFirstLetter(format(data.labelStartDate, "MMM", { locale: sv }))} – ${capitalizeFirstLetter(format(data.labelEndDate, "MMM yyyy", { locale: sv }))}`,
                  ];
                }

                if (isMobile) {
                  // Show just start date on mobile to save space
                  return [capitalizeFirstLetter(format(data.labelStartDate, "MMM yy", { locale: sv }))];
                }

                return [
                  `${capitalizeFirstLetter(format(data.labelStartDate, "MMM yyyy", { locale: sv }))}`,
                  `${capitalizeFirstLetter(format(data.labelEndDate, "MMM yyyy", { locale: sv }))}`,
                ];
              })();

              const labelKey = `${index}-label`;
              return (
                <div key={index} className="relative flex-1 h-full">
                  <div
                    className={`absolute bottom-0 left-1/2 flex -translate-x-1/2 origin-bottom flex-col items-center gap-0.5 ${
                      isMobile ? "rotate-[-45deg]" : "rotate-[-60deg]"
                    }`}
                    style={{ transformOrigin: "bottom center" }}
                    aria-hidden="true"
                  >
                    {labelLines.map((line, lineIndex) => (
                      <span key={`${labelKey}-${lineIndex}`} className="block whitespace-nowrap">
                        {line}
                      </span>
                    ))}
                  </div>
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
