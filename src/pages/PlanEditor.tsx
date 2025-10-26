import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { ParentIncomeCard } from '@/components/ParentIncomeCard';
import { MunicipalitySelect } from '@/components/MunicipalitySelect';
import { AvailableIncomeDisplay } from '@/components/AvailableIncomeDisplay';
import { OptimizationResults } from '@/components/OptimizationResults';
import { InteractiveSliders } from '@/components/InteractiveSliders';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { Save, FileDown, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { sv } from 'date-fns/locale';
import {
  ParentData,
  calculateAvailableIncome,
  optimizeLeave,
  OptimizationResult,
  calculateMaxLeaveMonths,
} from '@/utils/parentalCalculations';
import { calculateStrategyIncomeSummary } from '@/utils/incomeSummary';
import { exportPlanToPDF, SavedPlan } from '@/utils/pdfExport';

export default function PlanEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [plan, setPlan] = useState<SavedPlan | null>(null);

  // State from original Index
  const [parent1Income, setParent1Income] = useState(30000);
  const [parent2Income, setParent2Income] = useState(55000);
  const [parent1HasAgreement, setParent1HasAgreement] = useState(true);
  const [parent2HasAgreement, setParent2HasAgreement] = useState(false);
  const [municipality, setMunicipality] = useState('Vallentuna');
  const [taxRate, setTaxRate] = useState(30.2);
  const [totalMonths, setTotalMonths] = useState(15);
  const [parent1Months, setParent1Months] = useState(10);
  const [householdIncome, setHouseholdIncome] = useState(45000);
  const [simultaneousLeave, setSimultaneousLeave] = useState(false);
  const [simultaneousMonths, setSimultaneousMonths] = useState(0);
  const [daysPerWeek, setDaysPerWeek] = useState(5);
  const [optimizationResults, setOptimizationResults] = useState<OptimizationResult[] | null>(null);
  const [selectedStrategyIndex, setSelectedStrategyIndex] = useState(0);
  const [hasUnappliedIncomeChange, setHasUnappliedIncomeChange] = useState(false);

  useEffect(() => {
    if (id && user) {
      loadPlan();
    }
  }, [id, user]);

  const loadPlan = async () => {
    if (!id) return;

    try {
      const { data, error } = await supabase
        .from('saved_plans')
        .select('*')
        .eq('id', id)
        .eq('user_id', user?.id)
        .single();

      if (error) throw error;
      if (!data) {
        toast({
          title: 'Plan hittades inte',
          description: 'Planen kunde inte hittas eller så har du inte åtkomst till den.',
          variant: 'destructive',
        });
        navigate('/dashboard');
        return;
      }

      setPlan(data as SavedPlan);
      
      // Populate state from loaded plan
      setParent1Income(data.parent1_income);
      setParent2Income(data.parent2_income);
      setParent1HasAgreement(data.parent1_has_agreement);
      setParent2HasAgreement(data.parent2_has_agreement);
      setMunicipality(data.municipality);
      setTaxRate(data.tax_rate);
      setTotalMonths(data.total_months);
      setParent1Months(data.parent1_months);
      setHouseholdIncome(data.household_income);
      setDaysPerWeek(data.days_per_week);
      setSimultaneousLeave(data.simultaneous_leave);
      setSimultaneousMonths(data.simultaneous_months);
      setSelectedStrategyIndex(data.selected_strategy_index);
      setOptimizationResults(data.optimization_results);
    } catch (error) {
      console.error('Error loading plan:', error);
      toast({
        title: 'Fel',
        description: 'Kunde inte ladda planen. Försök igen.',
        variant: 'destructive',
      });
      navigate('/dashboard');
    } finally {
      setLoading(false);
    }
  };

  const handleSavePlan = async () => {
    if (!id || !user || !optimizationResults) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('saved_plans')
        .update({
          parent1_income: parent1Income,
          parent1_has_agreement: parent1HasAgreement,
          parent2_income: parent2Income,
          parent2_has_agreement: parent2HasAgreement,
          municipality,
          tax_rate: taxRate,
          total_months: totalMonths,
          parent1_months: parent1Months,
          household_income: householdIncome,
          days_per_week: daysPerWeek,
          simultaneous_leave: simultaneousLeave,
          simultaneous_months: simultaneousMonths,
          selected_strategy_index: selectedStrategyIndex,
          optimization_results: optimizationResults,
        })
        .eq('id', id);

      if (error) throw error;

      toast({
        title: 'Plan uppdaterad!',
        description: 'Dina ändringar har sparats.',
      });
      
      // Reload plan to get updated timestamp
      await loadPlan();
    } catch (error) {
      console.error('Error saving plan:', error);
      toast({
        title: 'Fel',
        description: 'Kunde inte spara planen. Försök igen.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleExportPDF = async () => {
    if (!plan || !optimizationResults) return;

    try {
      await exportPlanToPDF({
        ...plan,
        optimization_results: optimizationResults,
      });
      toast({
        title: 'PDF exporterad!',
        description: 'Din plan har laddats ner som PDF.',
      });
    } catch (error) {
      console.error('Error exporting PDF:', error);
      toast({
        title: 'Fel',
        description: 'Kunde inte exportera PDF. Försök igen.',
        variant: 'destructive',
      });
    }
  };

  const handleRecalculate = () => {
    const results = optimizeLeave(
      parent1Data,
      parent2Data,
      householdIncome,
      parent1Months,
      parent2Months,
      daysPerWeek,
      simultaneousLeave,
      simultaneousMonths,
      false
    );
    setOptimizationResults(results);
    setHasUnappliedIncomeChange(false);
  };

  const handleDistributionChange = (newParent1Months: number) => {
    const newParent2Months = totalMonths - newParent1Months;
    setParent1Months(newParent1Months);
    setTimeout(() => {
      handleRecalculate();
    }, 100);
  };

  const parent2Months = Math.max(totalMonths - parent1Months, 0);
  const maxHouseholdIncome = parent1Income + parent2Income;

  const parent1Data: ParentData = {
    monthlyIncome: parent1Income,
    hasAgreement: parent1HasAgreement,
    isWorkingFull: true,
  };

  const parent2Data: ParentData = {
    monthlyIncome: parent2Income,
    hasAgreement: parent2HasAgreement,
    isWorkingFull: true,
  };

  const parent1AvailableIncome = calculateAvailableIncome(parent1Data, taxRate / 100);
  const parent2AvailableIncome = calculateAvailableIncome(parent2Data, taxRate / 100);

  const strategyIncomeSummaries = useMemo(() => {
    if (!optimizationResults) return [];
    return optimizationResults.map((result) =>
      calculateStrategyIncomeSummary(result, parent1AvailableIncome, parent2AvailableIncome, taxRate / 100)
    );
  }, [optimizationResults, parent1AvailableIncome, parent2AvailableIncome, taxRate]);

  const selectedIncomeSummary = strategyIncomeSummaries[selectedStrategyIndex];

  const currentTotalIncome = useMemo(() => {
    const selectedStrategy = optimizationResults?.[selectedStrategyIndex];
    if (!selectedStrategy) return 0;
    return selectedStrategy.totalIncome || 0;
  }, [optimizationResults, selectedStrategyIndex]);

  const currentDaysUsed = useMemo(() => {
    const selectedStrategy = optimizationResults?.[selectedStrategyIndex];
    if (!selectedStrategy) return 0;
    return selectedStrategy.daysUsed || 0;
  }, [optimizationResults, selectedStrategyIndex]);

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </AppLayout>
    );
  }

  if (!plan) {
    return (
      <AppLayout>
        <div className="text-center py-12">
          <h2 className="text-2xl font-semibold mb-2">Plan hittades inte</h2>
          <p className="text-muted-foreground mb-6">Planen kunde inte laddas.</p>
          <Button onClick={() => navigate('/dashboard')}>Tillbaka till dashboard</Button>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h1 className="text-3xl font-bold mb-2">{plan.name}</h1>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="h-4 w-4" />
                <span>
                  Förväntat födelsedatum:{' '}
                  {format(new Date(plan.expected_birth_date), 'PPP', { locale: sv })}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Senast uppdaterad: {format(new Date(plan.updated_at), 'PPP', { locale: sv })}
              </p>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleExportPDF} variant="outline">
                <FileDown className="mr-2 h-4 w-4" />
                Exportera PDF
              </Button>
              <Button onClick={handleSavePlan} disabled={saving}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? 'Sparar...' : 'Spara ändringar'}
              </Button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <ParentIncomeCard
            title="Förälder 1"
            income={parent1Income}
            hasAgreement={parent1HasAgreement}
            onIncomeChange={setParent1Income}
            onAgreementChange={setParent1HasAgreement}
          />
          <ParentIncomeCard
            title="Förälder 2"
            income={parent2Income}
            hasAgreement={parent2HasAgreement}
            onIncomeChange={setParent2Income}
            onAgreementChange={setParent2HasAgreement}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <MunicipalitySelect
            value={municipality}
            onChange={(value, rate) => {
              setMunicipality(value);
              setTaxRate(rate);
            }}
          />
          <AvailableIncomeDisplay
            parent1Income={parent1AvailableIncome}
            parent2Income={parent2AvailableIncome}
            taxRate={taxRate}
          />
        </div>

        {optimizationResults && (
          <>
            <OptimizationResults
              results={optimizationResults}
              minHouseholdIncome={householdIncome}
              selectedIndex={selectedStrategyIndex}
              onSelectStrategy={setSelectedStrategyIndex}
            />

            {selectedIncomeSummary && (
              <InteractiveSliders
                periods={selectedIncomeSummary.periods}
                strategyIncomeSummary={selectedIncomeSummary}
                householdIncome={householdIncome}
                daysPerWeek={daysPerWeek}
                totalMonths={totalMonths}
                onHouseholdIncomeChange={setHouseholdIncome}
                onTotalMonthsChange={setTotalMonths}
                onDaysPerWeekChange={setDaysPerWeek}
                hasUnappliedChanges={hasUnappliedIncomeChange}
                onRecalculate={handleRecalculate}
                parent1={parent1Data}
                parent2={parent2Data}
                selectedStrategy={(optimizationResults[selectedStrategyIndex]?.strategy || 'maximize-income') as any}
                currentTotalIncome={currentTotalIncome}
                currentDaysUsed={currentDaysUsed}
                onDistributionChange={handleDistributionChange}
              />
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
