const config = require("./config");
const { parseDateInput, toSeoulDateString } = require("./dateUtils");
const { query } = require("./db");
const { fetchForeignInstitutionRanking } = require("./kisClient");
const { cleanupText, truncateText } = require("./utils");

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
  const netBuyAmount = normalizeNumber(
    pickFirst(row, [
      investorType === "foreign" ? "frgn_ntby_tr_pbmn" : "orgn_ntby_tr_pbmn",
      investorType === "institution" ? "orgn_ntby_tr_pbmn" : "frgn_ntby_tr_pbmn",
      "ntby_tr_pbmn",
      "ntby_amt"
    ]) || pickByPattern(row, ["ntby", "pbmn"]) || pickByPattern(row, ["ntby", "amt"])
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
    netBuyAmount,
    rawPayload: row
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
          raw_payload,
          collected_at,
          updated_at
        )
        VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW(), NOW())
        ON CONFLICT (trade_date, market, investor_type, stock_code)
        DO UPDATE SET
          rank = EXCLUDED.rank,
          stock_name = EXCLUDED.stock_name,
          net_buy_amount = EXCLUDED.net_buy_amount,
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
        JSON.stringify(item.rawPayload || {})
      ]
    );
  }
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
    const mapped = rows
      .map((row, index) => mapRankingRow(row, investorType, index))
      .filter(Boolean)
      .slice(0, config.kisFlowTopCount);

    await upsertRankingRows(tradeDate, investorType, mapped);
    rankings[investorType] = mapped.length;
  }

  return {
    enabled: true,
    tradeDate,
    rankings
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
    collectedAt: row.collected_at,
    updatedAt: row.updated_at,
    rawPayload: row.raw_payload
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
      foreign: [],
      institution: []
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

  return {
    enabled: config.kisEnabled && config.kisMarketFlowEnabled,
    effectiveDate,
    market: "KOSPI",
    latestCollectedAt: items[0]?.collectedAt || null,
    foreign: items.filter((item) => item.investorType === "foreign"),
    institution: items.filter((item) => item.investorType === "institution")
  };
}

module.exports = {
  getInvestorFlowByDate,
  runInvestorFlowCollectionCycle
};
