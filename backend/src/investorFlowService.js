const config = require("./config");
const { parseDateInput, toSeoulDateString } = require("./dateUtils");
const { query } = require("./db");
const { fetchCurrentPrice, fetchStockClosingPrice, fetchInvestorTradeByStockDaily } = require("./tossClient");
const { getInvestorFlowUniverse } = require("./investorFlowUniverseService");

const INVESTOR_LABELS = {
  foreign: "Foreign",
  institution: "Institution"
};
const INVESTOR_TYPES = ["foreign", "institution"];
const FLOW_TREND_WINDOW_DAYS = 20;

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

function sortByName(left, right) {
  return String(left.stockName || left.date || "").localeCompare(
    String(right.stockName || right.date || ""),
    "en"
  );
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
      buy: toTopMovers(investorItems, "buy", config.tossFlowTopCount),
      sell: toTopMovers(investorItems, "sell", config.tossFlowTopCount),
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

function buildFilledTrendSeries(rows, startDate, endDate) {
  const windowDays = countDaysInclusive(startDate, endDate);
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
    endDate,
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
  if (!config.tossEnabled || !config.tossMarketFlowEnabled) {
    return { enabled: false, skipped: true, reason: "Toss credentials are not configured or collection is disabled." };
  }
  const universe = await getInvestorFlowUniverse();
  const stocks = config.tossFlowUniverseCount ? universe.slice(0, config.tossFlowUniverseCount) : universe;
  const today = toSeoulDateString();
  const byDate = new Map();
  let failedStocks = 0;
  // Sequential requests respect the client's pacing. Refresh the latest two
  // records so yesterday's provisional figures are replaced with final figures.
  for (const stock of stocks) {
    try {
      const records = await fetchInvestorTradeByStockDaily(stock.stockCode, today);
      for (const row of records) {
        if (!parseDateInput(row.date) || row.date > today) continue;
        let price = null;
        try {
          price = row.date === today
            ? (await fetchCurrentPrice(stock.stockCode))?.lastPrice
            : await fetchStockClosingPrice(stock.stockCode, row.date);
        } catch (error) {
          console.warn(`Toss price unavailable for ${stock.stockCode} on ${row.date}: ${error.message}`);
        }
        const priceMap = new Map([[stock.stockCode, normalizeNumber(price)]]);
        for (const investorType of INVESTOR_TYPES) {
          const netBuyQuantity = normalizeNumber(row[investorType === "foreign" ? "foreigner" : "institution"]?.netBuyVolume);
          if (netBuyQuantity === null) continue;
          const item = finalizeRankingRow({
            investorType, label: INVESTOR_LABELS[investorType], rank: 0,
            stockCode: stock.stockCode, stockName: stock.stockName,
            netBuyQuantity, apiNetBuyAmount: null,
            rawPayload: { collection_source: "toss-investor-trading", investor_trading: row,
              market_scope: "KRX+NXT", foreigner_scope: "registered" }
          }, priceMap);
          if (!byDate.has(row.date)) byDate.set(row.date, []);
          byDate.get(row.date).push(item);
        }
      }
    } catch (error) {
      failedStocks++;
      console.warn(`Toss investor trading failed for ${stock.stockCode}: ${error.message}`);
    }
  }
  if (stocks.length && failedStocks === stocks.length) throw new Error("Toss investor trading failed for all stocks.");
  const dates = [...byDate.keys()].sort();
  const rankings = {};
  for (const date of dates) {
    for (const investorType of INVESTOR_TYPES) {
      const items = rankFinalizedItems(byDate.get(date).filter((item) => item.investorType === investorType));
      await upsertRankingRows(date, investorType, items);
      rankings[investorType] = items.length;
    }
  }
  return { enabled: true, tradeDate: dates.at(-1) || null, collectedDates: dates,
    rankings, failedStocks, weeklyWindowDays: config.tossFlowWeeklyWindowDays,
    trendWindowDays: FLOW_TREND_WINDOW_DAYS, collectionUniverseCount: stocks.length,
    collectionMethod: dates.length ? "toss-investor-trading" : "no-data" };
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

async function resolveLatestInvestorDateInRange(startDate, endDate) {
  const result = await query(
    `
      SELECT MAX(trade_date)::text AS latest_date
      FROM investor_flow_snapshots
      WHERE market = 'KOSPI'
        AND trade_date BETWEEN $1::date AND $2::date
    `,
    [startDate, endDate]
  );

  return result.rows[0]?.latest_date || null;
}

function countDaysInclusive(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00+09:00`);
  const end = new Date(`${endDate}T00:00:00+09:00`);
  const diffMs = end.getTime() - start.getTime();

  return Math.floor(diffMs / 86400000) + 1;
}

function createRequestedRange(startDate, endDate, isCustomRange) {
  return {
    startDate,
    endDate,
    isCustomRange: Boolean(isCustomRange)
  };
}

function createEmptyTrendSeries(startDate, endDate, windowDays) {
  return {
    startDate,
    endDate,
    windowDays,
    foreign: [],
    institution: []
  };
}

function createEmptyInvestorFlowPayload({ requestedRange, effectiveDate = null }) {
  const weeklyWindowDays = requestedRange?.isCustomRange
    ? countDaysInclusive(requestedRange.startDate, requestedRange.endDate)
    : config.tossFlowWeeklyWindowDays;
  const trendWindowDays = requestedRange?.isCustomRange
    ? countDaysInclusive(requestedRange.startDate, requestedRange.endDate)
    : FLOW_TREND_WINDOW_DAYS;

  return {
    enabled: config.tossEnabled && config.tossMarketFlowEnabled,
    effectiveDate,
    requestedRange,
    market: "KOSPI",
    latestCollectedAt: null,
    collectionUniverseCount: null,
    dailyTopCount: config.tossFlowTopCount,
    weeklyWindowDays,
    trendWindowDays,
    summary: {
      foreign: summarizeItems([]),
      institution: summarizeItems([])
    },
    daily: createEmptyInvestorBuckets(),
    weekly: {
      startDate: requestedRange?.isCustomRange ? requestedRange.startDate : null,
      endDate: requestedRange?.isCustomRange ? requestedRange.endDate : null,
      windowDays: weeklyWindowDays,
      ...createEmptyInvestorBuckets()
    },
    trend: requestedRange?.isCustomRange
      ? createEmptyTrendSeries(
        requestedRange.startDate,
        requestedRange.endDate,
        trendWindowDays
      )
      : createEmptyTrendSeries(null, null, trendWindowDays)
  };
}

function validateRequestedRange(startDate, endDate) {
  if ((startDate && !endDate) || (!startDate && endDate)) {
    const error = new Error("startDate and endDate must be provided together.");
    error.statusCode = 400;
    throw error;
  }

  if (startDate && endDate && startDate > endDate) {
    const error = new Error("startDate must be less than or equal to endDate.");
    error.statusCode = 400;
    throw error;
  }
}

async function resolveInvestorRequestRange({ date, startDate, endDate } = {}) {
  const requestedDate = parseDateInput(date);
  const requestedStartDate = parseDateInput(startDate);
  const requestedEndDate = parseDateInput(endDate);

  validateRequestedRange(requestedStartDate, requestedEndDate);

  if (requestedStartDate && requestedEndDate) {
    const effectiveDate = await resolveLatestInvestorDateInRange(
      requestedStartDate,
      requestedEndDate
    );

    return {
      effectiveDate,
      requestedRange: createRequestedRange(
        requestedStartDate,
        requestedEndDate,
        true
      ),
      dailyDate: effectiveDate,
      weeklyStartDate: requestedStartDate,
      weeklyEndDate: effectiveDate || requestedEndDate,
      trendStartDate: requestedStartDate,
      trendEndDate: effectiveDate || requestedEndDate,
      weeklyWindowDays: countDaysInclusive(requestedStartDate, requestedEndDate),
      trendWindowDays: countDaysInclusive(requestedStartDate, requestedEndDate)
    };
  }

  const effectiveDate = await resolveLatestInvestorDate(requestedDate);

  if (!effectiveDate) {
    return {
      effectiveDate: null,
      requestedRange: createRequestedRange(null, null, false),
      dailyDate: null,
      weeklyStartDate: null,
      weeklyEndDate: null,
      trendStartDate: null,
      trendEndDate: null,
      weeklyWindowDays: config.tossFlowWeeklyWindowDays,
      trendWindowDays: FLOW_TREND_WINDOW_DAYS
    };
  }

  return {
    effectiveDate,
    requestedRange: createRequestedRange(
      requestedDate || effectiveDate,
      requestedDate || effectiveDate,
      false
    ),
    dailyDate: effectiveDate,
    weeklyStartDate: shiftDate(effectiveDate, -(config.tossFlowWeeklyWindowDays - 1)),
    weeklyEndDate: effectiveDate,
    trendStartDate: shiftDate(effectiveDate, -(FLOW_TREND_WINDOW_DAYS - 1)),
    trendEndDate: effectiveDate,
    weeklyWindowDays: config.tossFlowWeeklyWindowDays,
    trendWindowDays: FLOW_TREND_WINDOW_DAYS
  };
}

async function getWeeklyTopFlows(startDate, endDate) {
  const windowDays = countDaysInclusive(startDate, endDate);
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
        AND trade_date BETWEEN $1::date AND $2::date
      GROUP BY investor_type, stock_code
      ORDER BY investor_type ASC, stock_name ASC
    `,
    [startDate, endDate]
  );

  const rows = result.rows.map(mapWeeklyRow);
  const sections = createEmptyInvestorBuckets();

  for (const investorType of INVESTOR_TYPES) {
    const investorRows = rows.filter((item) => item.investorType === investorType);
    sections[investorType] = {
      buy: toTopMovers(investorRows, "buy", config.tossFlowTopCount, true),
      sell: toTopMovers(investorRows, "sell", config.tossFlowTopCount, true),
      buyAll: getMoversByDirection(investorRows, "buy", true),
      sellAll: getMoversByDirection(investorRows, "sell", true)
    };
  }

  return {
    startDate,
    endDate,
    windowDays,
    ...sections
  };
}

async function getTrendFlows(startDate, endDate) {
  const windowDays = countDaysInclusive(startDate, endDate);
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
        AND trade_date BETWEEN $1::date AND $2::date
      GROUP BY trade_date, investor_type
      ORDER BY trade_date ASC, investor_type ASC
    `,
    [startDate, endDate]
  );

  return buildFilledTrendSeries(result.rows, startDate, endDate);
}

async function getInvestorFlowByDate(options = {}) {
  const {
    effectiveDate,
    requestedRange,
    dailyDate,
    weeklyStartDate,
    weeklyEndDate,
    trendStartDate,
    trendEndDate,
    weeklyWindowDays,
    trendWindowDays
  } = await resolveInvestorRequestRange(options);

  if (!effectiveDate) {
    return createEmptyInvestorFlowPayload({ requestedRange });
  }

  const result = await query(
    `
      SELECT *
      FROM investor_flow_snapshots
      WHERE trade_date = $1::date
        AND market = 'KOSPI'
      ORDER BY investor_type ASC, stock_name ASC
    `,
    [dailyDate]
  );

  const items = result.rows.map(mapSnapshotRow);
  const weekly = await getWeeklyTopFlows(weeklyStartDate, weeklyEndDate);
  const trend = await getTrendFlows(trendStartDate, trendEndDate);
  const summary = buildDailySummary(items);
  const daily = buildDailySections(items);

  return {
    enabled: config.tossEnabled && config.tossMarketFlowEnabled,
    effectiveDate,
    requestedRange,
    market: "KOSPI",
    latestCollectedAt: items[0]?.collectedAt || null,
    collectionUniverseCount: Math.max(
      items.filter((item) => item.investorType === "foreign").length,
      items.filter((item) => item.investorType === "institution").length,
      0
    ) || null,
    dailyTopCount: config.tossFlowTopCount,
    weeklyWindowDays,
    trendWindowDays,
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
