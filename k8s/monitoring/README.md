# Kubernetes monitoring

이 디렉터리는 `prometheus-community/kube-prometheus-stack` 기반의 Prometheus, Grafana, Alertmanager 모니터링 설정을 포함합니다.

## 접근 모델

Grafana Service는 `ClusterIP`이며 애플리케이션 nginx의 `/monitoring/` 경로로 공개하지 않습니다. 클러스터 접근 권한이 있는 관리자가 port-forward로 접속합니다.

```bash
kubectl -n monitoring port-forward svc/jaybee-monitoring-grafana 3001:80
```

브라우저에서 `http://localhost:3001`을 엽니다.

외부 브라우저 접근이 필요하면 별도 호스트명에 Cloudflare Access, VPN 또는 다른 identity-aware proxy를 먼저 적용하세요.

## 설치

```bash
kubectl create namespace monitoring

kubectl -n monitoring create secret generic grafana-admin \
  --from-literal=admin-user=admin \
  --from-literal=admin-password='CHANGE_ME_TO_A_LONG_RANDOM_PASSWORD'

helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
helm upgrade --install jaybee-monitoring prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --values k8s/monitoring/kube-prometheus-stack-values.yaml
```

상태 확인:

```bash
kubectl -n monitoring get pods,svc,pvc
kubectl -n monitoring rollout status deployment/jaybee-monitoring-grafana
kubectl -n monitoring rollout status statefulset/prometheus-jaybee-monitoring-prometheus
```

Prometheus와 Alertmanager의 PVC에는 기본 StorageClass가 필요합니다. PVC는 백업이 아니므로 필요한 모니터링 데이터를 별도로 보존하세요.
