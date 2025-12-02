import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import { PlanCard } from '@/components/PlanCard';
import { Button } from '@/components/ui/button';
import { Plus, FileText, Edit, FileDown, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StrategyDetails } from '@/components/StrategyDetails';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { OptimizationResult } from '@/utils/parentalCalculations';
import { exportPlanToPDF } from '@/utils/pdfExport';
import { format } from 'date-fns';
import { sv } from 'date-fns/locale';

export default function Dashboard() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlanIds, setSelectedPlanIds] = useState<Set<string>>(new Set());
  const [previewPlan, setPreviewPlan] = useState<any | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    if (user) {
      loadPlans();
    }
  }, [user, location.pathname]);

  const loadPlans = async () => {
    if (!user) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('saved_plans')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_deleted', false)
        .order('updated_at', { ascending: false });

      if (error) throw error;
      setPlans(data || []);
      setSelectedPlanIds(new Set()); // Clear selection when reloading
    } catch (error) {
      console.error('Error loading plans:', error);
      toast.error('Kunde inte ladda dina planer. Försök igen.');
    } finally {
      setLoading(false);
    }
  };

  const togglePlanSelection = (planId: string) => {
    setSelectedPlanIds(prev => {
      const next = new Set(prev);
      if (next.has(planId)) {
        next.delete(planId);
      } else {
        next.add(planId);
      }
      return next;
    });
  };

  const selectAllPlans = () => {
    setSelectedPlanIds(new Set(plans.map(p => p.id)));
  };

  const deselectAllPlans = () => {
    setSelectedPlanIds(new Set());
  };

  const handleBulkDelete = async () => {
    if (!user || selectedPlanIds.size === 0) return;

    try {
      for (const planId of selectedPlanIds) {
        const { error } = await supabase.rpc('soft_delete_plan', { plan_id: planId });
        if (error) throw error;
      }

      toast.success(`${selectedPlanIds.size} planer raderade!`);
      await loadPlans();
    } catch (error) {
      console.error('Error deleting plans:', error);
      toast.error('Kunde inte radera planerna. Försök igen.');
    }
  };

  const handleOpenPreview = (plan: any) => {
    setPreviewPlan(plan);
    setPreviewOpen(true);
  };

  const handleExportPDF = async () => {
    if (!previewPlan) return;

    try {
      await exportPlanToPDF(previewPlan);
      toast.success('PDF exporterad!');
    } catch (error) {
      console.error('Error exporting PDF:', error);
      toast.error('Kunde inte exportera PDF. Försök igen.');
    }
  };

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

  const previewStrategy = previewPlan ? rehydrateOptimizationResults(previewPlan.optimization_results)[previewPlan.selected_strategy_index] : null;

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold mb-2">Mina planer</h1>
            <p className="text-muted-foreground">
              Hantera och redigera dina föräldraledighetsplaner
            </p>
          </div>
          <Link to="/">
            <Button size="lg">
              <Plus className="mr-2 h-5 w-5" />
              Skapa ny plan
            </Button>
          </Link>
        </div>

        {plans.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-2xl font-semibold mb-2">Inga planer ännu</h2>
            <p className="text-muted-foreground mb-6">
              Skapa din första föräldraledighetsplan för att komma igång
            </p>
            <Link to="/">
              <Button size="lg">
                <Plus className="mr-2 h-5 w-5" />
                Skapa din första plan
              </Button>
            </Link>
          </div>
        ) : (
          <>
            {selectedPlanIds.size > 0 && (
              <div className="flex items-center justify-between bg-muted/50 p-4 rounded-lg mb-4">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">
                    {selectedPlanIds.size} plan{selectedPlanIds.size > 1 ? 'er' : ''} markerad{selectedPlanIds.size > 1 ? 'e' : ''}
                  </span>
                  <Button variant="ghost" size="sm" onClick={deselectAllPlans}>
                    Avmarkera alla
                  </Button>
                </div>
              </div>
            )}
            
            <div className="flex justify-end mb-4">
              <Button
                variant="outline"
                size="sm"
                onClick={selectedPlanIds.size === plans.length ? deselectAllPlans : selectAllPlans}
              >
                {selectedPlanIds.size === plans.length ? 'Avmarkera alla' : 'Markera alla'}
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {plans.map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  isSelected={selectedPlanIds.has(plan.id)}
                  onToggleSelect={() => togglePlanSelection(plan.id)}
                  onDelete={selectedPlanIds.size > 0 ? handleBulkDelete : loadPlans}
                  selectedCount={selectedPlanIds.size}
                  onOpenPreview={() => handleOpenPreview(plan)}
                />
              ))}
            </div>
          </>
        )}

        {/* Preview Dialog */}
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <DialogTitle className="text-2xl mb-2">{previewPlan?.name}</DialogTitle>
                  <p className="text-sm text-muted-foreground">
                    Förväntat födelsedatum: {previewPlan && format(new Date(previewPlan.expected_birth_date), 'd MMM yyyy', { locale: sv })}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportPDF}
                  >
                    <FileDown className="h-4 w-4 mr-2" />
                    Exportera PDF
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setPreviewOpen(false);
                      navigate(`/plan/${previewPlan?.id}`);
                    }}
                  >
                    <Edit className="h-4 w-4 mr-2" />
                    Redigera
                  </Button>
                </div>
              </div>
            </DialogHeader>
            
            {previewStrategy && (
              <div className="mt-4">
                <StrategyDetails
                  strategy={previewStrategy}
                  minHouseholdIncome={previewPlan.household_income}
                  timelineMonths={previewPlan.total_months}
                  showSummaryBreakdown
                />
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
