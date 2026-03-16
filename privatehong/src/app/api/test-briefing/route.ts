export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { collectMarketData } from '@/lib/market-data';
import { runAllAgents } from '@/lib/agents';
import { formatMorningBriefing } from '@/lib/formatters/briefing-formatter';
import { sendMessage } from '@/lib/telegram';
import { getTaxSummary } from '@/lib/tax/tracker';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const shouldSend = req.nextUrl.searchParams.get('send') === 'true';

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const year = new Date().getFullYear();

  const { data: holdings } = await supabase.from('portfolio_holdings').select('*');
  const safeHoldings = (holdings ?? []) as Parameters<typeof collectMarketData>[0];

  const taxSummary = await getTaxSummary(supabase, year);
  const taxTracker = {
    ytd_realized_gain_us: taxSummary.ytdGain,
    ytd_realized_loss_us: taxSummary.ytdLoss,
    ytd_dividend_income: 0,
    estimated_tax: taxSummary.estimatedTax,
  };

  const marketData = await collectMarketData(safeHoldings);
  const { conservative, aggressive, leader, providerUsed } = await runAllAgents(
    marketData,
    safeHoldings,
    taxTracker
  );

  const briefingText = formatMorningBriefing(leader, conservative, aggressive);

  if (shouldSend) {
    await sendMessage(briefingText);
  }

  return NextResponse.json({
    ok: true,
    providerUsed,
    briefingText,
    conservative,
    aggressive,
    leader,
    marketData,
  });
}
