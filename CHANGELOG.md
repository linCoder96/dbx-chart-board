# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-20

### Added
- Initial release: persistent chart-board workbench with bar/line/area/pie/scatter cards,
  automatic chart-type inference from data shape, multi-board management, and `host.storage`
  persistence (only SQL + spec stored, no result data cached).
- Native MCP sidecar (`mcp/tools` + `mcp/call`) with three external-agent tools:
  `list_boards`, `add_card`, `remove_card`; declared with `external_tools: true`.
- Agent-created cards persisted to the plugin's shared `ui-storage.json` and appear in an
  open workbench within ~2 seconds via polling.
- Cards may carry their own `connectionId`/`database`, so agent-added cards render on the
  intended connection.
- Connection right-click entry opens the board with the connection context.
- Guardrails: ≤2000 rows per query, ≤300 categories, ≤8 series, ≤5000 scatter points;
  SQL shown on every card for auditability.
- `window-x64` prebuilt sidecar packaged via `scripts/package_prebuilt.py`.
