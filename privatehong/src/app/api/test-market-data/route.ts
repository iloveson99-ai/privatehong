import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { collectMarketData } from '@/lib/market-data';

export async function GET(): Promise<NextResponse> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: holdings } = await supabase.from('portfolio_holdings').select('*');
  const safeHoldings = (holdings ?? []) as Parameters<typeof collectMarketData>[0];

  const marketData = await collectMarketData(safeHoldings);

  return NextResponse.json({ ok: true, marketData });
}
