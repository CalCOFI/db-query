# CalCOFI Query

**Pick a query on the left, fill the form, click Run.** The SQL runs **in your
browser** via [DuckDB-WASM](https://duckdb.org/docs/api/wasm/overview.html)
against the public CalCOFI release [Parquet on Google Cloud
Storage](https://storage.googleapis.com/calcofi-db/ducklake/releases/). No
server, no credentials, no install.

## What runs where

```
   ┌─────────────┐    ① WASM bundle (cached after first load, ~5 MB)
   │             │ ─────────────────────────────►  jsDelivr CDN
   │ Your browser│
   │ (DuckDB-WASM│    ② Parquet range requests (no auth, CORS open)
   │  in a worker│ ─────────────────────────────►  storage.googleapis.com
   │   thread)   │                                  ↳ /calcofi-db/ducklake/releases/…
   │             │ ◄─────────────────────────────
   └─────────────┘    ③ Arrow result rows
```

Nothing else. No CalCOFI server is involved — DuckDB-WASM does the SQL
planning, the HTTP range requests, and the joins, all on your machine.

## Speed expectations

| Phase | Time |
|---|---|
| **First click** — fetch & instantiate the DuckDB-WASM bundle from jsDelivr | ~3–6 s |
| **First query** — fetch Parquet footers + first row groups over HTTPS | ~10–20 s |
| **Subsequent clicks** — same query / same tables, warm caches | **sub-second** for Browse / Quick facts |
| Bio ↔ Env Matching queries (complex CTEs, joins across 5 tables) | ~5–15 s warm |

Your browser caches the WASM bundle; DuckDB's `httpfs` caches Parquet ranges
in memory across queries. The bigger second-and-onwards cost is **the query
itself** — wide scans of `ctd_thin` (5.5 M rows) or `bottle_measurement`
(11 M rows) take a few seconds even when warm.

## Caveats

- **Bundle weight** — the WASM bundle is ~5 MB, downloaded once and cached.
  Don't try this on cellular if you can help it.
- **Match windows** — the Bio ↔ Env Matching queries default to *relaxed*
  (5 km / 72 hr). Tighter windows (2 km / 6 hr) return fewer rows; see
  [Matching Helpers](https://calcofi.io/docs/helpers.html).
- **Env data ends 2021-05** — CTD-bottle environmental observations stop in
  May 2021, while net-tow biological data runs later. So bio↔env matches
  against dates after 2021-05 return zero rows. The recurring worked example
  uses Q1 2018 for this reason.
- **Reproducibility** — every query takes a `version` parameter (default
  `{{ site.default_version }}`). Pin the version explicitly (e.g.
  `v2026.05.14`) for archival reproducibility — every `read_parquet()` URL
  in the emitted SQL then carries that version.

## The same query, everywhere

| Where | How |
|---|---|
| **R** on your laptop | `calcofi4r::cc_match_ichthyo_by_name(...)` — emits & runs the same SQL; `attr(d, "sql")` hands it back |
| **Python** on a notebook server | `duckdb.connect().sql(open("query.sql").read()).df()` |
| **shell** on the command line | `duckdb < query.sql` |
| **your web browser**, no install | **This page.** Run any query, click **Copy SQL**, paste it anywhere |

The SQL is **byte-identical** across all four — verified in
[CalCOFI/docs](https://calcofi.io/docs/data-access.html#sec-worked-example)
and the
[`bio-env-matching` vignette](https://calcofi.io/calcofi4r/articles/bio-env-matching.html).

## Where to read more

- [**Schema browser**](https://calcofi.io/db-schema/) — ERD, table/column descriptions, units, measurement-type registry for every release. Use it to pick which columns to project before writing a query.
- [**Data Access**](https://calcofi.io/docs/data-access.html) — direct DuckDB + GCS Parquet querying (R, Python, this app)
- [**Matching Helpers**](https://calcofi.io/docs/helpers.html) — the `calcofi4r` R-package wrappers
- [**`calcofi4r` reference**](https://calcofi.io/calcofi4r/reference/index.html) — the R API
- [**Bio ↔ Env Matching vignette**](https://calcofi.io/calcofi4r/articles/bio-env-matching.html) — the worked example, faceted maps + scatter, the 2014–2019 marine heatwave
- [**API → replacement reference**](https://calcofi.io/docs/api.html) — old Plumber endpoints ↔ this app
- [**How to add a new query**](https://github.com/CalCOFI/db-query#adding-a-query) — drop a `.md` in the right folder
- **Source** for this app — [github.com/CalCOFI/db-query](https://github.com/CalCOFI/db-query)
