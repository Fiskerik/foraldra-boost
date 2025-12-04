import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ParentIncomeCard } from "@/components/ParentIncomeCard";
import { MunicipalitySelect } from "@/components/MunicipalitySelect";
import { AvailableIncomeDisplay } from "@/components/AvailableIncomeDisplay";
import { LeavePeriodCard } from "@/components/LeavePeriodCard";
import { OptimizationResults } from "@/components/OptimizationResults";
import { InteractiveSliders } from "@/components/InteractiveSliders";
import { StrategyDetails } from "@/components/StrategyDetails";
import { AIOptimizationSection } from "@/components/AIOptimizationSection";
import {
  ParentData,
  calculateAvailableIncome,
  optimizeLeave,
  OptimizationResult,
  calculateMaxLeaveMonths,
} from "@/utils/parentalCalculations";
import { Baby, Sparkles, Save, UserPlus, LogIn, LogOut, User, FileDown, Wand2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { calculateStrategyIncomeSummary, StrategyIncomeSummary } from "@/utils/incomeSummary";
import { DEFAULT_VALUES, AppliedDefaults, getDefaultsFootnote } from "@/utils/defaultValues";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { usePlanCache } from "@/hooks/usePlanCache";
import { exportPlanToPDF } from "@/utils/pdfExport";

const Index = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { savePlanToCache, loadPlanFromCache, clearPlanCache } = usePlanCache();
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
  const [hasChosenStrategy, setHasChosenStrategy] = useState(false);
  const [showSliders, setShowSliders] = useState(false);
  const [hasUnappliedIncomeChange, setHasUnappliedIncomeChange] = useState(false);
  const [isFirstOptimization, setIsFirstOptimization] = useState(true);
  const [planName, setPlanName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isAIOptimizing, setIsAIOptimizing] = useState(false);
  const [showAIResult, setShowAIResult] = useState(false);
  const [strategyPreference, setStrategyPreference] = useState<'maximize-income' | 'save-days'>('maximize-income');
  const [aiResult, setAiResult] = useState<{
    optimalParent1Months: number;
    explanation: string;
    tips: string[];
    expectedTotalIncome?: number;
    expectedDaysSaved?: number;
    expectedDaysUsed?: number;
    expectedAverageMonthly?: number;
    expectedHighestMonth?: number;
    expectedLowestMonth?: number;
  } | null>(null);
  const [aiDefaultsFootnote, setAiDefaultsFootnote] = useState<string | null>(null);

  const handleExportPDF = async () => {
    if (!optimizationResults || !hasChosenStrategy) return;

    const selectedStrategy = optimizationResults[selectedStrategyIndex];
    const planToExport = {
      id: 'preview',
      name: planName || 'Min föräldraledighetsplan',
      expected_birth_date: new Date().toISOString(),
      parent1_income: parent1Income,
      parent1_has_agreement: parent1HasAgreement,
      parent2_income: parent2Income,
      parent2_has_agreement: parent2HasAgreement,
      tax_rate: taxRate,
      municipality: municipality,
      total_months: totalMonths,
      parent1_months: parent1Months,
      household_income: householdIncome,
      days_per_week: daysPerWeek,
      simultaneous_leave: simultaneousLeave,
      simultaneous_months: simultaneousMonths,
      selected_strategy_index: selectedStrategyIndex,
      optimization_results: optimizationResults,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    try {
      await exportPlanToPDF(planToExport as any);
      toast.success('PDF exporterad!');
    } catch (error) {
      console.error('Error exporting PDF:', error);
      toast.error('Kunde inte exportera PDF. Försök igen.');
    }
  };

  // Auto-recalculate when collective agreement checkbox changes
  useEffect(() => {
    if (optimizationResults && optimizationResults.length > 0 && !isFirstOptimization) {
      handleOptimize({ silent: true });
    }
  }, [parent1HasAgreement, parent2HasAgreement]);

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

  // Build currentResults for AI comparison when optimization results exist
  const currentResults = useMemo(() => {
    if (!optimizationResults || optimizationResults.length === 0) return null;
    
    const selectedResult = optimizationResults[selectedStrategyIndex];
    if (!selectedResult) return null;

    // Calculate monthly income breakdown from periods to get highest/lowest
    const monthlyIncomes: number[] = [];
    const periods = selectedResult.periods || [];
    const monthlyMap = new Map<string, number>();
    
    periods.forEach(period => {
      const monthKey = period.startDate ? 
        `${period.startDate.getFullYear()}-${period.startDate.getMonth()}` : '';
      if (monthKey && period.monthlyIncome) {
        monthlyMap.set(monthKey, (monthlyMap.get(monthKey) || 0) + period.monthlyIncome);
      }
    });
    
    monthlyMap.forEach(val => monthlyIncomes.push(val));
    
    return {
      totalIncome: selectedResult.totalIncome || 0,
      averageMonthlyIncome: selectedResult.averageMonthlyIncome || 0,
      daysUsed: selectedResult.daysUsed || 0,
      daysSaved: selectedResult.daysSaved || 0,
      parent1Months: parent1Months,
      parent2Months: parent2Months,
      highestMonthIncome: monthlyIncomes.length > 0 ? Math.max(...monthlyIncomes) : undefined,
      lowestMonthIncome: monthlyIncomes.length > 0 ? Math.min(...monthlyIncomes) : undefined,
    };
  }, [optimizationResults, selectedStrategyIndex, parent1Months, parent2Months]);

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
      effectiveSimultaneousLeave ? effectiveSimultaneousMonths : 0,
      isFirstOptimization
    );

    setOptimizationResults(results);
    setIsFirstOptimization(false); // Set to false after first optimization
    if (!silent) {
      toast.success("Optimering klar!");
      
      // Scroll to results
      setTimeout(() => {
        document.getElementById("results")?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    }
  };

  const handleSelectStrategy = (index: number) => {
    setSelectedStrategyIndex(index);
    setHasChosenStrategy(true);
    toast.success('Strategi vald!');
  };

  const handleAIOptimize = async () => {
    setIsAIOptimizing(true);
    
    try {
      // Track which defaults are being used
      const appliedDefaults: AppliedDefaults = {
        parent1Income: parent1Income === 0 || !parent1Income,
        parent2Income: parent2Income === 0 || !parent2Income,
        parent1HasAgreement: false, // Checkboxes have explicit values
        parent2HasAgreement: false,
        taxRate: taxRate === 0 || !taxRate,
        totalMonths: totalMonths === 0 || !totalMonths,
        parent1Months: false, // Will be determined by AI
        simultaneousMonths: false,
        householdIncome: householdIncome === 0 || !householdIncome,
      };

      // Apply defaults where needed
      const effectiveParent1Income = appliedDefaults.parent1Income ? DEFAULT_VALUES.income : parent1Income;
      const effectiveParent2Income = appliedDefaults.parent2Income ? DEFAULT_VALUES.income : parent2Income;
      const effectiveTaxRate = appliedDefaults.taxRate ? DEFAULT_VALUES.taxRate : taxRate;
      const effectiveTotalMonths = appliedDefaults.totalMonths ? DEFAULT_VALUES.totalMonths : totalMonths;
      const effectiveHouseholdIncome = appliedDefaults.householdIncome ? DEFAULT_VALUES.householdIncome : householdIncome;
      const effectiveSimultaneousMonths = simultaneousLeave ? simultaneousMonths : 0;

      const effectiveParent1Data: ParentData = {
        income: effectiveParent1Income,
        hasCollectiveAgreement: parent1HasAgreement,
        taxRate: effectiveTaxRate,
      };

      const effectiveParent2Data: ParentData = {
        income: effectiveParent2Income,
        hasCollectiveAgreement: parent2HasAgreement,
        taxRate: effectiveTaxRate,
      };

      // Calculate results for all possible distributions
      const distributionResults: {
        parent1Months: number;
        parent2Months: number;
        totalIncome: number;
        daysSaved: number;
        meetsMinimum: boolean;
        warningCount: number;
      }[] = [];

      for (let p1Months = 0; p1Months <= effectiveTotalMonths; p1Months++) {
        const p2Months = effectiveTotalMonths - p1Months;
        
        const results = optimizeLeave(
          effectiveParent1Data,
          effectiveParent2Data,
          effectiveTotalMonths,
          p1Months,
          p2Months,
          effectiveHouseholdIncome,
          7, // Use 7 days/week for theoretical max
          effectiveSimultaneousMonths,
          true
        );

        // Get the result for the selected strategy type
        const strategyResult = results.find(r => 
          r.strategy === (selectedStrategyIndex === 0 ? 'maximize-income' : 'save-days')
        ) || results[0];

        const hasWarnings = strategyResult.warnings && strategyResult.warnings.length > 0;
        
        distributionResults.push({
          parent1Months: p1Months,
          parent2Months: p2Months,
          totalIncome: strategyResult.totalIncome || 0,
          daysSaved: strategyResult.daysSaved || 0,
          meetsMinimum: !hasWarnings,
          warningCount: strategyResult.warnings?.length || 0,
        });
      }

      // Call AI edge function
      const response = await supabase.functions.invoke('optimize-parental-leave', {
        body: {
          parent1: effectiveParent1Data,
          parent2: effectiveParent2Data,
          totalMonths: effectiveTotalMonths,
          minHouseholdIncome: effectiveHouseholdIncome,
          strategy: selectedStrategyIndex === 0 ? 'maximize-income' : 'save-days',
          simultaneousMonths: effectiveSimultaneousMonths,
          daysPerWeek,
          distributionResults,
        }
      });

      if (response.error) {
        throw new Error(response.error.message || 'AI-optimering misslyckades');
      }

      const result = response.data;
      
      if (result.error) {
        toast.error(result.error);
        return;
      }

      // Find the expected income and days saved for the recommended distribution
      const recommendedDistribution = distributionResults.find(
        d => d.parent1Months === result.optimalParent1Months
      );

      // Store footnote about defaults
      const footnote = getDefaultsFootnote(appliedDefaults);
      setAiDefaultsFootnote(footnote);

      // Calculate days used and averages from the optimization results
      const daysUsed = recommendedDistribution ? (480 - (recommendedDistribution.daysSaved || 0)) : undefined;
      const avgMonthly = recommendedDistribution && effectiveTotalMonths > 0 
        ? recommendedDistribution.totalIncome / effectiveTotalMonths 
        : undefined;
      
      setAiResult({
        ...result,
        expectedTotalIncome: recommendedDistribution?.totalIncome,
        expectedDaysSaved: recommendedDistribution?.daysSaved,
        expectedDaysUsed: daysUsed,
        expectedAverageMonthly: avgMonthly,
      });
      setShowAIResult(true);
      
      // Scroll to the AI result section
      setTimeout(() => {
        document.getElementById("ai-result-section")?.scrollIntoView({ behavior: "smooth" });
      }, 100);

      // Update state with effective values if defaults were used
      if (appliedDefaults.parent1Income) setParent1Income(DEFAULT_VALUES.income);
      if (appliedDefaults.parent2Income) setParent2Income(DEFAULT_VALUES.income);
      if (appliedDefaults.taxRate) setTaxRate(DEFAULT_VALUES.taxRate);
      if (appliedDefaults.totalMonths) setTotalMonths(DEFAULT_VALUES.totalMonths);
      if (appliedDefaults.householdIncome) setHouseholdIncome(DEFAULT_VALUES.householdIncome);
      
    } catch (error) {
      console.error('AI optimization error:', error);
      toast.error('Kunde inte köra AI-optimering. Försök igen.');
    } finally {
      setIsAIOptimizing(false);
    }
  };

  const handleApplyAIResult = (parent1MonthsValue: number) => {
    setParent1Months(parent1MonthsValue);
    // Preselect the strategy that the AI was optimizing for
    handleStrategyPreferenceSelect(strategyPreference);
    handleOptimize({ silent: false, overrides: { parent1Months: parent1MonthsValue } });
    setShowAIResult(false);
    toast.success('AI-rekommendation tillämpad!');
  };

  const handleDismissAIResult = () => {
    setShowAIResult(false);
    setAiResult(null);
  };

  const handleStrategyPreferenceSelect = (strategy: 'maximize-income' | 'save-days') => {
    setStrategyPreference(strategy);
    
    if (optimizationResults) {
      const targetIndex = optimizationResults.findIndex(result => result.strategy === strategy);
      if (targetIndex >= 0) {
        handleSelectStrategy(targetIndex);
      }
    }
  };

  const handleHouseholdIncomeChange = (value: number) => {
    setHouseholdIncome(value);

    // Mark that there's an unapplied change
    if (optimizationResults) {
      setHasUnappliedIncomeChange(true);
    }
  };

  const handleRecalculate = () => {
    handleOptimize({ silent: true, overrides: { householdIncome } });
    setHasUnappliedIncomeChange(false);
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
    setHasUnappliedIncomeChange(false); // Clear unapplied changes when recalculating

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
    setHasUnappliedIncomeChange(false); // Clear unapplied changes when recalculating
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

  // Calculate current total income and days used for selected strategy
  const currentTotalIncome = useMemo(() => {
    if (!optimizationResults) return 0;
    const selectedStrategy = optimizationResults[selectedStrategyIndex];
    if (!selectedStrategy) return 0;
    return selectedStrategy.totalIncome || 0;
  }, [optimizationResults, selectedStrategyIndex]);

  const currentDaysUsed = useMemo(() => {
    if (!optimizationResults) return 0;
    const selectedStrategy = optimizationResults[selectedStrategyIndex];
    if (!selectedStrategy) return 0;
    return selectedStrategy.daysUsed || 0;
  }, [optimizationResults, selectedStrategyIndex]);

  // Load cached plan on mount
  useEffect(() => {
    const cached = loadPlanFromCache();
    if (cached && !user) {
      setParent1Income(cached.parent1Income);
      setParent2Income(cached.parent2Income);
      setParent1HasAgreement(cached.parent1HasAgreement);
      setParent2HasAgreement(cached.parent2HasAgreement);
      setMunicipality(cached.municipality);
      setTaxRate(cached.taxRate);
      setTotalMonths(cached.totalMonths);
      setParent1Months(cached.parent1Months);
      setHouseholdIncome(cached.householdIncome);
      setSimultaneousLeave(cached.simultaneousLeave);
      setSimultaneousMonths(cached.simultaneousMonths);
      setDaysPerWeek(cached.daysPerWeek);
      setOptimizationResults(cached.optimizationResults);
      setSelectedStrategyIndex(cached.selectedStrategyIndex);
      toast.success("Din plan har återställts!");
    }
  }, [user]);

  // Save to cache whenever relevant state changes
  useEffect(() => {
    if (optimizationResults && !user) {
      savePlanToCache({
        parent1Income,
        parent2Income,
        parent1HasAgreement,
        parent2HasAgreement,
        municipality,
        taxRate,
        totalMonths,
        parent1Months,
        householdIncome,
        simultaneousLeave,
        simultaneousMonths,
        daysPerWeek,
        optimizationResults,
        selectedStrategyIndex,
      });
    }
  }, [
    parent1Income,
    parent2Income,
    parent1HasAgreement,
    parent2HasAgreement,
    municipality,
    taxRate,
    totalMonths,
    parent1Months,
    householdIncome,
    simultaneousLeave,
    simultaneousMonths,
    daysPerWeek,
    optimizationResults,
    selectedStrategyIndex,
    user,
  ]);

  const { signOut } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-gradient-hero text-white py-4 md:py-12 px-2 md:px-4 shadow-soft">
        <div className="container mx-auto max-w-5xl">
          <div className="flex justify-between items-center gap-2 md:gap-4 mb-2 md:mb-4">
            <div className="flex items-center gap-1 md:gap-3 flex-1 min-w-0">
              <Baby className="h-6 md:h-12 w-6 md:w-12 flex-shrink-0" />
              <h1 className="text-base md:text-5xl font-bold truncate">
                Föräldrapenningskalkylator
              </h1>
            </div>
            
            {/* Navigation/Login */}
            <div className="flex-shrink-0 z-10">
              {user ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      className="text-white border border-white/30 rounded-lg hover:bg-white/20 px-3"
                    >
                      <User className="h-6 w-6" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => navigate('/dashboard')}>
                      Mina planer
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={signOut}>
                      <LogOut className="mr-2 h-4 w-4" />
                      Logga ut
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Button 
                  variant="ghost" 
                  size="sm"
                  className="text-white border border-white/30 hover:bg-white/20 whitespace-nowrap"
                  onClick={() => navigate('/auth')}
                >
                  <LogIn className="h-4 w-4 md:mr-2" />
                  <span className="hidden sm:inline text-sm">Logga in</span>
                </Button>
              )}
            </div>
          </div>
          <p className="text-xs md:text-xl opacity-90 text-center">
            Optimera er föräldraledighet för bästa ekonomi
          </p>
        </div>
      </header>

      <main className={`container mx-auto max-w-5xl px-2 md:px-4 py-4 md:py-12 space-y-3 md:space-y-8 ${optimizationResults ? 'pb-[500px] md:pb-[450px]' : 'pb-32'}`}>
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
            parent1ParentalSalaryPerDay={calc1.parentalSalaryPerDay}
            parent2ParentalSalaryPerDay={calc2.parentalSalaryPerDay}
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
          parent1Data={parent1Data}
          parent2Data={parent2Data}
          selectedStrategy={strategyPreference}
          onStrategyPreferenceSelect={handleStrategyPreferenceSelect}
        />

        <div className="flex justify-center gap-3 pt-2 md:pt-6">
          <Button
            onClick={() => handleOptimize()}
            size="lg"
            className="text-xs md:text-lg px-4 md:px-8 py-3 md:py-6 shadow-soft bg-gradient-hero hover:opacity-90 transition-opacity"
          >
            <Sparkles className="mr-1 md:mr-2 h-3 md:h-5 w-3 md:w-5" />
            Optimera
          </Button>
          <Button
            onClick={handleAIOptimize}
            disabled={isAIOptimizing}
            size="lg"
            variant="outline"
            className="text-xs md:text-lg px-4 md:px-8 py-3 md:py-6 shadow-soft border-primary text-primary hover:bg-primary/10"
          >
            <Wand2 className="mr-1 md:mr-2 h-3 md:h-5 w-3 md:w-5" />
            {isAIOptimizing ? 'Analyserar...' : 'AI Optimera'}
          </Button>
        </div>

          {optimizationResults && (
          <div id="results" className="pt-4 md:pt-12">
            <OptimizationResults
              results={optimizationResults}
              minHouseholdIncome={householdIncome}
              selectedIndex={selectedStrategyIndex}
              onSelectStrategy={handleSelectStrategy}
              timelineMonths={totalMonths}
            />
            
            {hasChosenStrategy && (
              <div className="space-y-6 mt-8">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <h2 className="text-2xl font-bold">Plandetaljer</h2>
                  <div className="flex gap-2 w-full sm:w-auto">
                    <Button 
                      variant="outline" 
                      onClick={handleExportPDF}
                      className="flex-1 sm:flex-none"
                    >
                      <FileDown className="mr-2 h-4 w-4" />
                      Exportera PDF
                    </Button>
                  </div>
                </div>
                <StrategyDetails
                  strategy={optimizationResults[selectedStrategyIndex]}
                  minHouseholdIncome={householdIncome}
                  timelineMonths={totalMonths}
                  showSummaryBreakdown
                />
                
                <div className="flex justify-center">
                  {!showSliders ? (
                    <Button
                      onClick={() => setShowSliders(true)}
                      size="lg"
                      className="bg-primary hover:bg-primary/90"
                    >
                      Justera parametrar
                    </Button>
                  ) : (
                    <Button
                      onClick={() => setShowSliders(false)}
                      variant="outline"
                      size="lg"
                    >
                      Dölj justeringar
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {optimizationResults && showSliders && (
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
            hasUnappliedChanges={hasUnappliedIncomeChange}
            selectedStrategy={optimizationResults[selectedStrategyIndex]?.strategy || 'maximize-income'}
            parent1={parent1Data}
            parent2={parent2Data}
            currentTotalIncome={currentTotalIncome}
            currentDaysUsed={currentDaysUsed}
            onHouseholdIncomeChange={handleHouseholdIncomeChange}
            onDaysPerWeekChange={handleDaysPerWeekChange}
            onTotalMonthsChange={handleTotalMonthsChange}
            onRecalculate={handleRecalculate}
            onDistributionChange={handleDistributionChange}
          />
        )}

        {/* AI Optimization Result - Inline Section */}
        {showAIResult && aiResult && (
          <div id="ai-result-section" className="mx-auto max-w-2xl scroll-mt-20">
            <AIOptimizationSection
              result={aiResult}
              totalMonths={totalMonths}
              selectedStrategy={strategyPreference}
              currentResults={currentResults}
              onApply={handleApplyAIResult}
              onDismiss={handleDismissAIResult}
              defaultsFootnote={aiDefaultsFootnote}
            />
          </div>
        )}

        {optimizationResults && selectedStrategyIndex !== null && (
          <Card id="save-plan-section" className="mx-auto max-w-2xl scroll-mt-20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Save className="h-5 w-5" />
                Spara din plan
              </CardTitle>
              <CardDescription>
                {user 
                  ? "Spara din optimerade föräldraledighetsplan för att enkelt återkomma till den senare"
                  : "Skapa ett konto för att spara och hantera dina planer"
                }
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {user ? (
                <>
                  <div>
                    <label className="text-sm font-medium mb-2 block">
                      Namnge din plan
                    </label>
                    <Input
                      type="text"
                      placeholder="T.ex. Vår föräldraledighetsplan 2024"
                      value={planName}
                      onChange={(e) => setPlanName(e.target.value)}
                      className="max-w-md"
                    />
                  </div>
                  <Button
                    onClick={async () => {
                      if (!planName.trim()) {
                        toast.error("Vänligen ange ett namn för planen");
                        return;
                      }

                      setIsSaving(true);
                      try {
                        const { error } = await supabase
                          .from('saved_plans')
                          .insert([{
                            user_id: user.id,
                            name: planName.trim(),
                            expected_birth_date: new Date().toISOString().split('T')[0],
                            parent1_income: parent1Income,
                            parent1_has_agreement: parent1HasAgreement,
                            parent2_income: parent2Income,
                            parent2_has_agreement: parent2HasAgreement,
                            tax_rate: taxRate,
                            municipality: municipality,
                            total_months: totalMonths,
                            parent1_months: parent1Months,
                            household_income: householdIncome,
                            days_per_week: daysPerWeek,
                            simultaneous_leave: simultaneousLeave,
                            simultaneous_months: simultaneousMonths,
                            selected_strategy_index: selectedStrategyIndex,
                            optimization_results: optimizationResults as any,
                          }]);

                        if (error) throw error;

                        clearPlanCache();
                        toast.success("Plan sparad!");
                        setPlanName("");
                        
                        setTimeout(() => {
                          navigate('/dashboard');
                        }, 1000);
                      } catch (error) {
                        console.error('Error saving plan:', error);
                        toast.error("Kunde inte spara planen. Försök igen.");
                      } finally {
                        setIsSaving(false);
                      }
                    }}
                    disabled={isSaving}
                    className="w-full md:w-auto"
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {isSaving ? "Sparar..." : "Spara plan"}
                  </Button>
                </>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    För att spara dina planer och komma åt dem när som helst behöver du ett konto.
                  </p>
                  <Button
                    onClick={() => navigate('/auth')}
                    className="w-full md:w-auto"
                  >
                    <UserPlus className="mr-2 h-4 w-4" />
                    Skapa konto / Logga in
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
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
