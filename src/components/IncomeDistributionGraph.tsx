import { useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, Dot } from "recharts";
import { optimizeLeave, ParentData } from "@/utils/parentalCalculations";

interface IncomeDistributionGraphProps {
  totalMonths: number;
  currentParent1Months: number;
  minHouseholdIncome: number;
  parent1Data: ParentData;
  parent2Data: ParentData;
  simultaneousLeave: boolean;
  simultaneousMonths: number;
  selectedStrategy: 'maximize-income' | 'save-days';
  onDistributionClick: (parent1Months: number) => void;
}

export function IncomeDistributionGraph({
  totalMonths,
  currentParent1Months,
  minHouseholdIncome,
  parent1Data,
  parent2Data,
  simultaneousLeave,
  simultaneousMonths,
  selectedStrategy,
  onDistributionClick,
}: IncomeDistributionGraphProps) {
  const dataPoints = useMemo(() => {
    const points: { x: number; y: number; isCurrent: boolean }[] = [];

    for (let parent1M = 0; parent1M <= totalMonths; parent1M++) {
      try {
        const parent2M = totalMonths - parent1M;
        const results = optimizeLeave(
          parent1Data,
          parent2Data,
          totalMonths,
          parent1M,
          parent2M,
          minHouseholdIncome,
          7, // Max days per week for theoretical best
          simultaneousMonths,
          false
        );

        const targetStrategy = results.find(r => r.strategy === selectedStrategy);
        if (targetStrategy) {
          const yValue = selectedStrategy === 'maximize-income' 
            ? targetStrategy.totalIncome 
            : targetStrategy.daysSaved;
          points.push({
            x: parent1M,
            y: yValue,
            isCurrent: parent1M === Math.round(currentParent1Months),
          });
        }
      } catch (error) {
        console.error(`Failed to calculate for ${parent1M} months:`, error);
      }
    }

    return points;
  }, [totalMonths, parent1Data, parent2Data, minHouseholdIncome, simultaneousLeave, simultaneousMonths, currentParent1Months, selectedStrategy]);

  const maxValue = Math.max(...dataPoints.map(p => p.y), 0);
  const yAxisMax = selectedStrategy === 'maximize-income'
    ? Math.ceil(maxValue / 50000) * 50000
    : Math.ceil(maxValue / 10) * 10;

  const formatYAxis = (value: number) => {
    if (selectedStrategy === 'maximize-income') {
      return `${Math.round(value / 1000)}k`;
    }
    return value.toString();
  };

  const CustomDot = (props: any) => {
    const { cx, cy, payload } = props;
    if (payload.isCurrent) {
      return (
        <g>
          <circle cx={cx} cy={cy} r={6} fill="hsl(var(--primary))" stroke="white" strokeWidth={2} />
        </g>
      );
    }
    return null;
  };

  const handleClick = (data: any) => {
    if (data && data.activePayload && data.activePayload[0]) {
      const clickedPoint = data.activePayload[0].payload;
      onDistributionClick(clickedPoint.x);
    }
  };

  const yAxisLabel = selectedStrategy === 'maximize-income' ? 'Total inkomst' : 'Dagar sparade';
  const tooltipLabel = selectedStrategy === 'maximize-income' ? 'Total inkomst' : 'Dagar sparade';

  return (
    <div className="w-full h-[200px] mt-4">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={dataPoints} onClick={handleClick} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted))" />
          <XAxis
            dataKey="x"
            type="number"
            domain={[0, totalMonths]}
            ticks={Array.from({ length: totalMonths + 1 }, (_, i) => i)}
            label={{ value: 'Förälder 1 månader', position: 'insideBottom', offset: -5, style: { fontSize: '12px' } }}
            stroke="hsl(var(--foreground))"
          />
          <YAxis
            tickFormatter={formatYAxis}
            domain={[0, yAxisMax]}
            label={{ value: yAxisLabel, angle: -90, position: 'insideLeft', style: { fontSize: '12px' } }}
            stroke="hsl(var(--foreground))"
          />
          <Tooltip
            formatter={(value: number) => {
              if (selectedStrategy === 'maximize-income') {
                return [
                  new Intl.NumberFormat('sv-SE', {
                    style: 'currency',
                    currency: 'SEK',
                    maximumFractionDigits: 0
                  }).format(value),
                  tooltipLabel
                ];
              }
              return [value.toString(), tooltipLabel];
            }}
            labelFormatter={(label) => `Förälder 1: ${label} mån`}
            contentStyle={{
              backgroundColor: 'hsl(var(--background))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '6px',
            }}
          />
          <Line
            type="monotone"
            dataKey="y"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            dot={<CustomDot />}
            activeDot={{ r: 6, cursor: 'pointer' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
