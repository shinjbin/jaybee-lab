# Kubernetes monitoring

This directory contains the local-server monitoring setup for the cluster.

It uses the `prometheus-community/kube-prometheus-stack` Helm chart, which installs:

- Prometheus
- Grafana
- Alertmanager
- kube-state-metrics
- node-exporter
- default Kubernetes dashboards and alert rules

## Access model

Grafana is intentionally not exposed with Ingress, NodePort, or LoadBalancer.

The Grafana Service is `ClusterIP`, so access should happen through `kubectl port-forward` from a machine/user that already has cluster access:

```bash
kubectl -n monitoring port-forward svc/jaybee-monitoring-grafana 3001:80
```

Open:

```text
http://localhost:3001
```

This keeps the dashboard private to the person with SSH/kubeconfig access. Do not expose this Service directly to the internet. If you later need remote browser access, put Cloudflare Access, VPN, or another identity-aware proxy in front of it.

## Install

Create the namespace:

```bash
kubectl create namespace monitoring
```

Create the Grafana admin credential as a Kubernetes Secret. Choose your own password:

```bash
kubectl -n monitoring create secret generic grafana-admin \
  --from-literal=admin-user=admin \
  --from-literal=admin-password='CHANGE_ME_TO_A_LONG_PASSWORD'
```

Install the Helm chart:

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
helm upgrade --install jaybee-monitoring prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --values k8s/monitoring/kube-prometheus-stack-values.yaml
```

Wait for rollout:

```bash
kubectl -n monitoring get pods
kubectl -n monitoring rollout status deployment/jaybee-monitoring-grafana
kubectl -n monitoring rollout status statefulset/prometheus-jaybee-monitoring-prometheus
```

## Open Grafana

```bash
kubectl -n monitoring port-forward svc/jaybee-monitoring-grafana 3001:80
```

Then open:

```text
http://localhost:3001
```

Use the admin username/password from the `grafana-admin` Secret.

## Useful checks

```bash
kubectl -n monitoring get svc,pods,pvc
kubectl -n monitoring get servicemonitor,podmonitor
kubectl get --raw /api/v1/nodes
```

The chart also deploys default Kubernetes dashboards. In Grafana, open `Dashboards` and look for Kubernetes dashboards for cluster, namespace, pod, node, and workload views.

## Notes

This setup is for a single-node kubeadm server using local persistent volumes. Prometheus and Alertmanager request PVCs, so `local-path` or another default StorageClass must already be installed.

The existing `metrics-server` optional manifest is still useful for `kubectl top`, but Grafana dashboards use Prometheus metrics from this stack.

## Path-based domain access

Grafana is configured to run under `/monitoring/` on the existing application domain.

Apply the monitoring stack, then update the app Nginx ConfigMap/Deployment:

```bash
kubectl apply -f k8s/base/nginx.yaml
kubectl -n jaybee-lab rollout restart deployment/nginx
kubectl -n jaybee-lab rollout status deployment/nginx
```

Open:

```text
https://YOUR_DOMAIN/monitoring/
```

Grafana anonymous access is disabled. The user must sign in with the credentials from the `grafana-admin` Secret before dashboards are visible.

The Grafana Service remains `ClusterIP`; the existing app Nginx is the only entry point for the `/monitoring/` path.
