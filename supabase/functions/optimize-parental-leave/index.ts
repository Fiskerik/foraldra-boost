import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ParentInput {
  income: number;
  hasCollectiveAgreement: boolean;
  taxRate: number;
}

interface OptimizationInput {
  parent1: ParentInput;
  parent2: ParentInput;
  totalMonths: number;
  minHouseholdIncome: number;
  strategy: 'maximize-income' | 'save-days';
  simultaneousMonths: number;
  daysPerWeek: number;
  distributionResults: DistributionResult[];
}

interface DistributionResult {
  parent1Months: number;
  parent2Months: number;
  totalIncome: number;
  daysSaved: number;
  meetsMinimum: boolean;
  warningCount: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const input: OptimizationInput = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    console.log("Received optimization request:", JSON.stringify(input, null, 2));

    // Filter valid distributions (those that meet minimum income)
    const validDistributions = input.distributionResults.filter(d => d.meetsMinimum);
    
    // Find best distribution based on strategy
    let bestDistribution: DistributionResult | null = null;
    
    if (input.strategy === 'save-days') {
      // For save-days: maximize days saved
      bestDistribution = validDistributions.reduce((best, curr) => 
        curr.daysSaved > best.daysSaved ? curr : best
      , validDistributions[0]);
    } else {
      // For maximize-income: maximize total income
      bestDistribution = validDistributions.reduce((best, curr) => 
        curr.totalIncome > best.totalIncome ? curr : best
      , validDistributions[0]);
    }

    // Build context for AI
    const strategyName = input.strategy === 'save-days' ? 'Spara dagar' : 'Maximera inkomst';
    const parent1CA = input.parent1.hasCollectiveAgreement ? 'Ja' : 'Nej';
    const parent2CA = input.parent2.hasCollectiveAgreement ? 'Ja' : 'Nej';

    const systemPrompt = `Du är en expert på svensk föräldrapenning och föräldraledighet. Du hjälper familjer att optimera sin föräldraledighet.

Du ska analysera de beräknade fördelningarna och ge en rekommendation på svenska. Var kortfattad men informativ.

Viktiga regler att beakta:
- Föräldralön (kollektivavtal) gäller endast de första 6 månaderna per förälder
- Minimum hushållsinkomst måste uppnås varje hel månad
- 480 föräldradagar totalt att fördela
- SGI-tak på 49 000 kr/månad påverkar föräldrapenningen

Svara alltid på svenska.`;

    const userPrompt = `Analysera följande föräldraledighetsplanering:

**Familjens situation:**
- Förälder 1: ${input.parent1.income.toLocaleString('sv-SE')} kr/månad, Kollektivavtal: ${parent1CA}
- Förälder 2: ${input.parent2.income.toLocaleString('sv-SE')} kr/månad, Kollektivavtal: ${parent2CA}
- Skattesats: ${input.parent1.taxRate}%
- Totalt antal månader lediga: ${input.totalMonths}
- Minimum hushållsinkomst: ${input.minHouseholdIncome.toLocaleString('sv-SE')} kr/månad
- Vald strategi: ${strategyName}
- Dagar per vecka: ${input.daysPerWeek}
${input.simultaneousMonths > 0 ? `- Hemma samtidigt: ${input.simultaneousMonths} månader` : ''}

**Beräknade fördelningar (${validDistributions.length} giltiga av ${input.distributionResults.length} totalt):**
${validDistributions.slice(0, 10).map(d => 
  `- F1: ${d.parent1Months} mån, F2: ${d.parent2Months} mån → Total: ${d.totalIncome.toLocaleString('sv-SE')} kr, Sparade dagar: ${d.daysSaved}`
).join('\n')}

**Bästa fördelning enligt beräkningar:**
- Förälder 1: ${bestDistribution?.parent1Months} månader
- Förälder 2: ${bestDistribution?.parent2Months} månader
- Total inkomst: ${bestDistribution?.totalIncome.toLocaleString('sv-SE')} kr
- Sparade dagar: ${bestDistribution?.daysSaved}

Ge en rekommendation med:
1. Vilken fördelning som är optimal och varför
2. Eventuella tips för att maximera utfallet
3. Varningar om något bör beaktas`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "recommend_distribution",
              description: "Returnera den optimala fördelningen med förklaring",
              parameters: {
                type: "object",
                properties: {
                  optimalParent1Months: { 
                    type: "number",
                    description: "Antal månader för Förälder 1"
                  },
                  explanation: { 
                    type: "string",
                    description: "Förklaring på svenska varför denna fördelning är optimal (2-3 meningar)"
                  },
                  tips: {
                    type: "array",
                    items: { type: "string" },
                    description: "Lista med tips för att optimera föräldraledigheten (max 3 tips)"
                  }
                },
                required: ["optimalParent1Months", "explanation", "tips"],
                additionalProperties: false
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "recommend_distribution" } }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(JSON.stringify({ 
          error: "För många förfrågningar. Vänta en stund och försök igen." 
        }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ 
          error: "AI-tjänsten är inte tillgänglig just nu." 
        }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      // Fallback to calculated best
      return new Response(JSON.stringify({
        optimalParent1Months: bestDistribution?.parent1Months || Math.floor(input.totalMonths / 2),
        explanation: `Baserat på beräkningarna rekommenderas denna fördelning för att ${input.strategy === 'save-days' ? 'spara flest dagar' : 'maximera inkomsten'}.`,
        tips: ["Kontrollera att kollektivavtal är korrekt angivet för båda föräldrarna."]
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    console.log("AI response:", JSON.stringify(data, null, 2));

    // Extract tool call result
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      const result = JSON.parse(toolCall.function.arguments);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fallback if no tool call
    return new Response(JSON.stringify({
      optimalParent1Months: bestDistribution?.parent1Months || Math.floor(input.totalMonths / 2),
      explanation: `Baserat på beräkningarna rekommenderas denna fördelning för att ${input.strategy === 'save-days' ? 'spara flest dagar' : 'maximera inkomsten'}.`,
      tips: []
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error in optimize-parental-leave:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Ett fel uppstod" 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
