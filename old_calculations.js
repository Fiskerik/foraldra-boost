/**
 * calculations.js - Calculation logic for the Föräldrapenningkalkylator
 * Handles parental benefit calculations, child allowances, and leave optimization.
 */
import {
    INCOME_CAP,
    SGI_CAP,
    MINIMUM_RATE,
    DEFAULT_BARNBIDRAG,
    PRISBASBELOPP,
    GRUNDNIVÅ
} from './config.js';

/**
 * Determine parental leave day distribution based on custody and expected children.
 * @param {string} vårdnadstyp - 'gemensam' or 'ensam'
 * @param {number} expectedChildren - Number of children in the upcoming birth
 * @returns {{
 *  parent1: { incomeDays: number, lowDays: number },
 *  parent2: { incomeDays: number, lowDays: number },
 *  total: { incomeDays: number, lowDays: number }
 * }}
 */
export function calculateParentalLeaveDays(vårdnadstyp, expectedChildren = 1) {
    const normalizedCustody = (vårdnadstyp || 'gemensam').toLowerCase() === 'ensam'
        ? 'ensam'
        : 'gemensam';
    const parsedChildren = Number(expectedChildren);
    const plannedChildren = Number.isFinite(parsedChildren)
        ? Math.max(1, Math.round(parsedChildren))
        : 1;

    let totalIncomeDays = 390;
    let totalLowDays = 90;

    if (plannedChildren === 2) {
        totalIncomeDays = 480;
        totalLowDays = 180;
    } else if (plannedChildren === 3) {
        totalIncomeDays = 660;
        totalLowDays = 180;
    }

    const total = { incomeDays: totalIncomeDays, lowDays: totalLowDays };

    if (normalizedCustody === 'ensam') {
        return {
            parent1: { incomeDays: totalIncomeDays, lowDays: totalLowDays },
            parent2: { incomeDays: 0, lowDays: 0 },
            total
        };
    }

    const parent1IncomeDays = Math.round(totalIncomeDays / 2);
    const parent2IncomeDays = totalIncomeDays - parent1IncomeDays;
    const parent1LowDays = Math.round(totalLowDays / 2);
    const parent2LowDays = totalLowDays - parent1LowDays;

    return {
        parent1: { incomeDays: parent1IncomeDays, lowDays: parent1LowDays },
        parent2: { incomeDays: parent2IncomeDays, lowDays: parent2LowDays },
        total
    };
}

function parseNonNegativeNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function resolveLeaveDayAllocation(inputs = {}) {
    const custodyValue = typeof inputs.vårdnad === 'string' && inputs.vårdnad.toLowerCase() === 'ensam'
        ? 'ensam'
        : 'gemensam';
    const plannedChildren = Math.max(1, parseNonNegativeNumber(inputs.planeradeBarn) ?? 1);
    const baseAllocation = calculateParentalLeaveDays(custodyValue, plannedChildren);

    const parent1Income = parseNonNegativeNumber(inputs.förälder1InkomstDagar);
    const parent2Income = parseNonNegativeNumber(inputs.förälder2InkomstDagar);
    const parent1Low = parseNonNegativeNumber(inputs.förälder1MinDagar);
    const parent2Low = parseNonNegativeNumber(inputs.förälder2MinDagar);

    return {
        förälder1InkomstDagar: parent1Income ?? baseAllocation.parent1.incomeDays,
        förälder2InkomstDagar: parent2Income ?? baseAllocation.parent2.incomeDays,
        förälder1MinDagar: parent1Low ?? baseAllocation.parent1.lowDays,
        förälder2MinDagar: parent2Low ?? baseAllocation.parent2.lowDays
    };
}

function applyMinimumLevelDayUsage(options) {
    const {
        requestedWeeks1,
        requestedWeeks2,
        baseDaysPerWeek1,
        baseDaysPerWeek2,
        includePartner,
        minIncomeRequirement,
        barnbidrag,
        tillägg,
        arbetsInkomst1,
        arbetsInkomst2,
        användaInkomstDagar1,
        användaInkomstDagar2,
        användaMinDagar1,
        användaMinDagar2,
        förälder1MinDagar,
        förälder2MinDagar,
        plan1,
        plan1MinDagar,
        plan2,
        plan2MinDagar
    } = options;

    const toDays = value => Math.max(0, Math.round(Number(value) || 0));

    const safeRequestedWeeks1 = Math.max(0, Math.round(Number(requestedWeeks1) || 0));
    const safeRequestedWeeks2 = Math.max(0, Math.round(Number(requestedWeeks2) || 0));

    const safeBaseDays1 = Math.max(0, Math.round(Number(baseDaysPerWeek1) || 0));
    const safeBaseDays2 = Math.max(0, Math.round(Number(baseDaysPerWeek2) || 0));

    const evaluateAllowance = (baseDays, partnerIncome) => {
        if (baseDays <= 0) {
            return false;
        }
        if (minIncomeRequirement <= 0) {
            return true;
        }
        const combinedIncome = beräknaMånadsinkomst(
            MINIMUM_RATE,
            baseDays,
            0,
            barnbidrag,
            tillägg
        ) + partnerIncome;
        return combinedIncome >= minIncomeRequirement;
    };

    const allowMin1 = evaluateAllowance(safeBaseDays1, arbetsInkomst2);
    const allowMin2 = includePartner
        ? evaluateAllowance(safeBaseDays2, arbetsInkomst1)
        : false;

    const targetDays1 = allowMin1 ? safeRequestedWeeks1 * Math.max(safeBaseDays1, 1) : 0;
    const targetDays2 = allowMin2 ? safeRequestedWeeks2 * Math.max(safeBaseDays2, 1) : 0;

    const currentUsedIncome1 = toDays(användaInkomstDagar1);
    const currentUsedIncome2 = toDays(användaInkomstDagar2);
    const currentUsedMin1 = toDays(användaMinDagar1);
    const currentUsedMin2 = toDays(användaMinDagar2);

    let remainingDemand1 = Math.max(0, targetDays1 - (currentUsedIncome1 + currentUsedMin1));
    let remainingDemand2 = Math.max(0, targetDays2 - (currentUsedIncome2 + currentUsedMin2));

    const availableMin1 = toDays(förälder1MinDagar);
    const availableMin2 = toDays(förälder2MinDagar);

    const ownUse1 = Math.min(remainingDemand1, availableMin1);
    const ownUse2 = Math.min(remainingDemand2, availableMin2);

    remainingDemand1 -= ownUse1;
    remainingDemand2 -= ownUse2;

    let leftover1 = availableMin1 - ownUse1;
    let leftover2 = availableMin2 - ownUse2;

    let transferTo1 = 0;
    let transferTo2 = 0;

    if (includePartner && remainingDemand1 > 0 && leftover2 > 0) {
        transferTo1 = Math.min(remainingDemand1, leftover2);
        remainingDemand1 -= transferTo1;
        leftover2 -= transferTo1;
    }

    if (includePartner && remainingDemand2 > 0 && leftover1 > 0) {
        transferTo2 = Math.min(remainingDemand2, leftover1);
        remainingDemand2 -= transferTo2;
        leftover1 -= transferTo2;
    }

    const totalMinUse1 = currentUsedMin1 + ownUse1 + transferTo1;
    const totalMinUse2 = currentUsedMin2 + ownUse2 + transferTo2;

    const remainingMin1 = Math.max(0, availableMin1 - ownUse1 - transferTo2);
    const remainingMin2 = Math.max(0, availableMin2 - ownUse2 - transferTo1);

    const updatePlanWithMinDays = (plan, minPlan, baseDays, totalUse) => {
        if (!plan || !minPlan) {
            return;
        }
        const effectiveDaysPerWeek = Math.max(1, baseDays);
        if (totalUse > 0 && effectiveDaysPerWeek > 0) {
            const weeks = totalUse / effectiveDaysPerWeek;
            minPlan.weeks = weeks;
            minPlan.dagarPerVecka = effectiveDaysPerWeek;
            minPlan.inkomst = Math.round(
                beräknaMånadsinkomst(
                    MINIMUM_RATE,
                    effectiveDaysPerWeek,
                    0,
                    barnbidrag,
                    tillägg
                )
            );
            minPlan.användaMinDagar = totalUse;
        } else {
            minPlan.weeks = 0;
            minPlan.inkomst = 0;
            minPlan.användaMinDagar = 0;
        }
        plan.användaMinDagar = totalUse;
    };

    updatePlanWithMinDays(plan1, plan1MinDagar, safeBaseDays1, totalMinUse1);

    if (includePartner) {
        updatePlanWithMinDays(plan2, plan2MinDagar, safeBaseDays2, totalMinUse2);
    } else if (plan2MinDagar) {
        plan2MinDagar.weeks = 0;
        plan2MinDagar.inkomst = 0;
        plan2MinDagar.användaMinDagar = 0;
    }

    return {
        användaMinDagar1: totalMinUse1,
        användaMinDagar2: includePartner ? totalMinUse2 : currentUsedMin2,
        förälder1MinDagar: remainingMin1,
        förälder2MinDagar: includePartner ? remainingMin2 : availableMin2
    };
}

/**
 * Calculate monthly net income based on daily rate, days per week, and additional benefits
 * @param {number} dag - Daily parental benefit rate
 * @param {number} dagarPerVecka - Days per week taken
 * @param {number} extra - Parental supplement
 * @param {number} barnbidrag - Child allowance
 * @param {number} tillägg - Additional child allowance
 * @returns {number} Rounded monthly net income
 */
export function beräknaMånadsinkomst(dag, dagarPerVecka, extra, barnbidrag = DEFAULT_BARNBIDRAG, tillägg = 0) {
    const fp = Math.round((dag * dagarPerVecka * 4.3) / 100) * 100;
    const extraBelopp = extra ? Math.round(extra * (dagarPerVecka / 7)) : 0;
    const resultat = beräknaNetto(fp) + beräknaNetto(extraBelopp);
    void barnbidrag;
    void tillägg;
    return resultat || 0;
}

/**
 * Calculate daily parental benefit based on monthly income
 * @param {number} inkomst - Monthly income
 * @returns {number} Daily benefit rate
 */
export function beräknaDaglig(inkomst) {
    if (!inkomst || inkomst <= 0) return 0;
    if (inkomst < 9800) {
        return GRUNDNIVÅ;
    }
    const sgi = Math.min(inkomst, SGI_CAP);
    const calculatedDailyRate = Math.round((sgi * 0.8 * 12) / 365);
    const justeratBelopp = Math.max(calculatedDailyRate, MINIMUM_RATE);
    return Math.min(justeratBelopp, INCOME_CAP);
}

/**
 * Calculate employer-provided parental salary supplement
 * @param {number} inkomst - Monthly income
 * @returns {number} Monthly parental supplement
 */
export function beräknaFöräldralön(inkomst) {
    if (!inkomst || inkomst <= 0) return 0;

    const årsinkomst = inkomst * 12;
    const gräns = PRISBASBELOPP * 10;

    if (årsinkomst <= gräns) {
        return Math.round((årsinkomst * 0.10) / 12);
    }

    const basal = gräns * 0.10;
    const över = (årsinkomst - gräns) * 0.90;
    return Math.round((basal + över) / 12);
}

/**
 * Calculate net monthly income from gross and tax rate
 * @param {number} inkomst - Gross monthly income
 * @param {number} skattesats - Tax rate percentage (default 30)
 * @returns {number} Net monthly income
 */
export function beräknaNetto(inkomst, skattesats = 30) {
    if (!inkomst || inkomst <= 0) return 0;
    const rate = skattesats / 100;
    return Math.round(inkomst * (1 - rate));
}

/**
 * Calculate child allowance and additional benefits
 * @param {number} totalBarn - Total number of children
 * @param {boolean} ensamVårdnad - True if sole custody
 * @returns {Object} Object with barnbidrag, tillägg, total, and details
 */
export function beräknaBarnbidrag(totalBarn, ensamVårdnad) {
    void totalBarn;
    void ensamVårdnad;
    return {
        barnbidrag: 0,
        tillägg: 0,
        total: 0,
        details: ''
    };
}

/**
 * Optimize parental leave based on preferences and inputs
 * @param {Object} preferences - User preferences (deltid, ledigTid1, etc.)
 * @param {Object} inputs - Input data (inkomst1, vårdnad, etc.)
 * @returns {Object} Optimized leave plans and related data
 */
function optimizeParentalLeaveLegacy(preferences, inputs) {
    const { deltid, ledigTid1, ledigTid2 = 0, minInkomst, strategy } = preferences;
    const includePartner = inputs.vårdnad === "gemensam" && inputs.beräknaPartner === "ja";
    const desiredWeeks1 = Math.max(0, Math.round((Number(ledigTid1) || 0) * 4.3));
    const desiredWeeks2 = Math.max(0, Math.round((Number(ledigTid2) || 0) * 4.3));
    let plan1 = { startWeek: 0, weeks: 0, dagarPerVecka: 0, inkomst: 0, inkomstUtanExtra: 0, användaInkomstDagar: 0, användaMinDagar: 0 };
    let plan1NoExtra = { startWeek: 0, weeks: 0, dagarPerVecka: 0, inkomst: 0, användaInkomstDagar: 0 };
    let plan2 = { startWeek: 0, weeks: 0, dagarPerVecka: 0, inkomst: 0, inkomstUtanExtra: 0, användaInkomstDagar: 0, användaMinDagar: 0 };
    let plan2NoExtra = { startWeek: 0, weeks: 0, dagarPerVecka: 0, inkomst: 0, användaInkomstDagar: 0 };
    let plan1MinDagar = { startWeek: 0, weeks: 0, dagarPerVecka: 0, inkomst: 0, användaMinDagar: 0 };
    let plan2MinDagar = { startWeek: 0, weeks: 0, dagarPerVecka: 0, inkomst: 0, användaMinDagar: 0 };
    let plan1Overlap = {
        startWeek: 0,
        weeks: 2,
        dagarPerVecka: 0,
        inkomst: 0,
        inkomstUtanExtra: 0
    };
    let plan1ExtraWeeks = 0;
    let plan1NoExtraWeeksTotal = 0;
    let plan2ExtraWeeks = 0;
    let plan2NoExtraWeeksTotal = 0;
    let genomförbarhet = {
        ärGenomförbar: true,
        meddelande: "",
        transferredDays: 0,
        status: "ok",
        minInkomst: minInkomst,
        maxShortfallRatio: 0
    };

    const updateStatusFromSeverity = severity => {
        if (severity === "error") {
            genomförbarhet.status = "error";
        } else if (severity === "warning" && genomförbarhet.status !== "error") {
            genomförbarhet.status = "warning";
        }
    };

    const evaluateIncomeSeverity = income => {
        if (minInkomst <= 0 || income >= minInkomst) {
            return null;
        }
        const diff = minInkomst - income;
        const ratio = minInkomst > 0 ? diff / minInkomst : 0;
        const severity = ratio > 0.10 ? "error" : "warning";
        if (ratio > genomförbarhet.maxShortfallRatio) {
            genomförbarhet.maxShortfallRatio = ratio;
        }
        return severity;
    };

    const barnbidrag = 0;
    const tillägg = 0;

    const inkomst1 = Number(inputs.inkomst1) || 0;
    const inkomst2 = Number(inputs.inkomst2) || 0;

    if (isNaN(inkomst1) || isNaN(inkomst2) || isNaN(ledigTid1) || isNaN(ledigTid2)) {
        throw new Error("Invalid input values: incomes and leave durations must be numbers.");
    }

    const anst1 = inputs.anställningstid1 || "";
    const anst2 = inputs.anställningstid2 || "";
    const avtal1Ja = inputs.avtal1 === "ja" || inputs.avtal1 === true;
    const avtal2Ja = inputs.avtal2 === "ja" || inputs.avtal2 === true;
    const dag1 = beräknaDaglig(inkomst1);
    const extra1 = avtal1Ja && anst1 !== "0-5" ? beräknaFöräldralön(inkomst1) : 0;
    const dag2 = inkomst2 > 0 ? beräknaDaglig(inkomst2) : 0;
    const extra2 = avtal2Ja && anst2 !== "0-5" ? beräknaFöräldralön(inkomst2) : 0;

    const maxFöräldralönWeeks1 = avtal1Ja
        ? anst1 === "6-12" ? 2 * 4.3 : anst1 === ">1" ? 6 * 4.3 : 0
        : 0;
    const maxFöräldralönWeeks2 = avtal2Ja
        ? anst2 === "6-12" ? 2 * 4.3 : anst2 === ">1" ? 6 * 4.3 : 0
        : 0;
    let unusedFöräldralönWeeks1 = 0;
    let unusedFöräldralönWeeks2 = 0;

    const leaveAllocation = resolveLeaveDayAllocation(inputs);
    let förälder1InkomstDagar = leaveAllocation.förälder1InkomstDagar;
    let förälder2InkomstDagar = leaveAllocation.förälder2InkomstDagar;
    let förälder1MinDagar = leaveAllocation.förälder1MinDagar;
    let förälder2MinDagar = leaveAllocation.förälder2MinDagar;
    let användaInkomstDagar1 = 0;
    let användaInkomstDagar2 = 0;
    let användaMinDagar1 = 0;
    let användaMinDagar2 = 0;

    const arbetsInkomst1 = beräknaNetto(inkomst1);
    const arbetsInkomst2 = inkomst2 > 0 ? beräknaNetto(inkomst2) : 0;

    let dagarPerVecka1 = 0;
    let dagarPerVecka1NoExtra = 0;
    let dagarPerVecka2 = 0;
    let weeks1 = desiredWeeks1;
    let weeks2 = desiredWeeks2;
    let inkomst1Result = arbetsInkomst1;
    let inkomst2Result = arbetsInkomst2;
    let kombineradInkomst = 0;

    const maxDagarPerVecka = deltid === "ja" ? 5 : 7;
    if (strategy === "maximize") {
        dagarPerVecka1 = weeks1 > 0 ? maxDagarPerVecka : 0;
        dagarPerVecka2 =
            inputs.vårdnad === "gemensam" && inputs.beräknaPartner === "ja" && weeks2 > 0
                ? maxDagarPerVecka
                : 0;
    } else {
        dagarPerVecka1 = weeks1 > 0 ? 1 : 0;
        dagarPerVecka2 =
            inputs.vårdnad === "gemensam" && inputs.beräknaPartner === "ja" && weeks2 > 0 ? 1 : 0;
    }

    let totalDagarBehövda1 = weeks1 * dagarPerVecka1;
    let totalDagarBehövda2 = weeks2 * dagarPerVecka2;

    if (includePartner && totalDagarBehövda1 > förälder1InkomstDagar) {
        const minDagarBehövda2 = weeks2 * dagarPerVecka2;
        const överförbaraDagar2 = Math.max(0, förälder2InkomstDagar - 90 - minDagarBehövda2 - 10);
        const överförDagar = Math.min(överförbaraDagar2, totalDagarBehövda1 - förälder1InkomstDagar);
        förälder2InkomstDagar -= överförDagar;
        förälder1InkomstDagar += överförDagar;
        totalDagarBehövda1 = weeks1 * dagarPerVecka1;
        genomförbarhet.transferredDays += överförDagar;
    }

    if (totalDagarBehövda1 > förälder1InkomstDagar) {
        dagarPerVecka1 = Math.max(1, Math.floor(förälder1InkomstDagar / weeks1));
        totalDagarBehövda1 = weeks1 * dagarPerVecka1;
        if (totalDagarBehövda1 > förälder1InkomstDagar) {
            totalDagarBehövda1 = förälder1InkomstDagar;
            weeks1 = Math.floor(totalDagarBehövda1 / dagarPerVecka1) || 1;
        }
    }

    if (includePartner && totalDagarBehövda2 > förälder2InkomstDagar) {
        dagarPerVecka2 = Math.max(1, Math.floor(förälder2InkomstDagar / weeks2));
        totalDagarBehövda2 = weeks2 * dagarPerVecka2;
        if (totalDagarBehövda2 > förälder2InkomstDagar) {
            totalDagarBehövda2 = förälder2InkomstDagar;
            weeks2 = Math.floor(totalDagarBehövda2 / dagarPerVecka2) || 1;
        }
    }

    // Step 1: Allocate for Parent 1
    if (weeks1 > 0) {
        inkomst1Result = beräknaMånadsinkomst(dag1, dagarPerVecka1, extra1, barnbidrag, tillägg);
        inkomst2Result = arbetsInkomst2;
        kombineradInkomst = inkomst1Result + inkomst2Result;

        if (strategy === "longer") {
            while (kombineradInkomst < minInkomst && dagarPerVecka1 < maxDagarPerVecka) {
                dagarPerVecka1++;
                inkomst1Result = beräknaMånadsinkomst(dag1, dagarPerVecka1, extra1, barnbidrag, tillägg);
                kombineradInkomst = inkomst1Result + inkomst2Result;
            }
        }
        if (kombineradInkomst < minInkomst && dagarPerVecka1 < 7) {
            const möjligaDagar = Math.min(7, Math.floor(förälder1InkomstDagar / weeks1));
            if (möjligaDagar > dagarPerVecka1) {
                dagarPerVecka1 = möjligaDagar;
                inkomst1Result = beräknaMånadsinkomst(dag1, dagarPerVecka1, extra1, barnbidrag, tillägg);
                kombineradInkomst = inkomst1Result + inkomst2Result;
            }
        }
        if (kombineradInkomst < minInkomst) {
            genomförbarhet.ärGenomförbar = false;
            const severity = evaluateIncomeSeverity(kombineradInkomst);
            updateStatusFromSeverity(severity || "warning");
            genomförbarhet.meddelande =
                `Kombinerad inkomst ${kombineradInkomst.toLocaleString()} kr/månad i fas 1 är under kravet ${minInkomst.toLocaleString()} kr/månad (med ${dagarPerVecka1} dagar/vecka).`;
        }
        totalDagarBehövda1 = weeks1 * dagarPerVecka1;
        if (inputs.vårdnad === "gemensam" && inputs.beräknaPartner === "ja" && totalDagarBehövda1 > förälder1InkomstDagar) {
            const minDagarBehövda2 = weeks2 * dagarPerVecka2;
            const överförbaraDagar2 = Math.max(0, förälder2InkomstDagar - 90 - minDagarBehövda2 - 10);
            const överförDagar = Math.min(överförbaraDagar2, totalDagarBehövda1 - förälder1InkomstDagar);
            förälder2InkomstDagar -= överförDagar;
            förälder1InkomstDagar += överförDagar;
            genomförbarhet.transferredDays += överförDagar;
            totalDagarBehövda1 = weeks1 * dagarPerVecka1;
        }
        if (totalDagarBehövda1 > förälder1InkomstDagar) {
            dagarPerVecka1 = Math.max(1, Math.floor(förälder1InkomstDagar / weeks1));
            totalDagarBehövda1 = weeks1 * dagarPerVecka1;
            if (totalDagarBehövda1 > förälder1InkomstDagar) {
                totalDagarBehövda1 = förälder1InkomstDagar;
                weeks1 = Math.floor(totalDagarBehövda1 / dagarPerVecka1) || 1;
            }
        }
    }

    // Step 2: Allocate for Parent 2
    if (inputs.vårdnad === "gemensam" && inputs.beräknaPartner === "ja" && weeks2 > 0) {
        inkomst1Result = arbetsInkomst1;
        inkomst2Result = beräknaMånadsinkomst(dag2, dagarPerVecka2, extra2, barnbidrag, tillägg);
        kombineradInkomst = inkomst1Result + inkomst2Result;

        if (strategy === "longer") {
            while (kombineradInkomst < minInkomst && dagarPerVecka2 < maxDagarPerVecka) {
                dagarPerVecka2++;
                inkomst2Result = beräknaMånadsinkomst(dag2, dagarPerVecka2, extra2, barnbidrag, tillägg);
                kombineradInkomst = inkomst1Result + inkomst2Result;
            }
        }
        if (kombineradInkomst < minInkomst && dagarPerVecka2 < 7) {
            const möjligaDagar = Math.min(7, Math.floor(förälder2InkomstDagar / weeks2));
            if (möjligaDagar > dagarPerVecka2) {
                dagarPerVecka2 = möjligaDagar;
                inkomst2Result = beräknaMånadsinkomst(dag2, dagarPerVecka2, extra2, barnbidrag, tillägg);
                kombineradInkomst = inkomst1Result + inkomst2Result;
            }
        }
        if (kombineradInkomst < minInkomst) {
            genomförbarhet.ärGenomförbar = false;
            const severity = evaluateIncomeSeverity(kombineradInkomst);
            updateStatusFromSeverity(severity || "warning");
            genomförbarhet.meddelande =
                `Kombinerad inkomst ${kombineradInkomst.toLocaleString()} kr/månad i fas 2 är under kravet ${minInkomst.toLocaleString()} kr/månad (med ${dagarPerVecka2} dagar/vecka).`;
        }
        totalDagarBehövda2 = weeks2 * dagarPerVecka2;
        if (totalDagarBehövda2 > förälder2InkomstDagar) {
            dagarPerVecka2 = Math.max(1, Math.floor(förälder2InkomstDagar / weeks2));
            totalDagarBehövda2 = weeks2 * dagarPerVecka2;
            if (totalDagarBehövda2 > förälder2InkomstDagar) {
                totalDagarBehövda2 = förälder2InkomstDagar;
                weeks2 = Math.floor(totalDagarBehövda2 / dagarPerVecka2) || 1;
            }
        }
    }

    const allocateIncomeDays = ({ totalDays, extraWeeks, noExtraWeeks, maxPerWeek, enforceHighExtra }) => {
        const safeExtraWeeks = Math.max(0, Math.round(extraWeeks));
        const safeNoExtraWeeks = Math.max(0, Math.round(noExtraWeeks));

        if (totalDays <= 0 || (safeExtraWeeks === 0 && safeNoExtraWeeks === 0)) {
            return {
                dagarPerVeckaExtra: 0,
                dagarPerVeckaNoExtra: 0,
                usedExtraDays: 0,
                usedNoExtraDays: 0
            };
        }

        const maxExtraDays = safeExtraWeeks * maxPerWeek;
        const maxNoExtraDays = safeNoExtraWeeks * maxPerWeek;
        const baselineNoExtra = safeNoExtraWeeks > 0 ? Math.min(totalDays, safeNoExtraWeeks) : 0;
        let remaining = totalDays - baselineNoExtra;

        let usedExtraDays = 0;
        if (safeExtraWeeks > 0 && remaining > 0) {
            const minExtraPerWeek = enforceHighExtra ? Math.min(maxPerWeek, 5) : 0;
            const minExtraDays = safeExtraWeeks * minExtraPerWeek;
            usedExtraDays = Math.min(maxExtraDays, remaining);
            if (usedExtraDays < minExtraDays && totalDays >= minExtraDays + baselineNoExtra) {
                usedExtraDays = Math.min(maxExtraDays, Math.min(remaining, minExtraDays));
            }
            remaining -= usedExtraDays;
        }

        let usedNoExtraDays = Math.min(Math.max(0, maxNoExtraDays - baselineNoExtra), Math.max(0, remaining));
        remaining -= usedNoExtraDays;
        usedNoExtraDays += baselineNoExtra;

        if (remaining > 0 && safeExtraWeeks > 0 && usedExtraDays < maxExtraDays) {
            const add = Math.min(maxExtraDays - usedExtraDays, remaining);
            usedExtraDays += add;
            remaining -= add;
        }

        if (remaining > 0 && safeNoExtraWeeks > 0 && usedNoExtraDays < maxNoExtraDays) {
            const add = Math.min(maxNoExtraDays - usedNoExtraDays, remaining);
            usedNoExtraDays += add;
            remaining -= add;
        }

        usedExtraDays = Math.round(usedExtraDays);
        usedNoExtraDays = Math.round(usedNoExtraDays);

        const totalDaysInt = Math.max(0, Math.round(totalDays));
        let dagarPerVeckaExtra = safeExtraWeeks > 0 ? Math.floor(usedExtraDays / safeExtraWeeks) : 0;
        let dagarPerVeckaNoExtra = safeNoExtraWeeks > 0 ? Math.floor(usedNoExtraDays / safeNoExtraWeeks) : 0;

        let adjustedExtraDays = dagarPerVeckaExtra * safeExtraWeeks;
        let adjustedNoExtraDays = dagarPerVeckaNoExtra * safeNoExtraWeeks;
        let remainingDays = Math.max(0, totalDaysInt - (adjustedExtraDays + adjustedNoExtraDays));

        const tryIncrease = segment => {
            const weeks = segment === 'extra' ? safeExtraWeeks : safeNoExtraWeeks;
            if (weeks <= 0) return false;
            const current = segment === 'extra' ? dagarPerVeckaExtra : dagarPerVeckaNoExtra;
            if (current >= maxPerWeek) return false;
            if (remainingDays < weeks) return false;
            if (segment === 'extra') {
                dagarPerVeckaExtra += 1;
                adjustedExtraDays += weeks;
            } else {
                dagarPerVeckaNoExtra += 1;
                adjustedNoExtraDays += weeks;
            }
            remainingDays -= weeks;
            return true;
        };

        if (enforceHighExtra && safeExtraWeeks > 0) {
            const target = Math.min(maxPerWeek, 5);
            while (dagarPerVeckaExtra < target && tryIncrease('extra')) {
                // Prioritize filling föräldralön weeks to 5 dagar/vecka when possible
            }
        }

        while (true) {
            const canExtra = safeExtraWeeks > 0 && dagarPerVeckaExtra < maxPerWeek && remainingDays >= safeExtraWeeks;
            const canNoExtra = safeNoExtraWeeks > 0 && dagarPerVeckaNoExtra < maxPerWeek && remainingDays >= safeNoExtraWeeks;

            if (!canExtra && !canNoExtra) {
                break;
            }

            if (enforceHighExtra) {
                if (canExtra && tryIncrease('extra')) {
                    continue;
                }
                if (canNoExtra && tryIncrease('noExtra')) {
                    continue;
                }
                break;
            }

            if (canExtra && (!canNoExtra || dagarPerVeckaExtra <= dagarPerVeckaNoExtra)) {
                tryIncrease('extra');
                continue;
            }

            if (canNoExtra && tryIncrease('noExtra')) {
                continue;
            }

            if (canExtra && tryIncrease('extra')) {
                continue;
            }

            break;
        }

        return {
            dagarPerVeckaExtra: safeExtraWeeks > 0 ? dagarPerVeckaExtra : 0,
            dagarPerVeckaNoExtra: safeNoExtraWeeks > 0 ? dagarPerVeckaNoExtra : 0,
            usedExtraDays: adjustedExtraDays,
            usedNoExtraDays: adjustedNoExtraDays
        };
    };

    // Step 3: Allocate days for Period 1 (Förälder 1)
    let minDagarWeeks1 = 0;
    let weeks1NoExtra = 0;
    if (dagarPerVecka1 > 0) {
        const maxFöräldralönWeeks = maxFöräldralönWeeks1;
        if (weeks1 > maxFöräldralönWeeks) {
            weeks1NoExtra = Math.round(weeks1 - maxFöräldralönWeeks);
            weeks1 = Math.round(maxFöräldralönWeeks);
        }
        const totalWeeks1 = weeks1 + weeks1NoExtra;
        const initialInkomstDagar1 = förälder1InkomstDagar;
        const allocation1 = allocateIncomeDays({
            totalDays: initialInkomstDagar1,
            extraWeeks: weeks1,
            noExtraWeeks: totalWeeks1 - weeks1,
            maxPerWeek: maxDagarPerVecka,
            enforceHighExtra: strategy === "maximize" && extra1 > 0
        });

        dagarPerVecka1 = allocation1.dagarPerVeckaExtra;
        dagarPerVecka1NoExtra = allocation1.dagarPerVeckaNoExtra;

        let extraDaysUsed1 = allocation1.usedExtraDays;
        let noExtraDaysUsed1 = allocation1.usedNoExtraDays;
        användaInkomstDagar1 = extraDaysUsed1 + noExtraDaysUsed1;
        förälder1InkomstDagar -= användaInkomstDagar1;
        användaMinDagar1 = 0;
        minDagarWeeks1 = 0;

        plan1ExtraWeeks = extra1 > 0 ? weeks1 : 0;
        plan1NoExtraWeeksTotal = plan1ExtraWeeks > 0 ? weeks1NoExtra : totalWeeks1;

        plan1 = {
            startWeek: 0,
            weeks: plan1ExtraWeeks,
            dagarPerVecka: dagarPerVecka1,
            inkomst: Math.round(beräknaMånadsinkomst(dag1, dagarPerVecka1, extra1, barnbidrag, tillägg)),
            inkomstUtanExtra: Math.round(beräknaMånadsinkomst(dag1, dagarPerVecka1, 0, barnbidrag, tillägg)),
            användaInkomstDagar: extraDaysUsed1,
            användaMinDagar: användaMinDagar1
        };

        plan1NoExtra = {
            startWeek: plan1ExtraWeeks,
            weeks: plan1NoExtraWeeksTotal,
            dagarPerVecka: dagarPerVecka1NoExtra,
            inkomst: Math.round(beräknaMånadsinkomst(dag1, dagarPerVecka1NoExtra || dagarPerVecka1, 0, barnbidrag, tillägg))
        };
        plan1NoExtra.användaInkomstDagar = noExtraDaysUsed1;

        if (plan1NoExtraWeeksTotal > 0) {
            const nuInkomst = plan1NoExtra.inkomst + arbetsInkomst2;
            if (nuInkomst < minInkomst) {
                const mål = minInkomst - arbetsInkomst2;
                let önskadeDagar = dagarPerVecka1NoExtra || dagarPerVecka1;
                while (
                    önskadeDagar < maxDagarPerVecka &&
                    beräknaMånadsinkomst(dag1, önskadeDagar, 0, barnbidrag, tillägg) < mål
                ) {
                    önskadeDagar += 1;
                }
                const extraDagar =
                    (önskadeDagar - (dagarPerVecka1NoExtra || dagarPerVecka1)) * plan1NoExtraWeeksTotal;
                if (extraDagar > 0) {
                    const minBehov2 = weeks2 * dagarPerVecka2;
                    const överförbara = Math.max(
                        0,
                        förälder2InkomstDagar - 90 - minBehov2 - 10
                    );
                    const blockStorlek = Math.max(1, plan1NoExtraWeeksTotal);
                    const möjligaLån = Math.min(överförbara, extraDagar);
                    const fullaBlock = Math.floor(möjligaLån / blockStorlek);
                    const lånade = fullaBlock * blockStorlek;
                    if (lånade > 0) {
                        förälder2InkomstDagar -= lånade;
                        genomförbarhet.transferredDays += lånade;
                        användaInkomstDagar1 += lånade;
                        noExtraDaysUsed1 += lånade;
                        dagarPerVecka1NoExtra = Math.min(
                            maxDagarPerVecka,
                            Math.max(
                                1,
                                Math.round(noExtraDaysUsed1 / blockStorlek)
                            )
                        );
                        noExtraDaysUsed1 = dagarPerVecka1NoExtra * blockStorlek;
                        plan1NoExtra.dagarPerVecka = dagarPerVecka1NoExtra;
                        plan1NoExtra.inkomst = Math.round(
                            beräknaMånadsinkomst(
                                dag1,
                                dagarPerVecka1NoExtra,
                                0,
                                barnbidrag,
                                tillägg
                            )
                        );
                        plan1NoExtra.användaInkomstDagar = noExtraDaysUsed1;
                        användaInkomstDagar1 = extraDaysUsed1 + noExtraDaysUsed1;
                    }
                }
                const kombEfter = plan1NoExtra.inkomst + arbetsInkomst2;
                if (kombEfter < minInkomst) {
                    genomförbarhet.ärGenomförbar = false;
                    const severity = evaluateIncomeSeverity(kombEfter);
                    updateStatusFromSeverity(severity || "warning");
                    genomförbarhet.meddelande =
                        `Kombinerad inkomst ${kombEfter.toLocaleString()} kr/månad i fas 1 är under kravet ${minInkomst.toLocaleString()} kr/månad (med ${dagarPerVecka1} dagar/vecka).`;
                }
            } else if (strategy === "longer") {
                const blockWeeks = Math.max(1, plan1NoExtraWeeksTotal);
                const initialDaysPerWeek = plan1NoExtra.dagarPerVecka || dagarPerVecka1;
                const initialUsed = plan1NoExtra.användaInkomstDagar || 0;
                let targetDaysPerWeek = initialDaysPerWeek;
                while (targetDaysPerWeek > 1) {
                    const candidateDays = targetDaysPerWeek - 1;
                    const candidateIncome =
                        beräknaMånadsinkomst(dag1, candidateDays, 0, barnbidrag, tillägg) + arbetsInkomst2;
                    if (candidateIncome >= minInkomst) {
                        targetDaysPerWeek = candidateDays;
                        continue;
                    }
                    break;
                }
                if (targetDaysPerWeek !== initialDaysPerWeek) {
                    const newUsed = targetDaysPerWeek * blockWeeks;
                    const freedDays = Math.max(0, initialUsed - newUsed);
                    if (freedDays > 0) {
                        förälder1InkomstDagar += freedDays;
                        const returnable = Math.min(freedDays, genomförbarhet.transferredDays);
                        if (returnable > 0) {
                            förälder1InkomstDagar -= returnable;
                            förälder2InkomstDagar += returnable;
                            genomförbarhet.transferredDays -= returnable;
                        }
                    }
                    dagarPerVecka1NoExtra = targetDaysPerWeek;
                    noExtraDaysUsed1 = newUsed;
                    användaInkomstDagar1 = extraDaysUsed1 + noExtraDaysUsed1;
                    plan1NoExtra.dagarPerVecka = targetDaysPerWeek;
                    plan1NoExtra.inkomst = Math.round(
                        beräknaMånadsinkomst(dag1, targetDaysPerWeek, 0, barnbidrag, tillägg)
                    );
                    plan1NoExtra.användaInkomstDagar = newUsed;
                }
            }
        }

        plan1MinDagar = {
            startWeek: plan1ExtraWeeks + plan1NoExtraWeeksTotal,
            weeks: minDagarWeeks1,
            dagarPerVecka: dagarPerVecka1NoExtra || dagarPerVecka1,
            inkomst: Math.round(
                beräknaMånadsinkomst(
                    MINIMUM_RATE,
                    dagarPerVecka1NoExtra || dagarPerVecka1,
                    0,
                    barnbidrag,
                    tillägg
                )
            ),
            användaMinDagar: 0
        };

        if (inputs.vårdnad === "gemensam" && inputs.beräknaPartner === "ja") {
            const overlapDaysPerWeek = 5;
            plan1Overlap = {
                startWeek: 0,
                weeks: 2,
                dagarPerVecka: overlapDaysPerWeek,
                inkomst: Math.round(
                    beräknaMånadsinkomst(dag1, overlapDaysPerWeek, extra1, barnbidrag, tillägg)
                ),
                inkomstUtanExtra: Math.round(
                    beräknaMånadsinkomst(dag1, overlapDaysPerWeek, 0, barnbidrag, tillägg)
                )
            };
        }
        unusedFöräldralönWeeks1 = Math.max(0, maxFöräldralönWeeks1 - plan1ExtraWeeks);
    }

    // Step 4: Allocate days for Period 2 (Förälder 2)
    let minDagarWeeks2 = 0;
    let weeks2NoExtra = 0;
    if (inputs.vårdnad === "gemensam" && inputs.beräknaPartner === "ja" && weeks2 > 0) {
        const maxFöräldralönWeeks = maxFöräldralönWeeks2;
        if (weeks2 > maxFöräldralönWeeks) {
            weeks2NoExtra = Math.round(weeks2 - maxFöräldralönWeeks);
            weeks2 = Math.round(maxFöräldralönWeeks);
        }
        const totalWeeks2 = weeks2 + weeks2NoExtra;
        const initialInkomstDagar2 = förälder2InkomstDagar;
        const dagarBehövda2 = totalWeeks2 * dagarPerVecka2;

        användaInkomstDagar2 = Math.min(dagarBehövda2, initialInkomstDagar2);
        förälder2InkomstDagar -= användaInkomstDagar2;
        användaMinDagar2 = Math.max(0, Math.min(dagarBehövda2 - initialInkomstDagar2, förälder2MinDagar));
        förälder2MinDagar -= användaMinDagar2;
        minDagarWeeks2 = 0;

        plan2ExtraWeeks = extra2 > 0 ? weeks2 : 0;
        plan2NoExtraWeeksTotal = plan2ExtraWeeks > 0 ? weeks2NoExtra : totalWeeks2;

        plan2 = {
            startWeek: plan1ExtraWeeks + plan1NoExtraWeeksTotal,
            weeks: plan2ExtraWeeks,
            dagarPerVecka: dagarPerVecka2,
            inkomst: Math.round(beräknaMånadsinkomst(dag2, dagarPerVecka2, extra2, barnbidrag, tillägg)),
            inkomstUtanExtra: Math.round(beräknaMånadsinkomst(dag2, dagarPerVecka2, 0, barnbidrag, tillägg)),
            användaInkomstDagar: användaInkomstDagar2,
            användaMinDagar: användaMinDagar2
        };

        const plan2StartNoExtra = plan2.startWeek + plan2ExtraWeeks;
        let extraDaysUsed2 = Math.min(användaInkomstDagar2, Math.round(plan2ExtraWeeks * dagarPerVecka2));
        let noExtraDaysUsed2 = Math.max(0, användaInkomstDagar2 - extraDaysUsed2);
        plan2NoExtra = {
            startWeek: plan2StartNoExtra,
            weeks: plan2NoExtraWeeksTotal,
            dagarPerVecka: dagarPerVecka2,
            inkomst: Math.round(beräknaMånadsinkomst(dag2, dagarPerVecka2, 0, barnbidrag, tillägg)),
            användaInkomstDagar: noExtraDaysUsed2
        };

        const minDagarWeeks2Dynamic = användaMinDagar2 > 0
            ? Math.max(1, Math.round(användaMinDagar2 / Math.max(dagarPerVecka2, 1)))
            : minDagarWeeks2;
        plan2MinDagar = {
            startWeek: plan2StartNoExtra + plan2NoExtraWeeksTotal,
            weeks: minDagarWeeks2Dynamic,
            dagarPerVecka: dagarPerVecka2,
            inkomst: Math.round(beräknaMånadsinkomst(MINIMUM_RATE, dagarPerVecka2, 0, barnbidrag, tillägg)),
            användaMinDagar: användaMinDagar2
        };

        if (strategy === "longer" && plan2NoExtraWeeksTotal > 0) {
            const blockWeeks = Math.max(1, plan2NoExtraWeeksTotal);
            const initialDaysPerWeek = plan2NoExtra.dagarPerVecka || dagarPerVecka2;
            const initialUsed = plan2NoExtra.användaInkomstDagar || 0;
            let targetDaysPerWeek = initialDaysPerWeek;
            while (targetDaysPerWeek > 1) {
                const candidateDays = targetDaysPerWeek - 1;
                const candidateIncome =
                    beräknaMånadsinkomst(dag2, candidateDays, 0, barnbidrag, tillägg) + arbetsInkomst1;
                if (candidateIncome >= minInkomst) {
                    targetDaysPerWeek = candidateDays;
                    continue;
                }
                break;
            }
            if (targetDaysPerWeek !== initialDaysPerWeek) {
                const newUsed = targetDaysPerWeek * blockWeeks;
                const freedDays = Math.max(0, initialUsed - newUsed);
                if (freedDays > 0) {
                    förälder2InkomstDagar += freedDays;
                }
                dagarPerVecka2 = targetDaysPerWeek;
                noExtraDaysUsed2 = newUsed;
                användaInkomstDagar2 = extraDaysUsed2 + noExtraDaysUsed2;
                plan2NoExtra.dagarPerVecka = targetDaysPerWeek;
                plan2NoExtra.inkomst = Math.round(
                    beräknaMånadsinkomst(dag2, targetDaysPerWeek, 0, barnbidrag, tillägg)
                );
                plan2NoExtra.användaInkomstDagar = newUsed;
                plan2MinDagar.dagarPerVecka = targetDaysPerWeek;
                plan2MinDagar.inkomst = Math.round(
                    beräknaMånadsinkomst(MINIMUM_RATE, targetDaysPerWeek, 0, barnbidrag, tillägg)
                );
            }
        }
        unusedFöräldralönWeeks2 = Math.max(0, maxFöräldralönWeeks2 - plan2ExtraWeeks);
    }

    // Step 5: Handle overlap days (10 days for Förälder 2)
    if (includePartner) {
        const overlapDays = 10;
        if (overlapDays <= förälder2InkomstDagar) {
            förälder2InkomstDagar -= overlapDays;
            användaInkomstDagar2 += overlapDays;
        } else {
            const remainingOverlapDays = overlapDays - förälder2InkomstDagar;
            användaInkomstDagar2 += förälder2InkomstDagar;
            förälder2InkomstDagar = 0;
            användaMinDagar2 += remainingOverlapDays;
            förälder2MinDagar -= remainingOverlapDays;
        }
        plan2.användaInkomstDagar = användaInkomstDagar2;
        plan2.användaMinDagar = användaMinDagar2;
        plan2MinDagar.användaMinDagar = användaMinDagar2;
    }

    const minLevelResult = applyMinimumLevelDayUsage({
        requestedWeeks1: desiredWeeks1,
        requestedWeeks2: desiredWeeks2,
        baseDaysPerWeek1: dagarPerVecka1NoExtra || dagarPerVecka1,
        baseDaysPerWeek2: dagarPerVecka2,
        includePartner,
        minIncomeRequirement: minInkomst,
        barnbidrag,
        tillägg,
        arbetsInkomst1,
        arbetsInkomst2,
        användaInkomstDagar1,
        användaInkomstDagar2,
        användaMinDagar1,
        användaMinDagar2,
        förälder1MinDagar,
        förälder2MinDagar,
        plan1,
        plan1MinDagar,
        plan2,
        plan2MinDagar
    });
    användaMinDagar1 = minLevelResult.användaMinDagar1;
    användaMinDagar2 = minLevelResult.användaMinDagar2;
    förälder1MinDagar = minLevelResult.förälder1MinDagar;
    förälder2MinDagar = minLevelResult.förälder2MinDagar;

    const phase1Segments = [];
    if (plan1.weeks > 0) {
        phase1Segments.push({
            totalIncome: plan1.inkomst + arbetsInkomst2,
            dagarPerVecka: plan1.dagarPerVecka,
            label: "fas 1"
        });
    }
    if (plan1NoExtra.weeks > 0) {
        const label = plan1ExtraWeeks > 0 ? "fas 2" : "fas 1";
        phase1Segments.push({
            totalIncome: plan1NoExtra.inkomst + arbetsInkomst2,
            dagarPerVecka: plan1NoExtra.dagarPerVecka || plan1.dagarPerVecka,
            label
        });
    }
    if (plan1MinDagar.weeks > 0) {
        const label = plan1ExtraWeeks > 0 || plan1NoExtraWeeksTotal > 0 ? "fas 2" : "fas 1";
        phase1Segments.push({
            totalIncome: plan1MinDagar.inkomst + arbetsInkomst2,
            dagarPerVecka: plan1MinDagar.dagarPerVecka,
            label
        });
    }

    const phase2Segments = [];
    if (plan2.weeks > 0) {
        phase2Segments.push({
            totalIncome: plan2.inkomst + arbetsInkomst1,
            dagarPerVecka: plan2.dagarPerVecka,
            label: "fas 1"
        });
    }
    if (plan2NoExtra.weeks > 0) {
        const label = plan2ExtraWeeks > 0 ? "fas 2" : "fas 1";
        phase2Segments.push({
            totalIncome: plan2NoExtra.inkomst + arbetsInkomst1,
            dagarPerVecka: plan2NoExtra.dagarPerVecka || plan2.dagarPerVecka,
            label
        });
    }
    if (plan2MinDagar.weeks > 0) {
        const label = plan2ExtraWeeks > 0 || plan2NoExtraWeeksTotal > 0 ? "fas 2" : "fas 1";
        phase2Segments.push({
            totalIncome: plan2MinDagar.inkomst + arbetsInkomst1,
            dagarPerVecka: plan2MinDagar.dagarPerVecka,
            label
        });
    }

    const minPhase1Segment = phase1Segments.reduce((min, segment) => {
        if (!min || segment.totalIncome < min.totalIncome) {
            return segment;
        }
        return min;
    }, null);

    const minPhase2Segment = phase2Segments.reduce((min, segment) => {
        if (!min || segment.totalIncome < min.totalIncome) {
            return segment;
        }
        return min;
    }, null);

    if (minPhase1Segment && minPhase1Segment.totalIncome < minInkomst) {
        genomförbarhet.ärGenomförbar = false;
        const severity = evaluateIncomeSeverity(minPhase1Segment.totalIncome);
        updateStatusFromSeverity(severity || "warning");
        genomförbarhet.meddelande = `Kombinerad inkomst ${minPhase1Segment.totalIncome.toLocaleString()} kr/månad i ${minPhase1Segment.label} är under kravet ${minInkomst.toLocaleString()} kr/månad (med ${minPhase1Segment.dagarPerVecka} dagar/vecka).`;
    } else if (minPhase2Segment && minPhase2Segment.totalIncome < minInkomst) {
        genomförbarhet.ärGenomförbar = false;
        const severity = evaluateIncomeSeverity(minPhase2Segment.totalIncome);
        updateStatusFromSeverity(severity || "warning");
        genomförbarhet.meddelande = `Kombinerad inkomst ${minPhase2Segment.totalIncome.toLocaleString()} kr/månad i ${minPhase2Segment.label} är under kravet ${minInkomst.toLocaleString()} kr/månad (med ${minPhase2Segment.dagarPerVecka} dagar/vecka).`;
    }

    return {
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
        maxFöräldralönWeeks1,
        maxFöräldralönWeeks2,
        unusedFöräldralönWeeks1,
        unusedFöräldralönWeeks2
    };
}

export function optimizeParentalLeave(preferences, inputs) {
    const strategy = preferences?.strategy || "longer";
    if (strategy === "maximize_parental_salary") {
        return optimizeParentalLeaveParentalSalary(preferences, inputs);
    }
    return optimizeParentalLeaveLegacy(preferences, inputs);
}

function optimizeParentalLeaveParentalSalary(preferences, inputs) {
    const { deltid, ledigTid1, ledigTid2 = 0, minInkomst } = preferences;
    const includePartner = inputs.vårdnad === "gemensam" && inputs.beräknaPartner === "ja";
    const desiredWeeks1 = Math.max(0, Math.round((Number(ledigTid1) || 0) * 4.3));
    const desiredWeeks2 = Math.max(0, Math.round((Number(ledigTid2) || 0) * 4.3));
    let plan1 = { startWeek: 0, weeks: 0, dagarPerVecka: 0, inkomst: 0, inkomstUtanExtra: 0, användaInkomstDagar: 0, användaMinDagar: 0 };
    let plan1NoExtra = { startWeek: 0, weeks: 0, dagarPerVecka: 0, inkomst: 0, användaInkomstDagar: 0 };
    let plan2 = { startWeek: 0, weeks: 0, dagarPerVecka: 0, inkomst: 0, inkomstUtanExtra: 0, användaInkomstDagar: 0, användaMinDagar: 0 };
    let plan2NoExtra = { startWeek: 0, weeks: 0, dagarPerVecka: 0, inkomst: 0, användaInkomstDagar: 0 };
    let plan1MinDagar = { startWeek: 0, weeks: 0, dagarPerVecka: 0, inkomst: 0, användaMinDagar: 0 };
    let plan2MinDagar = { startWeek: 0, weeks: 0, dagarPerVecka: 0, inkomst: 0, användaMinDagar: 0 };
    let plan1Overlap = {
        startWeek: 0,
        weeks: 2,
        dagarPerVecka: 0,
        inkomst: 0,
        inkomstUtanExtra: 0
    };
    let plan1ExtraWeeks = 0;
    let plan1NoExtraWeeksTotal = 0;
    let plan2ExtraWeeks = 0;
    let plan2NoExtraWeeksTotal = 0;
    let genomförbarhet = {
        ärGenomförbar: true,
        meddelande: "",
        transferredDays: 0,
        status: "ok",
        minInkomst: minInkomst,
        maxShortfallRatio: 0
    };

    const updateStatusFromSeverity = severity => {
        if (severity === "error") {
            genomförbarhet.status = "error";
        } else if (severity === "warning" && genomförbarhet.status !== "error") {
            genomförbarhet.status = "warning";
        }
    };

    const evaluateIncomeSeverity = income => {
        if (minInkomst <= 0 || income >= minInkomst) {
            return null;
        }
        const diff = minInkomst - income;
        const ratio = minInkomst > 0 ? diff / minInkomst : 0;
        const severity = ratio > 0.10 ? "error" : "warning";
        if (ratio > genomförbarhet.maxShortfallRatio) {
            genomförbarhet.maxShortfallRatio = ratio;
        }
        return severity;
    };

    const barnbidrag = 0;
    const tillägg = 0;

    const inkomst1 = Number(inputs.inkomst1) || 0;
    const inkomst2 = Number(inputs.inkomst2) || 0;

    if (isNaN(inkomst1) || isNaN(inkomst2) || isNaN(ledigTid1) || isNaN(ledigTid2)) {
        throw new Error("Invalid input values: incomes and leave durations must be numbers.");
    }

    const anst1 = inputs.anställningstid1 || "";
    const anst2 = inputs.anställningstid2 || "";
    const avtal1Ja = inputs.avtal1 === "ja" || inputs.avtal1 === true;
    const avtal2Ja = inputs.avtal2 === "ja" || inputs.avtal2 === true;
    const dag1 = beräknaDaglig(inkomst1);
    const extra1 = avtal1Ja && anst1 !== "0-5" ? beräknaFöräldralön(inkomst1) : 0;
    const dag2 = inkomst2 > 0 ? beräknaDaglig(inkomst2) : 0;
    const extra2 = avtal2Ja && anst2 !== "0-5" ? beräknaFöräldralön(inkomst2) : 0;

    const maxFöräldralönWeeks1 = avtal1Ja
        ? anst1 === "6-12" ? 2 * 4.3 : anst1 === ">1" ? 6 * 4.3 : 0
        : 0;
    const maxFöräldralönWeeks2 = avtal2Ja
        ? anst2 === "6-12" ? 2 * 4.3 : anst2 === ">1" ? 6 * 4.3 : 0
        : 0;
    let unusedFöräldralönWeeks1 = 0;
    let unusedFöräldralönWeeks2 = 0;

    const leaveAllocation = resolveLeaveDayAllocation(inputs);
    let förälder1InkomstDagar = leaveAllocation.förälder1InkomstDagar;
    let förälder2InkomstDagar = leaveAllocation.förälder2InkomstDagar;
    let förälder1MinDagar = leaveAllocation.förälder1MinDagar;
    let förälder2MinDagar = leaveAllocation.förälder2MinDagar;
    let användaInkomstDagar1 = 0;
    let användaInkomstDagar2 = 0;
    let användaMinDagar1 = 0;
    let användaMinDagar2 = 0;

    const arbetsInkomst1 = beräknaNetto(inkomst1);
    const arbetsInkomst2 = inkomst2 > 0 ? beräknaNetto(inkomst2) : 0;

    let dagarPerVecka1 = 0;
    let dagarPerVecka1NoExtra = 0;
    let dagarPerVecka2 = 0;
    let weeks1 = desiredWeeks1;
    let weeks2 = desiredWeeks2;
    let inkomst1Result = arbetsInkomst1;
    let inkomst2Result = arbetsInkomst2;
    let kombineradInkomst = 0;

    const maxDagarPerVecka = deltid === "ja" ? 5 : 7;
    if (weeks1 > 0) {
        dagarPerVecka1 = Math.min(maxDagarPerVecka, Math.max(1, Math.floor(förälder1InkomstDagar / weeks1)));
    }
    if (inputs.vårdnad === "gemensam" && inputs.beräknaPartner === "ja" && weeks2 > 0) {
        dagarPerVecka2 = Math.min(maxDagarPerVecka, Math.max(1, Math.floor(förälder2InkomstDagar / weeks2)));
    }

    let totalDagarBehövda1 = weeks1 * dagarPerVecka1;
    let totalDagarBehövda2 = weeks2 * dagarPerVecka2;

    if (includePartner && totalDagarBehövda1 > förälder1InkomstDagar) {
        const minDagarBehövda2 = weeks2 * dagarPerVecka2;
        const överförbaraDagar2 = Math.max(0, förälder2InkomstDagar - 90 - minDagarBehövda2 - 10);
        const överförDagar = Math.min(överförbaraDagar2, totalDagarBehövda1 - förälder1InkomstDagar);
        förälder2InkomstDagar -= överförDagar;
        förälder1InkomstDagar += överförDagar;
        totalDagarBehövda1 = weeks1 * dagarPerVecka1;
        genomförbarhet.transferredDays += överförDagar;
    }

    if (totalDagarBehövda1 > förälder1InkomstDagar) {
        dagarPerVecka1 = Math.max(1, Math.floor(förälder1InkomstDagar / weeks1));
        totalDagarBehövda1 = weeks1 * dagarPerVecka1;
        if (totalDagarBehövda1 > förälder1InkomstDagar) {
            totalDagarBehövda1 = förälder1InkomstDagar;
            weeks1 = Math.floor(totalDagarBehövda1 / dagarPerVecka1) || 1;
        }
    }

    if (includePartner && totalDagarBehövda2 > förälder2InkomstDagar) {
        dagarPerVecka2 = Math.max(1, Math.floor(förälder2InkomstDagar / weeks2));
        totalDagarBehövda2 = weeks2 * dagarPerVecka2;
        if (totalDagarBehövda2 > förälder2InkomstDagar) {
            totalDagarBehövda2 = förälder2InkomstDagar;
            weeks2 = Math.floor(totalDagarBehövda2 / dagarPerVecka2) || 1;
        }
    }

    if (weeks1 > 0) {
        inkomst1Result = beräknaMånadsinkomst(dag1, dagarPerVecka1, extra1, barnbidrag, tillägg);
        inkomst2Result = arbetsInkomst2;
        kombineradInkomst = inkomst1Result + inkomst2Result;

        if (kombineradInkomst < minInkomst && dagarPerVecka1 < 7) {
            const möjligaDagar = Math.min(7, Math.floor(förälder1InkomstDagar / weeks1));
            if (möjligaDagar > dagarPerVecka1) {
                dagarPerVecka1 = möjligaDagar;
                inkomst1Result = beräknaMånadsinkomst(dag1, dagarPerVecka1, extra1, barnbidrag, tillägg);
                kombineradInkomst = inkomst1Result + inkomst2Result;
            }
        }
        if (kombineradInkomst < minInkomst) {
            genomförbarhet.ärGenomförbar = false;
            const severity = evaluateIncomeSeverity(kombineradInkomst);
            updateStatusFromSeverity(severity || "warning");
            genomförbarhet.meddelande =
                `Kombinerad inkomst ${kombineradInkomst.toLocaleString()} kr/månad i fas 1 är under kravet ${minInkomst.toLocaleString()} kr/månad (med ${dagarPerVecka1} dagar/vecka).`;
        }
        totalDagarBehövda1 = weeks1 * dagarPerVecka1;
        if (inputs.vårdnad === "gemensam" && inputs.beräknaPartner === "ja" && totalDagarBehövda1 > förälder1InkomstDagar) {
            const minDagarBehövda2 = weeks2 * dagarPerVecka2;
            const överförbaraDagar2 = Math.max(0, förälder2InkomstDagar - 90 - minDagarBehövda2 - 10);
            const överförDagar = Math.min(överförbaraDagar2, totalDagarBehövda1 - förälder1InkomstDagar);
            förälder2InkomstDagar -= överförDagar;
            förälder1InkomstDagar += överförDagar;
            genomförbarhet.transferredDays += överförDagar;
            totalDagarBehövda1 = weeks1 * dagarPerVecka1;
        }
        if (totalDagarBehövda1 > förälder1InkomstDagar) {
            dagarPerVecka1 = Math.max(1, Math.floor(förälder1InkomstDagar / weeks1));
            totalDagarBehövda1 = weeks1 * dagarPerVecka1;
            if (totalDagarBehövda1 > förälder1InkomstDagar) {
                totalDagarBehövda1 = förälder1InkomstDagar;
                weeks1 = Math.floor(totalDagarBehövda1 / dagarPerVecka1) || 1;
            }
        }
    }

    if (includePartner && weeks2 > 0) {
        inkomst1Result = arbetsInkomst1;
        inkomst2Result = beräknaMånadsinkomst(dag2, dagarPerVecka2, extra2, barnbidrag, tillägg);
        kombineradInkomst = inkomst1Result + inkomst2Result;

        if (kombineradInkomst < minInkomst && dagarPerVecka2 < 7) {
            const möjligaDagar = Math.min(7, Math.floor(förälder2InkomstDagar / weeks2));
            if (möjligaDagar > dagarPerVecka2) {
                dagarPerVecka2 = möjligaDagar;
                inkomst2Result = beräknaMånadsinkomst(dag2, dagarPerVecka2, extra2, barnbidrag, tillägg);
                kombineradInkomst = inkomst1Result + inkomst2Result;
            }
        }
        if (kombineradInkomst < minInkomst) {
            genomförbarhet.ärGenomförbar = false;
            const severity = evaluateIncomeSeverity(kombineradInkomst);
            updateStatusFromSeverity(severity || "warning");
            genomförbarhet.meddelande =
                `Kombinerad inkomst ${kombineradInkomst.toLocaleString()} kr/månad i fas 2 är under kravet ${minInkomst.toLocaleString()} kr/månad (med ${dagarPerVecka2} dagar/vecka).`;
        }
        totalDagarBehövda2 = weeks2 * dagarPerVecka2;
        if (totalDagarBehövda2 > förälder2InkomstDagar) {
            dagarPerVecka2 = Math.max(1, Math.floor(förälder2InkomstDagar / weeks2));
            totalDagarBehövda2 = weeks2 * dagarPerVecka2;
            if (totalDagarBehövda2 > förälder2InkomstDagar) {
                totalDagarBehövda2 = förälder2InkomstDagar;
                weeks2 = Math.floor(totalDagarBehövda2 / dagarPerVecka2) || 1;
            }
        }
    }

    const allocateIncomeDays = ({ totalDays, extraWeeks, noExtraWeeks, maxPerWeek, enforceHighExtra }) => {
        const safeExtraWeeks = Math.max(0, Math.round(extraWeeks));
        const safeNoExtraWeeks = Math.max(0, Math.round(noExtraWeeks));

        if (totalDays <= 0 || (safeExtraWeeks === 0 && safeNoExtraWeeks === 0)) {
            return {
                dagarPerVeckaExtra: 0,
                dagarPerVeckaNoExtra: 0,
                usedExtraDays: 0,
                usedNoExtraDays: 0
            };
        }

        const maxExtraDays = safeExtraWeeks * maxPerWeek;
        const maxNoExtraDays = safeNoExtraWeeks * maxPerWeek;
        const baselineNoExtra = safeNoExtraWeeks > 0 ? Math.min(totalDays, safeNoExtraWeeks) : 0;
        let remaining = totalDays - baselineNoExtra;

        let usedExtraDays = 0;
        if (safeExtraWeeks > 0 && remaining > 0) {
            const minExtraPerWeek = enforceHighExtra ? Math.min(maxPerWeek, 5) : 0;
            const minExtraDays = safeExtraWeeks * minExtraPerWeek;
            usedExtraDays = Math.min(maxExtraDays, remaining);
            if (usedExtraDays < minExtraDays && totalDays >= minExtraDays + baselineNoExtra) {
                usedExtraDays = Math.min(maxExtraDays, Math.min(remaining, minExtraDays));
            }
            remaining -= usedExtraDays;
        }

        let usedNoExtraDays = Math.min(Math.max(0, maxNoExtraDays - baselineNoExtra), Math.max(0, remaining));
        remaining -= usedNoExtraDays;
        usedNoExtraDays += baselineNoExtra;

        if (remaining > 0 && safeExtraWeeks > 0 && usedExtraDays < maxExtraDays) {
            const add = Math.min(maxExtraDays - usedExtraDays, remaining);
            usedExtraDays += add;
            remaining -= add;
        }

        if (remaining > 0 && safeNoExtraWeeks > 0 && usedNoExtraDays < maxNoExtraDays) {
            const add = Math.min(maxNoExtraDays - usedNoExtraDays, remaining);
            usedNoExtraDays += add;
            remaining -= add;
        }

        usedExtraDays = Math.round(usedExtraDays);
        usedNoExtraDays = Math.round(usedNoExtraDays);

        const totalDaysInt = Math.max(0, Math.round(totalDays));
        let dagarPerVeckaExtra = safeExtraWeeks > 0 ? Math.floor(usedExtraDays / safeExtraWeeks) : 0;
        let dagarPerVeckaNoExtra = safeNoExtraWeeks > 0 ? Math.floor(usedNoExtraDays / safeNoExtraWeeks) : 0;

        let adjustedExtraDays = dagarPerVeckaExtra * safeExtraWeeks;
        let adjustedNoExtraDays = dagarPerVeckaNoExtra * safeNoExtraWeeks;
        let remainingDays = Math.max(0, totalDaysInt - (adjustedExtraDays + adjustedNoExtraDays));

        const tryIncrease = segment => {
            const weeks = segment === 'extra' ? safeExtraWeeks : safeNoExtraWeeks;
            if (weeks <= 0) return false;
            const current = segment === 'extra' ? dagarPerVeckaExtra : dagarPerVeckaNoExtra;
            if (current >= maxPerWeek) return false;
            if (remainingDays < weeks) return false;
            if (segment === 'extra') {
                dagarPerVeckaExtra += 1;
                adjustedExtraDays += weeks;
            } else {
                dagarPerVeckaNoExtra += 1;
                adjustedNoExtraDays += weeks;
            }
            remainingDays -= weeks;
            return true;
        };

        if (enforceHighExtra && safeExtraWeeks > 0) {
            const target = Math.min(maxPerWeek, 5);
            while (dagarPerVeckaExtra < target && tryIncrease('extra')) {
                // Prioritize föräldralön days to reach 5 dagar/vecka when possible
            }
        }

        while (true) {
            const canExtra = safeExtraWeeks > 0 && dagarPerVeckaExtra < maxPerWeek && remainingDays >= safeExtraWeeks;
            const canNoExtra = safeNoExtraWeeks > 0 && dagarPerVeckaNoExtra < maxPerWeek && remainingDays >= safeNoExtraWeeks;

            if (!canExtra && !canNoExtra) {
                break;
            }

            if (enforceHighExtra) {
                if (canExtra && tryIncrease('extra')) {
                    continue;
                }
                if (canNoExtra && tryIncrease('noExtra')) {
                    continue;
                }
                break;
            }

            if (canExtra && (!canNoExtra || dagarPerVeckaExtra <= dagarPerVeckaNoExtra)) {
                tryIncrease('extra');
                continue;
            }

            if (canNoExtra && tryIncrease('noExtra')) {
                continue;
            }

            if (canExtra && tryIncrease('extra')) {
                continue;
            }

            break;
        }

        return {
            dagarPerVeckaExtra: safeExtraWeeks > 0 ? dagarPerVeckaExtra : 0,
            dagarPerVeckaNoExtra: safeNoExtraWeeks > 0 ? dagarPerVeckaNoExtra : 0,
            usedExtraDays: adjustedExtraDays,
            usedNoExtraDays: adjustedNoExtraDays
        };
    };

    let minDagarWeeks1 = 0;
    let weeks1NoExtra = 0;
    if (dagarPerVecka1 > 0) {
        const maxFöräldralönWeeks = maxFöräldralönWeeks1;
        if (weeks1 > maxFöräldralönWeeks) {
            weeks1NoExtra = Math.round(weeks1 - maxFöräldralönWeeks);
            weeks1 = Math.round(maxFöräldralönWeeks);
        }
        const totalWeeks1 = weeks1 + weeks1NoExtra;
        const initialInkomstDagar1 = förälder1InkomstDagar;
        const allocation1 = allocateIncomeDays({
            totalDays: initialInkomstDagar1,
            extraWeeks: weeks1,
            noExtraWeeks: totalWeeks1 - weeks1,
            maxPerWeek: maxDagarPerVecka,
            enforceHighExtra: extra1 > 0
        });

        dagarPerVecka1 = allocation1.dagarPerVeckaExtra;
        dagarPerVecka1NoExtra = allocation1.dagarPerVeckaNoExtra;

        let extraDaysUsed1 = allocation1.usedExtraDays;
        let noExtraDaysUsed1 = allocation1.usedNoExtraDays;
        användaInkomstDagar1 = extraDaysUsed1 + noExtraDaysUsed1;
        förälder1InkomstDagar -= användaInkomstDagar1;
        användaMinDagar1 = 0;
        minDagarWeeks1 = 0;

        plan1ExtraWeeks = extra1 > 0 ? weeks1 : 0;
        plan1NoExtraWeeksTotal = plan1ExtraWeeks > 0 ? weeks1NoExtra : totalWeeks1;

        plan1 = {
            startWeek: 0,
            weeks: plan1ExtraWeeks,
            dagarPerVecka: dagarPerVecka1,
            inkomst: Math.round(beräknaMånadsinkomst(dag1, dagarPerVecka1, extra1, barnbidrag, tillägg)),
            inkomstUtanExtra: Math.round(beräknaMånadsinkomst(dag1, dagarPerVecka1, 0, barnbidrag, tillägg)),
            användaInkomstDagar: extraDaysUsed1,
            användaMinDagar: användaMinDagar1
        };

        plan1NoExtra = {
            startWeek: plan1ExtraWeeks,
            weeks: plan1NoExtraWeeksTotal,
            dagarPerVecka: dagarPerVecka1NoExtra,
            inkomst: Math.round(beräknaMånadsinkomst(dag1, dagarPerVecka1NoExtra || dagarPerVecka1, 0, barnbidrag, tillägg))
        };
        plan1NoExtra.användaInkomstDagar = noExtraDaysUsed1;

        if (plan1NoExtraWeeksTotal > 0) {
            const nuInkomst = plan1NoExtra.inkomst + arbetsInkomst2;
            if (nuInkomst < minInkomst) {
                const mål = minInkomst - arbetsInkomst2;
                let önskadeDagar = dagarPerVecka1NoExtra || dagarPerVecka1;
                while (
                    önskadeDagar < maxDagarPerVecka &&
                    beräknaMånadsinkomst(dag1, önskadeDagar, 0, barnbidrag, tillägg) < mål
                ) {
                    önskadeDagar += 1;
                }
                const extraDagar =
                    (önskadeDagar - (dagarPerVecka1NoExtra || dagarPerVecka1)) * plan1NoExtraWeeksTotal;
                if (extraDagar > 0) {
                    const minBehov2 = weeks2 * dagarPerVecka2;
                    const överförbara = Math.max(
                        0,
                        förälder2InkomstDagar - 90 - minBehov2 - 10
                    );
                    const blockStorlek = Math.max(1, plan1NoExtraWeeksTotal);
                    const möjligaLån = Math.min(överförbara, extraDagar);
                    const fullaBlock = Math.floor(möjligaLån / blockStorlek);
                    const lånade = fullaBlock * blockStorlek;
                    if (lånade > 0) {
                        förälder2InkomstDagar -= lånade;
                        genomförbarhet.transferredDays += lånade;
                        användaInkomstDagar1 += lånade;
                        noExtraDaysUsed1 += lånade;
                        dagarPerVecka1NoExtra = Math.min(
                            maxDagarPerVecka,
                            Math.max(
                                1,
                                Math.round(noExtraDaysUsed1 / blockStorlek)
                            )
                        );
                        noExtraDaysUsed1 = dagarPerVecka1NoExtra * blockStorlek;
                        plan1NoExtra.dagarPerVecka = dagarPerVecka1NoExtra;
                        plan1NoExtra.inkomst = Math.round(
                            beräknaMånadsinkomst(
                                dag1,
                                dagarPerVecka1NoExtra,
                                0,
                                barnbidrag,
                                tillägg
                            )
                        );
                        plan1NoExtra.användaInkomstDagar = noExtraDaysUsed1;
                        användaInkomstDagar1 = extraDaysUsed1 + noExtraDaysUsed1;
                    }
                }
                const kombEfter = plan1NoExtra.inkomst + arbetsInkomst2;
                if (kombEfter < minInkomst) {
                    genomförbarhet.ärGenomförbar = false;
                    const severity = evaluateIncomeSeverity(kombEfter);
                    updateStatusFromSeverity(severity || "warning");
                    genomförbarhet.meddelande =
                        `Kombinerad inkomst ${kombEfter.toLocaleString()} kr/månad i fas 1 är under kravet ${minInkomst.toLocaleString()} kr/månad (med ${dagarPerVecka1} dagar/vecka).`;
                }
            }
        }

        plan1MinDagar = {
            startWeek: plan1ExtraWeeks + plan1NoExtraWeeksTotal,
            weeks: minDagarWeeks1,
            dagarPerVecka: dagarPerVecka1NoExtra || dagarPerVecka1,
            inkomst: Math.round(
                beräknaMånadsinkomst(
                    MINIMUM_RATE,
                    dagarPerVecka1NoExtra || dagarPerVecka1,
                    0,
                    barnbidrag,
                    tillägg
                )
            ),
            användaMinDagar: 0
        };

        if (inputs.vårdnad === "gemensam" && inputs.beräknaPartner === "ja") {
            const overlapDaysPerWeek = 5;
            plan1Overlap = {
                startWeek: 0,
                weeks: 2,
                dagarPerVecka: overlapDaysPerWeek,
                inkomst: Math.round(
                    beräknaMånadsinkomst(dag1, overlapDaysPerWeek, extra1, barnbidrag, tillägg)
                ),
                inkomstUtanExtra: Math.round(
                    beräknaMånadsinkomst(dag1, overlapDaysPerWeek, 0, barnbidrag, tillägg)
                )
            };
        }
        unusedFöräldralönWeeks1 = Math.max(0, maxFöräldralönWeeks1 - plan1ExtraWeeks);
    }

    let minDagarWeeks2 = 0;
    let weeks2NoExtra = 0;
    if (inputs.vårdnad === "gemensam" && inputs.beräknaPartner === "ja" && weeks2 > 0) {
        const maxFöräldralönWeeks = maxFöräldralönWeeks2;
        if (weeks2 > maxFöräldralönWeeks) {
            weeks2NoExtra = Math.round(weeks2 - maxFöräldralönWeeks);
            weeks2 = Math.round(maxFöräldralönWeeks);
        }
        const totalWeeks2 = weeks2 + weeks2NoExtra;
        const initialInkomstDagar2 = förälder2InkomstDagar;
        const dagarBehövda2 = totalWeeks2 * dagarPerVecka2;

        användaInkomstDagar2 = Math.min(dagarBehövda2, initialInkomstDagar2);
        förälder2InkomstDagar -= användaInkomstDagar2;
        användaMinDagar2 = Math.max(0, Math.min(dagarBehövda2 - initialInkomstDagar2, förälder2MinDagar));
        förälder2MinDagar -= användaMinDagar2;
        minDagarWeeks2 = 0;

        plan2ExtraWeeks = extra2 > 0 ? weeks2 : 0;
        plan2NoExtraWeeksTotal = plan2ExtraWeeks > 0 ? weeks2NoExtra : totalWeeks2;

        plan2 = {
            startWeek: plan1ExtraWeeks + plan1NoExtraWeeksTotal,
            weeks: plan2ExtraWeeks,
            dagarPerVecka: dagarPerVecka2,
            inkomst: Math.round(beräknaMånadsinkomst(dag2, dagarPerVecka2, extra2, barnbidrag, tillägg)),
            inkomstUtanExtra: Math.round(beräknaMånadsinkomst(dag2, dagarPerVecka2, 0, barnbidrag, tillägg)),
            användaInkomstDagar: användaInkomstDagar2,
            användaMinDagar: användaMinDagar2
        };

        const plan2StartNoExtra = plan2.startWeek + plan2ExtraWeeks;
        const extraDaysUsed2 = Math.min(användaInkomstDagar2, Math.round(plan2ExtraWeeks * dagarPerVecka2));
        const noExtraDaysUsed2 = Math.max(0, användaInkomstDagar2 - extraDaysUsed2);
        plan2NoExtra = {
            startWeek: plan2StartNoExtra,
            weeks: plan2NoExtraWeeksTotal,
            dagarPerVecka: dagarPerVecka2,
            inkomst: Math.round(beräknaMånadsinkomst(dag2, dagarPerVecka2, 0, barnbidrag, tillägg)),
            användaInkomstDagar: noExtraDaysUsed2
        };

        const minDagarWeeks2Dynamic = användaMinDagar2 > 0
            ? Math.max(1, Math.round(användaMinDagar2 / Math.max(dagarPerVecka2, 1)))
            : minDagarWeeks2;
        plan2MinDagar = {
            startWeek: plan2StartNoExtra + plan2NoExtraWeeksTotal,
            weeks: minDagarWeeks2Dynamic,
            dagarPerVecka: dagarPerVecka2,
            inkomst: Math.round(beräknaMånadsinkomst(MINIMUM_RATE, dagarPerVecka2, 0, barnbidrag, tillägg)),
            användaMinDagar: användaMinDagar2
        };
        unusedFöräldralönWeeks2 = Math.max(0, maxFöräldralönWeeks2 - plan2ExtraWeeks);
    }

    if (includePartner) {
        const overlapDays = 10;
        if (overlapDays <= förälder2InkomstDagar) {
            förälder2InkomstDagar -= overlapDays;
            användaInkomstDagar2 += overlapDays;
        } else {
            const remainingOverlapDays = overlapDays - förälder2InkomstDagar;
            användaInkomstDagar2 += förälder2InkomstDagar;
            förälder2InkomstDagar = 0;
            användaMinDagar2 += remainingOverlapDays;
            förälder2MinDagar -= remainingOverlapDays;
        }
        plan2.användaInkomstDagar = användaInkomstDagar2;
        plan2.användaMinDagar = användaMinDagar2;
        plan2MinDagar.användaMinDagar = användaMinDagar2;
    }

    const minLevelResult = applyMinimumLevelDayUsage({
        requestedWeeks1: desiredWeeks1,
        requestedWeeks2: desiredWeeks2,
        baseDaysPerWeek1: dagarPerVecka1NoExtra || dagarPerVecka1,
        baseDaysPerWeek2: dagarPerVecka2,
        includePartner,
        minIncomeRequirement: minInkomst,
        barnbidrag,
        tillägg,
        arbetsInkomst1,
        arbetsInkomst2,
        användaInkomstDagar1,
        användaInkomstDagar2,
        användaMinDagar1,
        användaMinDagar2,
        förälder1MinDagar,
        förälder2MinDagar,
        plan1,
        plan1MinDagar,
        plan2,
        plan2MinDagar
    });
    användaMinDagar1 = minLevelResult.användaMinDagar1;
    användaMinDagar2 = minLevelResult.användaMinDagar2;
    förälder1MinDagar = minLevelResult.förälder1MinDagar;
    förälder2MinDagar = minLevelResult.förälder2MinDagar;

    const phase1Segments = [];
    if (plan1.weeks > 0) {
        phase1Segments.push({
            totalIncome: plan1.inkomst + arbetsInkomst2,
            dagarPerVecka: plan1.dagarPerVecka,
            label: "fas 1"
        });
    }
    if (plan1NoExtra.weeks > 0) {
        const label = plan1ExtraWeeks > 0 ? "fas 2" : "fas 1";
        phase1Segments.push({
            totalIncome: plan1NoExtra.inkomst + arbetsInkomst2,
            dagarPerVecka: plan1NoExtra.dagarPerVecka || plan1.dagarPerVecka,
            label
        });
    }
    if (plan1MinDagar.weeks > 0) {
        const label = plan1ExtraWeeks > 0 || plan1NoExtraWeeksTotal > 0 ? "fas 2" : "fas 1";
        phase1Segments.push({
            totalIncome: plan1MinDagar.inkomst + arbetsInkomst2,
            dagarPerVecka: plan1MinDagar.dagarPerVecka,
            label
        });
    }

    const phase2Segments = [];
    if (plan2.weeks > 0) {
        phase2Segments.push({
            totalIncome: plan2.inkomst + arbetsInkomst1,
            dagarPerVecka: plan2.dagarPerVecka,
            label: "fas 1"
        });
    }
    if (plan2NoExtra.weeks > 0) {
        const label = plan2ExtraWeeks > 0 ? "fas 2" : "fas 1";
        phase2Segments.push({
            totalIncome: plan2NoExtra.inkomst + arbetsInkomst1,
            dagarPerVecka: plan2NoExtra.dagarPerVecka || plan2.dagarPerVecka,
            label
        });
    }
    if (plan2MinDagar.weeks > 0) {
        const label = plan2ExtraWeeks > 0 || plan2NoExtraWeeksTotal > 0 ? "fas 2" : "fas 1";
        phase2Segments.push({
            totalIncome: plan2MinDagar.inkomst + arbetsInkomst1,
            dagarPerVecka: plan2MinDagar.dagarPerVecka,
            label
        });
    }

    const minPhase1Segment = phase1Segments.reduce((min, segment) => {
        if (!min || segment.totalIncome < min.totalIncome) {
            return segment;
        }
        return min;
    }, null);

    const minPhase2Segment = phase2Segments.reduce((min, segment) => {
        if (!min || segment.totalIncome < min.totalIncome) {
            return segment;
        }
        return min;
    }, null);

    if (minPhase1Segment && minPhase1Segment.totalIncome < minInkomst) {
        genomförbarhet.ärGenomförbar = false;
        const severity = evaluateIncomeSeverity(minPhase1Segment.totalIncome);
        updateStatusFromSeverity(severity || "warning");
        genomförbarhet.meddelande = `Kombinerad inkomst ${minPhase1Segment.totalIncome.toLocaleString()} kr/månad i ${minPhase1Segment.label} är under kravet ${minInkomst.toLocaleString()} kr/månad (med ${minPhase1Segment.dagarPerVecka} dagar/vecka).`;
    } else if (minPhase2Segment && minPhase2Segment.totalIncome < minInkomst) {
        genomförbarhet.ärGenomförbar = false;
        const severity = evaluateIncomeSeverity(minPhase2Segment.totalIncome);
        updateStatusFromSeverity(severity || "warning");
        genomförbarhet.meddelande = `Kombinerad inkomst ${minPhase2Segment.totalIncome.toLocaleString()} kr/månad i ${minPhase2Segment.label} är under kravet ${minInkomst.toLocaleString()} kr/månad (med ${minPhase2Segment.dagarPerVecka} dagar/vecka).`;
    }

    return {
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
        maxFöräldralönWeeks1,
        maxFöräldralönWeeks2,
        unusedFöräldralönWeeks1,
        unusedFöräldralönWeeks2
    };
}
 
