const SCALE = 10000n;
const STORAGE_KEY = "cost-dashboard-state-v1";

function createDefaultStores() {
  return [
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
  ];
}

function createDefaultState() {
  const ingredientId = crypto.randomUUID();
  const menuId = crypto.randomUUID();
  return {
    ingredients: [
      {
        id: ingredientId,
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
        id: menuId,
        name: "시그니처 치킨 스테이크",
        sellingPrice: "16900",
        averagePrice: "16900",
        dailySalesCount: "24",
        totalWeight: "320",
        targetCostRate: "32",
        rows: [
          {
            id: crypto.randomUUID(),
            ingredientId,
            usageWeight: "180",
            usageUnit: "g",
            prepMethod: "해동 후 핏물 제거",
            measureMethod: "그램 계량",
          },
        ],
      },
    ],
    stores: createDefaultStores(),
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
  };
}

const defaultState = createDefaultState();

const elements = {
  storeCards: document.getElementById("storeCards"),
  alertList: document.getElementById("alertList"),
  inventoryStoreSelect: document.getElementById("inventoryStoreSelect"),
  inventoryTableBody: document.getElementById("inventoryTableBody"),
  storeTableBody: document.getElementById("storeTableBody"),
  addStoreButton: document.getElementById("addStoreButton"),
  receiptUpload: document.getElementById("receiptUpload"),
  receiptStatus: document.getElementById("receiptStatus"),
  saleForm: document.getElementById("saleForm"),
  saleStoreSelect: document.getElementById("saleStoreSelect"),
  saleMenuSelect: document.getElementById("saleMenuSelect"),
  salesHistoryBody: document.getElementById("salesHistoryBody"),
  lowStockMetrics: document.getElementById("lowStockMetrics"),
  emptyStateTemplate: document.getElementById("emptyStateTemplate"),
};

let state = hydrateLocalCache();
let activeStoreId = state.stores[0]?.id || null;
let saveTimer = null;
let isBootstrapping = true;
let stagedReceiptNames = [];

function hydrateLocalCache() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return structuredClone(defaultState);
  try {
    const parsed = JSON.parse(saved);
    return {
      ingredients: Array.isArray(parsed.ingredients) ? parsed.ingredients : structuredClone(defaultState.ingredients),
      menus: Array.isArray(parsed.menus) ? parsed.menus : structuredClone(defaultState.menus),
      stores: Array.isArray(parsed.stores) ? parsed.stores : structuredClone(defaultState.stores),
      inventory: Array.isArray(parsed.inventory) ? parsed.inventory : [],
      alerts: Array.isArray(parsed.alerts) ? parsed.alerts : [],
      sales: Array.isArray(parsed.sales) ? parsed.sales : [],
      forecast: { ...defaultState.forecast, ...(parsed.forecast || {}) },
    };
  } catch (error) {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function loadSharedState() {
  const response = await fetch("/api/state");
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message || payload.error || "STATE_LOAD_FAILED");
  }
  return payload.state;
}

async function pushSharedState() {
  const response = await fetch("/api/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message || payload.error || "STATE_SAVE_FAILED");
  }
  state = payload.state;
  saveState();
}

function scheduleSave() {
  if (isBootstrapping) return;
  saveState();
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    try {
      await pushSharedState();
    } catch (error) {
      console.error(error);
    }
  }, 400);
}

function parseScaled(value) {
  const normalized = String(value ?? "").trim().replace(/,/g, "");
  if (!normalized) return 0n;
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [wholeRaw, fractionRaw = ""] = unsigned.split(".");
  const whole = wholeRaw.replace(/\D/g, "") || "0";
  const fraction = `${fractionRaw.replace(/\D/g, "")}0000`.slice(0, 4);
  const scaled = BigInt(whole) * SCALE + BigInt(fraction);
  return negative ? -scaled : scaled;
}

function scaledToNumberString(value, digits = 1) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / SCALE;
  const fraction = String(absolute % SCALE).padStart(4, "0").slice(0, digits);
  return `${negative ? "-" : ""}${whole.toString()}${digits ? `.${fraction}` : ""}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getIngredientById(id) {
  return state.ingredients.find((ingredient) => ingredient.id === id);
}

function getMenuById(id) {
  return state.menus.find((menu) => menu.id === id);
}

function getStoreById(id) {
  return state.stores.find((store) => store.id === id);
}

function ensureSeeds() {
  if (!state.ingredients.length) {
    state.ingredients = structuredClone(defaultState.ingredients);
  }
  if (!state.menus.length) {
    state.menus = structuredClone(defaultState.menus);
  }
  if (!state.stores.length) {
    state.stores = createDefaultStores();
  }
  syncInventoryRecords();
  syncLowStockAlerts();
  activeStoreId = getStoreById(activeStoreId)?.id || state.stores[0]?.id || null;
}

function syncInventoryRecords() {
  const validStoreIds = new Set(state.stores.map((store) => store.id));
  const validIngredientIds = new Set(state.ingredients.map((ingredient) => ingredient.id));
  const recordMap = new Map();

  state.inventory.forEach((record) => {
    if (!validStoreIds.has(record.storeId) || !validIngredientIds.has(record.ingredientId)) return;
    recordMap.set(`${record.storeId}:${record.ingredientId}`, record);
  });

  const nextRecords = [];
  state.stores.forEach((store) => {
    state.ingredients.forEach((ingredient) => {
      const key = `${store.id}:${ingredient.id}`;
      const existing = recordMap.get(key);
      nextRecords.push(
        existing || {
          id: crypto.randomUUID(),
          storeId: store.id,
          ingredientId: ingredient.id,
          currentQuantity: "0",
          safetyStock: "1000",
          reorderQuantity: "2000",
          updatedAt: new Date().toISOString(),
        }
      );
    });
  });
  state.inventory = nextRecords;
}

function syncLowStockAlerts() {
  const openAlerts = new Map(
    state.alerts
      .filter((alert) => alert.status !== "resolved")
      .map((alert) => [`${alert.storeId}:${alert.ingredientId}`, alert])
  );

  state.inventory.forEach((record) => {
    const currentQuantity = parseScaled(record.currentQuantity);
    const safetyStock = parseScaled(record.safetyStock);
    const key = `${record.storeId}:${record.ingredientId}`;
    const existing = openAlerts.get(key);

    if (safetyStock > 0n && currentQuantity <= safetyStock) {
      if (!existing) {
        state.alerts.unshift({
          id: crypto.randomUUID(),
          storeId: record.storeId,
          ingredientId: record.ingredientId,
          channel: "kakao",
          status: "open",
          createdAt: new Date().toISOString(),
        });
      }
      return;
    }

    if (existing) {
      existing.status = "resolved";
      existing.resolvedAt = new Date().toISOString();
    }
  });
}

function getStoreInventory(storeId) {
  return state.inventory
    .filter((record) => record.storeId === storeId)
    .map((record) => ({
      ...record,
      ingredient: getIngredientById(record.ingredientId),
    }))
    .filter((item) => item.ingredient)
    .sort((a, b) => a.ingredient.name.localeCompare(b.ingredient.name, "ko"));
}

function getOpenAlerts(storeId = activeStoreId) {
  return state.alerts
    .filter((alert) => alert.status === "open" && (!storeId || alert.storeId === storeId))
    .map((alert) => ({
      ...alert,
      store: getStoreById(alert.storeId),
      ingredient: getIngredientById(alert.ingredientId),
      inventoryRecord: state.inventory.find(
        (record) => record.storeId === alert.storeId && record.ingredientId === alert.ingredientId
      ),
    }))
    .filter((item) => item.store && item.ingredient);
}

function getLowStockCountsByStore() {
  return state.stores.map((store) => ({
    store,
    lowStockCount: getOpenAlerts(store.id).length,
    itemCount: getStoreInventory(store.id).length,
  }));
}

function renderStoreCards() {
  const cards = getLowStockCountsByStore();
  elements.storeCards.innerHTML = cards
    .map(
      ({ store, lowStockCount, itemCount }) => `
        <button class="store-card ${store.id === activeStoreId ? "active" : ""}" type="button" data-store-card="${store.id}">
          <span class="store-card-name">${escapeHtml(store.name)}</span>
          <strong>${itemCount}개 품목</strong>
          <span class="${lowStockCount ? "negative" : "mini-chart-value"}">부족 재고 ${lowStockCount}건</span>
        </button>
      `
    )
    .join("");
}

function renderLowStockMetrics() {
  const openAlerts = getOpenAlerts();
  const metrics = [
    ["선택 매장", getStoreById(activeStoreId)?.name || "-"],
    ["부족 재고", `${openAlerts.length}건`],
    ["카카오 대상", getStoreById(activeStoreId)?.kakaoTarget || "미등록"],
  ];

  elements.lowStockMetrics.innerHTML = metrics
    .map(
      ([label, value]) => `
        <div class="metric">
          <span class="metric-label">${label}</span>
          <span class="metric-value small">${escapeHtml(value)}</span>
        </div>
      `
    )
    .join("");
}

function renderInventoryStoreSelect() {
  const options = state.stores
    .map((store) => `<option value="${store.id}" ${store.id === activeStoreId ? "selected" : ""}>${escapeHtml(store.name)}</option>`)
    .join("");
  elements.inventoryStoreSelect.innerHTML = options;
  elements.saleStoreSelect.innerHTML = options;
  elements.saleStoreSelect.value = activeStoreId;
}

function renderInventoryTable() {
  const rows = getStoreInventory(activeStoreId);
  if (!rows.length) {
    elements.inventoryTableBody.innerHTML = elements.emptyStateTemplate.innerHTML;
    return;
  }

  elements.inventoryTableBody.innerHTML = rows
    .map((row) => {
      const current = parseScaled(row.currentQuantity);
      const safety = parseScaled(row.safetyStock);
      const status = current <= safety && safety > 0n ? "부족" : "정상";
      return `
        <tr data-record-id="${row.id}">
          <td>${escapeHtml(row.ingredient.name)}</td>
          <td>${escapeHtml(row.ingredient.category || "-")}</td>
          <td><input data-field="currentQuantity" value="${escapeHtml(row.currentQuantity)}" /></td>
          <td><input data-field="safetyStock" value="${escapeHtml(row.safetyStock)}" /></td>
          <td><input data-field="reorderQuantity" value="${escapeHtml(row.reorderQuantity)}" /></td>
          <td>${escapeHtml(row.ingredient.supplyUnit || "g")}</td>
          <td>${escapeHtml(row.ingredient.vendor || "-")}</td>
          <td class="${status === "부족" ? "negative" : "positive"}">${status}</td>
        </tr>
      `;
    })
    .join("");
}

function renderStoreTable() {
  elements.storeTableBody.innerHTML = state.stores
    .map(
      (store) => `
        <tr data-store-id="${store.id}">
          <td><input data-field="name" value="${escapeHtml(store.name)}" /></td>
          <td><input data-field="code" value="${escapeHtml(store.code || "")}" /></td>
          <td><input data-field="manager" value="${escapeHtml(store.manager || "")}" placeholder="담당자" /></td>
          <td><input data-field="kakaoTarget" value="${escapeHtml(store.kakaoTarget || "")}" placeholder="카카오 알림 대상" /></td>
          <td><button class="action-link" data-action="delete">삭제</button></td>
        </tr>
      `
    )
    .join("");
}

function renderAlertList() {
  const alerts = getOpenAlerts();
  if (!alerts.length) {
    elements.alertList.innerHTML = '<div class="empty-cell">부족 재고 알림이 없습니다.</div>';
    return;
  }

  elements.alertList.innerHTML = alerts
    .map((alert) => {
      const record = alert.inventoryRecord;
      return `
        <div class="mini-chart-item">
          <div class="mini-chart-head">
            <span class="mini-chart-label">${escapeHtml(alert.ingredient.name)}</span>
            <strong class="negative">${scaledToNumberString(parseScaled(record?.currentQuantity || "0"), 1)}${escapeHtml(
              alert.ingredient.supplyUnit || "g"
            )}</strong>
          </div>
          <span class="mini-chart-value">${escapeHtml(alert.store.name)} · 안전재고 ${escapeHtml(record?.safetyStock || "0")} ${
            alert.ingredient.supplyUnit || "g"
          }</span>
          <span class="bar-caption">카카오톡 발송 대상: ${escapeHtml(alert.store.kakaoTarget || "미등록")}</span>
        </div>
      `;
    })
    .join("");
}

function renderMenuOptions() {
  elements.saleMenuSelect.innerHTML = state.menus
    .map((menu) => `<option value="${menu.id}">${escapeHtml(menu.name)}</option>`)
    .join("");
}

function renderReceiptStatus() {
  if (!stagedReceiptNames.length) {
    elements.receiptStatus.innerHTML =
      '<div class="status-chip"><span class="status-dot"></span><span>영수증 업로드 대기 중 · OCR 연동 전 단계</span></div>';
    return;
  }

  elements.receiptStatus.innerHTML = stagedReceiptNames
    .map(
      (name) => `
        <div class="status-chip">
          <span class="status-dot success"></span>
          <span>${escapeHtml(name)}</span>
        </div>
      `
    )
    .join("");
}

function renderSalesHistory() {
  if (!state.sales.length) {
    elements.salesHistoryBody.innerHTML = elements.emptyStateTemplate.innerHTML;
    return;
  }

  elements.salesHistoryBody.innerHTML = state.sales
    .slice(0, 12)
    .map((sale) => {
      const store = getStoreById(sale.storeId);
      const menu = getMenuById(sale.menuId);
      return `
        <tr>
          <td>${escapeHtml(new Date(sale.createdAt).toLocaleString("ko-KR"))}</td>
          <td>${escapeHtml(store?.name || "-")}</td>
          <td>${escapeHtml(menu?.name || "-")}</td>
          <td>${escapeHtml(sale.quantity)}</td>
          <td>${escapeHtml((sale.receiptNames || []).join(", ") || "-")}</td>
          <td>${escapeHtml(sale.note || "-")}</td>
        </tr>
      `;
    })
    .join("");
}

function render() {
  ensureSeeds();
  renderStoreCards();
  renderLowStockMetrics();
  renderInventoryStoreSelect();
  renderInventoryTable();
  renderStoreTable();
  renderAlertList();
  renderMenuOptions();
  renderReceiptStatus();
  renderSalesHistory();
  scheduleSave();
}

function updateInventoryRecord(recordId, field, value) {
  const record = state.inventory.find((item) => item.id === recordId);
  if (!record) return;
  record[field] = value;
  record.updatedAt = new Date().toISOString();
  syncLowStockAlerts();
  render();
}

function applySale(storeId, menuId, quantity, note, receiptNames) {
  const menu = getMenuById(menuId);
  if (!menu) return;
  const multiplier = parseScaled(quantity);
  if (multiplier <= 0n) return;

  menu.rows.forEach((row) => {
    const record = state.inventory.find((item) => item.storeId === storeId && item.ingredientId === row.ingredientId);
    if (!record) return;
    const deduction = (parseScaled(row.usageWeight) * multiplier) / SCALE;
    const nextQuantity = parseScaled(record.currentQuantity) - deduction;
    record.currentQuantity = scaledToNumberString(nextQuantity, 1);
    record.updatedAt = new Date().toISOString();
  });

  state.sales.unshift({
    id: crypto.randomUUID(),
    storeId,
    menuId,
    quantity,
    note,
    receiptNames,
    createdAt: new Date().toISOString(),
  });

  syncLowStockAlerts();
  render();
}

elements.storeCards.addEventListener("click", (event) => {
  const button = event.target.closest("[data-store-card]");
  if (!button) return;
  activeStoreId = button.dataset.storeCard;
  render();
});

elements.inventoryStoreSelect.addEventListener("change", (event) => {
  activeStoreId = event.target.value;
  render();
});

elements.inventoryTableBody.addEventListener("change", (event) => {
  const row = event.target.closest("tr[data-record-id]");
  if (!row) return;
  updateInventoryRecord(row.dataset.recordId, event.target.dataset.field, event.target.value);
});

elements.storeTableBody.addEventListener("change", (event) => {
  const row = event.target.closest("tr[data-store-id]");
  if (!row) return;
  const store = getStoreById(row.dataset.storeId);
  if (!store) return;
  store[event.target.dataset.field] = event.target.value;
  render();
});

elements.storeTableBody.addEventListener("click", (event) => {
  if (event.target.dataset.action !== "delete") return;
  const row = event.target.closest("tr[data-store-id]");
  if (!row || state.stores.length <= 1) return;
  const storeId = row.dataset.storeId;
  state.stores = state.stores.filter((store) => store.id !== storeId);
  state.inventory = state.inventory.filter((record) => record.storeId !== storeId);
  state.alerts = state.alerts.filter((alert) => alert.storeId !== storeId);
  state.sales = state.sales.filter((sale) => sale.storeId !== storeId);
  activeStoreId = state.stores[0]?.id || null;
  render();
});

elements.addStoreButton.addEventListener("click", () => {
  state.stores.push({
    id: crypto.randomUUID(),
    name: `신규 매장 ${state.stores.length + 1}`,
    code: `STORE-0${state.stores.length + 1}`,
    manager: "",
    kakaoTarget: "",
  });
  syncInventoryRecords();
  activeStoreId = state.stores[state.stores.length - 1].id;
  render();
});

elements.receiptUpload.addEventListener("change", (event) => {
  stagedReceiptNames = Array.from(event.target.files || []).map((file) => file.name);
  renderReceiptStatus();
});

elements.saleForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const storeId = String(formData.get("storeId") || "");
  const menuId = String(formData.get("menuId") || "");
  const quantity = String(formData.get("quantity") || "0");
  const note = String(formData.get("note") || "");
  applySale(storeId, menuId, quantity, note, stagedReceiptNames);
  stagedReceiptNames = [];
  event.currentTarget.reset();
  elements.saleStoreSelect.value = activeStoreId;
  renderReceiptStatus();
});

async function boot() {
  try {
    const remoteState = await loadSharedState();
    state = {
      ingredients: Array.isArray(remoteState.ingredients) ? remoteState.ingredients : structuredClone(defaultState.ingredients),
      menus: Array.isArray(remoteState.menus) ? remoteState.menus : structuredClone(defaultState.menus),
      stores: Array.isArray(remoteState.stores) ? remoteState.stores : structuredClone(defaultState.stores),
      inventory: Array.isArray(remoteState.inventory) ? remoteState.inventory : [],
      alerts: Array.isArray(remoteState.alerts) ? remoteState.alerts : [],
      sales: Array.isArray(remoteState.sales) ? remoteState.sales : [],
      forecast: { ...defaultState.forecast, ...(remoteState.forecast || {}) },
    };
    activeStoreId = state.stores[0]?.id || null;
  } catch (error) {
    console.error(error);
  } finally {
    isBootstrapping = false;
    render();
  }
}

render();
boot();
