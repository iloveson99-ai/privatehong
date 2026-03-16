-- Migration: 001_initial_schema
-- Run manually in Supabase SQL Editor

-- 1. portfolio_holdings
CREATE TABLE IF NOT EXISTS portfolio_holdings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker text NOT NULL,
  name text NOT NULL,
  market text NOT NULL CHECK (market IN ('US', 'KR')),
  quantity integer NOT NULL,
  avg_cost numeric NOT NULL,
  avg_cost_usd numeric,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. daily_briefings
CREATE TABLE IF NOT EXISTS daily_briefings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date UNIQUE NOT NULL,
  conservative_analysis jsonb,
  aggressive_analysis jsonb,
  leader_recommendation jsonb,
  market_data_snapshot jsonb,
  provider_used text,
  created_at timestamptz DEFAULT now()
);

-- 3. transactions
CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker text NOT NULL,
  name text NOT NULL,
  market text NOT NULL,
  type text NOT NULL CHECK (type IN ('BUY', 'SELL', 'DIVIDEND')),
  quantity integer,
  price numeric NOT NULL,
  price_usd numeric,
  exchange_rate numeric,
  realized_gain numeric,
  transaction_date date NOT NULL,
  settlement_date date NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- 4. tax_tracker
CREATE TABLE IF NOT EXISTS tax_tracker (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year integer UNIQUE NOT NULL,
  ytd_realized_gain_us numeric DEFAULT 0,
  ytd_realized_loss_us numeric DEFAULT 0,
  ytd_dividend_income numeric DEFAULT 0,
  ytd_interest_income numeric DEFAULT 0,
  estimated_tax numeric DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

-- 5. chat_messages
CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direction text NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  message_text text NOT NULL,
  parsed_action jsonb,
  created_at timestamptz DEFAULT now()
);

-- 6. conversation_state
CREATE TABLE IF NOT EXISTS conversation_state (
  chat_id text PRIMARY KEY,
  state jsonb NOT NULL,
  updated_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_transactions_ticker_settlement ON transactions (ticker, settlement_date);
CREATE INDEX IF NOT EXISTS idx_daily_briefings_date ON daily_briefings (date);
