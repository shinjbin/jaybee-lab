# Binance 신호 + Upbit BTC 현물 자동매매

기본 거래소는 **Upbit**, 마켓은 **KRW-BTC**, 일봉 Bollinger Breakout **49 / 1.8**, Long Only입니다.
매수·매도 신호는 **Binance BTCUSDT 마감 일봉**으로 판단합니다. 실제 주문·잔고·체결·주문 가능 금액은
**Upbit KRW-BTC** 기준입니다. Binance 가격은 USDT 단위, Upbit 주문 가격은 KRW 단위이며
환율 변환 없이 분리하여 사용합니다. Upbit 현재가는 주문·포지션 확인에만 사용하고 전략 밴드는 Binance로 계산합니다.

## 매매 규칙

- CASH에서 이전 종가 <= 이전 상단 밴드이고 현재 종가 > 현재 상단 밴드이면 BUY.
- LONG에서 현재 종가 < SMA이면 SELL. LONG 추가 매수와 CASH 매도는 하지 않습니다.
- 기본 매수는 가용 호가 자산 전액, 매도는 가용 BTC 전량입니다. 기존 계좌 BTC도 포지션으로 인식합니다.
- 모집단 표준편차(ddof=0)를 사용하고, 이전/현재 밴드 계산에는 마감봉 50개가 필요합니다.
- 일봉은 UTC 00:00 / KST 09:00에 마감합니다. 진행 봉은 제외하고 마감이 확인된 뒤 신호를 계산합니다.
- 신호에는 Binance 서버 시각 기준으로 완전히 마감된 Kline만 사용합니다.
- Binance 조회 실패 시 신규 주문을 하지 않으며 Upbit 일봉으로 대체하지 않습니다.
  이미 전송한 Upbit 미결 주문은 Binance 장애 중에도 조회·체결 복구를 계속합니다.
- 매매 루프는 기본 5초 간격이며, 재시작 때 최신 마감봉 하나만 평가합니다.

## 설정

Python 3.12와 requirements.txt의 의존성을 사용합니다. Python은 .env를 자동 로드하지 않습니다.
`.env.example`은 모의 실행 예제이고, `.env.upbit-live.example`은 **활성화되지 않은 실거래 설정 예제**입니다.
실거래 예제에는 DRY_RUN=false가 있지만 API 키가 비어 있고 배포 설정에 자동 적용되지 않습니다.

| 환경변수 | 기본값 | 의미 |
| --- | --- | --- |
| TRADING_EXCHANGE | upbit | upbit / binance |
| BINANCE_BASE_URL / BINANCE_SYMBOL / BINANCE_INTERVAL | https://api.binance.com / BTCUSDT / 1d | 공개 신호 데이터, Binance 키 불필요 |
| UPBIT_BASE_URL | https://api.upbit.com | 한국 Upbit API |
| UPBIT_SYMBOL / UPBIT_INTERVAL | KRW-BTC / 1d | 지원 마켓 KRW-BTC 또는 USDT-BTC, 일봉만 지원 |
| UPBIT_ACCESS_KEY / UPBIT_SECRET_KEY | 없음 | 선택한 거래소 인증 키 |
| DRY_RUN | true | false를 사용자가 적용하면 실거래 주문 경로를 사용 |
| BOLLINGER_PERIOD / BOLLINGER_STDDEV | 49 / 1.8 | 밴드 파라미터 |
| POSITION_SIZE | 1 | 가용 현금 사용 비율, SELL은 전량 |
| FEE_RATE / SLIPPAGE_RATE | 0.001 / 0.0005 | 모의 매매·백테스트 비용률 |
| INITIAL_CASH | 10000 | 새 모의 계좌의 호가 자산 금액 (원화 시장이면 KRW) |
| HISTORY_LIMIT | 200 | Upbit 최대 200개, period + 2 이상 |
| POLL_SECONDS | 5 | 매매 조회 간격 |
| STATUS_CHECK_SECONDS / STATUS_REPORT_SECONDS | 3600 / 21600 | 상태 확인 1시간 / 알림 6시간 |
| API_TIMEOUT_SECONDS / READ_RETRIES | 10 / 3 | 요청 제한 시간 / GET 재시도 횟수 |
| TRADER_DATA_DIR | data | 상태 DB 디렉터리 |
| STATE_PATH | data/upbit-dry-run.sqlite3 또는 data/upbit-live.sqlite3 | 경로 재정의 |

실거래 키는 자산조회·주문조회·주문하기 권한과 서버의 허용 IP가 필요합니다.
실거래 매수 예산은 `/v1/orders/chance`의 실제 bid_fee를 반영해 수수료 여유를 확보합니다.
최소·최대 주문 금액, 시장가 주문 지원 여부도 해당 API의 정책을 사용합니다.
매도 수량은 소수점 8자리로 내림합니다. 잠긴 BTC나 동일 마켓 미체결·예약 주문이 있으면 신규 주문을 차단합니다.
KRW-BTC는 원화 잔고, USDT-BTC는 USDT 잔고를 사용하며 거래소 간 자산 이동은 하지 않습니다.

TRADING_EXCHANGE=upbit에서는 Binance를 공개 시세 조회에만 사용하며 인증 키를 전달하지 않습니다.
신호 마켓은 BTCUSDT이고 Upbit 주문 마켓은 KRW-BTC 또는 USDT-BTC입니다. 두 데이터의 일봉 간격은 같아야 합니다.
TRADING_EXCHANGE=binance로 명시하면 기존 Binance 단일 거래소 경로를 사용합니다.
기존 Binance 기본 dry-run.sqlite3/live.sqlite3 경로는 유지하여 처리 기록을 건너뛰지 않습니다.

## 주문·체결·복구

- Upbit 시장가 매수: side=bid, ord_type=price, price=주문 총액. volume은 보내지 않습니다.
- Upbit 시장가 매도: side=ask, ord_type=market, volume=BTC 수량. price는 보내지 않습니다.
- JWT HS512 인증에 실제 GET 쿼리/POST JSON의 query_hash(SHA512)를 포함합니다.
- 주문 의도와 고유 identifier, 전송 시도 표시를 먼저 SQLite에 저장하고 POST는 한 번만 보냅니다.
- 통신 실패·5xx·불확실한 결과는 identifier로 조회하며 자동 재전송하지 않습니다.
  조회에서 주문 없음이 반환돼도 의도를 유지합니다. 거래소 주문 이력 확인 후 수동 복구해야 합니다.
- 실제 executed_volume, 개별 체결 금액·시각, paid_fee와 계좌 잔고로 체결을 기록합니다.
  체결 상세가 누락되면 미결 주문으로 유지하여 중복 주문을 막습니다.
- Upbit 시장가 매수는 잔여 금액 때문에 cancel로 종료되어도 체결량이 있으면 거래로 기록합니다.
- 부분 체결 중에는 신규 주문을 막고, 종료 후 남은 거래 가능한 BTC는 LONG으로 유지합니다.
- GET 오류는 제한된 재시도를 적용하고, 429/418 이후 모든 요청은 재시도 대기시간을 지킵니다.
- API 원문 오류·JWT·키는 알림과 로그에 출력하지 않습니다.

Upbit와 Binance, 모의와 실거래 DB는 분리됩니다. 명시한 STATE_PATH도 거래소 주소·마켓·모드가
기존 DB와 다르면 시작을 거부합니다. Upbit DB 식별자에는 Binance 신호 주소·마켓도 포함되므로,
이전 Upbit 단일 신호 DB를 그대로 사용하면 시작을 거부합니다. 기록을 버리지 말고 운영자가 확인 후 이관해야 합니다. DB를 삭제하면 중복 방지 기록도 없어지므로 유지해야 합니다.
단일 replica와 파일 잠금·SQLite를 지원하는 영속 볼륨을 사용합니다.

## 시작 점검과 상태 알림

시작 시 Binance 공개 서버 시각·신호 마켓·마감 일봉과 Upbit 주문 마켓·현재가·계좌 인증·주문 조회/정책을 점검합니다.
Binance 신호 데이터 또는 Upbit 주문 데이터 필수 조회 실패나 실거래 키 미설정은 시작을 차단합니다.
시작 점검 마지막 단계에서 `/v1/orders/test`에 시장가 매수 검증 요청을 한 번 보냅니다.
`/v1/orders/chance`가 반환하는 최소 매수금액을 사용하며 실제 주문·수수료·체결은 발생하지 않습니다.
테스트 응답의 가상 UUID는 폐기하고 주문/체결 DB에는 저장하지 않습니다. 실패해도 실제 주문 API로 대체하지 않습니다.
성공·권한 부족·잔고 부족·키 미설정·비활성화 결과를 시작 알림으로 전송합니다.
STARTUP_ORDER_TEST_ENABLED=true가 기본이고 false로 검증만 끌 수 있습니다. STARTUP_HEALTH_ENABLED=false는 전체 시작 점검을 끕니다.
실거래 모드에서 활성화된 주문 테스트가 실패하면 시작을 차단하고, 모의 모드에서는 실패를 보고한 뒤 모의 실행을 허용합니다.
주문 테스트 API도 주문하기 권한이 필요합니다. 정상 검증은 실제 체결을 보장하지 않습니다.

```bash
python main.py --check-connections
```

TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID를 설정하면 시작 점검과 정기 상태를 전송합니다.
상태 알림에는 거래소·마켓·모의/실거래 모드·실제 주문 활성 여부·저장된 포지션·미결 주문,
Upbit 주문 시장 현재가와 Binance 신호 마켓·USDT 종가·밴드·매수/매도 신호, 최근 체결 방향·모의/실거래 구분·KST 시각이 포함됩니다.
최근 체결은 현재 모드 DB의 최신 기록이며 이번 알림 기간 내 거래를 의미하지 않습니다.
시장 조회 실패는 신호 확인 불가로 표시하며 이미 처리한 봉과 미결 주문은 신규 주문 상태에 표시합니다.
상태 확인은 주문을 실행하거나 매매 상태를 변경하지 않습니다.
최초 정기 알림 후 성공 전송 기준 6시간마다 보내고, 실패는 다음 1시간 확인 시 재시도합니다.
알림 이력은 영속 DB에 저장하며 Pod 재시작으로 초기화되지 않습니다.
시작 알림 중복 제한은 STARTUP_NOTIFICATION_COOLDOWN_SECONDS=3600이며 별도 DB에 저장합니다.

## 로그·백테스트·검증

```bash
python main.py --export-log decisions
python main.py --export-log trades
python main.py --export-log events
python backtest.py --download btc-daily.json --start 2017-08-17 --end 2026-10-12 --output full.json
python -m unittest discover -s tests -v
```

하이브리드 백테스트는 Binance로 신호를 계산하고 다음 Upbit 봉의 시가로 가상 체결합니다.
계좌 가치도 Upbit 가격·호가 자산으로 계산하여 USDT 가격을 KRW 금액처럼 사용하지 않습니다.
--download는 Upbit 체결 데이터를 지정 파일에, Binance 신호 데이터를 같은 이름의 .signals.json에 저장합니다.
기존 파일로 실행할 때는 --candles에 Upbit 데이터를, --signal-candles에 Binance 데이터를 함께 지정해야 합니다.
두 시장의 일봉은 UTC 날짜로 맞추며 누락·진행 봉을 배제합니다. 실제 주문은 하지 않습니다.
신호 다음 봉의 시가에 슬리피지·수수료를 양방향 적용합니다. 마지막 미체결 신호는 그대로 표시합니다.
MDD는 마감 종가 기준 계좌 가치로 계산합니다. 기존 Binance 전략 성과가 Upbit에서도 같다는 의미는 아닙니다.

배포 ConfigMap은 Upbit를 선택하고 시작 주문 테스트를 활성화합니다. Pod의 명시적 DRY_RUN=true 설정으로 모의 매매를 유지합니다. 실거래 예제를 실제 설정에 적용하고
배포·자동매매를 활성화하는 단계는 운영자가 직접 수행합니다. 이번 코드 변경은 서버에 배포되지 않았습니다.

API 근거: [인증](https://docs.upbit.com/kr/reference/auth),
[일봉](https://docs.upbit.com/kr/reference/list-candles-days),
[주문 생성](https://docs.upbit.com/kr/reference/new-order),
[주문 조회](https://docs.upbit.com/kr/reference/get-order),
[주문 정책](https://docs.upbit.com/kr/reference/available-order-information).
