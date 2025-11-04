import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import { PlanCard } from '@/components/PlanCard';
import { Button } from '@/components/ui/button';
import { Plus, FileText } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export default function Dashboard() {
  const { user } = useAuth();
  const location = useLocation();
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

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
    } catch (error) {
      console.error('Error loading plans:', error);
      toast.error('Kunde inte ladda dina planer. Försök igen.');
    } finally {
      setLoading(false);
    }
  };

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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {plans.map((plan) => (
              <PlanCard key={plan.id} plan={plan} onDelete={loadPlans} />
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
