// Every stored query's tables resolve against a real v2026.10.04 catalog shape.
//
//   npm test
//
// test/fixtures/catalog_v2026_10_04.json is that release's catalog.json cut down to table names, one
// object per table (the partition objects of the partitioned ones) and the `obs` view, with the
// content-addressed paths of a promoted release. Two things were not covered before it:
//   · `__TBL:sample_measurement__` (ichthyo.md) — absent from the older fixtures, so "does it
//     resolve?" had no test; and the SQL builders in lib/match.js that name it through rp();
//   · `__TBL:grid_crosswalk__` / `__TBL:grid__` (spatial/grid-crosswalk.md), new in v2026.10.04.
// A query naming a table the catalog does not carry fails here, not at Run in someone's browser.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { readParquetForCatalog, TABLE_TOKEN, substituteTables } from "../lib/release.js";
import * as match from "../lib/match.js";

const here    = dirname(fileURLToPath(import.meta.url));
const root    = join(here, "..");
const catalog = JSON.parse(readFileSync(join(here, "fixtures", "catalog_v2026_10_04.json"), "utf8"));
const GCS     = "https://storage.googleapis.com/calcofi-db";

function queries() {
  const out = [];
  for (const cat of readdirSync(join(root, "_queries"))) {
    for (const f of readdirSync(join(root, "_queries", cat))) {
      if (f.endsWith(".md")) out.push({ id: `${cat}--${f.replace(/\.md$/, "")}`,
        text: readFileSync(join(root, "_queries", cat, f), "utf8") });
    }
  }
  return out;
}

test("every __TBL:table__ token in _queries/ resolves in the v2026.10.04 catalog", () => {
  const rp = readParquetForCatalog(catalog);
  const seen = new Set();
  for (const q of queries()) {
    for (const m of q.text.matchAll(new RegExp(TABLE_TOKEN.source, "g"))) {
      if (m[1] === "table") continue;   // the placeholder the prose names ("`__TBL:table__` tokens"), not a table
      seen.add(m[1]);
      let sql;
      assert.doesNotThrow(() => { sql = rp(m[1]); }, `${q.id}: ${m[0]} must resolve`);
      assert.match(sql, /read_parquet\(/, `${q.id}: ${m[0]} resolves to a read_parquet(...)`);
    }
  }
  // the tables the stored queries read, named so a rename shows up here
  for (const t of ["sample", "cruise", "taxon", "obs", "measurement_type", "sample_measurement",
                   "grid", "grid_crosswalk"])
    assert.ok(seen.has(t), `a stored query reads ${t}`);
});

test("sample_measurement resolves to its one content-addressed object", () => {
  const rp = readParquetForCatalog(catalog);
  const sql = substituteTables("SELECT * FROM __TBL:sample_measurement__ LIMIT 1", rp);
  assert.match(sql, new RegExp(`read_parquet\\('${GCS}/ducklake/tables/sample_measurement/[0-9a-f]+/[^']+\\.parquet'\\)`));
});

test("grid_crosswalk and grid resolve; obs is the view over obs_bio + obs_env", () => {
  const rp = readParquetForCatalog(catalog);
  assert.match(rp("grid_crosswalk"), /tables\/grid_crosswalk\//);
  assert.match(rp("grid"), /tables\/grid\//);
  const obs = rp("obs");
  assert.ok(obs.startsWith("("), "a view is parenthesised");
  assert.match(obs, /tables\/obs_bio\//);
  assert.match(obs, /tables\/obs_env\//);
  assert.doesNotMatch(obs, /tables\/obs\//, "the deprecated obs table is never read where the view builds");
});

test("the matching builders read sample_measurement and obs through the catalog", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => {
    if (String(u).endsWith("/v2026.10.04/catalog.json")) return { ok: true, json: async () => catalog };
    throw new Error(`unexpected fetch ${u}`);
  };
  try {
    const { sql } = await match.matchIchthyoByName({
      scientific_name: "Sardinops sagax", env_var: "temperature", exact_match: true, life_stage: "larva",
      date_min: "2018-01-01", date_max: "2018-03-31", relax_matching: true, join_method: "nearest_time",
      version: "v2026.10.04"
    });
    assert.match(sql, /tables\/sample_measurement\//);
    assert.match(sql, /tables\/obs_env\//);
    assert.doesNotMatch(sql, /__TBL:/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
