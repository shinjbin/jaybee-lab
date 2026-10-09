# JAYBEE LAB 프로젝트 인덱스

> **토스증권 전환 반영 안내:** 아래 본문은 최초 분석 당시의 KIS 구성 기록이다. 현재 구현에서는 KIS 클라이언트를 제거하고 [tossClient.js](backend/src/tossClient.js)로 인증·현재가·KOSPI 지수·일봉·수급 조회를 교체했다. 공유 토큰 저장소 [tossTokenStore.js](backend/src/tossTokenStore.js)와 `brokerage_api_tokens` 테이블을 추가했으며, 설정은 `TOSS_*`로 변경했다. 수집 창은 08:00~20:59, 최근 두 거래일을 실제 응답 날짜로 갱신한다. CI는 `npm test`로 29개 테스트를 검증한다. 최신 설정·데이터 범위·검증 한계는 [TOSS_API.md](backend/TOSS_API.md)를 기준으로 확인한다. 아래 kisClient.js와 kis-api.test.js는 전환 과정에서 제거된 과거 파일이다.

분석 기준: 2026-09-14, Git `6a5373c`. 저장소의 코드·설정에 대한 정적 분석이며 실제 운영 상태를 뜻하지 않는다. 파일 위치와 주요 함수 이름을 탐색 기준으로 사용한다.

## 1. 프로젝트 개요

국내외 금융 뉴스, 시장 지표, KOSPI 종목, 외국인·기관 수급, 증권사 리포트, AI 분석을 표시하는 개인 금융 대시보드다. 별도 Python 프로세스로 BTC 자동매매 기능을 제공한다.

| 영역 | 기술 및 진입점 | 역할 |
| --- | --- | --- |
| 프런트엔드 | React 18, Vite 5 / [main.jsx](frontend/src/main.jsx), [App.jsx](frontend/src/App.jsx) | 조회 화면, 날짜·기간 선택, 검색, 차트, 테마 |
| API | Node.js 20 컨테이너, Express 4 / [server.js](backend/server.js) | DB 초기화 후 HTTP 서버 시작 |
| 수집 워커 | API와 동일 이미지 / [worker.js](backend/worker.js) | 뉴스 수집·요약 및 수급 수집 |
| DB | PostgreSQL / [db.js](backend/src/db.js), [schema.js](backend/src/schema.js) | 원시 SQL과 pg Pool 사용 |
| 자동매매 | Python, requests, pyupbit, schedule / [main.py](bitcoin-trader/main.py) | Binance 시세 기반 Upbit 주문, Telegram 알림 |
| 배포 | Docker, Kubernetes, Kustomize, GitHub Actions, Argo CD | 이미지 빌드와 운영 동기화 |

## 2. 실행 및 데이터 흐름

```text
브라우저 → Cloudflare Tunnel → nginx
                                ├─ /      → frontend 정적 파일
                                └─ /api/* → backend:3000 (접두어 /api 제거)
                                               ├─ PostgreSQL
                                               ├─ KIS / KRX
                                               └─ Twelve Data

worker → GNews / Yahoo Finance → 기사 본문 추출 → 요약·번역 → PostgreSQL
       → KRX 종목군 → KIS 수급 조회 → PostgreSQL

관리 API → 뉴스 / 증권사 리포트 / AI 분석 등록 → PostgreSQL → 조회 화면

bitcoin-trader → Binance 일봉 → SMA·RSI 신호 → Upbit 시장가 주문
                                              └─ Telegram 알림
```

- API와 수집 워커는 시작 시 동일한 DB 스키마 초기화 SQL을 실행한다.
- 워커는 시작 직후 한 번 실행하고 기본 120분마다 뉴스 → 수급 순서로 처리한다. 동일 프로세스의 중복 주기는 `isRunning`으로 막는다.
- 정기 수급 수집 시간은 기본 KST 08:00~16:59다. 수급 서비스는 장중 추정 데이터와 종목별 일별 데이터를 시간·결과에 따라 선택한다.
- AI 시장 분석과 증권사 리포트는 현재 코드상 관리 API로 등록하고 조회한다. 이를 자동 생성·수집하는 별도 워커는 확인되지 않았다.

## 3. 백엔드 파일·함수 인덱스

| 파일 | 주요 역할·탐색 함수 |
| --- | --- |
| [app.js](backend/src/app.js) | 전체 HTTP 경로, 입력 전달, 오류 응답 / `createApp`, `parseLimit` |
| [config.js](backend/src/config.js) | 환경변수 파싱, API URL, 기능 활성화, 수집 기본값 |
| [security.js](backend/src/security.js) | 관리 키 추출·검증, 보안 헤더 / `createAdminAuthMiddleware` |
| [db.js](backend/src/db.js) | 커넥션 풀, SQL 실행, 초기화 재시도 / `query`, `initializeDatabaseWithRetry` |
| [schema.js](backend/src/schema.js) | 테이블·인덱스 생성 및 기존 스키마 변경 |
| [feedService.js](backend/src/feedService.js) | GNews·Yahoo 요청, 매핑, 중복 제거, 본문 보강 / `fetchFeedArticles` |
| [articleContentService.js](backend/src/articleContentService.js) | HTML·JSON-LD·메타데이터에서 본문 추출 / `fetchArticleContent`, `extractArticleFromHtml` |
| [newsService.js](backend/src/newsService.js) | 기사 저장·수동 등록·요약 상태·브리핑 / `runCollectionCycle`, `summarizePendingArticles`, `getLatestBriefing` |
| [summarizer.js](backend/src/summarizer.js) | AI 뉴스 요약·번역, 규칙 기반 대체 요약 / `summarizeArticle` |
| [marketIndexService.js](backend/src/marketIndexService.js) | KIS 국내 지수 및 Twelve Data 시계열 정규화 / `getMarketIndices` |
| [kisClient.js](backend/src/kisClient.js) | KIS 인증과 시세·수급 요청 공통 클라이언트 |
| [krxUniverseService.js](backend/src/krxUniverseService.js) | KOSPI 시총 데이터, Open API·기존 API 경로, 캐시 / `fetchKospiMarketCapSnapshot` |
| [investorFlowUniverseService.js](backend/src/investorFlowUniverseService.js) | 시총 기준 수집 종목군 저장·갱신 / `getInvestorFlowUniverse`, `refreshInvestorFlowUniverse` |
| [investorFlowService.js](backend/src/investorFlowService.js) | 수급 수집·금액 정규화·순위·기간별 추세 / `runInvestorFlowCollectionCycle`, `getInvestorFlowByDate` |
| [brokerageReportService.js](backend/src/brokerageReportService.js) | 리포트 단건·일괄 저장과 검색 / `saveBrokerageReport`, `getBrokerageReports` |
| [aiAnalysisService.js](backend/src/aiAnalysisService.js) | 날짜별 분석 저장·조회 / `saveAnalysis`, `getAnalysisByDate` |
| [dateUtils.js](backend/src/dateUtils.js) | 날짜 입력, 서울 시간 계산과 수집 시간 검사 |
| [utils.js](backend/src/utils.js) | 텍스트 정제, 키워드·감성·시장 영향 추정 |

## 4. API 인덱스

아래는 nginx 경유 외부 경로다. Express에 직접 연결하면 `/api`를 제외한다.

| 메서드 | 경로 | 입력·기능 | 관리 키 |
| --- | --- | --- | --- |
| GET | `/api/health` | DB 연결 포함 상태 확인 | 불필요 |
| GET | `/api/message` | 서비스 메시지와 최근 수집 실행 | 불필요 |
| GET | `/api/market-indices` | 국내외 지표 및 시계열 | 불필요 |
| GET | `/api/stocks/kospi` | KOSPI 시총 스냅샷 | 불필요 |
| GET | `/api/news` | `limit`, `category`, `date`; 최대 10건 | 불필요 |
| POST | `/api/news` | 기사 단건 등록 | 필요 |
| POST | `/api/news/bulk` | `items` 기사 일괄 등록 | 필요 |
| GET | `/api/briefing/latest` | `date` 기준 브리핑 | 불필요 |
| GET | `/api/investor-flows/kospi` | `date` 또는 `startDate`, `endDate` | 불필요 |
| POST | `/api/investor-flows/collect` | 종목군 갱신 후 수급 수집 | 필요 |
| GET | `/api/brokerage-reports` | 날짜·기간, `stockCode`, `brokerage`, `q`, `limit` | 불필요 |
| POST | `/api/brokerage-reports` | 리포트 단건 등록 | 필요 |
| POST | `/api/brokerage-reports/bulk` | `items` 리포트 일괄 등록 | 필요 |
| GET | `/api/ai-analysis` | `date` 필수, 날짜별 분석 조회 | 불필요 |
| POST | `/api/ai-analysis` | `date`, `title`, `category`, `content` | 필요 |

관리 인증은 `Authorization: Bearer …` 또는 `x-admin-api-key`를 받는다. 서버 키가 없거나 32자 미만이면 관리 경로는 503, 인증 실패는 401을 반환한다. Express JSON 본문 제한은 256KB다.

## 5. 데이터베이스 인덱스

모든 정의는 [schema.js](backend/src/schema.js)에 있다. 선언된 외래 키는 없으며 날짜·종목 코드 등으로 관련 데이터를 조회한다.

| 테이블 | 저장 내용 | 주요 식별·조회 기준 |
| --- | --- | --- |
| `news_articles` | 원문, 번역, 요약, 키워드, 감성, 요약 상태 | 고유 `checksum`, 발행일·분류·상태 인덱스 |
| `collector_runs` | 수집 시작·종료, 처리 건수, 오류 | `id`, 실행 시각 |
| `investor_flow_snapshots` | 투자자별 순매수 금액·수량, 종가, 원시 응답 | 고유 `(trade_date, market, investor_type, stock_code)` |
| `investor_flow_universe` | 시총 순위 기반 종목군과 원시 응답 | 고유 `(as_of_date, market, stock_code)` |
| `ai_market_analysis` | 날짜, 제목, 분류, Markdown 본문 | 분석 날짜 인덱스 |
| `brokerage_reports` | 증권사·애널리스트·종목·목표가·요약·원문 링크 | 비어 있지 않은 `source_key` 고유, 날짜·종목·증권사 인덱스 |

## 6. 화면 인덱스

화면 컴포넌트와 요청·상태 관리 대부분이 [App.jsx](frontend/src/App.jsx)에 있고, 스타일은 [styles.css](frontend/src/styles.css)에 집중되어 있다.

| 화면·공통 요소 | 컴포넌트·함수 |
| --- | --- |
| 메뉴·상태 | `Sidebar`, `HealthPill` |
| 날짜·기간 선택 | `CalendarPicker`, `CalendarRangePicker` |
| 시장 지표·차트 | `IndicesPanel`, `IndexCard`, `buildSparklineGeometry` |
| 뉴스 목록·상세 | `NewsPanel`, `NewsListItem`, `NewsDetail` |
| KOSPI 종목 검색 | `StockLookupPanel`, `getNaverStockChartUrl` |
| 외국인·기관 수급 | `InvestorPanel`, `FlowColumn`, `InvestorTrendCard`, `CombinedInvestorTrendCard` |
| 증권사 리포트 | `BrokerageReportsPanel` |
| AI 분석·Markdown | `AIAnalysisPanel`, `MarkdownRenderer`, `MarkdownTable` |

모바일 분기 기준은 820px이며 테마는 `localStorage`에 저장한다. 별도 라우터 의존성 없이 App의 상태를 중심으로 화면을 구성한다.

## 7. 자동매매 인덱스

| 파일 | 역할 |
| --- | --- |
| [main.py](bitcoin-trader/main.py) | 연결 확인, 시작 알림, 초기 리밸런싱, 정기 전략 실행 |
| [strategy.py](bitcoin-trader/strategy.py) | SMA·Wilder RSI 계산, 교차 신호 / `get_indicators`, `detect_signal` |
| [binance_client.py](bitcoin-trader/binance_client.py) | 기본 BTCUSDT 일봉 60개 조회 |
| [upbit_client.py](bitcoin-trader/upbit_client.py) | 잔액 조회, KRW-BTC 시장가 매수·매도 |
| [telegram_client.py](bitcoin-trader/telegram_client.py) | Telegram 메시지 전송 |
| [config.py](bitcoin-trader/config.py) | 종목, 이동평균 기간, RSI, 검사·알림 간격, 자격 증명 설정 |

기본 전략은 SMA 5/20 교차이며 RSI 14가 30 미만이면 매도를 억제한다. 정기 확인은 기본 1시간, HOLD 알림은 6시간 간격이다. 시작 시 현재 추세에 맞춰 리밸런싱하며, 매수는 KRW 잔액의 기본 99.9%, 매도는 BTC 잔액 전체를 사용한다. `RSI_BUY_THRESHOLD`는 설정에 있지만 현재 전략에서 사용하지 않는다.

## 8. 설정·실행·배포 탐색

- 환경변수 예시: [.env.example](.env.example). 실제 기본값은 [backend config](backend/src/config.js), [trader config](bitcoin-trader/config.py), 배포 주입값은 [ConfigMap](k8s/base/configmap.yaml)을 함께 확인한다.
- 뉴스: `NEWS_*`, `GNEWS_*`, `YAHOO_FINANCE_*`; AI 요약: `OPENAI_*`; 지수: `TWELVE_DATA_*`; 수급·종목: `KIS_*`, `KRX_*`.
- DB·관리 API: `DATABASE_URL`, `ADMIN_API_KEY`; 주문·알림: `UPBIT_*`, `BINANCE_*`, `TELEGRAM_*`.
- 로컬 Kubernetes: [루트 README](README.md), [kind 설정](k8s/kind-config.yaml), [Kubernetes 안내](k8s/README.md).
- 운영 절차: [PRODUCTION.md](k8s/PRODUCTION.md). Docker Compose는 지원하지 않는다.
- 핵심 리소스: [base kustomization](k8s/base/kustomization.yaml), [nginx](k8s/base/nginx.yaml), [PostgreSQL](k8s/base/postgres.yaml), [네트워크 정책](k8s/base/network-policy.yaml).
- 선택 리소스: [optional](k8s/optional/README.md); 운영 구성: [prod overlay](k8s/overlays/prod/kustomization.yaml).
- Secret 템플릿과 적용 안내: [secrets README](k8s/secrets/README.md).
- CI: [deploy.yml](.github/workflows/deploy.yml). main의 서비스 코드 변경 또는 수동 실행 → 프런트 빌드·백엔드 단위 테스트 → GHCR 이미지 게시 → prod 이미지 태그 커밋.
- CD: [Argo CD Application](k8s/argocd/application.yaml)이 main의 prod overlay를 자동 동기화하며 prune·selfHeal을 사용한다.
- 관측: [monitoring README](k8s/monitoring/README.md), [Argo Telegram 알림](k8s/argocd/TELEGRAM.md). nginx의 `/monitoring/`은 404 처리한다.

개별 개발 명령은 backend의 `npm start`, `npm run worker`, frontend의 `npm run dev`, `npm run build`다. backend 서버는 `.env`를 자동 로드하지 않으므로 환경변수를 별도로 주입해야 한다. 프런트는 `/api` 상대 경로를 사용하지만 현재 Vite 개발 서버에는 API proxy 설정이 없어 단독 실행 시 별도 연결 구성이 필요하다.

## 9. 확인된 구현 특성 및 후속 분석 지점

1. **큰 파일에 기능 집중:** App.jsx 2,311줄, styles.css 1,710줄, investorFlowService.js 1,248줄, newsService.js 753줄. 변경 시 위 컴포넌트·함수 단위로 접근하면 범위를 좁힐 수 있다.
2. **DB 초기화의 데이터 삭제 경로:** 기존 `ai_market_analysis`에 `model` 열이 있으면 시작 시 해당 테이블을 DROP 후 재생성한다. 기존 DB를 연결하는 작업 전에 확인해야 할 실제 코드 경로다.
3. **자동매매 운영 설정:** base에서는 replicas 0이지만 prod overlay는 1이다. 초기 리밸런싱이 실제 주문으로 이어질 수 있고, 현재 코드에는 모의 주문 모드가 없다.
4. **지수 표시의 데이터 원천:** 기본 NASDAQ·DOW·S&P 500 표시는 각각 QQQ·DIA·SPY ETF 시계열에 대응한다. 지수 원시값과 구분해서 해석해야 한다.
5. **요약 fallback의 번역 한계:** 키가 없거나 AI 요청이 실패하면 규칙 요약을 사용하며 번역 필드에 원문을 넣는다. 한국어 번역을 보장하지 않는다.
6. **수집 중복 제어 범위:** 워커의 실행 중 플래그는 프로세스 내부 상태다. 복제 수 확대나 수동 수집과의 동시 실행을 검토할 때 DB 수준 조정 여부를 추가 확인해야 한다.
7. **CI 테스트 범위:** CI는 `test:unit`만 실행한다. 기본 `npm test`에 포함된 feed-service 테스트는 현재 CI 단계에 포함되지 않는다.

## 10. 검증 기록

- 실행: `node --test backend/tests/feed-service.test.js backend/tests/unit.test.js`
- 결과: **18개 테스트 통과, 실패 0**. 날짜·설정·관리 인증·뉴스 피드 helper와 모의 fetch 경로 검증.
- [KIS 테스트](backend/tests/kis-api.test.js)와 [KRX 테스트](backend/tests/krx-api.test.js)는 루트 `.env` 읽기와 외부 API 연결이 포함된 별도 테스트다. 이번 인덱싱에서는 실행하지 않았다.
- 프런트 빌드, DB 통합, 배포 상태, 자동매매 실행은 검증하지 않았다. 이번 작업은 이 인덱스 문서만 추가했다.
