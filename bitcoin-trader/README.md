# Binance Spot BTCUSDT 자동매매

기본 전략은 **일봉 Bollinger Breakout 49 / 1.8, Long Only**입니다.
기존 Upbit SMA/RSI 주문 및 시작 시 추세 재균형 매매는 제거했습니다.

## 매매 규칙

- `CASH`: `previousClose <= previousUpper`이고 `currentClose > currentUpper`일 때만 BUY.
- `LONG`: `currentClose < currentSMA`일 때 SELL. 상단 밴드 재진입과 하단 밴드는 사용하지 않습니다.
- 나머지는 HOLD. LONG에서 추가 매수, CASH에서 매도하지 않습니다.
- SMA와 **모집단 표준편차(`ddof=0`)**는 각 봉을 포함한 최근 설정 기간의 종가로 계산합니다.
  이전 밴드와 현재 밴드를 모두 계산하므로 기본값에서는 **마감된 50개**가 필요합니다.
- Binance 서버 시각보다 `closeTime`이 작은 봉만 사용합니다. Binance 기본 일봉은 UTC 기준으로
  마감하며, 한국에서는 다음 날 09:00입니다. 기본 5초 간격으로 확인하여 마감 확정 후 시장가 주문을 보냅니다.
- 시작/재시작 때 최신 마감 봉 하나만 평가합니다. 중단 기간의 과거 신호를 현재 가격으로 재생하지 않습니다.

## 구조

| 역할 | 구현 파일 |
| --- | --- |
| MarketDataClient / BinanceMarketDataClient | `binance_client.py`: 서버 시간, 마감 Kline, 과거 데이터 페이지 조회 |
| Strategy / BollingerBreakoutStrategy | `strategy.py`: API와 분리된 순수 BUY / SELL / HOLD 판단 |
| PositionManager | `position_manager.py`: 주문 허용 상태 및 실제 잔고 동기화 |
| OrderExecutor | `order_executor.py`: Binance 시장가 주문 / 가상 체결 |
| TradingBot | `trading_bot.py`: 판단, 주문 의도 저장, 체결 확인, 재시작 복구 |
| StateRepository | `state_repository.py`: SQLite 상태·일별 판단·거래·오류 이벤트 및 프로세스 잠금 |
| Backtester | `backtest.py`: 동일 Strategy 및 가상 회계로 다음 시가 체결 |

다른 전략은 `Strategy.required_candles`와 `Strategy.evaluate()`를 구현하고 조립 부분에서 교체합니다.

## 실행

Python 3.12 기준:

```bash
cd bitcoin-trader
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
set -a
source .env
set +a
python main.py --once
python main.py
```

기본은 `DRY_RUN=true`이며 매매 루프는 주문·계좌 인증 API를 호출하지 않습니다.
배포·시작 연결 점검은 설정된 키로 **조회 전용 계좌 API**를 호출합니다. 공개 Binance 가격으로
가상 USDT 10,000에서 시작하고 가상 잔고도 재시작 후 이어집니다. 새 가상 실험에는 새 `STATE_PATH`를 사용합니다.
실거래는 `BINANCE_API_KEY`, `BINANCE_API_SECRET`, `DRY_RUN=false`로 설정합니다.
실제 주문은 Binance Spot 계좌의 해당 자산 잔고를 사용합니다. Upbit 잔고를 이전하지 않습니다.

| 환경변수 | 기본값 | 의미 |
| --- | --- | --- |
| BINANCE_SYMBOL / BINANCE_INTERVAL | BTCUSDT / 1d | 현물 심볼 / 고정 길이 봉 간격 |
| BOLLINGER_PERIOD / BOLLINGER_STDDEV | 49 / 1.8 | SMA 기간 / 상단 밴드 배수 |
| FEE_RATE / SLIPPAGE_RATE | 0.001 / 0.0005 | 가상 매수·매도 각각의 비용률 |
| POSITION_SIZE | 1 | 주문 가능한 USDT 사용 비율, `(0, 1]`; SELL은 항상 전량 |
| DRY_RUN | true | 가상 체결 여부 |
| INITIAL_CASH | 10000 | 새 가상 계좌 및 백테스트 시작 금액 |
| HISTORY_LIMIT | 200 | 일봉 재조회 개수, 최소 `period + 2`, 최대 1000 |
| POLL_SECONDS | 5 | 마감 확인 및 보류 주문 조회 간격 |
| STATUS_CHECK_SECONDS | 3600 | 현재가·마감봉 신호·저장된 포지션 상태 확인 간격 (1시간) |
| STATUS_REPORT_SECONDS | 21600 | Telegram 현재 상태 전송 간격 (6시간) |
| API_TIMEOUT_SECONDS / READ_RETRIES | 10 / 3 | API 타임아웃 / 조회 최대 시도 횟수 |
| TRADER_DATA_DIR | data | 영속 저장 디렉터리 |
| STATE_PATH | data/dry-run.sqlite3 또는 data/live.sqlite3 | DB 경로 재정의 |
| BINANCE_BASE_URL | https://api.binance.com | Binance REST 주소 |

가상 BUY는 `price × (1 + slippage)`와 매수 수수료를 포함해 USDT를 초과하지 않는 수량을 산정합니다.
SELL은 전량을 `price × (1 - slippage)`에 체결하고 매도 수수료를 차감합니다.
실거래에서는 슬리피지를 주문 가격에 인위적으로 더하지 않고 실제 체결 평균가격·수수료 자산별 금액을 기록합니다.
BUY의 `quoteOrderQty`는 가용 USDT에서 설정 `FEE_RATE`만큼의 수수료 여유를 확보한 금액입니다.
Binance 최소 주문금액, LOT_SIZE, MARKET_LOT_SIZE, 자산 정밀도를 확인합니다.
SELL은 BTC 가용 잔고를 stepSize에 맞춰 내림한 전량이며 거래소 최소 수량·금액 미만의 잔여분은 dust로 기록합니다.
다른 미체결 주문이나 거래 가능한 잠긴 BTC가 있으면 전량 매매를 진행하지 않습니다.

## 상태, 중복 주문, 오류

DB에는 현재 CASH/LONG, 잔고, 마지막 처리 봉 openTime, 마지막 주문 ID, 마지막 진입가,
보류 주문 의도와 clientOrderId를 저장합니다. 판단과 거래 로그도 같은 DB에 남습니다.

동일 계좌·심볼의 모든 실행은 **같은 DB와 `.lock` 파일**을 공유해야 합니다.
파일 잠금은 API 호출을 포함한 처리 전체를 보호합니다. 서로 다른 DB나 서로 다른 계좌를 같은 DB에 연결해서는 안 됩니다.
DB는 심볼·간격·dry/live·거래소 주소를 검사하지만 계좌 식별까지 자동 판별하지 않습니다.
DB를 삭제하면 중복 방지 기록도 없어지므로 실거래 상태 DB를 유지·백업하세요.

주문 의도를 먼저 저장하고 전송 시도 표시를 커밋한 뒤 POST를 단 한 번 호출합니다.
정상 응답도 실제 `executedQty`, 체결 내역·수수료 및 계좌 잔고를 확인한 후 상태를 변경합니다.
상태·처리 봉·거래 로그는 하나의 SQLite 트랜잭션으로 반영합니다.
부분 체결이 진행 중이면 실제 체결분으로 포지션을 갱신하고 신규 주문을 막습니다.
종료된 부분 체결 주문은 체결분만 기록합니다. 부분 매도 후 거래 가능한 BTC가 남으면 LONG을 유지하고
다음 마감 봉의 매도 조건으로 잔량을 판단합니다.

- 조회 네트워크 오류·5xx: 제한된 횟수의 지수 백오프 후 다음 확인 주기에 재시도.
- 429/418: `Retry-After` 동안 모든 요청 중단. 응답을 기다리는 주문은 유지.
- 명확한 주문 거절·잔고 부족·필터 오류: 포지션을 주문 요청만으로 바꾸지 않고 실패 이벤트를 기록.
  해당 봉은 처리 완료로 표시하여 같은 신호를 반복 전송하지 않습니다.
- 전송 타임아웃·네트워크 실패·5xx·불명확한 결과: 저장된 clientOrderId로 상태를 조회하고 자동 재전송하지 않습니다.
- 조회된 주문이 아직 없거나 체결 내역이 불완전하면 보류 상태를 유지하고 신규 주문을 차단합니다.
  전송 직전 프로세스가 종료된 경우에도 실제 전송 여부를 확정할 수 없으므로 같은 방식으로 멈춥니다.
  `--export-log events`와 DB의 보류 clientOrderId를 이용해 Binance 주문·체결 이력을 확인한 뒤 수동 복구해야 합니다.
  조회에서 한 번 '주문 없음'이 나왔다는 이유로 DB를 삭제하거나 주문을 재전송하지 않습니다.

## 로그

매일의 UTC 날짜, 종가, SMA, STD, Upper, 이전 종가·Upper, 판단 당시 Position, Signal,
가상 주문가격·수량은 stdout의 `DAILY` 및 `decisions` 테이블에 저장합니다.
거래의 BUY/SELL, 신호 봉, 실제 체결 시각·가격·수량·수수료·주문 ID·체결 후 Position은 별도 `trades` 테이블에 저장합니다.
HOLD의 가상 주문가격·수량은 `null`입니다. API 키나 서명 URL은 로그에 출력하지 않습니다.

```bash
python main.py --export-log decisions > daily.jsonl
python main.py --export-log trades > trades.jsonl
python main.py --export-log events > events.jsonl
```

## 정기 상태 확인 및 Telegram 알림

현재 상태는 1시간마다 조회하고, 상태나 신호가 바뀌지 않아도 6시간마다
`TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`로 전송합니다. 최초 실행 시 바로 한 번
전송하며, 이후 마지막 성공 전송 시각부터 6시간 간격입니다. 전송 시 최신 상태를
다시 조회합니다. 메시지는 KST 확인 시각, 운영 모드, 저장된 포지션, 미결 주문,
현재가, 최근 마감 가격, 이동평균·상단 밴드, 최근 마감봉 기준 신호를 포함합니다.
시장 조회가 실패하면 최신 가격을 확인할 수 없다는 상태를 전송합니다.

전송 이력은 매매 SQLite DB/PVC에 저장하므로 Pod 재시작으로 주기가 초기화되지
않습니다. Telegram 전송 실패는 다음 1시간 상태 확인 시 재시도합니다. 상태 확인은
주문을 실행하지 않으며, 매매 마감봉·보류 주문 확인 간격은 `POLL_SECONDS=5`입니다.
시작 연결 점검 알림의 1시간 중복 제한은 정기 알림 주기와 별개입니다.

배포 후 다음 로그에서 `STATUS_CHECK`, `STATUS_REPORT delivered`를 확인합니다.

```bash
kubectl -n jaybee-lab logs deployment/bitcoin-trader --since=7h | \
  grep -E 'STATUS_CHECK|STATUS_REPORT|Telegram'
```

## 배포 후 거래소 연결 점검 및 Telegram 알림

컨테이너가 시작될 때 `startup_health.py`에서 다음을 각각 독립적으로 검사합니다.

- Binance 서버 시간, 현물 심볼·시장가 지원 여부, 전략에 필요한 최신 마감 일봉.
- 키가 설정된 경우 Binance 계좌 조회·서명 인증. 실거래 모드에서는 계좌 거래 권한도 확인.
- 키가 설정된 경우 Upbit `/v1/accounts` JWT 인증·자산조회. 빈 잔고 목록도 정상 응답.
  [Upbit 자산 조회 문서](https://docs.upbit.com/kr/reference/get-balance),
  [JWT 인증 문서](https://docs.upbit.com/kr/reference/auth)를 기준으로 구현합니다.

키 미설정은 정상으로 표시하지 않고 `⚠️ API 키 미설정: 인증 확인 불가`로 알립니다.
실거래에서 Binance 인증·권한 또는 모든 모드에서 Binance 필수 공개 데이터 점검이 실패하면,
결과를 먼저 Telegram으로 보고한 뒤 프로세스를 종료하여 매매 시작을 차단합니다.
Upbit는 연결 확인만 수행하며 주문 거래소는 Binance이므로 Upbit 실패는 Binance 매매를 차단하지 않습니다.
계좌 조회 성공은 인증·해당 조회 권한 확인이며, 주문 가능 잔고나 실제 주문 성공까지 보장하지는 않습니다.

기존 `jaybee-trader-secret`에 `UPBIT_ACCESS_KEY`, `UPBIT_SECRET_KEY`,
`BINANCE_API_KEY`, `BINANCE_API_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`를 설정합니다.
Upbit 키에는 자산조회 권한 및 배포 서버의 허용 IP가 필요합니다.
이 점검 과정은 조회 API만 호출하며 주문·잔고 이동을 실행하지 않습니다.
DRY_RUN에서도 인증 점검을 원하지 않으면 `STARTUP_HEALTH_ENABLED=false`로 시작 점검을 끌 수 있습니다.

Telegram은 Pod 이름, 이미지 소스 커밋(`BUILD_VERSION`), KST 시작 시각, DRY_RUN,
각 항목의 성공·실패·미설정 및 매매 시작 여부를 묶어 전송합니다.
API 키, JWT, 서명 URL, 거래소 원문 오류, 잔고 금액은 메시지·로그에 포함하지 않습니다.
Telegram 설정 누락·전송 실패는 로그에 남기고 거래소 정상 상태의 매매 시작은 허용합니다.
`sendMessage` 응답의 `ok=true`를 확인한 경우에만 전달 성공으로 기록합니다.

알림 이력은 기본적으로 거래 DB와 같은 영속 디렉터리의 `startup-health.sqlite3`에 따로 저장합니다.
같은 커밋·운영 모드·검사 결과의 반복 전송은 `STARTUP_NOTIFICATION_COOLDOWN_SECONDS=3600`
동안 제한합니다. 다른 커밋 배포나 검사 결과 변경은 새 알림을 전송합니다.
전송 전에 이력을 예약하므로 Telegram 타임아웃으로 전달 여부가 불확실해도 재시작 직후 재전송하지 않습니다.
실패한 전송도 이 제한을 적용하며, 제한 시간 경과 후 다음 시작 점검에서 다시 시도합니다.
연결 점검 자체는 재시작마다 수행합니다. 거래 상태 DB는 알림 때문에 변경하지 않습니다.

```bash
# 매매 루프를 시작하지 않고 연결 점검 + Telegram 보고만 실행
python main.py --check-connections

# 운영자가 즉시 재전송을 원할 때 (여전히 실주문 없음)
STARTUP_NOTIFICATION_COOLDOWN_SECONDS=0 python main.py --check-connections
```

`STARTUP_HEALTH_STATE_PATH`로 알림 DB 경로를 바꿀 수 있습니다.
`--check-connections`에서 실패 항목이 있으면 종료 코드 1을 반환하며, 키 미설정은 알림에 별도로 표시합니다.
`--export-log`와 백테스트는 시작 점검·Telegram 전송을 실행하지 않습니다.
Kubernetes Pod 시작 점검은 그 Pod의 네트워크에서 실행됩니다. Argo CD의 배포 완료 알림과는
별도이며, 전체 Deployment의 rollout 완료를 증명하는 알림은 아닙니다.

## 백테스트

```bash
# Binance 공개 일봉 전체 기간 조회 + next-open 백테스트 (end는 미포함)
python backtest.py --download btc-daily.json --start 2017-08-17 --end 2026-10-12 --output full.json

# 별도 검증: 2022년 이전 봉은 지표 준비에만 사용하고 2022-01-01에 CASH에서 시작
python backtest.py --candles btc-daily.json --start 2022-01-01 --end 2026-10-12 --output validation.json

# 파라미터·비용 비교
BOLLINGER_PERIOD=37 BOLLINGER_STDDEV=1.4 FEE_RATE=0.001 SLIPPAGE_RATE=0.0005 \
  python backtest.py --candles btc-daily.json --output variant.json
```

JSON은 Binance Kline 배열 또는 Candle 객체 배열, CSV는
`open_time,open,high,low,close,volume,close_time` 헤더를 사용합니다.
`openTime`/`closeTime` 이름도 지원하며 시간은 밀리초입니다.
`--download`는 시작 구간 이전의 지표 준비 봉도 함께 조회합니다.
진행 봉, 중복·역순·누락된 봉을 배제/검증합니다. 동일 Strategy에서 마감 종가로 신호를 얻고
**다음 봉의 시가**에 가상 체결합니다. 마지막 봉의 신호는 다음 봉이 없으면 체결하지 않습니다.
선택 구간 밖 신호를 가져오지 않고, 종료 시 미청산 포지션은 마지막 종가로 평가합니다.
결과 JSON에는 거래, equity curve, 수익률과 **일봉 종가 equity 기준 MDD**가 포함됩니다.
일중 저가를 통한 낙폭, 펀딩, 차입, 숏은 계산하지 않습니다.

49/1.8 선택 근거는 요청에서 제공된 전체 기간 및 2022~2026 검증 결과입니다.
이번 구현에서 그 성과 수치를 재검증했다는 뜻은 아니며, 입력 데이터와 비용·STD 정의에 따라 결과가 달라집니다.

## 검증 및 Kubernetes

```bash
python -m unittest discover -s tests -v
```

CI에서도 Python 3.12로 테스트 후 이미지를 빌드합니다.
Kubernetes base는 replica 0, prod는 replica 1이며 기본 `DRY_RUN=true`입니다.
`bitcoin-trader-state` RWO PVC를 `/data`에 마운트하고 Recreate 배포를 사용합니다.
별도 dry/live DB를 자동 선택하여 dry-run 거래가 실거래 상태에 섞이지 않습니다.
단일 replica를 유지하고 파일 잠금·SQLite를 지원하는 영속 볼륨을 사용합니다.
이 변경은 저장소 코드와 배포 매니페스트에만 적용하며 클러스터 반영이나 실주문을 실행하지 않습니다.
