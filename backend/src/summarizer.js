const config = require("./config");
const {
  cleanupText,
  extractKeywords,
  guessMarketImpact,
  guessSentiment,
  splitSentences,
  truncateText
} = require("./utils");

function buildFallbackSummary(article) {
  const sentences = splitSentences(
    `${article.title}. ${article.description || article.content || ""}`
  ).slice(0, 3);
  const summary =
    cleanupText(sentences.join(" ")) ||
    `${article.sourceName}에서 수집한 기사입니다: ${article.title}`;

  return {
    summary,
    translatedTitle: cleanupText(article.title),
    translatedContent: cleanupText(article.content || article.description || summary),
    bullets: sentences.length > 0 ? sentences : [summary],
    keywords: extractKeywords(
      `${article.title} ${article.description || article.content || ""}`
    ),
    marketImpact: guessMarketImpact(article),
    sentiment: guessSentiment(article),
    model: "fallback-rules"
  };
}

function extractJsonBlock(content) {
  const trimmed = content.trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Could not find JSON object in model response.");
  }

  return trimmed.slice(start, end + 1);
}

async function summarizeWithOpenAI(article) {
  const response = await fetch(`${config.openaiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openaiApiKey}`
    },
    signal: AbortSignal.timeout(config.openaiTimeoutMs),
    body: JSON.stringify({
      model: config.openaiModel,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You analyze financial news for Korean readers. Return strict JSON only with keys summary, translatedTitle, translatedContent, bullets, keywords, marketImpact, sentiment. sentiment must be one of positive, neutral, negative."
        },
        {
          role: "user",
          content: [
            "기사 정보를 바탕으로 한국어 요약과 번역을 만들어줘.",
            "summary는 한국어 2~3문장 요약이다.",
            "translatedTitle은 제목의 자연스러운 한국어 번역이다.",
            "translatedContent는 영어 본문 전체를 자연스러운 한국어로 풀어쓴 전체 번역이다.",
            "translatedContent는 문장 수 제한 없이 2~5개 단락 정도로 작성하되, 원문의 핵심 사실을 빠뜨리지 마.",
            "bullets는 한국어 3개 이하, keywords는 5개 이하 배열로 작성해.",
            "marketImpact는 high, medium, low 중 하나로 작성해.",
            "sentiment는 positive, neutral, negative 중 하나로만 작성해.",
            "JSON 외 텍스트는 절대 출력하지 마.",
            "",
            `분류: ${article.category}`,
            `언론사: ${article.sourceName}`,
            `제목: ${article.title}`,
            `설명: ${article.description || ""}`,
            `본문: ${truncateText(article.content || "", 4000)}`
          ].join("\n")
        }
      ]
    })
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(
      `OpenAI summarization failed (${response.status}): ${truncateText(payload, 240)}`
    );
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("OpenAI response did not include message content.");
  }

  const parsed = JSON.parse(extractJsonBlock(content));

  return {
    summary: cleanupText(parsed.summary),
    translatedTitle: cleanupText(parsed.translatedTitle || article.title),
    translatedContent: cleanupText(parsed.translatedContent || parsed.summary),
    bullets: Array.isArray(parsed.bullets)
      ? parsed.bullets
          .map((item) => cleanupText(item))
          .filter(Boolean)
          .slice(0, 3)
      : [],
    keywords: Array.isArray(parsed.keywords)
      ? parsed.keywords
          .map((item) => cleanupText(item))
          .filter(Boolean)
          .slice(0, 5)
      : [],
    marketImpact:
      parsed.marketImpact === "high" ||
      parsed.marketImpact === "medium" ||
      parsed.marketImpact === "low"
        ? parsed.marketImpact
        : guessMarketImpact(article),
    sentiment:
      parsed.sentiment === "positive" ||
      parsed.sentiment === "neutral" ||
      parsed.sentiment === "negative"
        ? parsed.sentiment
        : guessSentiment(article),
    model: config.openaiModel
  };
}

async function summarizeArticle(article) {
  if (!config.aiEnabled) {
    return buildFallbackSummary(article);
  }

  try {
    return await summarizeWithOpenAI(article);
  } catch (error) {
    console.warn(
      `Falling back to heuristic summary for article ${article.id || article.title}: ${error.message}`
    );
    return buildFallbackSummary(article);
  }
}

module.exports = {
  summarizeArticle
};
