const SCALE = 10000n;
const STORAGE_KEY = "cost-dashboard-state-v1";
const DAYS_IN_MONTH = 30n;

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

const defaultState = {
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
  stores: createDefaultStores(),
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

const elements = {
  tabs: document.querySelectorAll(".tab-button"),
  panels: document.querySelectorAll(".tab-panel"),
  overviewNarrative: document.getElementById("overviewNarrative"),
  overviewMetrics: document.getElementById("overviewMetrics"),
  menuContributionChart: document.getElementById("menuContributionChart"),
  ingredientsStats: document.getElementById("ingredientsStats"),
  extractStatus: document.getElementById("extractStatus"),
  ingredientsTableBody: document.getElementById("ingredientsTableBody"),
  csvUpload: document.getElementById("csvUpload"),
  analyzeAllButton: document.getElementById("analyzeAllButton"),
  addIngredientButton: document.getElementById("addIngredientButton"),
  menuSelect: document.getElementById("menuSelect"),
  addMenuButton: document.getElementById("addMenuButton"),
  addRecipeRowButton: document.getElementById("addRecipeRowButton"),
  menuMetaFields: document.getElementById("menuMetaFields"),
  costingTopMetrics: document.getElementById("costingTopMetrics"),
  menuMetrics: document.getElementById("menuMetrics"),
  recipeTableBody: document.getElementById("recipeTableBody"),
  forecastFields: document.getElementById("forecastFields"),
  forecastSummaryBar: document.getElementById("forecastSummaryBar"),
  forecastTableBody: document.getElementById("forecastTableBody"),
  forecastMetrics: document.getElementById("forecastMetrics"),
  forecastBarMetrics: document.getElementById("forecastBarMetrics"),
  aiHelpButton: document.getElementById("aiHelpButton"),
  assistantPanel: document.getElementById("assistantPanel"),
  assistantCloseButton: document.getElementById("assistantCloseButton"),
  assistantMessages: document.getElementById("assistantMessages"),
  assistantForm: document.getElementById("assistantForm"),
  assistantInput: document.getElementById("assistantInput"),
  emptyStateTemplate: document.getElementById("emptyStateTemplate"),
};

let state = hydrateLocalCache();
let activeMenuId = state.menus[0]?.id || null;
let saveTimer = null;
let isBootstrapping = true;
let extractStatus = { tone: "idle", message: "링크 분석 대기 중" };
let assistantMessages = [
  {
    role: "bot",
    text: "원가율, 적정 판매가, 영업이익, 손익분기에 대해 물어보면 현재 데이터 기준으로 계산해서 답합니다.",
  },
];

function hydrateLocalCache() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return structuredClone(defaultState);
  try {
    const parsed = JSON.parse(saved);
    return {
      ingredients: parsed.ingredients || structuredClone(defaultState.ingredients),
      menus: parsed.menus || structuredClone(defaultState.menus),
      stores: parsed.stores || structuredClone(defaultState.stores),
      forecast: { ...defaultState.forecast, ...(parsed.forecast || {}) },
    };
  } catch (error) {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function ensureSeedRows() {
  if (!state.menus.length) {
    state.menus = structuredClone(defaultState.menus);
  }
  if (!state.ingredients.length) {
    state.ingredients = structuredClone(defaultState.ingredients);
  }
  if (!state.stores.length) {
    state.stores = createDefaultStores();
  }
  if (!state.menus[0].rows.length && state.ingredients[0]) {
    state.menus[0].rows.push({
      id: crypto.randomUUID(),
      ingredientId: state.ingredients[0].id,
      usageWeight: "180",
      usageUnit: "g",
      prepMethod: state.ingredients[0].prepMethod,
      measureMethod: state.ingredients[0].measureMethod,
    });
  }
  activeMenuId = state.menus[0]?.id || activeMenuId;
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
  const snapshot = JSON.parse(JSON.stringify(state));
  const response = await fetch("/api/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state: snapshot }),
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
      activeMenuId = getActiveMenu()?.id || activeMenuId;
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

function scaledToNumberString(value, digits = 2) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / SCALE;
  const fraction = String(absolute % SCALE).padStart(4, "0").slice(0, digits);
  return `${negative ? "-" : ""}${whole.toString()}${digits ? `.${fraction}` : ""}`;
}

function formatCurrency(value) {
  const won = Number(value / SCALE);
  return `${won.toLocaleString("ko-KR")}원`;
}

function formatPercent(value) {
  return `${scaledToNumberString(value, 2)}%`;
}

function formatRatio(value, base) {
  if (base <= 0n) return "0.00%";
  return formatPercent(divideScaled(value, base) * 100n);
}

function multiplyScaled(a, b) {
  return (a * b) / SCALE;
}

function divideScaled(a, b) {
  if (b === 0n) return 0n;
  return (a * SCALE) / b;
}

function getIngredientById(id) {
  return state.ingredients.find((ingredient) => ingredient.id === id);
}

function getActiveMenu() {
  return state.menus.find((menu) => menu.id === activeMenuId) || state.menus[0];
}

function getIngredientFinancials(ingredient) {
  const supplyWeight = parseScaled(ingredient.supplyWeight);
  const grossSupplyPrice = parseScaled(ingredient.supplyPrice);
  const vatRate = parseScaled(ingredient.vatRate);
  const divisor = SCALE + divideScaled(vatRate, parseScaled(100));
  const netSupplyPrice = divideScaled(grossSupplyPrice, divisor);
  const vatAmount = grossSupplyPrice - netSupplyPrice;
  const unitNetPrice = supplyWeight === 0n ? 0n : divideScaled(netSupplyPrice, supplyWeight);
  const unitGrossPrice = supplyWeight === 0n ? 0n : divideScaled(grossSupplyPrice, supplyWeight);

  return {
    supplyWeight,
    grossSupplyPrice,
    vatRate,
    netSupplyPrice,
    vatAmount,
    unitNetPrice,
    unitGrossPrice,
  };
}

function getMenuCostSummary(menu) {
  const rows = menu.rows.map((row) => {
    const ingredient = getIngredientById(row.ingredientId);
    if (!ingredient) {
      return {
        ...row,
        ingredient: null,
        rowCost: 0n,
        rowVat: 0n,
        unitNetPrice: 0n,
      };
    }
    const ingredientFinancials = getIngredientFinancials(ingredient);
    const usageWeight = parseScaled(row.usageWeight);
    const rowCost = multiplyScaled(usageWeight, ingredientFinancials.unitNetPrice);
    const rowVat = multiplyScaled(usageWeight, divideScaled(ingredientFinancials.vatAmount, ingredientFinancials.supplyWeight || SCALE));
    return {
      ...row,
      ingredient,
      usageWeight,
      rowCost,
      rowVat,
      unitNetPrice: ingredientFinancials.unitNetPrice,
      ingredientFinancials,
    };
  });

  const totalCost = rows.reduce((sum, row) => sum + row.rowCost, 0n);
  const totalVat = rows.reduce((sum, row) => sum + row.rowVat, 0n);
  const sellingPrice = parseScaled(menu.sellingPrice);
  const grossProfit = sellingPrice - totalCost;
  const costRate = sellingPrice === 0n ? 0n : divideScaled(totalCost, sellingPrice) * 100n;
  const profitRate = sellingPrice === 0n ? 0n : divideScaled(grossProfit, sellingPrice) * 100n;
  const totalWeight = rows.reduce((sum, row) => sum + row.usageWeight, 0n);

  return {
    rows,
    totalCost,
    totalVat,
    sellingPrice,
    grossProfit,
    costRate,
    profitRate,
    totalWeight,
  };
}

function getForecastSummary() {
  const platformFeeRate = parseScaled(state.forecast.platformFeeRate);
  const cardFeeRate = parseScaled(state.forecast.cardFeeRate);
  const totalRevenue = state.menus.reduce((sum, menu) => {
    const quantity = parseScaled(menu.dailySalesCount);
    const averagePrice = parseScaled(menu.averagePrice || menu.sellingPrice);
    return sum + multiplyScaled(quantity, averagePrice);
  }, 0n);
  const totalMonthlyRevenue = totalRevenue * DAYS_IN_MONTH;

  const totalMonthlyFoodCost = state.menus.reduce((sum, menu) => {
    const quantity = parseScaled(menu.dailySalesCount);
    const monthlyQuantity = quantity * DAYS_IN_MONTH;
    return sum + multiplyScaled(monthlyQuantity, getMenuCostSummary(menu).totalCost);
  }, 0n);

  const fixedCostKeys = ["rent", "management", "labor", "marketing", "ads", "otherFixed"];
  const fixedCosts = fixedCostKeys.reduce((sum, key) => sum + parseScaled(state.forecast[key]), 0n);
  const depreciation =
    parseScaled(state.forecast.depreciationMonths) === 0n
      ? 0n
      : divideScaled(parseScaled(state.forecast.initialInvestment), parseScaled(state.forecast.depreciationMonths));
  const platformFee = multiplyScaled(totalMonthlyRevenue, divideScaled(platformFeeRate, parseScaled(100)));
  const cardFee = multiplyScaled(totalMonthlyRevenue, divideScaled(cardFeeRate, parseScaled(100)));
  const operatingProfit = totalMonthlyRevenue - totalMonthlyFoodCost - fixedCosts - depreciation - platformFee - cardFee;
  const operatingMargin = totalMonthlyRevenue === 0n ? 0n : divideScaled(operatingProfit, totalMonthlyRevenue) * 100n;

  const contributionPerDay = totalRevenue === 0n ? 0n : totalRevenue - divideScaled(totalMonthlyFoodCost, DAYS_IN_MONTH);
  const breakEvenDays = contributionPerDay <= 0n ? 0n : divideScaled(fixedCosts + depreciation, contributionPerDay);

  return {
    totalRevenue,
    totalMonthlyRevenue,
    totalMonthlyFoodCost,
    fixedCosts,
    depreciation,
    platformFee,
    cardFee,
    operatingProfit,
    operatingMargin,
    breakEvenDays,
  };
}

function renderOverview() {
  const activeMenu = getActiveMenu();
  const menuSummary = activeMenu ? getMenuCostSummary(activeMenu) : null;
  const forecastSummary = getForecastSummary();
  const averageMenuPrice =
    state.menus.length === 0
      ? 0n
      : state.menus.reduce((sum, menu) => sum + parseScaled(menu.averagePrice || menu.sellingPrice), 0n) / BigInt(state.menus.length);

  elements.overviewNarrative.textContent = activeMenu
    ? `${escapeHtml(activeMenu.name)} 원가율은 ${formatPercent(menuSummary.costRate)}이고, 현재 월 영업이익 예상은 ${formatCurrency(
        forecastSummary.operatingProfit
      )}입니다.`
    : `식자재를 등록하면 메뉴 원가와 매출 예측이 자동 계산됩니다.`;

  const cards = [
    {
      tone: "primary",
      title: "월 예상 매출",
      value: formatCurrency(forecastSummary.totalMonthlyRevenue),
      foot: "일 판매량 x 평균 가격 x 30일",
    },
    {
      tone: "success",
      title: "월 영업이익",
      value: formatCurrency(forecastSummary.operatingProfit),
      foot: `영업이익률 ${formatPercent(forecastSummary.operatingMargin)}`,
    },
    {
      tone: "warning",
      title: "손익분기 예상",
      value: `${scaledToNumberString(forecastSummary.breakEvenDays, 1)}일`,
      foot: menuSummary
        ? `${activeMenu.name} 원가율 ${formatPercent(menuSummary.costRate)}`
        : `평균 판매가 ${formatCurrency(averageMenuPrice)}`,
    },
  ];

  elements.overviewMetrics.innerHTML = cards
    .map(
      (card) => `
      <article class="overview-card ${card.tone}">
        <span class="overview-title">${card.title}</span>
        <strong class="overview-value">${card.value}</strong>
        <span class="overview-foot">${card.foot}</span>
      </article>
    `
    )
    .join("");
}

function clampPercentString(value) {
  const raw = Number(scaledToNumberString(value, 2));
  return `${Math.max(0, Math.min(100, raw))}%`;
}

function percentWidth(amount, base) {
  if (amount <= 0n || base <= 0n) return "0%";
  return clampPercentString(divideScaled(amount, base) * 100n);
}

function renderContributionChart() {
  if (!state.menus.length) {
    elements.menuContributionChart.innerHTML = '<div class="empty-cell">메뉴 데이터가 없습니다.</div>';
    return;
  }
  const items = state.menus.map((menu) => {
    const summary = getMenuCostSummary(menu);
    const dailySalesCount = parseScaled(menu.dailySalesCount);
    const averagePrice = parseScaled(menu.averagePrice || menu.sellingPrice);
    const monthlyRevenue = multiplyScaled(dailySalesCount, averagePrice) * DAYS_IN_MONTH;
    const monthlyFoodCost = multiplyScaled(summary.totalCost, dailySalesCount * DAYS_IN_MONTH);
    const contribution = monthlyRevenue - monthlyFoodCost;
    return { menu, contribution };
  });
  const max = items.reduce((current, item) => (item.contribution > current ? item.contribution : current), 0n);
  elements.menuContributionChart.innerHTML = items
    .sort((a, b) => (a.contribution === b.contribution ? 0 : a.contribution > b.contribution ? -1 : 1))
    .slice(0, 4)
    .map(
      (item) => `
        <div class="mini-chart-item">
          <div class="mini-chart-head">
            <span class="mini-chart-label">${escapeHtml(item.menu.name)}</span>
            <strong>${formatCurrency(item.contribution)}</strong>
          </div>
          <div class="bar-track"><div class="bar-fill success" style="width:${percentWidth(item.contribution, max || SCALE)}"></div></div>
          <span class="mini-chart-value">월 기여이익 기준 비교</span>
        </div>
      `
    )
    .join("");
}

function renderIngredientStats() {
  const linkedCount = state.ingredients.filter((ingredient) => ingredient.link).length;
  const pricedCount = state.ingredients.filter((ingredient) => parseScaled(ingredient.supplyPrice) > 0n).length;
  const avgVat =
    state.ingredients.length === 0
      ? 0n
      : state.ingredients.reduce((sum, ingredient) => sum + parseScaled(ingredient.vatRate), 0n) / BigInt(state.ingredients.length);

  const metrics = [
    ["등록 품목", `${state.ingredients.length}개`],
    ["링크 연결", `${linkedCount}개`],
    ["가격 입력", `${pricedCount}개`],
    ["평균 부가세", formatPercent(avgVat)],
  ];

  elements.ingredientsStats.innerHTML = metrics
    .map(
      ([label, value]) => `
      <div class="metric">
        <span class="metric-label">${label}</span>
        <span class="metric-value">${value}</span>
      </div>
    `
    )
    .join("");

  const toneClass =
    extractStatus.tone === "success" ? "success" : extractStatus.tone === "error" ? "error" : "";
  elements.extractStatus.innerHTML = `
    <div class="status-chip">
      <span class="status-dot ${toneClass}"></span>
      <span>${escapeHtml(extractStatus.message)}</span>
    </div>
  `;
}

function renderIngredients() {
  if (!state.ingredients.length) {
    elements.ingredientsTableBody.innerHTML = elements.emptyStateTemplate.innerHTML;
    return;
  }

  elements.ingredientsTableBody.innerHTML = state.ingredients
    .map((ingredient) => {
      return `
        <tr data-ingredient-id="${ingredient.id}">
          <td><input data-field="name" value="${escapeHtml(ingredient.name)}" /></td>
          <td><input data-field="category" value="${escapeHtml(ingredient.category)}" /></td>
          <td><input data-field="link" value="${escapeHtml(ingredient.link)}" placeholder="https://..." /></td>
          <td><input data-field="supplyWeight" value="${escapeHtml(ingredient.supplyWeight)}" /></td>
          <td><input data-field="supplyUnit" value="${escapeHtml(ingredient.supplyUnit)}" /></td>
          <td><input data-field="supplyPrice" value="${escapeHtml(ingredient.supplyPrice)}" /></td>
          <td><input data-field="vatRate" value="${escapeHtml(ingredient.vatRate)}" /></td>
          <td><input data-field="vendor" value="${escapeHtml(ingredient.vendor)}" /></td>
          <td><input data-field="prepMethod" value="${escapeHtml(ingredient.prepMethod)}" /></td>
          <td><input data-field="measureMethod" value="${escapeHtml(ingredient.measureMethod)}" /></td>
          <td>
            <button class="action-link" data-action="analyze">링크 분석</button>
            <button class="action-link" data-action="delete">삭제</button>
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderMenuSelector() {
  elements.menuSelect.innerHTML = state.menus
    .map((menu) => `<option value="${menu.id}" ${menu.id === activeMenuId ? "selected" : ""}>${escapeHtml(menu.name)}</option>`)
    .join("");
}

function renderMenuMeta() {
  const menu = getActiveMenu();
  if (!menu) {
    elements.menuMetaFields.innerHTML = "";
    return;
  }
  const fields = [
    ["name", "메뉴명"],
    ["sellingPrice", "판매가격"],
    ["averagePrice", "평균가격"],
    ["dailySalesCount", "일 판매량"],
    ["targetCostRate", "목표 원가율"],
    ["totalWeight", "목표 총중량"],
  ];
  elements.menuMetaFields.innerHTML = fields
    .map(
      ([key, label]) => `
        <div class="field">
          <label>${label}</label>
          <input data-menu-field="${key}" value="${escapeHtml(menu[key] || "")}" />
        </div>
      `
    )
    .join("");
}

function renderMenuMetrics() {
  const menu = getActiveMenu();
  if (!menu) {
    elements.menuMetrics.innerHTML = "";
    return;
  }
  const summary = getMenuCostSummary(menu);
  const metrics = [
    ["총 원가", formatCurrency(summary.totalCost)],
    ["총 부가세", formatCurrency(summary.totalVat)],
    ["원가율", formatPercent(summary.costRate)],
    ["판매수익", formatCurrency(summary.grossProfit)],
    ["판매수익율", formatPercent(summary.profitRate)],
    ["총중량", `${scaledToNumberString(summary.totalWeight, 1)}${menu.rows[0]?.usageUnit || "g"}`],
  ];
  elements.menuMetrics.innerHTML = metrics
    .map(
      ([label, value]) => `
        <div class="strip-item">
          <span class="metric-label">${label}</span>
          <span class="metric-value">${value}</span>
        </div>
      `
    )
    .join("");
}

function renderCostingTopMetrics() {
  const menu = getActiveMenu();
  if (!menu) {
    elements.costingTopMetrics.innerHTML = "";
    return;
  }
  const summary = getMenuCostSummary(menu);
  const targetRate = parseScaled(menu.targetCostRate);
  const gap = summary.costRate - targetRate;
  const metrics = [
    ["메뉴명", menu.name],
    ["목표 원가율", formatPercent(targetRate)],
    ["현재 원가율", formatPercent(summary.costRate)],
    ["목표 대비 차이", formatPercent(gap)],
    ["판매수익", formatCurrency(summary.grossProfit)],
    ["총중량", `${scaledToNumberString(summary.totalWeight, 1)}${menu.rows[0]?.usageUnit || "g"}`],
  ];

  elements.costingTopMetrics.innerHTML = metrics
    .map(
      ([label, value]) => `
      <div class="metric">
        <span class="metric-label">${label}</span>
        <span class="metric-value">${value}</span>
      </div>
    `
    )
    .join("");
}

function renderRecipeRows() {
  const menu = getActiveMenu();
  if (!menu || !menu.rows.length) {
    elements.recipeTableBody.innerHTML = elements.emptyStateTemplate.innerHTML;
    return;
  }
  const summary = getMenuCostSummary(menu);

  elements.recipeTableBody.innerHTML = summary.rows
    .map((row) => {
      const ingredientOptions = state.ingredients
        .map(
          (ingredient) =>
            `<option value="${ingredient.id}" ${ingredient.id === row.ingredientId ? "selected" : ""}>${escapeHtml(ingredient.name)}</option>`
        )
        .join("");
      const ratio = summary.totalCost === 0n ? 0n : divideScaled(row.rowCost, summary.totalCost) * 100n;
      return `
        <tr data-row-id="${row.id}">
          <td><select data-row-field="ingredientId">${ingredientOptions}</select></td>
          <td>${row.ingredient ? scaledToNumberString(parseScaled(row.ingredient.supplyWeight), 1) : "0.0"}</td>
          <td>${escapeHtml(row.ingredient?.supplyUnit || "-")}</td>
          <td>${formatCurrency(row.unitNetPrice)}</td>
          <td>${formatCurrency(row.rowVat)}</td>
          <td><input data-row-field="usageWeight" value="${escapeHtml(row.usageWeight)}" /></td>
          <td><input data-row-field="usageUnit" value="${escapeHtml(row.usageUnit)}" /></td>
          <td>${formatCurrency(row.rowCost)}</td>
          <td>${formatPercent(ratio)}</td>
          <td><input data-row-field="prepMethod" value="${escapeHtml(row.prepMethod)}" /></td>
          <td><input data-row-field="measureMethod" value="${escapeHtml(row.measureMethod)}" /></td>
          <td><button class="action-link" data-row-action="delete">삭제</button></td>
        </tr>
      `;
    })
    .join("");
}

function renderForecastFields() {
  const entries = [
    ["rent", "임대료"],
    ["management", "관리비"],
    ["labor", "인건비"],
    ["marketing", "마케팅비"],
    ["ads", "광고비"],
    ["otherFixed", "기타 고정지출"],
    ["platformFeeRate", "플랫폼 수수료%"],
    ["cardFeeRate", "카드 수수료%"],
    ["initialInvestment", "초기 투자 비용"],
    ["depreciationMonths", "감가상각 개월"],
  ];
  elements.forecastFields.innerHTML = entries
    .map(
      ([key, label]) => `
        <div class="field">
          <label>${label}</label>
          <input data-forecast-field="${key}" value="${escapeHtml(state.forecast[key])}" />
        </div>
      `
    )
    .join("");
}

function renderForecastTable() {
  if (!state.menus.length) {
    elements.forecastTableBody.innerHTML = elements.emptyStateTemplate.innerHTML;
    return;
  }
  elements.forecastTableBody.innerHTML = state.menus
    .map((menu) => {
      const summary = getMenuCostSummary(menu);
      const dailySalesCount = parseScaled(menu.dailySalesCount);
      const averagePrice = parseScaled(menu.averagePrice || menu.sellingPrice);
      const dailyRevenue = multiplyScaled(dailySalesCount, averagePrice);
      const monthlyRevenue = dailyRevenue * DAYS_IN_MONTH;
      const monthlyFoodCost = multiplyScaled(summary.totalCost, dailySalesCount * DAYS_IN_MONTH);
      const contribution = monthlyRevenue - monthlyFoodCost;
      return `
        <tr>
          <td>${escapeHtml(menu.name)}</td>
          <td>${escapeHtml(menu.dailySalesCount)}</td>
          <td>${formatCurrency(averagePrice)}</td>
          <td>${formatCurrency(dailyRevenue)}</td>
          <td>${formatCurrency(monthlyRevenue)}</td>
          <td>${formatCurrency(monthlyFoodCost)}</td>
          <td class="${contribution >= 0n ? "positive" : "negative"}">${formatCurrency(contribution)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderForecastMetrics() {
  const summary = getForecastSummary();
  const metrics = [
    ["월 식자재 원가", formatCurrency(summary.totalMonthlyFoodCost)],
    ["월 고정지출", formatCurrency(summary.fixedCosts + summary.depreciation)],
    ["월 결제 수수료", formatCurrency(summary.platformFee + summary.cardFee)],
    ["영업이익률", formatPercent(summary.operatingMargin)],
    ["하루 평균 이익", formatCurrency(divideScaled(summary.operatingProfit, DAYS_IN_MONTH))],
  ];

  elements.forecastMetrics.innerHTML = metrics
    .map(
      ([label, value]) => `
      <div class="metric">
        <span class="metric-label">${label}</span>
        <span class="metric-value">${value}</span>
      </div>
    `
    )
    .join("");
}

function renderForecastBars() {
  const summary = getForecastSummary();
  const base = summary.totalMonthlyRevenue > 0n ? summary.totalMonthlyRevenue : SCALE;
  const items = [
    ["식자재 원가", summary.totalMonthlyFoodCost, "warn", "월 매출 대비"],
    ["고정지출", summary.fixedCosts + summary.depreciation, "", "임대료/인건비/감가상각 포함"],
    ["결제 수수료", summary.platformFee + summary.cardFee, "", "플랫폼 + 카드"],
    ["영업이익", summary.operatingProfit > 0n ? summary.operatingProfit : 0n, "success", "남는 이익"],
  ];

  elements.forecastBarMetrics.innerHTML = items
    .map(
      ([label, amount, tone, caption]) => `
        <div class="bar-metric">
          <div class="bar-metric-head">
            <span class="metric-label">${label}</span>
            <strong>${formatCurrency(amount)}</strong>
          </div>
          <div class="bar-track"><div class="bar-fill ${tone}" style="width:${percentWidth(amount, base)}"></div></div>
          <span class="bar-caption">${caption} · ${formatRatio(amount, base)}</span>
        </div>
      `
    )
    .join("");
}

function renderAssistantMessages() {
  elements.assistantMessages.innerHTML = assistantMessages
    .map(
      (message) => `
        <div class="assistant-bubble ${message.role}">
          ${escapeHtml(message.text).replace(/\n/g, "<br />")}
        </div>
      `
    )
    .join("");
  elements.assistantMessages.scrollTop = elements.assistantMessages.scrollHeight;
}

function renderForecastSummaryBar() {
  const summary = getForecastSummary();
  const metrics = [
    ["일 매출", formatCurrency(summary.totalRevenue)],
    ["월 매출", formatCurrency(summary.totalMonthlyRevenue)],
    ["월 영업이익", formatCurrency(summary.operatingProfit)],
    ["일 평균 이익", formatCurrency(divideScaled(summary.operatingProfit, DAYS_IN_MONTH))],
    ["손익분기", `${scaledToNumberString(summary.breakEvenDays, 1)}일`],
  ];

  elements.forecastSummaryBar.innerHTML = metrics
    .map(
      ([label, value]) => `
      <div class="metric">
        <span class="metric-label">${label}</span>
        <span class="metric-value">${value}</span>
      </div>
    `
    )
    .join("");
}

function render(options = {}) {
  const { persist = true } = options;
  ensureSeedRows();
  renderOverview();
  renderContributionChart();
  renderIngredientStats();
  renderIngredients();
  renderMenuSelector();
  renderMenuMeta();
  renderCostingTopMetrics();
  renderMenuMetrics();
  renderRecipeRows();
  renderForecastFields();
  renderForecastSummaryBar();
  renderForecastTable();
  renderForecastMetrics();
  renderForecastBars();
  renderAssistantMessages();
  if (persist) {
    scheduleSave();
  } else {
    saveState();
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function switchTab(targetId) {
  elements.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === targetId));
  elements.panels.forEach((panel) => panel.classList.toggle("active", panel.id === targetId));
}

async function analyzeIngredient(ingredientId) {
  const ingredient = getIngredientById(ingredientId);
  if (!ingredient?.link) return;
  try {
    extractStatus = { tone: "idle", message: `${ingredient.name || "선택 품목"} 링크 분석 중` };
    render({ persist: false });
    const response = await fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: ingredient.link }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || data.error);
    if (isMeaningfulValue(data.product.title)) {
      ingredient.name = data.product.title;
    }
    if (isMeaningfulValue(data.product.vendor)) {
      ingredient.vendor = data.product.vendor;
    }
    if (isMeaningfulValue(data.product.price)) {
      ingredient.supplyPrice = normalizePriceValue(data.product.price);
    }
    extractStatus = {
      tone: "success",
      message: `${ingredient.name || "품목"} 분석 완료 · 공급처 ${ingredient.vendor || "미확인"}${
        ingredient.supplyPrice ? ` · 가격 ${ingredient.supplyPrice}원` : ""
      }`,
    };
    render();
  } catch (error) {
    extractStatus = { tone: "error", message: "링크 분석 실패 · 접근 제한 또는 상품 정보 부족" };
    render({ persist: false });
    window.alert(`링크 분석 실패: ${error.message}`);
  }
}

function parseCsv(text) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(current);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      current = "";
    } else {
      current += char;
    }
  }

  if (current || row.length) {
    row.push(current);
    rows.push(row);
  }

  const [header, ...dataRows] = rows;
  return dataRows.map((dataRow) => {
    const entry = {};
    header.forEach((column, index) => {
      entry[column.trim()] = (dataRow[index] || "").trim();
    });
    return entry;
  });
}

function normalizePriceValue(value) {
  return String(value ?? "")
    .replace(/[^\d.]/g, "")
    .trim();
}

function isMeaningfulValue(value) {
  return Boolean(String(value ?? "").trim());
}

function generateAssistantReply(question) {
  const text = question.trim();
  const summary = getForecastSummary();
  const menuSummaries = state.menus.map((menu) => ({
    menu,
    summary: getMenuCostSummary(menu),
  }));
  const highestCost = menuSummaries.reduce((best, item) => {
    if (!best || item.summary.costRate > best.summary.costRate) return item;
    return best;
  }, null);
  const bestProfit = menuSummaries.reduce((best, item) => {
    const dailySales = parseScaled(item.menu.dailySalesCount);
    const avgPrice = parseScaled(item.menu.averagePrice || item.menu.sellingPrice);
    const monthlyContribution = multiplyScaled(dailySales * DAYS_IN_MONTH, avgPrice - item.summary.totalCost);
    if (!best || monthlyContribution > best.monthlyContribution) {
      return { ...item, monthlyContribution };
    }
    return best;
  }, null);

  if (/(원가|원가율)/.test(text) && highestCost) {
    return `${highestCost.menu.name}의 원가율이 ${formatPercent(highestCost.summary.costRate)}로 가장 높습니다. 총 원가는 ${formatCurrency(
      highestCost.summary.totalCost
    )}이며, 공급가가 높은 재료 또는 사용량이 큰 재료부터 줄이는 것이 우선입니다.`;
  }
  if (/(이익|수익|마진)/.test(text) && bestProfit) {
    return `${bestProfit.menu.name}이 월 기여이익 ${formatCurrency(
      bestProfit.monthlyContribution
    )}로 가장 좋습니다. 전체 월 영업이익은 ${formatCurrency(summary.operatingProfit)}입니다.`;
  }
  if (/(손익분기|브레이크이븐|몇 개)/.test(text)) {
    return `현재 손익분기 시점은 약 ${scaledToNumberString(summary.breakEvenDays, 1)}일입니다. 고정비를 줄이거나 평균 판매가를 높이면 더 빨라집니다.`;
  }
  if (/(판매가|가격)/.test(text) && highestCost) {
    const targetRate = parseScaled(highestCost.menu.targetCostRate || "30");
    const recommended = targetRate > 0n ? divideScaled(highestCost.summary.totalCost * 100n, targetRate) : 0n;
    return `${highestCost.menu.name}의 목표 원가율 ${formatPercent(targetRate)} 기준 추천 판매가는 약 ${formatCurrency(recommended)}입니다.`;
  }
  return `현재 월 매출은 ${formatCurrency(summary.totalMonthlyRevenue)}, 월 영업이익은 ${formatCurrency(
    summary.operatingProfit
  )}입니다. 메뉴 원가율, 적정 판매가, 손익분기, 이익 개선 질문을 더 구체적으로 주면 바로 계산해 답합니다.`;
}

elements.tabs.forEach((tab) => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});

elements.addIngredientButton.addEventListener("click", () => {
  state.ingredients.push({
    id: crypto.randomUUID(),
    name: "",
    category: "",
    link: "",
    supplyWeight: "",
    supplyUnit: "g",
    supplyPrice: "",
    vatRate: "10",
    vendor: "",
    prepMethod: "",
    measureMethod: "",
  });
  render();
});

elements.ingredientsTableBody.addEventListener("change", (event) => {
  const row = event.target.closest("tr[data-ingredient-id]");
  if (!row) return;
  const ingredient = getIngredientById(row.dataset.ingredientId);
  if (!ingredient) return;
  ingredient[event.target.dataset.field] = event.target.value;
  render();
});

elements.ingredientsTableBody.addEventListener("click", (event) => {
  const row = event.target.closest("tr[data-ingredient-id]");
  if (!row) return;
  const ingredientId = row.dataset.ingredientId;
  if (event.target.dataset.action === "delete") {
    state.ingredients = state.ingredients.filter((ingredient) => ingredient.id !== ingredientId);
    state.menus.forEach((menu) => {
      menu.rows = menu.rows.filter((recipeRow) => recipeRow.ingredientId !== ingredientId);
    });
    render();
  }
  if (event.target.dataset.action === "analyze") {
    analyzeIngredient(ingredientId);
  }
});

elements.csvUpload.addEventListener("change", async (event) => {
  const [file] = event.target.files || [];
  if (!file) return;
  const text = await file.text();
  const rows = parseCsv(text);
  state.ingredients = rows.map((item) => ({
    id: crypto.randomUUID(),
    name: item.name || "",
    category: item.category || "",
    link: item.link || "",
    supplyWeight: item.supplyWeight || "",
    supplyUnit: item.supplyUnit || "g",
    supplyPrice: item.supplyPrice || "",
    vatRate: item.vatRate || "10",
    vendor: item.vendor || "",
    prepMethod: item.prepMethod || "",
    measureMethod: item.measureMethod || "",
  }));
  if (state.menus.length && state.ingredients.length) {
    state.menus[0].rows = state.ingredients.slice(0, 3).map((ingredient) => ({
      id: crypto.randomUUID(),
      ingredientId: ingredient.id,
      usageWeight: "100",
      usageUnit: ingredient.supplyUnit || "g",
      prepMethod: ingredient.prepMethod || "",
      measureMethod: ingredient.measureMethod || "",
    }));
    activeMenuId = state.menus[0].id;
  }
  render();
});

elements.analyzeAllButton.addEventListener("click", async () => {
  for (const ingredient of state.ingredients) {
    if (ingredient.link) {
      // Sequential requests keep the UI predictable and reduce supplier blocking.
      await analyzeIngredient(ingredient.id);
    }
  }
});

elements.menuSelect.addEventListener("change", (event) => {
  activeMenuId = event.target.value;
  render();
});

elements.addMenuButton.addEventListener("click", () => {
  const menu = {
    id: crypto.randomUUID(),
    name: `신규 메뉴 ${state.menus.length + 1}`,
    sellingPrice: "0",
    averagePrice: "0",
    dailySalesCount: "0",
    totalWeight: "0",
    targetCostRate: "0",
    rows: [],
  };
  state.menus.push(menu);
  activeMenuId = menu.id;
  render();
});

elements.addRecipeRowButton.addEventListener("click", () => {
  const menu = getActiveMenu();
  if (!menu || !state.ingredients.length) return;
  const baseIngredient = state.ingredients[0];
  menu.rows.push({
    id: crypto.randomUUID(),
    ingredientId: baseIngredient.id,
    usageWeight: "0",
    usageUnit: baseIngredient.supplyUnit || "g",
    prepMethod: baseIngredient.prepMethod || "",
    measureMethod: baseIngredient.measureMethod || "",
  });
  render();
});

elements.menuMetaFields.addEventListener("change", (event) => {
  const menu = getActiveMenu();
  if (!menu) return;
  menu[event.target.dataset.menuField] = event.target.value;
  render();
});

elements.recipeTableBody.addEventListener("change", (event) => {
  const menu = getActiveMenu();
  const rowElement = event.target.closest("tr[data-row-id]");
  if (!menu || !rowElement) return;
  const row = menu.rows.find((item) => item.id === rowElement.dataset.rowId);
  if (!row) return;
  row[event.target.dataset.rowField] = event.target.value;
  if (event.target.dataset.rowField === "ingredientId") {
    const ingredient = getIngredientById(event.target.value);
    if (ingredient) {
      row.usageUnit = ingredient.supplyUnit;
      row.prepMethod = ingredient.prepMethod;
      row.measureMethod = ingredient.measureMethod;
    }
  }
  render();
});

elements.recipeTableBody.addEventListener("click", (event) => {
  if (event.target.dataset.rowAction !== "delete") return;
  const menu = getActiveMenu();
  const rowElement = event.target.closest("tr[data-row-id]");
  if (!menu || !rowElement) return;
  menu.rows = menu.rows.filter((row) => row.id !== rowElement.dataset.rowId);
  render();
});

elements.forecastFields.addEventListener("change", (event) => {
  state.forecast[event.target.dataset.forecastField] = event.target.value;
  render();
});

elements.aiHelpButton.addEventListener("click", () => {
  elements.assistantPanel.classList.add("open");
  elements.assistantPanel.setAttribute("aria-hidden", "false");
  render({ persist: false });
});

elements.assistantCloseButton.addEventListener("click", () => {
  elements.assistantPanel.classList.remove("open");
  elements.assistantPanel.setAttribute("aria-hidden", "true");
});

elements.assistantForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const question = elements.assistantInput.value.trim();
  if (!question) return;
  assistantMessages.push({ role: "user", text: question });
  assistantMessages.push({ role: "bot", text: generateAssistantReply(question) });
  elements.assistantInput.value = "";
  render({ persist: false });
});

async function boot() {
  try {
    const remoteState = await loadSharedState();
    state = {
      ingredients: remoteState.ingredients || structuredClone(defaultState.ingredients),
      menus: remoteState.menus || structuredClone(defaultState.menus),
      stores: remoteState.stores || structuredClone(defaultState.stores),
      forecast: { ...defaultState.forecast, ...(remoteState.forecast || {}) },
    };
    activeMenuId = state.menus[0]?.id || null;
  } catch (error) {
    console.error(error);
  } finally {
    isBootstrapping = false;
    render({ persist: false });
  }
}

render({ persist: false });
boot();
