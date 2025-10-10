/**
 * chart.js - Chart rendering for the Föräldrapenningkalkylator
 * Renders an interactive Gantt chart showing parental leave schedules and income.
 */
import {
    beräknaMånadsinkomst,
    beräknaNetto,
    optimizeParentalLeave
} from './calculations.js';

const WEEKS_PER_MONTH = 4.3;
const EPSILON = 1e-6;

const toFiniteNumber = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
};

const toNonNegative = (value) => Math.max(0, toFiniteNumber(value));

const roundToOneDecimal = (value) => Math.round(value * 10) / 10;

const weeksToMonths = (weeks) => toFiniteNumber(weeks) / WEEKS_PER_MONTH;

const computeWeightedAverage = (phases = []) => {
    const normalized = phases.map(phase => ({
        weeks: toNonNegative(phase?.weeks),
        income: toFiniteNumber(phase?.income)
    }));
    const totalWeeks = normalized.reduce((sum, phase) => sum + phase.weeks, 0);
    if (totalWeeks <= EPSILON) {
        return { value: 0, totalWeeks: 0 };
    }
    const weightedIncome = normalized.reduce(
        (sum, phase) => sum + (phase.weeks * phase.income),
        0
    );
    return {
        value: weightedIncome / totalWeeks,
        totalWeeks
    };
};

const createStrategySummary = (result, preferences, includePartner) => {
    if (!result) {
        return null;
    }

    const minIncome = toNonNegative(
        preferences?.minInkomst ?? result.genomförbarhet?.minInkomst
    );
    const partnerWorkIncome = includePartner ? toFiniteNumber(result.arbetsInkomst2) : 0;
    const parent1WorkIncome = toFiniteNumber(result.arbetsInkomst1);

    const parent1Phases = [
        {
            weeks: result.plan1?.weeks,
            income: toFiniteNumber(result.plan1?.inkomst) + partnerWorkIncome
        },
        {
            weeks: result.plan1NoExtra?.weeks,
            income: toFiniteNumber(result.plan1NoExtra?.inkomst) + partnerWorkIncome
        },
        {
            weeks: result.plan1MinDagar?.weeks,
            income: toFiniteNumber(result.plan1MinDagar?.inkomst) + partnerWorkIncome
        }
    ];

    const parent2Phases = includePartner
        ? [
            {
                weeks: result.plan2?.weeks,
                income: toFiniteNumber(result.plan2?.inkomst) + parent1WorkIncome
            },
            {
                weeks: result.plan2NoExtra?.weeks,
                income: toFiniteNumber(result.plan2NoExtra?.inkomst) + parent1WorkIncome
            },
            {
                weeks: result.plan2MinDagar?.weeks,
                income: toFiniteNumber(result.plan2MinDagar?.inkomst) + parent1WorkIncome
            }
        ]
        : [];

    const parent1Weeks = parent1Phases.reduce((sum, phase) => sum + phase.weeks, 0);
    const parent2Weeks = parent2Phases.reduce((sum, phase) => sum + phase.weeks, 0);

    const parent1Months = Math.round(weeksToMonths(parent1Weeks));
    const parent2Months = Math.round(weeksToMonths(parent2Weeks));

    const period1Average = computeWeightedAverage(parent1Phases);
    const period2Average = computeWeightedAverage(parent2Phases);
    const combinedAverage = computeWeightedAverage([...parent1Phases, ...parent2Phases]);

    const usedIncomeDays1 = Math.round(toNonNegative(result.användaInkomstDagar1));
    const usedIncomeDays2 = Math.round(toNonNegative(result.användaInkomstDagar2));
    const usedMinDays1 = Math.round(toNonNegative(result.användaMinDagar1));
    const usedMinDays2 = Math.round(toNonNegative(result.användaMinDagar2));

    const remainingIncomeDays1 = Math.round(toNonNegative(result.förälder1InkomstDagar));
    const remainingIncomeDays2 = Math.round(toNonNegative(result.förälder2InkomstDagar));
    const remainingMinDays1 = Math.round(toNonNegative(result.förälder1MinDagar));
    const remainingMinDays2 = Math.round(toNonNegative(result.förälder2MinDagar));

    const totalRemainingDays = remainingIncomeDays1 + remainingMinDays1 +
        (includePartner ? remainingIncomeDays2 + remainingMinDays2 : 0);

    const computePhaseIncomeTotal = phases => phases.reduce((sum, phase) => {
        const weeks = toNonNegative(phase.weeks);
        if (weeks <= 0) {
            return sum;
        }
        const income = toFiniteNumber(phase.income);
        return sum + ((weeks / WEEKS_PER_MONTH) * income);
    }, 0);

    const computeOverlapIncomeTotal = () => {
        const overlapWeeks = toNonNegative(result.plan1Overlap?.weeks);
        if (overlapWeeks <= 0) {
            return 0;
        }
        const daysPerWeek = toNonNegative(result.plan1Overlap?.dagarPerVecka) || 5;
        const parent1OverlapIncome = toFiniteNumber(result.plan1Overlap?.inkomst);
        let parent2OverlapIncome = 0;
        if (includePartner) {
            parent2OverlapIncome = beräknaMånadsinkomst(
                toFiniteNumber(result.dag2),
                daysPerWeek,
                toFiniteNumber(result.extra2),
                toFiniteNumber(result.barnbidragPerPerson),
                toFiniteNumber(result.tilläggPerPerson)
            );
        }
        const combined = parent1OverlapIncome + parent2OverlapIncome;
        if (combined <= 0) {
            return 0;
        }
        return (overlapWeeks / WEEKS_PER_MONTH) * combined;
    };

    const totalIncome = Math.round(
        computePhaseIncomeTotal(parent1Phases) +
        computePhaseIncomeTotal(parent2Phases) +
        computeOverlapIncomeTotal()
    );

    return {
        minIncome,
        parent1Months,
        parent2Months,
        period1Income: Math.round(period1Average.value),
        period2Income: Math.round(period2Average.value),
        usedDays: {
            parent1: { income: usedIncomeDays1, min: usedMinDays1 },
            parent2: { income: usedIncomeDays2, min: usedMinDays2 }
        },
        remainingDays: {
            parent1: { income: remainingIncomeDays1, min: remainingMinDays1 },
            parent2: { income: remainingIncomeDays2, min: remainingMinDays2 }
        },
        totalRemainingDays,
        weightedAverageIncome: combinedAverage.value,
        totalIncome,
        parent1Weeks,
        parent2Weeks,
        period1Weeks: period1Average.totalWeeks,
        period2Weeks: period2Average.totalWeeks
    };
};

const formatCurrencyValue = (value, suffix = 'kr/månad') => {
    const numeric = Math.round(toFiniteNumber(value));
    return `${numeric.toLocaleString('sv-SE')} ${suffix}`;
};

const formatMonthsValue = (value) => {
    const numeric = Math.round(toFiniteNumber(value));
    return `${numeric.toLocaleString('sv-SE')} månader`;
};

const formatDayDifference = (diff, { includeParens = true, unit = 'dagar', neutralText = 'oförändrat' } = {}) => {
    if (!Number.isFinite(diff)) {
        return null;
    }
    const rounded = Math.round(diff);
    if (rounded === 0) {
        const text = includeParens ? `(${neutralText})` : neutralText;
        return { text, className: 'neutral' };
    }
    const sign = rounded > 0 ? '+' : '−';
    const suffix = unit ? ` ${unit}` : '';
    const body = `${sign}${Math.abs(rounded).toLocaleString('sv-SE')}${suffix}`;
    return {
        text: includeParens ? `(${body})` : body,
        className: rounded > 0 ? 'positive' : 'negative'
    };
};

const formatDifference = (diff, { unit, fractionDigits = 0, epsilon = 0.05 } = {}) => {
    if (!Number.isFinite(diff)) {
        return { text: '', className: '' };
    }
    if (Math.abs(diff) <= epsilon) {
        return { text: ' (oförändrat)', className: 'neutral' };
    }
    const sign = diff > 0 ? '+' : '-';
    const formattedNumber = Math.abs(diff).toLocaleString('sv-SE', {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits
    });
    return {
        text: ` (${sign}${formattedNumber} ${unit})`,
        className: diff > 0 ? 'positive' : 'negative'
    };
};

/**
 * Render the Gantt chart
 * @param {Object} plan1 - Plan for Parent 1
 * @param {Object} plan2 - Plan for Parent 2
 * @param {Object} plan1NoExtra - Plan 1 without extra
 * @param {Object} plan2NoExtra - Plan 1 without extra
 * @param {Object} plan1MinDagar - Plan 1 minimum days
 * @param {Object} plan2MinDagar - Plan 2 minimum days
 * @param {Object} plan1Overlap - Overlap plan
 * @param {number} inkomst1 - Income for Parent 1
 * @param {number} inkomst2 - Income for Parent 2
 * @param {string} vårdnad - Custody type
 * @param {string} beräknaPartner - Calculate for partner
 * @param {Object} genomförbarhet - Feasibility data
 * @param {number} dag1 - Daily rate for Parent 1
 * @param {number} extra1 - Extra for Parent 1
 * @param {number} dag2 - Daily rate for Parent 2
 * @param {number} extra2 - Extra for Parent 2
 * @param {number} förälder1InkomstDagar - Income days for Parent 1
 * @param {number} förälder2InkomstDagar - Income days for Parent 2
 * @param {number} förälder1MinDagar - Minimum days for Parent 1
 * @param {number} förälder2MinDagar - Minimum days for Parent 2
 * @param {string} barnDatum - Child's birth date
 * @param {number} arbetsInkomst1 - Work income for Parent 1
 * @param {number} arbetsInkomst2 - Work income for Parent 2
 * @param {number} barnbidragPerPerson - Child allowance per parent (ignored)
 * @param {number} tilläggPerPerson - Additional allowance per parent (ignored)
 * @param {number} maxFöräldralönWeeks1 - Allowed weeks with parental salary for Parent 1
 * @param {number} maxFöräldralönWeeks2 - Allowed weeks with parental salary for Parent 2
 * @param {number} unusedFöräldralönWeeks1 - Unused parental salary weeks for Parent 1
 * @param {number} unusedFöräldralönWeeks2 - Unused parental salary weeks for Parent 2
 */
export function renderGanttChart(
    plan1,
    plan2,
    plan1NoExtra,
    plan2NoExtra,
    plan1MinDagar,
    plan2MinDagar,
    plan1Overlap,
    inkomst1,
    inkomst2,
    vårdnad,
    beräknaPartner,
    genomförbarhet,
    dag1,
    extra1,
    dag2,
    extra2,
    förälder1InkomstDagar,
    förälder2InkomstDagar,
    förälder1MinDagar,
    förälder2MinDagar,
    barnDatum,
    arbetsInkomst1,
    arbetsInkomst2,
    barnbidragPerPerson: _barnbidragPerPerson = 0,
    tilläggPerPerson: _tilläggPerPerson = 0,
    maxFöräldralönWeeks1,
    maxFöräldralönWeeks2,
    unusedFöräldralönWeeks1,
    unusedFöräldralönWeeks2,
    användaInkomstDagar1 = 0,
    användaMinDagar1 = 0,
    användaInkomstDagar2 = 0,
    användaMinDagar2 = 0,
    optimizationContext = null
) {
    const barnbidragPerPerson = 0;
    const tilläggPerPerson = 0;
    void _barnbidragPerPerson;
    void _tilläggPerPerson;
    const ganttChart = document.getElementById('gantt-chart');
    if (!ganttChart) {
        console.error("renderGanttChart - gantt-chart element hittades inte");
        return;
    }

    ganttChart.innerHTML = '';
    const messageDiv = document.createElement('div');
    const canvas = document.createElement('canvas');
    canvas.id = 'gantt-canvas';
    canvas.style.width = '100%';
    canvas.style.maxWidth = '1200px';
    canvas.style.height = '400px';

    // Create summary box
    const summaryBox = document.createElement('div');
    summaryBox.id = 'summary-box';
    summaryBox.style.marginTop = '15px';
    summaryBox.style.padding = '10px';
    summaryBox.style.border = '1px solid #ccc';
    summaryBox.style.borderRadius = '5px';
    summaryBox.style.fontFamily = 'Inter, sans-serif';
    summaryBox.style.backgroundColor = '#f9f9f9';
    summaryBox.style.height = 'auto';
    summaryBox.style.maxHeight = 'none';
    summaryBox.style.overflowY = 'visible';
    summaryBox.style.position = 'relative';
    summaryBox.style.paddingBottom = '40px';
    summaryBox.innerHTML = '<p>Välj en punkt för att se detaljer.</p>';

    const isMobileView = typeof window !== 'undefined'
        ? window.matchMedia('(max-width: 720px)').matches
        : false;

    const basePointRadius = isMobileView ? 6 : 4;
    const activePointRadius = isMobileView ? 8 : 6;
    const hoverPointRadius = isMobileView ? 10 : 8;

    const minIncomeRequirement = Number(genomförbarhet?.minInkomst) || 0;
    const highlightColors = {
        warning: 'rgba(255, 223, 94, 0.25)',
        error: 'rgba(255, 128, 128, 0.28)'
    };
    const pointFillColors = {
        warning: '#ffe58f',
        error: '#ff9c9c'
    };

    let usedPeriodColors = new Set();
    let usedSeverityLevels = new Set();

    const baseLegendDefinitions = [
        { color: '#800080', text: 'Överlappande Ledighet' },
        { color: '#39d98a', text: 'Förälder 1 Ledig' },
        { color: '#f28c38', text: 'Förälder 1 Ledig (Överförda dagar)' },
        { color: '#007bff', text: 'Förälder 2 Ledig' },
        { color: 'red', text: 'Efter Ledighet' }
    ];

    const buildLegendEntries = () => {
        const entries = baseLegendDefinitions
            .filter(definition => usedPeriodColors.has(definition.color))
            .map(definition => ({
                text: definition.text,
                fillStyle: definition.color,
                strokeStyle: definition.color,
                hidden: false
            }));

        if (minIncomeRequirement) {
            if (usedSeverityLevels.has('warning')) {
                entries.push({
                    text: 'Inkomst under krav (< 10%)',
                    fillStyle: pointFillColors.warning,
                    strokeStyle: pointFillColors.warning,
                    hidden: false
                });
            }
            if (usedSeverityLevels.has('error')) {
                entries.push({
                    text: 'Inkomst under krav (> 10%)',
                    fillStyle: pointFillColors.error,
                    strokeStyle: pointFillColors.error,
                    hidden: false
                });
            }
            entries.push({
                text: 'Lägsta hushållsinkomst',
                fillStyle: 'rgba(220, 0, 0, 0.8)',
                strokeStyle: 'rgba(220, 0, 0, 0.8)',
                lineWidth: 2,
                hidden: false
            });
        }

        return entries;
    };

    const getIncomeSeverity = income => {
        if (!minIncomeRequirement || typeof income !== 'number') {
            return null;
        }
        if (income >= minIncomeRequirement) {
            return null;
        }
        const ratio = (minIncomeRequirement - income) / minIncomeRequirement;
        return ratio > 0.10 ? 'error' : 'warning';
    };

    const getIncomeHighlightClass = income => {
        const severity = getIncomeSeverity(income);
        if (severity === 'error') {
            return 'income-flag income-error';
        }
        if (severity === 'warning') {
            return 'income-flag income-warning';
        }
        return 'income-flag';
    };

    const formatCombinedIncome = (label, income) => {
        const className = getIncomeHighlightClass(income);
        return `<strong class="${className}">${label} ${income.toLocaleString('sv-SE')} kr/månad</strong>`;
    };

    const formatUsedDaysLine = (label, incomeDays, minDays) => {
        const safeIncomeDays = Math.max(0, Math.round(Number(incomeDays) || 0));
        const safeMinDays = Math.max(0, Math.round(Number(minDays) || 0));
        return `${label}: ${safeIncomeDays.toLocaleString()} dagar (sjukpenningnivå), ${safeMinDays.toLocaleString()} dagar (lägstanivå)`;
    };

    const period1ExtraWeeks = plan1.weeks || 0;
    const period1NoExtraWeeks = plan1NoExtra.weeks || 0;
    const period1MinWeeks = plan1MinDagar.weeks || 0;
    const period2ExtraWeeks = plan2.weeks || 0;
    const period2NoExtraWeeks = plan2NoExtra.weeks || 0;
    const period2MinWeeks = plan2MinDagar.weeks || 0;
    const period1OverlapWeeks = plan1Overlap.weeks || 0;
    const overlapDaysPerWeek = plan1Overlap.dagarPerVecka || 5;

    const baseWeeks1 = period1ExtraWeeks + period1NoExtraWeeks;
    const transferredDays = genomförbarhet.transferredDays || 0;
    const transferredWeeks = transferredDays > 0 && plan1.dagarPerVecka > 0 ? Math.ceil(transferredDays / plan1.dagarPerVecka) : 0;
    const transferredStartWeek = transferredWeeks > 0 ? Math.max(0, baseWeeks1 - transferredWeeks) : baseWeeks1;

    let startDate = barnDatum ? new Date(barnDatum) : new Date();
    if (isNaN(startDate.getTime())) {
        console.warn("Invalid barnDatum provided, using current date:", barnDatum);
        startDate = new Date();
    }
    startDate.setHours(0, 0, 0, 0);

    const period1Start = new Date(startDate);
    let period1TotalWeeks = baseWeeks1 + period1MinWeeks;
    const addDays = (date, days) => {
        const result = new Date(date);
        result.setDate(result.getDate() + days);
        return result;
    };
    const period1End = new Date(period1Start);
    period1End.setDate(period1End.getDate() + (period1TotalWeeks * 7) - 1);

    const dadLeaveStart = new Date(startDate);
    const dadLeaveDurationDays = 10;
    const dadLeaveEnd = new Date(dadLeaveStart);
    dadLeaveEnd.setDate(dadLeaveEnd.getDate() + dadLeaveDurationDays - 1);
    const dadLeaveDurationWeeks = Math.ceil(dadLeaveDurationDays / 7);

    const period2Start = new Date(period1End);
    period2Start.setDate(period2Start.getDate() + 1);
    const period2TotalWeeks = period2ExtraWeeks + period2NoExtraWeeks + period2MinWeeks;
    const period2End = new Date(period2Start);
    period2End.setDate(period2End.getDate() + (period2TotalWeeks * 7) - 1);

    const totalaWeeks = Math.max(period1TotalWeeks + period2TotalWeeks, 60);

    const weekLabels = [];
    const monthLabels = new Array(totalaWeeks).fill('');
    const date = new Date(startDate);
    const weekStartDates = [];

    for (let i = 0; i < totalaWeeks; i++) {
        const weekStart = new Date(date);
        weekStart.setHours(0, 0, 0, 0);
        const weekEnd = new Date(date);
        weekEnd.setDate(weekEnd.getDate() + 6);
        weekEnd.setHours(23, 59, 59, 999);
        const weekLabel = `${weekStart.toLocaleString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' })} - ${weekEnd.toLocaleString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' })}`;
        weekLabels.push(weekLabel);
        weekStartDates.push(weekStart);
        date.setDate(date.getDate() + 7);
    }

    let currentMonth = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    currentMonth.setHours(0, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + totalaWeeks * 7 + 7);
    endDate.setHours(0, 0, 0, 0);

    while (currentMonth <= endDate) {
        const monthLabel = currentMonth.toLocaleString('sv-SE', { month: 'long', year: 'numeric' });
        const monthFirst = new Date(currentMonth);
        monthFirst.setHours(0, 0, 0, 0);
        let closestWeekIndex = 0;
        for (let i = 0; i < weekStartDates.length; i++) {
            const weekStart = weekStartDates[i];
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekEnd.getDate() + 6);
            if (monthFirst >= weekStart && monthFirst <= weekEnd) {
                closestWeekIndex = i;
                break;
            }
            if (monthFirst > weekEnd && weekEnd >= weekStartDates[closestWeekIndex]) {
                closestWeekIndex = i;
            }
        }
        if (!monthLabels[closestWeekIndex]) {
            monthLabels[closestWeekIndex] = monthLabel;
        }
        currentMonth.setMonth(currentMonth.getMonth() + 1);
    }

    const criticalWeeks = [13, 17, 21, 35, 39, 43, 47];
    for (const week of criticalWeeks) {
        if (monthLabels[week] && !monthLabels.slice(0, week).includes(monthLabels[week])) {
            for (let i = week - 1; i >= 0; i--) {
                if (!monthLabels[i]) {
                    monthLabels[i] = monthLabels[week];
                    monthLabels[week] = '';
                    break;
                }
            }
        }
    }

    const safeDagarPerVecka = (value) => (value > 0 ? value : 1);
    const resolveDaysPerWeek = (...values) => {
        for (const value of values) {
            const numeric = Number(value);
            if (Number.isFinite(numeric) && numeric > 0) {
                return numeric;
            }
        }
        return 0;
    };
    const formatDaysPerWeekLabel = value => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric <= 0) {
            return '0';
        }
        if (Number.isInteger(numeric)) {
            return `${numeric}`;
        }
        const fixed = numeric.toFixed(1);
        return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
    };
    const normalizeDaysPerWeek = (value, enforceMinimum = false) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric <= 0) {
            return enforceMinimum ? safeDagarPerVecka(0) : 0;
        }
        return enforceMinimum ? safeDagarPerVecka(numeric) : numeric;
    };

    const calculateLeaveComponents = (dailyRate, dagarPerVecka, extraBelopp, { includeBenefits = true, enforceMinimum = false } = {}) => {
        const daysPerWeek = normalizeDaysPerWeek(dagarPerVecka, enforceMinimum);
        const fpGross = Math.round((dailyRate * daysPerWeek * 4.3) / 100) * 100;
        const extraGross = extraBelopp ? Math.round(extraBelopp * (daysPerWeek / 7)) : 0;
        return {
            fp: beräknaNetto(fpGross),
            extra: beräknaNetto(extraGross),
            barnbidrag: 0,
            tillägg: 0,
            lön: 0
        };
    };

    const calculateWorkComponents = (arbetsInkomst, { includeBenefits = true } = {}) => {
        const netSalary = Math.max(0, arbetsInkomst || 0);
        return {
            fp: 0,
            extra: 0,
            barnbidrag: 0,
            tillägg: 0,
            lön: netSalary
        };
    };

    const createBaseComponents = () => ({
        fp: 0,
        extra: 0,
        barnbidrag: 0,
        tillägg: 0,
        lön: 0
    });

    const includePartner = vårdnad === 'gemensam' && beräknaPartner === 'ja';
    const incomeLabelText = includePartner ? 'Kombinerad inkomst:' : 'Inkomst:';

    const plan1ExtraDaysPerWeek = resolveDaysPerWeek(plan1.dagarPerVecka);
    const plan1NoExtraDaysPerWeek = resolveDaysPerWeek(plan1NoExtra.dagarPerVecka, plan1.dagarPerVecka);
    const plan1MinDaysPerWeek = resolveDaysPerWeek(plan1MinDagar.dagarPerVecka, plan1NoExtra.dagarPerVecka, plan1.dagarPerVecka);
    const period1Förälder1Inkomst = plan1.inkomst || 0;
    const period1NoExtraFörälder1Inkomst = plan1NoExtra.inkomst || 0;
    const period1MinFörälder1Inkomst = beräknaMånadsinkomst(
        180,
        safeDagarPerVecka(plan1MinDaysPerWeek),
        0,
        barnbidragPerPerson,
        tilläggPerPerson
    );
    const period1OverlapFörälder1Inkomst = plan1Overlap.inkomst || 0;
    const period1Förälder2Inkomst = arbetsInkomst2 || 0;

    const plan2ExtraDaysPerWeek = resolveDaysPerWeek(plan2.dagarPerVecka);
    const plan2NoExtraDaysPerWeek = resolveDaysPerWeek(plan2NoExtra.dagarPerVecka, plan2.dagarPerVecka);
    const plan2MinDaysPerWeek = resolveDaysPerWeek(plan2MinDagar.dagarPerVecka, plan2NoExtra.dagarPerVecka, plan2.dagarPerVecka);
    const period2Förälder1Inkomst = arbetsInkomst1 || 0;
    const period2Förälder2Inkomst = plan2.inkomst || 0;
    const period2NoExtraFörälder2Inkomst = plan2NoExtra.inkomst || 0;
    const period2MinFörälder2Inkomst = beräknaMånadsinkomst(
        180,
        safeDagarPerVecka(plan2MinDaysPerWeek),
        0,
        barnbidragPerPerson,
        tilläggPerPerson
    );

    const period1KombExtra = period1Förälder1Inkomst + period1Förälder2Inkomst;
    const period1KombNoExtra = period1NoExtraFörälder1Inkomst + period1Förälder2Inkomst;
    const period1KombMin = period1MinFörälder1Inkomst + period1Förälder2Inkomst;
    const period2KombExtra = period2Förälder1Inkomst + period2Förälder2Inkomst;
    const period2KombNoExtra = period2Förälder1Inkomst + period2NoExtraFörälder2Inkomst;
    const period2KombMin = period2Förälder1Inkomst + period2MinFörälder2Inkomst;

    const dadLeaveFörälder2Inkomst = dag2 > 0 ?
        beräknaMånadsinkomst(dag2, 5, extra2, barnbidragPerPerson, tilläggPerPerson) : 0;
    const dadLeaveFörälder1Inkomst = plan1Overlap.inkomst || period1Förälder1Inkomst;

    const totalMonthsSelected = toFiniteNumber(optimizationContext?.totalMonths);
    const shouldAggregatePoints = isMobileView || (
        Number.isFinite(totalMonthsSelected) && totalMonthsSelected > 15
    );

    let inkomstData = [];
    let draggablePoints = [];
    let pointDisplayData = [];
    let displayDraggables = [];
    let highlightRanges = [];
    let selectedPointIndex = null;

    const computeHighlightRanges = () => {
        highlightRanges = [];
        if (!minIncomeRequirement) {
            return;
        }
        let currentRange = null;
        inkomstData.forEach((point, index) => {
            const severity = getIncomeSeverity(point.y);
            if (severity) {
                if (!currentRange || currentRange.severity !== severity) {
                    if (currentRange) {
                        currentRange.end = index;
                        highlightRanges.push(currentRange);
                    }
                    currentRange = { start: index, end: index, severity };
                } else {
                    currentRange.end = index;
                }
            } else if (currentRange) {
                currentRange.end = index;
                highlightRanges.push(currentRange);
                currentRange = null;
            }
        });
        if (currentRange) {
            highlightRanges.push(currentRange);
        }
    };

    const getPeriodColor = x => {
        if (beräknaPartner === "ja" && x >= 0 && x < dadLeaveDurationWeeks) return '#800080';
        if (x < period1TotalWeeks) {
            if (transferredWeeks > 0 && x >= transferredStartWeek) return '#f28c38';
            return '#39d98a';
        }
        if (x < period1TotalWeeks + period2TotalWeeks) return '#007bff';
        return 'red';
    };

    const getPointBorderColors = () => pointDisplayData.map((data, index) => {
        if (selectedPointIndex === index) {
            return '#000000';
        }
        const referenceWeek = Number.isFinite(data?.startWeekIndex) ? data.startWeekIndex : data.x;
        return getPeriodColor(referenceWeek);
    });

    const getPointBackgroundColors = () => pointDisplayData.map(data => {
        const severity = getIncomeSeverity(data.y);
        if (severity && pointFillColors[severity]) {
            return pointFillColors[severity];
        }
        const referenceWeek = Number.isFinite(data?.startWeekIndex) ? data.startWeekIndex : data.x;
        return getPeriodColor(referenceWeek);
    });

    const getPointBorderWidths = () => pointDisplayData.map((_, index) => (
        selectedPointIndex === index ? 3 : 1
    ));

    const normalizeSelectedPointIndex = () => {
        if (selectedPointIndex == null) {
            return;
        }
        if (!pointDisplayData.length) {
            selectedPointIndex = null;
            return;
        }
        if (selectedPointIndex < 0) {
            selectedPointIndex = 0;
            return;
        }
        const maxIndex = pointDisplayData.length - 1;
        if (selectedPointIndex > maxIndex) {
            selectedPointIndex = maxIndex;
        }
    };

    function generateInkomstData() {
        inkomstData = [];
        let förälder2DaysUsed = 0;

        for (let week = 0; week < totalaWeeks; week++) {
            let kombineradInkomst = 0;
            let förälder1Inkomst = 0;
            let förälder2Inkomst = 0;
            let periodLabel = '';
            let förälder1Components = createBaseComponents();
            let förälder2Components = createBaseComponents();

            if (beräknaPartner === "ja" && week < dadLeaveDurationWeeks && vårdnad === "gemensam") {
                förälder1Inkomst = dadLeaveFörälder1Inkomst;
                förälder2Inkomst = dadLeaveFörälder2Inkomst;
                periodLabel = '10-dagar vid barns födelse';
                förälder1Components = calculateLeaveComponents(dag1, overlapDaysPerWeek, extra1);
                förälder2Components = calculateLeaveComponents(dag2, 5, extra2, { includeBenefits: includePartner });
            } else if (week < period1ExtraWeeks) {
                förälder1Inkomst = period1Förälder1Inkomst;
                förälder2Inkomst = vårdnad === "ensam" ? 0 : (arbetsInkomst2 || 0);
                periodLabel = week >= transferredStartWeek && transferredWeeks > 0 ? 'Förälder 1 Ledig (Överförda dagar)' : 'Förälder 1 Ledig';
                förälder1Components = calculateLeaveComponents(dag1, plan1ExtraDaysPerWeek, extra1);
                förälder2Components = vårdnad === "ensam" ? createBaseComponents() : calculateWorkComponents(arbetsInkomst2, { includeBenefits: includePartner });
            } else if (week < period1ExtraWeeks + period1NoExtraWeeks) {
                förälder1Inkomst = period1NoExtraFörälder1Inkomst;
                förälder2Inkomst = vårdnad === "ensam" ? 0 : (arbetsInkomst2 || 0);
                periodLabel = 'Förälder 1 Ledig (utan föräldralön)';
                förälder1Components = calculateLeaveComponents(dag1, plan1NoExtraDaysPerWeek, 0);
                förälder2Components = vårdnad === "ensam" ? createBaseComponents() : calculateWorkComponents(arbetsInkomst2, { includeBenefits: includePartner });
            } else if (week < period1TotalWeeks) {
                förälder1Inkomst = period1MinFörälder1Inkomst;
                förälder2Inkomst = vårdnad === "ensam" ? 0 : (arbetsInkomst2 || 0);
                periodLabel = 'Förälder 1 Ledig (lägstanivå)';
                förälder1Components = calculateLeaveComponents(180, plan1MinDaysPerWeek, 0, { enforceMinimum: true });
                förälder2Components = vårdnad === "ensam" ? createBaseComponents() : calculateWorkComponents(arbetsInkomst2, { includeBenefits: includePartner });
            } else if (
                week < period1TotalWeeks + period2ExtraWeeks &&
                vårdnad === "gemensam" &&
                beräknaPartner === "ja"
            ) {
                förälder1Inkomst = arbetsInkomst1 || 0;
                förälder2Inkomst = period2Förälder2Inkomst;
                periodLabel = 'Förälder 2 Ledig';
                förälder1Components = calculateWorkComponents(arbetsInkomst1);
                förälder2Components = calculateLeaveComponents(dag2, plan2ExtraDaysPerWeek, extra2, { includeBenefits: includePartner });
                förälder2DaysUsed += safeDagarPerVecka(plan2ExtraDaysPerWeek);
            } else if (
                week < period1TotalWeeks + period2ExtraWeeks + period2NoExtraWeeks &&
                vårdnad === "gemensam" &&
                beräknaPartner === "ja"
            ) {
                förälder1Inkomst = arbetsInkomst1 || 0;
                förälder2Inkomst = period2NoExtraFörälder2Inkomst;
                periodLabel = 'Förälder 2 Ledig (utan föräldralön)';
                förälder1Components = calculateWorkComponents(arbetsInkomst1);
                förälder2Components = calculateLeaveComponents(dag2, plan2NoExtraDaysPerWeek, 0, { includeBenefits: includePartner });
                förälder2DaysUsed += safeDagarPerVecka(plan2NoExtraDaysPerWeek);
            } else if (
                week < period1TotalWeeks + period2TotalWeeks &&
                vårdnad === "gemensam" &&
                beräknaPartner === "ja"
            ) {
                förälder1Inkomst = arbetsInkomst1 || 0;
                förälder2Inkomst = period2MinFörälder2Inkomst;
                periodLabel = 'Förälder 2 Ledig (lägstanivå)';
                förälder1Components = calculateWorkComponents(arbetsInkomst1);
                förälder2Components = calculateLeaveComponents(180, plan2MinDaysPerWeek, 0, {
                    includeBenefits: includePartner,
                    enforceMinimum: true
                });
                förälder2DaysUsed += safeDagarPerVecka(plan2MinDaysPerWeek);
            } else {
                förälder1Inkomst = arbetsInkomst1 || 0;
                förälder2Inkomst = vårdnad === "ensam" ? 0 : (arbetsInkomst2 || 0);
                periodLabel = 'Efter Ledighet';
                förälder1Components = calculateWorkComponents(arbetsInkomst1);
                förälder2Components = vårdnad === "ensam"
                    ? createBaseComponents()
                    : calculateWorkComponents(arbetsInkomst2, { includeBenefits: includePartner });
            }

            kombineradInkomst = förälder1Inkomst + förälder2Inkomst;
            inkomstData.push({
                x: week,
                y: kombineradInkomst, 
                förälder1Inkomst, 
                förälder2Inkomst, 
                periodLabel,
                förälder1Components,
                förälder2Components
            });

            if (week === Math.round(period1TotalWeeks) - 1) {
                draggablePoints.push({ index: week, type: 'period1End' });
            }
            if (week === period1TotalWeeks) {
                draggablePoints.push({ index: week, type: 'period2Start' });
            }
        }

        computeHighlightRanges();
    }

    const cloneComponents = (components) => {
        if (!components || typeof components !== 'object') {
            return {
                fp: 0,
                extra: 0,
                barnbidrag: 0,
                tillägg: 0,
                lön: 0
            };
        }
        return {
            fp: toFiniteNumber(components.fp),
            extra: toFiniteNumber(components.extra),
            barnbidrag: toFiniteNumber(components.barnbidrag),
            tillägg: toFiniteNumber(components.tillägg),
            lön: toFiniteNumber(components.lön)
        };
    };

    const formatDate = (date) => {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
            console.warn('Invalid date in formatDate, returning fallback:', date);
            return new Date().toISOString().split('T')[0];
        }
        return date.toISOString().split('T')[0];
    };

    const formatRangeLabel = (startIndex, endIndex) => {
        const safeStartIndex = Number.isFinite(startIndex) ? Math.max(0, Math.floor(startIndex)) : null;
        const safeEndIndex = Number.isFinite(endIndex) ? Math.max(0, Math.floor(endIndex)) : safeStartIndex;
        if (safeStartIndex == null || !weekStartDates[safeStartIndex]) {
            return weekLabels[safeStartIndex ?? 0] || 'Okänd vecka';
        }
        const boundedEndIndex = Math.min(
            safeEndIndex != null ? safeEndIndex : safeStartIndex,
            weekStartDates.length - 1
        );
        const startDate = weekStartDates[safeStartIndex];
        const endDateSource = weekStartDates[boundedEndIndex];
        if (!startDate || !endDateSource) {
            return weekLabels[safeStartIndex] || 'Okänd vecka';
        }
        const endDate = addDays(endDateSource, 6);
        if (safeStartIndex === boundedEndIndex) {
            return weekLabels[safeStartIndex] || `${formatDate(startDate)} till ${formatDate(endDate)}`;
        }
        return `${formatDate(startDate)} till ${formatDate(endDate)}`;
    };

    const buildDisplayData = () => {
        if (!shouldAggregatePoints) {
            pointDisplayData = inkomstData.map((entry, index) => ({
                ...entry,
                displayLabel: weekLabels[index] || 'Okänd vecka',
                startWeekIndex: entry.x,
                endWeekIndex: entry.x,
                sourceIndices: [index],
                förälder1Components: cloneComponents(entry.förälder1Components),
                förälder2Components: cloneComponents(entry.förälder2Components)
            }));
            displayDraggables = draggablePoints.map(point => ({
                ...point,
                displayIndex: point.index,
                sourceIndex: point.index
            }));
            return;
        }

        const aggregated = [];
        const appendAggregatedChunk = (chunk) => {
            if (!chunk.length) {
                return;
            }
            const start = chunk[0];
            const end = chunk[chunk.length - 1];
            const representative = start.data;
            const midpoint = (representative.x + end.data.x) / 2;
            const sourceIndices = chunk.map(entry => entry.index);
            const averageValue = (key) => chunk.reduce(
                (sum, entry) => sum + toFiniteNumber(entry.data[key]),
                0
            ) / chunk.length;

            aggregated.push({
                x: midpoint,
                y: averageValue('y'),
                förälder1Inkomst: averageValue('förälder1Inkomst'),
                förälder2Inkomst: averageValue('förälder2Inkomst'),
                periodLabel: representative.periodLabel,
                förälder1Components: cloneComponents(representative.förälder1Components),
                förälder2Components: cloneComponents(representative.förälder2Components),
                displayLabel: formatRangeLabel(start.data.x, end.data.x),
                startWeekIndex: start.data.x,
                endWeekIndex: end.data.x,
                sourceIndices
            });
        };

        const processGroup = (group) => {
            if (isMobileView) {
                if (group.length <= 1) {
                    appendAggregatedChunk(group);
                    return;
                }
                if (group.length === 2) {
                    appendAggregatedChunk(group.slice(0, 1));
                    appendAggregatedChunk(group.slice(1));
                    return;
                }
                const splitIndex = Math.ceil(group.length / 2);
                appendAggregatedChunk(group.slice(0, splitIndex));
                appendAggregatedChunk(group.slice(splitIndex));
                return;
            }

            for (let i = 0; i < group.length; i += 2) {
                appendAggregatedChunk(group.slice(i, i + 2));
            }
        };

        let currentGroup = [];
        inkomstData.forEach((entry, index) => {
            if (!currentGroup.length || currentGroup[currentGroup.length - 1].data.periodLabel === entry.periodLabel) {
                currentGroup.push({ data: entry, index });
            } else {
                processGroup(currentGroup);
                currentGroup = [{ data: entry, index }];
            }
        });
        if (currentGroup.length) {
            processGroup(currentGroup);
        }

        pointDisplayData = aggregated;
        displayDraggables = [];
    };

    generateInkomstData();
    buildDisplayData();
    normalizeSelectedPointIndex();

    usedPeriodColors = new Set(inkomstData.map(data => getPeriodColor(data.x)));
    usedSeverityLevels = new Set(
        inkomstData
            .map(data => getIncomeSeverity(data.y))
            .filter(Boolean)
    );
    const legendEntries = buildLegendEntries();

    const baseResultSnapshot = {
        plan1,
        plan1NoExtra,
        plan2,
        plan2NoExtra,
        plan1MinDagar,
        plan2MinDagar,
        plan1Overlap,
        genomförbarhet,
        dag1,
        extra1,
        dag2,
        extra2,
        förälder1InkomstDagar,
        förälder2InkomstDagar,
        förälder1MinDagar,
        förälder2MinDagar,
        användaInkomstDagar1,
        användaInkomstDagar2,
        användaMinDagar1,
        användaMinDagar2,
        arbetsInkomst1,
        arbetsInkomst2,
        barnbidragPerPerson,
        tilläggPerPerson
    };

    const baselineSummary = createStrategySummary(
        baseResultSnapshot,
        optimizationContext?.preferences,
        includePartner
    );
    const baselineIncomeTotal = baselineSummary
        ? Math.round(toFiniteNumber(baselineSummary.totalIncome))
        : null;

    const statusFärger = {
        ok: { bakgrund: '#e6ffe6', kant: '#00cc00', titel: 'Planen är genomförbar' },
        warning: {
            bakgrund: '#fffbe6',
            kant: '#ffcc00',
            titel: 'Varning: Planen är inte fullt genomförbar'
        },
        error: {
            bakgrund: '#ffcccc',
            kant: '#ff0000',
            titel: 'Planen är inte genomförbar'
        }
    };
    const status = statusFärger[genomförbarhet.status || 'ok'];
    const parent1HasCollective = extra1 > 0 && period1ExtraWeeks > 0;
    const parent2HasCollective = extra2 > 0 && period2ExtraWeeks > 0;
    const showParent1Phases = parent1HasCollective || parent2HasCollective;
    const showParent2Phases = parent2HasCollective;

    const buildPeriodSummary = () => {
        const period1EndDate = new Date(period1Start);
        period1EndDate.setDate(period1EndDate.getDate() + (period1TotalWeeks * 7) - 1);
        const period2StartDate = new Date(period1EndDate);
        period2StartDate.setDate(period2StartDate.getDate() + 1);
        const period2EndDate = new Date(period2StartDate);
        period2EndDate.setDate(period2EndDate.getDate() + (period2TotalWeeks * 7) - 1);

        const parent1Fas1End = period1ExtraWeeks > 0 ? addDays(period1Start, (period1ExtraWeeks * 7) - 1) : null;
        const parent1Fas2Start = parent1Fas1End ? addDays(parent1Fas1End, 1) : new Date(period1Start);
        const parent2Fas1End = period2ExtraWeeks > 0 ? addDays(period2StartDate, (period2ExtraWeeks * 7) - 1) : null;
        const parent2Fas2Start = parent2Fas1End ? addDays(parent2Fas1End, 1) : new Date(period2StartDate);

        const sections = [];
        const createSection = lines => `<div class="summary-section">${lines.join('<br>')}</div>`;
        const createPeriodSection = ({
            periodLabel,
            phaseLabel,
            description,
            dateRange,
            bodyLines
        }) => {
            const phaseHtml = phaseLabel
                ? `<span class="summary-phase-title">${phaseLabel}</span>`
                : '';
            const bodyHtml = (bodyLines || [])
                .filter(Boolean)
                .map(line => `<div class="summary-body-line">${line}</div>`)
                .join('');
            return (
                `<div class="summary-section period-summary">` +
                `<div class="summary-period-heading">` +
                `<span class="summary-period-title">${periodLabel}</span>` +
                phaseHtml +
                '</div>' +
                `<div class="summary-period-description">${description}</div>` +
                `<div class="summary-period-range">${dateRange}</div>` +
                bodyHtml +
                '</div>'
            );
        };
        const joinSummaryParts = parts => {
            const filtered = parts.filter(Boolean);
            if (!filtered.length) {
                return '';
            }

            return filtered
                .map(part => {
                    const isCombined = part.includes('income-flag');
                    const partClass = isCombined
                        ? 'summary-line-part combined-income-line'
                        : 'summary-line-part';
                    return `<div class="${partClass}">${part}</div>`;
                })
                .join('');
        };
        const appendPeriod = blocks => {
            if (!blocks.length) {
                return;
            }
            if (sections.length) {
                sections.push('<hr class="summary-period-divider">');
            }
            blocks.forEach((blockConfig, index) => {
                sections.push(createPeriodSection(blockConfig));
                if (index < blocks.length - 1) {
                    sections.push('<hr class="summary-phase-divider">');
                }
            });
        };

        const period0Description = includePartner ? 'Båda föräldrarna lediga' : 'Första 10 dagarna';
        const overlapIncome = includePartner
            ? dadLeaveFörälder1Inkomst + dadLeaveFörälder2Inkomst
            : dadLeaveFörälder1Inkomst;
        const overlapBodyLines = [`Överlappande ledighet: 10 arbetsdagar (${dadLeaveDurationWeeks} veckor)`];
        const overlapParentLine = joinSummaryParts([
            `<span class="leave-parent parent1">Förälder 1: Inkomst ${dadLeaveFörälder1Inkomst.toLocaleString()} kr/månad (${overlapDaysPerWeek} dagar/vecka).</span>`,
            includePartner
                ? `<span class="leave-parent parent2">Förälder 2: Inkomst ${dadLeaveFörälder2Inkomst.toLocaleString()} kr/månad (5 dagar/vecka).</span>`
                : '',
            formatCombinedIncome(incomeLabelText, overlapIncome)
        ]);
        overlapBodyLines.push(overlapParentLine);
        sections.push(
            createPeriodSection({
                periodLabel: 'Period 0',
                phaseLabel: '',
                description: period0Description,
                dateRange: `${formatDate(dadLeaveStart)} till ${formatDate(dadLeaveEnd)}`,
                bodyLines: overlapBodyLines
            })
        );

        const period1Blocks = [];
        if (showParent1Phases) {
            if (period1ExtraWeeks > 0) {
                const parent1Line =
                    `<span class="leave-parent parent1">Förälder 1: ${(period1ExtraWeeks / 4.3).toFixed(1)} månader (~${Math.round(period1ExtraWeeks)} veckor), inkomst ${period1Förälder1Inkomst.toLocaleString()} kr/månad (${formatDaysPerWeekLabel(plan1ExtraDaysPerWeek)} dagar/vecka).</span>`;
                const partnerLine = includePartner
                    ? `<span class="working-parent parent2">Förälder 2: Inkomst ${period1Förälder2Inkomst.toLocaleString()} kr/månad.</span>`
                    : '';
                const fas1Income = includePartner ? period1KombExtra : period1Förälder1Inkomst;
                const fas1Body = [
                    joinSummaryParts([parent1Line, partnerLine, formatCombinedIncome(incomeLabelText, fas1Income)])
                ];
                period1Blocks.push({
                    periodLabel: 'Period 1',
                    phaseLabel: 'Fas 1 (med föräldralön)',
                    description: `Förälder 1 ledig${includePartner ? ', Förälder 2 jobbar' : ''}`,
                    dateRange: `${formatDate(period1Start)} till ${formatDate(parent1Fas1End || period1EndDate)}`,
                    bodyLines: fas1Body
                });
            }

            if ((period1NoExtraWeeks + period1MinWeeks) > 0) {
                const fas2Body = [];
                if (period1NoExtraWeeks > 0) {
                    const incomeValue = includePartner ? period1KombNoExtra : period1NoExtraFörälder1Inkomst;
                    const parent1Line =
                        `<span class="leave-parent parent1">Förälder 1: ${(period1NoExtraWeeks / 4.3).toFixed(1)} månader (~${Math.round(period1NoExtraWeeks)} veckor) utan föräldralön, inkomst ${period1NoExtraFörälder1Inkomst.toLocaleString()} kr/månad (${formatDaysPerWeekLabel(plan1NoExtraDaysPerWeek)} dagar/vecka).</span>`;
                    const partnerLine = includePartner
                        ? `<span class="working-parent parent2">Förälder 2: Inkomst ${period1Förälder2Inkomst.toLocaleString()} kr/månad.</span>`
                        : '';
                    fas2Body.push(
                        joinSummaryParts([parent1Line, partnerLine, formatCombinedIncome(incomeLabelText, incomeValue)])
                    );
                }
                if (period1MinWeeks > 0) {
                    const incomeValue = includePartner ? period1KombMin : period1MinFörälder1Inkomst;
                    const parent1Line =
                        `<span class="leave-parent parent1">Förälder 1: ${(period1MinWeeks / 4.3).toFixed(1)} månader (~${Math.round(period1MinWeeks)} veckor) på lägstanivå, inkomst ${period1MinFörälder1Inkomst.toLocaleString()} kr/månad (${formatDaysPerWeekLabel(plan1MinDaysPerWeek)} dagar/vecka).</span>`;
                    const partnerLine = includePartner
                        ? `<span class="working-parent parent2">Förälder 2: Inkomst ${period1Förälder2Inkomst.toLocaleString()} kr/månad.</span>`
                        : '';
                    fas2Body.push(
                        joinSummaryParts([parent1Line, partnerLine, formatCombinedIncome(incomeLabelText, incomeValue)])
                    );
                }
                period1Blocks.push({
                    periodLabel: 'Period 1',
                    phaseLabel: 'Fas 2',
                    description: `Förälder 1 ledig${includePartner ? ', Förälder 2 jobbar' : ''}`,
                    dateRange: `${formatDate(parent1Fas2Start)} till ${formatDate(period1EndDate)}`,
                    bodyLines: fas2Body
                });
            }
        } else if (period1TotalWeeks > 0) {
            const parent1Line =
                `<span class="leave-parent parent1">Förälder 1: ${(period1TotalWeeks / 4.3).toFixed(1)} månader (~${Math.round(period1TotalWeeks)} veckor), ${formatDaysPerWeekLabel(plan1ExtraDaysPerWeek)} dagar/vecka, inkomst ${period1Förälder1Inkomst.toLocaleString()} kr/månad.</span>`;
            const partnerLine = includePartner
                ? `<span class="working-parent parent2">Förälder 2: Inkomst ${period1Förälder2Inkomst.toLocaleString()} kr/månad.</span>`
                : '';
            const incomeValue = includePartner ? period1KombExtra : period1Förälder1Inkomst;
            const blockBody = [
                joinSummaryParts([parent1Line, partnerLine, formatCombinedIncome(incomeLabelText, incomeValue)])
            ];
            period1Blocks.push({
                periodLabel: 'Period 1',
                phaseLabel: '',
                description: `Förälder 1 ledig${includePartner ? ', Förälder 2 jobbar' : ''}`,
                dateRange: `${formatDate(period1Start)} till ${formatDate(period1EndDate)}`,
                bodyLines: blockBody
            });
        }
        appendPeriod(period1Blocks);

        if (includePartner) {
            const period2Blocks = [];
            if (showParent2Phases) {
                if (period2ExtraWeeks > 0) {
                    const parent1Line =
                        `<span class="working-parent parent1">Förälder 1: Inkomst ${period2Förälder1Inkomst.toLocaleString()} kr/månad.</span>`;
                    const parent2Line =
                        `<span class="leave-parent parent2">Förälder 2: ${(period2ExtraWeeks / 4.3).toFixed(1)} månader (~${Math.round(period2ExtraWeeks)} veckor), inkomst ${period2Förälder2Inkomst.toLocaleString()} kr/månad (${formatDaysPerWeekLabel(plan2ExtraDaysPerWeek)} dagar/vecka).</span>`;
                    const bodyLines = [
                        joinSummaryParts([parent1Line, parent2Line, formatCombinedIncome(incomeLabelText, period2KombExtra)])
                    ];
                    period2Blocks.push({
                        periodLabel: 'Period 2',
                        phaseLabel: 'Fas 1 (med föräldralön)',
                        description: 'Förälder 1 jobbar, Förälder 2 ledig',
                        dateRange: `${formatDate(period2StartDate)} till ${formatDate(parent2Fas1End || period2EndDate)}`,
                        bodyLines
                    });
                }

                if ((period2NoExtraWeeks + period2MinWeeks) > 0) {
                    const fas2Body = [];
                    if (period2NoExtraWeeks > 0) {
                        const parent1Line =
                            `<span class="working-parent parent1">Förälder 1: Inkomst ${period2Förälder1Inkomst.toLocaleString()} kr/månad.</span>`;
                        const parent2Line =
                            `<span class="leave-parent parent2">Förälder 2: ${(period2NoExtraWeeks / 4.3).toFixed(1)} månader (~${Math.round(period2NoExtraWeeks)} veckor) utan föräldralön, inkomst ${period2NoExtraFörälder2Inkomst.toLocaleString()} kr/månad (${formatDaysPerWeekLabel(plan2NoExtraDaysPerWeek)} dagar/vecka).</span>`;
                        fas2Body.push(
                            joinSummaryParts([parent1Line, parent2Line, formatCombinedIncome(incomeLabelText, period2KombNoExtra)])
                        );
                    }
                    if (period2MinWeeks > 0) {
                        const parent1Line =
                            `<span class="working-parent parent1">Förälder 1: Inkomst ${period2Förälder1Inkomst.toLocaleString()} kr/månad.</span>`;
                        const parent2Line =
                            `<span class="leave-parent parent2">Förälder 2: ${(period2MinWeeks / 4.3).toFixed(1)} månader (~${Math.round(period2MinWeeks)} veckor) på lägstanivå, inkomst ${period2MinFörälder2Inkomst.toLocaleString()} kr/månad (${formatDaysPerWeekLabel(plan2MinDaysPerWeek)} dagar/vecka).</span>`;
                        fas2Body.push(
                            joinSummaryParts([parent1Line, parent2Line, formatCombinedIncome(incomeLabelText, period2KombMin)])
                        );
                    }
                    period2Blocks.push({
                        periodLabel: 'Period 2',
                        phaseLabel: 'Fas 2',
                        description: 'Förälder 1 jobbar, Förälder 2 ledig',
                        dateRange: `${formatDate(parent2Fas2Start)} till ${formatDate(period2EndDate)}`,
                        bodyLines: fas2Body
                    });
                }
            } else if (period2TotalWeeks > 0) {
                const parent1Line =
                    `<span class="working-parent parent1">Förälder 1: Inkomst ${period2Förälder1Inkomst.toLocaleString()} kr/månad.</span>`;
                const period2Body = [];
                if (period2TotalWeeks > 0) {
                    const parent2Line = extra2 > 0 && period2ExtraWeeks > 0
                        ? `<span class="leave-parent parent2">Förälder 2: ${(period2ExtraWeeks / 4.3).toFixed(1)} månader (~${Math.round(period2ExtraWeeks)} veckor), inkomst ${period2Förälder2Inkomst.toLocaleString()} kr/månad (${formatDaysPerWeekLabel(plan2ExtraDaysPerWeek)} dagar/vecka).</span>`
                        : `<span class="leave-parent parent2">Förälder 2: ${(period2TotalWeeks / 4.3).toFixed(1)} månader (~${Math.round(period2TotalWeeks)} veckor), ${formatDaysPerWeekLabel(plan2ExtraDaysPerWeek)} dagar/vecka, inkomst ${period2Förälder2Inkomst.toLocaleString()} kr/månad.</span>`;
                    period2Body.push(
                        joinSummaryParts([parent1Line, parent2Line, formatCombinedIncome(incomeLabelText, period2KombExtra)])
                    );
                }
                if (extra2 > 0 && period2NoExtraWeeks > 0) {
                    const parent2Line =
                        `<span class="leave-parent parent2">Förälder 2: ${(period2NoExtraWeeks / 4.3).toFixed(1)} månader (~${Math.round(period2NoExtraWeeks)} veckor) utan föräldralön, inkomst ${period2NoExtraFörälder2Inkomst.toLocaleString()} kr/månad (${formatDaysPerWeekLabel(plan2NoExtraDaysPerWeek)} dagar/vecka).</span>`;
                    period2Body.push(
                        joinSummaryParts([parent1Line, parent2Line, formatCombinedIncome(incomeLabelText, period2KombNoExtra)])
                    );
                }
                if (period2MinWeeks > 0) {
                    const parent2Line =
                        `<span class="leave-parent parent2">Förälder 2: ${(period2MinWeeks / 4.3).toFixed(1)} månader (~${Math.round(period2MinWeeks)} veckor) på lägstanivå, inkomst ${period2MinFörälder2Inkomst.toLocaleString()} kr/månad (${formatDaysPerWeekLabel(plan2MinDaysPerWeek)} dagar/vecka).</span>`;
                    period2Body.push(
                        joinSummaryParts([parent1Line, parent2Line, formatCombinedIncome(incomeLabelText, period2KombMin)])
                    );
                }
                period2Blocks.push({
                    periodLabel: 'Period 2',
                    phaseLabel: '',
                    description: 'Förälder 1 jobbar, Förälder 2 ledig',
                    dateRange: `${formatDate(period2StartDate)} till ${formatDate(period2EndDate)}`,
                    bodyLines: period2Body
                });
            }
            appendPeriod(period2Blocks);
        }

        const usedLines = [
            '<strong>Använda dagar:</strong>',
            formatUsedDaysLine('Förälder 1', användaInkomstDagar1, användaMinDagar1)
        ];
        if (includePartner) {
            usedLines.push(formatUsedDaysLine('Förälder 2', användaInkomstDagar2, användaMinDagar2));
        }
        sections.push(createSection(usedLines));

        const remainingLines = [
            '<strong>Återstående dagar:</strong>',
            `Förälder 1: ${förälder1InkomstDagar.toLocaleString()} dagar (sjukpenningnivå), ${förälder1MinDagar.toLocaleString()} dagar (lägstanivå)`
        ];
        if (includePartner) {
            remainingLines.push(`Förälder 2: ${förälder2InkomstDagar.toLocaleString()} dagar (sjukpenningnivå), ${förälder2MinDagar.toLocaleString()} dagar (lägstanivå)`);
        }
        if (unusedFöräldralönWeeks1 > 0 && maxFöräldralönWeeks1 > 0) {
            const allowedMonths1 = (maxFöräldralönWeeks1 / 4.3).toFixed(0);
            remainingLines.push(`<span style="color: #f28c38;">Förälder 1: Du har möjlighet att ta ut föräldralön i upp till ${allowedMonths1} månader men utnyttjar just nu inte allt.</span>`);
        }
        if (includePartner && unusedFöräldralönWeeks2 > 0 && maxFöräldralönWeeks2 > 0) {
            const allowedMonths2 = (maxFöräldralönWeeks2 / 4.3).toFixed(0);
            remainingLines.push(`<span style="color: #f28c38;">Förälder 2: Du har möjlighet att ta ut föräldralön i upp till ${allowedMonths2} månader men utnyttjar just nu inte allt.</span>`);
        }
        sections.push(createSection(remainingLines));

        return sections.join('');
    };

    const buildFeasibilityHtml = () => {
        let contentHtml = `<strong style="font-size: 1.2em;">${status.titel}</strong><br><br>`;
        if (transferredDays > 0 && genomförbarhet.status === 'ok') {
            contentHtml += `<span style="color: #f28c38;">Överförde ${transferredDays} inkomstbaserade dagar till Förälder 1, används under ${transferredWeeks} veckor.</span><br><br>`;
        }
        if (!genomförbarhet.ärGenomförbar && genomförbarhet.meddelande) {
            contentHtml += `<span style="color: #ff0000;">${genomförbarhet.meddelande}</span><br><br>`;
        }
        contentHtml += buildPeriodSummary();

        return `<div class="feasibility-message collapsed" style="background-color: ${status.bakgrund}; border: 1px solid ${status.kant}; padding: 15px; margin-bottom: 15px; font-family: Inter, sans-serif; border-radius: 10px;">`
            + `<button type="button" class="feasibility-toggle strategy-details-toggle" aria-expanded="false">`
            + `<span class="feasibility-toggle-label">Mer detaljer</span>`
            + `<span class="feasibility-toggle-icon" aria-hidden="true">▾</span>`
            + `</button>`
            + `<div class="feasibility-content" hidden>${contentHtml}</div>`
            + '</div>';
    };

    const initializeFeasibilityToggle = (rootElement) => {
        const messageEl = rootElement?.querySelector('.feasibility-message');
        if (!messageEl) {
            return;
        }
        const toggleButton = messageEl.querySelector('.feasibility-toggle');
        const contentEl = messageEl.querySelector('.feasibility-content');
        if (!toggleButton || !contentEl) {
            return;
        }
        const labelEl = toggleButton.querySelector('.feasibility-toggle-label');
        const iconEl = toggleButton.querySelector('.feasibility-toggle-icon');

        const setState = (expanded) => {
            messageEl.classList.toggle('expanded', expanded);
            messageEl.classList.toggle('collapsed', !expanded);
            contentEl.hidden = !expanded;
            toggleButton.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            if (labelEl) {
                labelEl.textContent = expanded ? 'Dölj detaljer' : 'Mer detaljer';
            } else {
                toggleButton.textContent = expanded ? 'Dölj detaljer' : 'Mer detaljer';
            }
            if (iconEl) {
                iconEl.textContent = expanded ? '▴' : '▾';
            }
        };

        toggleButton.addEventListener('click', () => {
            const nextState = !messageEl.classList.contains('expanded');
            setState(nextState);
        });

        setState(false);
    };

    const suggestionsContainer = document.createElement('div');
    suggestionsContainer.id = 'optimization-suggestions';
    suggestionsContainer.className = 'optimization-suggestions';
    suggestionsContainer.style.display = 'none';

    const assistanceButton = document.createElement('button');
    assistanceButton.type = 'button';
    assistanceButton.className = 'optimization-assist-btn';
    assistanceButton.textContent = 'Hjälp mig att optimera';

    let cachedSuggestions = null;

    const applySuggestedPlan = (boxData) => {
        if (!boxData?.result) {
            return;
        }
        cachedSuggestions = null;
        const preferencesOverride = boxData.preferences ? { ...boxData.preferences } : {};
        const suggestedParent1Months = toNonNegative(preferencesOverride.ledigTid1);
        const suggestedParent2Months = includePartner
            ? toNonNegative(preferencesOverride.ledigTid2)
            : 0;
        const suggestedTotalMonths = suggestedParent1Months + suggestedParent2Months;

        const syncFormControls = () => {
            const totalInput = document.getElementById('ledig-tid-5823');
            if (totalInput && Number.isFinite(suggestedTotalMonths)) {
                totalInput.value = suggestedTotalMonths;
                totalInput.dispatchEvent(new Event('input', { bubbles: true }));
                totalInput.dispatchEvent(new Event('change', { bubbles: true }));
            }

            const slider = document.getElementById('leave-slider');
            if (slider && includePartner && Number.isFinite(suggestedParent1Months)) {
                slider.value = suggestedParent1Months;
                slider.dispatchEvent(new Event('input', { bubbles: true }));
                slider.dispatchEvent(new Event('change', { bubbles: true }));
            }

            const minIncomeInput = document.getElementById('min-inkomst');
            if (minIncomeInput && Number.isFinite(preferencesOverride.minInkomst)) {
                minIncomeInput.value = preferencesOverride.minInkomst;
            }

            const strategySelect = document.getElementById('strategy');
            if (strategySelect && typeof preferencesOverride.strategy === 'string') {
                strategySelect.value = preferencesOverride.strategy;
            }
        };

        syncFormControls();
        const nextContext = optimizationContext
            ? {
                ...optimizationContext,
                preferences: {
                    ...(optimizationContext.preferences || {}),
                    ...preferencesOverride
                }
            }
            : null;
        if (nextContext) {
            if (suggestedTotalMonths > 0) {
                nextContext.totalMonths = suggestedTotalMonths;
            }
        }
        const enrichedResult = {
            ...boxData.result,
            barnbidragPerPerson,
            tilläggPerPerson
        };
        renderGanttChart(
            enrichedResult.plan1,
            enrichedResult.plan2,
            enrichedResult.plan1NoExtra,
            enrichedResult.plan2NoExtra,
            enrichedResult.plan1MinDagar,
            enrichedResult.plan2MinDagar,
            enrichedResult.plan1Overlap,
            inkomst1,
            inkomst2,
            vårdnad,
            beräknaPartner,
            enrichedResult.genomförbarhet,
            enrichedResult.dag1,
            enrichedResult.extra1,
            enrichedResult.dag2,
            enrichedResult.extra2,
            enrichedResult.förälder1InkomstDagar,
            enrichedResult.förälder2InkomstDagar,
            enrichedResult.förälder1MinDagar,
            enrichedResult.förälder2MinDagar,
            barnDatum,
            enrichedResult.arbetsInkomst1,
            enrichedResult.arbetsInkomst2,
            barnbidragPerPerson,
            tilläggPerPerson,
            enrichedResult.maxFöräldralönWeeks1,
            enrichedResult.maxFöräldralönWeeks2,
            enrichedResult.unusedFöräldralönWeeks1,
            enrichedResult.unusedFöräldralönWeeks2,
            enrichedResult.användaInkomstDagar1,
            enrichedResult.användaMinDagar1,
            enrichedResult.användaInkomstDagar2,
            enrichedResult.användaMinDagar2,
            nextContext
        );
    };

    const createMetricItem = (label, valueText, diffValue, diffOptions) => {
        const item = document.createElement('li');
        item.className = 'strategy-metric';
        const labelSpan = document.createElement('span');
        labelSpan.className = 'metric-label';
        labelSpan.textContent = label;
        const valueSpan = document.createElement('span');
        valueSpan.className = 'metric-value';
        valueSpan.textContent = valueText;
        if (baselineSummary && typeof diffValue === 'number') {
            const { text, className } = formatDifference(diffValue, diffOptions);
            if (text) {
                const diffSpan = document.createElement('span');
                diffSpan.className = `metric-diff ${className}`.trim();
                diffSpan.textContent = text;
                valueSpan.appendChild(diffSpan);
            }
        }
        item.appendChild(labelSpan);
        item.appendChild(valueSpan);
        return item;
    };

    const createDaysBlock = (title, current, baseline, options = {}) => {
        const block = document.createElement('div');
        block.className = 'strategy-days-block';

        const heading = document.createElement('div');
        heading.className = 'strategy-days-heading';
        heading.textContent = title;
        block.appendChild(heading);

        const renderUsedParent = (label, currentData = {}, baselineData = {}) => {
            const parentWrapper = document.createElement('div');
            parentWrapper.className = 'strategy-days-parent';

            const parentLabel = document.createElement('div');
            parentLabel.className = 'strategy-days-parent-label';
            parentLabel.textContent = `${label}:`;
            parentWrapper.appendChild(parentLabel);

            const createDetailLine = (detailLabel, currentValue, baselineValue) => {
                const detailLine = document.createElement('div');
                detailLine.className = 'strategy-days-detail';
                const currentNumeric = Math.round(toNonNegative(currentValue));
                detailLine.innerHTML = `
                    <span class="detail-label">${detailLabel}:</span>
                    <span class="detail-value">${currentNumeric.toLocaleString('sv-SE')} dagar</span>
                `;
                if (!options.forceNeutral && baselineValue != null) {
                    const baselineNumeric = Math.round(toNonNegative(baselineValue));
                    const diffInfo = formatDayDifference(currentNumeric - baselineNumeric);
                    if (diffInfo) {
                        const diffSpan = document.createElement('span');
                        diffSpan.className = `days-diff ${diffInfo.className}`;
                        diffSpan.textContent = diffInfo.text;
                        detailLine.appendChild(diffSpan);
                    }
                }
                return detailLine;
            };

            parentWrapper.appendChild(
                createDetailLine('Sjukpenningsnivå', currentData.income, baselineData?.income)
            );
            parentWrapper.appendChild(
                createDetailLine('Lägstanivå', currentData.min, baselineData?.min)
            );
            return parentWrapper;
        };

        const renderRemainingLine = (label, currentData = {}, baselineData = {}) => {
            const line = document.createElement('div');
            line.className = 'strategy-days-line';
            const incomeDays = Math.round(toNonNegative(currentData.income));
            const minDays = Math.round(toNonNegative(currentData.min));
            const totalDays = incomeDays + minDays;

            const totalSpan = document.createElement('span');
            totalSpan.className = 'days-total';
            totalSpan.textContent = `${label}: ${totalDays.toLocaleString('sv-SE')} dagar`;
            line.appendChild(totalSpan);

            const breakdownSpan = document.createElement('span');
            breakdownSpan.className = 'days-breakdown';
            breakdownSpan.textContent = ` (${incomeDays.toLocaleString('sv-SE')}/${minDays.toLocaleString('sv-SE')} dagar)`;
            line.appendChild(breakdownSpan);

            if (!options.forceNeutral && baselineData) {
                const baselineIncome = Math.round(toNonNegative(baselineData.income));
                const baselineMin = Math.round(toNonNegative(baselineData.min));
                const incomeDiff = formatDayDifference(
                    incomeDays - baselineIncome,
                    { includeParens: false, unit: '', neutralText: '0' }
                );
                const minDiff = formatDayDifference(
                    minDays - baselineMin,
                    { includeParens: false, unit: '', neutralText: '0' }
                );
                if (incomeDiff && minDiff) {
                    const wrapper = document.createElement('span');
                    wrapper.className = 'days-diff-wrapper';
                    wrapper.appendChild(document.createTextNode(' '));
                    const deltaLabel = document.createElement('span');
                    deltaLabel.className = 'days-delta-label';
                    deltaLabel.textContent = 'Δ ';
                    wrapper.appendChild(deltaLabel);
                    const incomeSpan = document.createElement('span');
                    incomeSpan.className = `days-diff ${incomeDiff.className}`;
                    incomeSpan.textContent = incomeDiff.text;
                    wrapper.appendChild(incomeSpan);
                    wrapper.appendChild(document.createTextNode('/'));
                    const minSpan = document.createElement('span');
                    minSpan.className = `days-diff ${minDiff.className}`;
                    minSpan.textContent = minDiff.text;
                    wrapper.appendChild(minSpan);
                    wrapper.appendChild(document.createTextNode(' dagar'));
                    line.appendChild(wrapper);
                }
            }

            return line;
        };

        if ((options.blockType || 'used') === 'remaining') {
            block.appendChild(
                renderRemainingLine('Förälder 1', current?.parent1, baseline?.parent1)
            );
            if (includePartner && current?.parent2) {
                block.appendChild(
                    renderRemainingLine('Förälder 2', current.parent2, baseline?.parent2)
                );
            }
            return block;
        }

        block.appendChild(
            renderUsedParent('Förälder 1', current?.parent1, baseline?.parent1)
        );
        if (includePartner && current?.parent2) {
            block.appendChild(
                renderUsedParent('Förälder 2', current.parent2, baseline?.parent2)
            );
        }

        return block;
    };

    const renderStrategyBox = (boxData) => {
        const box = document.createElement('div');
        box.className = 'strategy-box';
        const title = document.createElement('h4');
        title.textContent = boxData.title;
        box.appendChild(title);

        if (boxData.description) {
            const description = document.createElement('p');
            description.className = 'strategy-description';
            description.textContent = boxData.description;
            box.appendChild(description);
        }

        if (!boxData.summary) {
            const message = document.createElement('p');
            message.className = 'strategy-message';
            message.textContent = boxData.message || 'Inga uppgifter finns för den här strategin.';
            box.appendChild(message);
            return box;
        }

        const summary = boxData.summary;
        let displaySummary = summary;
        let useBaselineForDisplay = false;
        let actionNoteText = '';

        if (baselineSummary) {
            if (boxData.type === 'remainingDays') {
                const strategyRemaining = toFiniteNumber(summary.totalRemainingDays);
                const baselineRemaining = toFiniteNumber(baselineSummary.totalRemainingDays);
                if (strategyRemaining < baselineRemaining) {
                    useBaselineForDisplay = true;
                    actionNoteText = 'Detta är den bästa strategin för att spara flest antal dagar';
                }
            } else if (boxData.type === 'income') {
                const strategyIncomeTotal = toFiniteNumber(summary.totalIncome);
                const baselineIncome = toFiniteNumber(baselineSummary.totalIncome);
                if (strategyIncomeTotal < baselineIncome) {
                    useBaselineForDisplay = true;
                    actionNoteText = 'Detta är den bästa strategin för att maximera inkomsten under föräldraledigheten';
                }
            }
        }

        if (useBaselineForDisplay && baselineSummary) {
            displaySummary = baselineSummary;
        }

        let summaryMessageHtml = '';
        const resolvedIncomeTotal = Math.round(toFiniteNumber(displaySummary?.totalIncome));
        let resolvedRemainingTotal = Math.round(toFiniteNumber(displaySummary?.totalRemainingDays));
        if (!Number.isFinite(resolvedRemainingTotal) && displaySummary?.remainingDays) {
            const parent1Remaining = displaySummary.remainingDays.parent1 || {};
            const parent2Remaining = displaySummary.remainingDays.parent2 || {};
            const parent1Total = toNonNegative(parent1Remaining.income) + toNonNegative(parent1Remaining.min);
            const parent2Total = toNonNegative(parent2Remaining.income) + toNonNegative(parent2Remaining.min);
            resolvedRemainingTotal = Math.round(parent1Total + parent2Total);
        }
        const formattedIncomeTotal = Number.isFinite(resolvedIncomeTotal)
            ? resolvedIncomeTotal.toLocaleString('sv-SE')
            : null;
        const formattedRemainingTotal = Number.isFinite(resolvedRemainingTotal)
            ? resolvedRemainingTotal.toLocaleString('sv-SE')
            : null;

        const canShowSummaryDiffs = Boolean(baselineSummary) && !useBaselineForDisplay;
        let incomeDiffHtml = '';
        let remainingDiffHtml = '';
        if (canShowSummaryDiffs) {
            const incomeDiffValue = Math.round(
                toFiniteNumber(summary.totalIncome) - toFiniteNumber(baselineSummary.totalIncome)
            );
            const incomeDiffInfo = formatDifference(incomeDiffValue, { unit: 'kr', epsilon: 0.5 });
            if (incomeDiffInfo.text) {
                const incomeClass = incomeDiffInfo.className ? ` ${incomeDiffInfo.className}` : '';
                incomeDiffHtml = `<span class="summary-diff${incomeClass}">${incomeDiffInfo.text.trim()}</span>`;
            }

            const remainingDiffValue = toFiniteNumber(summary.totalRemainingDays) -
                toFiniteNumber(baselineSummary.totalRemainingDays);
            const remainingDiffInfo = formatDayDifference(remainingDiffValue);
            if (remainingDiffInfo?.text) {
                const remainingClass = remainingDiffInfo.className ? ` ${remainingDiffInfo.className}` : '';
                remainingDiffHtml = `<span class="summary-diff${remainingClass}">${remainingDiffInfo.text}</span>`;
            }
        }

        if (formattedIncomeTotal && formattedRemainingTotal) {
            const incomeSuffix = incomeDiffHtml ? ` ${incomeDiffHtml}` : '';
            const remainingSuffix = remainingDiffHtml ? ` ${remainingDiffHtml}` : '';
            summaryMessageHtml = `Denna strategi ger den totala nettoinkomsten <span class="strategy-highlight">${formattedIncomeTotal} sek</span>${incomeSuffix}.<br>Med detta upplägg kommer du att ha <span class="strategy-highlight">${formattedRemainingTotal} dagar</span>${remainingSuffix} kvar efter ledigheten.`;
        } else if (formattedIncomeTotal) {
            const incomeSuffix = incomeDiffHtml ? ` ${incomeDiffHtml}` : '';
            summaryMessageHtml = `Denna strategi ger den totala nettoinkomsten <span class="strategy-highlight">${formattedIncomeTotal} sek</span>${incomeSuffix}.`;
        } else if (formattedRemainingTotal) {
            const remainingSuffix = remainingDiffHtml ? ` ${remainingDiffHtml}` : '';
            summaryMessageHtml = `Med detta upplägg kommer du att ha <span class="strategy-highlight">${formattedRemainingTotal} dagar</span>${remainingSuffix} kvar efter ledigheten.`;
        }

        if (summaryMessageHtml) {
            const summaryNote = document.createElement('p');
            summaryNote.className = 'strategy-summary-note';
            summaryNote.innerHTML = summaryMessageHtml;
            box.appendChild(summaryNote);
        }

        const detailsContainer = document.createElement('div');
        detailsContainer.className = 'strategy-details';
        if (isMobileView) {
            detailsContainer.classList.add('collapsed');
        }

        const list = document.createElement('ul');
        list.className = 'strategy-metrics';

        const minIncomeDiff = baselineSummary != null && !useBaselineForDisplay
            ? summary.minIncome - baselineSummary.minIncome
            : undefined;
        list.appendChild(
            createMetricItem(
                'Lägsta hushållsinkomst',
                formatCurrencyValue(displaySummary.minIncome),
                minIncomeDiff,
                { unit: 'kr', epsilon: 0.5 }
            )
        );

        const parent1MonthsDiff = baselineSummary != null && !useBaselineForDisplay
            ? summary.parent1Months - baselineSummary.parent1Months
            : undefined;
        list.appendChild(
            createMetricItem(
                'Förälder 1 ledig',
                formatMonthsValue(displaySummary.parent1Months),
                parent1MonthsDiff,
                { unit: 'mån', fractionDigits: 0, epsilon: 0.5 }
            )
        );

        const parent2MonthsDiff = baselineSummary != null && !useBaselineForDisplay
            ? summary.parent2Months - baselineSummary.parent2Months
            : undefined;
        list.appendChild(
            createMetricItem(
                'Förälder 2 ledig',
                formatMonthsValue(displaySummary.parent2Months),
                parent2MonthsDiff,
                { unit: 'mån', fractionDigits: 0, epsilon: 0.5 }
            )
        );

        const period1IncomeDiff = baselineSummary != null && !useBaselineForDisplay
            ? summary.period1Income - baselineSummary.period1Income
            : undefined;
        list.appendChild(
            createMetricItem(
                'Period 1 – hushållsinkomst',
                formatCurrencyValue(displaySummary.period1Income),
                period1IncomeDiff,
                { unit: 'kr', epsilon: 0.5 }
            )
        );

        const period2IncomeDiff = baselineSummary != null && !useBaselineForDisplay
            ? summary.period2Income - baselineSummary.period2Income
            : undefined;
        list.appendChild(
            createMetricItem(
                'Period 2 – hushållsinkomst',
                formatCurrencyValue(displaySummary.period2Income),
                period2IncomeDiff,
                { unit: 'kr', epsilon: 0.5 }
            )
        );

        detailsContainer.appendChild(list);
        detailsContainer.appendChild(
            createDaysBlock(
                'Använda dagar',
                displaySummary.usedDays,
                baselineSummary ? baselineSummary.usedDays : null,
                { forceNeutral: useBaselineForDisplay, blockType: 'used' }
            )
        );
        detailsContainer.appendChild(
            createDaysBlock(
                'Återstående dagar',
                displaySummary.remainingDays,
                baselineSummary ? baselineSummary.remainingDays : null,
                { forceNeutral: useBaselineForDisplay, blockType: 'remaining' }
            )
        );

        if (summaryMessageHtml) {
            const incomeNote = document.createElement('div');
            incomeNote.className = 'strategy-income-note';
            incomeNote.innerHTML = summaryMessageHtml;
            detailsContainer.appendChild(incomeNote);
        }

        if (actionNoteText) {
            const note = document.createElement('p');
            note.className = 'strategy-best-note';
            note.textContent = actionNoteText;
            box.appendChild(note);
        } else {
            const applyButton = document.createElement('button');
            applyButton.type = 'button';
            applyButton.className = 'strategy-use-btn';
            applyButton.textContent = 'Använd';
            applyButton.addEventListener('click', () => applySuggestedPlan(boxData));
            detailsContainer.appendChild(applyButton);
        }

        const toggleButton = document.createElement('button');
        toggleButton.type = 'button';
        toggleButton.className = 'strategy-details-toggle';

        const updateToggleState = (expanded) => {
            toggleButton.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            toggleButton.textContent = expanded ? 'Dölj detaljer' : 'Visa detaljer';
            detailsContainer.classList.toggle('collapsed', !expanded);
        };

        const shouldExpandInitially = false;
        updateToggleState(shouldExpandInitially);

        toggleButton.addEventListener('click', () => {
            const isExpanded = !detailsContainer.classList.contains('collapsed');
            updateToggleState(!isExpanded);
        });

        box.appendChild(toggleButton);
        box.appendChild(detailsContainer);

        return box;
    };

    const renderSuggestions = (data) => {
        suggestionsContainer.innerHTML = '';
        if (data?.message) {
            const message = document.createElement('p');
            message.className = 'strategy-message';
            message.textContent = data.message;
            suggestionsContainer.appendChild(message);
            suggestionsContainer.style.display = 'block';
            return;
        }
        const boxes = data?.boxes ?? [];
        if (!boxes.length) {
            const message = document.createElement('p');
            message.className = 'strategy-message';
            message.textContent = 'Inga alternativa strategier kunde tas fram.';
            suggestionsContainer.appendChild(message);
            suggestionsContainer.style.display = 'block';
            return;
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'strategy-box-wrapper';

        boxes.forEach(boxData => {
            const element = renderStrategyBox(boxData);
            wrapper.appendChild(element);
        });

        suggestionsContainer.appendChild(wrapper);

        suggestionsContainer.style.display = 'block';
    };

    const evaluateOptimizationAlternatives = () => {
        if (!optimizationContext?.preferences || !optimizationContext?.inputs) {
            return { message: 'Optimeringsdata saknas. Kör en beräkning först.' };
        }
        if (!includePartner) {
            return { message: 'Alternativa förslag kräver beräkningar för båda föräldrarna.' };
        }
        const totalMonths = toNonNegative(optimizationContext.totalMonths);
        if (!Number.isFinite(totalMonths) || totalMonths <= 0) {
            return { message: 'Ange totalt antal månader för att ta fram förslag.' };
        }
        const stepValue = Number(optimizationContext.step);
        const stepSize = Number.isFinite(stepValue) && stepValue > 0
            ? stepValue
            : (totalMonths > 2 ? 1 : 0.5);
        const iterations = Math.max(1, Math.round(totalMonths / stepSize));
        const results = [];
        const seen = new Set();
        const basePreferences = { ...optimizationContext.preferences };
        const baseInputs = { ...optimizationContext.inputs };
        const monthTolerance = 0.05;

        for (let i = 0; i <= iterations; i++) {
            const candidateMonths = Math.min(totalMonths, i * stepSize);
            const parent1Months = Math.round(candidateMonths * 100) / 100;
            const parent2Months = Math.max(0, totalMonths - parent1Months);
            const key = `${parent1Months.toFixed(2)}-${parent2Months.toFixed(2)}`;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);

            try {
                const prefs = {
                    ...basePreferences,
                    ledigTid1: parent1Months,
                    ledigTid2: parent2Months
                };
                const inputClone = { ...baseInputs };
                const candidateResult = optimizeParentalLeave(prefs, inputClone);
                if (!candidateResult?.genomförbarhet) {
                    continue;
                }
                candidateResult.barnbidragPerPerson = baseInputs.barnbidragPerPerson;
                candidateResult.tilläggPerPerson = baseInputs.tilläggPerPerson;
                const shortfall = Number(candidateResult.genomförbarhet.maxShortfallRatio);
                if (Number.isFinite(shortfall) && shortfall > 0.0001) {
                    continue;
                }
                if (
                    candidateResult.genomförbarhet.ärGenomförbar === false &&
                    (!Number.isFinite(shortfall) || shortfall > 0)
                ) {
                    continue;
                }
                const summary = createStrategySummary(candidateResult, prefs, includePartner);
                if (!summary) {
                    continue;
                }
                if (baselineSummary) {
                    const parent1Diff = Math.abs(summary.parent1Months - baselineSummary.parent1Months);
                    const parent2Diff = Math.abs(summary.parent2Months - baselineSummary.parent2Months);
                    if (parent1Diff <= monthTolerance && parent2Diff <= monthTolerance) {
                        continue;
                    }
                    const incomeGain = Math.round(
                        toFiniteNumber(summary.totalIncome) - toFiniteNumber(baselineSummary.totalIncome)
                    );
                    const remainingGain = Math.round(
                        toFiniteNumber(summary.totalRemainingDays) - toFiniteNumber(baselineSummary.totalRemainingDays)
                    );
                    const incomeTolerance = 1;
                    if (incomeGain <= incomeTolerance && remainingGain <= 0) {
                        continue;
                    }
                }
                results.push({
                    id: key,
                    summary,
                    preferences: prefs,
                    result: candidateResult
                });
            } catch (error) {
                console.error('Scenario evaluation failed', error);
            }
        }

        if (!results.length) {
            return { message: 'Inga alternativa strategier som uppfyller minimiinkomsten hittades.' };
        }

        const byRemaining = [...results].sort((a, b) => {
            if (b.summary.totalRemainingDays !== a.summary.totalRemainingDays) {
                return b.summary.totalRemainingDays - a.summary.totalRemainingDays;
            }
            return b.summary.weightedAverageIncome - a.summary.weightedAverageIncome;
        });
        const bestRemaining = byRemaining[0] || null;

        const byIncome = [...results].sort((a, b) => {
            const incomeA = Math.round(toFiniteNumber(a.summary.totalIncome));
            const incomeB = Math.round(toFiniteNumber(b.summary.totalIncome));
            if (incomeB !== incomeA) {
                return incomeB - incomeA;
            }
            const avgIncomeA = toFiniteNumber(a.summary.weightedAverageIncome);
            const avgIncomeB = toFiniteNumber(b.summary.weightedAverageIncome);
            if (avgIncomeB !== avgIncomeA) {
                return avgIncomeB - avgIncomeA;
            }
            return toFiniteNumber(b.summary.totalRemainingDays) - toFiniteNumber(a.summary.totalRemainingDays);
        });
        let bestIncome = byIncome[0] || null;
        if (bestIncome && bestRemaining && bestIncome.id === bestRemaining.id) {
            bestIncome = byIncome.find(candidate => candidate.id !== bestRemaining.id) || null;
        }

        const boxes = [];

        if (bestRemaining) {
            boxes.push({
                title: 'Strategi – Fler dagar kvar',
                type: 'remainingDays',
                summary: bestRemaining.summary,
                description: 'Fokuserar på att frigöra fler dagar samtidigt som minimiinkomsten uppnås.',
                preferences: bestRemaining.preferences,
                result: bestRemaining.result
            });
        } else {
            boxes.push({
                title: 'Strategi – Fler dagar kvar',
                message: 'Ingen alternativ fördelning med fler dagar kvar hittades.'
            });
        }

        if (bestIncome) {
            boxes.push({
                title: 'Strategi – Maximera inkomst',
                type: 'income',
                summary: bestIncome.summary,
                description: 'Fokuserar på att maximera hushållets inkomst inom ramen för minimiinkomsten.',
                preferences: bestIncome.preferences,
                result: bestIncome.result
            });
        } else {
            boxes.push({
                title: 'Strategi – Maximera inkomst',
                message: 'Ingen alternativ fördelning med högre inkomst hittades.'
            });
        }

        return { boxes };
    };

    const handleOptimizationAssistance = () => {
        if (cachedSuggestions) {
            renderSuggestions(cachedSuggestions);
            return;
        }
        const defaultLabel = 'Hjälp mig att optimera';
        const loadingLabel = 'Beräknar förslag...';
        assistanceButton.disabled = true;
        assistanceButton.classList.add('loading');
        assistanceButton.textContent = loadingLabel;
        setTimeout(() => {
            let data;
            try {
                data = evaluateOptimizationAlternatives();
            } catch (error) {
                console.error('Failed to build optimization suggestions', error);
                data = { message: 'Det gick inte att ta fram optimeringsförslag. Försök igen.' };
            }
            cachedSuggestions = data;
            renderSuggestions(data);
            assistanceButton.disabled = false;
            assistanceButton.classList.remove('loading');
            assistanceButton.textContent = defaultLabel;
        }, 50);
    };

    assistanceButton.addEventListener('click', handleOptimizationAssistance);

    messageDiv.innerHTML = buildFeasibilityHtml();
    initializeFeasibilityToggle(messageDiv);
    const totalIncomeDisplay = document.createElement('div');
    totalIncomeDisplay.className = 'total-income-display';
    if (baselineIncomeTotal != null && Number.isFinite(baselineIncomeTotal)) {
        totalIncomeDisplay.innerHTML = `Total inkomst under perioden:<br><span class="total-income-value">${baselineIncomeTotal.toLocaleString('sv-SE')} sek</span>`;
    } else {
        totalIncomeDisplay.innerHTML = 'Total inkomst under perioden:<br><span class="total-income-value">–</span>';
    }
    ganttChart.appendChild(messageDiv);
    ganttChart.appendChild(totalIncomeDisplay);
    ganttChart.appendChild(assistanceButton);
    ganttChart.appendChild(suggestionsContainer);
    ganttChart.appendChild(canvas);
    ganttChart.appendChild(summaryBox);

    const highlightPlugin = {
        id: 'highlightPlugin',
        beforeDatasetsDraw: chart => {
            if (!minIncomeRequirement || !highlightRanges.length) {
                return;
            }
            const { ctx, chartArea, scales } = chart;
            if (!chartArea) {
                return;
            }
            const xScale = scales?.x;
            if (!xScale) {
                return;
            }
            ctx.save();
            highlightRanges.forEach(range => {
                const color = highlightColors[range.severity];
                if (!color) {
                    return;
                }
                const startValue = Math.max(range.start, xScale.min);
                const endValue = Math.min(range.end + 1, (xScale.max ?? range.end) + 1);
                const startPixel = xScale.getPixelForValue(startValue);
                const endPixel = xScale.getPixelForValue(endValue);
                const width = endPixel - startPixel;
                if (width <= 0) {
                    return;
                }
                ctx.fillStyle = color;
                ctx.fillRect(startPixel, chartArea.top, width, chartArea.bottom - chartArea.top);
            });
            ctx.restore();
        }
    };

    const minIncomeLinePlugin = {
        id: 'minIncomeLinePlugin',
        afterDatasetsDraw: chart => {
            if (!minIncomeRequirement) {
                return;
            }

            const { ctx, chartArea, scales } = chart;
            if (!ctx || !chartArea) {
                return;
            }

            const yScale = scales?.y;
            if (!yScale) {
                return;
            }

            const yPosition = yScale.getPixelForValue(minIncomeRequirement);
            if (Number.isNaN(yPosition) || yPosition < chartArea.top || yPosition > chartArea.bottom) {
                return;
            }

            ctx.save();
            ctx.setLineDash([6, 6]);
            ctx.strokeStyle = 'rgba(220, 0, 0, 0.8)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(chartArea.left, yPosition);
            ctx.lineTo(chartArea.right, yPosition);
            ctx.stroke();

            ctx.setLineDash([]);
            ctx.restore();
        }
    };

    const dragPlugin = {
        id: 'dragPlugin',
        afterInit: (chart) => {
            if (shouldAggregatePoints) {
                return;
            }
            chart.canvas.addEventListener('mousedown', (e) => {
                const points = chart.getElementsAtEventForMode(e, 'nearest', { intersect: true }, false);
                if (points.length) {
                    const point = points[0];
                    const dataIndex = point.index;
                    const draggablePoint = displayDraggables.find(p => p.displayIndex === dataIndex);
                    if (draggablePoint) {
                        chart.dragging = { point: draggablePoint, displayIndex: dataIndex };
                        chart.dragStartX = e.clientX;
                    }
                }
            });

            chart.canvas.addEventListener('mousemove', (e) => {
                if (chart.dragging) {
                    const deltaX = (e.clientX - chart.dragStartX) / chart.scales.x.width * (chart.scales.x.max - chart.scales.x.min);
                    const sourceIndex = chart.dragging.point.sourceIndex;
                    const newX = Math.round(inkomstData[sourceIndex].x + deltaX);
                    const minX = dadLeaveDurationWeeks;
                    const maxX = totalaWeeks - period2TotalWeeks - 1;

                    if (chart.dragging.point.type === 'period1End') {
                        const newPeriod1Weeks = Math.max(minX, Math.min(newX + 1, maxX));
                        period1TotalWeeks = newPeriod1Weeks;
                        const period1EndDate = new Date(period1Start);
                        period1EndDate.setDate(period1EndDate.getDate() + (period1TotalWeeks * 7) - 1);
                        const period2StartDate = new Date(period1EndDate);
                        period2StartDate.setDate(period2StartDate.getDate() + 1);
                        const period2EndDate = new Date(period2StartDate);
                        period2EndDate.setDate(period2EndDate.getDate() + (period2TotalWeeks * 7) - 1);

                        const period1TotalDays = period1TotalWeeks * safeDagarPerVecka(plan1.dagarPerVecka);
                        const daysAvailable = förälder1InkomstDagar + förälder1MinDagar;
                        if (period1TotalDays > daysAvailable) {
                            period1TotalWeeks = Math.floor(daysAvailable / safeDagarPerVecka(plan1.dagarPerVecka));
                        }

                        const period1IncomeDaysUsed = Math.min(period1TotalDays, förälder1InkomstDagar);
                        const period1NoExtraAdjustedWeeks = 0;
                        const period1MinAdjustedWeeks = period1TotalDays > period1IncomeDaysUsed ? Math.round((period1TotalDays - period1IncomeDaysUsed) / safeDagarPerVecka(plan1.dagarPerVecka)) : 0;

                        const period2TotalDays = period2TotalWeeks * safeDagarPerVecka(plan2.dagarPerVecka);
                        const period2IncomeDaysUsed = Math.min(period2TotalDays, förälder2InkomstDagar);
                        const period2NoExtraAdjustedWeeks = 0;
                        const period2MinAdjustedWeeks = period2TotalDays > period2IncomeDaysUsed ? Math.round((period2TotalDays - period2IncomeDaysUsed) / safeDagarPerVecka(plan2.dagarPerVecka)) : 0;

                        generateInkomstData();
                        buildDisplayData();
                        normalizeSelectedPointIndex();
                        chart.data.datasets[0].data = pointDisplayData;
                        chart.data.datasets[0].pointBackgroundColor = getPointBackgroundColors();
                        chart.data.datasets[0].pointBorderColor = getPointBorderColors();
                        chart.data.datasets[0].pointBorderWidth = getPointBorderWidths();
                        chart.data.datasets[0].pointRadius = pointDisplayData.map((_, index) => displayDraggables.some(p => p.displayIndex === index) ? activePointRadius : basePointRadius);
                        chart.data.datasets[0].pointHoverRadius = pointDisplayData.map((_, index) => displayDraggables.some(p => p.displayIndex === index) ? hoverPointRadius : activePointRadius);
                        chart.update();
                        summaryBox.innerHTML = formatSummaryData(selectedPointIndex);
                        updateMessage();
                    }
                }
            });

            chart.canvas.addEventListener('mouseup', () => {
                if (chart.dragging) {
                    chart.dragging = null;
                    updateMessage();
                }
            });

            chart.canvas.addEventListener('mouseleave', () => {
                if (chart.dragging) {
                    chart.dragging = null;
                    updateMessage();
                }
            });
        }
    };

    function updateMessage() {
        messageDiv.innerHTML = buildFeasibilityHtml();
        initializeFeasibilityToggle(messageDiv);
    }

    // Reusable function to format tooltip/summary data
    function formatSummaryData(index) {
        if (index == null || !pointDisplayData[index]) {
            return '<p>Välj en punkt för att se detaljer.</p>';
        }
        const data = pointDisplayData[index];
        const fallbackIndex = Number.isFinite(data?.startWeekIndex)
            ? Math.max(0, Math.round(data.startWeekIndex))
            : index;
        const weekLabel = data.displayLabel || weekLabels[fallbackIndex] || 'Okänd vecka';
        let requiresFootnote = false;
        const formatIncomeLine = (label, value, applyAsterisk = false) => {
            const needsAsterisk = applyAsterisk && value > 0;
            if (needsAsterisk) {
                requiresFootnote = true;
            }
            const suffix = needsAsterisk ? '* ' : '';
            return `  ${label}${suffix}: ${value.toLocaleString()} kr/månad<br>`;
        };

        let html =
            `<div class="summary-section"><strong>${weekLabel}</strong><br>` +
            `Period: ${data.periodLabel || 'Okänd period'}</div>`;
        const combinedClass = `${getIncomeHighlightClass(data.y)} combined-income`.trim();
        html +=
            `<div class="summary-section">Total inkomst: ` +
            `<span class="${combinedClass}">${data.y.toLocaleString()} kr/månad</span></div>`;
        html +=
            `<div class="summary-section"><strong>Förälder 1</strong>: ` +
            `${data.förälder1Inkomst.toLocaleString()} kr/månad<br>`;
        html += formatIncomeLine('Föräldrapenning', data.förälder1Components.fp, true);
        html += formatIncomeLine('Föräldralön', data.förälder1Components.extra, true);
        html += formatIncomeLine('Lön', data.förälder1Components.lön, true);
        html += '</div>';
        const showParent2 = vårdnad !== 'ensam' && beräknaPartner === 'ja';
        if (showParent2) {
            html +=
                `<div class="summary-section"><strong>Förälder 2</strong>: ` +
                `${data.förälder2Inkomst.toLocaleString()} kr/månad<br>`;
            html += formatIncomeLine('Föräldrapenning', data.förälder2Components.fp, true);
            html += formatIncomeLine('Föräldralön', data.förälder2Components.extra, true);
            html += formatIncomeLine('Lön', data.förälder2Components.lön, true);
            html += '</div>';
        }
        if (requiresFootnote) {
            html += '<div class="summary-footnote" style="position: absolute; left: 10px; bottom: 10px; font-size: 0.75em; color: #777; text-align: left;">* Estimerad nettoinkomst baserad på 30% skatt</div>';
        }
        return html;
    }

    // Custom plugin for summary box updates
    const summaryPlugin = {
        id: 'summaryPlugin',
        afterInit: (chart) => {
            let lastHoveredIndex = null;
            chart.canvas.addEventListener('mousemove', (e) => {
                const points = chart.getElementsAtEventForMode(e, 'nearest', { intersect: true }, false);
                if (points.length) {
                    const point = points[0];
                    lastHoveredIndex = point.index;
                    summaryBox.innerHTML = formatSummaryData(lastHoveredIndex);
                }
            });
            chart.canvas.addEventListener('mouseleave', () => {
                summaryBox.innerHTML = formatSummaryData(selectedPointIndex);
            });
            chart.canvas.addEventListener('click', (e) => {
                const points = chart.getElementsAtEventForMode(e, 'nearest', { intersect: true }, false);
                if (!points.length) {
                    return;
                }
                const point = points[0];
                selectedPointIndex = point.index;
                normalizeSelectedPointIndex();
                const dataset = chart.data.datasets[0];
                dataset.pointBorderColor = getPointBorderColors();
                dataset.pointBorderWidth = getPointBorderWidths();
                summaryBox.innerHTML = formatSummaryData(selectedPointIndex);
                chart.update();
            });
        }
    };

    const ctx = canvas.getContext('2d');
    const maxIncomeValue = inkomstData.length
        ? Math.max(...inkomstData.map(d => d.y))
        : 0;

    new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [{
                label: includePartner ? 'Kombinerad Inkomst (kr/månad)' : 'Inkomst (kr/månad)',
                data: pointDisplayData,
                borderWidth: 2,
                fill: false,
                pointRadius: pointDisplayData.map((_, index) => displayDraggables.some(p => p.displayIndex === index) ? activePointRadius : basePointRadius),
                pointHoverRadius: pointDisplayData.map((_, index) => displayDraggables.some(p => p.displayIndex === index) ? hoverPointRadius : activePointRadius),
                segment: {
                    borderColor: ctx => getPeriodColor(ctx.p0.parsed.x),
                    backgroundColor: ctx => getPeriodColor(ctx.p0.parsed.x)
                },
                pointBackgroundColor: getPointBackgroundColors(),
                pointBorderColor: getPointBorderColors(),
                pointBorderWidth: getPointBorderWidths()
            }]
        },
        options: {
            scales: {
                x: {
                    type: 'linear',
                    min: 0,
                    max: totalaWeeks - 1,
                    ticks: {
                        stepSize: 1,
                        autoSkip: false,
                        maxTicksLimit: 60,
                        callback: function(value) {
                            const index = Math.round(value);
                            return monthLabels[index] || '';
                        },
                        font: function(context) {
                            const value = context?.tick?.value;
                            const index = Math.round(typeof value === 'number' ? value : 0);
                            return {
                                size: 12,
                                weight: index >= 0 && index < monthLabels.length && monthLabels[index] ? 'bold' : 'normal'
                            };
                        }
                    },
                    title: { display: true, text: 'Tid (Månad)' }
                },
                y: {
                    position: 'right',
                    min: 0,
                    suggestedMax: Math.max(
                        maxIncomeValue,
                        minIncomeRequirement || 0
                    ) * 1.1,
                    title: { display: true, text: 'Inkomst (kr/månad)' },
                    grid: { drawOnChartArea: true },
                    ticks: {
                        callback: function(value) {
                            return value.toLocaleString() + ' kr';
                        }
                    }
                }
            },
            plugins: {
                legend: {
                    display: legendEntries.length > 0,
                    position: 'bottom',
                    align: 'center',
                    labels: {
                        generateLabels: () => legendEntries.map(item => ({ ...item }))
                    }
                },
                tooltip: {
                    enabled: false // Disable default tooltip
                }
            }
        },
        plugins: [highlightPlugin, dragPlugin, summaryPlugin, minIncomeLinePlugin]
    });
}
