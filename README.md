# jaybee-lab

확장 가능한 프론트엔드와 백엔드 분리 구조를 가진 샘플 배포 프로젝트입니다.

## 구조

```text
.
├─ .github/workflows/deploy.yml
├─ backend/
│  ├─ Dockerfile
│  ├─ package.json
│  └─ server.js
├─ frontend/
│  ├─ Dockerfile
│  ├─ package.json
│  ├─ index.html
│  └─ src/
├─ docker-compose.yml
├─ deploy.sh
└─ nginx/
   └─ default.conf
```

## 왜 이렇게 나누나

- `frontend/`는 UI 전용이라 React 코드가 커져도 관리가 쉽습니다.
- `backend/`는 API 전용이라 인증, DB, 비즈니스 로직을 붙이기 좋습니다.
- `nginx`는 `/`와 `/api`를 라우팅만 담당해서 역할이 분명합니다.
- 배포 시 프론트와 백엔드를 독립적으로 교체하기 쉬워집니다.

## 라우팅

- `/` -> frontend
- `/api/health` -> backend
- `/api/message` -> backend

## 로컬 실행

```bash
docker compose up -d --build
```

확인 주소:
- `http://localhost/`
- `http://localhost/api/health`

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
