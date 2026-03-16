# 어머니의 AI 주식 투자 어드바이저 봇 🤖📈

매일 아침 한국/미국 시장을 분석해 텔레그램으로 투자 브리핑을 보내드리는 AI 봇입니다.

## 기술 스택

- **프레임워크**: Next.js 15 (App Router) + TypeScript
- **호스팅**: Vercel (Hobby Plan)
- **DB**: Supabase (PostgreSQL)
- **텔레그램**: grammY
- **AI**: Google Gemini 2.5 Flash/Pro
- **미국 시장 데이터**: Finnhub API
- **한국 뉴스**: Naver Open API
- **환율**: open.er-api.com (무료)

---

## 환경 변수

Vercel 대시보드 → Settings → Environment Variables에 모두 등록하세요.

| 변수명 | 설명 | 발급 방법 |
|--------|------|-----------|
| `TELEGRAM_BOT_TOKEN` | 텔레그램 봇 토큰 | BotFather → /newbot |
| `TELEGRAM_CHAT_ID` | 메시지 받을 채팅 ID | @userinfobot 에 메시지 |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL | Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | Supabase → Settings → API |
| `GEMINI_API_KEY` | Google Gemini API 키 | aistudio.google.com |
| `GROQ_API_KEY` | Groq API 키 (선택, AI 폴백) | console.groq.com |
| `FINNHUB_API_KEY` | Finnhub API 키 | finnhub.io |
| `NAVER_CLIENT_ID` | 네이버 클라이언트 ID | developers.naver.com |
| `NAVER_CLIENT_SECRET` | 네이버 클라이언트 시크릿 | developers.naver.com |
| `CRON_SECRET` | 크론 보호용 랜덤 문자열 | 직접 생성 (예: openssl rand -hex 32) |
| `NEXT_PUBLIC_APP_URL` | 배포 URL | 예: https://privatehong.vercel.app |

---

## 초기 설정 순서

### 1. 레포 클론 & 의존성 설치
```bash
git clone https://github.com/iloveson99-ai/privatehong.git
cd privatehong
npm install
```

### 2. Vercel에 환경 변수 등록
위 표의 모든 변수를 Vercel 대시보드에 등록합니다.

### 3. Supabase SQL 마이그레이션 실행
Supabase 대시보드 → SQL Editor에서 아래 파일 내용을 실행:
```
supabase/migrations/001_initial_schema.sql
```

### 4. 포트폴리오 초기 데이터 입력
`src/scripts/seed-portfolio.ts` 파일을 열어 실제 보유 종목으로 수정한 뒤:
```bash
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx src/scripts/seed-portfolio.ts
```

### 5. Vercel 배포
```bash
git push origin main
```
Vercel이 자동으로 빌드 & 배포합니다.

### 6. 웹훅 등록 (1회만)
배포 완료 후:
```
https://your-app.vercel.app/api/setup-webhook
```

### 7. 텔레그램 연결 확인
```
https://your-app.vercel.app/api/test-telegram
```
텔레그램에 테스트 메시지가 오면 성공!

### 8. 전체 브리핑 테스트
```
https://your-app.vercel.app/api/test-briefing
```
결과를 텔레그램으로 받으려면:
```
https://your-app.vercel.app/api/test-briefing?send=true
```

### 9. BotFather에서 명령어 등록
BotFather → /setcommands:
```
today - 오늘 브리핑 다시 보기
portfolio - 현재 포트폴리오
tax - 올해 세금 현황
help - 사용법 안내
```

### 10. 완료! 🎉
매일 오전 7시(KST)에 자동으로 브리핑이 전송됩니다.

---

## 거래 기록 방법

텔레그램에서 자유롭게 입력하면 AI가 이해합니다:

| 유형 | 예시 |
|------|------|
| 매수 | `애플 10주 샀어 178달러에` |
| 매수 | `삼성전자 100주 매수 82000원` |
| 매도 | `NVDA 5주 팔았어 450달러에` |
| 배당 | `AAPL 배당 50달러 들어왔어` |

입력 후 확인 메시지가 오면 **'네'** 로 확정합니다.

---

## API 엔드포인트

| 엔드포인트 | 설명 |
|-----------|------|
| `GET /api/morning-briefing` | 크론 트리거 (Authorization: Bearer {CRON_SECRET} 필요) |
| `POST /api/webhook` | 텔레그램 웹훅 수신 |
| `GET /api/setup-webhook` | 웹훅 URL 등록 (1회) |
| `GET /api/test-telegram` | 텔레그램 연결 테스트 |
| `GET /api/test-briefing` | 브리핑 전체 파이프라인 테스트 |
| `GET /api/test-market-data` | 시장 데이터 수집 테스트 |

---

## 크론 스케줄

`vercel.json`에 설정됨:
- **UTC 22:00** = **KST 07:00** 매일 실행
- 주말 및 한국 공휴일 자동 스킵
