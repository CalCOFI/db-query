# CalCOFI Query

A browser-only DuckDB-WASM playground for the public
[CalCOFI release Parquet on Google Cloud Storage](https://storage.googleapis.com/calcofi-db/ducklake/releases/).

**Live:** <https://calcofi.io/db-query/>

Pick a query in the left-side accordion, fill the form, click **Run**. The
SQL runs in your browser — no server, no credentials, no install. Same
engine as `calcofi4r::cc_match_*()` in R or `import duckdb` in Python; the
emitted SQL is byte-identical across all three.

Queries name release tables as `__TBL:table__` tokens, never as URLs. At Run
the app fetches the pinned release's `catalog.json`
(`…/releases/{version}/catalog.json`; `latest.txt` holds the promoted version)
and resolves each token into that release's `read_parquet(...)`: one https URL
per content-addressed object under `ducklake/tables/{table}/{hash}/…` for the
v2026.09+ catalogs (a partitioned table becomes
`read_parquet([...], hive_partitioning = true)`), or the legacy
`…/releases/{version}/parquet/{table}.parquet` for earlier ones — that path is
only guaranteed for promoted/consolidated versions, so it is built nowhere
but that fallback. `lib/release.js` (a port of
`calcofi4r::cc_release_sources()`) is the single place a URL comes from.

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
  release.js          catalog.json → read_parquet() resolver + __TBL:table__ tokens (port of calcofi4r/R/release_sources.R)
  match.js            SQL builders for bio↔env matching (port of calcofi4r/R/match.R)
  options-sources.js  Dynamic <select> options (measurement_types, cruise_keys, …)
  url-params.js       Open a query from a link: the query string fills the section's fields
test/                 `npm test` — lib/release.js against both catalog shapes (fixtures from calcofi4r),
                      and lib/url-params.js against the link a dataset page builds
```

### Open a query from a link

The hash picks the query (`#category--name`); since 2026-09-05 the **query string fills its
fields**, so a link can hand someone a query ready to run:

```
https://calcofi.io/db-query/?sql=SELECT+*+FROM+__TBL%3Aobs__+LIMIT+100%3B#sql-shell--shell
https://calcofi.io/db-query/?env_var=salinity&date_min=2018-01-01#datasets--bottle
```

- `?sql=` with no hash implies `#sql-shell--shell` — it is the only section with a `sql` field.
- Only fields the form actually has are set; a `<select>` value it does not offer is ignored
  rather than blanking the field, so a stale link degrades instead of misleading.
- `?run=1` runs the query once the section is up. Optional and last: everything else works if it
  does not.
- **Values are read, never written back.** `showQuery`'s `replaceState` syncs the hash with a
  fragment-only URL, which leaves the query string exactly as the sender wrote it, and GA still
  records parameter *names* only — a prefilled `sql` is far past GA4's 100-character cap.

Every dataset page on calcofi.io builds one of these: a saved query where db-query has one
(`datasets--bottle`, `datasets--ichthyo`), otherwise the shell with that dataset's SQL prefilled
(CalCOFI.github.io `_plugins/datasets.rb`, UI plan D-6 / Decision 20).

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
  SELECT cruise_key, min(datetime) AS date_start, count(*) AS n_casts
  FROM __TBL:sample__
  WHERE dataset_key = 'calcofi_bottle' AND sample_type = 'cast'
    AND datetime BETWEEN TIMESTAMP '{{date_min}}' AND TIMESTAMP '{{date_max}}'
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
| `__TBL:table__` | not Handlebars — substituted after compile with the release's `read_parquet(...)` for `table`, resolved through `catalog.json` (`lib/release.js`). Use it instead of a literal URL; also works in textarea defaults and the SQL shell |

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
npm test                     # node --test: lib/release.js resolver against both catalog shapes
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
- `lib/release.js` mirrors
  [`calcofi4r/R/release_sources.R`](https://github.com/CalCOFI/calcofi4r/blob/main/R/release_sources.R)
  and `calcofi4py`'s `release.py` exactly (`resolveTable()`); what differs is
  only which source the browser *reads*: a partitioned table goes through its
  single-file twin (`singleFile` — the catalog object without `partition_by`,
  which `obs` publishes) when there is one, else the explicit https list,
  because DuckDB-WASM cannot glob and prefers one object.

## See also

- [CalCOFI Data Access](https://calcofi.io/docs/data-access.html) — direct DuckDB + GCS Parquet querying
- [Matching Helpers](https://calcofi.io/docs/helpers.html) — the `calcofi4r` R wrappers
- [Bio ↔ Env Matching vignette](https://calcofi.io/calcofi4r/articles/bio-env-matching.html) — the worked example, 2014–2019 marine heatwave
- [`calcofi4r` reference](https://calcofi.io/calcofi4r/reference/index.html)
- [API → replacement reference](https://calcofi.io/docs/api.html)
