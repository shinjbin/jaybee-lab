const { XMLParser } = require("fast-xml-parser");

const config = require("./config");
const { cleanupText, stripHtml } = require("./utils");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true
});

function asArray(value) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function readText(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return readText(value[0]);
  }

  if (typeof value === "object") {
    if (typeof value["#text"] === "string") {
      return value["#text"];
    }

    if (typeof value["@_href"] === "string") {
      return value["@_href"];
    }

    if (typeof value.href === "string") {
      return value.href;
    }
  }

  return "";
}

function extractLink(rawLink) {
  if (!rawLink) {
    return "";
  }

  if (typeof rawLink === "string") {
    return rawLink.trim();
  }

  if (Array.isArray(rawLink)) {
    const preferred =
      rawLink.find((link) => link && link["@_rel"] === "alternate") ||
      rawLink[0];

    return extractLink(preferred);
  }

  if (typeof rawLink === "object") {
    if (typeof rawLink["@_href"] === "string") {
      return rawLink["@_href"].trim();
    }

    if (typeof rawLink.href === "string") {
      return rawLink.href.trim();
    }
  }

  return "";
}

function normalizeDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function mapEntryToArticle(feed, entry) {
  const title = cleanupText(readText(entry.title));
  const url = extractLink(entry.link);
  const rawDescription =
    readText(entry.description) ||
    readText(entry.summary) ||
    readText(entry["content:encoded"]);
  const rawContent =
    readText(entry["content:encoded"]) ||
    readText(entry.content) ||
    rawDescription;

  return {
    sourceKey: feed.key,
    sourceName: feed.name,
    category: feed.category,
    title,
    url,
    description: cleanupText(stripHtml(rawDescription)),
    content: cleanupText(stripHtml(rawContent)),
    publishedAt: normalizeDate(
      entry.pubDate || entry.published || entry.updated || entry.dcDate
    )
  };
}

function extractFeedEntries(parsed) {
  if (parsed && parsed.rss && parsed.rss.channel) {
    return asArray(parsed.rss.channel.item);
  }

  if (parsed && parsed.feed) {
    return asArray(parsed.feed.entry);
  }

  return [];
}

async function fetchFeedArticles(feed) {
  const response = await fetch(feed.url, {
    headers: {
      "User-Agent": config.collectorUserAgent,
      Accept: "application/rss+xml, application/atom+xml, application/xml"
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`Feed request failed (${response.status}) for ${feed.url}`);
  }

  const xml = await response.text();
  const parsed = parser.parse(xml);
  const entries = extractFeedEntries(parsed);

  return entries
    .slice(0, config.newsFetchLimitPerFeed)
    .map((entry) => mapEntryToArticle(feed, entry))
    .filter((article) => article.title && article.url);
}

module.exports = {
  fetchFeedArticles
};
