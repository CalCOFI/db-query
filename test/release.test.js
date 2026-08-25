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
  resolveTable, readParquetSql, substituteTables, isVersion, fetchCatalog, readParquetFor
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
  assert.equal(readParquetSql(src),
    `read_parquet('${GCS}/ducklake/tables/cruise/a1b2c3d4e5f60718293a4b5c/cruise.parquet')`);
});

test("canonical: partitioned table → one URL per partition object, hive_partitioning", () => {
  const src = resolveTable(canonical, "obs");
  assert.deepEqual(src.urls, [
    `${GCS}/ducklake/tables/obs/year=2019/1111111111111111111111aa/data_0.parquet`,
    `${GCS}/ducklake/tables/obs/year=2020/2222222222222222222222bb/data_0.parquet`
  ]);
  assert.equal(src.hive, true);
  assert.equal(src.canonical, true);
  assert.equal(readParquetSql(src),
    `read_parquet(['${GCS}/ducklake/tables/obs/year=2019/1111111111111111111111aa/data_0.parquet', ` +
    `'${GCS}/ducklake/tables/obs/year=2020/2222222222222222222222bb/data_0.parquet'], hive_partitioning = true)`);
});

test("canonical: supplemental table resolves like any other", () => {
  const src = resolveTable(canonical, "obs_ctd_full");
  assert.deepEqual(src.urls, [`${GCS}/ducklake/tables/obs_ctd_full/year=2019/3333333333333333333333cc/data_0.parquet`]);
  assert.equal(src.hive, true);
  assert.equal(readParquetSql(src),
    `read_parquet('${GCS}/ducklake/tables/obs_ctd_full/year=2019/3333333333333333333333cc/data_0.parquet', hive_partitioning = true)`);
});

test("legacy (no objects[]): per-release parquet path", () => {
  const src = resolveTable(legacy, "cruise");
  assert.deepEqual(src.urls, [`${GCS}/ducklake/releases/v2026.08.14/parquet/cruise.parquet`]);
  assert.equal(src.hive, false);
  assert.equal(src.canonical, false);
  assert.deepEqual(src.hashes, [null]);
  assert.equal(readParquetSql(src),
    `read_parquet('${GCS}/ducklake/releases/v2026.08.14/parquet/cruise.parquet')`);
});

test("legacy partitioned table: the consolidated single file, not an s3:// glob (browser cannot glob GCS)", () => {
  const src = resolveTable(legacy, "obs");
  assert.deepEqual(src.urls, [`${GCS}/ducklake/releases/v2026.08.14/parquet/obs.parquet`]);
  assert.equal(src.hive, false);
  assert.equal(src.canonical, false);
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
  const rp = (t) => readParquetSql(resolveTable(canonical, t));
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
// The promoted release today (v2026.08.25) has no objects[] yet, so every
// table must fall back to the legacy path, and that path must answer over
// https for every table a query here can name. The legacy layout ships no
// consolidated file for the SUPPLEMENTAL partitioned tables (obs_ctd_full,
// obs_mets_full — 404 before v2026.09); no query reads them, so they are
// resolved but not probed.
test("live: promoted catalog resolves and its legacy parquet answers",
  { skip: !process.env.CALCOFI_LIVE && "set CALCOFI_LIVE=1" }, async () => {
  const rp = await readParquetFor("latest");
  assert.match(rp.version, /^v\d{4}\.\d{2}/);
  const catalog = await fetchCatalog(rp.version);
  for (const t of catalog.tables) {
    const src = resolveTable(catalog, t.name);
    if (!src.canonical)
      assert.equal(src.urls[0], `${GCS}/ducklake/releases/${rp.version}/parquet/${t.name}.parquet`);
    if (t.supplemental) continue;
    const r = await fetch(src.urls[0], { headers: { Range: "bytes=0-0" } });
    assert.ok(r.status === 200 || r.status === 206, `${t.name}: ${src.urls[0]} → ${r.status}`);
  }
  assert.equal(rp("obs"), rp.version === "v2026.08.25"
    ? `read_parquet('${GCS}/ducklake/releases/v2026.08.25/parquet/obs.parquet')`
    : rp("obs"));
});
