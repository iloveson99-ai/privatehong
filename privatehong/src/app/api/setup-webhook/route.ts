import { NextResponse } from 'next/server';
import { Bot } from 'grammy';

export async function GET(): Promise<NextResponse> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN is not set' }, { status: 500 });
  }

  // VERCEL_URL은 배포마다 바뀌는 URL이라 production URL이 우선되어야 함
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (!appUrl) {
    return NextResponse.json({ error: 'NEXT_PUBLIC_APP_URL or VERCEL_URL not set' }, { status: 500 });
  }

  const webhookUrl = `${appUrl.startsWith('http') ? appUrl : `https://${appUrl}`}/api/webhook`;

  const bot = new Bot(token);
  await bot.api.setWebhook(webhookUrl, {
    allowed_updates: ['message'],
  });

  const info = await bot.api.getWebhookInfo();

  return NextResponse.json({
    success: true,
    webhook_url: webhookUrl,
    webhook_info: info,
  });
}
