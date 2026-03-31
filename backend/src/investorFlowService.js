const config = require("./config");
const { getSeoulDateParts, parseDateInput, toSeoulDateString } = require("./dateUtils");
const { query } = require("./db");
const {
  fetchCurrentPrice,
  fetchForeignInstitutionRanking,
  fetchInvestorTradeByStockDaily,
  fetchInvestorTrendEstimate
} = require("./kisClient");
const { getInvestorFlowUniverse } = require("./investorFlowUniverseService");
const { cleanupText } = require("./utils");

const INVESTOR_LABELS = {
  foreign: "Foreign",
  institution: "Institution"
};
const INVESTOR_TYPES = ["foreign", "institution"];
const FLOW_TREND_WINDOW_DAYS = 20;
const INTRADAY_ESTIMATE_START_MINUTES = 9 * 60;
const INTRADAY_ESTIMATE_END_MINUTES = 15 * 60 + 30;
const POST_CLOSE_DAILY_START_MINUTES = 16 * 60;

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

function addNumericStrings(left, right) {
  if (!left) {
    return right || null;
  }

  if (!right) {
    return left || null;
  }

  if (isIntegerString(left) && isIntegerString(right)) {
    return (BigInt(left) + BigInt(right)).toString();
  }

  const result = Number(left) + Number(right);
  return Number.isFinite(result) ? String(Math.round(result)) : left;
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

function absoluteNumericString(value) {
  const normalized = normalizeNumber(value);

  if (!normalized) {
    return null;
  }

  if (isIntegerString(normalized)) {
    const integerValue = BigInt(normalized);
    return (integerValue < 0n ? -integerValue : integerValue).toString();
  }

  return String(Math.abs(Number(normalized)));
}

function multiplyNumericStrings(left, right) {
  if (!left || !right) {
    return null;
  }

  const isInteger = isIntegerString(left) && isIntegerString(right);

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

function mapRankingRow(row, investorType, index, sortDirection) {
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
    rawPayload: {
      ...row,
      collection_sort_direction: sortDirection
    }
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

function mergeCollectedItems(items) {
  const merged = new Map();

  for (const item of items) {
    if (!item?.stockCode) {
      continue;
    }

    const existing = merged.get(item.stockCode);

    if (!existing) {
      merged.set(item.stockCode, item);
      continue;
    }

    const nextAmount = normalizeNumber(item.apiNetBuyAmount);
    const previousAmount = normalizeNumber(existing.apiNetBuyAmount);
    const shouldReplace = compareNumericStrings(
      absoluteNumericString(nextAmount),
      absoluteNumericString(previousAmount)
    ) > 0;

    const primary = shouldReplace ? item : existing;
    const secondary = shouldReplace ? existing : item;

    merged.set(item.stockCode, {
      ...primary,
      netBuyQuantity: primary.netBuyQuantity || secondary.netBuyQuantity,
      rawPayload: {
        ...secondary.rawPayload,
        ...primary.rawPayload,
        collection_sources: Array.from(
          new Set([
            secondary.rawPayload?.collection_sort_direction,
            primary.rawPayload?.collection_sort_direction
          ].filter(Boolean))
        )
      }
    });
  }

  return Array.from(merged.values());
}

function sortByName(left, right) {
  return String(left.stockName || left.date || "").localeCompare(
    String(right.stockName || right.date || ""),
    "en"
  );
}

function rankItems(items) {
  return [...items]
    .sort((left, right) => {
      const amountCompare = compareNumericStrings(right.apiNetBuyAmount, left.apiNetBuyAmount);
      return amountCompare || sortByName(left, right);
    })
    .map((item, index) => ({
      ...item,
      rank: index + 1
    }));
}

function rankFinalizedItems(items) {
  return [...items]
    .sort((left, right) => {
      const amountCompare = compareNumericStrings(right.netBuyAmount, left.netBuyAmount);
      return amountCompare || sortByName(left, right);
    })
    .map((item, index) => ({
      ...item,
      rank: index + 1
    }));
}

function isWeekdayInSeoul(value = new Date()) {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "short"
  }).format(value);

  return weekday !== "Sat" && weekday !== "Sun";
}

function shouldUseInvestorTrendEstimate(value = new Date()) {
  if (!isWeekdayInSeoul(value)) {
    return false;
  }

  const { hour, minute } = getSeoulDateParts(value);
  const minutes = hour * 60 + minute;

  return (
    minutes >= INTRADAY_ESTIMATE_START_MINUTES &&
    minutes <= INTRADAY_ESTIMATE_END_MINUTES
  );
}

function shouldUseInvestorTradeByStockDaily(value = new Date()) {
  if (!isWeekdayInSeoul(value)) {
    return false;
  }

  const { hour, minute } = getSeoulDateParts(value);
  const minutes = hour * 60 + minute;

  return minutes >= POST_CLOSE_DAILY_START_MINUTES;
}

function pickLatestTrendEstimateRow(rows) {
  const candidates = rows.filter(Boolean);

  if (candidates.length === 0) {
    return null;
  }

  return [...candidates].sort((left, right) => {
    const leftValue = Number.parseInt(String(left?.bsop_hour_gb || "").replace(/\D/g, ""), 10);
    const rightValue = Number.parseInt(String(right?.bsop_hour_gb || "").replace(/\D/g, ""), 10);

    if (Number.isNaN(leftValue) && Number.isNaN(rightValue)) {
      return 0;
    }

    if (Number.isNaN(leftValue)) {
      return -1;
    }

    if (Number.isNaN(rightValue)) {
      return 1;
    }

    return leftValue - rightValue;
  })[candidates.length - 1];
}

function mapTrendEstimateItem(stock, investorType, row) {
  const netBuyQuantity = normalizeNumber(
    pickFirst(row, [
      investorType === "foreign" ? "frgn_fake_ntby_qty" : "orgn_fake_ntby_qty",
      investorType === "institution" ? "orgn_fake_ntby_qty" : "frgn_fake_ntby_qty"
    ]) || pickByPattern(row, ["fake", "ntby", "qty"])
  );

  if (!stock?.stockCode || !stock?.stockName || !netBuyQuantity) {
    return null;
  }

  return {
    investorType,
    label: INVESTOR_LABELS[investorType],
    rank: 0,
    stockCode: stock.stockCode,
    stockName: stock.stockName,
    apiNetBuyAmount: null,
    netBuyQuantity,
    rawPayload: {
      stock_code: stock.stockCode,
      stock_name: stock.stockName,
      collection_source: "investor_trend_estimate",
      trend_estimate: row
    }
  };
}

function pickDailyInvestorTradeRow(payload, tradeDate) {
  const compactDate = String(tradeDate || "").replace(/-/g, "");
  const candidates = [
    ...(Array.isArray(payload?.output2) ? payload.output2 : []),
    ...(Array.isArray(payload?.output1) ? payload.output1 : [])
  ].filter(Boolean);

  if (candidates.length === 0) {
    return null;
  }

  const exactMatch = candidates.find((row) => {
    const rowDate = String(
      pickFirst(row, ["stck_bsop_date", "bsop_date", "date", "dt"]) || ""
    ).replace(/\D/g, "");

    return compactDate && rowDate === compactDate;
  });

  return exactMatch || candidates[0];
}

function mapDailyInvestorTradeItem(stock, investorType, row) {
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

  if (!stock?.stockCode || !stock?.stockName) {
    return null;
  }

  if (!apiNetBuyAmount && !netBuyQuantity) {
    return null;
  }

  return {
    investorType,
    label: INVESTOR_LABELS[investorType],
    rank: 0,
    stockCode: stock.stockCode,
    stockName: stock.stockName,
    apiNetBuyAmount,
    netBuyQuantity,
    rawPayload: {
      stock_code: stock.stockCode,
      stock_name: stock.stockName,
      collection_source: "investor-trade-by-stock-daily",
      daily_investor_trade: row
    }
  };
}

async function collectInvestorRankingRows(investorType) {
  const [buyRows, sellRows] = await Promise.all([
    fetchForeignInstitutionRanking(investorType, "buy"),
    fetchForeignInstitutionRanking(investorType, "sell")
  ]);

  const mapped = [
    ...buyRows.map((row, index) => mapRankingRow(row, investorType, index, "buy")),
    ...sellRows.map((row, index) => mapRankingRow(row, investorType, index, "sell"))
  ].filter(Boolean);

  return rankItems(mergeCollectedItems(mapped));
}

async function getLatestUniverseStocks() {
  const rows = await getInvestorFlowUniverse();

  return config.kisFlowUniverseCount
    ? rows.slice(0, config.kisFlowUniverseCount)
    : rows;
}

async function collectInvestorTrendEstimateRows() {
  const universeStocks = await getLatestUniverseStocks();

  if (universeStocks.length === 0) {
    return [];
  }

  const collected = [];
  const batchSize = 8;

  for (let index = 0; index < universeStocks.length; index += batchSize) {
    const batch = universeStocks.slice(index, index + batchSize);

    await Promise.all(
      batch.map(async (stock) => {
        try {
          const rows = await fetchInvestorTrendEstimate(stock.stockCode);
          const latestRow = pickLatestTrendEstimateRow(rows);

          if (!latestRow) {
            return;
          }

          for (const investorType of INVESTOR_TYPES) {
            const mapped = mapTrendEstimateItem(stock, investorType, latestRow);

            if (mapped) {
              collected.push(mapped);
            }
          }
        } catch (error) {
          console.warn(
            `Failed to fetch investor trend estimate for ${stock.stockCode}: ${error.message}`
          );
        }
      })
    );
  }

  return collected;
}

async function collectInvestorTradeByStockDailyRows(tradeDate) {
  const universeStocks = await getLatestUniverseStocks();

  if (universeStocks.length === 0) {
    return [];
  }

  const collected = [];
  const batchSize = 8;

  for (let index = 0; index < universeStocks.length; index += batchSize) {
    const batch = universeStocks.slice(index, index + batchSize);

    await Promise.all(
      batch.map(async (stock) => {
        try {
          const payload = await fetchInvestorTradeByStockDaily(stock.stockCode, tradeDate);
          const row = pickDailyInvestorTradeRow(payload, tradeDate);

          if (!row) {
            return;
          }

          for (const investorType of INVESTOR_TYPES) {
            const mapped = mapDailyInvestorTradeItem(stock, investorType, row);

            if (mapped) {
              collected.push(mapped);
            }
          }
        } catch (error) {
          console.warn(
            `Failed to fetch investor trade by stock daily for ${stock.stockCode}: ${error.message}`
          );
        }
      })
    );
  }

  return collected;
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
    stockCode: row.stock_code,
    stockName: row.stock_name,
    netBuyAmount: row.net_buy_amount,
    activeDays: Number(row.active_days || 0)
  };
}

function createEmptyDirectionBucket() {
  return {
    buy: [],
    sell: [],
    buyAll: [],
    sellAll: []
  };
}

function createEmptyInvestorBuckets() {
  return {
    foreign: createEmptyDirectionBucket(),
    institution: createEmptyDirectionBucket()
  };
}

function getMoversByDirection(items, direction, activeDays = false) {
  const filtered = items.filter((item) => {
    const amount = normalizeNumber(item.netBuyAmount);

    if (!amount) {
      return false;
    }

    return direction === "buy"
      ? compareNumericStrings(amount, "0") > 0
      : compareNumericStrings(amount, "0") < 0;
  });

  const sorted = filtered.sort((left, right) => {
    const amountCompare = direction === "buy"
      ? compareNumericStrings(right.netBuyAmount, left.netBuyAmount)
      : compareNumericStrings(left.netBuyAmount, right.netBuyAmount);

    return amountCompare || sortByName(left, right);
  });

  return sorted.map((item, index) => ({
    ...item,
    rank: index + 1,
    activeDays: activeDays ? item.activeDays : undefined,
    direction,
    displayAmount: direction === "sell"
      ? absoluteNumericString(item.netBuyAmount)
      : item.netBuyAmount,
    displayQuantity: direction === "sell"
      ? absoluteNumericString(item.netBuyQuantity)
      : item.netBuyQuantity
  }));
}

function toTopMovers(items, direction, limit, activeDays = false) {
  return getMoversByDirection(items, direction, activeDays).slice(0, limit);
}

function summarizeItems(items) {
  return items.reduce(
    (accumulator, item) => {
      const amount = normalizeNumber(item.netBuyAmount);

      if (!amount) {
        return accumulator;
      }

      accumulator.netAmount = addNumericStrings(accumulator.netAmount, amount) || "0";

      if (compareNumericStrings(amount, "0") > 0) {
        accumulator.grossBuyAmount = addNumericStrings(accumulator.grossBuyAmount, amount) || "0";
        accumulator.buyCount += 1;
      }

      if (compareNumericStrings(amount, "0") < 0) {
        accumulator.grossSellAmount = addNumericStrings(
          accumulator.grossSellAmount,
          absoluteNumericString(amount)
        ) || "0";
        accumulator.sellCount += 1;
      }

      return accumulator;
    },
    {
      grossBuyAmount: "0",
      grossSellAmount: "0",
      netAmount: "0",
      buyCount: 0,
      sellCount: 0
    }
  );
}

function buildDailySections(items) {
  const sections = createEmptyInvestorBuckets();

  for (const investorType of INVESTOR_TYPES) {
    const investorItems = items.filter((item) => item.investorType === investorType);
    sections[investorType] = {
      buy: toTopMovers(investorItems, "buy", config.kisFlowTopCount),
      sell: toTopMovers(investorItems, "sell", config.kisFlowTopCount),
      buyAll: getMoversByDirection(investorItems, "buy"),
      sellAll: getMoversByDirection(investorItems, "sell")
    };
  }

  return sections;
}

function buildDailySummary(items) {
  const summary = {};

  for (const investorType of INVESTOR_TYPES) {
    summary[investorType] = summarizeItems(
      items.filter((item) => item.investorType === investorType)
    );
  }

  return summary;
}

function shiftDate(dateString, deltaDays) {
  const date = new Date(`${dateString}T00:00:00+09:00`);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

function buildFilledTrendSeries(rows, effectiveDate, windowDays) {
  const startDate = shiftDate(effectiveDate, -(windowDays - 1));
  const dateKeys = [];

  for (let index = 0; index < windowDays; index += 1) {
    dateKeys.push(shiftDate(startDate, index));
  }

  const byInvestor = {
    foreign: new Map(),
    institution: new Map()
  };

  for (const row of rows) {
    byInvestor[row.investor_type].set(row.trade_date, {
      date: row.trade_date,
      grossBuyAmount: row.gross_buy_amount || "0",
      grossSellAmount: row.gross_sell_amount || "0",
      netAmount: row.net_amount || "0",
      buyCount: Number(row.buy_count || 0),
      sellCount: Number(row.sell_count || 0)
    });
  }

  return {
    startDate,
    endDate: effectiveDate,
    windowDays,
    foreign: dateKeys.map((date) => byInvestor.foreign.get(date) || {
      date,
      grossBuyAmount: "0",
      grossSellAmount: "0",
      netAmount: "0",
      buyCount: 0,
      sellCount: 0
    }),
    institution: dateKeys.map((date) => byInvestor.institution.get(date) || {
      date,
      grossBuyAmount: "0",
      grossSellAmount: "0",
      netAmount: "0",
      buyCount: 0,
      sellCount: 0
    })
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
  const useIntradayEstimate = shouldUseInvestorTrendEstimate();
  const usePostCloseDaily = shouldUseInvestorTradeByStockDaily();

  if (useIntradayEstimate) {
    const estimateRows = await collectInvestorTrendEstimateRows();

    if (estimateRows.length > 0) {
      const uniqueCodes = Array.from(new Set(estimateRows.map((item) => item.stockCode)));
      const priceMap = await buildPriceMap(uniqueCodes);

      for (const investorType of INVESTOR_TYPES) {
        const finalized = rankFinalizedItems(
          estimateRows
            .filter((item) => item.investorType === investorType)
            .map((item) => finalizeRankingRow(item, priceMap))
            .filter((item) => item.netBuyAmount || item.netBuyQuantity)
        );

        await upsertRankingRows(tradeDate, investorType, finalized);
        rankings[investorType] = finalized.length;
      }

      return {
        enabled: true,
        tradeDate,
        rankings,
        weeklyWindowDays: config.kisFlowWeeklyWindowDays,
        trendWindowDays: FLOW_TREND_WINDOW_DAYS,
        collectionUniverseCount: Math.max(...Object.values(rankings), 0),
        collectionMethod: "investor-trend-estimate"
      };
    }

    console.warn(
      "Investor trend estimate collection did not return usable rows. Falling back to ranking API."
    );
  }

  if (usePostCloseDaily) {
    const dailyRows = await collectInvestorTradeByStockDailyRows(tradeDate);

    if (dailyRows.length > 0) {
      const uniqueCodes = Array.from(new Set(dailyRows.map((item) => item.stockCode)));
      const priceMap = await buildPriceMap(uniqueCodes);

      for (const investorType of INVESTOR_TYPES) {
        const finalized = rankFinalizedItems(
          dailyRows
            .filter((item) => item.investorType === investorType)
            .map((item) => finalizeRankingRow(item, priceMap))
            .filter((item) => item.netBuyAmount || item.netBuyQuantity)
        );

        await upsertRankingRows(tradeDate, investorType, finalized);
        rankings[investorType] = finalized.length;
      }

      return {
        enabled: true,
        tradeDate,
        rankings,
        weeklyWindowDays: config.kisFlowWeeklyWindowDays,
        trendWindowDays: FLOW_TREND_WINDOW_DAYS,
        collectionUniverseCount: Math.max(...Object.values(rankings), 0),
        collectionMethod: "investor-trade-by-stock-daily"
      };
    }

    console.warn(
      "Investor trade by stock daily collection did not return usable rows. Falling back to ranking API."
    );
  }

  for (const investorType of INVESTOR_TYPES) {
    const mappedBase = await collectInvestorRankingRows(investorType);
    const limitedBase = config.kisFlowUniverseCount
      ? mappedBase.slice(0, config.kisFlowUniverseCount)
      : mappedBase;
    const priceMap = await buildPriceMap(limitedBase.map((item) => item.stockCode));
    const mapped = limitedBase.map((item) => finalizeRankingRow(item, priceMap));

    await upsertRankingRows(tradeDate, investorType, mapped);
    rankings[investorType] = mapped.length;
  }

  return {
    enabled: true,
    tradeDate,
    rankings,
    weeklyWindowDays: config.kisFlowWeeklyWindowDays,
    trendWindowDays: FLOW_TREND_WINDOW_DAYS,
    collectionUniverseCount: Math.max(...Object.values(rankings), 0),
    collectionMethod: "foreign-institution-total"
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
      SELECT
        investor_type,
        stock_code,
        MIN(stock_name) AS stock_name,
        SUM(COALESCE(net_buy_amount, 0))::numeric(20, 0)::text AS net_buy_amount,
        COUNT(DISTINCT trade_date) AS active_days
      FROM investor_flow_snapshots
      WHERE market = 'KOSPI'
        AND trade_date BETWEEN ($1::date - ($2::int - 1) * INTERVAL '1 day') AND $1::date
      GROUP BY investor_type, stock_code
      ORDER BY investor_type ASC, stock_name ASC
    `,
    [effectiveDate, config.kisFlowWeeklyWindowDays]
  );

  const rows = result.rows.map(mapWeeklyRow);
  const sections = createEmptyInvestorBuckets();

  for (const investorType of INVESTOR_TYPES) {
    const investorRows = rows.filter((item) => item.investorType === investorType);
    sections[investorType] = {
      buy: toTopMovers(investorRows, "buy", config.kisFlowTopCount, true),
      sell: toTopMovers(investorRows, "sell", config.kisFlowTopCount, true),
      buyAll: getMoversByDirection(investorRows, "buy", true),
      sellAll: getMoversByDirection(investorRows, "sell", true)
    };
  }

  return {
    startDate: shiftDate(effectiveDate, -(config.kisFlowWeeklyWindowDays - 1)),
    endDate: effectiveDate,
    windowDays: config.kisFlowWeeklyWindowDays,
    ...sections
  };
}

async function getTrendFlows(effectiveDate) {
  const result = await query(
    `
      SELECT
        trade_date::text,
        investor_type,
        SUM(CASE WHEN COALESCE(net_buy_amount, 0) > 0 THEN net_buy_amount ELSE 0 END)::numeric(20, 0)::text AS gross_buy_amount,
        ABS(SUM(CASE WHEN COALESCE(net_buy_amount, 0) < 0 THEN net_buy_amount ELSE 0 END))::numeric(20, 0)::text AS gross_sell_amount,
        SUM(COALESCE(net_buy_amount, 0))::numeric(20, 0)::text AS net_amount,
        COUNT(DISTINCT CASE WHEN COALESCE(net_buy_amount, 0) > 0 THEN stock_code END) AS buy_count,
        COUNT(DISTINCT CASE WHEN COALESCE(net_buy_amount, 0) < 0 THEN stock_code END) AS sell_count
      FROM investor_flow_snapshots
      WHERE market = 'KOSPI'
        AND trade_date BETWEEN ($1::date - ($2::int - 1) * INTERVAL '1 day') AND $1::date
      GROUP BY trade_date, investor_type
      ORDER BY trade_date ASC, investor_type ASC
    `,
    [effectiveDate, FLOW_TREND_WINDOW_DAYS]
  );

  return buildFilledTrendSeries(result.rows, effectiveDate, FLOW_TREND_WINDOW_DAYS);
}

async function getInvestorFlowByDate(date) {
  const effectiveDate = await resolveLatestInvestorDate(date);

  if (!effectiveDate) {
    return {
      enabled: config.kisEnabled && config.kisMarketFlowEnabled,
      effectiveDate: null,
      market: "KOSPI",
      latestCollectedAt: null,
      collectionUniverseCount: null,
      dailyTopCount: config.kisFlowTopCount,
      weeklyWindowDays: config.kisFlowWeeklyWindowDays,
      trendWindowDays: FLOW_TREND_WINDOW_DAYS,
      summary: {
        foreign: summarizeItems([]),
        institution: summarizeItems([])
      },
      daily: createEmptyInvestorBuckets(),
      weekly: {
        startDate: null,
        endDate: null,
        windowDays: config.kisFlowWeeklyWindowDays,
        ...createEmptyInvestorBuckets()
      },
      trend: {
        startDate: null,
        endDate: null,
        windowDays: FLOW_TREND_WINDOW_DAYS,
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
      ORDER BY investor_type ASC, stock_name ASC
    `,
    [effectiveDate]
  );

  const items = result.rows.map(mapSnapshotRow);
  const weekly = await getWeeklyTopFlows(effectiveDate);
  const trend = await getTrendFlows(effectiveDate);
  const summary = buildDailySummary(items);
  const daily = buildDailySections(items);

  return {
    enabled: config.kisEnabled && config.kisMarketFlowEnabled,
    effectiveDate,
    market: "KOSPI",
    latestCollectedAt: items[0]?.collectedAt || null,
    collectionUniverseCount: Math.max(
      items.filter((item) => item.investorType === "foreign").length,
      items.filter((item) => item.investorType === "institution").length,
      0
    ) || null,
    dailyTopCount: config.kisFlowTopCount,
    weeklyWindowDays: config.kisFlowWeeklyWindowDays,
    trendWindowDays: FLOW_TREND_WINDOW_DAYS,
    summary,
    daily,
    weekly,
    trend
  };
}

module.exports = {
  getInvestorFlowByDate,
  runInvestorFlowCollectionCycle
};
