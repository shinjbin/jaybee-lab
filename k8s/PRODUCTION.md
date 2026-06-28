# Production GitOps deployment

The production deployment is reconciled by Argo CD from `k8s/overlays/prod`.
GitHub Actions is responsible only for testing, building images, pushing them to
GHCR, and committing immutable image tags back to the production overlay.

## Deployment contract

Production images use these names:

- `ghcr.io/shinjbin/jaybee-lab-frontend`
- `ghcr.io/shinjbin/jaybee-lab-backend`
- `ghcr.io/shinjbin/jaybee-lab-bitcoin-trader`

The committed `main` tags are bootstrap values only. The CI workflow must replace
them with immutable Git SHA tags before the first production sync. Do not rely on
overwriting `main` for later deployments because that does not create a Git diff
for Argo CD to reconcile.

If the GHCR packages are private, create an image pull Secret and patch the three
application Deployments with `imagePullSecrets`. The simpler initial setup is to
make these three packages public.

## Infrastructure prerequisites

Before installing the application, verify all of the following:

- The Kubernetes node is `Ready` and CoreDNS is running.
- Flannel uses the same Pod CIDR passed to `kubeadm init`.
- A `local-path` StorageClass exists.
- The three application images and their committed tags exist in GHCR.
- Argo CD is installed in the `argocd` namespace.
- The repository is registered in Argo CD when it is private.

The production PostgreSQL claim explicitly requests the `local-path` StorageClass
and 10 GiB. Change `k8s/overlays/prod/postgres-patch.yaml` before first sync if a
different provisioner or capacity is required. A StatefulSet claim is not a
backup; keep an external `pg_dump` backup.

## Create runtime Secrets

Secrets are intentionally excluded from Kustomize and Argo CD. Create them before
the Application is installed:

```bash
kubectl apply -f k8s/base/namespace.yaml

cp k8s/secrets/jaybee-secret.example.yaml k8s/secrets/jaybee-secret.yaml
cp k8s/secrets/cloudflared-secret.example.yaml k8s/secrets/cloudflared-secret.yaml

# Edit both ignored files and replace every required value.
kubectl apply -f k8s/secrets/jaybee-secret.yaml
kubectl apply -f k8s/secrets/cloudflared-secret.yaml
```

The non-example files under `k8s/secrets` are ignored by Git. Confirm before every
commit:

```bash
git status --short
git check-ignore k8s/secrets/jaybee-secret.yaml
```

For full secret GitOps later, replace this bootstrap mechanism with SOPS or an
external secret provider. Never add real credentials to the example files.

## Bootstrap Argo CD resources

Apply the project and application only after Secrets, StorageClass, and GHCR
images are ready:

```bash
kubectl apply -k k8s/argocd
```

The Application watches `main` at `k8s/overlays/prod` and enables automatic sync,
self-healing, and pruning. It deploys into `jaybee-lab` in the same cluster.

Monitor the first sync:

```bash
kubectl -n argocd get applications.argoproj.io jaybee-lab-prod
kubectl -n jaybee-lab get pods,svc,pvc
kubectl -n jaybee-lab rollout status statefulset/postgres
kubectl -n jaybee-lab rollout status deployment/backend
kubectl -n jaybee-lab rollout status deployment/frontend
kubectl -n jaybee-lab rollout status deployment/nginx
kubectl -n jaybee-lab rollout status deployment/worker
kubectl -n jaybee-lab rollout status deployment/cloudflared
```

`bitcoin-trader` remains at zero replicas until exchange and Telegram credentials
are verified. Change its replica count through Git, not with a permanent manual
cluster edit.

## Cloudflare Tunnel

Configure the Cloudflare tunnel ingress to use the in-cluster service:

```text
http://nginx.jaybee-lab.svc.cluster.local:80
```

Do not stop the existing Compose deployment until the new backend health endpoint,
frontend, worker, database contents, and tunnel route have all been verified.

## CI image update

After pushing images tagged with the commit SHA, CI must update the overlay and
commit the result. The equivalent Kustomize operation is:

```bash
cd k8s/overlays/prod
kustomize edit set image \
  jaybee-lab/frontend=ghcr.io/shinjbin/jaybee-lab-frontend:sha-REPLACE \
  jaybee-lab/backend=ghcr.io/shinjbin/jaybee-lab-backend:sha-REPLACE \
  jaybee-lab/bitcoin-trader=ghcr.io/shinjbin/jaybee-lab-bitcoin-trader:sha-REPLACE
```

The CI workflow must avoid triggering another image build from its own manifest
commit, for example with path filters and a bot-commit condition.
