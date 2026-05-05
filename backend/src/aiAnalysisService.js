const { query } = require("./db");
const { parseDateInput } = require("./dateUtils");

async function saveAnalysis({ date, title, category, content }) {
  if (!parseDateInput(date)) {
    const err = new Error(`유효하지 않은 날짜 형식: ${date}`);
    err.statusCode = 400;
    throw err;
  }

  if (!content) {
    const err = new Error("content는 필수입니다.");
    err.statusCode = 400;
    throw err;
  }

  await query(
    `INSERT INTO ai_market_analysis (analysis_date, title, category, content)
     VALUES ($1, $2, $3, $4)`,
    [date, title || "", category || "", content]
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
    `SELECT id, analysis_date, title, category, content, created_at
     FROM ai_market_analysis
     WHERE analysis_date = $1
     ORDER BY created_at DESC`,
    [rawDate]
  );

  return {
    date: rawDate,
    items: result.rows.map((row) => ({
      id: row.id,
      date: row.analysis_date,
      title: row.title,
      category: row.category,
      content: row.content,
      createdAt: row.created_at
    }))
  };
}

module.exports = {
  saveAnalysis,
  getAnalysisByDate
};
