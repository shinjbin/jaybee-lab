const HTML_ENTITY_MAP = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": "\"",
  "&#39;": "'",
  "&nbsp;": " "
};

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "from",
  "this",
  "will",
  "into",
  "after",
  "about",
  "amid",
  "over",
  "under",
  "between",
  "more",
  "less",
  "have",
  "has",
  "had",
  "its",
  "their",
  "news",
  "says",
  "said",
  "시장",
  "증시",
  "뉴스",
  "관련",
  "대한",
  "위해",
  "이번",
  "기사"
]);

function decodeHtmlEntities(text) {
  let output = text;

  for (const [entity, value] of Object.entries(HTML_ENTITY_MAP)) {
    output = output.replaceAll(entity, value);
  }

  return output.replace(/&#(\d+);/g, (_match, code) =>
    String.fromCharCode(Number.parseInt(code, 10))
  );
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function cleanupText(value) {
  return decodeHtmlEntities(String(value || ""))
    .replace(/\s+/g, " ")
    .trim();
}

function truncateText(value, maxLength) {
  const cleaned = cleanupText(value);

  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  return `${cleaned.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function splitSentences(value) {
  return cleanupText(value)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => cleanupText(sentence))
    .filter(Boolean);
}

function extractKeywords(value) {
  const words = cleanupText(value)
    .toLowerCase()
    .split(/[^a-z0-9가-힣-]+/)
    .filter((word) => word.length >= 2 && !STOPWORDS.has(word));

  const counts = new Map();

  for (const word of words) {
    counts.set(word, (counts.get(word) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([word]) => word);
}

function guessMarketImpact(article) {
  const text = `${article.title} ${article.description || ""}`.toLowerCase();

  if (
    text.includes("fed") ||
    text.includes("inflation") ||
    text.includes("rate") ||
    text.includes("earnings") ||
    text.includes("tariff") ||
    text.includes("sanction")
  ) {
    return "high";
  }

  if (article.category === "market") {
    return "medium";
  }

  return "low";
}

function guessSentiment(article) {
  const text = `${article.title} ${article.description || ""}`.toLowerCase();
  const positiveSignals = ["rise", "gain", "growth", "beat", "surge", "record"];
  const negativeSignals = ["fall", "drop", "cut", "risk", "loss", "crisis"];

  const positive = positiveSignals.filter((word) => text.includes(word)).length;
  const negative = negativeSignals.filter((word) => text.includes(word)).length;

  if (positive > 0 && negative > 0) {
    return "mixed";
  }

  if (positive > 0) {
    return "positive";
  }

  if (negative > 0) {
    return "negative";
  }

  return "neutral";
}

module.exports = {
  cleanupText,
  extractKeywords,
  guessMarketImpact,
  guessSentiment,
  splitSentences,
  stripHtml,
  truncateText
};
