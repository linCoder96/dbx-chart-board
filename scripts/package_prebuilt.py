"""用预编译 Sidecar 构建 .dbxp（官方 CLI 的 package 只接受 rust/go 源码编译）。

产物结构与 dbx-plugin-packager 完全一致：
- 所有包内文件 + checksums.json（sha256）打进 ZIP（deflate）
- 生成同名 .artifact.json（target/sha256/size/url）

用法：python scripts/package_prebuilt.py
"""

import hashlib
import json
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
VERSION = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))["version"]
TARGET = "windows-x64"
PACKAGE_NAME = f"com.dnl.dbx-chart-board-{VERSION}-{TARGET}.dbxp"
EXE_SOURCE = ROOT / "backend" / "bin" / TARGET / "dbx-chart-board-backend.exe"
STAGE = ROOT / "backend" / ".stage-package"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    if not EXE_SOURCE.is_file():
        raise SystemExit(f"缺少预编译 Sidecar：{EXE_SOURCE}")

    if STAGE.exists():
        shutil.rmtree(STAGE)
    STAGE.mkdir(parents=True)
    shutil.copy2(ROOT / "manifest.json", STAGE / "manifest.json")
    for directory in ("assets", "ui"):
        shutil.copytree(ROOT / directory, STAGE / directory)
    exe_target = STAGE / "bin" / TARGET / EXE_SOURCE.name
    exe_target.parent.mkdir(parents=True)
    shutil.copy2(EXE_SOURCE, exe_target)

    files = sorted(
        (p for p in STAGE.rglob("*") if p.is_file()),
        key=lambda p: p.relative_to(STAGE).as_posix(),
    )
    checksums = {
        "algorithm": "sha256",
        "files": {p.relative_to(STAGE).as_posix(): sha256(p) for p in files},
    }
    (STAGE / "checksums.json").write_text(
        json.dumps(checksums, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    DIST.mkdir(exist_ok=True)
    package = DIST / PACKAGE_NAME
    if package.exists():
        package.unlink()
    with zipfile.ZipFile(package, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path in files:
            info = zipfile.ZipInfo(path.relative_to(STAGE).as_posix())
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (0o755 if path.suffix == ".exe" else 0o644) << 16
            archive.writestr(info, path.read_bytes())
        info = zipfile.ZipInfo("checksums.json")
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        archive.writestr(info, (STAGE / "checksums.json").read_bytes())

    artifact = {
        "target": TARGET,
        "url": PACKAGE_NAME,
        "sha256": sha256(package),
        "size": package.stat().st_size,
    }
    (DIST / PACKAGE_NAME.replace(".dbxp", ".artifact.json")).write_text(
        json.dumps(artifact, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    shutil.rmtree(STAGE)
    print(f"已生成：{package}（{artifact['size'] / 1024 / 1024:.1f} MB）")


if __name__ == "__main__":
    main()
