# jaybee-lab

React, Express, Nginx, Docker Compose 기반의 샘플 배포 프로젝트입니다.

## 구조

```text
.
├─ .github/workflows/deploy.yml
├─ docker-compose.yml
├─ deploy.sh
├─ nginx/
│  └─ default.conf
└─ app/
   ├─ Dockerfile
   ├─ package.json
   ├─ server.js
   ├─ index.html
   └─ src/
```

## 기술 스택

- React + Vite
- Express
- Nginx
- Docker Compose
- GitHub Actions
- Cloudflare Tunnel optional

## 로컬 실행

### 1. Docker Compose로 실행

```bash
docker compose up -d --build
```

### 2. 확인

- 앱 메인: `http://localhost/`
- 헬스 체크: `http://localhost/health`

## 앱 설명

- React 앱은 `Vite`로 빌드됩니다.
- `Express`가 `dist` 정적 파일과 `/health` 엔드포인트를 제공합니다.
- `Nginx`가 외부 요청을 받아 `app` 컨테이너로 프록시합니다.
- 필요하면 `cloudflared` 컨테이너로 외부 공개 구성을 붙일 수 있습니다.

## 배포

### 서버 준비

서버에 Docker와 Docker Compose가 설치되어 있어야 합니다.

```bash
git clone <repo-url> /path/to/jaybee-lab
cd /path/to/jaybee-lab
chmod +x deploy.sh
./deploy.sh
```

### GitHub Actions 자동 배포 흐름

`main` 브랜치에 push 하면 아래 순서로 동작합니다.

1. GitHub Actions가 `app` 폴더에서 `npm install` 및 `npm run build`를 수행합니다.
2. 빌드가 성공하면 SSH로 배포 서버에 접속합니다.
3. 서버에서 최신 코드를 pull 하고 `deploy.sh`를 실행합니다.
4. `docker compose up -d --build` 로 컨테이너를 재기동합니다.

### GitHub Secrets

Repository Settings > Secrets and variables > Actions 에 아래 값을 등록합니다.

- `SSH_HOST`: 배포 서버 주소
- `SSH_USER`: SSH 사용자명
- `SSH_KEY`: 개인키 내용
- `SSH_PORT`: SSH 포트, 보통 `22`
- `DEPLOY_PATH`: 서버 내 프로젝트 경로
- `CF_TUNNEL_TOKEN`: Cloudflare Tunnel 사용 시 필요

## 참고 파일

- 워크플로: `.github/workflows/deploy.yml`
- Docker 설정: `docker-compose.yml`
- 앱 서버: `app/server.js`
- 프론트엔드 엔트리: `app/src/main.jsx`
