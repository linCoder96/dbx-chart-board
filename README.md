# Chart Board（DBX 插件）

把查询结果一键变成可保存的图表面板 —— 支持 **Agent 通过 MCP 对话自动添加数据卡片**。

## 功能

### 看板 UI
- 入口：连接树右键 →「打开图表看板」（工作台 context 自动携带连接）
- 卡片 = 只读 SQL + 图表规格：柱状 / 折线 / 面积 / 饼图 / 散点，支持堆叠与百分比堆叠
- **智能推断**：按数据形状自动选型（日期维度→折线、文本维度→柱状、双维度→堆叠、双数值→散点）
- 多面板切换；状态存插件自身 `host.storage`（只存 SQL+规格，不存数据）
- **每 2 秒轮询共享状态**：Agent/MCP 写入的卡片会自动出现在打开的工作台
- 护栏：≤2000 行查询、≤300 类目、≤8 系列、≤5000 散点

### MCP 工具（外部 Agent：Claude Code 等）
插件 Sidecar 实现 `mcp/tools` + `mcp/call`，manifest 声明 `external_tools: true`，工具直接出现在 `dbx-mcp` 的 `tools/list`：

| 工具名 | 权限 | 用途 |
|---|---|---|
| `dbx_dbx_chart_board__list_boards` | read | 查看面板与卡片 |
| `dbx_dbx_chart_board__add_card` | write | 添加卡片（`title/sql/spec`，可选 `connectionId/database/boardId`） |
| `dbx_dbx_chart_board__remove_card` | write | 删除卡片（`cardId`） |

Agent 完整链路：
```text
dbx_list_connections → dbx_execute_query（查数）
→ 按数据形状生成 spec → dbx_dbx_chart_board__add_card
→ Sidecar 写 <plugin-data>/ui-storage.json → 工作台 2 秒内自动渲染新卡片
```

## 权限

| 权限 | 用途 |
|---|---|
| `host.data:read` | 在用户授权连接上执行单条只读 SQL |
| `host.storage` | 保存面板配置（≤256 KiB/值，与 Sidecar 共享 ui-storage.json） |

## 构建与本地开发

```bash
# 浏览器联调（无需 DBX；Node 22+）
npx -y @dbx-app/plugin-cli dev --path . --port 5190

# Sidecar 源码 → 单文件 EXE（bun，Windows x64）
bun build backend/index.js --compile --outfile backend/bin/windows-x64/dbx-chart-board-backend.exe

# 打包（预编译 Sidecar 不能走官方 CLI 的 rust/go 编译路径）
python scripts/package_prebuilt.py

# 验证 MCP 工具是否出现在 dbx-mcp（装好后）
node scripts/verify_mcp_tools.mjs
node scripts/verify_mcp_tools.mjs call dbx_dbx_chart_board__list_boards '{}'
```

## 安装（未签名开发包）

1. 插件中心 → 设置 → 第三方与开发者选项 → 开启「允许安装未签名开发包」
2. **在该页面**点「安装 .dbxp」（不要从资源管理器双击），选择：
   `dist/com.dnl.dbx-chart-board-0.2.0-windows-x64.dbxp`
3. 首次查询会在 DBX 弹连接授权；插件工具在 设置 → MCP → Capabilities 中按插件授权

## 已知限制

- Sidecar 目前预编译 Windows x64；macOS/Linux 需在对应平台用 bun 重新编译并调整 manifest 路径
- UI 中文为主；无定时刷新调度 / PNG 导出 / 拖拽布局（后续迭代）
- `host.storage` 整库 ≤1 MiB，面板只存配置，不缓存结果数据
