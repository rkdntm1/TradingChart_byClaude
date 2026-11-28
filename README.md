# ChartView

트레이딩뷰 스타일의 실시간 차트 웹앱입니다. 코인은 빗썸(원화)·바이낸스(USDT) 공개 API, 미국 주식은 Alpaca 시세를 Cloudflare Worker로 중계해 보여줍니다.

데모: https://rkdntm1.github.io/TradingChart_byClaude/

## 기능

- **실시간 캔들 차트**: 1분 / 3분 / 5분 / 15분 / 30분 / 1시간 / 4시간 / 일 / 주봉, 거래량 히스토그램
  - 체결(trade) WebSocket으로 현재 캔들을 실시간 갱신
  - 왼쪽으로 스크롤하면 과거 캔들을 자동으로 추가 로딩
  - 크로스헤어 위치의 시가/고가/저가/종가/등락률/거래량과 지표 값 표시 (RSI·MACD는 각 영역에)
  - 현재 봉 마감 카운트다운, log / % 가격 축, 과거로 스크롤했을 때 "최신 ⇥" 버튼
- **보조지표**: 이동평균(5·20·60·120), 볼린저밴드(20, 2), RSI(14), MACD(12, 26, 9)
  - 툴바 **⚙ 설정**에서 기간 변경: 이동평균 SMA/EMA·기간 4개, 볼린저 기간·배수, RSI 기간·과매수/과매도선, MACD 단기·장기·시그널
- **드로잉 도구**: 추세선, 연장선, 수평선, 피보나치 되돌림, 사각형, 텍스트 메모, 측정(가격·%·봉 수·기간)
  - `Ctrl+Z` / `Ctrl+Y`로 실행취소·다시실행 (최대 50단계)
  - 자석 모드: 점이 가까운 시가/고가/저가/종가에 붙음
  - 두 번 클릭으로 그리기, 드로잉 클릭으로 선택 → `Delete`로 삭제, `Esc`로 취소
  - 선택한 드로잉의 끝점(핸들) 드래그로 수정, 본체 드래그로 이동
  - 스타일 바에서 색상(6색)·실선/점선 변경
  - 종목별로 저장되며, 기간을 바꿔도 같은 시점·가격에 유지
- **가격 알림**: 헤더의 🔔 버튼 또는 차트 왼쪽 알림 도구(차트에서 가격 클릭)로 설정
  - 목표가가 현재가보다 높으면 상승 돌파, 낮으면 하락 돌파 시 알림 (방향 자동)
  - 화면 안 토스트 + 알림음 + 브라우저 알림(허용 시), 차트에 노란 점선 표시
  - 보고 있는 종목이 아니어도 원화·USDT 전 종목을 감시, 발생 기록 보관
- **마켓 목록**: [원화 · 빗썸] 약 490종목 / [USDT · 바이낸스] 약 530종목 / [미국주식] 41종목 / [관심] 탭, 실시간 시세, 검색(한글/영문/심볼), 관심종목(★)
  - 바이낸스 종목에도 빗썸의 한글 이름을 심볼 기준으로 붙여 표시
  - 현재가·등락률·거래대금 열을 눌러 정렬 (급등락 종목 찾기)
  - 미국주식은 헤더에 정규장 / 프리·애프터 / 장 마감 / 휴장 상태와 최근 체결 시각 표시
  - 미국주식: 인기 종목·ETF 41개(애플, 엔비디아, 테슬라, SPY, QQQ…), Alpaca 무료 시세(IEX 기준), 몇 초 간격 갱신
  - 미국주식 탭에서 검색하면 미국 상장 전 종목(약 13,000개)에서 찾아 **+ 추가** 가능 (최대 59개, 추가한 종목은 "빼기"로 제거)
  - 가격 자릿수와 거래대금 단위는 마켓에 맞춰 표시 (원화: 억/조, USDT: 거래소 호가 단위, $M/$B)
- **여러 차트 동시 보기**: 차트 1개 · 좌우 2개 · 위아래 2개 · 2×2. 차트마다 종목/시간봉을 따로 저장하고, 클릭한 활성 차트가 헤더·종목 목록·단축키의 대상이 됨. 같은 종목 차트끼리 드로잉 동기화 (휴대폰에서는 활성 차트만 표시)
- **키보드 단축키** (`?`로 목록 보기): `1`~`9` 시간봉, `T`/`R`/`H`/`F`/`B`/`N`/`M`/`A` 드로잉 도구, `G` 자석, `L` 로그, `/` 종목 검색, `↑`/`↓` 종목 이동
- 선택한 종목·기간·지표를 브라우저에 기억
- 다크/라이트 모드 자동 전환, 모바일 레이아웃

## 실행

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/ 에 정적 파일 생성
```

API 키가 필요 없습니다. 브라우저에서 빗썸 API(`api.bithumb.com`)와 바이낸스 시세 전용 API(`data-api.binance.vision`)를 직접 호출합니다.

> 처음에는 업비트 API를 썼지만, 업비트는 브라우저에서 보낸 요청(Origin 헤더 포함)을 10초당 1회로 제한해서 배포 사이트에서 시세를 불러올 수 없었습니다. 빗썸 v1 API는 업비트와 형식이 거의 같고 브라우저에서 바로 호출할 수 있어서 전환했습니다.

## 배포 (GitHub Pages)

`main`에 push하면 GitHub Actions(`.github/workflows/deploy.yml`)가 빌드해서 GitHub Pages에 배포합니다.

- 주소: https://rkdntm1.github.io/TradingChart_byClaude/
- 최초 1회 설정: 저장소 **Settings → Pages → Build and deployment → Source** 를 **GitHub Actions** 로 선택
- `vite.config.ts`의 `base: './'` 덕분에 하위 경로에서도 정적 파일이 올바르게 로드됩니다.

## 미국 주식 (Cloudflare Worker)

미국 주식 시세는 API 키가 필요해서, 키를 숨겨 주는 Cloudflare Worker(`worker/`)를 거칩니다.

```
브라우저 ──▶ Cloudflare Worker (Alpaca 키 보관 · 짧은 캐시) ──▶ Alpaca Market Data (IEX)
```

- Worker 주소는 `.env`의 `VITE_US_STOCK_PROXY`로 지정합니다(공개 주소, 키 아님). 값이 없으면 미국주식 탭은 숨겨집니다.
- Worker 배포 (GitHub push로는 자동 배포되지 않음):

```bash
cd worker
npm install
npx wrangler login
npx wrangler deploy
npx wrangler secret put ALPACA_KEY_ID      # 최초 1회
npx wrangler secret put ALPACA_SECRET_KEY  # 최초 1회
```

> Windows PowerShell에서 `npx`가 실행 정책 때문에 막히면 `npx.cmd`를 사용하세요.

## 구조

```
src/
  lib/market/            데이터 소스 계층 (거래소와 무관한 공통 형태)
    types.ts              Market/Ticker/Candle/Trade, DataSource 인터페이스, bucketStart
    net.ts                재시도·백오프 HTTP, 자동 재연결 WebSocket
    format.ts             마켓별 가격/거래대금 포맷 (KRW / USDT)
    bithumb.ts            빗썸 어댑터 (원화, KST 기준 캔들)
    binance.ts            바이낸스 어댑터 (USDT, UTC 기준 캔들)
    usstocks.ts           미국 주식 어댑터 (Worker 경유, polling)
    index.ts              SOURCES, sourceOf(코드)
  lib/indicators.ts       SMA / EMA / 볼린저밴드 / RSI / MACD 계산
  lib/chartIndicators.ts  지표 → lightweight-charts 시리즈 연결
  lib/drawings.ts         드로잉 렌더링(series primitive), 좌표 변환, 히트 테스트, 저장
  lib/alerts.ts           가격 알림 모델·저장, 브라우저 알림, 알림음
  hooks/useAlerts.ts      실시간 시세로 알림 조건 검사 및 발동
  components/AlertPanel.tsx 알림 추가/목록/기록 패널
  components/Toasts.tsx   화면 안 알림 토스트
  components/DrawingToolbar.tsx 왼쪽 드로잉 도구 모음
  hooks/useMarketData.ts  전체 마켓 목록 + 실시간 티커
  components/Chart.tsx    캔들 차트 (실시간 갱신, 과거 데이터 로딩, 지표 pane)
  components/Watchlist.tsx 종목 목록 / 검색 / 관심종목
  App.tsx                 레이아웃, 헤더, 툴바
```

## 기술 스택

- React 19 + TypeScript + Vite
- [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts) v5 (Apache-2.0, 출처 표기 필요)
- 빗썸 공개 API v1, 바이낸스 Spot 시세 API (둘 다 인증 불필요)
- Alpaca Market Data API (무료 플랜, IEX) + Cloudflare Workers

## 다음 단계 아이디어

- 라인·하이킨아시 차트
- 종목 비교 차트, 여러 차트 십자선·스크롤 연동
- 호가창 / 체결 내역 패널
- 탭을 닫아도 오는 알림 (서버 + 웹 푸시)
- 회원 기능 + 백엔드에 차트 설정 저장
- 국내 주식 (한국투자증권 KIS API)
- 미국 주식 한글 이름 검색

> 시세 데이터의 상업적 재배포에는 데이터 제공처의 약관을 확인하세요.
