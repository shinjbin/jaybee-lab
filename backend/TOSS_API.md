# 토스증권 API 연결

공식 REST 명세 v1.2.17 확인 기준으로 한국투자증권 연결을 교체했다.

- 명세: https://openapi.tossinvest.com/openapi-docs/latest/openapi.json
- 인증·호출 제한 안내: https://openapi.tossinvest.com/openapi-docs/overview.md

## 설정

`TOSS_CLIENT_ID`, `TOSS_CLIENT_SECRET`을 환경변수 또는 Kubernetes의 `jaybee-data-secret`에 설정한다. 기본 주소는 `https://openapi.tossinvest.com`이다. 기존 `KIS_*` 설정은 사용하지 않는다. `.env.example`은 예시이며 서버가 `.env`를 자동으로 읽지는 않는다.

API 서버와 worker는 같은 PostgreSQL을 사용해야 한다. 시작 시 생성하는 `brokerage_api_tokens` 테이블에 액세스 토큰과 만료 시각을 저장하고, 트랜잭션 advisory lock으로 토큰 발급을 직렬화한다. 같은 client의 토큰 재발급이 이전 토큰을 무효화하므로 프로세스별 독립 발급을 피한다. 토큰 조회 키는 base URL·client ID·secret의 SHA-256이며, 테이블의 액세스 토큰은 자격 증명으로 취급한다. 다른 DB를 사용하는 배포와 같은 client를 공유하지 않는다.

## 호출 대응

| 기존 기능 | 토스증권 요청 |
| --- | --- |
| OAuth 발급 | `POST /oauth2/token`, form-urlencoded |
| 종목 현재가 | `GET /api/v1/prices?symbols=005930` |
| 장중 추정·일별 투자자 수급 | `GET /api/v1/stocks/{symbol}/investor-trading` |
| 과거 수급 금액 계산용 종가 | `GET /api/v1/candles`, `interval=1d`, `adjusted=false` |
| KOSPI 현재가 | `GET /api/v1/market-indicators/prices?symbols=KOSPI` |
| KOSPI 일봉 | `GET /api/v1/market-indicators/KOSPI/candles` |

사용하지 않던 한국투자증권 랭킹 호출은 제거했다. 수집 대상 시총 상위 종목군은 기존 KRX 서비스를 유지한다. 외부 `/api/market-indices`, `/api/investor-flows/kospi` 응답 구조도 유지한다.

## 수급 데이터 차이

- 토스 종목 수급은 **KRX·NXT 통합 수량**, 외국인은 **등록외국인** 기준이다. 종목별 거래대금은 제공하지 않는다.
- 금액은 기존처럼 수량 × 가격 추정치이며 `amountSource=quantity_x_price`로 구분한다. 당일은 현재가, 과거는 같은 거래일의 비수정 종가를 사용한다. 가격이 없으면 금액은 null이다.
- 응답의 `date`로 저장하므로 휴장일 요청에 이전 거래일 기록이 반환되어도 휴장일 실적으로 저장하지 않는다.
- 최근 두 기록을 재수집해 잠정치를 갱신한다. 당일 저녁 확정치 반영을 고려해 기본 수집 창을 KST 08:00~20:59로 설정했다. 기본 120분 주기이므로 정확한 확정 시각을 보장하지는 않으며 다음 주기에도 다시 조회한다.
- 기존 KIS 스냅샷은 삭제하지 않는다. 전환 전후 기간 집계에는 공급자·시장 범위가 다른 값이 섞일 수 있다. 새 원시 응답에는 `collection_source=toss-investor-trading`, `market_scope=KRX+NXT`를 저장한다.
- 요청은 프로세스별 기본 500ms 간격이다 (`TOSS_REQUEST_INTERVAL_MS`). HTTP 401은 공유 토큰 확인·갱신 후 한 번 재시도한다. 429는 오류로 보고하고 다음 수집 주기에서 재시도한다. 복제 수를 늘리면 client 단위 호출 제한도 함께 검토한다.

## 검증

`npm test` 또는 `npm run test:toss`로 네트워크·실제 자격 증명 없이 검증한다. 토큰 저장소의 DB 호출은 모의 구현으로 검증하며 실제 PostgreSQL 동시성 및 토스 계정 연동은 별도 통합 검증이 필요하다.

운영 Secret 적용 및 배포는 이 변경에 포함하지 않는다. 관리자 수급 수집 API는 동기 실행이므로 전체 종목 수집이 프록시의 30초 제한보다 길어질 수 있다. 정기 수집은 worker를 통해 실행한다.
