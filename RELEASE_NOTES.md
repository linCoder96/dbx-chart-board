# Release v0.1.0 — ChatBoard

ChatBoard turns SQL query results into a persistent, conversation-driven dashboard inside DBX: tell an agent what you want and it adds the chart card for you.

## Highlights

- **5 chart types**: bar (auto horizontal for many categories), line, area, pie, scatter.
  Stacking and 100% stacking supported on bar/line/area; a second dimension splits series.
- **Zero-config inference**: date dimension → line, text dimension → bar, two dimensions →
  stacked bar, two numeric columns → scatter. Binds by output column names.
- **MCP agent tools**: `list_boards`, `add_card`, `remove_card` exposed on the external
  `dbx-mcp` server. An agent can query with `dbx_execute_query`, pick a chart from the data
  shape, and call `add_card` — the card appears in an open workbench within ~2 seconds.
- **Safety**: read-only `host.data:read` queries with per-connection consent; SQL shown on
  every card; row/point/category caps; cards persist via `host.storage` (no result data cached).
- **Result-view entry**: right-click a connection → Open ChatBoard.

## Candidate artifacts (unsigned, for store review)

See `release-candidates.json`. Only a `windows-x64` native candidate is provided; the
sidecar is compiled with bun and cannot be cross-built from source without the target toolchain.

The DBX Store signing workflow produces the final signed `.dbxp` and catalog entry; no
`signature.json` or `signingKeyId` is included in this release.

## Source

Apache-2.0. Source, build scripts, and local dev helpers are in this repository.
