# Kubernetes deployment

This directory contains Kubernetes manifests for the Docker Compose services.

## Resources

- `k8s/base`: core app stack (`frontend`, `backend`, `worker`, `postgres`, `nginx`, `bitcoin-trader`)
- `k8s/optional/cloudflared.yaml`: optional Cloudflare Tunnel deployment
- `k8s/kind-config.yaml`: local kind cluster config

## Local kind test

```bash
kind create cluster --config k8s/kind-config.yaml

docker build -t jaybee-lab/frontend:local frontend
docker build -t jaybee-lab/backend:local backend
docker build -t jaybee-lab/bitcoin-trader:local bitcoin-trader

kind load docker-image jaybee-lab/frontend:local --name jaybee-lab
kind load docker-image jaybee-lab/backend:local --name jaybee-lab
kind load docker-image jaybee-lab/bitcoin-trader:local --name jaybee-lab

kubectl apply -k k8s/base
kubectl -n jaybee-lab rollout status statefulset/postgres
kubectl -n jaybee-lab rollout status deployment/backend
kubectl -n jaybee-lab rollout status deployment/frontend
kubectl -n jaybee-lab rollout status deployment/nginx
kubectl -n jaybee-lab rollout status deployment/worker
# bitcoin-trader is scaled to 0 by default until UPBIT credentials are set.
# kubectl -n jaybee-lab scale deployment/bitcoin-trader --replicas=1
# kubectl -n jaybee-lab rollout status deployment/bitcoin-trader
```

Expose locally:

```bash
kubectl -n jaybee-lab port-forward service/nginx 8080:80
```

Check in another terminal:

```bash
curl http://localhost:8080/
curl -H 'Referer: http://localhost:8080/' http://localhost:8080/api/health
```

The nginx config keeps the existing Compose behavior that blocks `/api/` requests without a `Referer` header.

`bitcoin-trader` is included in the base manifests but defaults to `replicas: 0` because the app exits when `UPBIT_ACCESS_KEY` or `UPBIT_SECRET_KEY` is empty. Set those values in `k8s/base/secret.yaml`, then scale it to one replica.

## Secrets

Update `k8s/base/secret.yaml` before production use. At minimum, set:

- `POSTGRES_PASSWORD`
- `GNEWS_API_KEY`
- `TWELVE_DATA_API_KEY`
- `OPENAI_API_KEY`
- `KIS_APP_KEY`
- `KIS_APP_SECRET`
- `KRX_AUTH_KEY`
- `UPBIT_ACCESS_KEY`
- `UPBIT_SECRET_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

To enable Cloudflare Tunnel, set `CF_TUNNEL_TOKEN` in `k8s/optional/cloudflared.yaml` and apply it after the base stack:

```bash
kubectl apply -f k8s/optional/cloudflared.yaml
```