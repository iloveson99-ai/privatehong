export interface AIMessage {
  role: 'system' | 'user';
  content: string;
}

export interface AIResponse {
  text: string;
  provider: string;
}

export interface AICallOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}
