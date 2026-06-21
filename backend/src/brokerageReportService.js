const { query } = require("./db");
const { parseDateInput } = require("./dateUtils");

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function normalizeText(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

function normalizeOptionalNumber(value, fieldName) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  const parsed = Number(String(value).replace(/,/g, ""));

  if (!Number.isFinite(parsed)) {
    throw badRequest(`${fieldName} must be a number`);
  }

  return parsed;
}

function normalizeReport(input) {
  const reportDate = normalizeText(input.reportDate || input.report_date || input.date);
  const brokerage = normalizeText(input.brokerage || input.brokerageName || input.sourceName);
  const title = normalizeText(input.title);

  if (!parseDateInput(reportDate)) {
    throw badRequest(`Invalid reportDate: ${reportDate}`);
  }

  if (!brokerage) {
    throw badRequest("brokerage is required");
  }

  if (!title) {
    throw badRequest("title is required");
  }

  return {
    reportDate,
    brokerage,
    analyst: normalizeText(input.analyst),
    title,
    stockCode: normalizeText(input.stockCode || input.stock_code),
    stockName: normalizeText(input.stockName || input.stock_name),
    sector: normalizeText(input.sector),
    rating: normalizeText(input.rating || input.investmentOpinion),
    targetPrice: normalizeOptionalNumber(input.targetPrice || input.target_price, "targetPrice"),
    currentPrice: normalizeOptionalNumber(input.currentPrice || input.current_price, "currentPrice"),
    summary: normalizeText(input.summary || input.content),
    reportUrl: normalizeText(input.reportUrl || input.report_url || input.url),
    sourceKey: normalizeText(input.sourceKey || input.source_key),
    rawPayload: input.rawPayload || input.raw_payload || input
  };
}

function mapReport(row) {
  return {
    id: row.id,
    reportDate: row.report_date,
    brokerage: row.brokerage,
    analyst: row.analyst,
    title: row.title,
    stockCode: row.stock_code,
    stockName: row.stock_name,
    sector: row.sector,
    rating: row.rating,
    targetPrice: row.target_price === null ? null : Number(row.target_price),
    currentPrice: row.current_price === null ? null : Number(row.current_price),
    summary: row.summary,
    reportUrl: row.report_url,
    sourceKey: row.source_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function saveBrokerageReport(input) {
  const report = normalizeReport(input || {});

  const result = await query(
    `INSERT INTO brokerage_reports (
       report_date, brokerage, analyst, title, stock_code, stock_name, sector,
       rating, target_price, current_price, summary, report_url, source_key, raw_payload
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
     ON CONFLICT (source_key) WHERE source_key <> '' DO UPDATE SET
       report_date = EXCLUDED.report_date,
       brokerage = EXCLUDED.brokerage,
       analyst = EXCLUDED.analyst,
       title = EXCLUDED.title,
       stock_code = EXCLUDED.stock_code,
       stock_name = EXCLUDED.stock_name,
       sector = EXCLUDED.sector,
       rating = EXCLUDED.rating,
       target_price = EXCLUDED.target_price,
       current_price = EXCLUDED.current_price,
       summary = EXCLUDED.summary,
       report_url = EXCLUDED.report_url,
       raw_payload = EXCLUDED.raw_payload,
       updated_at = NOW()
     RETURNING *`,
    [
      report.reportDate,
      report.brokerage,
      report.analyst,
      report.title,
      report.stockCode,
      report.stockName,
      report.sector,
      report.rating,
      report.targetPrice,
      report.currentPrice,
      report.summary,
      report.reportUrl,
      report.sourceKey,
      JSON.stringify(report.rawPayload || {})
    ]
  );

  return mapReport(result.rows[0]);
}

async function saveBrokerageReportsBulk(items) {
  if (!Array.isArray(items)) {
    throw badRequest("items must be an array");
  }

  const saved = [];
  const failed = [];

  for (const [index, item] of items.entries()) {
    try {
      saved.push(await saveBrokerageReport(item));
    } catch (error) {
      failed.push({ index, error: error.message });
    }
  }

  return {
    inserted: saved.length,
    failed: failed.length,
    items: saved,
    errors: failed
  };
}

async function getBrokerageReports(filters = {}) {
  const values = [];
  const where = [];
  const limit = Math.max(1, Math.min(Number.parseInt(filters.limit, 10) || 50, 200));

  if (filters.startDate) {
    if (!parseDateInput(filters.startDate)) {
      throw badRequest(`Invalid startDate: ${filters.startDate}`);
    }
    values.push(filters.startDate);
    where.push(`report_date >= $${values.length}`);
  }

  if (filters.endDate) {
    if (!parseDateInput(filters.endDate)) {
      throw badRequest(`Invalid endDate: ${filters.endDate}`);
    }
    values.push(filters.endDate);
    where.push(`report_date <= $${values.length}`);
  }

  if (filters.stockCode) {
    values.push(String(filters.stockCode).trim());
    where.push(`stock_code = $${values.length}`);
  }

  if (filters.brokerage) {
    values.push(`%${String(filters.brokerage).trim()}%`);
    where.push(`brokerage ILIKE $${values.length}`);
  }

  if (filters.q) {
    values.push(`%${String(filters.q).trim()}%`);
    where.push(`(title ILIKE $${values.length} OR stock_name ILIKE $${values.length} OR summary ILIKE $${values.length})`);
  }

  values.push(limit);

  const result = await query(
    `SELECT *
     FROM brokerage_reports
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY report_date DESC, created_at DESC
     LIMIT $${values.length}`,
    values
  );

  return {
    count: result.rows.length,
    items: result.rows.map(mapReport)
  };
}

module.exports = {
  saveBrokerageReport,
  saveBrokerageReportsBulk,
  getBrokerageReports
};