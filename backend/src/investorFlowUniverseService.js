const config = require("./config");
const { query } = require("./db");
const { toSeoulDateString } = require("./dateUtils");
const { fetchCurrentPrice } = require("./kisClient");
const { fetchKospiStockMaster } = require("./krxUniverseService");

function normalizeNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const normalized = String(value).replace(/,/g, "").trim();
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

function extractUniverseMetrics(payload) {
  const closePrice = normalizeNumber(
    pickFirst(payload, ["stck_prpr", "stck_clpr", "close", "price"])
  );
  const marketCap = normalizeNumber(
    pickFirst(payload, ["hts_avls", "stck_avls", "market_cap", "mrkt_tot_amt"])
  );
  const sharesOutstanding = normalizeNumber(
    pickFirst(payload, ["lstn_stcn", "listed_shares", "issu_stck_cnt"])
  );

  return {
    closePrice,
    sharesOutstanding,
    marketCap: marketCap || multiplyNumericStrings(closePrice, sharesOutstanding)
  };
}

function getDateDifferenceInDays(leftDate, rightDate) {
  if (!leftDate || !rightDate) {
    return Number.POSITIVE_INFINITY;
  }

  const left = new Date(`${leftDate}T00:00:00+09:00`);
  const right = new Date(`${rightDate}T00:00:00+09:00`);

  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.floor((right.getTime() - left.getTime()) / (24 * 60 * 60 * 1000));
}

async function fetchUniverseCandidatesWithMarketCap() {
  const kospiStocks = await fetchKospiStockMaster();
  const collected = [];
  const batchSize = 8;

  for (let index = 0; index < kospiStocks.length; index += batchSize) {
    const batch = kospiStocks.slice(index, index + batchSize);

    await Promise.all(
      batch.map(async (stock) => {
        try {
          const payload = await fetchCurrentPrice(stock.stockCode);
          const metrics = extractUniverseMetrics(payload);

          if (!metrics.marketCap) {
            return;
          }

          collected.push({
            stockCode: stock.stockCode,
            stockName: stock.stockName,
            marketCap: metrics.marketCap,
            closePrice: metrics.closePrice,
            sharesOutstanding: metrics.sharesOutstanding,
            rawPayload: payload
          });
        } catch (error) {
          console.warn(
            `Failed to fetch market cap for ${stock.stockCode}: ${error.message}`
          );
        }
      })
    );
  }

  return collected
    .sort((left, right) => {
      const marketCapCompare = compareNumericStrings(right.marketCap, left.marketCap);

      if (marketCapCompare !== 0) {
        return marketCapCompare;
      }

      return left.stockCode.localeCompare(right.stockCode, "en");
    })
    .slice(0, config.kisFlowUniverseTopCount)
    .map((item, index) => ({
      ...item,
      marketCapRank: index + 1
    }));
}

async function loadLatestInvestorFlowUniverse() {
  const result = await query(
    `
      SELECT
        as_of_date::text AS as_of_date,
        market,
        market_cap_rank,
        stock_code,
        stock_name,
        market_cap::text AS market_cap,
        close_price::text AS close_price,
        shares_outstanding::text AS shares_outstanding,
        source
      FROM investor_flow_universe
      WHERE market = 'KOSPI'
        AND as_of_date = (
          SELECT MAX(as_of_date)
          FROM investor_flow_universe
          WHERE market = 'KOSPI'
        )
      ORDER BY market_cap_rank ASC, stock_code ASC
    `
  );

  return result.rows.map((row) => ({
    asOfDate: row.as_of_date,
    market: row.market,
    marketCapRank: Number(row.market_cap_rank) || null,
    stockCode: row.stock_code,
    stockName: row.stock_name,
    marketCap: row.market_cap,
    closePrice: row.close_price,
    sharesOutstanding: row.shares_outstanding,
    source: row.source
  }));
}

async function refreshInvestorFlowUniverse() {
  const asOfDate = toSeoulDateString();
  const rankedUniverse = await fetchUniverseCandidatesWithMarketCap();

  if (rankedUniverse.length === 0) {
    throw new Error("Unable to build investor flow universe from KOSPI market-cap data.");
  }

  await query(
    `
      DELETE FROM investor_flow_universe
      WHERE as_of_date = $1::date
        AND market = 'KOSPI'
    `,
    [asOfDate]
  );

  for (const item of rankedUniverse) {
    await query(
      `
        INSERT INTO investor_flow_universe (
          as_of_date,
          market,
          market_cap_rank,
          stock_code,
          stock_name,
          market_cap,
          close_price,
          shares_outstanding,
          source,
          raw_payload,
          created_at,
          updated_at
        )
        VALUES ($1::date, 'KOSPI', $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW(), NOW())
      `,
      [
        asOfDate,
        item.marketCapRank,
        item.stockCode,
        item.stockName,
        item.marketCap,
        item.closePrice,
        item.sharesOutstanding,
        "krx_kind_kis_price",
        JSON.stringify(item.rawPayload || {})
      ]
    );
  }

  return rankedUniverse.map((item) => ({
    asOfDate,
    market: "KOSPI",
    marketCapRank: item.marketCapRank,
    stockCode: item.stockCode,
    stockName: item.stockName,
    marketCap: item.marketCap,
    closePrice: item.closePrice,
    sharesOutstanding: item.sharesOutstanding,
    source: "krx_kind_kis_price"
  }));
}

async function getInvestorFlowUniverse() {
  const today = toSeoulDateString();
  const latestUniverse = await loadLatestInvestorFlowUniverse();
  const latestAsOfDate = latestUniverse[0]?.asOfDate || null;
  const latestUniverseIsFreshEnough =
    latestUniverse.length >= config.kisFlowUniverseTopCount &&
    getDateDifferenceInDays(latestAsOfDate, today) < config.kisFlowUniverseRefreshDays;

  if (latestUniverseIsFreshEnough) {
    return latestUniverse;
  }

  const latestCountResult = await query(
    `
      SELECT COUNT(*)::int AS count
      FROM investor_flow_universe
      WHERE market = 'KOSPI'
        AND as_of_date = (
          SELECT MAX(as_of_date)
          FROM investor_flow_universe
          WHERE market = 'KOSPI'
        )
    `,
  );

  if ((latestCountResult.rows[0]?.count || 0) >= config.kisFlowUniverseTopCount && latestUniverse.length > 0) {
    return latestUniverse;
  }

  try {
    return await refreshInvestorFlowUniverse();
  } catch (error) {
    console.warn(`Failed to refresh investor flow universe: ${error.message}`);

    if (latestUniverse.length > 0) {
      return latestUniverse;
    }

    throw error;
  }
}

module.exports = {
  getInvestorFlowUniverse,
  refreshInvestorFlowUniverse
};
