# ChartView

빗썸 공개 API로 만든 트레이딩뷰 스타일의 실시간 코인 차트 웹앱입니다.

데모: https://rkdntm1.github.io/TradingChart_byClaude/

## 기능

- **실시간 캔들 차트**: 1분 / 5분 / 15분 / 1시간 / 4시간 / 일 / 주봉, 거래량 히스토그램
  - 체결(trade) WebSocket으로 현재 캔들을 실시간 갱신
  - 왼쪽으로 스크롤하면 과거 캔들을 자동으로 추가 로딩
  - 크로스헤어 위치의 시가/고가/저가/종가/거래량 표시
- **보조지표**: 이동평균(5·20·60·120), 볼린저밴드(20, 2), RSI(14), MACD(12, 26, 9)
- **드로잉 도구**: 추세선, 연장선, 수평선, 피보나치 되돌림, 사각형
  - 두 번 클릭으로 그리기, 드로잉 클릭으로 선택 → `Delete`로 삭제, `Esc`로 취소
  - 선택한 드로잉의 끝점(핸들) 드래그로 수정, 본체 드래그로 이동
  - 스타일 바에서 색상(6색)·실선/점선 변경
  - 종목별로 저장되며, 기간을 바꿔도 같은 시점·가격에 유지
- **가격 알림**: 헤더의 🔔 버튼 또는 차트 왼쪽 알림 도구(차트에서 가격 클릭)로 설정
  - 목표가가 현재가보다 높으면 상승 돌파, 낮으면 하락 돌파 시 알림 (방향 자동)
  - 화면 안 토스트 + 알림음 + 브라우저 알림(허용 시), 차트에 노란 점선 표시
  - 보고 있는 종목이 아니어도 원화 마켓 전체를 감시, 발생 기록 보관
- **원화 마켓 목록**: 전 종목 실시간 시세, 검색(한글/영문/심볼), 관심종목(★)
- 선택한 종목·기간·지표를 브라우저에 기억
- 다크/라이트 모드 자동 전환, 모바일 레이아웃

## 실행

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/ 에 정적 파일 생성
```

API 키가 필요 없습니다. 브라우저에서 빗썸 API(`api.bithumb.com`)를 직접 호출합니다.

> 처음에는 업비트 API를 썼지만, 업비트는 브라우저에서 보낸 요청(Origin 헤더 포함)을 10초당 1회로 제한해서 배포 사이트에서 시세를 불러올 수 없었습니다. 빗썸 v1 API는 업비트와 형식이 거의 같고 브라우저에서 바로 호출할 수 있어서 전환했습니다.

## 배포 (GitHub Pages)

`main`에 push하면 GitHub Actions(`.github/workflows/deploy.yml`)가 빌드해서 GitHub Pages에 배포합니다.

- 주소: https://rkdntm1.github.io/TradingChart_byClaude/
- 최초 1회 설정: 저장소 **Settings → Pages → Build and deployment → Source** 를 **GitHub Actions** 로 선택
- `vite.config.ts`의 `base: './'` 덕분에 하위 경로에서도 정적 파일이 올바르게 로드됩니다.

## 구조

```
src/
  lib/bithumb.ts          빗썸 REST/WebSocket 클라이언트, KST 캔들 버킷 계산, 재시도, 포맷터
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
- 빗썸 공개 API v1 (시세 조회는 인증 불필요)

## 다음 단계 아이디어

- 드로잉 실행취소/다시실행, 텍스트 메모
- 호가창 / 체결 내역 패널
- 탭을 닫아도 오는 알림 (서버 + 웹 푸시)
- 회원 기능 + 백엔드에 차트 설정 저장
- 국내/해외 주식 데이터 소스 추가

> 시세 데이터의 상업적 재배포에는 데이터 제공처의 약관을 확인하세요.
