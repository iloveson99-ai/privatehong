export interface Recommendation {
  ticker: string;
  name: string;
  action: '매수' | '매도' | '보유' | '비중축소' | '비중확대';
  reason: string;
  conviction: '상' | '중' | '하';
}

export interface ConservativeAnalysis {
  market_assessment: string;
  key_issues: string[];
  recommendations: Recommendation[];
  risk_warnings: string[];
  cash_ratio_suggestion: string;
}

export type AggressiveAnalysis = ConservativeAnalysis;

export interface LeaderAction {
  ticker: string;
  name: string;
  action: string;
  quantity_or_amount: string;
  reason: string;
  tax_impact: string;
}

export interface TaxAlert {
  ytd_realized_gain: number;
  remaining_deduction: number;
  estimated_annual_tax: number;
  tax_saving_opportunities: string[];
}

export interface LeaderRecommendation {
  summary: string;
  market_outlook: string;
  actions: LeaderAction[];
  tax_alert: TaxAlert;
  risk_level: '안전' | '보통' | '주의' | '위험';
  next_watch: string[];
}
