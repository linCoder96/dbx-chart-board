# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-11-20

### Added
- Native MCP sidecar (`mcp/tools` + `mcp/call`) with three external-agent tools:
  `list_boards`, `add_card`, `remove_card`; declared with `external_tools: true`.
- Agent-created cards are persisted to the plugin's shared `ui-storage.json` and
  appear in an open workbench within ~2 seconds via polling.
- Cards may carry their own `connectionId`/`database`, so agent-added cards render
  on the intended connection.
- Dialog feedback is visible before chart generation (no more silent query errors).
- `window-x64` prebuilt sidecar packaged via `scripts/package_prebuilt.py`.

## [0.1.0] - 2026-11-20

### Added
- Initial frontend-only chart board: query-result chart cards (bar/line/pie),
  automatic chart-type inference, multi-board management, and `host.storage`
  persistence.
- Connection right-click entry opens the board with the connection context.
