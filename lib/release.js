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
// Returns { urls, hive, canonical, hashes, localPaths, compatPaths, singleFile }.
export function resolveTable(catalog, table, baseHttps = BUCKET_HTTPS) {
  const tables = (catalog && Array.isArray(catalog.tables)) ? catalog.tables : [];
  const entry  = tables.find((t) => t.name === table);
  if (!entry)
    throw new Error(`table '${table}' is not in the catalog for ${catalog && catalog.version}`);
  const partitioned = Boolean(entry.partitioned);
  const version     = String(catalog.version);
  let   objs        = Array.isArray(entry.objects) ? entry.objects : [];

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
      singleFile
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
        ? `${baseHttps}/ducklake/releases/${version}/parquet/obs.parquet` : null
    };
  }
  return {
    urls:        [`${baseHttps}/ducklake/releases/${version}/parquet/${table}.parquet`],
    hive:        false,
    canonical:   false,
    hashes:      [null],
    localPaths:  [`releases/${version}/parquet/${table}.parquet`],
    compatPaths: [null],
    singleFile:  null
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
// (single-file twin preferred, see readParquetSqlForBrowser). `rp.version` is
// the concrete version ("latest" resolved).
export async function readParquetFor(version = "latest") {
  const catalog = await fetchCatalog(version);
  const rp = (table) => readParquetSqlForBrowser(resolveTable(catalog, table));
  rp.version = String(catalog.version);
  return rp;
}
