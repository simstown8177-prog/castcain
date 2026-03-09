function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/gi, "/")
    .replace(/&nbsp;/gi, " ");
}

function stripTags(value) {
  return decodeHtml(String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function normalizeSpace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanName(value) {
  return normalizeSpace(String(value || "").replace(/\s*[\|\-·•]\s*(쿠팡|11번가|G마켓|옥션|스마트스토어|네이버|마켓컬리|컬리|SSG|이마트몰).*/i, ""));
}

function cleanText(value) {
  return normalizeSpace(decodeHtml(String(value || "").replace(/^["']|["']$/g, "")));
}

function extractMeta(html, selectors) {
  for (const selector of selectors) {
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${selector}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["']${selector}["'][^>]*>`, "i"),
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        return cleanText(match[1]);
      }
    }
  }
  return "";
}

function extractTitle(html) {
  const ogTitle = extractMeta(html, ["og:title", "twitter:title"]);
  if (ogTitle) return ogTitle;
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) return stripTags(h1Match[1]);
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return titleMatch ? stripTags(titleMatch[1]) : "";
}

function hostnameToVendor(sourceUrl) {
  try {
    const hostname = new URL(sourceUrl).hostname.replace(/^www\./, "");
    const knownVendors = [
      ["coupang.com", "쿠팡"],
      ["smartstore.naver.com", "스마트스토어"],
      ["brand.naver.com", "스마트스토어"],
      ["shopping.naver.com", "네이버쇼핑"],
      ["11st.co.kr", "11번가"],
      ["gmarket.co.kr", "G마켓"],
      ["auction.co.kr", "옥션"],
      ["kurly.com", "컬리"],
      ["ssg.com", "SSG"],
      ["emart.ssg.com", "이마트몰"],
      ["chabyulhwa.com", "차별화상회"],
    ];
    const matched = knownVendors.find(([domain]) => hostname === domain || hostname.endsWith(`.${domain}`));
    if (matched) return matched[1];
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
  const parts = value
    .split(/\s*[\|\-·•]\s*/)
    .map((part) => normalizeSpace(part))
    .filter(Boolean);
  if (parts.length >= 2) {
    return parts[parts.length - 1];
  }
  return "";
}

function normalizePrice(raw) {
  return String(raw || "").replace(/[^\d.]/g, "").trim();
}

function formatNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  const rounded = Math.round(numeric * 100) / 100;
  return Number.isInteger(rounded) ? String(Math.trunc(rounded)) : String(rounded);
}

function normalizeUnit(rawUnit) {
  const unit = String(rawUnit || "").trim().toLowerCase();
  if (!unit) return "";
  if (unit === "kg") return "kg";
  if (unit === "g" || unit === "gr" || unit === "gram") return "g";
  if (unit === "mg") return "mg";
  if (unit === "l" || unit === "liter" || unit === "litre") return "L";
  if (unit === "ml") return "ml";
  if (unit === "ea" || unit === "개입" || unit === "개") return "ea";
  if (unit === "pack" || unit === "팩") return "pack";
  if (unit === "봉" || unit === "봉지") return "봉";
  return rawUnit;
}

function findAllMatches(html, regex) {
  return [...html.matchAll(regex)].map((match) => cleanText(match[1] || match[2] || ""));
}

function findMatchObjects(html, regex) {
  return [...html.matchAll(regex)].map((match) => ({
    full: cleanText(match[0] || ""),
    first: cleanText(match[1] || ""),
    second: cleanText(match[2] || ""),
  }));
}

function parseJsonLikeBlocks(html) {
  const blocks = [];
  const scriptMatches = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
  const assignmentPatterns = [
    /(?:window\.__[^=]+|window\.__INITIAL_STATE__|window\.__PRELOADED_STATE__|window\.__APOLLO_STATE__|window\.__NUXT__|__NEXT_DATA__|__PRELOADED_STATE__|__APOLLO_STATE__|__NUXT__)\s*=\s*({[\s\S]*?})\s*;?/g,
    /(?:window\.__[^=]+|window\.__INITIAL_STATE__|window\.__PRELOADED_STATE__|window\.__APOLLO_STATE__|window\.__NUXT__|__NEXT_DATA__|__PRELOADED_STATE__|__APOLLO_STATE__|__NUXT__)\s*=\s*(\[[\s\S]*?\])\s*;?/g,
  ];
  for (const match of scriptMatches) {
    const raw = match[1].trim();
    if (!raw) continue;
    const candidates = [
      raw,
      ...assignmentPatterns.flatMap((pattern) =>
        [...raw.matchAll(pattern)].map((entry) => (entry[1] || "").trim()).filter(Boolean)
      ),
    ];
    for (const candidate of candidates) {
      try {
        blocks.push(JSON.parse(candidate));
      } catch (error) {
        continue;
      }
    }
  }
  return blocks;
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

function extractNextData(html) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (error) {
    return null;
  }
}

function extractEmbeddedJsonById(html, id) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`<script[^>]+id=["']${escapedId}["'][^>]*>([\\s\\S]*?)<\\/script>`, "i"));
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (error) {
    return null;
  }
}

function flattenObjects(input, bucket = []) {
  if (!input || typeof input !== "object") return bucket;
  bucket.push(input);
  if (Array.isArray(input)) {
    input.forEach((item) => flattenObjects(item, bucket));
    return bucket;
  }
  Object.values(input).forEach((value) => flattenObjects(value, bucket));
  return bucket;
}

function getStringCandidates(value) {
  if (value == null) return [];
  if (typeof value === "string" || typeof value === "number") {
    const cleaned = cleanText(value);
    return cleaned ? [cleaned] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => getStringCandidates(item));
  }
  if (typeof value === "object") {
    return Object.values(value).flatMap((item) => getStringCandidates(item));
  }
  return [];
}

function findValueInObjects(objects, keys) {
  const loweredKeys = keys.map((key) => key.toLowerCase());
  for (const item of objects) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    for (const [key, value] of Object.entries(item)) {
      const normalizedKey = key.toLowerCase();
      if (loweredKeys.includes(normalizedKey)) {
        const candidates = getStringCandidates(value);
        if (candidates.length) return candidates[0];
      }
    }
  }
  return "";
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

function pickFirstMeaningful(values, predicate = null) {
  for (const value of values) {
    const normalized = cleanText(value);
    if (!normalized) continue;
    if (predicate && !predicate(normalized)) continue;
    return normalized;
  }
  return "";
}

function isLikelyProductName(value) {
  if (!value) return false;
  if (value.length < 2) return false;
  if (/^(홈|로그인|회원가입|장바구니|상품상세|제품상세)$/i.test(value)) return false;
  return /[가-힣a-z0-9]/i.test(value);
}

function extractCategory(html, objects) {
  const breadcrumb = extractMeta(html, ["product:category", "category", "keywords"]);
  const objectValue = findValueInObjects(objects, ["categoryName", "category", "disp_ctg_nm", "categoryNm", "breadcrumb"]);
  const breadcrumbMatch = html.match(/(?:카테고리|분류)[^<]{0,60}<[^>]*>([^<]+)/i);
  const raw = pickFirstMeaningful([breadcrumb, objectValue, breadcrumbMatch?.[1] || ""]);
  return raw ? raw.split(/[>,/|]/).map((part) => cleanText(part)).filter(Boolean).pop() || raw : "";
}

function normalizeCategory(rawCategory, fallbackText = "") {
  const fullText = `${cleanText(rawCategory)} ${fallbackText}`.toLowerCase();
  const categoryRules = [
    ["육류", ["소고기", "돼지고기", "닭", "오리", "목살", "삼겹", "갈비", "정육", "축산", "돈육"]],
    ["수산", ["새우", "오징어", "문어", "생선", "연어", "참치", "해산물", "수산", "조개"]],
    ["채소", ["양파", "대파", "상추", "배추", "감자", "고구마", "채소", "야채", "버섯"]],
    ["과일", ["사과", "배", "오렌지", "레몬", "라임", "딸기", "포도", "과일"]],
    ["유제품", ["우유", "치즈", "버터", "크림", "요거트", "유제품"]],
    ["소스/양념", ["소스", "양념", "간장", "고추장", "된장", "식초", "향신료", "파우더"]],
    ["가공식품", ["만두", "튀김", "냉동", "가공", "즉석", "어묵", "햄", "소시지"]],
    ["곡물/면", ["쌀", "밀가루", "면", "파스타", "국수", "떡", "곡물"]],
    ["음료", ["주스", "음료", "커피", "차", "탄산", "에이드"]],
  ];
  for (const [label, keywords] of categoryRules) {
    if (keywords.some((keyword) => fullText.includes(keyword))) {
      return label;
    }
  }
  return cleanText(rawCategory);
}

function extractWeightAndUnit(texts) {
  const rangePatterns = [
    /(\d+(?:\.\d+)?)\s*[~\-]\s*(\d+(?:\.\d+)?)\s*(kg|g|mg|ml|l|L)\b/i,
    /내용량[^0-9]{0,10}(\d+(?:\.\d+)?)\s*[~\-]\s*(\d+(?:\.\d+)?)\s*(kg|g|mg|ml|l|L)\b/i,
    /규격[^0-9]{0,10}(\d+(?:\.\d+)?)\s*[~\-]\s*(\d+(?:\.\d+)?)\s*(kg|g|mg|ml|l|L)\b/i,
  ];
  const singlePatterns = [
    /(\d+(?:\.\d+)?)\s*(kg|g|mg|ml|l|L)\b/,
    /내용량[^0-9]{0,10}(\d+(?:\.\d+)?)\s*(kg|g|mg|ml|l|L)\b/i,
    /규격[^0-9]{0,10}(\d+(?:\.\d+)?)\s*(kg|g|mg|ml|l|L)\b/i,
  ];
  for (const text of texts) {
    const normalized = cleanText(text);
    for (const pattern of rangePatterns) {
      const match = normalized.match(pattern);
      if (match) {
        const average = (Number(match[1]) + Number(match[2])) / 2;
        return {
          supplyWeight: formatNumber(average),
          supplyUnit: normalizeUnit(match[3]),
        };
      }
    }
    for (const pattern of singlePatterns) {
      const match = normalized.match(pattern);
      if (match) {
        return {
          supplyWeight: formatNumber(match[1]),
          supplyUnit: normalizeUnit(match[2]),
        };
      }
    }
  }
  return {
    supplyWeight: "",
    supplyUnit: "",
  };
}

function findChabyulhwaProduct(nextData) {
  const queries = nextData?.props?.pageProps?.trpcState?.json?.queries;
  if (!Array.isArray(queries)) return null;
  const productQuery = queries.find((entry) => entry?.queryKey?.[0]?.[0] === "product" && entry?.queryKey?.[0]?.[1] === "findById");
  return productQuery?.state?.data || null;
}

function looksLikeProductObject(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  const keys = Object.keys(item).map((key) => key.toLowerCase());
  const hasName = keys.includes("name") || keys.includes("productname") || keys.includes("goodsname") || keys.includes("itemname");
  const hasPrice =
    keys.includes("price") ||
    keys.includes("saleprice") ||
    keys.includes("sellprice") ||
    keys.includes("finalprice") ||
    keys.includes("discountedprice") ||
    keys.includes("productprice");
  const hasImage = keys.includes("image") || keys.includes("images") || keys.includes("thumbnail");
  const hasCategory = keys.includes("category") || keys.includes("categoryname");
  return (hasName && hasPrice) || (hasName && hasImage && hasCategory);
}

function findGenericProductObject(objects, title) {
  const normalizedTitle = cleanName(title).toLowerCase();
  const candidates = objects.filter(looksLikeProductObject);
  const scored = candidates.map((item) => {
    const name = cleanText(
      item.name ||
        item.productName ||
        item.goodsName ||
        item.goods_name ||
        item.itemName ||
        item.item_name ||
        item.title ||
        ""
    ).toLowerCase();
    let score = 0;
    if (name && normalizedTitle && name.includes(normalizedTitle)) score += 5;
    if (name && normalizedTitle && normalizedTitle.includes(name)) score += 4;
    if ("price" in item || "salePrice" in item || "sellPrice" in item || "finalPrice" in item) score += 3;
    if ("image" in item || "images" in item || "thumbnail" in item) score += 1;
    if ("category" in item || "categoryName" in item) score += 1;
    return { item, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.item || null;
}

function scorePriceCandidate(value, sourceLabel, context = "") {
  const normalized = normalizePrice(value);
  const numeric = Number(normalized);
  if (!normalized || !Number.isFinite(numeric) || numeric <= 0) return -1;

  let score = 0;
  if (numeric >= 100) score += 2;
  if (numeric >= 1000) score += 2;
  if (sourceLabel === "offers") score += 6;
  if (sourceLabel === "meta") score += 5;
  if (sourceLabel === "object") score += 4;
  if (sourceLabel === "inline") score += 3;
  if (/판매가|할인가|최종가|sale|final|discount/i.test(context)) score += 3;
  if (/정가|소비자가|list|original/i.test(context)) score -= 3;
  if (/배송|적립|쿠폰|리뷰|평점/i.test(context)) score -= 3;
  return score;
}

function pickBestPrice(candidates) {
  const scored = candidates
    .map((candidate) => ({
      ...candidate,
      normalized: normalizePrice(candidate.value),
      score: scorePriceCandidate(candidate.value, candidate.source, candidate.context),
    }))
    .filter((candidate) => candidate.score >= 0);

  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return Number(b.normalized) - Number(a.normalized);
  });
  return scored[0]?.normalized || "";
}

function extractProductData(html, sourceUrl) {
  const nextData = extractNextData(html);
  const nuxtData = extractEmbeddedJsonById(html, "__NUXT_DATA__") || extractEmbeddedJsonById(html, "__NUXT__");
  const apolloData = extractEmbeddedJsonById(html, "__APOLLO_STATE__");
  const chabyulhwaProduct = findChabyulhwaProduct(nextData);
  const jsonLdNodes = extractJsonLd(html);
  const jsonBlocks = parseJsonLikeBlocks(html);
  const title = extractTitle(html);
  const objects = flattenObjects([...jsonLdNodes, ...jsonBlocks, nextData || {}, nuxtData || {}, apolloData || {}, chabyulhwaProduct || {}]);
  const genericProduct = findGenericProductObject(objects, title);
  const productNode = objects.find((node) => {
    const typeValue = node && typeof node === "object" ? node["@type"] : "";
    const types = Array.isArray(typeValue) ? typeValue : [typeValue];
    return types.some((type) => String(type).toLowerCase() === "product");
  });
  const offers = walkOffers(productNode);
  const metaVendor = extractMeta(html, ["og:site_name", "application-name", "twitter:app:name:iphone"]);
  const rawCategory = pickFirstMeaningful([
    chabyulhwaProduct?.category?.management?.name,
    chabyulhwaProduct?.category?.display?.name,
    genericProduct?.category?.name,
    genericProduct?.categoryName,
    genericProduct?.category,
    extractCategory(html, objects),
  ]);
  const category = normalizeCategory(rawCategory, stripTags(html));
  const description = pickFirstMeaningful([
    chabyulhwaProduct?.description,
    genericProduct?.description,
    genericProduct?.summary,
    genericProduct?.shortDescription,
    productNode?.description,
    extractMeta(html, ["description", "og:description", "twitter:description"]),
    findValueInObjects(objects, ["description", "shortDescription", "summary", "itemDescription"]),
  ]);
  const textSamples = [
    productNode?.name,
    productNode?.headline,
    chabyulhwaProduct?.name?.long,
    chabyulhwaProduct?.name?.medium,
    chabyulhwaProduct?.name?.normal,
    genericProduct?.name,
    genericProduct?.productName,
    genericProduct?.goodsName,
    genericProduct?.goods_name,
    genericProduct?.itemName,
    genericProduct?.item_name,
    description,
    title,
    extractMeta(html, ["product:item_name", "item_name", "name", "twitter:title"]),
    findValueInObjects(objects, [
      "productName",
      "goodsName",
      "goods_name",
      "itemName",
      "item_name",
      "displayName",
      "name",
      "title",
    ]),
    ...findAllMatches(html, /<h1[^>]*>([\s\S]*?)<\/h1>/gi),
    ...findAllMatches(html, /(?:\"|\')(?:productName|goods_name|item_name|sale_name)(?:\"|\')\s*:\s*(?:\"|\')([^"']+)(?:\"|\')/gi),
  ];
  const productTitle = pickFirstMeaningful(textSamples, isLikelyProductName) || "제목 없음";

  const hostnameVendor = hostnameToVendor(sourceUrl);
  const rawVendor = pickFirstMeaningful([
    productNode?.brand?.name,
    productNode?.manufacturer?.name,
    productNode?.seller?.name,
    productNode?.brand,
    genericProduct?.sellerName,
    genericProduct?.mallName,
    genericProduct?.brandName,
    metaVendor,
    findValueInObjects(objects, ["sellerName", "brandName", "mallName", "siteName", "companyName", "brand"]),
    titleToVendor(title),
    hostnameVendor,
  ]);

  const objectPriceKeys = [
    "salePrice",
    "sellPrice",
    "discountedPrice",
    "finalPrice",
    "productPrice",
    "price",
    "originPrice",
    "itemPrice",
  ];
  const priceCandidates = [
    { value: chabyulhwaProduct?.price?.discounted, source: "offers", context: "chabyulhwa.discounted" },
    { value: chabyulhwaProduct?.price?.original, source: "offers", context: "chabyulhwa.original" },
    { value: genericProduct?.discountedPrice, source: "object", context: "discountedPrice" },
    { value: genericProduct?.salePrice, source: "object", context: "salePrice" },
    { value: genericProduct?.sellPrice, source: "object", context: "sellPrice" },
    { value: genericProduct?.finalPrice, source: "object", context: "finalPrice" },
    { value: genericProduct?.price, source: "object", context: "price" },
    { value: genericProduct?.productPrice, source: "object", context: "productPrice" },
    { value: offers?.price, source: "offers", context: "offers.price" },
    { value: offers?.lowPrice, source: "offers", context: "offers.lowPrice" },
    {
      value: extractMeta(html, ["product:price:amount", "og:price:amount", "twitter:data1", "price"]),
      source: "meta",
      context: "meta price",
    },
    ...objects.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      return Object.entries(item)
        .filter(([key]) => objectPriceKeys.includes(key))
        .map(([key, value]) => ({
          value: Array.isArray(value) ? value[0] : value,
          source: "object",
          context: key,
        }));
    }),
    ...findMatchObjects(
      html,
      /(?:\"|\')(salePrice|sellPrice|finalPrice|productPrice|originPrice|price)(?:\"|\')\s*:\s*(?:\"|\')?([0-9][0-9,]{2,}(?:\.[0-9]+)?)/gi
    ).map((match) => ({
      value: match.second,
      source: "inline",
      context: match.first,
    })),
    ...findMatchObjects(html, /(판매가|할인가|가격|정가|최종가)[^0-9]{0,20}([0-9][0-9,]{2,}(?:\.[0-9]+)?)/gi).map((match) => ({
      value: match.second,
      source: "inline",
      context: match.first,
    })),
  ];

  const sku = pickFirstMeaningful([
    productNode?.sku,
    genericProduct?.sku,
    genericProduct?.itemCode,
    genericProduct?.productCode,
    extractMeta(html, ["product:retailer_item_id", "sku"]),
    findValueInObjects(objects, ["sku", "itemCode", "productCode", "vendorItemId", "goodsNo"]),
  ]);

  const image = pickFirstMeaningful([
    Array.isArray(chabyulhwaProduct?.images) ? chabyulhwaProduct.images[0] : "",
    chabyulhwaProduct?.thumbnail,
    Array.isArray(genericProduct?.images) ? genericProduct.images[0] : "",
    genericProduct?.thumbnail,
    genericProduct?.image,
    Array.isArray(productNode?.image) ? productNode.image[0] : productNode?.image,
    extractMeta(html, ["og:image", "twitter:image"]),
    findValueInObjects(objects, ["image", "imageUrl", "representImage", "thumbnailUrl"]),
  ]);

  const availability = pickFirstMeaningful([
    chabyulhwaProduct?.isSoldOut ? "OutOfStock" : "InStock",
    genericProduct?.isSoldOut ? "OutOfStock" : "",
    genericProduct?.availability,
    genericProduct?.stockStatus,
    offers?.availability && String(offers.availability).split("/").pop(),
    findValueInObjects(objects, ["availability", "stockStatus", "sellStatNm"]),
  ]);

  const currency = pickFirstMeaningful([
    offers?.priceCurrency,
    genericProduct?.currency,
    genericProduct?.priceCurrency,
    extractMeta(html, ["product:price:currency", "og:price:currency"]),
    findValueInObjects(objects, ["currency", "priceCurrency"]),
  ]) || "KRW";

  const weightInfo = extractWeightAndUnit([
    chabyulhwaProduct?.name?.long,
    chabyulhwaProduct?.name?.weight,
    genericProduct?.weight,
    genericProduct?.spec,
    genericProduct?.capacity,
    productTitle,
    description,
    findValueInObjects(objects, ["unit", "weight", "spec", "content", "capacity"]),
    html,
  ]);

  return {
    sourceUrl,
    title: cleanName(productTitle),
    vendor: cleanName(rawVendor),
    category,
    description,
    sku,
    image,
    price: pickBestPrice(priceCandidates),
    currency,
    availability,
    supplyWeight: weightInfo.supplyWeight,
    supplyUnit: weightInfo.supplyUnit,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeProductUrl(url) {
  const parsed = new URL(url);
  const hostname = parsed.hostname.replace(/^m\./, "").replace(/^www\./, "");

  if (hostname === "smartstore.naver.com") {
    const match = parsed.pathname.match(/^\/([^/]+)\/products\/(\d+)/);
    if (match) {
      return `https://smartstore.naver.com/${match[1]}/products/${match[2]}`;
    }
  }

  if (hostname === "link.coupang.com") {
    const target = parsed.searchParams.get("lptag");
    if (target) return target;
  }

  parsed.search = "";
  return parsed.toString();
}

function buildFetchCandidates(url) {
  const normalized = normalizeProductUrl(url);
  const parsed = new URL(normalized);
  const candidates = [normalized];
  const hostname = parsed.hostname.replace(/^www\./, "");

  if (hostname === "smartstore.naver.com") {
    candidates.push(normalized.replace("https://smartstore.naver.com/", "https://m.smartstore.naver.com/"));
  }

  return [...new Set(candidates)];
}

async function fetchProductPage(url) {
  const candidates = buildFetchCandidates(url);
  let lastError = null;

  for (const candidate of candidates) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(candidate, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
            Referer: new URL(candidate).origin,
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Upgrade-Insecure-Requests": "1",
          },
          redirect: "follow",
        });

        if (response.ok) {
          const html = await response.text();
          return { html, finalUrl: candidate };
        }

        const error = new Error(`FETCH_FAILED:${response.status}`);
        error.status = response.status;
        throw error;
      } catch (error) {
        lastError = error;
        if (error.status === 429 && attempt === 0) {
          await sleep(700);
          continue;
        }
        break;
      }
    }
  }

  throw lastError || new Error("FETCH_FAILED");
}

async function extractFromUrl(url) {
  const { html, finalUrl } = await fetchProductPage(url);
  return extractProductData(html, finalUrl);
}

module.exports = {
  extractFromUrl,
};
