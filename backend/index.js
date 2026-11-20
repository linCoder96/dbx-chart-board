/* Chart Board Sidecar —— DBX 插件后端（stdio-jsonl / JSON-RPC 2.0）
 * 对外暴露 MCP 工具，让外部 Agent（Claude Code 等）通过 dbx-mcp 一句话添加看板卡片。
 * 卡片写入 <DBX_PLUGIN_DATA_DIR>/ui-storage.json，与前端 host.storage 共享同一份状态。
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const readline = require("node:readline");

const PLUGIN_ID = "com.dnl.dbx-chart-board";
const PLUGIN_VERSION = "0.2.0";
const STORE_KEY = "chart-board:v1";
const DATA_DIR = process.env.DBX_PLUGIN_DATA_DIR || path.join(os.homedir(), ".dbx-dev", "chart-board-backend");
const STORAGE_FILE = path.join(DATA_DIR, "ui-storage.json");
const CHART_TYPES = new Set(["bar", "line", "area", "pie", "scatter"]);

function send(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}
function sendError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}

// ---------- ui-storage.json（与前端 host.storage 同一契约：JSON map，值 ≤256KiB） ----------
function readStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORAGE_FILE, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temp = `${STORAGE_FILE}.tmp-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(store), "utf8");
  fs.renameSync(temp, STORAGE_FILE);
}

/** 本地调试配置：Agent 未指定连接时，卡片默认绑定到该连接（written by scripts/grant_local.py）。 */
function defaultConnectionId() {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "chart-board-config.json"), "utf8"));
    return typeof config.defaultConnectionId === "string" ? config.defaultConnectionId : "";
  } catch {
    return "";
  }
}

function loadBoards(store) {
  const value = store[STORE_KEY];
  const boards = value && Array.isArray(value.boards) && value.boards.length
    ? value.boards
    : [{ id: "default", name: "我的面板", cards: [] }];
  const activeBoardId = value && typeof value.activeBoardId === "string" && boards.some((b) => b.id === value.activeBoardId)
    ? value.activeBoardId
    : boards[0].id;
  return { boards, activeBoardId };
}

function saveBoards(store, boards, activeBoardId) {
  store[STORE_KEY] = { boards, activeBoardId };
  writeStore(store);
  return { boards, activeBoardId };
}

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function normalizeSpec(input) {
  if (!input || typeof input !== "object") throw new Error("spec 必须是对象");
  const type = String(input.type || "bar");
  if (!CHART_TYPES.has(type)) throw new Error(`不支持的图表类型: ${type}`);
  const strings = (value) => (Array.isArray(value) ? value.filter((x) => typeof x === "string" && x.length) : []);
  return {
    type,
    dimension: strings(input.dimension),
    metrics: strings(input.metrics),
    breakdown: typeof input.breakdown === "string" && input.breakdown ? input.breakdown : null,
    stack: ["none", "stacked", "normalized"].includes(input.stack) ? input.stack : "none",
  };
}

function toolResult(text, isError = false) {
  return { content: [{ type: "text", text }], isError };
}

// ---------- 工具清单（manifest 中必须逐项声明 access，否则外部 MCP 不暴露） ----------
const TOOLS = [
  {
    name: "list_boards",
    description: "列出图表看板中已有的面板和卡片；用于确认当前看板状态。",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: "add_card",
    description:
      "向 DBX 图表看板添加一张数据卡片。先通过 dbx_execute_query 查询数据，再按数据形状给出 spec：日期维度→line，文本维度→bar，两个数值列→scatter，占比→pie。卡片刷新时使用工作台当前连接。",
    inputSchema: {
      type: "object",
      properties: {
        database: { type: "string", description: "可选：数据库名，留空用连接默认库" },
        boardId: { type: "string", description: "可选：目标面板 ID，默认当前激活面板" },
        title: { type: "string", description: "卡片标题" },
        sql: { type: "string", description: "只读 SELECT 语句，卡片刷新时由 DBX 执行" },
        spec: {
          type: "object",
          description: "图表规格：type/dimension[]/metrics[]/breakdown/stack（列名字符串，不用列序号）",
          properties: {
            type: { type: "string", enum: ["bar", "line", "area", "pie", "scatter"] },
            dimension: { type: "array", items: { type: "string" } },
            metrics: { type: "array", items: { type: "string" } },
            breakdown: { type: "string" },
            stack: { type: "string", enum: ["none", "stacked", "normalized"] },
          },
          required: ["type", "dimension", "metrics"],
        },
      },
      required: ["title", "sql", "spec"],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: "remove_card",
    description: "从图表看板删除一张卡片（按 cardId）。",
    inputSchema: {
      type: "object",
      properties: { cardId: { type: "string", description: "要删除的卡片 ID，可用 list_boards 获取" } },
      required: ["cardId"],
    },
    annotations: { readOnlyHint: false },
  },
];

function callTool(tool, args = {}) {
  const store = readStore();
  const state = loadBoards(store);

  if (tool === "list_boards") {
    return toolResult(JSON.stringify({ activeBoardId: state.activeBoardId, boards: state.boards }, null, 2));
  }

  if (tool === "add_card") {
    const title = String(args.title || "").trim();
    const sql = String(args.sql || "").trim();
    if (!title || !sql) throw new Error("title 和 sql 不能为空");
    if (!/^(select|with)\b/i.test(sql)) throw new Error("sql 必须是只读 SELECT/WITH 查询");
    const spec = normalizeSpec(args.spec);
    if (spec.metrics.length === 0) throw new Error("spec.metrics 至少需要一个指标列");
    if (spec.type === "scatter" && spec.metrics.length < 2) throw new Error("散点图需要两个指标列");
    if (spec.type === "pie" && (spec.dimension.length !== 1 || spec.metrics.length !== 1)) {
      throw new Error("饼图需要一个维度列和一个指标列");
    }
    const boardId = typeof args.boardId === "string" && args.boardId ? args.boardId : state.activeBoardId;
    let board = state.boards.find((b) => b.id === boardId);
    if (!board) {
      board = { id: boardId, name: "Agent 面板", cards: [] };
      state.boards.push(board);
    }
    const card = {
      id: uid(),
      title,
      sql,
      database: typeof args.database === "string" ? args.database : "",
      connectionId: (typeof args.connectionId === "string" ? args.connectionId : "") || defaultConnectionId(),
      spec,
      createdBy: "agent",
    };
    board.cards.push(card);
    saveBoards(store, state.boards, board.id);
    return toolResult(
      JSON.stringify(
        {
          ok: true,
          boardId: board.id,
          boardName: board.name,
          cardId: card.id,
          title: card.title,
          message: "卡片已写入图表看板；打开 DBX 工作台将自动刷新（约 2 秒）。",
        },
        null,
        2
      )
    );
  }

  if (tool === "remove_card") {
    const cardId = String(args.cardId || "");
    if (!cardId) throw new Error("cardId 不能为空");
    let removed = false;
    for (const board of state.boards) {
      const before = board.cards.length;
      board.cards = board.cards.filter((card) => card.id !== cardId);
      if (board.cards.length !== before) removed = true;
    }
    if (!removed) throw new Error(`未找到卡片: ${cardId}`);
    saveBoards(store, state.boards, state.activeBoardId);
    return toolResult(JSON.stringify({ ok: true, cardId }, null, 2));
  }

  throw new Error(`未知工具: ${tool}`);
}

// ---------- JSON-RPC 循环 ----------
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    sendError(null, -32700, "invalid JSON");
    return;
  }
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    sendError(message && message.id !== undefined ? message.id : null, -32600, "invalid JSON-RPC request");
    return;
  }
  const { id, method, params } = message;
  try {
    if (method === "plugin/initialize") {
      const plugin = (params && params.plugin) || {};
      if (plugin.id && plugin.id !== PLUGIN_ID) throw new Error(`backend identity mismatch: ${plugin.id}`);
      send(id, {
        protocolVersion: 1,
        capabilities: [],
        plugin: { id: PLUGIN_ID, version: PLUGIN_VERSION },
      });
      return;
    }
    if (method === "mcp/tools") {
      send(id, { tools: TOOLS });
      return;
    }
    if (method === "mcp/call") {
      const tool = params && params.tool;
      const args = params && params.arguments && typeof params.arguments === "object" ? params.arguments : {};
      send(id, callTool(tool, args));
      return;
    }
    sendError(id, -32601, `method not found: ${method}`);
  } catch (error) {
    sendError(id, -32000, error && error.message ? error.message : String(error));
  }
});
