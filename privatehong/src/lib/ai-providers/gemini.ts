import { GoogleGenerativeAI } from '@google/generative-ai';
import type { AIMessage, AIResponse, AICallOptions } from './types';

const DEFAULT_MODEL = 'gemini-2.5-flash-preview-05-20';

export async function callGemini(messages: AIMessage[], options: AICallOptions = {}): Promise<AIResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const genAI = new GoogleGenerativeAI(apiKey);
  const modelName = options.model ?? DEFAULT_MODEL;

  // Separate system message from user messages
  const systemMessage = messages.find((m) => m.role === 'system');
  const userMessages = messages.filter((m) => m.role === 'user');

  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: systemMessage?.content,
    generationConfig: {
      temperature: options.temperature ?? 0.5,
      maxOutputTokens: options.maxTokens ?? 4096,
    },
  });

  const prompt = userMessages.map((m) => m.content).join('\n\n');
  const result = await model.generateContent(prompt);
  const text = result.response.text();

  return { text, provider: 'gemini' };
}
