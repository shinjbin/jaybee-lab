const test = require("node:test");
const assert = require("node:assert/strict");
const config = require("../src/config");
const { createStartupHealth } = require("../src/startupHealth");

const settings = {
  ...config, tossEnabled: true, newsProviders: ["gnews", "yahoo-finance"],
  gnewsApiKey: "secret", twelveDataApiKey: "secret", openaiApiKey: "secret",
  krxAuthKey: "secret", telegramBotToken: "secret", telegramChatId: "123"
};
function response(payload, status = 200) {
  return { ok: status === 200, status, json: async () => payload };
}
test("all probes run independently and report actual failures to the trader chat", async () => {
  let notification;
  const health = createStartupHealth({ config: settings,
    toss: { fetchCurrentPrice: async () => { throw new Error("token secret URL"); } },
    fetch: async (url, options) => {
      const address = String(url);
      if (address.includes("telegram.org")) {
        notification = JSON.parse(options.body);
        return response({ ok: true });
      }
      if (address.includes("gnews")) return response({ articles: [] });
      if (address.includes("yahoo")) return response({ news: [] });
      if (address.includes("twelvedata")) return response({ status: "error", message: "secret" });
      if (address.includes("openai")) return response({}, 401);
      return response({ OutBlock_1: [] });
    }
  });
  const results = await health.report();
  assert.deepEqual(results.map((r) => r.status), ["failed", "ok", "ok", "failed", "failed", "ok"]);
  assert.equal(notification.chat_id, "123");
  assert.match(notification.text, /HTTP 401/);
  assert.doesNotMatch(notification.text, /secret/);
});
test("disabled and missing credentials are explicit and do not call providers", async () => {
  const health = createStartupHealth({ config: { ...settings, tossEnabled: false,
    newsProviders: [], gnewsApiKey: "", twelveDataApiKey: "", openaiApiKey: "", krxAuthKey: "" },
    fetch: async () => { assert.fail("unexpected network request"); }
  });
  assert.deepEqual((await health.check()).map((r) => r.status),
    ["unconfigured", "disabled", "disabled", "unconfigured", "unconfigured", "unconfigured"]);
});
test("timeout or malformed response and Telegram rejection do not crash startup", async () => {
  const health = createStartupHealth({ config: settings,
    toss: { fetchCurrentPrice: async () => null },
    fetch: async (url) => {
      if (String(url).includes("telegram.org")) return response({ ok: false });
      throw Object.assign(new Error("secret"), { name: "TimeoutError" });
    }
  });
  const results = await health.report("worker");
  assert.equal(results.length, 6);
  assert.equal(results[1].detail, "응답 시간 초과");
});
