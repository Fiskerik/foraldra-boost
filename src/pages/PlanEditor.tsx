import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { ParentIncomeCard } from '@/components/ParentIncomeCard';
import { MunicipalitySelect } from '@/components/MunicipalitySelect';
import { AvailableIncomeDisplay } from '@/components/AvailableIncomeDisplay';
import { StrategyDetails } from '@/components/StrategyDetails';
import { LeavePeriodCard } from '@/components/LeavePeriodCard';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Save, FileDown, Calendar, RefreshCw, ArrowLeft } from 'lucide-react';
import { format } from 'date-fns';
import { sv } from 'date-fns/locale';
import {
  ParentData,
  calculateAvailableIncome,
  optimizeLeave,
  OptimizationResult,
  calculateMaxLeaveMonths,
} from '@/utils/parentalCalculations';
import { exportPlanToPDF } from '@/utils/pdfExport';

interface SavedPlan {
  id: string;
  user_id: string;
  name: string;
  expected_birth_date: string;
  parent1_income: number;
  parent1_has_agreement: boolean;
  parent2_income: number;
  parent2_has_agreement: boolean;
  tax_rate: number;
  municipality: string;
  total_months: number;
  parent1_months: number;
  household_income: number;
  days_per_week: number;
  simultaneous_leave: boolean;
  simultaneous_months: number;
  selected_strategy_index: number;
  optimization_results: any;
  created_at: string;
  updated_at: string;
}

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
    if (id && user?.id) {
      loadPlan();
    } else if (id && !user?.id) {
      setLoading(false);
      toast.error('Du måste vara inloggad för att se denna plan.');
      navigate('/auth');
    }
  }, [id, user?.id]);

  // Rehydrate optimization results: convert date strings to Date objects
  const rehydrateOptimizationResults = (raw: any[]): OptimizationResult[] => {
    return raw.map((res) => ({
      ...res,
      periods: res.periods.map((p: any) => ({
        ...p,
        startDate: new Date(p.startDate),
        endDate: new Date(p.endDate),
        dailyIncome: Number(p.dailyIncome ?? 0),
        dailyBenefit: Number(p.dailyBenefit ?? 0),
        otherParentMonthlyIncome: Number(p.otherParentMonthlyIncome ?? 0),
        otherParentDailyIncome: Number(p.otherParentDailyIncome ?? 0),
        benefitDaysUsed: Number(p.benefitDaysUsed ?? p.daysCount ?? 0),
        daysCount: Number(p.daysCount ?? 0),
        daysPerWeek: p.daysPerWeek != null ? Number(p.daysPerWeek) : undefined,
      })),
    }));
  };

  const loadPlan = async () => {
    if (!id || !user?.id) {
      console.log('Missing id or user', { id, userId: user?.id });
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      console.log('Loading plan:', id);
      const { data, error } = await supabase
        .from('saved_plans')
        .select('*')
        .eq('id', id)
        .eq('user_id', user.id)
        .maybeSingle();

      console.log('Plan data received:', data);
      console.log('Error:', error);

      if (error) throw error;
      if (!data) {
        toast.error('Planen kunde inte hittas eller så har du inte åtkomst till den.');
        navigate('/dashboard');
        return;
      }

      // Verify optimization_results exists and is valid
      if (!data.optimization_results || !Array.isArray(data.optimization_results)) {
        console.error('Invalid optimization_results:', data.optimization_results);
        toast.error('Planen innehåller ogiltig data.');
        navigate('/dashboard');
        return;
      }

      // Rehydrate dates and numeric fields
      const rehydrated = rehydrateOptimizationResults(data.optimization_results);
      console.log('Rehydrated optimization results:', rehydrated);

      // Verify selectedStrategyIndex is valid
      const validIndex = Math.max(0, Math.min(
        data.selected_strategy_index ?? 0,
        rehydrated.length - 1
      ));

      console.log('Setting plan data with validIndex:', validIndex);

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
      setSelectedStrategyIndex(validIndex);
      setOptimizationResults(rehydrated);
    } catch (error) {
      console.error('Error loading plan:', error);
      toast.error('Kunde inte ladda planen. Försök igen.');
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
          optimization_results: optimizationResults as any,
        })
        .eq('id', id);

      if (error) throw error;

      toast.success('Plan uppdaterad!');
      
      // Reload plan to get updated timestamp
      await loadPlan();
    } catch (error) {
      console.error('Error saving plan:', error);
      toast.error('Kunde inte spara planen. Försök igen.');
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
      toast.success('PDF exporterad!');
    } catch (error) {
      console.error('Error exporting PDF:', error);
      toast.error('Kunde inte exportera PDF. Försök igen.');
    }
  };

  const handleRecalculate = () => {
    const results = optimizeLeave(
      parent1Data,
      parent2Data,
      totalMonths,
      parent1Months,
      parent2Months,
      householdIncome,
      daysPerWeek,
      simultaneousLeave ? simultaneousMonths : 0,
      false
    );
    setOptimizationResults(results);
    setHasUnappliedIncomeChange(false);
    toast.success("Plan omoptimerad!");
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

  const selectedStrategy = optimizationResults?.[selectedStrategyIndex];

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

  if (!optimizationResults || optimizationResults.length === 0) {
    return (
      <AppLayout>
        <div className="text-center py-12">
          <h2 className="text-2xl font-semibold mb-2">Ingen optimeringsdata</h2>
          <p className="text-muted-foreground mb-6">Planen saknar optimeringsresultat.</p>
          <Button onClick={() => navigate('/dashboard')}>Tillbaka till dashboard</Button>
        </div>
      </AppLayout>
    );
  }

  if (!selectedStrategy) {
    return (
      <AppLayout>
        <div className="text-center py-12">
          <h2 className="text-2xl font-semibold mb-2">Ogiltig strategi</h2>
          <p className="text-muted-foreground mb-6">Den valda strategin kunde inte hittas.</p>
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
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => navigate('/dashboard')}
                >
                  <ArrowLeft className="h-4 w-4 mr-1" />
                  Tillbaka
                </Button>
              </div>
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
              <Button onClick={handleExportPDF} variant="outline" size="sm">
                <FileDown className="mr-2 h-4 w-4" />
                Exportera PDF
              </Button>
              <Button onClick={handleSavePlan} disabled={saving} size="sm">
                <Save className="mr-2 h-4 w-4" />
                {saving ? 'Sparar...' : 'Spara'}
              </Button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
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
        </div>

        <div className="mb-6">
          <MunicipalitySelect
            parentNumber={0}
            selectedMunicipality={municipality}
            onMunicipalityChange={(name, rate) => {
              setMunicipality(name);
              setTaxRate(rate);
            }}
          />
        </div>

        {municipality && (
          <AvailableIncomeDisplay
            parent1NetIncome={calc1.netIncome}
            parent2NetIncome={calc2.netIncome}
            parent1AvailableIncome={calc1.availableIncome}
            parent2AvailableIncome={calc2.availableIncome}
          />
        )}

        {selectedStrategy && (
          <StrategyDetails 
            strategy={selectedStrategy}
            minHouseholdIncome={householdIncome}
            timelineMonths={totalMonths}
          />
        )}

        <div className="mt-6 space-y-6">
          <h3 className="text-xl font-semibold">Justera din plan</h3>
          
          <LeavePeriodCard
            totalMonths={totalMonths}
            parent1Months={parent1Months}
            parent2Months={parent2Months}
            minHouseholdIncome={householdIncome}
            maxHouseholdIncome={calc1.netIncome + calc2.netIncome}
            maxLeaveMonths={maxLeaveMonths}
            onTotalMonthsChange={setTotalMonths}
            onDistributionChange={handleDistributionChange}
            onMinIncomeChange={setHouseholdIncome}
            simultaneousLeave={simultaneousLeave}
            simultaneousMonths={simultaneousMonths}
            onSimultaneousLeaveChange={setSimultaneousLeave}
            onSimultaneousMonthsChange={setSimultaneousMonths}
          />

          <Button 
            onClick={handleRecalculate} 
            size="lg"
            className="w-full"
          >
            <RefreshCw className="mr-2 h-5 w-5" />
            Omoptimera plan
          </Button>
        </div>
      </div>
    </AppLayout>
  );
}
