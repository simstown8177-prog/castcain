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

function normalizeSpace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanName(value) {
  return normalizeSpace(String(value || "").replace(/\s*[\|\-·•]\s*(쿠팡|11번가|G마켓|옥션|스마트스토어|네이버|마켓컬리|컬리|SSG|이마트몰).*/i, ""));
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

function hostnameToVendor(sourceUrl) {
  try {
    const hostname = new URL(sourceUrl).hostname.replace(/^www\./, "");
    const parts = hostname.split(".");
    if (parts.length >= 2) {
      return parts[parts.length - 2].toUpperCase();
    }
    return hostname.toUpperCase();
  } catch (error) {
    return "";
  }
}

function titleToVendor(title) {
  const value = normalizeSpace(title);
  const parts = value.split(/\s*[\|\-·•]\s*/).map((part) => normalizeSpace(part)).filter(Boolean);
  if (parts.length >= 2) {
    return parts[parts.length - 1];
  }
  return "";
}

function findJsonValue(html, keys) {
  for (const key of keys) {
    const pattern = new RegExp(`"${key}"\\s*:\\s*"(.*?)"`, "i");
    const match = html.match(pattern);
    if (match) return decodeHtml(match[1]);
  }
  return "";
}

function normalizePrice(raw) {
  return String(raw || "").replace(/[^\d.]/g, "").trim();
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
  const title = extractTitle(html);
  const metaVendor = extractMeta(html, ["og:site_name", "application-name", "twitter:app:name:iphone"]);
  const jsonVendor = findJsonValue(html, ["seller_name", "brandName", "mallName", "site_name", "companyName"]);

  const inlinePricePatterns = [
    /"price"\s*:\s*"([^"]+)"/i,
    /"price"\s*:\s*([0-9][0-9,]{2,})/i,
    /"sale_price"\s*:\s*"([^"]+)"/i,
    /"salePrice"\s*:\s*"([^"]+)"/i,
    /"salePrice"\s*:\s*([0-9][0-9,]{2,})/i,
    /"productPrice"\s*:\s*"([^"]+)"/i,
    /"finalPrice"\s*:\s*"([^"]+)"/i,
    /판매가[^0-9]{0,20}([0-9][0-9,]{2,})/i,
    /가격[^0-9]{0,20}([0-9][0-9,]{2,})/i,
    /할인가[^0-9]{0,20}([0-9][0-9,]{2,})/i,
  ];
  const inlinePrice =
    inlinePricePatterns.map((pattern) => html.match(pattern)?.[1]).find(Boolean) || "";
  const productTitle =
    (productNode && (productNode.name || productNode.headline)) ||
    extractMeta(html, ["twitter:title"]) ||
    findJsonValue(html, ["productName", "goods_name", "item_name", "title"]) ||
    title ||
    "제목 없음";
  const vendor =
    (productNode && (productNode.brand?.name || productNode.manufacturer?.name || productNode.seller?.name)) ||
    metaVendor ||
    jsonVendor ||
    titleToVendor(title) ||
    hostnameToVendor(sourceUrl);

  return {
    sourceUrl,
    title: cleanName(productTitle),
    vendor: cleanName(vendor),
    description:
      (productNode && productNode.description) || extractMeta(html, ["description", "og:description"]) || "",
    sku: (productNode && productNode.sku) || "",
    image:
      (productNode && (Array.isArray(productNode.image) ? productNode.image[0] : productNode.image)) ||
      extractMeta(html, ["og:image"]) ||
      "",
    price:
      normalizePrice((offers && (offers.price || offers.lowPrice)) || priceMeta || inlinePrice || ""),
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
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
    redirect: "follow",
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
