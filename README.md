# JAYBEE LAB

국내외 금융 시장 정보를 한 화면에서 확인할 수 있는 개인 대시보드입니다.  
배포 주소: **https://www.jaybeelab.com**

---

## 주요 기능

### 시장요약
글로벌 주요 지수(코스피, 나스닥, S&P 500 등)의 현재가·등락률과 최근 N일 종가 스파크라인 차트를 카드 형태로 제공합니다. 차트를 클릭하면 특정 날짜의 지수값을 툴팁으로 확인할 수 있습니다.

### 종목조회
코스피 전체 종목을 종목명 또는 종목코드로 검색할 수 있습니다. 종목 카드를 클릭하면 네이버 증권(모바일에서는 m.stock.naver.com) 차트 페이지로 바로 이동합니다. 종가와 시가총액을 함께 표시합니다.

### 뉴스
날짜를 선택해 해당일 수집된 해외 금융 뉴스를 조회합니다. 각 기사에는 AI가 분석한 시장 영향도(impact)와 감성(긍정·부정·중립), 한국어 번역 제목, 영문 요약이 포함됩니다. 기사를 선택하면 요약 및 전문을 상세 패널에서 확인하고 원문 링크로 이동할 수 있습니다.

### 수급동향
KIS(한국투자증권) Open API 기반으로 코스피 외국인·기관 매매동향을 제공합니다.

- 일간 순매수·순매도 TOP 10
- 최근 N일 누적 순매수·순매도 TOP 10
- 외국인·기관 매매 추이 차트
- 날짜 범위를 직접 선택하면 해당 기간 기준 누적 TOP 순위와 추이를 함께 확인 가능

### AI분석
날짜를 선택해 해당일 생성된 AI 시장 분석 리포트를 조회합니다. 리포트는 **시장 동향·주요 테마·수급 분석·리스크 요인·단기 전망** 섹션으로 구성되며, 사용된 AI 모델과 생성 일시를 함께 표시합니다.

---

## 프로젝트 구조

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

- `docker-compose.yml` — 운영 기본 설정
- `docker-compose.local.yml` — 로컬 테스트용 포트 노출 추가

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

- `KIS_ENV=real` 기본 URL: `https://openapi.koreainvestment.com:9443`
- `KIS_ENV=demo` 기본 URL: `https://openapivts.koreainvestment.com:29443`
- `KIS_BASE_URL`은 보통 비워둬도 됩니다.
- 수급동향 수집은 KST 기준 08:00–16:59에만 실행됩니다.
- `KRX_AUTH_KEY`가 없거나 API 호출 실패 시 `data.krx.co.kr` 방식으로 자동 fallback 됩니다.
