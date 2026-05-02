const { query } = require("./db");
const { parseDateInput } = require("./dateUtils");

async function saveAnalysis({ date, model, content, summary, sections }) {
  if (!parseDateInput(date)) {
    const err = new Error(`유효하지 않은 날짜 형식: ${date}`);
    err.statusCode = 400;
    throw err;
  }

  if (!content && !summary && (!sections || Object.keys(sections).length === 0)) {
    const err = new Error("content, summary, sections 중 하나 이상은 필수입니다.");
    err.statusCode = 400;
    throw err;
  }

  await query(
    `INSERT INTO ai_market_analysis
       (analysis_date, model, content, summary, sections, status, generated_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'completed', NOW(), NOW())
     ON CONFLICT (analysis_date) DO UPDATE SET
       model        = EXCLUDED.model,
       content      = EXCLUDED.content,
       summary      = EXCLUDED.summary,
       sections     = EXCLUDED.sections,
       status       = 'completed',
       error_message = NULL,
       generated_at = NOW(),
       updated_at   = NOW()`,
    [
      date,
      model || "unknown",
      content || "",
      summary || null,
      JSON.stringify(sections || {})
    ]
  );

  return { date, status: "completed" };
}

async function getAnalysisByDate(rawDate) {
  if (!parseDateInput(rawDate)) {
    const err = new Error(`유효하지 않은 날짜 형식: ${rawDate}`);
    err.statusCode = 400;
    throw err;
  }

  const result = await query(
    `SELECT analysis_date, model, content, summary, sections, status, error_message, generated_at
     FROM ai_market_analysis
     WHERE analysis_date = $1`,
    [rawDate]
  );

  if (result.rows.length === 0) {
    return { date: rawDate, analysis: null };
  }

  const row = result.rows[0];

  return {
    date: rawDate,
    analysis: {
      date: row.analysis_date,
      model: row.model,
      content: row.content,
      summary: row.summary,
      sections: row.sections,
      status: row.status,
      errorMessage: row.error_message,
      generatedAt: row.generated_at
    }
  };
}

module.exports = {
  saveAnalysis,
  getAnalysisByDate
};
