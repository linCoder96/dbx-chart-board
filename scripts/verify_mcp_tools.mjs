/* 直接对 dbx-mcp.exe 说 MCP 协议，验证插件工具是否出现在 tools/list 并可调用。
 * 用法：
 *   node scripts/verify_mcp_tools.mjs                     # 列出工具
 *   node scripts/verify_mcp_tools.mjs call <工具名> '<json参数>'
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";


const CANDIDATES = [
  process.env.DBX_MCP_EXE,
  join(homedir(), "AppData", "Roaming", "nvm", "v22.22.3", "node_modules", "@dbx-app", "mcp-server", "node_modules", "@dbx-app", "mcp-win32-x64", "bin", "dbx-mcp.exe"),
  join(homedir(), "AppData", "Roaming", "npm", "node_modules", "@dbx-app", "mcp-server", "node_modules", "@dbx-app", "mcp-win32-x64", "bin", "dbx-mcp.exe"),
].filter(Boolean);
const EXE = CANDIDATES.find((candidate) => existsSync(candidate)) || CANDIDATES[0];
const child = spawn(EXE, [], { stdio: ["pipe", "pipe", "pipe"] });
let buffer = "";
let callSent = false;
const timer = setTimeout(() => {
  console.error("超时");
  child.kill();
  process.exit(1);
}, 20000);

function send(message) {
  child.stdin.write(JSON.stringify(message) + "\n");
}

child.stderr.on("data", (chunk) => process.stderr.write(String(chunk)));
child.stdout.on("data", (chunk) => {
  buffer += String(chunk);
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message.id === 1) {
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    } else if (message.id === 2) {
      const tools = (message.result?.tools || []).map((t) => t.name);
      const pluginTools = tools.filter((name) => name.includes("chart_board"));
      console.log("工具总数:", tools.length);
      console.log("图表看板工具:", JSON.stringify(pluginTools));
      const mode = process.argv[2];
      if (mode === "call" && process.argv[3]) {
        const args = JSON.parse(process.argv[4] || "{}");
        send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: process.argv[3], arguments: args } });
        callSent = true;
      } else {
        clearTimeout(timer);
        child.kill();
      }
    } else if (message.id === 3) {
      console.log("调用结果:", JSON.stringify(message.result ?? message.error, null, 2));
      clearTimeout(timer);
      child.kill();
    }
  }
});

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "chart-board-verifier", version: "1.0.0" },
  },
});

if (callSent === false && process.argv[2] === "call" && !process.argv[3]) {
  console.error("用法: node verify_mcp_tools.mjs call <工具名> '<json参数>'");
  process.exit(1);
}
