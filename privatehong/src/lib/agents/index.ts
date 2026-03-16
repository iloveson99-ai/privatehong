import { analyzeConservative } from './conservative-agent';
import { analyzeAggressive } from './aggressive-agent';
import { synthesizeRecommendation, TaxTrackerState } from './leader-agent';
import type { MarketData, PortfolioHolding } from '../market-data';
import type { ConservativeAnalysis, AggressiveAnalysis, LeaderRecommendation } from './types';

export type { ConservativeAnalysis, AggressiveAnalysis, LeaderRecommendation };
export type { TaxTrackerState };

export interface AgentResults {
  conservative: ConservativeAnalysis | null;
  aggressive: AggressiveAnalysis | null;
  leader: LeaderRecommendation;
  providerUsed: string;
}

export async function runAllAgents(
  marketData: MarketData,
  portfolio: PortfolioHolding[],
  taxTracker: TaxTrackerState
): Promise<AgentResults> {
  // Step 1: Conservative analysis
  let conservative: ConservativeAnalysis | null = null;
  try {
    console.log('[agents] Running conservative agent...');
    conservative = await analyzeConservative(marketData, portfolio);
    console.log('[agents] Conservative agent done');
  } catch (err) {
    console.error('[agents] Conservative agent failed:', err);
  }

  // Step 2: Aggressive analysis
  let aggressive: AggressiveAnalysis | null = null;
  try {
    console.log('[agents] Running aggressive agent...');
    aggressive = await analyzeAggressive(marketData, portfolio);
    console.log('[agents] Aggressive agent done');
  } catch (err) {
    console.error('[agents] Aggressive agent failed:', err);
  }

  // Step 3: Leader synthesis (fatal if fails)
  console.log('[agents] Running leader agent...');
  const leader = await synthesizeRecommendation(
    conservative,
    aggressive,
    marketData,
    portfolio,
    taxTracker
  );
  console.log('[agents] Leader agent done');

  return {
    conservative,
    aggressive,
    leader,
    providerUsed: 'gemini',
  };
}
