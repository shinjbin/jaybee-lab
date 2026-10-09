# JAYBEE LAB

국내외 금융 시장 정보, 뉴스 요약, 수급 동향과 AI 분석을 제공하는 개인 대시보드입니다.

배포 주소: **https://www.jaybeelab.com**

## 주요 기능

- 글로벌 지수와 KOSPI 종목 조회
- 해외 금융 뉴스 수집·요약·번역
- 토스증권 Open API 기반 외국인·기관 수급 동향
- 증권사 리포트와 AI 시장 분석 조회
- 선택적 Upbit 자동매매 워커

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
