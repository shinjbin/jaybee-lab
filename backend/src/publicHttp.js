const dns = require("node:dns/promises");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const ipaddr = require("ipaddr.js");

function isPublicAddress(address) {
  try {
    const ip = ipaddr.parse(address);
    // Only globally routable addresses. Reject mapped/transition IPv6 as well.
    return ip.range() === "unicast";
  } catch (_) { return false; }
}

function validateUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      (url.port && url.port !== (url.protocol === "https:" ? "443" : "80"))) {
    throw new Error("Unsupported article URL.");
  }
  return url;
}

async function resolvePublicAddresses(url, lookup = dns.lookup) {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const family = net.isIP(hostname);
  const addresses = family ? [{ address: hostname, family }] :
    await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(row => !isPublicAddress(row.address))) {
    throw new Error("Article destination is not public.");
  }
  return addresses;
}

function pinnedLookup(addresses) {
  return (_hostname, options, callback) => {
    const family = typeof options === "number" ? options : options.family;
    const candidates = family ? addresses.filter(row => row.family === family) : addresses;
    if (!candidates.length) return callback(new Error("No validated address for requested family."));
    if (options.all) return callback(null, candidates);
    return callback(null, candidates[0].address, candidates[0].family);
  };
}

function requestPublic(url, options) {
  return new Promise((resolve, reject) => {
    // Never reuse a socket resolved outside the validation boundary. TLS still
    // verifies the original hostname; lookup connects only to validated IPs.
    const request = (url.protocol === "https:" ? https : http).request(url,
      { ...options, agent: false }, resolve);
    request.on("error", reject);
    request.end();
  });
}

function withAbort(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function createPublicHtmlFetcher({ lookup = dns.lookup, request = requestPublic } = {}) {
  return async function fetchHtml(value, { userAgent, timeoutMs = 12_000,
    maxBytes = 2_000_000, maxRedirects = 5 } = {}) {
    const signal = AbortSignal.timeout(timeoutMs);
    let url = validateUrl(value);
    for (let redirects = 0; ; redirects++) {
      const addresses = await withAbort(resolvePublicAddresses(url, lookup), signal);
      const response = await request(url, { signal, lookup: pinnedLookup(addresses),
        headers: { "User-Agent": userAgent || "JaybeeLabNewsBot/1.0",
          Accept: "text/html,application/xhtml+xml", "Accept-Encoding": "identity" } });
      try {
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          if (redirects >= maxRedirects || !response.headers.location) {
            throw new Error("Article redirect limit exceeded.");
          }
          const next = validateUrl(new URL(response.headers.location, url));
          if (url.protocol === "https:" && next.protocol !== "https:") {
            throw new Error("Insecure article redirect.");
          }
          url = next;
          continue;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          throw new Error(`Article request failed (${response.statusCode}).`);
        }
        if (!/^(text\/html|application\/xhtml\+xml)(;|$)/i.test(response.headers["content-type"] || "")) {
          return null;
        }
        // Request identity encoding and reject servers that ignore it, avoiding
        // decompression bombs without buffering any compressed response.
        if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") {
          throw new Error("Unsupported article encoding.");
        }
        if (Number(response.headers["content-length"]) > maxBytes) {
          throw new Error("Article response is too large.");
        }
        const chunks = [];
        let bytes = 0;
        for await (const chunk of response) {
          signal.throwIfAborted();
          bytes += chunk.length;
          if (bytes > maxBytes) throw new Error("Article response is too large.");
          chunks.push(chunk);
        }
        return Buffer.concat(chunks, bytes).toString("utf8");
      } finally {
        response.destroy();
      }
    }
  };
}

module.exports = { createPublicHtmlFetcher, isPublicAddress, resolvePublicAddresses, pinnedLookup };
