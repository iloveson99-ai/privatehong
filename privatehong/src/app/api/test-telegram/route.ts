import { NextResponse } from 'next/server';
import { sendMessage } from '@/lib/telegram';

export async function GET(): Promise<NextResponse> {
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const dateTimeStr = kstNow.toISOString().replace('T', ' ').substring(0, 19) + ' KST';

  await sendMessage(`🔧 텔레그램 연결 테스트 성공! ${dateTimeStr}`);

  return NextResponse.json({ success: true, sentAt: dateTimeStr });
}
