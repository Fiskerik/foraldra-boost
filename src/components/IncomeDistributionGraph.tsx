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
          7, // Max days per week to maximize income
          simultaneousMonths,
          false
        );

        const maxIncomeStrategy = results.find(r => r.strategy === 'maximize-income');
        if (maxIncomeStrategy) {
          points.push({
            x: parent1M,
            y: maxIncomeStrategy.totalIncome,
            isCurrent: parent1M === Math.round(currentParent1Months),
          });
        }
      } catch (error) {
        console.error(`Failed to calculate income for ${parent1M} months:`, error);
      }
    }

    return points;
  }, [totalMonths, parent1Data, parent2Data, minHouseholdIncome, simultaneousLeave, simultaneousMonths, currentParent1Months]);

  const minTotalIncome = minHouseholdIncome * totalMonths;
  const maxIncome = Math.max(...dataPoints.map(p => p.y), minTotalIncome);
  const yAxisMax = Math.ceil(maxIncome / 50000) * 50000;

  const formatCurrency = (value: number) => {
    return `${Math.round(value / 1000)}k`;
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
            tickFormatter={formatCurrency}
            domain={[0, yAxisMax]}
            label={{ value: 'Total inkomst', angle: -90, position: 'insideLeft', style: { fontSize: '12px' } }}
            stroke="hsl(var(--foreground))"
          />
          <Tooltip
            formatter={(value: number) => [
              new Intl.NumberFormat('sv-SE', {
                style: 'currency',
                currency: 'SEK',
                maximumFractionDigits: 0
              }).format(value),
              'Total inkomst'
            ]}
            labelFormatter={(label) => `Förälder 1: ${label} mån`}
            contentStyle={{
              backgroundColor: 'hsl(var(--background))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '6px',
            }}
          />
          <ReferenceLine
            y={minTotalIncome}
            stroke="hsl(var(--destructive))"
            strokeDasharray="5 5"
            label={{
              value: 'Minimum',
              position: 'right',
              style: { fontSize: '10px', fill: 'hsl(var(--destructive))' }
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
