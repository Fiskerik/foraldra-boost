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

async function captureElement(elementId: string): Promise<string | null> {
  const element = document.getElementById(elementId);
  if (!element) return null;
  
  try {
    const canvas = await html2canvas(element, {
      scale: 2,
      backgroundColor: '#ffffff',
      logging: false,
    });
    return canvas.toDataURL('image/png');
  } catch (error) {
    console.error(`Failed to capture element ${elementId}:`, error);
    return null;
  }
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

    // Selected strategy - Enhanced with highlighting
    const selectedStrategy = plan.optimization_results[plan.selected_strategy_index];
    pdf.setFillColor(240, 240, 255);
    pdf.roundedRect(15, yPosition - 5, pageWidth - 30, 50, 3, 3, 'F');
    
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

    // Summary boxes
    pdf.setFont('helvetica', 'bold');
    pdf.text(`Total inkomst: ${Math.round(selectedStrategy.totalIncome || 0).toLocaleString('sv-SE')} kr`, 20, yPosition);
    yPosition += 6;
    pdf.text(`Dagar använda: ${selectedStrategy.daysUsed || 0} dagar`, 20, yPosition);
    yPosition += 6;
    pdf.text(`Dagar sparade: ${480 - (selectedStrategy.daysUsed || 0)} dagar`, 20, yPosition);
    yPosition += 15;

    // Try to capture distribution graph
    const distributionGraph = await captureElement('income-distribution-graph');
    if (distributionGraph) {
      if (yPosition > pageHeight - 80) {
        pdf.addPage();
        yPosition = 20;
      }
      
      pdf.setFontSize(16);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Fördelningsanalys', 20, yPosition);
      yPosition += 10;
      
      const graphWidth = pageWidth - 40;
      const graphHeight = 60;
      pdf.addImage(distributionGraph, 'PNG', 20, yPosition, graphWidth, graphHeight);
      yPosition += graphHeight + 15;
    }

    // Check if we need a new page
    if (yPosition > pageHeight - 40) {
      pdf.addPage();
      yPosition = 20;
    }

    // Monthly breakdown with formatted table
    pdf.setFontSize(16);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Månadsvis uppdelning', 20, yPosition);
    yPosition += 10;

    const periods = selectedStrategy.periods || [];
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'bold');
    
    // Table headers
    const colX = [20, 60, 100, 140];
    pdf.text('Förälder', colX[0], yPosition);
    pdf.text('Period', colX[1], yPosition);
    pdf.text('Inkomst/mån', colX[2], yPosition);
    pdf.text('Dagar', colX[3], yPosition);
    yPosition += 7;
    
    pdf.setLineWidth(0.5);
    pdf.line(20, yPosition - 2, pageWidth - 20, yPosition - 2);
    yPosition += 2;

    pdf.setFont('helvetica', 'normal');
    periods.forEach((period: any, index: number) => {
      if (yPosition > pageHeight - 30) {
        pdf.addPage();
        yPosition = 20;
      }

      const parentLabel = period.parent === 'parent1' ? 'Förälder 1' : 'Förälder 2';
      const periodDays = period.calendarDays || Math.round(period.months * 30);
      const income = Math.round(period.monthlyIncome || 0).toLocaleString('sv-SE');
      const days = period.benefitDaysUsed || 0;
      
      pdf.text(parentLabel, colX[0], yPosition);
      pdf.text(`${periodDays} dagar`, colX[1], yPosition);
      pdf.text(`${income} kr`, colX[2], yPosition);
      pdf.text(`${days} förmånsd.`, colX[3], yPosition);
      yPosition += 6;
    });
    
    yPosition += 10;

    // Try to capture timeline chart
    const timelineChart = await captureElement('timeline-chart');
    if (timelineChart) {
      if (yPosition > pageHeight - 100) {
        pdf.addPage();
        yPosition = 20;
      }
      
      pdf.setFontSize(16);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Inkomst över tid', 20, yPosition);
      yPosition += 10;
      
      const chartWidth = pageWidth - 40;
      const chartHeight = 80;
      pdf.addImage(timelineChart, 'PNG', 20, yPosition, chartWidth, chartHeight);
      yPosition += chartHeight + 10;
    }

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
