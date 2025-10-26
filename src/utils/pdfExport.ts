import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

export interface SavedPlan {
  id: string;
  name: string;
  expected_birth_date: string;
  parent1_income: number;
  parent1_has_agreement: boolean;
  parent2_income: number;
  parent2_has_agreement: boolean;
  municipality: string;
  total_months: number;
  parent1_months: number;
  household_income: number;
  days_per_week: number;
  simultaneous_leave: boolean;
  simultaneous_months: number;
  selected_strategy_index: number;
  optimization_results: any[];
}

export async function exportPlanToPDF(plan: SavedPlan): Promise<void> {
  try {
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    let yPosition = 20;

    // Title
    pdf.setFontSize(24);
    pdf.setFont('helvetica', 'bold');
    pdf.text(plan.name, pageWidth / 2, yPosition, { align: 'center' });
    yPosition += 15;

    // Birth date
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'normal');
    const birthDate = new Date(plan.expected_birth_date).toLocaleDateString('sv-SE');
    pdf.text(`Förväntat födelsedatum: ${birthDate}`, pageWidth / 2, yPosition, { align: 'center' });
    yPosition += 15;

    // Parent info section
    pdf.setFontSize(16);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Föräldrarnas information', 20, yPosition);
    yPosition += 10;

    pdf.setFontSize(11);
    pdf.setFont('helvetica', 'normal');
    pdf.text(`Förälder 1 - Inkomst: ${plan.parent1_income.toLocaleString('sv-SE')} kr/mån`, 20, yPosition);
    yPosition += 6;
    pdf.text(`Förälder 1 - Kollektivavtal: ${plan.parent1_has_agreement ? 'Ja' : 'Nej'}`, 20, yPosition);
    yPosition += 8;
    pdf.text(`Förälder 2 - Inkomst: ${plan.parent2_income.toLocaleString('sv-SE')} kr/mån`, 20, yPosition);
    yPosition += 6;
    pdf.text(`Förälder 2 - Kollektivavtal: ${plan.parent2_has_agreement ? 'Ja' : 'Nej'}`, 20, yPosition);
    yPosition += 12;

    // Settings section
    pdf.setFontSize(16);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Inställningar', 20, yPosition);
    yPosition += 10;

    pdf.setFontSize(11);
    pdf.setFont('helvetica', 'normal');
    pdf.text(`Kommun: ${plan.municipality}`, 20, yPosition);
    yPosition += 6;
    pdf.text(`Total ledighet: ${plan.total_months} månader`, 20, yPosition);
    yPosition += 6;
    pdf.text(`Förälder 1: ${plan.parent1_months} månader, Förälder 2: ${plan.total_months - plan.parent1_months} månader`, 20, yPosition);
    yPosition += 6;
    pdf.text(`Hushållsinkomst: ${plan.household_income.toLocaleString('sv-SE')} kr/mån`, 20, yPosition);
    yPosition += 6;
    pdf.text(`Uttag per vecka: ${plan.days_per_week} dagar`, 20, yPosition);
    yPosition += 12;

    // Selected strategy
    const selectedStrategy = plan.optimization_results[plan.selected_strategy_index];
    pdf.setFontSize(16);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Vald strategi', 20, yPosition);
    yPosition += 10;

    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'bold');
    const strategyTitle = selectedStrategy?.meta?.title || selectedStrategy?.title || 'Okänd strategi';
    pdf.text(strategyTitle, 20, yPosition);
    yPosition += 8;

    pdf.setFontSize(11);
    pdf.setFont('helvetica', 'normal');
    const strategyDesc = selectedStrategy?.meta?.description || selectedStrategy?.description || '';
    const descLines = pdf.splitTextToSize(strategyDesc, pageWidth - 40);
    pdf.text(descLines, 20, yPosition);
    yPosition += descLines.length * 6 + 6;

    // Summary
    pdf.text(`Total inkomst: ${Math.round(selectedStrategy.totalIncome || 0).toLocaleString('sv-SE')} kr`, 20, yPosition);
    yPosition += 6;
    pdf.text(`Dagar använda: ${selectedStrategy.daysUsed || 0} dagar`, 20, yPosition);
    yPosition += 6;
    pdf.text(`Dagar sparade: ${480 - (selectedStrategy.daysUsed || 0)} dagar`, 20, yPosition);
    yPosition += 12;

    // Check if we need a new page
    if (yPosition > pageHeight - 40) {
      pdf.addPage();
      yPosition = 20;
    }

    // Leave periods
    pdf.setFontSize(16);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Ledighetsperioder', 20, yPosition);
    yPosition += 10;

    const periods = selectedStrategy.periods || [];
    pdf.setFontSize(11);
    pdf.setFont('helvetica', 'normal');

    periods.forEach((period: any, index: number) => {
      if (yPosition > pageHeight - 30) {
        pdf.addPage();
        yPosition = 20;
      }

      const parentLabel = period.parent === 'parent1' ? 'Förälder 1' : 'Förälder 2';
      pdf.setFont('helvetica', 'bold');
      pdf.text(`${index + 1}. ${parentLabel}`, 20, yPosition);
      yPosition += 6;

      pdf.setFont('helvetica', 'normal');
      pdf.text(`Period: ${period.calendarDays || period.months * 30} kalenderdagar`, 25, yPosition);
      yPosition += 6;
      pdf.text(`Månadsinkomst: ${Math.round(period.monthlyIncome || 0).toLocaleString('sv-SE')} kr`, 25, yPosition);
      yPosition += 6;
      pdf.text(`Förmånsdagar använda: ${period.benefitDaysUsed || 0} dagar`, 25, yPosition);
      yPosition += 6;
      
      const benefitLevel = period.benefitLevel === 'high' ? 'Vanliga dagar' : 'Lägstanivådagar';
      pdf.text(`Nivå: ${benefitLevel}`, 25, yPosition);
      yPosition += 10;
    });

    // Footer
    const now = new Date().toLocaleDateString('sv-SE', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'italic');
    pdf.text(`Skapad: ${now}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
    pdf.text('Föräldraledighetsplaneraren', pageWidth / 2, pageHeight - 5, { align: 'center' });

    // Save the PDF
    pdf.save(`${plan.name}.pdf`);
  } catch (error) {
    console.error('Error exporting PDF:', error);
    throw error;
  }
}
