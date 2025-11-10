const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const yaml = require("js-yaml");

const { optimizeLeave } = require("../build/test/parentalCalculations.js");
const { getMonthlyIncomeTotals } = require("../build/test/incomeSummary.js");
const {
  computeTimelineMonthlyData,
  condenseTimelinePoints,
} = require("../build/test/timeline.js");

const loadFamilyScenarios = () => {
  const filePath = path.resolve("families");
  const fileContent = fs.readFileSync(filePath, "utf8");
  const parsed = yaml.load(fileContent);
  if (!parsed || !Array.isArray(parsed.families)) {
    throw new Error("Kunde inte läsa familjescenarier från filen 'families'.");
  }
  return parsed.families;
};

const scenarios = loadFamilyScenarios();

test("Familjescenarier", async (t) => {
  for (const scenario of scenarios) {
    await t.test(`uppfyller kraven för ${scenario.name}`, () => {
      const parent1 = {
        income: Number(scenario.parent1.grossIncome) || 0,
        hasCollectiveAgreement: Boolean(scenario.parent1.hasCollectiveAgreement),
        taxRate: Number(scenario.parent1.taxRate ?? 30) || 30,
      };

      const parent2 = {
        income: Number(scenario.parent2.grossIncome) || 0,
        hasCollectiveAgreement: Boolean(scenario.parent2.hasCollectiveAgreement),
        taxRate: Number(scenario.parent2.taxRate ?? 30) || 30,
      };

      const prefs = scenario.preferences;
      const minIncome = Number(prefs.minimumNetIncome) || 0;

      const results = optimizeLeave(
        parent1,
        parent2,
        Number(prefs.totalMonths) || 0,
        Number(prefs.parent1Months) || 0,
        Number(prefs.parent2Months) || 0,
        minIncome,
        Number(prefs.daysPerWeek) || 5,
        Number(prefs.simultaneousMonths) || 0,
        false
      );

      const resultMap = new Map(results.map((result) => [result.strategy, result]));
      const targetResult = resultMap.get(prefs.strategy);
      assert.ok(targetResult, `Strategin ${prefs.strategy} saknas i resultatet`);
      if (!targetResult) return;

      const monthlyTotals = getMonthlyIncomeTotals(targetResult.periods);

      // Test 1: Minimum income requirement
      if (scenario.expectations.requireMinIncome) {
        const fullMonths = monthlyTotals.filter(
          (month) => month.totalCalendarDays >= month.monthLength
        );
        const deficits = fullMonths
          .map((month) => ({
            month,
            deficit: minIncome - Math.round(month.totalIncome),
          }))
          .filter((entry) => entry.deficit > 0);

        if (typeof scenario.expectations.maxAllowedDeficit === "number") {
          deficits.forEach(({ month, deficit }) => {
            assert.ok(
              deficit <= scenario.expectations.maxAllowedDeficit,
              `Månaden ${month.monthStart.toISOString()} har underskott på ${deficit} kr (max tillåtet: ${scenario.expectations.maxAllowedDeficit} kr)`
            );
          });
        } else {
          // No deficit allowed - all months must meet minimum income
          if (deficits.length > 0) {
            const deficitInfo = deficits.map(d => 
              `${d.month.monthStart.toISOString().slice(0, 7)}: ${Math.round(d.month.totalIncome)} kr (saknar ${d.deficit} kr)`
            ).join(', ');
            assert.fail(
              `${deficits.length} månader understiger minimibeloppet ${minIncome} kr: ${deficitInfo}`
            );
          }
        }
      }

      // Test 2: Minimum days saved
      if (typeof scenario.expectations.minDaysSaved === "number") {
        assert.ok(
          targetResult.daysSaved >= scenario.expectations.minDaysSaved,
          `För få sparade dagar: ${targetResult.daysSaved} (förväntat: minst ${scenario.expectations.minDaysSaved})`
        );
      }

      // Test 3: Strategy comparison
      const otherStrategyKey = targetResult.strategy === "save-days" ? "maximize-income" : "save-days";
      const alternativeResult = resultMap.get(otherStrategyKey);

      if (scenario.expectations.strategyBeatsAlternative && alternativeResult) {
        assert.ok(
          targetResult.totalIncome >= alternativeResult.totalIncome,
          `Vald strategi gav inte högsta totalinkomst: ${targetResult.totalIncome} vs ${alternativeResult.totalIncome}`
        );
      }

      // Test 4: Timeline points
      const timelinePoints = computeTimelineMonthlyData(
        targetResult.periods,
        Number(prefs.totalMonths) || 0
      );

      if (typeof scenario.expectations.timelinePoints === "number") {
        assert.ok(
          timelinePoints.length >= scenario.expectations.timelinePoints,
          `Tidslinjen innehåller färre punkter (${timelinePoints.length}) än förväntat (${scenario.expectations.timelinePoints})`
        );
      }

      // Test 5: Condensed timeline
      const condensedTimeline = condenseTimelinePoints(timelinePoints, 15);
      assert.ok(
        condensedTimeline.length <= 15,
        `Komprimerad tidslinje har för många punkter (${condensedTimeline.length}, max: 15)`
      );

      if (typeof scenario.expectations.expectedCondensedPoints === "number") {
        assert.strictEqual(
          condensedTimeline.length,
          scenario.expectations.expectedCondensedPoints,
          `Komprimerad tidslinje matchar inte förväntad punktmängd (${condensedTimeline.length} vs ${scenario.expectations.expectedCondensedPoints})`
        );
      }
    });
  }
});
