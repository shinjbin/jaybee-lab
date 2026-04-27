/**
 * 유닛 테스트 - API 호출 없이 내부 로직 검증
 *
 * 실행: node --test backend/tests/unit.test.js
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { toSeoulDateString, getSeoulDateParts, isWithinSeoulTimeWindow } = require("../src/dateUtils");

describe("dateUtils 유닛 테스트", () => {
  describe("toSeoulDateString", () => {
    it("Date 객체를 YYYY-MM-DD 서울 시간 문자열로 변환해야 한다", () => {
      // UTC 2024-01-15 15:00 = KST 2024-01-16 00:00
      const date = new Date("2024-01-15T15:00:00Z");
      const result = toSeoulDateString(date);
      assert.equal(result, "2024-01-16");
    });

    it("인자 없이 호출하면 오늘 서울 날짜를 반환해야 한다", () => {
      const result = toSeoulDateString();
      assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe("getSeoulDateParts", () => {
    it("Date 객체에서 서울 시간 구성 요소를 추출해야 한다", () => {
      const date = new Date("2024-06-15T03:30:00Z"); // KST 12:30
      const parts = getSeoulDateParts(date);
      assert.equal(parts.year, 2024);
      assert.equal(parts.month, 6);
      assert.equal(parts.day, 15);
      assert.equal(parts.hour, 12);
      assert.equal(parts.minute, 30);
    });
  });

  describe("isWithinSeoulTimeWindow", () => {
    it("서울 시간 08:00~16:59 범위 내 시각은 true를 반환해야 한다", () => {
      // UTC 01:00 = KST 10:00
      const date = new Date("2024-06-15T01:00:00Z");
      assert.equal(isWithinSeoulTimeWindow(8, 16, date), true);
    });

    it("서울 시간 17:00 이후는 false를 반환해야 한다", () => {
      // UTC 09:00 = KST 18:00
      const date = new Date("2024-06-15T09:00:00Z");
      assert.equal(isWithinSeoulTimeWindow(8, 16, date), false);
    });

    it("서울 시간 08:00 이전은 false를 반환해야 한다", () => {
      // UTC 22:00 (전날) = KST 07:00
      const date = new Date("2024-06-14T22:00:00Z");
      assert.equal(isWithinSeoulTimeWindow(8, 16, date), false);
    });
  });
});

describe("config 모듈 유닛 테스트", () => {
  it("config가 올바른 KIS base URL 형식을 가져야 한다", () => {
    const config = require("../src/config");
    assert.ok(config.kisBaseUrl.startsWith("https://"), "KIS base URL은 https로 시작해야 합니다");
    assert.ok(!config.kisBaseUrl.endsWith("/"), "KIS base URL은 슬래시로 끝나면 안 됩니다");
  });

  it("config가 올바른 KRX base URL 형식을 가져야 한다", () => {
    const config = require("../src/config");
    assert.ok(config.krxDataBaseUrl.startsWith("https://"), "KRX data base URL은 https로 시작해야 합니다");
    assert.ok(config.krxOpenApiBaseUrl.startsWith("https://"), "KRX OpenAPI base URL은 https로 시작해야 합니다");
  });

  it("kisEnabled는 KIS 키 설정 여부에 따라 결정되어야 한다", () => {
    const config = require("../src/config");
    const expected = Boolean(process.env.KIS_APP_KEY) && Boolean(process.env.KIS_APP_SECRET);
    assert.equal(config.kisEnabled, expected);
  });

  it("기본 타임아웃 값이 양수여야 한다", () => {
    const config = require("../src/config");
    assert.ok(config.kisRequestTimeoutMs > 0);
    assert.ok(config.krxRequestTimeoutMs > 0);
  });
});
