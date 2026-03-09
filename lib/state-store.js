const fs = require("fs/promises");
const path = require("path");
const { get, put } = require("@vercel/blob");

const LOCAL_DATA_DIR = path.join(process.cwd(), ".data");
const LOCAL_STATE_FILE = path.join(LOCAL_DATA_DIR, "shared-state.json");
const BLOB_PATHNAME = "cost-dashboard/shared-state.json";

const defaultState = {
  ingredients: [],
  menus: [],
  stores: [],
  inventory: [],
  alerts: [],
  sales: [],
  forecast: {
    rent: "1800000",
    management: "250000",
    labor: "3200000",
    marketing: "300000",
    ads: "200000",
    otherFixed: "150000",
    platformFeeRate: "8.5",
    cardFeeRate: "3",
    initialInvestment: "30000000",
    depreciationMonths: "36",
  },
  updatedAt: null,
};

function createSeedState() {
  return {
    ingredients: [
      {
        id: crypto.randomUUID(),
        name: "닭다리살",
        category: "육류",
        link: "",
        supplyWeight: "2000",
        supplyUnit: "g",
        supplyPrice: "18500",
        vatRate: "10",
        vendor: "기본 공급처",
        prepMethod: "해동 후 핏물 제거",
        measureMethod: "그램 계량",
      },
    ],
    menus: [
      {
        id: crypto.randomUUID(),
        name: "시그니처 치킨 스테이크",
        sellingPrice: "16900",
        averagePrice: "16900",
        dailySalesCount: "24",
        totalWeight: "320",
        targetCostRate: "32",
        rows: [],
      },
    ],
    forecast: { ...defaultState.forecast },
    stores: [
      {
        id: crypto.randomUUID(),
        name: "1호점",
        code: "STORE-01",
        manager: "",
        kakaoTarget: "",
      },
      {
        id: crypto.randomUUID(),
        name: "2호점",
        code: "STORE-02",
        manager: "",
        kakaoTarget: "",
      },
    ],
    inventory: [],
    alerts: [],
    sales: [],
    updatedAt: new Date().toISOString(),
  };
}

async function ensureLocalDir() {
  await fs.mkdir(LOCAL_DATA_DIR, { recursive: true });
}

function hasBlobConfig() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function normalizeState(input) {
  const next = input && typeof input === "object" ? input : {};
  return {
    ingredients: Array.isArray(next.ingredients) ? next.ingredients : [],
    menus: Array.isArray(next.menus) ? next.menus : [],
    stores: Array.isArray(next.stores) ? next.stores : [],
    inventory: Array.isArray(next.inventory) ? next.inventory : [],
    alerts: Array.isArray(next.alerts) ? next.alerts : [],
    sales: Array.isArray(next.sales) ? next.sales : [],
    forecast: { ...defaultState.forecast, ...(next.forecast || {}) },
    updatedAt: new Date().toISOString(),
  };
}

async function readLocalState() {
  try {
    const raw = await fs.readFile(LOCAL_STATE_FILE, "utf8");
    return normalizeState(JSON.parse(raw));
  } catch (error) {
    return null;
  }
}

async function writeLocalState(state) {
  await ensureLocalDir();
  await fs.writeFile(LOCAL_STATE_FILE, JSON.stringify(normalizeState(state), null, 2), "utf8");
}

async function readBlobState() {
  const result = await get(BLOB_PATHNAME, {
    access: "private",
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });

  if (!result || result.statusCode !== 200 || !result.stream) {
    return null;
  }

  const raw = await new Response(result.stream).text();
  return normalizeState(JSON.parse(raw));
}

async function writeBlobState(state) {
  const payload = JSON.stringify(normalizeState(state), null, 2);
  await put(BLOB_PATHNAME, payload, {
    access: "private",
    token: process.env.BLOB_READ_WRITE_TOKEN,
    contentType: "application/json; charset=utf-8",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

async function getSharedState() {
  const remoteState = hasBlobConfig() ? await readBlobState() : null;
  if (remoteState) return remoteState;

  const localState = await readLocalState();
  if (localState) return localState;

  const seed = createSeedState();
  await writeLocalState(seed);
  if (hasBlobConfig()) {
    await writeBlobState(seed);
  }
  return normalizeState(seed);
}

async function saveSharedState(state) {
  const normalized = normalizeState(state);
  await writeLocalState(normalized);
  if (hasBlobConfig()) {
    await writeBlobState(normalized);
  }
  return normalized;
}

module.exports = {
  getSharedState,
  saveSharedState,
  normalizeState,
};
