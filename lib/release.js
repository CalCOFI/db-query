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
// Pure functions (resolveTable, readParquetSql, substituteTables) are
// unit-tested with node in test/release.test.js; the fetchers below are the
// browser side (one catalog fetch per version, cached).

export const BUCKET_HTTPS = "https://storage.googleapis.com/calcofi-db";
export const GCS_RELEASES = `${BUCKET_HTTPS}/ducklake/releases`;

export function isVersion(v) {
  return /^v\d{4}\.\d{2}/.test(String(v));
}

// Where a release table's parquet bytes live. Rules, in order (mirrors
// cc_release_sources()):
//   1. entry has objects[] → one https URL per object, in catalog order. A
//      partitioned table's objects carry their `key=value` path segment, so
//      DuckDB's `hive_partitioning = true` recovers the partition column;
//   2. otherwise (catalogs before v2026.09) → the legacy per-release file
//      …/releases/{version}/parquet/{table}.parquet.
// The R/Python references emit an `s3://…/**/*.parquet` glob for a legacy
// PARTITIONED table; the browser cannot glob GCS (no listing, no S3 creds), and
// the legacy layout also ships every non-supplemental table as one consolidated
// file, so that single file is what DuckDB-WASM reads here. (A legacy
// SUPPLEMENTAL partitioned table — obs_ctd_full, obs_mets_full — has no such
// file and 404s before v2026.09; no query on this site names one.)
export function resolveTable(catalog, table, baseHttps = BUCKET_HTTPS) {
  const tables = (catalog && Array.isArray(catalog.tables)) ? catalog.tables : [];
  const entry  = tables.find((t) => t.name === table);
  if (!entry)
    throw new Error(`table '${table}' is not in the catalog for ${catalog && catalog.version}`);
  const partitioned = Boolean(entry.partitioned);
  const version     = String(catalog.version);
  const objs        = Array.isArray(entry.objects) ? entry.objects : [];

  if (objs.length) {
    return {
      urls:      objs.map((o) => `${baseHttps}/${o.path}`),
      hive:      partitioned,
      canonical: true,
      hashes:    objs.map((o) => o.content_hash ?? null)
    };
  }
  return {
    urls:      [`${baseHttps}/ducklake/releases/${version}/parquet/${table}.parquet`],
    hive:      false,
    canonical: false,
    hashes:    [null]
  };
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
// table -> read_parquet(...) SQL for one release, resolved through its catalog.
// `rp.version` is the concrete version ("latest" resolved).
export async function readParquetFor(version = "latest") {
  const catalog = await fetchCatalog(version);
  const rp = (table) => readParquetSql(resolveTable(catalog, table));
  rp.version = String(catalog.version);
  return rp;
}
