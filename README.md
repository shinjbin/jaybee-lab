# JAYBEE LAB

국내외 금융 시장 정보, 뉴스 요약, 수급 동향과 AI 분석을 제공하는 개인 대시보드입니다.

배포 주소: **https://www.jaybeelab.com**

## 주요 기능

- 글로벌 지수와 KOSPI 종목 조회
- 해외 금융 뉴스 수집·요약·번역
- 토스증권 Open API 기반 외국인·기관 수급 동향
- 증권사 리포트와 AI 시장 분석 조회
- Binance Spot BTCUSDT Bollinger Breakout 자동매매 워커 (기본 dry-run, [운영·백테스트 안내](bitcoin-trader/README.md))

토스증권 인증 설정, API 대응 관계와 수급 데이터 차이는 [연동 안내](backend/TOSS_API.md)를 참고하세요.

## 프로젝트 구조

```text
.
├─ .github/workflows/deploy.yml
├─ backend/                  # API 및 수집 worker
├─ frontend/                 # React/Vite UI
├─ bitcoin-trader/           # 선택적 자동매매 worker
└─ k8s/
   ├─ base/                  # 핵심 Kubernetes 리소스
   ├─ optional/              # cloudflared, metrics-server
   ├─ overlays/prod/         # Argo CD 운영 overlay
   └─ secrets/               # Git에 커밋하지 않는 Secret 템플릿
```

각 서비스의 `Dockerfile`은 Kubernetes에서 실행할 컨테이너 이미지를 만들기 위해 사용합니다. Docker Compose 배포는 지원하지 않습니다.

백엔드와 프런트엔드 개발·빌드에는 Node.js 24를 사용합니다. 프런트엔드 개발·preview 서버는 기본적으로 로컬에서만 접근할 수 있습니다.

## 로컬 Kubernetes 실행

로컬 테스트는 kind를 사용합니다.

```bash
kind create cluster --config k8s/kind-config.yaml

docker build -t jaybee-lab/frontend:local frontend
docker build -t jaybee-lab/backend:local backend
docker build -t jaybee-lab/bitcoin-trader:local bitcoin-trader

kind load docker-image jaybee-lab/frontend:local --name jaybee-lab
kind load docker-image jaybee-lab/backend:local --name jaybee-lab
kind load docker-image jaybee-lab/bitcoin-trader:local --name jaybee-lab

kubectl apply -f k8s/base/namespace.yaml
cp k8s/secrets/jaybee-secret.example.yaml k8s/secrets/jaybee-secret.yaml
# Secret 값을 설정한 다음 적용합니다.
kubectl apply -f k8s/secrets/jaybee-secret.yaml
kubectl apply -k k8s/base
kubectl -n jaybee-lab wait --for=condition=complete job/db-migrate --timeout=300s

kubectl -n jaybee-lab port-forward service/nginx 8080:80
```

확인 주소:

- `http://localhost:8080/`
- `http://localhost:8080/api/health`
- `http://localhost:8080/api/briefing/latest`

쓰기 API는 `ADMIN_API_KEY`가 필요합니다.

```bash
curl -X POST http://localhost:8080/api/investor-flows/collect \
  -H "Authorization: Bearer $ADMIN_API_KEY"
```

## 운영 배포

운영 환경은 GitHub Actions에서 이미지를 GHCR에 게시하고, Argo CD가 `k8s/overlays/prod`를 동기화합니다. 배포 준비, Secret 생성, Cloudflare Tunnel 연결 순서는 [`k8s/PRODUCTION.md`](k8s/PRODUCTION.md)를 참고하세요.

- 외부 진입점은 Cloudflare Tunnel과 `nginx` ClusterIP Service입니다.
- PostgreSQL, backend, frontend는 외부 `NodePort`나 `LoadBalancer`로 노출하지 않습니다.
- `/monitoring/`은 공개 프록시하지 않습니다. Grafana는 `kubectl port-forward`로 접근합니다.
- 네트워크 정책이 실제로 적용되려면 NetworkPolicy를 지원하는 CNI가 필요합니다.

## 서버 시작 API 점검 알림

백엔드와 worker는 시작할 때 토스증권(삼성전자 시세), GNews, Yahoo Finance,
Twelve Data, OpenAI(인증 및 모델 접근), KRX OpenAPI를 읽기 요청으로 점검하고
정상/실패/미설정/사용 안 함 결과를 텔레그램으로 보냅니다. API 실패는 서버 시작을
막지 않으며 각 요청은 제한 시간 내에 종료됩니다. OpenAI 생성 요청은 하지 않습니다.
KRX는 휴장일의 빈 데이터도 연결 정상으로 처리합니다.

`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`는 비트코인 매매 알림과 동일하게 사용합니다.
Kubernetes에서는 backend와 worker가 `jaybee-trader-secret`의 두 키를 참조하므로
별도의 봇이나 Secret 복제가 필요 없습니다. 각 프로세스가 재시작될 때마다 알림을 보냅니다.
비트코인 봇은 업비트 계좌 인증과 바이낸스 시세를 점검하고 같은 채널에 보고하며,
둘 중 하나가 실패하면 거래를 시작하지 않습니다. 텔레그램 전송 실패는 로그에 남습니다.

### 시장요약 데이터 저장 및 갱신

시장요약은 `market_index_snapshots`에 지표별 현재값과 과거 일봉을 저장합니다.
최초에는 설정된 과거 일봉(기본 4,000개, 10년 표시와 지표 계산용 여유분 포함)을 수집하고, 이후 마지막 저장일 이후 구간에
최근 5일의 여유 구간을 더해 조회한 뒤 날짜별로 병합합니다. 휴장일이나 수집 중단으로
공백이 길어지면 조회 범위도 자동으로 늘어납니다. 주봉과 보조지표는 일봉으로 계산합니다.

- API는 저장된 결과를 먼저 반환하며, 오래된 데이터의 갱신은 백그라운드에서 처리합니다.
- worker가 시작 시와 `MARKET_CACHE_TTL_SECONDS` 주기(기본 900초)마다 독립적으로 수집합니다.
- 외부 API 오류 시 이전 DB 데이터를 유지합니다. 화면은 60초마다 저장 결과를 다시 읽습니다.
- 화면 요청은 서버 메모리에서도 15초간 재사용합니다. DB가 비어 있는 최초 요청은 초기 수집을 기다릴 수 있습니다.

이 변경을 배포하기 전에 기존 `npm run migrate` 절차로 테이블과 런타임 역할 권한을
추가해야 합니다. 이후 backend와 worker를 함께 배포하면 방문자가 없어도 데이터를 미리 수집합니다.

차트는 최대 10년을 선택할 수 있으며 실제 제공 범위만 표시합니다. 조회량 설정이 늘어나면
기존 스냅샷도 다음 수집 때 과거 데이터를 한 번 확장합니다. 설정값을 채우지 못하는 제공처는
매번 전체 조회를 반복하지 않습니다. 미국 지표는 Yahoo Finance의 나스닥100(`^NDX`), 다우존스(`^DJI`),
S&P 500(`^GSPC`) 지수 원본을 사용합니다. 환율은 Twelve Data를 유지합니다.
`YAHOO_INDEX_SERIES`로 미국 지수를 설정하며, 상세 차트 하단에 수집 심볼을 표시합니다.
저장된 데이터의 제공처·수집 심볼이 바뀌면 기존 데이터는 재사용하지 않고 다시 수집합니다.
이전 QQQ·DIA·SPY 데이터는 지수 차트에 병합하거나 조회 실패의 대체값으로 사용하지 않습니다.


원자재는 `COMMODITY_SERIES`로 설정하며 기본 금(`GC=F`), 은(`SI=F`), WTI(`CL=F`)를
별도 가로 카드 줄에 표시합니다. Yahoo Finance의 대표 선물 가격을 사용하며 현물 가격이나
합성 원자재 지수가 아닙니다. 금·은 단위는 USD/트로이온스, WTI는 USD/배럴입니다.
지수와 동일한 DB 스냅샷·과거 데이터·증분 갱신 경로를 사용하고, 선물 응답만 허용합니다.
만기 교체 시 연결 선물 시계열에 가격 차이가 생길 수 있습니다.
