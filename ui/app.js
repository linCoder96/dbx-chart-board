/* 图表看板 —— DBX 纯前端插件
 * 从连接右键打开：把只读 SQL 结果渲染为可保存的 ECharts 图表面板。
 * 权限：host.data:read（queryData 只读查询）+ host.storage（面板持久化）。
 */
(() => {
  "use strict";

  const plugin = window.dbxPlugin;
  const STORE_KEY = "chart-board:v1";
  // 与 DBX 内置 AI 图表协议对齐的护栏数值（防止大结果集拖垮 WebView）
  const MAX_ROWS = 2000;
  const MAX_POINTS = 5000;
  const MAX_CATEGORIES = 300;
  const MAX_SERIES = 8;

  const els = {
    title: document.getElementById("app-title"),
    boardSelect: document.getElementById("board-select"),
    newBoard: document.getElementById("new-board"),
    deleteBoard: document.getElementById("delete-board"),
    banner: document.getElementById("banner"),
    cards: document.getElementById("cards"),
    empty: document.getElementById("empty"),
    emptyTitle: document.getElementById("empty-title"),
    emptyHint: document.getElementById("empty-hint"),
    addCard: document.getElementById("add-card"),
    addDemo: document.getElementById("add-demo"),
    status: document.getElementById("status"),
    dialog: document.getElementById("card-dialog"),
    dlgTitle: document.getElementById("dlg-title"),
    fTitle: document.getElementById("f-title"),
    fSql: document.getElementById("f-sql"),
    fDatabase: document.getElementById("f-database"),
    btnQuery: document.getElementById("btn-query"),
    specSection: document.getElementById("spec-section"),
    fType: document.getElementById("f-type"),
    fDim: document.getElementById("f-dim"),
    fBreakdown: document.getElementById("f-breakdown"),
    fStack: document.getElementById("f-stack"),
    fMetrics: document.getElementById("f-metrics"),
    previewWrap: document.getElementById("preview-wrap"),
    previewChart: document.getElementById("preview-chart"),
    dlgHint: document.getElementById("dlg-hint"),
    dlgCancel: document.getElementById("dlg-cancel"),
    dlgSave: document.getElementById("dlg-save"),
  };

  // ---------- 宿主状态 ----------
  let context = {};
  let connectionId = "";
  let defaultDatabase = "";

  // ---------- 持久化状态 ----------
  let boards = [];
  let activeBoardId = "";
  const chartInstances = new Map(); // cardId -> echarts 实例
  const dialogState = { editingId: null, previewData: null, previewChart: null };

  // ---------- 示例数据（无连接时也能验证渲染管线） ----------
  const DEMO_RESULT = {
    dbType: "demo",
    columns: [{ name: "月份" }, { name: "短信" }, { name: "邮件" }, { name: "电话" }],
    rows: [
      ["2026-06", 120, 64, 28],
      ["2026-07", 138, 71, 31],
      ["2026-08", 126, 88, 27],
      ["2026-09", 151, 92, 36],
      ["2026-10", 163, 103, 41],
      ["2026-11", 149, 97, 38],
    ],
    truncated: false,
    elapsedMs: 0,
  };
  const DEMO_SPEC = { type: "line", dimension: ["月份"], breakdown: null, metrics: ["短信", "邮件", "电话"], stack: "none" };

  // ---------- 工具 ----------
  function uid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  /** 数字或可数值字符串 → number；其余 → null（空值不参与聚合） */
  function toNum(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function columnNames(result) {
    return result.columns.map((column) => (typeof column === "string" ? column : column && column.name) || "");
  }

  function cellText(value) {
    return value === null || value === undefined ? "(空)" : String(value);
  }

  function setStatus(message) {
    els.status.textContent = message || "";
  }

  // ---------- 存储 ----------
  async function loadState() {
    if (!plugin.capabilities || !plugin.capabilities.storage) {
      setStatus("当前宿主不提供 host.storage，面板仅在本页会话内保留");
      return;
    }
    try {
      const raw = await plugin.storage.get(STORE_KEY);
      if (raw && typeof raw === "object") {
        boards = Array.isArray(raw.boards) ? raw.boards : [];
        activeBoardId = typeof raw.activeBoardId === "string" ? raw.activeBoardId : "";
      }
    } catch (error) {
      setStatus("读取面板失败：" + error.message);
    }
  }

  async function saveState() {
    if (!plugin.capabilities || !plugin.capabilities.storage) return;
    try {
      await plugin.storage.set(STORE_KEY, { boards, activeBoardId });
    } catch (error) {
      setStatus("保存面板失败：" + error.message);
    }
  }

  // ---------- 列分类与智能推断 ----------
  /** 按采样值把列分为数值/日期/文本，用于免配置图表选型 */
  function classify(result) {
    const names = columnNames(result);
    const sample = result.rows.slice(0, 200);
    const isDateLike = (value) =>
      typeof value === "string" && /^\d{4}[-/年]\d{1,2}/.test(value.trim());
    const numeric = [];
    const dates = [];
    const texts = [];
    names.forEach((_, index) => {
      const values = sample
        .map((row) => row[index])
        .filter((value) => value !== null && value !== undefined && String(value).trim() !== "");
      if (values.length === 0) {
        texts.push(index);
        return;
      }
      const numericRatio = values.filter((value) => toNum(value) !== null).length / values.length;
      const dateRatio = values.filter(isDateLike).length / values.length;
      if (numericRatio >= 0.6) numeric.push(index);
      else if (dateRatio >= 0.6) dates.push(index);
      else texts.push(index);
    });
    return { names, numeric, dates, texts, sample };
  }

  function distinctCount(cls, index) {
    return new Set(cls.sample.map((row) => String(row[index] ?? ""))).size;
  }

  /** 数据形状 → 图表规格（决策树与 Metabase 一致：趋势→折线、构成→柱/饼、相关→散点） */
  function inferSpec(result, cls) {
    const { numeric, dates, texts } = cls;
    if (numeric.length === 0) return null;
    if (numeric.length >= 2 && dates.length === 0 && texts.length === 0) {
      return {
        type: "scatter",
        dimension: [],
        breakdown: null,
        metrics: [cls.names[numeric[0]], cls.names[numeric[1]]],
        stack: "none",
      };
    }
    const dimension = dates[0] ?? texts.find((index) => distinctCount(cls, index) <= 50) ?? texts[0];
    if (dimension === undefined) {
      return { type: "bar", dimension: [], breakdown: null, metrics: [cls.names[numeric[0]]], stack: "none" };
    }
    const metrics = numeric.filter((index) => index !== dimension);
    if (dates.includes(dimension)) {
      return {
        type: "line",
        dimension: [cls.names[dimension]],
        breakdown: null,
        metrics: metrics.slice(0, 4).map((index) => cls.names[index]),
        stack: "none",
      };
    }
    const extraText = texts
      .filter((index) => index !== dimension)
      .find((index) => distinctCount(cls, index) <= MAX_SERIES);
    if (
      extraText !== undefined &&
      metrics.length === 1 &&
      distinctCount(cls, dimension) * distinctCount(cls, extraText) <= MAX_POINTS
    ) {
      return {
        type: "bar",
        dimension: [cls.names[dimension]],
        breakdown: cls.names[extraText],
        metrics: [cls.names[metrics[0]]],
        stack: "stacked",
      };
    }
    return {
      type: "bar",
      dimension: [cls.names[dimension]],
      breakdown: null,
      metrics: metrics.slice(0, 4).map((index) => cls.names[index]),
      stack: "none",
    };
  }

  // ---------- 列名解析（绑定用列名而不是序号，结果列变化可检测） ----------
  function resolveSpec(spec, cls) {
    if (!spec || !spec.type) return null;
    const indexOf = (name) => cls.names.indexOf(name);
    const dimension = (spec.dimension || []).map(indexOf);
    const metrics = (spec.metrics || []).map(indexOf);
    const breakdown = spec.breakdown ? indexOf(spec.breakdown) : null;
    if (dimension.some((index) => index < 0) || metrics.some((index) => index < 0)) return null;
    if (breakdown !== null && breakdown < 0) return null;
    if (metrics.length === 0) return null;
    return { type: spec.type, dimension, metrics, breakdown, stack: spec.stack || "none" };
  }

  // ---------- 聚合（SQL 可能未 GROUP BY，按类目客户端求和，防止重复类目渲染异常） ----------
  function aggregate(result, spec) {
    const warnings = [];
    const names = columnNames(result);
    const xIndex = spec.dimension[0];
    const xOrder = [];
    const xSeen = new Set();
    const seriesMap = new Map();
    let overflowed = false;

    const push = (seriesName, x, value) => {
      let bucket = seriesMap.get(seriesName);
      if (!bucket && seriesMap.size >= MAX_SERIES - 1) {
        // 超出系列的归并到「其他」
        seriesName = "其他";
        bucket = seriesMap.get(seriesName);
        overflowed = true;
      }
      if (!bucket) {
        bucket = new Map();
        seriesMap.set(seriesName, bucket);
      }
      bucket.set(x, (bucket.get(x) || 0) + value);
    };

    for (const row of result.rows) {
      const x = xIndex === undefined ? "" : cellText(row[xIndex]);
      if (xIndex !== undefined && !xSeen.has(x)) {
        if (xOrder.length >= MAX_CATEGORIES) {
          warnings.push("类目超过 " + MAX_CATEGORIES + " 个，仅展示前 " + MAX_CATEGORIES + " 个");
          break;
        }
        xSeen.add(x);
        xOrder.push(x);
      }
      if (spec.breakdown !== null) {
        const value = toNum(row[spec.metrics[0]]);
        if (value === null) continue;
        push(cellText(row[spec.breakdown]), x, value);
      } else {
        for (const metricIndex of spec.metrics) {
          const value = toNum(row[metricIndex]);
          if (value === null) continue;
          push(names[metricIndex], x, value);
        }
      }
    }

    if (overflowed) warnings.push("系列数量超过 " + MAX_SERIES + "，多余系列已归并为「其他」");

    // x 轴没有维度时（纯指标）用单类目
    const categories = xOrder.length ? xOrder : [""];
    const series = [];
    for (const [name, bucket] of seriesMap) {
      series.push({ name, data: categories.map((x) => (bucket.has(x) ? bucket.get(x) : 0)) });
    }
    if (spec.stack === "normalized" && series.length > 0) {
      categories.forEach((_, xIdx) => {
        const total = series.reduce((sum, item) => sum + Math.abs(item.data[xIdx] || 0), 0);
        if (total > 0) {
          for (const item of series) {
            item.data[xIdx] = Math.round((Math.abs(item.data[xIdx] || 0) / total) * 10000) / 100;
          }
        }
      });
    }
    return { categories, series, warnings };
  }

  // ---------- ECharts option 构建 ----------
  function themeColors() {
    const dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    return {
      dark,
      text: dark ? "#e6e6e6" : "#1f2328",
      split: dark ? "#2c3038" : "#eef0f2",
    };
  }

  function buildOption(result, spec) {
    const colors = themeColors();
    const base = {
      backgroundColor: "transparent",
      textStyle: { color: colors.text },
      animationDuration: 300,
    };

    if (spec.type === "scatter") {
      if (spec.metrics.length < 2) throw new Error("散点图需要两个指标列（X、Y）");
      const xName = columnNames(result)[spec.metrics[0]];
      const yName = columnNames(result)[spec.metrics[1]];
      const points = [];
      for (const row of result.rows) {
        if (points.length >= MAX_POINTS) break;
        const x = toNum(row[spec.metrics[0]]);
        const y = toNum(row[spec.metrics[1]]);
        if (x === null || y === null) continue;
        points.push([x, y]);
      }
      if (points.length === 0) throw new Error("结果中没有可绘制的数值点");
      return {
        ...base,
        tooltip: { trigger: "item" },
        grid: { left: 10, right: 18, top: 24, bottom: 10, containLabel: true },
        xAxis: {
          type: "value",
          name: xName,
          nameTextStyle: { color: colors.text },
          splitLine: { lineStyle: { color: colors.split } },
          axisLabel: { color: colors.text },
        },
        yAxis: {
          type: "value",
          name: yName,
          nameTextStyle: { color: colors.text },
          splitLine: { lineStyle: { color: colors.split } },
          axisLabel: { color: colors.text },
        },
        series: [{ type: "scatter", symbolSize: 7, data: points }],
      };
    }

    if (spec.type === "pie") {
      if (spec.dimension.length === 0) throw new Error("饼图需要一个维度（类目）列");
      if (spec.metrics.length !== 1) throw new Error("饼图需要且仅需要一个指标");
      const metricName = columnNames(result)[spec.metrics[0]];
      const buckets = new Map();
      for (const row of result.rows) {
        const name = cellText(row[spec.dimension[0]]);
        const value = toNum(row[spec.metrics[0]]);
        if (value === null) continue;
        buckets.set(name, (buckets.get(name) || 0) + value);
      }
      let items = [...buckets].map(([name, value]) => ({ name, value }));
      items = items.filter((item) => item.value >= 0); // 负值无占比语义，直接排除
      if (items.length === 0) throw new Error("结果中没有可绘制的占比数据");
      items.sort((a, b) => b.value - a.value);
      if (items.length > 10) {
        const rest = items.slice(10).reduce((sum, item) => sum + item.value, 0);
        items = items.slice(0, 10).concat({ name: "其他", value: rest });
      }
      return {
        ...base,
        tooltip: { trigger: "item" },
        legend: { top: 0, left: 0, type: "scroll", textStyle: { color: colors.text } },
        series: [{ type: "pie", name: metricName, radius: ["38%", "68%"], data: items, label: { color: colors.text } }],
      };
    }

    // bar / line / area
    const { categories, series, warnings } = aggregate(result, spec);
    if (series.length === 0) throw new Error("结果中没有可绘制的数值");
    const horizontal = spec.type === "bar" && spec.breakdown === null && categories.length > 15;
    const stackType = spec.stack === "stacked" || spec.stack === "normalized" ? "total" : undefined;
    const seriesOptions = series.map((item) => ({
      name: item.name,
      type: spec.type === "area" ? "line" : spec.type,
      stack: stackType,
      smooth: spec.type === "line" || spec.type === "area",
      areaStyle: spec.type === "area" ? { opacity: 0.35 } : undefined,
      emphasis: { focus: "series" },
      data: item.data,
    }));
    const categoryAxis = {
      type: "category",
      data: categories,
      axisLabel: { color: colors.text, hideOverlap: true },
      axisLine: { lineStyle: { color: colors.split } },
    };
    const valueAxis = {
      type: "value",
      splitLine: { lineStyle: { color: colors.split } },
      axisLabel: { color: colors.text },
    };
    return {
      ...base,
      tooltip: { trigger: "axis" },
      legend: series.length > 1 ? { top: 0, left: 0, type: "scroll", textStyle: { color: colors.text } } : undefined,
      grid: { left: 10, right: 18, top: series.length > 1 ? 40 : 20, bottom: 10, containLabel: true },
      xAxis: horizontal ? valueAxis : categoryAxis,
      yAxis: horizontal ? categoryAxis : valueAxis,
      series: seriesOptions,
      _warnings: warnings,
    };
  }

  // ---------- 卡片数据获取 ----------
  async function fetchCardData(card) {
    if (card.demo) return DEMO_RESULT;
    if (!connectionId) throw new Error("缺少连接：请从连接树右键 →「打开图表看板」");
    if (!plugin.capabilities || !plugin.capabilities.dataApi) throw new Error("当前宿主不支持 host.data:read");
    return plugin.queryData({
      connectionId,
      database: card.database || defaultDatabase || undefined,
      sql: card.sql,
      maxRows: MAX_ROWS,
    });
  }

  function activeBoard() {
    return boards.find((board) => board.id === activeBoardId) || null;
  }

  // ---------- 渲染 ----------
  function disposeChart(cardId) {
    const instance = chartInstances.get(cardId);
    if (instance) {
      instance.dispose();
      chartInstances.delete(cardId);
    }
  }

  async function renderCard(card, cardEl) {
    const chartEl = cardEl.querySelector(".chart");
    const metaEl = cardEl.querySelector(".card-meta");
    disposeChart(card.id);
    chartEl.innerHTML = "";
    metaEl.innerHTML = "";
    try {
      const data = await fetchCardData(card);
      const cls = classify(data);
      const spec = resolveSpec(card.spec, cls) || inferSpec(data, cls);
      if (!spec) throw new Error("结果中没有可绘制的数值列");
      const option = buildOption(data, spec);
      const warnings = option._warnings || [];
      delete option._warnings;
      const chart = echarts.init(chartEl, null, { renderer: "canvas" });
      chart.setOption(option);
      chartInstances.set(card.id, chart);

      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = `已查询 ${data.rows.length} 行` + (data.elapsedMs ? ` · ${data.elapsedMs}ms` : "");
      metaEl.appendChild(badge);
      if (data.truncated) {
        const truncated = document.createElement("span");
        truncated.className = "badge warn";
        truncated.textContent = "已截断";
        metaEl.appendChild(truncated);
      }
      if (warnings.length) {
        const warn = document.createElement("span");
        warn.className = "badge warn";
        warn.textContent = warnings[0];
        metaEl.appendChild(warn);
      }
      const sqlEl = document.createElement("code");
      sqlEl.textContent = card.demo ? "示例数据（不执行查询）" : card.sql.replace(/\s+/g, " ");
      sqlEl.title = card.demo ? "" : card.sql;
      metaEl.appendChild(sqlEl);
    } catch (error) {
      const messageEl = document.createElement("div");
      messageEl.className = "card-body-msg";
      messageEl.textContent = error.message;
      chartEl.appendChild(messageEl);
    }
  }

  function cardElement(card) {
    const article = document.createElement("article");
    article.className = "card";
    article.dataset.id = card.id;

    const head = document.createElement("div");
    head.className = "card-head";
    const title = document.createElement("h2");
    title.textContent = card.title || "未命名卡片";
    title.title = card.title || "";
    const actions = document.createElement("div");
    actions.className = "card-actions";
    const actionList = [
      ["refresh", "↻ 刷新", ""],
      ["delete", "✕", "danger"],
    ];
    // 示例卡片无 SQL，不提供编辑（编辑语义只对真实查询卡片成立）
    if (!card.demo) actionList.splice(1, 0, ["edit", "编辑", ""]);
    for (const [act, label, extraClass] of actionList) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.act = act;
      button.textContent = label;
      if (extraClass) button.className = extraClass;
      actions.appendChild(button);
    }
    head.appendChild(title);
    head.appendChild(actions);

    const chart = document.createElement("div");
    chart.className = "chart";
    const meta = document.createElement("div");
    meta.className = "card-meta";

    article.appendChild(head);
    article.appendChild(chart);
    article.appendChild(meta);

    article.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-act]");
      if (!button) return;
      const board = activeBoard();
      if (!board) return;
      const act = button.dataset.act;
      if (act === "refresh") {
        button.disabled = true;
        await renderCard(card, article);
        button.disabled = false;
      } else if (act === "edit") {
        openDialog(card);
      } else if (act === "delete") {
        board.cards = board.cards.filter((item) => item.id !== card.id);
        disposeChart(card.id);
        await saveState();
        renderAll();
      }
    });
    return article;
  }

  function renderAll() {
    // 面板下拉
    els.boardSelect.innerHTML = "";
    for (const board of boards) {
      const option = document.createElement("option");
      option.value = board.id;
      option.textContent = board.name;
      option.selected = board.id === activeBoardId;
      els.boardSelect.appendChild(option);
    }

    // 连接横幅
    if (!connectionId) {
      els.banner.classList.remove("hidden");
      els.banner.textContent = "当前未绑定连接：请从左侧连接树右键 →「打开图表看板」后再建数据卡片；示例卡片不受影响。";
    } else {
      els.banner.classList.add("hidden");
    }

    // 卡片区
    els.cards.innerHTML = "";
    for (const cardId of [...chartInstances.keys()]) disposeChart(cardId);
    const board = activeBoard();
    const cards = board ? board.cards : [];
    els.empty.classList.toggle("hidden", cards.length > 0);
    els.cards.classList.toggle("hidden", cards.length === 0);
    if (cards.length === 0) {
      els.emptyTitle.textContent = "这个面板还没有卡片";
      els.emptyHint.textContent =
        "点击下方「+ 添加卡片」写一条只读 SQL，智能推断会自动选择图表类型；也可以先「添加示例卡片」看看效果。";
    }
    for (const card of cards) {
      const el = cardElement(card);
      els.cards.appendChild(el);
      renderCard(card, el);
    }
  }

  // ---------- 卡片对话框 ----------
  function fillSelect(select, names, selectedName, allowEmpty) {
    select.innerHTML = "";
    if (allowEmpty) {
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "（无）";
      select.appendChild(empty);
    }
    for (const name of names) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      if (name === selectedName) option.selected = true;
      select.appendChild(option);
    }
  }

  function readSpecFromForm() {
    const metrics = [...els.fMetrics.querySelectorAll("input[type=checkbox]:checked")].map((input) => input.value);
    return {
      type: els.fType.value,
      dimension: els.fDim.value ? [els.fDim.value] : [],
      breakdown: els.fBreakdown.value || null,
      metrics,
      stack: els.fStack.value,
    };
  }

  function updatePreview() {
    if (!dialogState.previewData) return;
    if (!dialogState.previewChart) {
      dialogState.previewChart = echarts.init(els.previewChart, null, { renderer: "canvas" });
    }
    const result = dialogState.previewData;
    const cls = classify(result);
    const rawSpec = readSpecFromForm();
    const spec = resolveSpec(rawSpec, cls);
    els.dlgHint.textContent = "";
    if (!spec) {
      els.dlgHint.textContent = "请选择至少一个指标列（Y 轴）。";
      dialogState.previewChart.clear();
      return;
    }
    try {
      const option = buildOption(result, spec);
      const warnings = option._warnings || [];
      delete option._warnings;
      dialogState.previewChart.clear();
      dialogState.previewChart.setOption(option);
      if (warnings.length) els.dlgHint.textContent = warnings.join("；");
    } catch (error) {
      dialogState.previewChart.clear();
      els.dlgHint.textContent = error.message;
    }
  }

  function populateSpecSection(result) {
    const cls = classify(result);
    const inferred = inferSpec(result, cls);
    fillSelect(els.fDim, cls.names, inferred && inferred.dimension[0] ? inferred.dimension[0] : "", true);
    const seriesCandidates = cls.names.filter((_, index) => cls.dates.includes(index) || cls.texts.includes(index));
    fillSelect(els.fBreakdown, seriesCandidates, inferred && inferred.breakdown ? inferred.breakdown : "", true);
    els.fMetrics.innerHTML = "";
    if (cls.numeric.length === 0) {
      els.fMetrics.textContent = "结果中没有数值列，无法绘图。";
    }
    for (const index of cls.numeric) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = cls.names[index];
      if (inferred && inferred.metrics.includes(cls.names[index])) input.checked = true;
      label.appendChild(input);
      label.appendChild(document.createTextNode(cls.names[index]));
      els.fMetrics.appendChild(label);
    }
    if (inferred) {
      els.fType.value = inferred.type;
      els.fStack.value = inferred.stack;
    }
    els.specSection.classList.remove("hidden");
    els.previewWrap.classList.add("show");
    updatePreview();
  }

  function openDialog(card) {
    dialogState.editingId = card ? card.id : null;
    dialogState.previewData = null;
    if (dialogState.previewChart) {
      dialogState.previewChart.dispose();
      dialogState.previewChart = null;
    }
    els.dlgTitle.textContent = card ? "编辑卡片" : "添加卡片";
    els.fTitle.value = card ? card.title : "";
    els.fSql.value = card ? card.sql : "";
    els.fDatabase.value = card ? card.database || "" : defaultDatabase || "";
    els.fDatabase.placeholder = defaultDatabase || "默认使用连接当前库";
    els.specSection.classList.add("hidden");
    els.previewWrap.classList.remove("show");
    els.dlgHint.textContent = "";
    els.btnQuery.disabled = false;
    els.dialog.showModal();
  }

  async function queryForDialog() {
    const sql = els.fSql.value.trim();
    if (!sql) {
      els.dlgHint.textContent = "请先填写 SQL。";
      return;
    }
    if (plugin.capabilities && plugin.capabilities.dataApi === false) {
      els.dlgHint.textContent = "当前宿主不支持 host.data:read（capabilities.dataApi=false）。";
      return;
    }
    if (!connectionId) {
      els.dlgHint.textContent = "缺少连接：请从连接树右键 →「打开图表看板」。";
      return;
    }
    els.btnQuery.disabled = true;
    els.dlgHint.textContent = "查询中…（首次会对该连接弹出授权确认）";
    try {
      const data = await plugin.queryData({
        connectionId,
        database: els.fDatabase.value.trim() || defaultDatabase || undefined,
        sql,
        maxRows: MAX_ROWS,
      });
      dialogState.previewData = data;
      populateSpecSection(data);
      const previousHint = els.dlgHint.textContent.trim();
      const summary = `返回 ${data.rows.length} 行` + (data.elapsedMs ? `，耗时 ${data.elapsedMs}ms` : "") + (data.truncated ? "（已截断）" : "");
      els.dlgHint.textContent = previousHint ? `${summary}；${previousHint}` : summary;
    } catch (error) {
      els.dlgHint.textContent = error.message;
    } finally {
      els.btnQuery.disabled = false;
    }
  }

  async function saveDialogCard() {
    const board = activeBoard();
    if (!board) return;
    const sql = els.fSql.value.trim();
    const spec = readSpecFromForm();
    const cls = dialogState.previewData ? classify(dialogState.previewData) : null;
    if (!dialogState.previewData || !cls || !resolveSpec(spec, cls)) {
      els.dlgHint.textContent = "请先「查询并智能生成」，并确认至少选中一个指标列。";
      return;
    }
    if (!sql) {
      els.dlgHint.textContent = "请填写 SQL。";
      return;
    }
    if (spec.type === "pie" && (spec.dimension.length === 0 || spec.metrics.length !== 1)) {
      els.dlgHint.textContent = "饼图需要一个维度列和一个指标。";
      return;
    }
    if (spec.type === "scatter" && spec.metrics.length < 2) {
      els.dlgHint.textContent = "散点图需要两个指标列。";
      return;
    }
    const title = els.fTitle.value.trim() || "未命名卡片";
    const patch = { title, sql, database: els.fDatabase.value.trim(), spec };
    if (dialogState.editingId) {
      const card = board.cards.find((item) => item.id === dialogState.editingId);
      if (card) Object.assign(card, patch);
    } else {
      board.cards.push({ id: uid(), ...patch });
    }
    await saveState();
    els.dialog.close();
    renderAll();
  }

  // ---------- 面板操作 ----------
  async function createBoard() {
    const name = "面板 " + (boards.length + 1);
    const board = { id: uid(), name, cards: [] };
    boards.push(board);
    activeBoardId = board.id;
    await saveState();
    renderAll();
  }

  let deletePending = false;
  async function deleteBoard() {
    const board = activeBoard();
    if (!board) return;
    if (!deletePending) {
      deletePending = true;
      els.deleteBoard.textContent = "确认删除「" + board.name + "」？";
      setTimeout(() => {
        deletePending = false;
        els.deleteBoard.textContent = "删除面板";
      }, 4000);
      return;
    }
    deletePending = false;
    els.deleteBoard.textContent = "删除面板";
    for (const card of board.cards) disposeChart(card.id);
    boards = boards.filter((item) => item.id !== board.id);
    if (boards.length === 0) boards.push({ id: uid(), name: "我的面板", cards: [] });
    activeBoardId = boards[0].id;
    await saveState();
    renderAll();
  }

  function bindEvents() {
    els.boardSelect.addEventListener("change", async () => {
      activeBoardId = els.boardSelect.value;
      await saveState();
      renderAll();
    });
    els.newBoard.addEventListener("click", createBoard);
    els.deleteBoard.addEventListener("click", deleteBoard);
    els.addCard.addEventListener("click", () => openDialog(null));
    els.addDemo.addEventListener("click", async () => {
      const board = activeBoard();
      if (!board) return;
      board.cards.push({
        id: uid(),
        title: "示例：通知发送量趋势",
        sql: "",
        database: "",
        spec: DEMO_SPEC,
        demo: true,
      });
      await saveState();
      renderAll();
    });
    els.btnQuery.addEventListener("click", queryForDialog);
    els.dlgCancel.addEventListener("click", () => els.dialog.close());
    els.dlgSave.addEventListener("click", saveDialogCard);
    for (const control of [els.fType, els.fDim, els.fBreakdown, els.fStack]) {
      control.addEventListener("change", updatePreview);
    }
    els.fMetrics.addEventListener("change", updatePreview);
    window.addEventListener("resize", () => {
      for (const chart of chartInstances.values()) chart.resize();
      if (dialogState.previewChart) dialogState.previewChart.resize();
    });
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        for (const chart of chartInstances.values()) chart.resize();
        if (dialogState.previewChart) dialogState.previewChart.resize();
      });
      observer.observe(els.cards);
    }
  }

  // ---------- 启动 ----------
  async function init() {
    try {
      context = (await plugin.ready) || {};
    } catch {
      context = {};
    }
    connectionId = context.connectionId || "";
    defaultDatabase = context.database || "";
    await loadState();
    if (boards.length === 0) {
      boards.push({ id: uid(), name: "我的面板", cards: [] });
    }
    if (!boards.some((board) => board.id === activeBoardId)) {
      activeBoardId = boards[0].id;
    }
    bindEvents();
    renderAll();
    if (typeof plugin.onContext === "function") {
      plugin.onContext((nextContext) => {
        const nextConnection = nextContext && nextContext.connectionId ? nextContext.connectionId : "";
        if (nextConnection === connectionId) return;
        connectionId = nextConnection;
        defaultDatabase = (nextContext && nextContext.database) || "";
        renderAll();
      });
    }
  }

  init().catch((error) => setStatus("初始化失败：" + error.message));
})();
