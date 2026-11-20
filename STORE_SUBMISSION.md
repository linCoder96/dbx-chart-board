# 商店提交材料（给 t8y2/dbx-store 维护者参考）

> 这里**不是**最终 catalog 条目。最终条目的 `signingKeyId`、CDN URL、SHA-256 只能由
> DBX Store 签名流程生成；开发者仓库只提供源码、tag 与未签名候选包。

## 作者侧已完成

| 项 | 值 |
|---|---|
| 插件 ID | `com.dnl.dbx-chart-board` |
| 名称 | Chart Board / 图表看板 |
| 版本 | `0.2.0`（git tag `v0.2.0`） |
| 许可证 | Apache-2.0 |
| 候选包 | `dist/com.dnl.dbx-chart-board-0.2.0-windows-x64.dbxp`（未签名） |
| 候选清单 | `release-candidates.json`（含真实 sha256/size） |
| 发布说明 | `RELEASE_NOTES.md` |
| 权限 | `host.data:read`, `host.storage` |
| MCP 工具 | `add_card`, `list_boards`, `remove_card`（`external_tools: true`） |

## 提交到 dbx-store 所需（需公开源码仓库与 GitHub 账号）

1. 将本仓库推送到公开 Git 仓库（GitHub / CNB），设 `source`/`homepage` 到该地址。
2. 创建 GitHub Release `v0.2.0`，上传：
   - `com.dnl.dbx-chart-board-0.2.0-windows-x64.dbxp`
   - `release-candidates.json`
   - `RELEASE_NOTES.md` 内容作为 Release Notes
3. 向 `t8y2/dbx-store` 提 PR，按 `CONTRIBUTING.md` 提供：
   - `plugins/com.dnl.dbx-chart-board.json`（插件元数据 + `mcpTools: true`）
   - `publishers/<id>.json`（发布者身份）
   - 引用上面的 Release tag 与候选清单
4. 维护者审核后由受保护工作流签名并写入最终 catalog（作者不接触签名密钥）。

## 注意

- 当前仓库没有配置 git remote，也未安装 `gh` CLI；我无法代为推送仓库或提交 PR。
- 本地调试脚本（`scripts/grant_local.py` 等）已去除本机路径和连接 ID，可从环境变量覆盖。
