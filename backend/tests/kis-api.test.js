/**
 * 한국투자증권 (KIS) API 통합 테스트
 *
 * 실행 전 .env에 KIS_APP_KEY, KIS_APP_SECRET 설정 필요.
 * 실행: node --test backend/tests/kis-api.test.js
 */
const { describe, it, before } = require("node:test");
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
const kis = require("../src/kisClient");

const ENABLED = Boolean(config.kisAppKey && config.kisAppSecret);

describe("KIS API 연결 테스트", { skip: !ENABLED && "KIS_APP_KEY / KIS_APP_SECRET 미설정" }, () => {
  describe("OAuth2 토큰 발급", () => {
    it("액세스 토큰을 정상적으로 발급받아야 한다", async () => {
      const token = await kis.getAccessToken();
      assert.ok(token, "토큰이 비어 있습니다");
      assert.equal(typeof token, "string");
      console.log(`  ✓ 토큰 발급 성공 (길이: ${token.length})`);
    });

    it("연속 호출 시 캐시된 토큰을 반환해야 한다", async () => {
      const token1 = await kis.getAccessToken();
      const token2 = await kis.getAccessToken();
      assert.equal(token1, token2, "캐시된 토큰이 동일해야 합니다");
    });
  });

  describe("현재가 조회 (삼성전자 005930)", () => {
    it("삼성전자 현재가를 조회할 수 있어야 한다", async () => {
      const result = await kis.fetchCurrentPrice("005930");
      assert.ok(result, "응답이 비어 있습니다");
      assert.ok(result.stck_prpr || result.stck_clpr, "주가 데이터가 없습니다");
      const price = result.stck_prpr || result.stck_clpr;
      console.log(`  ✓ 삼성전자 현재가: ${Number(price).toLocaleString()}원`);
    });
  });

  describe("외국인/기관 순매매 랭킹", () => {
    it("외국인 순매수 상위 종목을 조회할 수 있어야 한다", async () => {
      const rows = await kis.fetchForeignInstitutionRanking("foreign", "buy");
      assert.ok(Array.isArray(rows), "응답이 배열이어야 합니다");
      assert.ok(rows.length > 0, "외국인 순매수 데이터가 비어 있습니다");
      console.log(`  ✓ 외국인 순매수 상위 ${rows.length}개 종목 조회`);
      if (rows[0]) {
        console.log(`    1위: ${rows[0].hts_kor_isnm || rows[0].stck_shrn_iscd}`);
      }
    });

    it("기관 순매수 상위 종목을 조회할 수 있어야 한다", async () => {
      const rows = await kis.fetchForeignInstitutionRanking("institution", "buy");
      assert.ok(Array.isArray(rows), "응답이 배열이어야 합니다");
      assert.ok(rows.length > 0, "기관 순매수 데이터가 비어 있습니다");
      console.log(`  ✓ 기관 순매수 상위 ${rows.length}개 종목 조회`);
    });
  });

  describe("시가총액 랭킹", () => {
    it("시가총액 상위 종목을 조회할 수 있어야 한다", async () => {
      const rows = await kis.fetchMarketCapRanking();
      assert.ok(Array.isArray(rows), "응답이 배열이어야 합니다");
      assert.ok(rows.length > 0, "시가총액 데이터가 비어 있습니다");
      console.log(`  ✓ 시가총액 상위 ${rows.length}개 종목 조회`);
      if (rows[0]) {
        console.log(`    1위: ${rows[0].hts_kor_isnm || rows[0].stck_shrn_iscd}`);
      }
    });
  });

  describe("KOSPI 지수", () => {
    it("KOSPI 지수 현재가를 조회할 수 있어야 한다", async () => {
      const result = await kis.fetchIndexPrice();
      assert.ok(result, "응답이 비어 있습니다");
      const price = result?.output?.bstp_nmix_prpr;
      if (price) {
        console.log(`  ✓ KOSPI 지수: ${price}`);
      } else {
        console.log("  ✓ KOSPI 지수 응답 수신 (장 마감 후 값 없을 수 있음)");
      }
    });

    it("KOSPI 지수 일별 차트 데이터를 조회할 수 있어야 한다", async () => {
      const today = new Date();
      const thirtyDaysAgo = new Date(today);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const fmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
      const result = await kis.fetchIndexDailyChartPrice({
        startDate: fmt(thirtyDaysAgo),
        endDate: fmt(today)
      });

      assert.ok(result, "응답이 비어 있습니다");
      const rows = result?.output2 || result?.output1 || [];
      console.log(`  ✓ KOSPI 일별 차트: ${rows.length}건 조회`);
    });
  });
});
