const config = require("./config");
const { cleanupText, stripHtml } = require("./utils");

const ARTICLE_TIMEOUT_MS = 12000;
const MAX_HTML_LENGTH = 2_000_000;
const MIN_CONTENT_LENGTH = 280;
const CONTENT_HINT_PATTERN =
  /(article|content|story|post|entry|news|body|main|detail|read|text)/i;
const NOISE_HINT_PATTERN =
  /(comment|footer|header|nav|menu|sidebar|promo|advert|related|recommend|share|signup|subscribe|cookie|banner|social)/i;

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function collectObjects(value, collector) {
  if (!value) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectObjects(item, collector);
    }
    return;
  }

  if (typeof value === "object") {
    collector.push(value);

    for (const nested of Object.values(value)) {
      collectObjects(nested, collector);
    }
  }
}

function extractJsonLdObjects(html) {
  const matches = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  const objects = [];

  for (const match of matches) {
    const payload = String(match[1] || "").replace(/^\uFEFF/, "").trim();

    if (!payload) {
      continue;
    }

    const parsed = parseJson(payload);

    if (parsed) {
      collectObjects(parsed, objects);
    }
  }

  return objects;
}

function extractMetaContent(html, attribute, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(
      `<meta[^>]+${attribute}=["']${escapedName}["'][^>]+content=["']([^"']+)["'][^>]*>`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+${attribute}=["']${escapedName}["'][^>]*>`,
      "i"
    )
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (match?.[1]) {
      return cleanupText(match[1]);
    }
  }

  return "";
}

function stripNoise(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, " ")
    .replace(
      /<(nav|footer|header|aside|form|button|figure|figcaption)[^>]*>[\s\S]*?<\/\1>/gi,
      " "
    );
}

function extractTagBlocks(html, tagName) {
  const blocks = [];
  const pattern = new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)<\\/${tagName}>`, "gi");

  for (const match of html.matchAll(pattern)) {
    blocks.push({
      attributes: match[1] || "",
      innerHtml: match[2] || ""
    });
  }

  return blocks;
}

function scoreBlock(block) {
  const text = cleanupText(stripHtml(block.innerHtml));
  const paragraphCount = (block.innerHtml.match(/<p\b/gi) || []).length;
  const sentenceCount = (text.match(/[.!?]\s/g) || []).length + 1;
  const attrText = cleanupText(block.attributes);

  if (text.length < 200) {
    return null;
  }

  if (NOISE_HINT_PATTERN.test(attrText)) {
    return null;
  }

  let score = text.length + paragraphCount * 180 + sentenceCount * 30;

  if (CONTENT_HINT_PATTERN.test(attrText)) {
    score += 700;
  }

  return {
    text,
    score
  };
}

function dedupeParagraphs(paragraphs) {
  const seen = new Set();
  const result = [];

  for (const paragraph of paragraphs) {
    const normalized = cleanupText(paragraph);

    if (!normalized || normalized.length < 40) {
      continue;
    }

    const key = normalized.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function extractParagraphText(html) {
  const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((match) =>
    cleanupText(stripHtml(match[1]))
  );

  return dedupeParagraphs(paragraphs).join("\n\n");
}

function extractBestBlockText(html) {
  const candidates = [];

  for (const tagName of ["article", "main", "section", "div"]) {
    for (const block of extractTagBlocks(html, tagName)) {
      const scored = scoreBlock(block);

      if (scored) {
        candidates.push(scored);
      }
    }
  }

  candidates.sort((left, right) => right.score - left.score);
  return candidates[0]?.text || "";
}

function normalizeArticleText(value) {
  return dedupeParagraphs(String(value || "").split(/\n{2,}/))
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractArticleFromHtml(html) {
  const jsonLdObjects = extractJsonLdObjects(html);
  const jsonLdBodies = jsonLdObjects
    .map((entry) => cleanupText(entry.articleBody || entry.text || ""))
    .filter((text) => text.length >= MIN_CONTENT_LENGTH);

  const metaDescription =
    extractMetaContent(html, "property", "og:description") ||
    extractMetaContent(html, "name", "description");

  if (jsonLdBodies.length > 0) {
    return {
      description: metaDescription,
      content: normalizeArticleText(jsonLdBodies[0])
    };
  }

  const cleanedHtml = stripNoise(html);
  const bestBlock = extractBestBlockText(cleanedHtml);
  const paragraphs = extractParagraphText(cleanedHtml);
  const contentSource = paragraphs.length > bestBlock.length ? paragraphs : bestBlock;

  return {
    description: metaDescription,
    content: normalizeArticleText(contentSource)
  };
}

function isSupportedUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_error) {
    return false;
  }
}

async function fetchArticleContent(url) {
  if (!isSupportedUrl(url)) {
    return null;
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent": config.collectorUserAgent,
      Accept: "text/html,application/xhtml+xml"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(ARTICLE_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`Article request failed (${response.status})`);
  }

  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("text/html")) {
    return null;
  }

  const html = (await response.text()).slice(0, MAX_HTML_LENGTH);
  const extracted = extractArticleFromHtml(html);

  if (!extracted.content || extracted.content.length < MIN_CONTENT_LENGTH) {
    return null;
  }

  return extracted;
}

module.exports = {
  fetchArticleContent
};
