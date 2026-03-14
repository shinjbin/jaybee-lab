# jaybee-lab

확장 가능한 프론트엔드와 백엔드 분리 구조를 가진 샘플 배포 프로젝트입니다. 이제 주기적으로 뉴스 RSS를 수집하고, AI 또는 기본 규칙 기반 로직으로 요약하는 뉴스 브리핑 기능이 포함되어 있습니다.

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
├─ deploy.sh
└─ nginx/
   └─ default.conf
```

## 왜 이렇게 나누나

- `frontend/`는 UI 전용이라 React 코드가 커져도 관리가 쉽습니다.
- `backend/`는 API 전용이라 인증, DB, 비즈니스 로직을 붙이기 좋습니다.
- `worker`는 별도 컨테이너로 돌아가며 RSS 수집과 기사 요약을 담당합니다.
- `postgres`는 수집 기사, 요약 결과, 작업 이력을 저장합니다.
- `nginx`는 `/`와 `/api`를 라우팅만 담당해서 역할이 분명합니다.
- 배포 시 프론트와 백엔드를 독립적으로 교체하기 쉬워집니다.

## 라우팅

- `/` -> frontend
- `/api/health` -> backend
- `/api/message` -> backend
- `/api/news` -> 수집 기사 목록
- `/api/briefing/latest` -> 최근 브리핑

## 뉴스 브리핑 기능

- `worker` 컨테이너가 기본 30분마다 RSS 피드를 조회합니다.
- 수집된 기사는 PostgreSQL에 저장됩니다.
- `OPENAI_API_KEY`가 있으면 한국어 AI 요약을 시도합니다.
- 키가 없어도 fallback 요약이 만들어져 대시보드가 계속 동작합니다.

기본 RSS 피드:
- BBC Business
- New York Times Business
- BBC World
- New York Times World

필요 시 `NEWS_FEEDS` 환경 변수로 JSON 배열을 넣어 피드를 교체할 수 있습니다.

## 로컬 실행

```bash
cp .env.example .env
docker compose up -d --build
```

확인 주소:
- `http://localhost/`
- `http://localhost/api/health`
- `http://localhost/api/briefing/latest`

환경 변수 예시:

```bash
OPENAI_API_KEY=your-key
OPENAI_MODEL=gpt-4o-mini
NEWS_POLL_INTERVAL_MINUTES=30
```

## 배포

서버 첫 설정:

```bash
mkdir -p /home/jb/app
git clone https://github.com/shinjbin/jaybee-lab.git /home/jb/app
cd /home/jb/app
chmod +x deploy.sh
docker compose up -d --build
```

GitHub Actions는 `main` 브랜치 push 시:
- frontend 의존성 설치 및 빌드
- backend 의존성 설치
- SSH 접속 후 `deploy.sh` 실행

필요한 GitHub Secrets:
- `SSH_HOST`
- `SSH_USER`
- `SSH_KEY`
- `SSH_PORT`
- `DEPLOY_PATH`
- `CF_TUNNEL_TOKEN` 사용 시 추가
