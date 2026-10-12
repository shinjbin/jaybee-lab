# Runtime Secrets

`.example.yaml` 파일은 안전한 템플릿입니다. 실제 값은 `.example`이 없는 파일로 복사한 뒤 클러스터에 직접 적용합니다.

```bash
cp k8s/secrets/jaybee-secret.example.yaml k8s/secrets/jaybee-secret.yaml
cp k8s/secrets/cloudflared-secret.example.yaml k8s/secrets/cloudflared-secret.yaml
```

`jaybee-secret.yaml`에는 역할별로 분리된 다섯 개의 Secret이 들어 있습니다.

- `jaybee-database-secret`: PostgreSQL 초기화·마이그레이션 관리자 자격증명
- `jaybee-app-database-secret`: backend/worker 전용 일반 DB 계정. `DATABASE_PASSWORD`는 관리자 비밀번호와 다른 32자 이상의 무작위 값, `DATABASE_NAME`은 `POSTGRES_DB`와 같은 DB 이름으로 설정
- `jaybee-api-secret`: 쓰기 API용 `ADMIN_API_KEY`
- `jaybee-data-secret`: 뉴스·OpenAI·토스증권·KRX API 키
- `jaybee-trader-secret`: Binance Spot, Upbit 연결 점검, Telegram 자격증명
  (dry-run 매매는 Binance 키 불필요, 시작 점검에서 키가 없으면 인증 미설정으로 알림)

관리 API 키는 최소 32자의 무작위 값으로 생성합니다.

```bash
openssl rand -hex 32
```

복사한 파일은 Git에서 무시됩니다. 실제 자격증명은 절대로 커밋하지 마세요. 전체 부트스트랩 순서는 `k8s/PRODUCTION.md`를 참고하세요.

기존 클러스터에도 `jaybee-app-database-secret`을 먼저 생성해야 합니다. 기존
`jaybee-database-secret`과 데이터 PVC는 유지합니다. Argo CD의 `db-migrate` Job이
스키마를 갱신하고 일반 계정을 생성·권한 설정한 다음 backend/worker를 배포합니다.
관리자 Secret은 serving Pod에 주입하지 않습니다.

## 기존 운영 DB에 앱 전용 Secret 추가

이번 변경에서는 기존 `jaybee-database-secret`의 `POSTGRES_USER`,
`POSTGRES_PASSWORD`, `POSTGRES_DB`를 그대로 유지하고, 앱 전용 Secret 하나를
추가합니다. 기존 Secret 파일을 예제 파일로 덮어쓰지 마세요.

1. 현재 DB 이름을 확인합니다. 아래 명령은 비밀번호를 출력하지 않습니다.

   ```bash
   kubectl -n jaybee-lab get secret jaybee-database-secret \
     -o go-template='{{index .data "POSTGRES_DB" | base64decode}}{{"\n"}}'
   ```

2. 앱 전용 비밀번호를 생성합니다. 기존 관리자 비밀번호와 다른 값을 사용합니다.

   ```bash
   openssl rand -hex 32
   ```

3. `k8s/secrets/jaybee-app-database-secret.yaml` 파일을 아래 내용으로 만듭니다.
   `DATABASE_NAME`은 1번 결과, `DATABASE_PASSWORD`는 2번 결과로 바꿉니다.
   `DATABASE_USER`는 기본값 `news_app`을 사용합니다. 이 이름은 기존 관리자
   계정과 달라야 합니다.

   ```yaml
   apiVersion: v1
   kind: Secret
   metadata:
     name: jaybee-app-database-secret
     namespace: jaybee-lab
   type: Opaque
   stringData:
     DATABASE_NAME: "news_digest"
     DATABASE_USER: "news_app"
     DATABASE_PASSWORD: "REPLACE_WITH_GENERATED_PASSWORD"
   ```

4. 파일 권한과 Git 제외 상태를 확인한 다음, 새 Secret만 적용합니다.

   ```bash
   chmod 600 k8s/secrets/jaybee-app-database-secret.yaml
   git check-ignore k8s/secrets/jaybee-app-database-secret.yaml
   kubectl apply -f k8s/secrets/jaybee-app-database-secret.yaml
   kubectl -n jaybee-lab get secret jaybee-app-database-secret
   ```

   `git check-ignore`는 파일 경로를 출력해야 합니다. 새 Secret 생성만으로 DB
   사용자나 비밀번호가 변경되지는 않습니다.

5. DB 백업을 확인한 뒤, 보안 수정 이미지가 반영된 Git 버전으로 Argo CD를
   Sync합니다. `db-migrate` Job이 `news_app`을 생성하고 비밀번호·권한을 설정한
   다음 backend/worker가 새 계정으로 배포됩니다. Job 성공 시 자동 삭제되므로
   완료 여부는 Argo CD의 Sync 결과에서도 확인합니다.

   ```bash
   kubectl -n jaybee-lab get jobs,pods
   kubectl -n jaybee-lab rollout status deployment/backend
   kubectl -n jaybee-lab rollout status deployment/worker
   ```

마이그레이션이 실패하면 Argo CD는 새 앱 배포를 진행하지 않습니다. 남아 있는
Job은 `kubectl -n jaybee-lab logs job/db-migrate`로 확인합니다. 실패한 Job과
Secret 설정을 점검한 뒤 다시 Sync합니다. DB 관리자 Secret이나 PVC를 삭제할
필요는 없습니다.

### 앱 DB 비밀번호를 나중에 변경할 때

`jaybee-app-database-secret.yaml`의 `DATABASE_PASSWORD`를 새 무작위 값으로
바꾸고 다시 적용합니다. Secret 변경은 실행 중인 Pod 환경변수나 DB 역할의
비밀번호를 자동으로 바꾸지 않습니다. 관리 API 트래픽과 수집을 잠시 중단할 수
있는 시점에 Argo CD Sync로 `db-migrate`를 다시 실행한 뒤, 아래 명령으로 앱
Pod를 재시작합니다. 마이그레이션 완료와 rollout을 확인한 뒤 트래픽을 재개합니다.

```bash
kubectl apply -f k8s/secrets/jaybee-app-database-secret.yaml
# Argo CD Sync에서 db-migrate 성공 확인 후 실행합니다.
kubectl -n jaybee-lab rollout restart deployment/backend deployment/worker
kubectl -n jaybee-lab rollout status deployment/backend
kubectl -n jaybee-lab rollout status deployment/worker
```

`jaybee-database-secret`의 관리자 비밀번호 변경은 별도 작업입니다. 기존 PVC가
있는 PostgreSQL은 Secret의 `POSTGRES_PASSWORD`만 변경해도 DB 내부 비밀번호가
바뀌지 않으므로, 이번 앱 계정 분리 과정에서는 해당 값을 변경하지 않습니다.
