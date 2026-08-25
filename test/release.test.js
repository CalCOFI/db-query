// Unit tests for lib/release.js — the catalog → read_parquet() resolver.
//
//   npm test            (offline; both catalog shapes from the calcofi4r fixtures)
//   CALCOFI_LIVE=1 npm test   also checks the promoted release's real catalog
//
// The fixtures are copies of calcofi4r/tests/testthat/fixtures/catalog_*.json —
// the same shapes calcofi4r::cc_release_sources() and calcofi4py's
// release_sources() are tested against, so the three ports cannot drift apart.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  resolveTable, readParquetSql, readParquetSqlForBrowser, substituteTables, isVersion,
  fetchCatalog, readParquetFor
} from "../lib/release.js";
import { extractSourceUrls } from "../lib/match.js";

const here      = dirname(fileURLToPath(import.meta.url));
const fixture   = (f) => JSON.parse(readFileSync(join(here, "fixtures", f), "utf8"));
const canonical = fixture("catalog_canonical.json");
const legacy    = fixture("catalog_legacy.json");

const GCS = "https://storage.googleapis.com/calcofi-db";

test("canonical: single-object table → one content-addressed https URL", () => {
  const src = resolveTable(canonical, "cruise");
  assert.deepEqual(src.urls, [`${GCS}/ducklake/tables/cruise/a1b2c3d4e5f60718293a4b5c/cruise.parquet`]);
  assert.equal(src.hive, false);
  assert.equal(src.canonical, true);
  assert.deepEqual(src.hashes, ["a1b2c3d4e5f60718293a4b5c6d7e8f90"]);
  assert.deepEqual(src.localPaths, ["tables/cruise/a1b2c3d4e5f60718293a4b5c/cruise.parquet"]);
  assert.deepEqual(src.compatPaths, ["ducklake/releases/v2026.09.01/parquet/cruise.parquet"]);
  assert.equal(src.singleFile, null);
  assert.equal(readParquetSql(src),
    `read_parquet('${GCS}/ducklake/tables/cruise/a1b2c3d4e5f60718293a4b5c/cruise.parquet')`);
  assert.equal(readParquetSqlForBrowser(src), readParquetSql(src));
});

test("canonical: partitioned table → one URL per partition object, hive_partitioning; twin excluded", () => {
  const src = resolveTable(canonical, "obs");
  assert.deepEqual(src.urls, [
    `${GCS}/ducklake/tables/obs/year=2019/1111111111111111111111aa/data_0.parquet`,
    `${GCS}/ducklake/tables/obs/year=2020/2222222222222222222222bb/data_0.parquet`
  ]);
  assert.equal(src.hive, true);
  assert.equal(src.canonical, true);
  assert.deepEqual(src.hashes, ["1111111111111111111111aa11111111", "2222222222222222222222bb22222222"]);
  assert.deepEqual(src.localPaths, [
    "tables/obs/year=2019/1111111111111111111111aa/data_0.parquet",
    "tables/obs/year=2020/2222222222222222222222bb/data_0.parquet"]);
  assert.deepEqual(src.compatPaths, [
    "ducklake/releases/v2026.09.01/parquet/obs/year=2019/data_0.parquet",
    "ducklake/releases/v2026.09.01/parquet/obs/year=2020/data_0.parquet"]);
  assert.equal(readParquetSql(src),
    `read_parquet(['${GCS}/ducklake/tables/obs/year=2019/1111111111111111111111aa/data_0.parquet', ` +
    `'${GCS}/ducklake/tables/obs/year=2020/2222222222222222222222bb/data_0.parquet'], hive_partitioning = true)`);
});

test("canonical: the single-file twin (object without partition_by) is singleFile, never in urls", () => {
  const src = resolveTable(canonical, "obs");
  assert.equal(src.singleFile, `${GCS}/ducklake/tables/obs/9999999999999999999999ff/obs.parquet`);
  assert.ok(!src.urls.includes(src.singleFile));
  // the browser reads the twin (one object, no hive segment → no hive_partitioning)
  assert.equal(readParquetSqlForBrowser(src),
    `read_parquet('${GCS}/ducklake/tables/obs/9999999999999999999999ff/obs.parquet')`);
});

test("canonical: supplemental table resolves like any other", () => {
  const src = resolveTable(canonical, "obs_ctd_full");
  assert.deepEqual(src.urls, [`${GCS}/ducklake/tables/obs_ctd_full/year=2019/3333333333333333333333cc/data_0.parquet`]);
  assert.equal(src.hive, true);
  assert.equal(src.singleFile, null);
  assert.equal(readParquetSql(src),
    `read_parquet('${GCS}/ducklake/tables/obs_ctd_full/year=2019/3333333333333333333333cc/data_0.parquet', hive_partitioning = true)`);
  // no twin → the browser takes the explicit list
  assert.equal(readParquetSqlForBrowser(src), readParquetSql(src));
});

test("legacy (no objects[]): per-release parquet path", () => {
  const src = resolveTable(legacy, "cruise");
  assert.deepEqual(src.urls, [`${GCS}/ducklake/releases/v2026.08.14/parquet/cruise.parquet`]);
  assert.equal(src.hive, false);
  assert.equal(src.canonical, false);
  assert.deepEqual(src.hashes, [null]);
  assert.deepEqual(src.localPaths, ["releases/v2026.08.14/parquet/cruise.parquet"]);
  assert.equal(src.singleFile, null);
  assert.equal(readParquetSql(src),
    `read_parquet('${GCS}/ducklake/releases/v2026.08.14/parquet/cruise.parquet')`);
});

test("legacy partitioned table: s3:// glob in urls; obs alone has a single-file twin", () => {
  const obs = resolveTable(legacy, "obs");
  assert.deepEqual(obs.urls, ["s3://calcofi-db/ducklake/releases/v2026.08.14/parquet/obs/**/*.parquet"]);
  assert.equal(obs.hive, true);
  assert.equal(obs.canonical, false);
  assert.equal(obs.singleFile, `${GCS}/ducklake/releases/v2026.08.14/parquet/obs.parquet`);
  assert.equal(readParquetSqlForBrowser(obs),
    `read_parquet('${GCS}/ducklake/releases/v2026.08.14/parquet/obs.parquet')`);
  const ctd = resolveTable(legacy, "obs_ctd_full");
  assert.deepEqual(ctd.urls, ["s3://calcofi-db/ducklake/releases/v2026.08.14/parquet/obs_ctd_full/**/*.parquet"]);
  assert.equal(ctd.singleFile, null);
});

test("unknown table throws, naming the version", () => {
  assert.throws(() => resolveTable(legacy, "casts"), /table 'casts' is not in the catalog for v2026\.08\.14/);
});

test("baseHttps override", () => {
  const src = resolveTable(canonical, "cruise", "https://mirror.example/calcofi-db");
  assert.deepEqual(src.urls, ["https://mirror.example/calcofi-db/ducklake/tables/cruise/a1b2c3d4e5f60718293a4b5c/cruise.parquet"]);
});

test("readParquetSql: paths override (e.g. local downloads) keeps the hive flag", () => {
  const src = resolveTable(canonical, "obs");
  assert.equal(readParquetSql(src, ["/tmp/a.parquet", "/tmp/b.parquet"]),
    "read_parquet(['/tmp/a.parquet', '/tmp/b.parquet'], hive_partitioning = true)");
});

test("substituteTables: __TBL:table__ tokens → read_parquet(), other text untouched", () => {
  const rp = (t) => readParquetSqlForBrowser(resolveTable(canonical, t));
  const sql = "SELECT * FROM __TBL:obs__ o JOIN __TBL:cruise__ c USING (cruise_key) WHERE x = '__not_a_token__'";
  assert.equal(substituteTables(sql, rp),
    `SELECT * FROM ${rp("obs")} o JOIN ${rp("cruise")} c USING (cruise_key) WHERE x = '__not_a_token__'`);
  assert.throws(() => substituteTables("FROM __TBL:casts__", rp), /table 'casts'/);
});

test("extractSourceUrls: both the single-file and the partitioned list forms", () => {
  const rp  = (t) => readParquetSql(resolveTable(canonical, t));
  const sql = `SELECT * FROM ${rp("obs")} o JOIN ${rp("cruise")} c USING (cruise_key) JOIN ${rp("cruise")} d USING (cruise_key)`;
  assert.deepEqual(extractSourceUrls(sql), [
    `${GCS}/ducklake/tables/cruise/a1b2c3d4e5f60718293a4b5c/cruise.parquet`,
    `${GCS}/ducklake/tables/obs/year=2019/1111111111111111111111aa/data_0.parquet`,
    `${GCS}/ducklake/tables/obs/year=2020/2222222222222222222222bb/data_0.parquet`
  ]);
});

test("isVersion", () => {
  assert.equal(isVersion("v2026.08.25"), true);
  assert.equal(isVersion("v2026.09"), true);
  assert.equal(isVersion("latest"), false);
  assert.equal(isVersion("2026.08.25"), false);
});

// ── live (network) ──────────────────────────────────────────────────────────
// Whatever the promoted release's layout, what the browser would read for every
// non-supplemental table must answer over https (the legacy supplemental
// partitioned tables have only an s3:// glob and no twin; no query names them).
test("live: promoted catalog resolves and what the browser reads answers over https",
  { skip: !process.env.CALCOFI_LIVE && "set CALCOFI_LIVE=1" }, async () => {
  const rp = await readParquetFor("latest");
  assert.match(rp.version, /^v\d{4}\.\d{2}/);
  const catalog = await fetchCatalog(rp.version);
  for (const t of catalog.tables) {
    const src = resolveTable(catalog, t.name);
    if (t.supplemental) continue;
    const url = src.singleFile ?? src.urls[0];
    assert.match(url, /^https:/, `${t.name}: browser cannot read ${url}`);
    const r = await fetch(url, { headers: { Range: "bytes=0-0" } });
    assert.ok(r.status === 200 || r.status === 206, `${t.name}: ${url} → ${r.status}`);
  }
  assert.equal(rp("obs"), rp.version === "v2026.08.25"
    ? `read_parquet('${GCS}/ducklake/releases/v2026.08.25/parquet/obs.parquet')`
    : rp("obs"));
});
