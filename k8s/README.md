# Kubernetes deployment

This directory contains Kubernetes manifests for the Docker Compose services.

## Resources

- `k8s/base`: core app stack (`frontend`, `backend`, `worker`, `postgres`, `nginx`, `bitcoin-trader`)
- `k8s/optional/cloudflared.yaml`: optional Cloudflare Tunnel deployment
- `k8s/kind-config.yaml`: local kind cluster config

For the production Kustomize overlay, Argo CD bootstrap, runtime Secrets, and
cutover order, see [`k8s/PRODUCTION.md`](PRODUCTION.md).

## Local kind test

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
# Edit the ignored runtime Secret before applying it.
kubectl apply -f k8s/secrets/jaybee-secret.yaml

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

`bitcoin-trader` is included in the base manifests but defaults to `replicas: 0` because the app exits when `UPBIT_ACCESS_KEY` or `UPBIT_SECRET_KEY` is empty. Set those values in `k8s/secrets/jaybee-secret.yaml`, then scale it to one replica.

## Secrets

Secrets are not part of `k8s/base` and are never reconciled from plaintext files
in Git. Use the templates and instructions in [`k8s/secrets`](secrets/README.md).
The local kind flow also requires a `jaybee-secret` to be created before the
workloads can become Ready.
