import { OptimizationResult } from "@/utils/parentalCalculations";

export interface CachedPlanData {
  parent1Income: number;
  parent2Income: number;
  parent1HasAgreement: boolean;
  parent2HasAgreement: boolean;
  municipality: string;
  taxRate: number;
  totalMonths: number;
  parent1Months: number;
  householdIncome: number;
  simultaneousLeave: boolean;
  simultaneousMonths: number;
  daysPerWeek: number;
  optimizationResults: OptimizationResult[] | null;
  selectedStrategyIndex: number;
}

const CACHE_KEY = 'parental-plan-cache';

export const usePlanCache = () => {
  const savePlanToCache = (planData: CachedPlanData) => {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(planData));
    } catch (error) {
      console.error('Error saving to cache:', error);
    }
  };
  
  const loadPlanFromCache = (): CachedPlanData | null => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      console.error('Error loading from cache:', error);
      return null;
    }
  };
  
  const clearPlanCache = () => {
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch (error) {
      console.error('Error clearing cache:', error);
    }
  };
  
  return { savePlanToCache, loadPlanFromCache, clearPlanCache };
};
