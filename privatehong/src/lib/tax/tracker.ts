import type { SupabaseClient } from '@supabase/supabase-js';
import { calculateUSStockTax } from './calculator';
import type { Transaction } from './calculator';

export interface TaxSummary {
  ytdGain: number;
  ytdLoss: number;
  netGain: number;
  deductionRemaining: number;
  estimatedTax: number;
  comprehensiveTaxWarning: boolean;
}

const BASIC_DEDUCTION = 2_500_000;
const COMPREHENSIVE_TAX_THRESHOLD = 20_000_000; // 2천만 원

export async function updateTaxTracker(supabase: SupabaseClient, year: number): Promise<void> {
  // Fetch all transactions for this year
  const { data: transactions, error } = await supabase
    .from('transactions')
    .select('*')
    .gte('settlement_date', `${year}-01-01`)
    .lte('settlement_date', `${year}-12-31`);

  if (error) throw new Error(`Failed to fetch transactions: ${error.message}`);
  if (!transactions || transactions.length === 0) return;

  const txList = transactions as Transaction[];

  // Calculate gains/losses for US market sells
  const usSells = txList.filter((t) => t.market === 'US' && t.type === 'SELL');
  const ytdRealizedGain = usSells
    .filter((t) => (t.realized_gain ?? 0) > 0)
    .reduce((sum, t) => sum + (t.realized_gain ?? 0), 0);
  const ytdRealizedLoss = Math.abs(
    usSells
      .filter((t) => (t.realized_gain ?? 0) < 0)
      .reduce((sum, t) => sum + (t.realized_gain ?? 0), 0)
  );

  // Dividend income
  const ytdDividend = txList
    .filter((t) => t.type === 'DIVIDEND')
    .reduce((sum, t) => sum + t.price, 0);

  // Estimated tax using recommended method
  const taxResult = calculateUSStockTax(txList, year);
  const estimatedTax = Math.min(taxResult.fifoTax, taxResult.movingAvgTax);

  await supabase.from('tax_tracker').upsert({
    year,
    ytd_realized_gain_us: ytdRealizedGain,
    ytd_realized_loss_us: ytdRealizedLoss,
    ytd_dividend_income: ytdDividend,
    estimated_tax: estimatedTax,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'year' });
}

export async function getTaxSummary(supabase: SupabaseClient, year: number): Promise<TaxSummary> {
  const { data, error } = await supabase
    .from('tax_tracker')
    .select('*')
    .eq('year', year)
    .single();

  if (error || !data) {
    // Return zeroed summary if no record exists yet
    return {
      ytdGain: 0,
      ytdLoss: 0,
      netGain: 0,
      deductionRemaining: BASIC_DEDUCTION,
      estimatedTax: 0,
      comprehensiveTaxWarning: false,
    };
  }

  const ytdGain: number = data.ytd_realized_gain_us ?? 0;
  const ytdLoss: number = data.ytd_realized_loss_us ?? 0;
  const netGain = ytdGain - ytdLoss;
  const deductionRemaining = Math.max(0, BASIC_DEDUCTION - netGain);
  const estimatedTax: number = data.estimated_tax ?? 0;

  const totalFinancialIncome =
    (data.ytd_dividend_income ?? 0) + (data.ytd_interest_income ?? 0);
  const comprehensiveTaxWarning = totalFinancialIncome >= COMPREHENSIVE_TAX_THRESHOLD * 0.8; // warn at 80%

  return {
    ytdGain,
    ytdLoss,
    netGain,
    deductionRemaining,
    estimatedTax,
    comprehensiveTaxWarning,
  };
}
