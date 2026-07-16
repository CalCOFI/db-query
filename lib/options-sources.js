// options-sources.js — dynamic `<select>` options sources.
//
// Each entry is keyed by the `options_from:` value used in a query's
// frontmatter, e.g.:
//
//   env_var:
//     type: select
//     options_from: measurement_types
//
// The framework calls `populate(name, selectEl, version)` on page load
// for every <select data-options-from="…">. The fetcher runs against the
// public CalCOFI release Parquet (cached after first call).
//
// To add a new source: register a fetcher below. Each returns a promise
// resolving to an array of { value, label } objects.

import { getConn } from "./duckdb.js";

const _cache = new Map();

const SOURCES = {
  /* env_var dropdown — distinct measurement_type values from the
     measurement_type lookup table */
  measurement_types: async (version) => {
    const conn = await getConn();
    const base = `https://storage.googleapis.com/calcofi-db/ducklake/releases/${version}/parquet`;
    const r = await conn.query(`
      SELECT DISTINCT measurement_type
      FROM read_parquet('${base}/measurement_type.parquet')
      WHERE provider = 'calcofi'
      ORDER BY measurement_type;`);
    return r.toArray().map((row) => ({ value: row.measurement_type, label: row.measurement_type }));
  },

  /* one row per cruise — cruise_key + first/last date for hover hint */
  cruise_keys: async (version) => {
    const conn = await getConn();
    const base = `https://storage.googleapis.com/calcofi-db/ducklake/releases/${version}/parquet`;
    const r = await conn.query(`
      SELECT cruise_key,
             min(datetime) AS d0,
             max(datetime) AS d1
      FROM read_parquet('${base}/sample.parquet')
      WHERE cruise_key IS NOT NULL
      GROUP BY cruise_key
      ORDER BY d0 DESC;`);
    return r.toArray().map((row) => ({
      value: row.cruise_key,
      label: `${row.cruise_key} (${String(row.d0).slice(0,10)})`
    }));
  },

  /* scientific names + worms_id from the unified taxon reference */
  species_names: async (version) => {
    const conn = await getConn();
    const base = `https://storage.googleapis.com/calcofi-db/ducklake/releases/${version}/parquet`;
    const r = await conn.query(`
      SELECT scientific_name, common_name, worms_id
      FROM read_parquet('${base}/taxon.parquet')
      WHERE worms_id IS NOT NULL AND scientific_name IS NOT NULL
      ORDER BY scientific_name;`);
    return r.toArray().map((row) => ({
      value: row.scientific_name,
      label: row.common_name
        ? `${row.scientific_name} — ${row.common_name}`
        : row.scientific_name
    }));
  }
};

export async function loadOptions(name, version) {
  const key = `${name}::${version}`;
  if (_cache.has(key)) return _cache.get(key);
  if (!SOURCES[name])
    throw new Error(`Unknown options_from source: "${name}". Register it in lib/options-sources.js.`);
  const promise = SOURCES[name](version);
  _cache.set(key, promise);
  return promise;
}

// Populate one <select> element's options from a source.
export async function populate(selectEl, name, version) {
  const items = await loadOptions(name, version);
  // preserve the currently selected value if it still exists in the new list
  const current = selectEl.value;
  selectEl.innerHTML = items
    .map((o) => `<option value="${o.value}"${o.value === current ? " selected" : ""}>${o.label}</option>`)
    .join("");
  // if `current` wasn't in the new list, the first option is now selected
}
