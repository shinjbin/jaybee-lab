# Kubernetes deployment

이 디렉터리는 JAYBEE LAB의 Kubernetes 배포 정의를 포함합니다.

## 리소스

- `k8s/base`: frontend, backend, worker, PostgreSQL, nginx, NetworkPolicy
- `k8s/optional`: Cloudflare Tunnel과 선택적 클러스터 구성요소
- `k8s/overlays/prod`: Argo CD 운영 overlay
- `k8s/secrets`: Git에 커밋하지 않는 런타임 Secret 템플릿

운영 배포는 [`PRODUCTION.md`](PRODUCTION.md)를 참고하세요.

## 로컬 kind 테스트

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
# 복사한 파일에서 비밀번호, API 키, ADMIN_API_KEY를 설정합니다.
kubectl apply -f k8s/secrets/jaybee-secret.yaml

kubectl apply -k k8s/base
kubectl -n jaybee-lab rollout status statefulset/postgres
kubectl -n jaybee-lab rollout status deployment/backend
kubectl -n jaybee-lab rollout status deployment/frontend
kubectl -n jaybee-lab rollout status deployment/nginx
kubectl -n jaybee-lab rollout status deployment/worker
```

로컬 접근:

```bash
kubectl -n jaybee-lab port-forward service/nginx 8080:80
curl http://localhost:8080/api/health
```

쓰기 API 요청에는 32자 이상의 `ADMIN_API_KEY`를 Bearer 토큰 또는 `X-Admin-API-Key` 헤더로 전달해야 합니다. 키가 설정되지 않으면 쓰기 API는 `503`으로 닫힙니다.

`bitcoin-trader`는 거래소 키를 확인하기 전까지 기본 replica가 0입니다.

## 보안 참고사항

- Secret은 DB, 외부 데이터 API, 관리 API, 거래소 자격증명으로 분리됩니다.
- Grafana는 앱 nginx에서 공개하지 않으며 port-forward로 접근합니다.
- Pod는 불필요한 서비스 계정 토큰을 마운트하지 않습니다.
- NetworkPolicy가 실제로 동작하려면 Calico, Cilium 등 정책을 지원하는 CNI가 필요합니다. 정책 미지원 CNI에서는 매니페스트가 생성돼도 트래픽이 차단되지 않습니다.
