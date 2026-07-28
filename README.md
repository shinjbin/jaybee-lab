# JAYBEE LAB

국내외 금융 시장 정보, 뉴스 요약, 수급 동향과 AI 분석을 제공하는 개인 대시보드입니다.

배포 주소: **https://www.jaybeelab.com**

## 주요 기능

- 글로벌 지수와 KOSPI 종목 조회
- 해외 금융 뉴스 수집·요약·번역
- KIS Open API 기반 외국인·기관 수급 동향
- 증권사 리포트와 AI 시장 분석 조회
- 선택적 Upbit 자동매매 워커

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
