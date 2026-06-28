# Runtime Secrets

Files ending in `.example.yaml` are safe templates only. Copy them to filenames
without `.example`, fill in the real values, and apply them directly to the
cluster before creating the Argo CD Application.

```bash
cp k8s/secrets/jaybee-secret.example.yaml k8s/secrets/jaybee-secret.yaml
cp k8s/secrets/cloudflared-secret.example.yaml k8s/secrets/cloudflared-secret.yaml
```

The copied files are ignored by Git. Real credentials must never be committed.
See `k8s/PRODUCTION.md` for the complete bootstrap sequence.
