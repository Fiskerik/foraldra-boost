import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ParentIncomeCard } from "@/components/ParentIncomeCard";
import { MunicipalitySelect } from "@/components/MunicipalitySelect";
import { AvailableIncomeDisplay } from "@/components/AvailableIncomeDisplay";
import { LeavePeriodCard } from "@/components/LeavePeriodCard";
import { OptimizationResults } from "@/components/OptimizationResults";
import { InteractiveSliders } from "@/components/InteractiveSliders";
import {
  ParentData,
  calculateAvailableIncome,
  optimizeLeave,
  OptimizationResult,
  calculateMaxLeaveMonths,
} from "@/utils/parentalCalculations";
import { Baby, Sparkles } from "lucide-react";
import { calculateStrategyIncomeSummary, StrategyIncomeSummary } from "@/utils/incomeSummary";
import { toast } from "sonner";

const Index = () => {
  const [parent1Income, setParent1Income] = useState(30000);
  const [parent2Income, setParent2Income] = useState(55000);
  const [parent1HasAgreement, setParent1HasAgreement] = useState(true);
  const [parent2HasAgreement, setParent2HasAgreement] = useState(false);
  const [municipality, setMunicipality] = useState("Vallentuna");
  const [taxRate, setTaxRate] = useState(30.2);
  const [totalMonths, setTotalMonths] = useState(15);
  const [parent1Months, setParent1Months] = useState(10);
  const [householdIncome, setHouseholdIncome] = useState(45000);
  const [simultaneousLeave, setSimultaneousLeave] = useState(false);
  const [simultaneousMonths, setSimultaneousMonths] = useState(0);
  const [daysPerWeek, setDaysPerWeek] = useState(5);
  const [optimizationResults, setOptimizationResults] = useState<OptimizationResult[] | null>(null);
  const [selectedStrategyIndex, setSelectedStrategyIndex] = useState(0);
  const [userHasManuallySetIncome, setUserHasManuallySetIncome] = useState(false);

  type OptimizeOverrides = {
    totalMonths?: number;
    parent1Months?: number;
    householdIncome?: number;
    daysPerWeek?: number;
    simultaneousLeave?: boolean;
    simultaneousMonths?: number;
  };

  const parent2Months = Math.max(totalMonths - parent1Months, 0);
  const maxHouseholdIncome = parent1Income + parent2Income;
  const maxLeaveMonths = calculateMaxLeaveMonths(daysPerWeek);

  const parent1Data: ParentData = {
    income: parent1Income,
    hasCollectiveAgreement: parent1HasAgreement,
    taxRate: taxRate,
  };

  const parent2Data: ParentData = {
    income: parent2Income,
    hasCollectiveAgreement: parent2HasAgreement,
    taxRate: taxRate,
  };

  const calc1 = calculateAvailableIncome(parent1Data);
  const calc2 = calculateAvailableIncome(parent2Data);

  const handleOptimize = (
    options: { silent?: boolean; overrides?: OptimizeOverrides } = {}
  ) => {
    const { silent = false, overrides = {} } = options;
    const effectiveTotalMonths = overrides.totalMonths ?? totalMonths;
    const effectiveParent1Months = overrides.parent1Months ?? parent1Months;
    const effectiveParent2Months = Math.max(0, effectiveTotalMonths - effectiveParent1Months);
    const effectiveHouseholdIncome = overrides.householdIncome ?? householdIncome;
    const effectiveDaysPerWeek = overrides.daysPerWeek ?? daysPerWeek;
    const effectiveSimultaneousLeave = overrides.simultaneousLeave ?? simultaneousLeave;
    const effectiveSimultaneousMonths = overrides.simultaneousMonths ?? simultaneousMonths;

    if (!municipality) {
      if (!silent) toast.error("Vänligen välj kommun");
      return;
    }

    if (effectiveTotalMonths <= 0) {
      if (!silent) toast.error("Vänligen ange antal månader lediga");
      return;
    }

    const results = optimizeLeave(
      parent1Data,
      parent2Data,
      effectiveTotalMonths,
      effectiveParent1Months,
      effectiveParent2Months,
      effectiveHouseholdIncome,
      effectiveDaysPerWeek,
      effectiveSimultaneousLeave ? effectiveSimultaneousMonths : 0
    );

    setOptimizationResults(results);
    if (!silent) {
      toast.success("Optimering klar!");
      
      // Scroll to results
      setTimeout(() => {
        document.getElementById("results")?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    }
  };

  const handleHouseholdIncomeChange = (value: number) => {
    setHouseholdIncome(value);
    setUserHasManuallySetIncome(true);
    // Don't recalculate strategy - household income is just a visualization threshold
  };

  const handleDistributionChange = (value: number) => {
    setParent1Months(value);
    if (optimizationResults) {
      handleOptimize({ silent: true, overrides: { parent1Months: value } });
    }
  };

  const handleDaysPerWeekChange = (value: number) => {
    const clampedDays = Math.max(1, Math.min(7, Math.round(value)));
    const newMaxMonths = calculateMaxLeaveMonths(clampedDays);
    const adjustedTotalMonths = Math.min(Math.max(totalMonths, 0), newMaxMonths);
    const adjustedParent1Months = Math.min(parent1Months, adjustedTotalMonths);

    setDaysPerWeek(clampedDays);
    setUserHasManuallySetIncome(false); // Reset flag when planning parameters change

    if (totalMonths !== adjustedTotalMonths) {
      setTotalMonths(adjustedTotalMonths);
    }

    if (parent1Months > adjustedTotalMonths) {
      setParent1Months(adjustedTotalMonths);
    }

    const maxSimultaneous = Math.floor(adjustedTotalMonths / 2);
    const adjustedSimultaneousMonths = Math.min(simultaneousMonths, maxSimultaneous);

    if (simultaneousMonths > maxSimultaneous) {
      setSimultaneousMonths(maxSimultaneous);
    }

    if (optimizationResults) {
      handleOptimize({
        silent: true,
        overrides: {
          daysPerWeek: clampedDays,
          totalMonths: adjustedTotalMonths,
          parent1Months: adjustedParent1Months,
          simultaneousMonths: simultaneousLeave ? adjustedSimultaneousMonths : simultaneousMonths,
        },
      });
    }
  };

  const handleTotalMonthsChange = (value: number) => {
    const safeValue = Math.max(0, value);
    const allowedMax = calculateMaxLeaveMonths(daysPerWeek);
    const constrainedValue = Math.min(safeValue, allowedMax);
    const adjustedParent1Months = Math.min(parent1Months, constrainedValue);
    const adjustedSimultaneousMonths = Math.min(simultaneousMonths, Math.floor(constrainedValue / 2));

    setTotalMonths(constrainedValue);
    setUserHasManuallySetIncome(false); // Reset flag when planning parameters change
    // Adjust parent months to stay within bounds
    if (parent1Months > constrainedValue) {
      setParent1Months(constrainedValue);
    }
    if (simultaneousMonths > Math.floor(constrainedValue / 2)) {
      setSimultaneousMonths(Math.floor(constrainedValue / 2));
    }
    if (optimizationResults) {
      handleOptimize({
        silent: true,
        overrides: {
          totalMonths: constrainedValue,
          parent1Months: adjustedParent1Months,
          simultaneousMonths: simultaneousLeave ? adjustedSimultaneousMonths : simultaneousMonths,
        },
      });
    }
  };

  const handleSimultaneousLeaveChange = (value: boolean) => {
    setSimultaneousLeave(value);
    const maxAllowed = Math.floor(totalMonths / 2);
    const nextSimultaneousMonths = value ? Math.min(simultaneousMonths, maxAllowed) : 0;

    if (value) {
      if (simultaneousMonths > maxAllowed) {
        setSimultaneousMonths(nextSimultaneousMonths);
      }
    } else {
      setSimultaneousMonths(0);
    }

    if (optimizationResults) {
      handleOptimize({
        silent: true,
        overrides: {
          simultaneousLeave: value,
          simultaneousMonths: nextSimultaneousMonths,
        },
      });
    }
  };

  const handleSimultaneousMonthsChange = (value: number) => {
    const safeValue = Math.max(0, Math.min(value, Math.floor(totalMonths / 2)));
    setSimultaneousMonths(safeValue);

    if (optimizationResults) {
      handleOptimize({
        silent: true,
        overrides: {
          simultaneousMonths: safeValue,
        },
      });
    }
  };

  const strategyIncomeSummaries = useMemo<StrategyIncomeSummary[]>(() => {
    if (!optimizationResults) {
      return [];
    }

    return optimizationResults.map(result => calculateStrategyIncomeSummary(result.periods));
  }, [optimizationResults]);

  const selectedIncomeSummary =
    optimizationResults && strategyIncomeSummaries[selectedStrategyIndex]
      ? strategyIncomeSummaries[selectedStrategyIndex]
      : undefined;

  useEffect(() => {
    // Only auto-adjust if user hasn't manually set income
    if (userHasManuallySetIncome) {
      return;
    }

    if (!selectedIncomeSummary?.hasEligibleFullMonths) {
      return;
    }

    const minimumIncome = selectedIncomeSummary.lowestFullMonthIncome;

    if (minimumIncome === null || !Number.isFinite(minimumIncome)) {
      return;
    }

    const roundedMinimum = Math.round(minimumIncome);

    setHouseholdIncome(prevIncome => {
      if (prevIncome >= roundedMinimum) {
        return prevIncome;
      }
      return roundedMinimum;
    });
  }, [selectedIncomeSummary, userHasManuallySetIncome]);

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-gradient-hero text-white py-4 md:py-12 px-2 md:px-4 shadow-soft">
        <div className="container mx-auto max-w-5xl text-center space-y-1 md:space-y-4">
          <div className="flex items-center justify-center gap-1 md:gap-3">
            <Baby className="h-6 md:h-12 w-6 md:w-12" />
            <h1 className="text-xl md:text-5xl font-bold">
              Föräldrapenningskalkylator
            </h1>
          </div>
          <p className="text-xs md:text-xl opacity-90">
            Optimera er föräldraledighet för bästa ekonomi
          </p>
        </div>
      </header>

      <main className={`container mx-auto max-w-5xl px-2 md:px-4 py-4 md:py-12 space-y-3 md:space-y-8 ${optimizationResults ? 'pb-96' : 'pb-32'}`}>
        <section className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-6">
          <ParentIncomeCard
            parentNumber={1}
            income={parent1Income}
            hasCollectiveAgreement={parent1HasAgreement}
            onIncomeChange={setParent1Income}
            onCollectiveAgreementChange={setParent1HasAgreement}
          />
          <ParentIncomeCard
            parentNumber={2}
            income={parent2Income}
            hasCollectiveAgreement={parent2HasAgreement}
            onIncomeChange={setParent2Income}
            onCollectiveAgreementChange={setParent2HasAgreement}
          />
        </section>

        <section>
          <MunicipalitySelect
            parentNumber={0}
            selectedMunicipality={municipality}
            onMunicipalityChange={(name, rate) => {
              setMunicipality(name);
              setTaxRate(rate);
            }}
          />
        </section>

        {municipality && (
          <AvailableIncomeDisplay
            parent1NetIncome={calc1.netIncome}
            parent2NetIncome={calc2.netIncome}
            parent1AvailableIncome={calc1.availableIncome}
            parent2AvailableIncome={calc2.availableIncome}
          />
        )}

        <LeavePeriodCard
          totalMonths={totalMonths}
          parent1Months={parent1Months}
          parent2Months={parent2Months}
          minHouseholdIncome={householdIncome}
          maxHouseholdIncome={calc1.netIncome + calc2.netIncome}
          maxLeaveMonths={maxLeaveMonths}
          onTotalMonthsChange={handleTotalMonthsChange}
          onDistributionChange={handleDistributionChange}
          onMinIncomeChange={handleHouseholdIncomeChange}
          simultaneousLeave={simultaneousLeave}
          simultaneousMonths={simultaneousMonths}
          onSimultaneousLeaveChange={handleSimultaneousLeaveChange}
          onSimultaneousMonthsChange={handleSimultaneousMonthsChange}
        />

        <div className="flex justify-center pt-2 md:pt-6">
          <Button
            onClick={() => handleOptimize()}
            size="lg"
            className="text-xs md:text-lg px-4 md:px-8 py-3 md:py-6 shadow-soft bg-gradient-hero hover:opacity-90 transition-opacity"
          >
            <Sparkles className="mr-1 md:mr-2 h-3 md:h-5 w-3 md:w-5" />
            Optimera
          </Button>
        </div>

        {optimizationResults && (
          <div id="results" className="pt-4 md:pt-12">
            <OptimizationResults
              results={optimizationResults}
              minHouseholdIncome={householdIncome}
              selectedIndex={selectedStrategyIndex}
              onSelectStrategy={setSelectedStrategyIndex}
              timelineMonths={totalMonths}
            />
          </div>
        )}

        {optimizationResults && (
          <InteractiveSliders
            householdIncome={householdIncome}
            maxHouseholdIncome={calc1.netIncome + calc2.netIncome}
            daysPerWeek={daysPerWeek}
            totalMonths={totalMonths}
            currentHouseholdIncome={optimizationResults[selectedStrategyIndex]?.averageMonthlyIncome || 0}
            periods={optimizationResults[selectedStrategyIndex]?.periods || []}
            totalIncome={optimizationResults[selectedStrategyIndex]?.totalIncome}
            daysUsed={optimizationResults[selectedStrategyIndex]?.daysUsed}
            daysSaved={optimizationResults[selectedStrategyIndex]?.daysSaved}
            strategyIncomeSummary={selectedIncomeSummary}
            onHouseholdIncomeChange={handleHouseholdIncomeChange}
            onDaysPerWeekChange={handleDaysPerWeekChange}
            onTotalMonthsChange={handleTotalMonthsChange}
          />
        )}
      </main>

      <footer className="bg-muted py-3 md:py-8 mt-6 md:mt-20">
        <div className="container mx-auto max-w-5xl px-2 md:px-4 text-center text-[10px] md:text-sm text-muted-foreground">
          <p>
            Kalkylatorn ger en uppskattning baserad på gällande regler för föräldrapenning.
            Kontakta Försäkringskassan för exakta beräkningar.
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
