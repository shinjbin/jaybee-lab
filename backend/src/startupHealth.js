const config = require("./config");
const { createTossClient } = require("./tossClient");

// Read-only probes: never submit orders or generate paid AI completions.
function createStartupHealth(options = {}) {
  const settings = options.config || config;
  const fetchImpl = options.fetch || ((...args) => fetch(...args));
  const toss = options.toss || createTossClient({ config: settings, fetch: fetchImpl });

  async function json(base, path, params = {}, headers = {}) {
    const url = new URL(`${base}${path}`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json", ...headers },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (!payload || payload.error || payload.errors || payload.status === "error") {
      throw new Error("API 오류 응답");
    }
    return payload;
  }

  async function check() {
    const probes = [
      ["토스증권", true, settings.tossEnabled, async () => {
        if (!await toss.fetchCurrentPrice("005930")) throw new Error("시세 응답 없음");
      }],
      ["GNews", settings.newsProviders.includes("gnews"), settings.gnewsApiKey, async () => {
        const params = { apikey: settings.gnewsApiKey, lang: settings.gnewsLanguage, max: "1" };
        if (settings.gnewsEndpoint === "search") params.q = settings.gnewsQuery;
        else Object.assign(params, { topic: settings.gnewsTopic, country: settings.gnewsCountry });
        const data = await json(settings.gnewsBaseUrl, `/${settings.gnewsEndpoint}`, params);
        if (!Array.isArray(data.articles)) throw new Error("뉴스 응답 형식 오류");
      }],
      ["Yahoo Finance", settings.newsProviders.includes("yahoo-finance"), true, async () => {
        const data = await json(settings.yahooFinanceBaseUrl, "/v1/finance/search", {
          q: settings.yahooFinanceSearchTerms[0] || "stock market", quotesCount: "0", newsCount: "1"
        });
        if (!Array.isArray(data.news)) throw new Error("뉴스 응답 형식 오류");
      }],
      ["Twelve Data", true, settings.twelveDataApiKey, async () => {
        const data = await json(settings.twelveDataBaseUrl, "/time_series", {
          apikey: settings.twelveDataApiKey, symbol: settings.twelveDataSeries[0]?.symbol || "QQQ",
          interval: "1day", outputsize: "1"
        });
        if (!data.values?.length) throw new Error("시세 응답 없음");
      }],
      ["OpenAI", true, settings.openaiApiKey, async () => {
        await json(settings.openaiBaseUrl, `/models/${encodeURIComponent(settings.openaiModel)}`, {}, {
          Authorization: `Bearer ${settings.openaiApiKey}`
        });
      }],
      ["KRX OpenAPI", true, settings.krxAuthKey, async () => {
        // Empty rows on holidays still mean the authenticated API is reachable.
        const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date()).replaceAll("-", "");
        const path = settings.krxKospiStocksPath;
        const data = await json(/^https?:/.test(path) ? path : settings.krxOpenApiBaseUrl,
          /^https?:/.test(path) ? "" : path, { basDd: date }, { AUTH_KEY: settings.krxAuthKey.trim() });
        if (![data.OutBlock_1, data.output, data.block1].some(Array.isArray)) throw new Error("KRX 응답 형식 오류");
      }]
    ];
    return Promise.all(probes.map(async ([name, enabled, configured, probe]) => {
      if (!enabled) return { name, status: "disabled", detail: "사용 안 함" };
      if (!configured) return { name, status: "unconfigured", detail: "인증 설정 없음" };
      try {
        await probe();
        return { name, status: "ok", detail: "연결 정상" };
      } catch (error) {
        // Do not expose provider response bodies, URLs or credentials in reports/logs.
        const detail = /^HTTP \d{3}$/.test(error.message) ? error.message :
          ["TimeoutError", "AbortError"].includes(error.name) ? "응답 시간 초과" : "인증·연결 또는 응답 확인 실패";
        return { name, status: "failed", detail };
      }
    }));
  }

  async function report(service = "backend") {
    const results = await check();
    const icons = { ok: "✅", failed: "❌", unconfigured: "⚠️", disabled: "➖" };
    const text = [`🔎 ${service} 시작 API 점검`, new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) + " KST",
      ...results.map(({ name, status, detail }) => `${icons[status]} ${name}: ${detail}`),
      "OpenAI는 인증·모델 접근을 확인합니다."
    ].join("\n");
    console.log(text);
    if (!settings.telegramBotToken || !settings.telegramChatId) {
      console.warn("Startup health Telegram notification skipped: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID missing.");
      return results;
    }
    try {
      const response = await fetchImpl(`https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: settings.telegramChatId, text }),
        signal: AbortSignal.timeout(10000)
      });
      const payload = await response.json();
      if (!response.ok || payload.ok !== true) throw new Error("Telegram rejected notification");
      console.log("Startup health Telegram notification delivered.");
    } catch (_) {
      console.error("Startup health Telegram notification failed.");
    }
    return results;
  }
  return { check, report };
}

module.exports = { createStartupHealth };
