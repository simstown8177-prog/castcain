const SCALE = 10000n;
const STORAGE_KEY = "cost-dashboard-state-v1";
const DAYS_IN_MONTH = 30n;

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
  heroMetrics: document.getElementById("heroMetrics"),
  overviewNarrative: document.getElementById("overviewNarrative"),
  overviewMetrics: document.getElementById("overviewMetrics"),
  ingredientsStats: document.getElementById("ingredientsStats"),
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
  emptyStateTemplate: document.getElementById("emptyStateTemplate"),
};

let state = hydrateLocalCache();
let activeMenuId = state.menus[0]?.id || null;
let saveTimer = null;
let isBootstrapping = true;

function hydrateLocalCache() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return structuredClone(defaultState);
  try {
    const parsed = JSON.parse(saved);
    return {
      ingredients: parsed.ingredients || structuredClone(defaultState.ingredients),
      menus: parsed.menus || structuredClone(defaultState.menus),
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

function renderHeroMetrics() {
  const activeMenu = getActiveMenu();
  const costSummary = activeMenu ? getMenuCostSummary(activeMenu) : null;
  const forecastSummary = getForecastSummary();
  const metrics = [
    ["등록 식자재", `${state.ingredients.length}개`, "공급 기준 DB"],
    ["선택 메뉴 원가", costSummary ? formatCurrency(costSummary.totalCost) : "0원", "1인분 기준"],
    ["선택 메뉴 원가율", costSummary ? formatPercent(costSummary.costRate) : "0.00%", "판매가 대비"],
    ["월 영업이익", formatCurrency(forecastSummary.operatingProfit), "예상 손익"],
  ];
  elements.heroMetrics.innerHTML = metrics
    .map(
      ([label, value, note]) => `
      <div class="metric">
        <span class="metric-label">${label}</span>
        <span class="metric-value">${value}</span>
        <span class="metric-note">${note}</span>
      </div>
    `
    )
    .join("");
}

function renderOverview() {
  const activeMenu = getActiveMenu();
  const menuSummary = activeMenu ? getMenuCostSummary(activeMenu) : null;
  const forecastSummary = getForecastSummary();
  const linkedCount = state.ingredients.filter((ingredient) => ingredient.link).length;
  const averageMenuPrice =
    state.menus.length === 0
      ? 0n
      : state.menus.reduce((sum, menu) => sum + parseScaled(menu.averagePrice || menu.sellingPrice), 0n) / BigInt(state.menus.length);

  elements.overviewNarrative.textContent = activeMenu
    ? `${activeMenu.name} 기준 원가율은 ${formatPercent(menuSummary.costRate)}이며, 현재 월 영업이익 예상은 ${formatCurrency(
        forecastSummary.operatingProfit
      )}입니다.`
    : `식자재를 등록하면 메뉴 원가와 매출 예측이 자동 계산됩니다.`;

  const cards = [
    {
      tone: "primary",
      title: "월 예상 매출",
      value: formatCurrency(forecastSummary.totalMonthlyRevenue),
      foot: "메뉴별 일 판매량 x 평균가격 x 30일",
    },
    {
      tone: "success",
      title: "월 영업이익",
      value: formatCurrency(forecastSummary.operatingProfit),
      foot: `영업이익률 ${formatPercent(forecastSummary.operatingMargin)}`,
    },
    {
      tone: "warning",
      title: "선택 메뉴 원가율",
      value: menuSummary ? formatPercent(menuSummary.costRate) : "0.00%",
      foot: activeMenu ? `${activeMenu.name} 기준` : "선택 메뉴 없음",
    },
    {
      tone: "",
      title: "평균 판매가",
      value: formatCurrency(averageMenuPrice),
      foot: `링크 등록 ${linkedCount}건 / 전체 식자재 ${state.ingredients.length}건`,
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
    ["일 매출 합계", formatCurrency(summary.totalRevenue)],
    ["월 매출 합계", formatCurrency(summary.totalMonthlyRevenue)],
    ["월 식자재 원가", formatCurrency(summary.totalMonthlyFoodCost)],
    ["월 고정지출", formatCurrency(summary.fixedCosts)],
    ["월 감가상각비", formatCurrency(summary.depreciation)],
    ["플랫폼 수수료", formatCurrency(summary.platformFee)],
    ["카드 수수료", formatCurrency(summary.cardFee)],
    ["영업이익", formatCurrency(summary.operatingProfit)],
    ["영업이익률", formatPercent(summary.operatingMargin)],
    ["손익분기 일수", `${scaledToNumberString(summary.breakEvenDays, 1)}일`],
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

function renderForecastSummaryBar() {
  const summary = getForecastSummary();
  const avgDailyProfit =
    DAYS_IN_MONTH === 0n ? 0n : divideScaled(summary.operatingProfit, DAYS_IN_MONTH);
  const metrics = [
    ["일 매출", formatCurrency(summary.totalRevenue)],
    ["월 영업이익", formatCurrency(summary.operatingProfit)],
    ["일 평균 이익", formatCurrency(avgDailyProfit)],
    ["손익분기", `${scaledToNumberString(summary.breakEvenDays, 1)}일`],
    ["플랫폼 수수료", formatCurrency(summary.platformFee)],
    ["카드 수수료", formatCurrency(summary.cardFee)],
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
  renderHeroMetrics();
  renderOverview();
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
    const response = await fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: ingredient.link }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || data.error);
    ingredient.name = ingredient.name || data.product.title;
    ingredient.vendor = data.product.vendor || ingredient.vendor;
    ingredient.supplyPrice = ingredient.supplyPrice || String(data.product.price || "");
    render();
  } catch (error) {
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

async function boot() {
  try {
    const remoteState = await loadSharedState();
    state = {
      ingredients: remoteState.ingredients || structuredClone(defaultState.ingredients),
      menus: remoteState.menus || structuredClone(defaultState.menus),
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
