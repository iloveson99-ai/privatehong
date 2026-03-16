// Korean tax calculation for US stocks (FIFO and Moving Average methods)

export interface Transaction {
  id: string;
  ticker: string;
  name: string;
  market: string;
  type: 'BUY' | 'SELL' | 'DIVIDEND';
  quantity: number | null;
  price: number; // KRW
  price_usd: number | null;
  exchange_rate: number | null;
  realized_gain: number | null;
  transaction_date: string;
  settlement_date: string;
}

export interface TaxCalculationResult {
  fifoGain: number;
  fifoTax: number;
  movingAvgGain: number;
  movingAvgTax: number;
  recommendedMethod: 'fifo' | 'movingAverage';
  netGainUsed: number;
  deductionUsed: number;
}

export interface TradeImpactResult {
  estimatedGain: number;
  estimatedAdditionalTax: number;
  currentYTDGain: number;
  newYTDGain: number;
}

const BASIC_DEDUCTION = 2_500_000; // KRW
const TAX_RATE = 0.22;

function calculateTax(gain: number): number {
  const taxableGain = Math.max(0, gain - BASIC_DEDUCTION);
  return taxableGain * TAX_RATE;
}

// FIFO: match sells to earliest buys
function calculateFIFOGain(transactions: Transaction[]): number {
  // Group by ticker
  const byTicker: Record<string, Transaction[]> = {};
  for (const tx of transactions) {
    if (!byTicker[tx.ticker]) byTicker[tx.ticker] = [];
    byTicker[tx.ticker].push(tx);
  }

  let totalGain = 0;

  for (const ticker of Object.keys(byTicker)) {
    const txs = byTicker[ticker].sort(
      (a, b) => new Date(a.settlement_date).getTime() - new Date(b.settlement_date).getTime()
    );

    // Queue of buy lots: [{ quantity, price_krw }]
    const buyQueue: Array<{ quantity: number; price: number }> = [];

    for (const tx of txs) {
      if (tx.type === 'BUY' && tx.quantity != null) {
        buyQueue.push({ quantity: tx.quantity, price: tx.price });
      } else if (tx.type === 'SELL' && tx.quantity != null) {
        let remainingSell = tx.quantity;
        while (remainingSell > 0 && buyQueue.length > 0) {
          const lot = buyQueue[0];
          const matched = Math.min(lot.quantity, remainingSell);
          totalGain += matched * (tx.price - lot.price);
          lot.quantity -= matched;
          remainingSell -= matched;
          if (lot.quantity === 0) buyQueue.shift();
        }
      }
    }
  }

  return totalGain;
}

// Moving Average: running weighted average cost
function calculateMovingAvgGain(transactions: Transaction[]): number {
  const byTicker: Record<string, Transaction[]> = {};
  for (const tx of transactions) {
    if (!byTicker[tx.ticker]) byTicker[tx.ticker] = [];
    byTicker[tx.ticker].push(tx);
  }

  let totalGain = 0;

  for (const ticker of Object.keys(byTicker)) {
    const txs = byTicker[ticker].sort(
      (a, b) => new Date(a.settlement_date).getTime() - new Date(b.settlement_date).getTime()
    );

    let totalQty = 0;
    let totalCost = 0; // KRW

    for (const tx of txs) {
      if (tx.type === 'BUY' && tx.quantity != null) {
        totalCost += tx.quantity * tx.price;
        totalQty += tx.quantity;
      } else if (tx.type === 'SELL' && tx.quantity != null) {
        if (totalQty <= 0) continue;
        const avgCost = totalCost / totalQty;
        totalGain += tx.quantity * (tx.price - avgCost);
        totalQty -= tx.quantity;
        totalCost = totalQty * avgCost;
        if (totalQty < 0) totalQty = 0;
        if (totalCost < 0) totalCost = 0;
      }
    }
  }

  return totalGain;
}

export function calculateUSStockTax(
  transactions: Transaction[],
  year: number
): TaxCalculationResult {
  if (!transactions || transactions.length === 0) {
    return {
      fifoGain: 0,
      fifoTax: 0,
      movingAvgGain: 0,
      movingAvgTax: 0,
      recommendedMethod: 'fifo',
      netGainUsed: 0,
      deductionUsed: 0,
    };
  }

  const yearTxs = transactions.filter((tx) => {
    const txYear = new Date(tx.settlement_date).getFullYear();
    return txYear === year && tx.market === 'US';
  });

  const fifoGain = calculateFIFOGain(yearTxs);
  const movingAvgGain = calculateMovingAvgGain(yearTxs);

  const fifoTax = calculateTax(fifoGain);
  const movingAvgTax = calculateTax(movingAvgGain);

  const recommendedMethod = fifoTax <= movingAvgTax ? 'fifo' : 'movingAverage';
  const netGainUsed = recommendedMethod === 'fifo' ? fifoGain : movingAvgGain;
  const deductionUsed = Math.min(BASIC_DEDUCTION, Math.max(0, netGainUsed));

  return {
    fifoGain,
    fifoTax,
    movingAvgGain,
    movingAvgTax,
    recommendedMethod,
    netGainUsed,
    deductionUsed,
  };
}

export function estimateTradeImpact(
  ticker: string,
  quantity: number,
  currentPrice: number, // KRW
  exchangeRate: number,
  holdings: Array<{ ticker: string; quantity: number; avg_cost: number }>,
  transactions: Transaction[],
  year: number
): TradeImpactResult {
  const holding = holdings.find((h) => h.ticker === ticker);
  const avgCostKRW = holding ? holding.avg_cost : 0;

  const estimatedGain = quantity * (currentPrice - avgCostKRW);

  // Current YTD gain from existing transactions
  const existing = calculateUSStockTax(transactions, year);
  const currentYTDGain = existing.netGainUsed;
  const newYTDGain = currentYTDGain + estimatedGain;

  const currentTax = calculateTax(currentYTDGain);
  const newTax = calculateTax(newYTDGain);
  const estimatedAdditionalTax = Math.max(0, newTax - currentTax);

  return {
    estimatedGain,
    estimatedAdditionalTax,
    currentYTDGain,
    newYTDGain,
  };
}
