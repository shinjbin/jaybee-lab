const config = require("./config");
const { toSeoulDateString } = require("./dateUtils");

const KOSPI_LISTING_PATH =
  "/corpgeneral/corpList.do?method=download&searchType=13&marketType=stockMkt&pageIndex=1&currentPageSize=5000&orderMode=3&orderStat=D";

let cache = {
  date: "",
  items: []
};

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, " ");
}

function stripTags(value) {
  return decodeHtmlEntities(String(value || ""))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCells(rowHtml) {
  return Array.from(rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)).map(
    (match) => stripTags(match[1])
  );
}

function normalizeStockCode(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits ? digits.padStart(6, "0") : "";
}

function parseKrkCorpList(html) {
  const rows = Array.from(String(html || "").matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi))
    .map((match) => extractCells(match[1]))
    .filter((cells) => cells.length > 0);

  const headerIndex = rows.findIndex((cells) =>
    cells.includes("회사명") && cells.includes("종목코드")
  );

  if (headerIndex === -1) {
    return [];
  }

  const headerRow = rows[headerIndex];
  const nameIndex = headerRow.indexOf("회사명");
  const stockCodeIndex = headerRow.indexOf("종목코드");

  if (nameIndex === -1 || stockCodeIndex === -1) {
    return [];
  }

  return rows
    .slice(headerIndex + 1)
    .map((cells) => ({
      stockCode: normalizeStockCode(cells[stockCodeIndex]),
      stockName: cells[nameIndex] || ""
    }))
    .filter((item) => /^\d{6}$/.test(item.stockCode) && item.stockName)
    .sort((left, right) => left.stockCode.localeCompare(right.stockCode, "en"));
}

async function fetchKospiStockMaster(forceRefresh = false) {
  const today = toSeoulDateString();

  if (!forceRefresh && cache.date === today && cache.items.length > 0) {
    return cache.items;
  }

  const response = await fetch(`${config.krxKindBaseUrl}${KOSPI_LISTING_PATH}`, {
    method: "GET",
    headers: {
      Accept: "text/html,application/vnd.ms-excel,application/xhtml+xml"
    },
    signal: AbortSignal.timeout(config.krxRequestTimeoutMs)
  });

  if (!response.ok) {
    throw new Error(`KRX KIND stock master request failed (${response.status}).`);
  }

  const buffer = await response.arrayBuffer();
  let html = "";

  try {
    html = new TextDecoder("euc-kr").decode(buffer);
  } catch (_error) {
    html = new TextDecoder("utf-8").decode(buffer);
  }

  const items = parseKrkCorpList(html);

  if (items.length === 0) {
    throw new Error("KRX KIND stock master response did not include usable stock rows.");
  }

  cache = {
    date: today,
    items
  };

  return items;
}

module.exports = {
  fetchKospiStockMaster
};
