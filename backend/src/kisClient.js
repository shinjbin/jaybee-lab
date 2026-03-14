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
  if (!config.kisEnabled || !config.kisMarketFlowEnabled) {
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

async function fetchForeignInstitutionRanking(investorType) {
  const investorCode = investorType === "foreign" ? "1" : "2";
  const accessToken = await getAccessToken();
  const query = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: config.kisMarketDivisionCode,
    FID_COND_SCR_DIV_CODE: config.kisFlowScreenCode,
    FID_INPUT_ISCD: config.kisMarketCode,
    FID_DIV_CLS_CODE: "1",
    FID_RANK_SORT_CLS_CODE: "0",
    FID_ETC_CLS_CODE: investorCode
  });

  const response = await fetch(
    `${config.kisBaseUrl}/uapi/domestic-stock/v1/quotations/foreign-institution-total?${query.toString()}`,
    {
      method: "GET",
      headers: buildHeaders({
        authorization: `Bearer ${accessToken}`,
        tr_id: "FHPTJ04400000"
      }),
      signal: AbortSignal.timeout(config.kisRequestTimeoutMs)
    }
  );

  const payload = await parseJsonResponse(response);

  return Array.isArray(payload?.output) ? payload.output : [];
}

module.exports = {
  getAccessToken,
  fetchForeignInstitutionRanking
};
