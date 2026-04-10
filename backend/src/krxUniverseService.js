const config = require("./config");
const { toSeoulDateString } = require("./dateUtils");

const KRX_MAIN_PAGE_PATH = "/contents/MDC/MAIN/main/index.cmd";
const KRX_MARKET_CAP_PATH = "/comm/bldAttendant/getJsonData.cmd";
const KRX_MARKET_CAP_BLD = "dbms/MDC/STAT/standard/MDCSTAT01501";

let cache = {
  date: "",
  source: "",
  items: []
};

function normalizeNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const normalized = String(value).replace(/,/g, "").replace(/\s+/g, "").trim();
  return /^[-+]?\d+(\.\d+)?$/.test(normalized) ? normalized : null;
}

function isIntegerString(value) {
  return /^[-+]?\d+$/.test(String(value || "").trim());
}

function multiplyNumericStrings(left, right) {
  if (!left || !right) {
    return null;
  }

  if (isIntegerString(left) && isIntegerString(right)) {
    return (BigInt(left) * BigInt(right)).toString();
  }

  const result = Math.round(Number(left) * Number(right));
  return Number.isFinite(result) ? String(result) : null;
}

function compareNumericStrings(left, right) {
  const normalizedLeft = normalizeNumber(left);
  const normalizedRight = normalizeNumber(right);

  if (!normalizedLeft && !normalizedRight) {
    return 0;
  }

  if (!normalizedLeft) {
    return -1;
  }

  if (!normalizedRight) {
    return 1;
  }

  if (isIntegerString(normalizedLeft) && isIntegerString(normalizedRight)) {
    const leftValue = BigInt(normalizedLeft);
    const rightValue = BigInt(normalizedRight);

    if (leftValue === rightValue) {
      return 0;
    }

    return leftValue > rightValue ? 1 : -1;
  }

  const leftValue = Number(normalizedLeft);
  const rightValue = Number(normalizedRight);

  if (leftValue === rightValue) {
    return 0;
  }

  return leftValue > rightValue ? 1 : -1;
}

function pickFirst(row, candidates) {
  for (const candidate of candidates) {
    const value = row?.[candidate];

    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }

  return null;
}

function normalizeStockCode(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits ? digits.padStart(6, "0") : "";
}

function toKrDateString(dateString = toSeoulDateString()) {
  return String(dateString || "").replace(/\D/g, "");
}

function extractRows(payload) {
  if (Array.isArray(payload?.OutBlock_1)) {
    return payload.OutBlock_1;
  }

  if (Array.isArray(payload?.output)) {
    return payload.output;
  }

  if (Array.isArray(payload?.block1)) {
    return payload.block1;
  }

  return [];
}

function getCookieHeader(response) {
  if (typeof response?.headers?.getSetCookie === "function") {
    return response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .filter(Boolean)
      .join("; ");
  }

  const rawHeader = response?.headers?.get("set-cookie");

  if (!rawHeader) {
    return "";
  }

  return rawHeader
    .split(/,(?=[^;]+?=)/g)
    .map((value) => value.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

function mapUniverseRow(row) {
  const stockCode = normalizeStockCode(
    pickFirst(row, ["ISU_SRT_CD", "ISU_CD", "isuSrtCd", "isuCd", "short_code"])
  );
  const stockName = String(
    pickFirst(row, ["ISU_ABBRV", "ISU_NM", "isuAbbrv", "isuNm", "name"]) || ""
  ).trim();
  const closePrice = normalizeNumber(
    pickFirst(row, ["TDD_CLSPRC", "CLSPRC", "tddClsprc", "close_price"])
  );
  const sharesOutstanding = normalizeNumber(
    pickFirst(row, ["LIST_SHRS", "list_shrs", "listShrs", "listed_shares"])
  );
  const marketCap = normalizeNumber(
    pickFirst(row, ["MKTCAP", "mktcap", "market_cap"])
  );

  if (!stockCode || !stockName) {
    return null;
  }

  return {
    stockCode,
    stockName,
    closePrice,
    sharesOutstanding,
    marketCap: marketCap || multiplyNumericStrings(closePrice, sharesOutstanding),
    rawPayload: row
  };
}

function buildOpenApiUrl() {
  const baseUrl = config.krxOpenApiBaseUrl || "https://data-dbg.krx.co.kr";
  const path = String(config.krxKospiStocksPath || "/svc/apis/sto/stk_bydd_trd").trim();

  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

async function getKrSessionCookie() {
  const response = await fetch(`${config.krxDataBaseUrl}${KRX_MAIN_PAGE_PATH}`, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"
    },
    signal: AbortSignal.timeout(config.krxRequestTimeoutMs)
  });

  return getCookieHeader(response);
}

async function fetchKospiStocksFromOpenApi(today) {
  if (!config.krxAuthKey) {
    throw new Error("KRX_AUTH_KEY is not configured.");
  }

  const requestUrl = buildOpenApiUrl();
  const requestDate = toKrDateString(today);
  const requestUrlObject = new URL(requestUrl);
  requestUrlObject.searchParams.set("basDd", requestDate);

  const response = await fetch(requestUrlObject, {
    method: "GET",
    headers: {
      Accept: "application/json, text/plain, */*",
      AUTH_KEY: config.krxAuthKey.trim()
    },
    signal: AbortSignal.timeout(config.krxRequestTimeoutMs)
  });

  if (!response.ok) {
    throw new Error(`KRX OpenAPI request failed (${response.status}) for ${requestUrlObject.toString()}.`);
  }

  const payload = await response.json().catch(() => null);
  const rows = extractRows(payload);
  const items = rows
    .map(mapUniverseRow)
    .filter((item) => item?.marketCap)
    .sort((left, right) => {
      const marketCapCompare = compareNumericStrings(right.marketCap, left.marketCap);

      if (marketCapCompare !== 0) {
        return marketCapCompare;
      }

      return left.stockCode.localeCompare(right.stockCode, "en");
    });

  if (items.length === 0) {
    throw new Error("KRX OpenAPI response did not include usable KOSPI rows.");
  }

  return {
    source: "krx_open_api",
    items
  };
}

async function fetchKospiStocksFromLegacyDataApi(today) {
  const requestUrl = `${config.krxDataBaseUrl}${KRX_MARKET_CAP_PATH}`;
  const sessionCookie = await getKrSessionCookie();
  const body = new URLSearchParams({
    bld: KRX_MARKET_CAP_BLD,
    locale: "ko_KR",
    mktId: "STK",
    trdDd: toKrDateString(today),
    share: "1",
    money: "1",
    csvxls_isNo: "false"
  });

  const response = await fetch(requestUrl, {
    method: "POST",
    headers: {
      Accept: "application/json, text/javascript, */*; q=0.01",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      "Cache-Control": "no-cache",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Cookie: sessionCookie,
      Origin: config.krxDataBaseUrl,
      Pragma: "no-cache",
      Referer: `${config.krxDataBaseUrl}/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201020101`,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
      "X-Requested-With": "XMLHttpRequest"
    },
    body: body.toString(),
    signal: AbortSignal.timeout(config.krxRequestTimeoutMs)
  });

  if (!response.ok) {
    throw new Error(`KRX market-cap request failed (${response.status}) for ${requestUrl}.`);
  }

  const payload = await response.json().catch(() => null);
  const rows = extractRows(payload);
  const items = rows
    .map(mapUniverseRow)
    .filter((item) => item?.marketCap)
    .sort((left, right) => {
      const marketCapCompare = compareNumericStrings(right.marketCap, left.marketCap);

      if (marketCapCompare !== 0) {
        return marketCapCompare;
      }

      return left.stockCode.localeCompare(right.stockCode, "en");
    });

  if (items.length === 0) {
    throw new Error("KRX market-cap response did not include usable KOSPI rows.");
  }

  return {
    source: "krx_data_api",
    items
  };
}

async function fetchKospiMarketCapSnapshot(forceRefresh = false) {
  const today = toSeoulDateString();

  if (!forceRefresh && cache.date === today && cache.items.length > 0) {
    return cache;
  }

  let snapshot = null;

  if (config.krxAuthKey) {
    try {
      snapshot = await fetchKospiStocksFromOpenApi(today);
    } catch (error) {
      console.warn(`KRX OpenAPI fetch failed, falling back to legacy KRX data API: ${error.message}`);
    }
  }

  if (!snapshot) {
    snapshot = await fetchKospiStocksFromLegacyDataApi(today);
  }

  cache = {
    date: today,
    source: snapshot.source,
    items: snapshot.items
  };

  return cache;
}

module.exports = {
  fetchKospiMarketCapSnapshot
};
