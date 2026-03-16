// Seed initial portfolio holdings into Supabase
// Run with: npx tsx src/scripts/seed-portfolio.ts
// Edit the holdings array below with actual positions before running!

import { createClient } from '@supabase/supabase-js';

// Load env from .env.local if running locally
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  console.error('Set them as environment variables before running this script.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ═══════════════════════════════════════════════════════════
// TODO: Edit these with actual holdings before running!
// avg_cost = average purchase price in KRW
// avg_cost_usd = average purchase price in USD (US stocks only)
// ═══════════════════════════════════════════════════════════
const holdings = [
  // === 미국주식 (키움증권) ===
  { ticker: 'AAPL', name: 'Apple', market: 'US' as const, quantity: 100, avg_cost: 230000, avg_cost_usd: 165 },
  { ticker: 'NVDA', name: 'NVIDIA', market: 'US' as const, quantity: 50, avg_cost: 580000, avg_cost_usd: 420 },
  { ticker: 'MSFT', name: 'Microsoft', market: 'US' as const, quantity: 30, avg_cost: 550000, avg_cost_usd: 395 },
  // === 한국주식 (하나투자증권) ===
  { ticker: '005930', name: '삼성전자', market: 'KR' as const, quantity: 200, avg_cost: 82000, avg_cost_usd: null },
  { ticker: '000660', name: 'SK하이닉스', market: 'KR' as const, quantity: 50, avg_cost: 155000, avg_cost_usd: null },
];

async function seed() {
  console.log('🌱 Seeding portfolio holdings...');

  for (const holding of holdings) {
    const { error } = await supabase
      .from('portfolio_holdings')
      .upsert(holding, { onConflict: 'ticker' });

    if (error) {
      console.error(`  ❌ Failed to upsert ${holding.ticker}:`, error.message);
    } else {
      console.log(`  ✅ ${holding.ticker} — ${holding.name} (${holding.quantity}주)`);
    }
  }

  // Seed tax_tracker for current year
  const year = new Date().getFullYear();
  console.log(`\n🌱 Seeding tax_tracker for ${year}...`);
  const { error: taxError } = await supabase.from('tax_tracker').upsert({
    year,
    ytd_realized_gain_us: 0,
    ytd_realized_loss_us: 0,
    ytd_dividend_income: 0,
    ytd_interest_income: 0,
    estimated_tax: 0,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'year' });

  if (taxError) {
    console.error('  ❌ tax_tracker seed failed:', taxError.message);
  } else {
    console.log(`  ✅ tax_tracker ${year} initialized`);
  }

  console.log('\n✨ Done!');
}

seed().catch(console.error);
