# Runtime Secrets

`.example.yaml` 파일은 안전한 템플릿입니다. 실제 값은 `.example`이 없는 파일로 복사한 뒤 클러스터에 직접 적용합니다.

```bash
cp k8s/secrets/jaybee-secret.example.yaml k8s/secrets/jaybee-secret.yaml
cp k8s/secrets/cloudflared-secret.example.yaml k8s/secrets/cloudflared-secret.yaml
```

`jaybee-secret.yaml`에는 역할별로 분리된 네 개의 Secret이 들어 있습니다.

- `jaybee-database-secret`: PostgreSQL 자격증명
- `jaybee-api-secret`: 쓰기 API용 `ADMIN_API_KEY`
- `jaybee-data-secret`: 뉴스·OpenAI·KIS·KRX API 키
- `jaybee-trader-secret`: Upbit와 Telegram 자격증명

관리 API 키는 최소 32자의 무작위 값으로 생성합니다.

```bash
openssl rand -hex 32
```

복사한 파일은 Git에서 무시됩니다. 실제 자격증명은 절대로 커밋하지 마세요. 전체 부트스트랩 순서는 `k8s/PRODUCTION.md`를 참고하세요.
