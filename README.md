# jaybee-lab

확장 가능한 프론트엔드와 백엔드 분리 구조를 가진 샘플 배포 프로젝트입니다. 이제 주기적으로 뉴스 RSS를 수집하고, AI 또는 기본 규칙 기반 로직으로 요약하는 뉴스 브리핑 기능과 KIS 기반 투자자별 매매동향 대시보드를 제공합니다.

## 구조

```text
.
├─ .github/workflows/deploy.yml
├─ backend/
│  ├─ Dockerfile
│  ├─ package.json
│  ├─ server.js
│  ├─ worker.js
│  └─ src/
├─ frontend/
│  ├─ Dockerfile
│  ├─ package.json
│  ├─ index.html
│  └─ src/
├─ .env.example
├─ docker-compose.yml
├─ docker-compose.local.yml
├─ deploy.sh
└─ nginx/
   └─ default.conf
```

## 실행 모드

- `docker-compose.yml`은 운영 기본 설정입니다.
- `docker-compose.local.yml`은 로컬 테스트용 포트 노출만 추가합니다.
- 운영 서버에서는 `docker-compose.yml`만 사용하므로 포트 80 충돌을 피할 수 있습니다.

## 로컬 실행

```bash
cp .env.example .env
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

확인 주소:
- `http://localhost/`
- `http://localhost/api/health`
- `http://localhost/api/briefing/latest`
- `http://localhost/api/investor-flows/kospi`

## 운영 배포

서버 첫 설정:

```bash
mkdir -p /home/jb/app
git clone https://github.com/shinjbin/jaybee-lab.git /home/jb/app
cd /home/jb/app
chmod +x deploy.sh
./deploy.sh
```

운영 배포는 내부 네트워크 + Cloudflare Tunnel 기준으로 동작하며, `deploy.sh`는 `docker-compose.yml`만 사용합니다.

## 환경 변수

```bash
POSTGRES_DB=news_digest
POSTGRES_USER=news_user
POSTGRES_PASSWORD=change-me

NEWS_POLL_INTERVAL_MINUTES=30
NEWS_FETCH_LIMIT_PER_FEED=8
NEWS_SUMMARY_BATCH_SIZE=10
BRIEFING_WINDOW_HOURS=48

OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
OPENAI_BASE_URL=https://api.openai.com/v1

KIS_APP_KEY=
KIS_APP_SECRET=
KIS_ENV=real
KIS_BASE_URL=
KIS_MARKET_FLOW_ENABLED=true
KIS_MARKET_CODE=0001
KIS_FLOW_TOP_COUNT=10
KIS_FLOW_COLLECTION_START_HOUR=8
KIS_FLOW_COLLECTION_END_HOUR=16
```

- `KIS_ENV=real`이면 기본 URL은 `https://openapi.koreainvestment.com:9443`
- `KIS_ENV=demo`이면 기본 URL은 `https://openapivts.koreainvestment.com:29443`
- `KIS_BASE_URL`은 보통 비워둬도 됩니다.
- 투자자별 매매동향 수집은 KST 기준 `08:00`부터 `16:59`까지만 실행됩니다.
