"""本地开发调试用：在 DBX app_settings 中为 Chart Board 写入 MCP 工具授权和数据访问授权。

等价于在插件中心/MCP 设置里手工点开开关，仅用于自动化验证。
"""

import json
import os
import sqlite3
from pathlib import Path
from datetime import datetime, timezone

DB = os.environ.get("DBX_HOME", str(Path.home() / "AppData" / "Roaming" / "com.dbx.app")) + "/dbx.db"
PLUGIN_ID = "com.dnl.dbx-chart-board"
CONNECTION_ID = os.environ.get("DBX_DEMO_CONNECTION_ID", "")  # 可选：要授权的示例连接 ID


def main() -> None:
    conn = sqlite3.connect(DB, timeout=10)
    row = conn.execute("select id, settings_json from app_settings limit 1").fetchone()
    if not row:
        raise SystemExit("app_settings 为空：请先启动一次 DBX")
    settings_id, raw = row
    settings = json.loads(raw)
    settings.setdefault("plugin_mcp_grants", {})[PLUGIN_ID] = {
        "external": True,
        "ceiling": "write",
        "approvedTools": {
            "list_boards": "read",
            "add_card": "write",
            "remove_card": "write",
        },
        "disabledTools": [],
    }
    data_dir = os.path.join(os.path.dirname(DB), "plugin-data", PLUGIN_ID)
    import os
    os.makedirs(data_dir, exist_ok=True)
    if CONNECTION_ID:
        with open(os.path.join(data_dir, "chart-board-config.json"), "w", encoding="utf-8") as handle:
            json.dump({"defaultConnectionId": CONNECTION_ID}, handle)
        print("已写入 Agent 卡片默认连接配置")
    grants = settings.setdefault("plugin_data_grants", {})
    allowed = grants.get(PLUGIN_ID) or []
    if isinstance(allowed, list) and CONNECTION_ID and CONNECTION_ID not in allowed:
        allowed.append(CONNECTION_ID)
    if allowed:
        grants[PLUGIN_ID] = allowed
    settings["plugin_mcp_grants_updated_at"] = datetime.now(timezone.utc).isoformat()
    conn.execute(
        "update app_settings set settings_json = ? where id = ?",
        (json.dumps(settings, ensure_ascii=False, separators=(",", ":")), settings_id),
    )
    conn.commit()
    conn.close()
    print(f"已为 {PLUGIN_ID} 写入 MCP write 授权 + 连接数据授权")


if __name__ == "__main__":
    main()
