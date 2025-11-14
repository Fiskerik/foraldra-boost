import { useMemo, useState, useCallback, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, Dot } from "recharts";
import { optimizeLeave, ParentData } from "@/utils/parentalCalculations";
import { Loader2 } from "lucide-react";

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
  const [isCalculating, setIsCalculating] = useState(false);
  const [debouncedParams, setDebouncedParams] = useState({
    parent1Data, 
    parent2Data, 
    minHouseholdIncome, 
    totalMonths,
    simultaneousLeave,
    simultaneousMonths,
    selectedStrategy
  });

  // Debounce parameter changes to prevent excessive calculations
  const debouncedSetParams = useCallback(
    (() => {
      let timeoutId: NodeJS.Timeout;
      return (params: typeof debouncedParams) => {
        clearTimeout(timeoutId);
        setIsCalculating(true);
        timeoutId = setTimeout(() => {
          setDebouncedParams(params);
          setIsCalculating(false);
        }, 300);
      };
    })(),
    []
  );

  useEffect(() => {
    debouncedSetParams({ 
      parent1Data, 
      parent2Data, 
      minHouseholdIncome, 
      totalMonths,
      simultaneousLeave,
      simultaneousMonths,
      selectedStrategy
    });
  }, [parent1Data, parent2Data, minHouseholdIncome, totalMonths, simultaneousLeave, simultaneousMonths, selectedStrategy, debouncedSetParams]);

  // Cache for optimization results
  const calculationCache = useMemo(() => new Map<string, any>(), []);

  const dataPoints = useMemo(() => {
    const points: { x: number; y: number; isCurrent: boolean }[] = [];
    
    // Clear cache when parameters change significantly
    calculationCache.clear();
    
    // Adaptive step size: fewer points for smoother performance
    const step = debouncedParams.totalMonths > 12 ? 1 : 0.5;

    for (let parent1M = 0; parent1M <= debouncedParams.totalMonths; parent1M += step) {
      try {
        const parent2M = debouncedParams.totalMonths - parent1M;
        
        // Create cache key
        const cacheKey = `${parent1M}-${debouncedParams.parent1Data.income}-${debouncedParams.parent2Data.income}-${debouncedParams.minHouseholdIncome}-${debouncedParams.selectedStrategy}`;
        
        // Check cache first
        let results;
        if (calculationCache.has(cacheKey)) {
          results = calculationCache.get(cacheKey);
        } else {
          results = optimizeLeave(
            debouncedParams.parent1Data,
            debouncedParams.parent2Data,
            debouncedParams.totalMonths,
            parent1M,
            parent2M,
            debouncedParams.minHouseholdIncome,
            7, // Max days per week for theoretical best
            debouncedParams.simultaneousMonths,
            false
          );
          calculationCache.set(cacheKey, results);
        }

        const targetStrategy = results.find(r => r.strategy === debouncedParams.selectedStrategy);
        if (targetStrategy) {
          const yValue = debouncedParams.selectedStrategy === 'maximize-income' 
            ? targetStrategy.totalIncome 
            : targetStrategy.daysSaved;
          points.push({
            x: parent1M,
            y: yValue,
            isCurrent: Math.abs(parent1M - currentParent1Months) < step,
          });
        }
      } catch (error) {
        console.error(`Failed to calculate for ${parent1M} months:`, error);
      }
    }

    return points;
  }, [debouncedParams, currentParent1Months, calculationCache]);

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
    <div id="income-distribution-graph" className="w-full h-[200px] mt-4 relative">
      {isCalculating && (
        <div className="absolute inset-0 bg-background/50 flex items-center justify-center z-10 rounded-lg">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}
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
            stroke="hsl(var(--foreground))"
          />
          <Tooltip
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                const data = payload[0].payload;
                return (
                  <div className="bg-background border border-border rounded-lg p-2 shadow-lg">
                    <p className="text-xs font-medium">Förälder 1: {data.x.toFixed(1)} mån</p>
                    <p className="text-xs font-medium">Förälder 2: {(totalMonths - data.x).toFixed(1)} mån</p>
                    <p className="text-xs text-primary font-bold">
                      {tooltipLabel}: {selectedStrategy === 'maximize-income' 
                        ? `${Math.round(data.y).toLocaleString('sv-SE')} kr`
                        : `${Math.round(data.y)} dagar`}
                    </p>
                  </div>
                );
              }
              return null;
            }}
          />
          <Line
            type="monotone"
            dataKey="y"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            dot={<CustomDot />}
            activeDot={{ r: 6 }}
          />
          <ReferenceLine
            x={currentParent1Months}
            stroke="hsl(var(--primary))"
            strokeDasharray="3 3"
            label={{ 
              value: 'Nuvarande', 
              position: 'top',
              style: { fontSize: '10px', fill: 'hsl(var(--primary))' }
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
