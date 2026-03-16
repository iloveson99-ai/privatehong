// Loss harvesting opportunity finder

export interface HarvestingOpportunity {
  ticker: string;
  name: string;
  unrealizedLoss: number; // KRW
  potentialTaxSaving: number; // KRW
  urgent: boolean; // November or December
}

export interface HoldingWithQuote {
  ticker: string;
  name: string;
  market: 'US' | 'KR';
  quantity: number;
  avg_cost: number; // KRW avg cost
  avg_cost_usd: number | null;
}

export interface CurrentQuote {
  ticker: string;
  price: number; // KRW
}

export interface TaxState {
  ytdGain: number;
  ytdLoss: number;
  netGain: number;
  estimatedTax: number;
}

export function findHarvestingOpportunities(
  holdings: HoldingWithQuote[],
  currentQuotes: Record<string, CurrentQuote>,
  taxState: TaxState
): HarvestingOpportunity[] {
  if (!holdings || holdings.length === 0) return [];

  const currentMonth = new Date().getMonth() + 1; // 1-12
  const isUrgent = currentMonth >= 11; // November or December

  const opportunities: HarvestingOpportunity[] = [];

  for (const holding of holdings) {
    if (holding.market !== 'US') continue; // Only US stocks have capital gains tax

    const quote = currentQuotes[holding.ticker];
    if (!quote) continue;

    const currentPriceKRW = quote.price;
    const avgCostKRW = holding.avg_cost;

    if (currentPriceKRW >= avgCostKRW) continue; // No unrealized loss

    const unrealizedLoss = holding.quantity * (avgCostKRW - currentPriceKRW);
    if (unrealizedLoss <= 0) continue;

    // Tax saving = loss amount * 22%, but only up to current YTD gain
    const maxOffsetableGain = Math.max(0, taxState.netGain);
    const effectiveLoss = Math.min(unrealizedLoss, maxOffsetableGain);
    const potentialTaxSaving = effectiveLoss * 0.22;

    opportunities.push({
      ticker: holding.ticker,
      name: holding.name,
      unrealizedLoss,
      potentialTaxSaving,
      urgent: isUrgent,
    });
  }

  // Sort by potential tax saving descending
  opportunities.sort((a, b) => b.potentialTaxSaving - a.potentialTaxSaving);

  return opportunities;
}
