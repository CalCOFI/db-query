# CalCOFI Query

A browser-only DuckDB-WASM playground for the public
[CalCOFI release Parquet on Google Cloud Storage](https://storage.googleapis.com/calcofi-db/ducklake/releases/).

**Live:** <https://calcofi.io/db-query/>

Pick a query in the left-side accordion, fill the form, click **Run**. The
SQL runs in your browser — no server, no credentials, no install. Same
engine as `calcofi4r::cc_match_*()` in R or `import duckdb` in Python; the
emitted SQL is byte-identical across all three.

## Architecture

This is a **Jekyll site**. Every file in `_queries/<category>/<query>.md`
is one query — YAML frontmatter (parameters, optional `sql_builder`),
Markdown description body, and either a `sql: |` template or a delegate to
`lib/match.js`. Jekyll iterates the collection at build time to assemble
the nav and the per-query `<section>` blocks. The browser receives static
HTML; runtime JS just toggles section visibility, reads form values,
compiles Handlebars templates against the form, runs DuckDB-WASM, renders
results.

```
_config.yml           Jekyll config: queries collection, category_titles, default_version
index.html            Template that iterates _queries → nav + per-query <section>s
intro.md              Landing-page Markdown
_layouts/default.html Page shell (header + body + footer)
_includes/
  form-field.html     One form input per `parameters` entry
  result-panel.html   Results / SQL / Metadata sub-tabs
_queries/             ── one .md per query, folder = category ──
  quick-facts/        Quick facts
  browse/             Browse
  spatial/            Spatial
  temporal/           Temporal
  datasets/           Datasets
  bio-env-matching/   Bio ↔ Env Matching
  sql-shell/          SQL shell
app.js                ~250 lines: hash router, form submit, Handlebars compile, DuckDB run, result table
style.css             Dark-default theme; light-theme override via [data-theme=light]
lib/
  duckdb.js           Lazy DuckDB-WASM init (httpfs + spatial)
  match.js            SQL builders for bio↔env matching (port of calcofi4r/R/match.R)
  options-sources.js  Dynamic <select> options (measurement_types, cruise_keys, …)
```

## Adding a query

Drop a `.md` file in the right `_queries/<category>/` subfolder. **The
folder name is the category** (humanized via `category_titles:` in
`_config.yml`); **the file basename is the query label**. Jekyll picks it
up on next build — no manifest to maintain, no nav entry to wire.

Two flavours: inline SQL (Handlebars-templated) or `sql_builder` (delegate
to a JS function).

### Flavour 1 — inline SQL with Handlebars interpolation

```yaml
---
order: 10                        # (optional) sort within category
label: cruises                   # (optional; defaults to filename)
parameters:
  date_min:
    type: date
    default: "2018-01-01"
  date_max:
    type: date
    default: "2018-12-31"
  limit:
    type: number
    default: 100
  version:
    type: text
    default: v2026.05.14
sql: |
  SELECT cruise_key, min(datetime_utc) AS date_start, count(*) AS n_casts
  FROM read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/{{version}}/parquet/casts.parquet')
  WHERE datetime_utc BETWEEN TIMESTAMP '{{date_min}}' AND TIMESTAMP '{{date_max}}'
  GROUP BY cruise_key
  ORDER BY date_start DESC
  {{#if limit}}LIMIT {{limit}}{{/if}};
---

Markdown description here — appears above the form.
```

Available Handlebars helpers in the SQL template:

| Helper | Use |
|---|---|
| `{{var}}` | raw interpolation (no HTML escape — `noEscape: true` on compile) |
| `{{sqlesc var}}` | escape `'` → `''` for user-string SQL values (use this for `text` / `textarea` params inside string literals) |
| `{{sqlList arr}}` | comma-quoted list from an array, e.g. `'a', 'b'` |
| `{{#if var}}…{{else}}…{{/if}}` | conditional include (treats `""` / `null` / `false` as falsy) |
| `{{#unless var}}…{{/unless}}` | inverse of `if` |

### Flavour 2 — delegate to lib/match.js

For queries too complex to template (e.g. the recursive WoRMS taxon walk
in `cc_match_ichthyo_by_taxon`), use a `sql_builder:` reference instead of
an inline `sql:` block:

```yaml
---
sql_builder: matchIchthyoByName        # → resolves to match.matchIchthyoByName(args)
parameters:
  scientific_name: { type: text, default: "Sardinops sagax", required: true }
  ...
---
Description.
```

The named function (in `lib/match.js`) receives the form's `args` and
returns `{ sql, queryMeta }`. The four currently-exported builders are
`matchIchthyoByName` / `matchIchthyoByTaxon` /
`matchZooplanktonBiomass` / `matchBioEnv`.

### Parameter types

| `type` | rendered as | form value |
|---|---|---|
| `text` | `<input type="text">` | string |
| `number` | `<input type="number" step="any">` | number |
| `date` | `<input type="date">` | `"YYYY-MM-DD"` |
| `select` | `<select>` with `options:` array OR `options_from: <source>` (populated at runtime from `lib/options-sources.js`) | string |
| `radio` | `<input type="radio">` group | string |
| `checkbox` | `<input type="checkbox">` | boolean |
| `textarea` | `<textarea>` (spans full row) | string |

### Adding a new **category** (subfolder)

1. Make the folder under `_queries/`.
2. Add an entry to `_config.yml`'s `category_titles:` (display name) and
   `category_order:` (sidebar position).
3. Drop your first `.md` file in.

## Local preview

```sh
bundle install
bundle exec jekyll serve     # → http://localhost:4000/db-query/
```

Or just push to `main` — GitHub Pages builds Jekyll automatically and the
site is live at `https://calcofi.io/db-query/` in ~1 min.

## Caveats

- First-click cold start is ~5 s for DuckDB-WASM init + ~10–20 s for
  Parquet footers on the bio↔env match. Subsequent runs sub-second for
  browse / quick-facts; ~5–15 s for the bio↔env matches.
- The bundle is ~5 MB on first load (cached afterwards).
- `lib/match.js` is a 1:1 port of
  [`calcofi4r/R/match.R`](https://github.com/CalCOFI/calcofi4r/blob/main/R/match.R) —
  when that R file changes, this one must follow. See verification diff in
  the [CalCOFI/docs](https://github.com/CalCOFI/docs) pull-request history.

## See also

- [CalCOFI Data Access](https://calcofi.io/docs/data-access.html) — direct DuckDB + GCS Parquet querying
- [Matching Helpers](https://calcofi.io/docs/helpers.html) — the `calcofi4r` R wrappers
- [Bio ↔ Env Matching vignette](https://calcofi.io/calcofi4r/articles/bio-env-matching.html) — the worked example, 2014–2019 marine heatwave
- [`calcofi4r` reference](https://calcofi.io/calcofi4r/reference/index.html)
- [API → replacement reference](https://calcofi.io/docs/api.html)
