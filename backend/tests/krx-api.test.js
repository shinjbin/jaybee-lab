/**
 * 한국거래소 (KRX) API 통합 테스트
 *
 * KRX Legacy Data API는 인증키 없이 사용 가능.
 * KRX OpenAPI는 .env에 KRX_AUTH_KEY 설정 시 추가 테스트 실행.
 * 실행: node --test backend/tests/krx-api.test.js
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

// .env 파일을 프로젝트 루트에서 로드
require("node:fs")
  .readFileSync(require("node:path").resolve(__dirname, "../../.env"), "utf8")
  .split("\n")
  .forEach((line) => {
    const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2];
    }
  });

const config = require("../src/config");

/**
 * 가장 최근 확정 영업일을 YYYYMMDD 형식으로 반환.
 * KRX 데이터는 장 마감(15:30) 이후에 확정되므로,
 * 안전하게 직전 영업일을 사용한다.
 */
function getLastConfirmedBusinessDay() {
  const now = new Date();
  const seoulDate = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));

  // 최소 1일 전으로 (오늘 데이터는 장중이거나 미확정일 수 있음)
  seoulDate.setDate(seoulDate.getDate() - 1);

  const dayOfWeek = seoulDate.getDay();
  if (dayOfWeek === 0) seoulDate.setDate(seoulDate.getDate() - 2); // 일 → 금
  else if (dayOfWeek === 6) seoulDate.setDate(seoulDate.getDate() - 1); // 토 → 금

  const y = seoulDate.getFullYear();
  const m = String(seoulDate.getMonth() + 1).padStart(2, "0");
  const d = String(seoulDate.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

describe("KRX API 연결 테스트", () => {
  describe("KRX Legacy Data API (시가총액 조회)", () => {
    it("KOSPI 시가총액 데이터를 조회할 수 있어야 한다", async () => {
      const tradingDate = getLastConfirmedBusinessDay();
      console.log(`  조회 기준일: ${tradingDate}`);

      // Legacy API 직접 호출 (세션 쿠키 필요)
      const mainPageUrl = `${config.krxDataBaseUrl}/contents/MDC/MAIN/main/index.cmd`;
      const cookieResponse = await fetch(mainPageUrl, {
        method: "GET",
        headers: {
          Accept: "text/html",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        },
        signal: AbortSignal.timeout(15000)
      });

      // 쿠키 추출
      let sessionCookie = "";
      if (typeof cookieResponse.headers.getSetCookie === "function") {
        sessionCookie = cookieResponse.headers
          .getSetCookie()
          .map((v) => v.split(";")[0])
          .filter(Boolean)
          .join("; ");
      }

      console.log(`  세션 쿠키 획득: ${sessionCookie ? "성공" : "없음 (계속 시도)"}`);

      // 시가총액 데이터 요청
      const dataUrl = `${config.krxDataBaseUrl}/comm/bldAttendant/getJsonData.cmd`;
      const body = new URLSearchParams({
        bld: "dbms/MDC/STAT/standard/MDCSTAT01501",
        locale: "ko_KR",
        mktId: "STK",
        trdDd: tradingDate,
        share: "1",
        money: "1",
        csvxls_isNo: "false"
      });

      const response = await fetch(dataUrl, {
        method: "POST",
        headers: {
          Accept: "application/json, text/javascript, */*; q=0.01",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Cookie: sessionCookie,
          Origin: config.krxDataBaseUrl,
          Referer: `${config.krxDataBaseUrl}/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201020101`,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "X-Requested-With": "XMLHttpRequest"
        },
        body: body.toString(),
        signal: AbortSignal.timeout(15000)
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        console.log(`  ⚠ Legacy API HTTP ${response.status} - KRX 접근 제한 가능 (CORS/봇 차단)`);
        console.log(`    응답(일부): ${body.slice(0, 200)}`);
        console.log(`  → Legacy API는 브라우저 환경에서만 동작할 수 있습니다. OpenAPI 사용을 권장합니다.`);
        return;
      }

      const payload = await response.json();
      const rows = payload?.OutBlock_1 || payload?.output || payload?.block1 || [];

      assert.ok(Array.isArray(rows), "응답이 배열이어야 합니다");
      assert.ok(rows.length > 0, `종목 데이터가 비어 있습니다 (기준일: ${tradingDate})`);

      console.log(`  ✓ 조회 종목 수: ${rows.length}개`);

      // 첫 번째 항목 구조 검증
      const first = rows[0];
      const stockCode = first.ISU_SRT_CD || first.ISU_CD;
      const stockName = first.ISU_ABBRV || first.ISU_NM;
      assert.ok(stockCode, "종목 코드가 없습니다");
      assert.ok(stockName, "종목명이 없습니다");

      console.log(`  ✓ 첫 번째 종목: ${stockName} (${stockCode})`);

      // 상위 5개 출력
      console.log("  ✓ 상위 5개 종목:");
      rows.slice(0, 5).forEach((row, i) => {
        const name = row.ISU_ABBRV || row.ISU_NM;
        const code = row.ISU_SRT_CD || row.ISU_CD;
        const cap = row.MKTCAP || "N/A";
        console.log(`    ${i + 1}. ${name} (${code}) - 시가총액: ${cap}`);
      });
    });
  });

  describe("KRX OpenAPI 테스트", { skip: !config.krxAuthKey && "KRX_AUTH_KEY 미설정" }, () => {
    it("OpenAPI를 통해 KOSPI 종목을 조회할 수 있어야 한다", async () => {
      const tradingDate = getLastConfirmedBusinessDay();
      const baseUrl = config.krxOpenApiBaseUrl || "https://data-dbg.krx.co.kr";
      const path = config.krxKospiStocksPath || "/svc/apis/sto/stk_bydd_trd";
      const url = new URL(`${baseUrl}${path}`);
      url.searchParams.set("basDd", tradingDate);

      console.log(`  요청 URL: ${url.toString()}`);

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          AUTH_KEY: config.krxAuthKey.trim()
        },
        signal: AbortSignal.timeout(15000)
      });

      assert.ok(response.ok, `HTTP 요청 실패: ${response.status}`);

      const payload = await response.json();
      const rows = payload?.OutBlock_1 || payload?.output || payload?.block1 || [];

      assert.ok(rows.length > 0, "OpenAPI 종목 데이터가 비어 있습니다");
      console.log(`  ✓ KRX OpenAPI로 ${rows.length}개 종목 조회 성공`);
    });
  });
});
