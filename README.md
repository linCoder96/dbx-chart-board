# Chart Board（DBX 插件）

把查询结果一键变成可保存的图表面板 —— 面向 DBX 的免配置 AI 图表看板。

## 功能（MVP）

- 纯前端插件（无原生 Sidecar），安装包 `universal`，不改动 DBX 核心
- 入口：连接树右键 →「打开图表看板」（工作台上下文自动携带连接）
- 卡片 = 只读 SQL + 图表规格：柱状 / 折线 / 面积 / 饼图 / 散点，支持堆叠与百分比堆叠
- **智能推断**：按数据形状自动选型（日期维度→折线、文本维度→柱状、双维度→堆叠、双数值→散点、饼图 ≤10 片 + 其他），与 Metabase 的决策树一致
- 客户端按类目聚合（SQL 未 GROUP BY 也不会渲染重复类目）；护栏：≤2000 行查询、≤300 类目、≤8 系列（超出归并「其他」）、≤5000 散点
- 多面板切换；面板持久化在插件自己的 `host.storage`（不触数据库）
- 安全：只读查询走 `host.data:read`（DBX 后端按连接授权 + 只读分类器强制），卡片强制展示 SQL 便于审计

## 权限

| 权限 | 用途 |
|---|---|
| `host.data:read` | 在用户授权的连接上执行单条只读 SQL（`queryData`） |
| `host.storage` | 保存面板与卡片配置（≤256 KiB/值，只存 SQL+规格，不存数据） |

## 本地开发

```bash
# 浏览器内联调（无需启动 DBX；Node 22+）
npx -y @dbx-app/plugin-cli dev --path . --port 5190

# 打包（未签名开发包）
npx -y @dbx-app/plugin-cli package .
```

## 在 DBX 安装（未签名开发包）

1. 插件中心 → 设置 → 展开「第三方与开发者选项」
2. 开启「允许安装未签名开发包」
3. 安装 `.dbxp`，选择 `dist/` 下的产物
4. 在连接树右键任一连接 →「打开图表看板」，点「+ 添加卡片」写一条只读 SELECT
   - 首次查询会弹出该连接的授权确认（插件中心 → 已安装 可随时撤销）

## 已知限制 / 下一步

- UI 目前中文为主（后续补 en 文案与 Manifest 本地化覆盖）
- 外部 AI（Claude Code 等）通过 MCP 直接建面板需要原生 Sidecar（`mcp/tools` + `mcp/call` 桥 + `external_tools: true`），属 Phase 2（依赖 Rust/Go/Bun 工具链决策）
- 无定时刷新 / PNG 导出 / 拖拽布局（规划中）

## 目录

```text
manifest.json       插件契约（权限、入口、连接右键贡献点）
dbx-plugin.toml     打包配置
ui/index.html       工作台页面
ui/app.js           看板逻辑（推断/聚合/ECharts 构建）
ui/vendor/          echarts.min.js（本地内置，沙箱无网络）
```
