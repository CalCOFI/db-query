// release.js — resolve a release table to the parquet it is read from.
//
// Browser port of calcofi4r/R/release_sources.R (cc_catalog(),
// cc_release_sources(), cc_read_parquet_sql()) and calcofi4py release.py
// (release_sources(), read_parquet_sql()). Keep the three in step.
//
// Since the v2026.09 releases the database is content-addressed: each table
// (or each partition of a partitioned table) is one immutable object under
// gs://calcofi-db/ducklake/tables/{table}/{content_hash}/…, and a release's
// catalog.json lists those objects per table in `objects[]`. This is the ONE
// place this site turns a catalog entry into URLs. Never build a
// `releases/{version}/parquet/…` path by hand: that path is only guaranteed to
// answer for the promoted and consolidated versions.
//
// Pure functions (resolveTable, readParquetSql, readParquetSqlForBrowser,
// substituteTables) are unit-tested with node in test/release.test.js; the
// fetchers below are the browser side (one catalog fetch per version, cached).

export const BUCKET_HTTPS = "https://storage.googleapis.com/calcofi-db";
export const GCS_RELEASES = `${BUCKET_HTTPS}/ducklake/releases`;

export function isVersion(v) {
  return /^v\d{4}\.\d{2}/.test(String(v));
}

// Where a release table's parquet bytes live — exactly cc_release_sources().
// Rules, in order:
//   1. entry has objects[] → one https URL per object, in catalog order. A
//      partitioned table's objects carry their `key=value` path segment, so
//      DuckDB's `hive_partitioning = true` recovers the partition column. A
//      partitioned table may ALSO publish one whole-table file (obs does, for
//      DuckDB-WASM and other https-only readers that cannot take a list): the
//      object WITHOUT `partition_by`. It is excluded from `urls` — reading it
//      alongside the partitions would double every row — and exposed as
//      `singleFile`. Read one or the other, never both.
//   2. otherwise (catalogs before v2026.09) → the legacy per-release path
//      …/releases/{version}/parquet/{table}.parquet, or an s3:// glob for a
//      partitioned table (DuckDB cannot glob over https); `obs` is the one
//      legacy partitioned table with a single-file twin.
// Returns { urls, hive, canonical, hashes, localPaths, compatPaths, singleFile,
//           deprecated, replacedBy, removedIn }.
// A name that is a catalog VIEW (see catalogViews) and not a table throws: a
// view has no objects of its own — readParquetFor() expands it.
export function resolveTable(catalog, table, baseHttps = BUCKET_HTTPS) {
  const tables = (catalog && Array.isArray(catalog.tables)) ? catalog.tables : [];
  const entry  = tables.find((t) => t.name === table);
  if (!entry) {
    const views = catalogViews(catalog);
    if (table in views)
      throw new Error(
        `'${table}' is a view in the catalog for ${catalog && catalog.version} (over ` +
        `${viewTables(views[table]).join(", ")}), not a table with parquet objects: ` +
        `readParquetFor() expands it, and viewSql(catalog, '${table}', rp) is its SQL`);
    throw new Error(`table '${table}' is not in the catalog for ${catalog && catalog.version}`);
  }
  const partitioned = Boolean(entry.partitioned);
  const version     = String(catalog.version);
  let   objs        = Array.isArray(entry.objects) ? entry.objects : [];
  // a table the catalog deprecates still resolves — its objects ship through
  // the deprecation window — but says so
  const dep = {
    deprecated: Boolean(entry.deprecated),
    replacedBy: Array.isArray(entry.replaced_by) ? entry.replaced_by.slice() : [],
    removedIn:  entry.removed_in ?? null
  };

  if (objs.length) {
    let singleFile = null;
    if (partitioned) {
      const twin = objs.find((o) => o.partition_by == null);
      if (twin) singleFile = `${baseHttps}/${twin.path}`;
      objs = objs.filter((o) => o.partition_by != null);
    }
    const paths = objs.map((o) => o.path);
    return {
      urls:        paths.map((p) => `${baseHttps}/${p}`),
      hive:        partitioned,
      canonical:   true,
      hashes:      objs.map((o) => o.content_hash ?? null),
      // local mirror of the canonical layout: tables/{table}/[{key}={value}/]{hash}/file
      localPaths:  paths.map((p) => p.replace(/^ducklake\//, "")),
      compatPaths: objs.map((o) => o.compat_path ?? null),
      singleFile,
      ...dep
    };
  }
  if (partitioned) {
    return {
      urls:        [`s3://calcofi-db/ducklake/releases/${version}/parquet/${table}/**/*.parquet`],
      hive:        true,
      canonical:   false,
      hashes:      [null],
      localPaths:  [null],
      compatPaths: [null],
      singleFile:  table === "obs"
        ? `${baseHttps}/ducklake/releases/${version}/parquet/obs.parquet` : null,
      ...dep
    };
  }
  return {
    urls:        [`${baseHttps}/ducklake/releases/${version}/parquet/${table}.parquet`],
    hive:        false,
    canonical:   false,
    hashes:      [null],
    localPaths:  [`releases/${version}/parquet/${table}.parquet`],
    compatPaths: [null],
    singleFile:  null,
    ...dep
  };
}

// ─── catalog views ──────────────────────────────────────────────────────────
// Since the v2026.09 releases (calcofi4db 3.31.0, pre-release plan D-S1) a
// catalog may carry a top-level `views` map: view name → SQL over `{{table}}`
// tokens, one per table the view reads. `obs` is the first: the UNION ALL over
// obs_bio + obs_env that reconstructs its 18 columns under their original
// names, so `__TBL:obs__` keeps working while the observation rows ship once,
// as the pair. The table a view replaces is marked `deprecated` (with
// `replaced_by` / `removed_in`) for the release it still ships in. Mirrors
// calcofi4r cc_catalog_views() / cc_view_tables() / cc_view_sql() and
// calcofi4py catalog_views() / view_tables() / view_sql().
const VIEW_TOKEN = /\{\{([A-Za-z0-9_]+)\}\}/g;

export function catalogViews(catalog) {
  const v = catalog && catalog.views;
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return Object.fromEntries(Object.entries(v).map(([k, s]) => [k, String(s)]));
}

// the distinct tables a view's SQL reads, in order of first appearance
export function viewTables(sql) {
  return [...new Set([...String(sql).matchAll(VIEW_TOKEN)].map((m) => m[1]))];
}

// a view's SQL with every `{{table}}` token replaced by rp(table) — a quoted
// identifier by default (the tables exist in a connection), or whatever the
// caller reads a table through (a read_parquet(...) here). Wrap the result in
// parentheses to use it in a FROM.
export function viewSql(catalog, name, rp = (t) => `"${t}"`) {
  const views = catalogViews(catalog);
  if (!(name in views)) {
    const have = Object.keys(views);
    throw new Error(`'${name}' is not a view in the catalog for ${catalog && catalog.version}` +
                    (have.length ? ` (views: ${have.join(", ")})` : ""));
  }
  let sql = views[name];
  for (const t of viewTables(sql)) sql = sql.split(`{{${t}}}`).join(rp(t));
  return sql;
}

// The read_parquet(...) SQL for a resolved source (mirrors cc_read_parquet_sql()).
export function readParquetSql(src, paths = src.urls) {
  const lst = paths.length === 1
    ? `'${paths[0]}'`
    : `[${paths.map((p) => `'${p}'`).join(", ")}]`;
  return src.hive
    ? `read_parquet(${lst}, hive_partitioning = true)`
    : `read_parquet(${lst})`;
}

// What THIS site reads: DuckDB-WASM cannot glob and prefers one object, so a
// partitioned table is read through its single-file twin when the catalog
// publishes one (no hive segment in that path, so no hive_partitioning),
// else through the explicit https list. Catalog-driven — no table is named.
export function readParquetSqlForBrowser(src) {
  return src.singleFile
    ? readParquetSql({ hive: false }, [src.singleFile])
    : readParquetSql(src);
}

// `__TBL:obs__` → the resolved read_parquet(...) expression. Query templates
// and textarea defaults carry these tokens instead of literal URLs, so the SQL
// shown to (and copied by) the user names the exact objects it read.
export const TABLE_TOKEN = /__TBL:([A-Za-z0-9_]+)__/g;
export function substituteTables(text, rp) {
  return String(text).replace(TABLE_TOKEN, (_, table) => rp(table));
}

// ─── fetchers (browser) ─────────────────────────────────────────────────────

export async function resolveLatestVersion() {
  const r = await fetch(`${GCS_RELEASES}/latest.txt`);
  if (!r.ok) throw new Error(`Could not resolve 'latest' (${r.status})`);
  return (await r.text()).trim();
}

const _catalogs = new Map();

// The release catalog.json, fetched once per version (mirrors cc_catalog()).
export async function fetchCatalog(version = "latest") {
  if (version === "latest") version = await resolveLatestVersion();
  if (!isVersion(version))
    throw new Error(`Version must be 'latest' or in format vYYYY.MM[.DD] (got: ${version})`);
  if (!_catalogs.has(version)) {
    const p = fetch(`${GCS_RELEASES}/${version}/catalog.json`).then((r) => {
      if (!r.ok) throw new Error(`No catalog.json for release ${version} (${r.status})`);
      return r.json();
    });
    p.catch(() => _catalogs.delete(version));   // never cache a failed fetch
    _catalogs.set(version, p);
  }
  return _catalogs.get(version);
}

// Mirror of calcofi4r's .cc_read_parquet(version): a function
// table -> read_parquet(...) SQL for one release, resolved through its catalog
// (single-file twin preferred, see readParquetSqlForBrowser). A catalog VIEW
// (obs over obs_bio + obs_env since v2026.09) expands to its SQL over the
// objects of the tables it reads, parenthesised so `FROM __TBL:obs__ o` stands
// as it did — the deprecated obs table's own objects are never read where the
// catalog can build the view. `rp.version` is the concrete version ("latest"
// resolved). Pure; unit-tested as readParquetForCatalog().
export function readParquetForCatalog(catalog) {
  const views    = catalogViews(catalog);
  const physical = (table) => readParquetSqlForBrowser(resolveTable(catalog, table));
  const rp = (table) => (table in views)
    ? `(${viewSql(catalog, table, physical)})`
    : physical(table);
  rp.version = String(catalog.version);
  return rp;
}

export async function readParquetFor(version = "latest") {
  return readParquetForCatalog(await fetchCatalog(version));
}
