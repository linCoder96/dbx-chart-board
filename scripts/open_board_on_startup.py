"""本地调试：把图表看板工作台写进 DBX 的 open_tabs 并设为启动激活页签。

仅修改 app_state.open_tabs（页签工作区），不改任何业务数据。需先关闭 DBX 再运行。
"""

import json
import os
import sqlite3
from pathlib import Path
import time
import uuid
from datetime import datetime, timezone

DB = os.environ.get("DBX_HOME", str(Path.home() / "AppData" / "Roaming" / "com.dbx.app")) + "/dbx.db"
PLUGIN_ID = "com.dnl.dbx-chart-board"
CONTRIBUTION = f"{PLUGIN_ID}.workbench"
CONNECTION_ID = os.environ.get("DBX_DEMO_CONNECTION_ID", "")


def main() -> None:
    conn = sqlite3.connect(DB, timeout=10)
    row = conn.execute("select value_json from app_state where key='open_tabs'").fetchone()
    if not row:
        raise SystemExit("open_tabs 不存在")
    state = json.loads(row[0])
    state["tabs"] = [
        tab for tab in state.get("tabs", [])
        if not (tab.get("mode") == "plugin-workbench" and (tab.get("pluginWorkbench") or {}).get("pluginId") == PLUGIN_ID)
    ]
    tab_id = str(uuid.uuid4())
    tab = {
        "id": tab_id,
        "createdAt": int(time.time() * 1000),
        "title": "图表看板",
        "connectionId": CONNECTION_ID,
        "database": os.environ.get("DBX_DEMO_DATABASE", ""),
        "sql": "",
        "isExecuting": False,
        "isCancelling": False,
        "isExplaining": False,
        "mode": "plugin-workbench",
        "pluginWorkbench": {
            "pluginId": PLUGIN_ID,
            "contributionId": CONTRIBUTION,
            "defaultTitle": "图表看板",
            "context": {
                "connectionId": CONNECTION_ID,
                "database": os.environ.get("DBX_DEMO_DATABASE", ""),
                "dbType": "mysql",
                "name": os.environ.get("DBX_DEMO_CONNECTION_NAME", "Demo Connection"),
            },
        },
    }
    state["tabs"].insert(0, tab)
    state["activeTabId"] = tab_id
    for group in state.get("groups", []):
        if group.get("id") == state.get("focusedGroupId", "main"):
            group["tabIds"] = [tab_id] + [tid for tid in group.get("tabIds", []) if tid != tab_id]
            group["activeTabId"] = tab_id
    conn.execute("update app_state set value_json=? where key='open_tabs'", (json.dumps(state, ensure_ascii=False),))
    conn.commit()
    conn.close()
    print(f"已写入工作台页签 {tab_id}，激活时间 {datetime.now(timezone.utc).isoformat()}")


if __name__ == "__main__":
    main()
