// Default values used when user leaves fields blank
export const DEFAULT_VALUES = {
  income: 35000,
  hasCollectiveAgreement: true,
  taxRate: 30,
  totalMonths: 15,
  parent1Months: 12,
  parent2Months: 3,
  simultaneousMonths: 0,
  householdIncome: 35000,
  daysPerWeek: 5,
};

export interface AppliedDefaults {
  parent1Income: boolean;
  parent2Income: boolean;
  parent1HasAgreement: boolean;
  parent2HasAgreement: boolean;
  taxRate: boolean;
  totalMonths: boolean;
  parent1Months: boolean;
  simultaneousMonths: boolean;
  householdIncome: boolean;
}

export function getDefaultsFootnote(appliedDefaults: AppliedDefaults): string | null {
  const usedDefaults: string[] = [];
  
  if (appliedDefaults.parent1Income) usedDefaults.push('Förälder 1 lön');
  if (appliedDefaults.parent2Income) usedDefaults.push('Förälder 2 lön');
  if (appliedDefaults.parent1HasAgreement) usedDefaults.push('Förälder 1 kollektivavtal');
  if (appliedDefaults.parent2HasAgreement) usedDefaults.push('Förälder 2 kollektivavtal');
  if (appliedDefaults.taxRate) usedDefaults.push('Skattesats');
  if (appliedDefaults.totalMonths) usedDefaults.push('Antal månader');
  if (appliedDefaults.householdIncome) usedDefaults.push('Minimum hushållsinkomst');
  
  if (usedDefaults.length === 0) return null;
  
  return `AI har använt standardvärden för: ${usedDefaults.join(', ')}. För mer exakta resultat, fyll i dina egna uppgifter.`;
}
