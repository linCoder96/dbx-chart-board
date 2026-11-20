"""本地开发用：把 dist/ 下的 .dbxp 解包到 DBX 插件注册表（等价于插件中心安装）。

仅用于自签名开发包调试；不会改动任何业务数据。
"""

import hashlib
import os
import json
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path

PLUGIN_ID = "com.dnl.dbx-chart-board"
DBX_HOME = Path(os.environ.get("DBX_HOME", str(Path.home() / "AppData" / "Roaming" / "com.dbx.app")))
ROOT = Path(__file__).resolve().parent.parent
PACKAGE = ROOT / "dist" / "com.dnl.dbx-chart-board-0.1.0-windows-x64.dbxp"
PLUGIN_HOME = DBX_HOME / "plugins" / PLUGIN_ID


def main() -> None:
    with zipfile.ZipFile(PACKAGE) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        version = manifest["version"]
        target = PLUGIN_HOME / "versions" / version
        if target.exists():
            shutil.rmtree(target)
        target.mkdir(parents=True)
        archive.extractall(target)

    activations = PLUGIN_HOME / "activations"
    activations.mkdir(exist_ok=True)
    old = sorted(activations.glob("*.json"))
    sequence = 1
    provenance = {"publisher": "dnl", "source": "file"}
    if old:
        previous = json.loads(old[-1].read_text(encoding="utf-8"))
        sequence = int(previous.get("sequence", 0)) + 1
        provenance = previous.get("provenance", provenance)
        old[-1].unlink()

    record = {
        "sequence": sequence,
        "version": version,
        "packageSha256": hashlib.sha256(PACKAGE.read_bytes()).hexdigest(),
        "activatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "provenance": provenance,
    }
    new_file = activations / f"{sequence:020d}-local-dev.json"
    new_file.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"已安装 {PLUGIN_ID}@{version} → {target}")
    print(f"激活记录：{new_file.name}")


if __name__ == "__main__":
    main()
