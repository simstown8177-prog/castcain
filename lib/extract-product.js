function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(value) {
  return decodeHtml(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function extractMeta(html, selectors) {
  for (const selector of selectors) {
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${selector}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${selector}["'][^>]*>`, "i"),
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        return decodeHtml(match[1].trim());
      }
    }
  }
  return "";
}

function extractTitle(html) {
  const ogTitle = extractMeta(html, ["og:title", "twitter:title"]);
  if (ogTitle) return ogTitle;
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return titleMatch ? stripTags(titleMatch[1]) : "";
}

function extractJsonLd(html) {
  const matches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const nodes = [];
  for (const match of matches) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (Array.isArray(parsed)) {
        nodes.push(...parsed);
      } else {
        nodes.push(parsed);
      }
    } catch (error) {
      continue;
    }
  }
  return nodes;
}

function walkOffers(node) {
  if (!node || typeof node !== "object") return null;
  if (node.offers) return Array.isArray(node.offers) ? node.offers[0] : node.offers;
  if (node["@graph"] && Array.isArray(node["@graph"])) {
    for (const child of node["@graph"]) {
      const found = walkOffers(child);
      if (found) return found;
    }
  }
  return null;
}

function extractProductData(html, sourceUrl) {
  const jsonLdNodes = extractJsonLd(html);
  const productNode = jsonLdNodes.find((node) => {
    const type = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
    return type.includes("Product");
  });
  const offers = walkOffers(productNode);
  const priceMeta = extractMeta(html, [
    "product:price:amount",
    "og:price:amount",
    "twitter:data1",
  ]);
  const currencyMeta = extractMeta(html, ["product:price:currency", "og:price:currency"]);

  const inlinePricePatterns = [
    /"price"\s*:\s*"([^"]+)"/i,
    /"sale_price"\s*:\s*"([^"]+)"/i,
    /판매가[^0-9]{0,20}([0-9][0-9,]{2,})/i,
    /가격[^0-9]{0,20}([0-9][0-9,]{2,})/i,
  ];
  const inlinePrice =
    inlinePricePatterns.map((pattern) => html.match(pattern)?.[1]).find(Boolean) || "";

  return {
    sourceUrl,
    title:
      (productNode && (productNode.name || productNode.headline)) ||
      extractTitle(html) ||
      "제목 없음",
    vendor:
      (productNode && (productNode.brand?.name || productNode.manufacturer?.name)) ||
      extractMeta(html, ["og:site_name"]) ||
      "",
    description:
      (productNode && productNode.description) || extractMeta(html, ["description", "og:description"]) || "",
    sku: (productNode && productNode.sku) || "",
    image:
      (productNode && (Array.isArray(productNode.image) ? productNode.image[0] : productNode.image)) ||
      extractMeta(html, ["og:image"]) ||
      "",
    price:
      (offers && (offers.price || offers.lowPrice)) ||
      priceMeta ||
      inlinePrice ||
      "",
    currency:
      (offers && offers.priceCurrency) ||
      currencyMeta ||
      "KRW",
    availability:
      (offers && offers.availability && String(offers.availability).split("/").pop()) || "",
  };
}

async function extractFromUrl(url) {
  const targetUrl = new URL(url);
  const response = await fetch(targetUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 CostDashboard/1.0",
      Accept: "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) {
    const error = new Error(`FETCH_FAILED:${response.status}`);
    error.status = response.status;
    throw error;
  }

  const html = await response.text();
  return extractProductData(html, targetUrl.toString());
}

module.exports = {
  extractFromUrl,
};
