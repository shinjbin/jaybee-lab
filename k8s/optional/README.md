# Optional Kubernetes addons

## Metrics Server

Install Metrics Server to enable resource usage commands:

```bash
kubectl apply -f k8s/optional/metrics-server.yaml
kubectl -n kube-system rollout status deployment/metrics-server
kubectl top nodes
kubectl -n jaybee-lab top pods
```

The manifest includes `--kubelet-insecure-tls` for a single-node kubeadm cluster where kubelet serving certificates may not have a trusted CA or matching IP SANs.

For a hardened production cluster, replace kubelet serving certificates with properly signed certificates and remove `--kubelet-insecure-tls`.

## Cloudflare Tunnel

Set `CF_TUNNEL_TOKEN` in `cloudflared.yaml`, then apply it after the base stack:

```bash
kubectl apply -f k8s/optional/cloudflared.yaml
```
