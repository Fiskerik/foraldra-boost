import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ParentIncomeCard } from "@/components/ParentIncomeCard";
import { MunicipalitySelect } from "@/components/MunicipalitySelect";
import { AvailableIncomeDisplay } from "@/components/AvailableIncomeDisplay";
import { LeavePeriodCard } from "@/components/LeavePeriodCard";
import { OptimizationResults } from "@/components/OptimizationResults";
import { InteractiveSliders } from "@/components/InteractiveSliders";
import { ParentData, calculateAvailableIncome, optimizeLeave, OptimizationResult } from "@/utils/parentalCalculations";
import { Baby, Sparkles } from "lucide-react";
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

  const parent2Months = totalMonths - parent1Months;
  const maxHouseholdIncome = parent1Income + parent2Income;

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

  const handleOptimize = (silent = false) => {
    if (!municipality) {
      if (!silent) toast.error("Vänligen välj kommun");
      return;
    }

    if (totalMonths <= 0) {
      if (!silent) toast.error("Vänligen ange antal månader lediga");
      return;
    }

    const results = optimizeLeave(
      parent1Data,
      parent2Data,
      totalMonths,
      parent1Months,
      parent2Months,
      householdIncome,
      daysPerWeek,
      simultaneousLeave ? simultaneousMonths : 0
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
    if (optimizationResults) {
      setTimeout(() => handleOptimize(true), 100);
    }
  };

  const handleDistributionChange = (value: number) => {
    setParent1Months(value);
    if (optimizationResults) {
      setTimeout(() => handleOptimize(true), 100);
    }
  };

  const handleDaysPerWeekChange = (value: number) => {
    setDaysPerWeek(value);
    if (optimizationResults) {
      setTimeout(() => handleOptimize(true), 100);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-gradient-hero text-white py-12 px-4 shadow-soft">
        <div className="container mx-auto max-w-5xl text-center space-y-4">
          <div className="flex items-center justify-center gap-3">
            <Baby className="h-12 w-12" />
            <h1 className="text-4xl md:text-5xl font-bold">
              Föräldrapenningskalkylator
            </h1>
          </div>
          <p className="text-xl opacity-90">
            Optimera er föräldraledighet för bästa ekonomi
          </p>
        </div>
      </header>

      <main className="container mx-auto max-w-5xl px-4 py-12 space-y-8">
        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
          onTotalMonthsChange={setTotalMonths}
          onDistributionChange={setParent1Months}
          onMinIncomeChange={setHouseholdIncome}
          simultaneousLeave={simultaneousLeave}
          simultaneousMonths={simultaneousMonths}
          onSimultaneousLeaveChange={setSimultaneousLeave}
          onSimultaneousMonthsChange={setSimultaneousMonths}
        />

        <div className="flex justify-center pt-6">
          <Button
            onClick={() => handleOptimize()}
            size="lg"
            className="text-lg px-8 py-6 shadow-soft bg-gradient-hero hover:opacity-90 transition-opacity"
          >
            <Sparkles className="mr-2 h-5 w-5" />
            Optimera
          </Button>
        </div>

        {optimizationResults && (
          <div id="results" className="pt-12">
            <OptimizationResults 
              results={optimizationResults} 
              minHouseholdIncome={householdIncome}
              selectedIndex={selectedStrategyIndex}
              onSelectStrategy={setSelectedStrategyIndex}
            />
          </div>
        )}

        {optimizationResults && (
          <InteractiveSliders
            householdIncome={householdIncome}
            maxHouseholdIncome={calc1.netIncome + calc2.netIncome}
            daysPerWeek={daysPerWeek}
            currentHouseholdIncome={optimizationResults[selectedStrategyIndex]?.averageMonthlyIncome || 0}
            totalIncome={optimizationResults[selectedStrategyIndex]?.totalIncome}
            daysUsed={optimizationResults[selectedStrategyIndex]?.daysUsed}
            daysSaved={optimizationResults[selectedStrategyIndex]?.daysSaved}
            onHouseholdIncomeChange={handleHouseholdIncomeChange}
            onDaysPerWeekChange={handleDaysPerWeekChange}
          />
        )}
      </main>

      <footer className="bg-muted py-8 mt-20">
        <div className="container mx-auto max-w-5xl px-4 text-center text-sm text-muted-foreground">
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
