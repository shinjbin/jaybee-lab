const config = require("./config");

let tokenCache = {
  accessToken: "",
  expiresAt: 0
};

function buildHeaders(extraHeaders = {}) {
  return {
    "Content-Type": "application/json; charset=UTF-8",
    Accept: "application/json",
    appkey: config.kisAppKey,
    appsecret: config.kisAppSecret,
    custtype: "P",
    ...extraHeaders
  };
}

async function parseJsonResponse(response) {
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      `KIS request failed (${response.status}): ${payload?.msg1 || payload?.message || "Unknown error"}`
    );
  }

  if (payload && payload.rt_cd && payload.rt_cd !== "0") {
    throw new Error(payload.msg1 || "KIS request returned a non-zero result code.");
  }

  return payload;
}

async function getAccessToken() {
  if (!config.kisEnabled) {
    return "";
  }

  const now = Date.now();

  if (tokenCache.accessToken && tokenCache.expiresAt - 60_000 > now) {
    return tokenCache.accessToken;
  }

  const response = await fetch(`${config.kisBaseUrl}/oauth2/tokenP`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    signal: AbortSignal.timeout(config.kisRequestTimeoutMs),
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: config.kisAppKey,
      appsecret: config.kisAppSecret
    })
  });

  const payload = await parseJsonResponse(response);
  const expiresInMs = Number.parseInt(payload.expires_in, 10) * 1000;

  tokenCache = {
    accessToken: payload.access_token,
    expiresAt: now + (Number.isNaN(expiresInMs) ? 60 * 60 * 1000 : expiresInMs)
  };

  return tokenCache.accessToken;
}

async function fetchKisJson(path, trId, params = {}) {
  const accessToken = await getAccessToken();
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, String(value));
    }
  });

  const response = await fetch(`${config.kisBaseUrl}${path}?${query.toString()}`, {
    method: "GET",
    headers: buildHeaders({
      authorization: `Bearer ${accessToken}`,
      tr_id: trId
    }),
    signal: AbortSignal.timeout(config.kisRequestTimeoutMs)
  });

  return parseJsonResponse(response);
}

async function fetchForeignInstitutionRanking(investorType, sortDirection = "buy") {
  const investorCode = investorType === "foreign" ? "1" : "2";
  const rankSortCode = sortDirection === "sell" ? "1" : "0";

  return fetchKisJson(
    "/uapi/domestic-stock/v1/quotations/foreign-institution-total",
    "FHPTJ04400000",
    {
      FID_COND_MRKT_DIV_CODE: config.kisMarketDivisionCode,
      FID_COND_SCR_DIV_CODE: config.kisFlowScreenCode,
      FID_INPUT_ISCD: config.kisMarketCode,
      FID_DIV_CLS_CODE: "1",
      FID_RANK_SORT_CLS_CODE: rankSortCode,
      FID_ETC_CLS_CODE: investorCode
    }
  ).then((payload) => (Array.isArray(payload?.output) ? payload.output : []));
}

async function fetchInvestorTrendEstimate(stockCode) {
  const payload = await fetchKisJson(
    "/uapi/domestic-stock/v1/quotations/investor-trend-estimate",
    "HHPTJ04160200",
    {
      MKSC_SHRN_ISCD: stockCode
    }
  );

  return Array.isArray(payload?.output2) ? payload.output2 : [];
}

async function fetchInvestorTradeByStockDaily(stockCode, tradeDate) {
  const payload = await fetchKisJson(
    "/uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily",
    "FHPTJ04160001",
    {
      FID_COND_MRKT_DIV_CODE: "J",
      FID_INPUT_ISCD: stockCode,
      FID_INPUT_DATE_1: tradeDate,
      FID_ORG_ADJ_PRC: "",
      FID_ETC_CLS_CODE: ""
    }
  );

  return {
    output1: Array.isArray(payload?.output1)
      ? payload.output1
      : payload?.output1
        ? [payload.output1]
        : [],
    output2: Array.isArray(payload?.output2)
      ? payload.output2
      : payload?.output2
        ? [payload.output2]
        : []
  };
}

async function fetchCurrentPrice(stockCode) {
  const payload = await fetchKisJson(
    "/uapi/domestic-stock/v1/quotations/inquire-price",
    "FHKST01010100",
    {
      FID_COND_MRKT_DIV_CODE: "J",
      FID_INPUT_ISCD: stockCode
    }
  );

  return payload?.output || null;
}

async function fetchMarketCapRanking() {
  const payload = await fetchKisJson(
    "/uapi/domestic-stock/v1/ranking/market-cap",
    "FHPST01740000",
    {
      FID_COND_MRKT_DIV_CODE: "J",
      FID_COND_SCR_DIV_CODE: "20174",
      FID_DIV_CLS_CODE: "0",
      FID_INPUT_ISCD: "0000",
      FID_TRGT_CLS_CODE: "0",
      FID_TRGT_EXLS_CLS_CODE: "0",
      FID_INPUT_PRICE_1: "",
      FID_INPUT_PRICE_2: "",
      FID_VOL_CNT: ""
    }
  );

  return Array.isArray(payload?.output) ? payload.output : [];
}

async function fetchIndexPrice() {
  return fetchKisJson(
    "/uapi/domestic-stock/v1/quotations/inquire-index-price",
    "FHPUP02100000",
    {
      FID_COND_MRKT_DIV_CODE: config.kisIndexMarketDivisionCode,
      FID_INPUT_ISCD: config.kisIndexCode
    }
  );
}

async function fetchIndexDailyChartPrice({ startDate, endDate } = {}) {
  return fetchKisJson(
    "/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice",
    "FHKUP03500100",
    {
      FID_COND_MRKT_DIV_CODE: config.kisIndexMarketDivisionCode,
      FID_INPUT_ISCD: config.kisIndexCode,
      FID_INPUT_DATE_1: startDate,
      FID_INPUT_DATE_2: endDate,
      FID_PERIOD_DIV_CODE: config.kisIndexPeriodCode
    }
  );
}

module.exports = {
  getAccessToken,
  fetchCurrentPrice,
  fetchMarketCapRanking,
  fetchForeignInstitutionRanking,
  fetchInvestorTrendEstimate,
  fetchInvestorTradeByStockDaily,
  fetchIndexPrice,
  fetchIndexDailyChartPrice
};
