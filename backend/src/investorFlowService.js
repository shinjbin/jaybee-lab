const config = require("./config");
const { parseDateInput, toSeoulDateString } = require("./dateUtils");
const { query } = require("./db");
const {
  fetchCurrentPrice,
  fetchForeignInstitutionRanking
} = require("./kisClient");
const { cleanupText } = require("./utils");

const INVESTOR_LABELS = {
  foreign: "외국인",
  institution: "기관"
};

function normalizeNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const normalized = String(value).replace(/,/g, "").trim();

  return /^[-+]?\d+(\.\d+)?$/.test(normalized) ? normalized : null;
}

function multiplyNumericStrings(left, right) {
  if (!left || !right) {
    return null;
  }

  const isInteger = /^[-+]?\d+$/.test(left) && /^[-+]?\d+$/.test(right);

  if (isInteger) {
    return (BigInt(left) * BigInt(right)).toString();
  }

  const result = Math.round(Number(left) * Number(right));

  return Number.isFinite(result) ? String(result) : null;
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

function pickByPattern(row, patterns) {
  for (const key of Object.keys(row || {})) {
    const normalizedKey = key.toLowerCase();

    if (patterns.every((pattern) => normalizedKey.includes(pattern))) {
      return row[key];
    }
  }

  return null;
}

function mapRankingRow(row, investorType, index) {
  const stockCode = cleanupText(
    String(
      pickFirst(row, ["mksc_shrn_iscd", "stck_shrn_iscd", "pdno", "iscd"]) ||
        ""
    )
  );
  const stockName = cleanupText(
    String(
      pickFirst(row, ["hts_kor_isnm", "kor_isnm", "prdt_name", "name"]) ||
        ""
    )
  );
  const apiNetBuyAmount = normalizeNumber(
    pickFirst(row, [
      investorType === "foreign" ? "frgn_ntby_tr_pbmn" : "orgn_ntby_tr_pbmn",
      investorType === "institution" ? "orgn_ntby_tr_pbmn" : "frgn_ntby_tr_pbmn",
      "ntby_tr_pbmn",
      "ntby_amt"
    ]) || pickByPattern(row, ["ntby", "pbmn"]) || pickByPattern(row, ["ntby", "amt"])
  );
  const netBuyQuantity = normalizeNumber(
    pickFirst(row, [
      investorType === "foreign" ? "frgn_ntby_qty" : "orgn_ntby_qty",
      investorType === "institution" ? "orgn_ntby_qty" : "frgn_ntby_qty",
      "ntby_qty"
    ]) || pickByPattern(row, ["ntby", "qty"])
  );

  if (!stockCode || !stockName) {
    return null;
  }

  return {
    investorType,
    label: INVESTOR_LABELS[investorType],
    rank: index + 1,
    stockCode,
    stockName,
    apiNetBuyAmount,
    netBuyQuantity,
    rawPayload: row
  };
}

async function buildPriceMap(stockCodes) {
  const uniqueCodes = Array.from(new Set(stockCodes.filter(Boolean)));
  const priceMap = new Map();
  const batchSize = 8;

  for (let index = 0; index < uniqueCodes.length; index += batchSize) {
    const batch = uniqueCodes.slice(index, index + batchSize);

    await Promise.all(
      batch.map(async (stockCode) => {
        try {
          const payload = await fetchCurrentPrice(stockCode);
          const closePrice = normalizeNumber(
            pickFirst(payload, ["stck_prpr", "stck_clpr", "close", "price"])
          );

          if (closePrice) {
            priceMap.set(stockCode, closePrice);
          }
        } catch (error) {
          console.warn(`Failed to fetch price for ${stockCode}: ${error.message}`);
        }
      })
    );
  }

  return priceMap;
}

function finalizeRankingRow(item, priceMap) {
  const closePrice = priceMap.get(item.stockCode) || null;
  const calculatedAmount = multiplyNumericStrings(item.netBuyQuantity, closePrice);
  const netBuyAmount = calculatedAmount || item.apiNetBuyAmount;
  const amountSource = calculatedAmount
    ? "quantity_x_price"
    : item.apiNetBuyAmount
      ? "api_amount"
      : null;

  return {
    investorType: item.investorType,
    label: item.label,
    rank: item.rank,
    stockCode: item.stockCode,
    stockName: item.stockName,
    netBuyAmount,
    netBuyQuantity: item.netBuyQuantity,
    closePrice,
    amountSource,
    rawPayload: {
      ...item.rawPayload,
      normalized_net_buy_quantity: item.netBuyQuantity,
      normalized_api_net_buy_amount: item.apiNetBuyAmount,
      normalized_close_price: closePrice,
      normalized_amount_source: amountSource
    }
  };
}

async function upsertRankingRows(tradeDate, investorType, items) {
  for (const item of items) {
    await query(
      `
        INSERT INTO investor_flow_snapshots (
          trade_date,
          market,
          investor_type,
          rank,
          stock_code,
          stock_name,
          net_buy_amount,
          net_buy_quantity,
          close_price,
          amount_source,
          raw_payload,
          collected_at,
          updated_at
        )
        VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, NOW(), NOW())
        ON CONFLICT (trade_date, market, investor_type, stock_code)
        DO UPDATE SET
          rank = EXCLUDED.rank,
          stock_name = EXCLUDED.stock_name,
          net_buy_amount = EXCLUDED.net_buy_amount,
          net_buy_quantity = EXCLUDED.net_buy_quantity,
          close_price = EXCLUDED.close_price,
          amount_source = EXCLUDED.amount_source,
          raw_payload = EXCLUDED.raw_payload,
          collected_at = NOW(),
          updated_at = NOW()
      `,
      [
        tradeDate,
        "KOSPI",
        investorType,
        item.rank,
        item.stockCode,
        item.stockName,
        item.netBuyAmount,
        item.netBuyQuantity,
        item.closePrice,
        item.amountSource,
        JSON.stringify(item.rawPayload || {})
      ]
    );
  }
}

function mapSnapshotRow(row) {
  return {
    id: row.id,
    tradeDate: row.trade_date,
    market: row.market,
    investorType: row.investor_type,
    label: INVESTOR_LABELS[row.investor_type] || row.investor_type,
    rank: row.rank,
    stockCode: row.stock_code,
    stockName: row.stock_name,
    netBuyAmount: row.net_buy_amount,
    netBuyQuantity: row.net_buy_quantity,
    closePrice: row.close_price,
    amountSource: row.amount_source,
    collectedAt: row.collected_at,
    updatedAt: row.updated_at,
    rawPayload: row.raw_payload
  };
}

function mapWeeklyRow(row) {
  return {
    investorType: row.investor_type,
    label: INVESTOR_LABELS[row.investor_type] || row.investor_type,
    rank: Number(row.rank),
    stockCode: row.stock_code,
    stockName: row.stock_name,
    netBuyAmount: row.net_buy_amount,
    activeDays: Number(row.active_days || 0)
  };
}

async function runInvestorFlowCollectionCycle() {
  if (!config.kisEnabled || !config.kisMarketFlowEnabled) {
    return {
      enabled: false,
      skipped: true,
      reason: "KIS credentials are not configured."
    };
  }

  const tradeDate = toSeoulDateString();
  const rankings = {};

  for (const investorType of ["foreign", "institution"]) {
    const rows = await fetchForeignInstitutionRanking(investorType);
    const mappedBase = rows
      .map((row, index) => mapRankingRow(row, investorType, index))
      .filter(Boolean)
      .slice(0, config.kisFlowUniverseCount);

    const priceMap = await buildPriceMap(mappedBase.map((item) => item.stockCode));
    const mapped = mappedBase.map((item) => finalizeRankingRow(item, priceMap));

    await upsertRankingRows(tradeDate, investorType, mapped);
    rankings[investorType] = mapped.length;
  }

  return {
    enabled: true,
    tradeDate,
    rankings,
    weeklyWindowDays: config.kisFlowWeeklyWindowDays,
    collectionUniverseCount: config.kisFlowUniverseCount
  };
}

async function resolveLatestInvestorDate(preferredDate) {
  const requestedDate = parseDateInput(preferredDate);

  if (requestedDate) {
    return requestedDate;
  }

  const result = await query(
    `
      SELECT MAX(trade_date)::text AS latest_date
      FROM investor_flow_snapshots
      WHERE market = 'KOSPI'
    `
  );

  return result.rows[0]?.latest_date || null;
}

async function getWeeklyTopFlows(effectiveDate) {
  const result = await query(
    `
      WITH weekly_totals AS (
        SELECT
          investor_type,
          stock_code,
          MIN(stock_name) AS stock_name,
          SUM(COALESCE(net_buy_amount, 0))::numeric(20, 0) AS net_buy_amount,
          COUNT(DISTINCT trade_date) AS active_days
        FROM investor_flow_snapshots
        WHERE market = 'KOSPI'
          AND trade_date BETWEEN ($1::date - ($2::int - 1) * INTERVAL '1 day') AND $1::date
        GROUP BY investor_type, stock_code
      ),
      ranked AS (
        SELECT
          investor_type,
          stock_code,
          stock_name,
          net_buy_amount,
          active_days,
          ROW_NUMBER() OVER (
            PARTITION BY investor_type
            ORDER BY net_buy_amount DESC, stock_name ASC
          ) AS rank
        FROM weekly_totals
      )
      SELECT investor_type, stock_code, stock_name, net_buy_amount, active_days, rank
      FROM ranked
      WHERE rank <= $3::int
      ORDER BY investor_type ASC, rank ASC, stock_name ASC
    `,
    [effectiveDate, config.kisFlowWeeklyWindowDays, config.kisFlowTopCount]
  );

  const items = result.rows.map(mapWeeklyRow);

  return {
    startDate: null,
    endDate: effectiveDate,
    windowDays: config.kisFlowWeeklyWindowDays,
    foreign: items.filter((item) => item.investorType === "foreign"),
    institution: items.filter((item) => item.investorType === "institution")
  };
}

async function getInvestorFlowByDate(date) {
  const effectiveDate = await resolveLatestInvestorDate(date);

  if (!effectiveDate) {
    return {
      enabled: config.kisEnabled && config.kisMarketFlowEnabled,
      effectiveDate: null,
      market: "KOSPI",
      latestCollectedAt: null,
      collectionUniverseCount: config.kisFlowUniverseCount,
      dailyTopCount: config.kisFlowTopCount,
      weeklyWindowDays: config.kisFlowWeeklyWindowDays,
      foreign: [],
      institution: [],
      weekly: {
        startDate: null,
        endDate: null,
        windowDays: config.kisFlowWeeklyWindowDays,
        foreign: [],
        institution: []
      }
    };
  }

  const result = await query(
    `
      SELECT *
      FROM investor_flow_snapshots
      WHERE trade_date = $1::date
        AND market = 'KOSPI'
      ORDER BY investor_type ASC, rank ASC, stock_name ASC
    `,
    [effectiveDate]
  );

  const items = result.rows.map(mapSnapshotRow);
  const weekly = await getWeeklyTopFlows(effectiveDate);
  const startDateResult = await query(
    `
      SELECT ($1::date - ($2::int - 1) * INTERVAL '1 day')::date::text AS start_date
    `,
    [effectiveDate, config.kisFlowWeeklyWindowDays]
  );
  weekly.startDate = startDateResult.rows[0]?.start_date || null;

  return {
    enabled: config.kisEnabled && config.kisMarketFlowEnabled,
    effectiveDate,
    market: "KOSPI",
    latestCollectedAt: items[0]?.collectedAt || null,
    collectionUniverseCount: config.kisFlowUniverseCount,
    dailyTopCount: config.kisFlowTopCount,
    weeklyWindowDays: config.kisFlowWeeklyWindowDays,
    foreign: items.filter((item) => item.investorType === "foreign").slice(0, config.kisFlowTopCount),
    institution: items
      .filter((item) => item.investorType === "institution")
      .slice(0, config.kisFlowTopCount),
    weekly
  };
}

module.exports = {
  getInvestorFlowByDate,
  runInvestorFlowCollectionCycle
};


