// match.js — browser/Node port of calcofi4r/R/match.R
//
// Pure SQL builders (no I/O) that produce the same DuckDB CTE queries
// calcofi4r emits as `attr(d, "sql")`. The match*() wrappers return
// { sql, queryMeta } so the caller can run sql in DuckDB-WASM (this page),
// the duckdb CLI, Python, or any DuckDB client and get identical rows.
//
// 1:1 port: when calcofi4r/R/match.R changes, this file must follow.
// SQL fidelity is asserted by docs/match/scripts/diff-r-vs-js.sh.

export const VERSION = "0.3.0";

const GCS_RELEASES = "https://storage.googleapis.com/calcofi-db/ducklake/releases";

// "latest" resolver — synchronous version requires a pre-fetched pointer;
// callers that need to resolve at runtime use resolveLatestVersion() below.
export function parquetBase(version) {
  if (!/^v\d{4}\.\d{2}/.test(version))
    throw new Error(`Version must be in format vYYYY.MM[.DD] (got: ${version})`);
  return `${GCS_RELEASES}/${version}/parquet`;
}

export async function resolveLatestVersion() {
  const r = await fetch(`${GCS_RELEASES}/latest.txt`);
  if (!r.ok) throw new Error(`Could not resolve 'latest' (${r.status})`);
  return (await r.text()).trim();
}

// Pull the distinct read_parquet() URLs out of an emitted SQL string.
export function extractSourceUrls(sql) {
  const hits = sql.match(/read_parquet\('[^']+'/g) || [];
  return [...new Set(hits.map(h => h.replace(/^read_parquet\('|'$/g, "")))].sort();
}

// SQL-escape a single quote in user input.
function sqlEsc(s) { return String(s).replace(/'/g, "''"); }

// ─── core engine ────────────────────────────────────────────────────────────
// Mirror of .cc_build_match_sql + cc_match_bio_env (return_sql/collect ignored;
// this builds the SQL only — the caller runs it).
export function buildMatchSQL({ bio, env, max_dist_km, max_time_hr, join_method }) {
  const where_nearest =
    join_method === "nearest_time" ? "WHERE time_diff_hr = mn_time_diff_hr" :
    join_method === "nearest_dist" ? "WHERE dist_km = mn_dist_km"           :
    join_method === "average"      ? ""                                       :
    (() => { throw new Error(`Unknown join_method: ${join_method}`); })();

  // strip trailing ;/whitespace so nested CTEs concatenate cleanly
  const bioTrim = String(bio).trim().replace(/;\s*$/, "");
  const envTrim = String(env).trim().replace(/;\s*$/, "");

  return `WITH bio AS (
${bioTrim}
),
env AS (
${envTrim}
),
matched AS (
  -- temporal interval join: every env observation within ± max_time_hr
  SELECT
    bio.*,
    env.* EXCLUDE (env_lon, env_lat),
    abs(epoch(bio.bio_datetime) - epoch(env.env_datetime)) / 3600.0 AS time_diff_hr,
    ST_Distance_Sphere(
      ST_Point(bio.bio_lon, bio.bio_lat),
      ST_Point(env.env_lon, env.env_lat)) / 1000.0                  AS dist_km
  FROM bio
  JOIN env
    ON env.env_datetime BETWEEN bio.bio_datetime - INTERVAL '${max_time_hr} hours'
                            AND bio.bio_datetime + INTERVAL '${max_time_hr} hours'
),
within AS (
  -- spatial filter: keep pairs within max_dist_km
  SELECT * FROM matched
  WHERE dist_km <= ${max_dist_km}
),
ranked AS (
  SELECT
    *,
    min(time_diff_hr) OVER (PARTITION BY bio_id) AS mn_time_diff_hr,
    min(dist_km)      OVER (PARTITION BY bio_id) AS mn_dist_km
  FROM within
)
-- one row per bio observation (× measurement_type): env values aggregated
SELECT
  * EXCLUDE (
    env_id, env_value, env_datetime, env_depth_m,
    time_diff_hr, dist_km, mn_time_diff_hr, mn_dist_km),
  count(*)                                            AS n_env,
  avg(env_value)                                      AS env_value,
  CASE WHEN count(*) = 1 THEN 0
       ELSE coalesce(stddev_samp(env_value), 0) END   AS env_value_sd,
  avg(env_depth_m)                                    AS env_depth_m,
  min(env_datetime)                                   AS env_datetime_min,
  max(env_datetime)                                   AS env_datetime_max,
  avg(dist_km)                                        AS dist_km,
  avg(time_diff_hr)                                   AS time_diff_hr
FROM ranked
${where_nearest}
GROUP BY ALL
ORDER BY bio_id`;
}

// ─── env subquery (consolidated obs, realm = 'env') ─────────────────────────
// Mirror of .cc_env_sql. Reads the single-file obs.parquet (not the Hive obs/
// tree — plain HTTPS / DuckDB-WASM cannot glob a directory over GCS).
export function buildEnvSQL({
  env_var, version,
  depth_m_min = null, depth_m_max = null,
  date_min = null, date_max = null,
  pad_hours = 0
}) {
  const base = parquetBase(version);

  const filt = [
    "realm = 'env'",
    `measurement_type = '${sqlEsc(env_var)}'`,
    "measurement_value IS NOT NULL",
    "datetime IS NOT NULL",
    "longitude IS NOT NULL",
    "latitude IS NOT NULL"
  ];
  if (depth_m_min != null && depth_m_min !== "")
    filt.push(`depth_min_m >= ${Number(depth_m_min)}`);
  if (depth_m_max != null && depth_m_max !== "")
    filt.push(`depth_min_m <= ${Number(depth_m_max)}`);
  if (date_min)
    filt.push(`datetime >= TIMESTAMP '${sqlEsc(date_min)}' - INTERVAL '${pad_hours} hours'`);
  if (date_max)
    filt.push(`datetime <= TIMESTAMP '${sqlEsc(date_max)}' + INTERVAL '${pad_hours} hours'`);

  // Indents are post-dedent (mirroring R glue::glue's .trim=TRUE behaviour):
  // SELECT at col 0, body at col 2, FROM/WHERE at col 0, AND continuations at
  // col 4 (the filt rows are joined verbatim into the WHERE clause).
  return `SELECT
  obs_id AS env_id,
  datetime AS env_datetime,
  longitude AS env_lon,
  latitude AS env_lat,
  measurement_value AS env_value,
  depth_min_m AS env_depth_m,
  measurement_type AS measurement_type
FROM read_parquet('${base}/obs.parquet')
WHERE ${filt.join("\n    AND ")}`;
}

// ─── ichthyo bio subquery (shared by name + taxon wrappers) ─────────────────
// Mirror of .cc_bio_sql_ichthyo. Ichthyoplankton abundance now lives in the
// consolidated obs table (realm = 'bio', dataset_key = 'swfsc_ichthyo',
// measurement_type = 'abundance'); net effort (haul factor, sorted proportion)
// comes from sample_measurement, keyed by sample_key. bio_value stays the
// standardized tally (std_haul_factor * count / prop_sorted). Reads the
// single-file obs.parquet (not the Hive obs/ tree — HTTPS can't glob GCS).
export function buildBioSQLIchthyo({
  version, species_where,
  taxon_cte = null,
  life_stage = null,
  date_min = null, date_max = null
}) {
  const base = parquetBase(version);

  const filt = [
    "o.realm = 'bio'",
    "o.dataset_key = 'swfsc_ichthyo'",
    "o.measurement_type = 'abundance'",
    "o.measurement_value IS NOT NULL",
    "o.datetime IS NOT NULL",
    "o.longitude IS NOT NULL",
    "o.latitude IS NOT NULL"
  ];
  if (species_where) filt.push(species_where);
  if (life_stage && life_stage.length) {
    const stages = (Array.isArray(life_stage) ? life_stage : [life_stage])
      .map(v => `'${sqlEsc(v)}'`).join(", ");
    filt.push(`o.life_stage IN (${stages})`);
  }
  if (date_min) filt.push(`o.datetime >= TIMESTAMP '${sqlEsc(date_min)}'`);
  if (date_max) filt.push(`o.datetime <= TIMESTAMP '${sqlEsc(date_max)}'`);

  // No prefix: SELECT at col 0, body at col 2 (R glue dedents the template
  // by its min common indent, which is 2). With a taxon_cte prefix the
  // prepended "\n  " indents SELECT to col 2, matching the body. Either way
  // FROM/JOIN/WHERE come out at col 0 and AND continuations at col 4.
  const prefix = taxon_cte ? `${taxon_cte}\n  ` : "";

  return `${prefix}SELECT
  o.obs_id::VARCHAR AS bio_id,
  o.datetime AS bio_datetime,
  o.longitude AS bio_lon,
  o.latitude AS bio_lat,
  o.measurement_value * shf.measurement_value / nullif(ps.measurement_value, 0) AS bio_value,
  o.measurement_value AS tally,
  o.taxon_key,
  t.scientific_name,
  t.worms_id,
  o.life_stage
FROM read_parquet('${base}/obs.parquet') o
JOIN read_parquet('${base}/taxon.parquet') t ON t.taxon_key = o.taxon_key
LEFT JOIN read_parquet('${base}/sample_measurement.parquet') shf ON shf.sample_key = o.sample_key AND shf.measurement_type = 'std_haul_factor'
LEFT JOIN read_parquet('${base}/sample_measurement.parquet') ps ON ps.sample_key = o.sample_key AND ps.measurement_type = 'prop_sorted'
WHERE ${filt.join("\n    AND ")}`;
}

// ─── helpers shared by every wrapper ────────────────────────────────────────
function defaultTolerances({ max_dist_km, max_time_hr, relax_matching }) {
  return {
    max_dist_km: max_dist_km != null && max_dist_km !== "" ? Number(max_dist_km) : (relax_matching ? 5  : 2),
    max_time_hr: max_time_hr != null && max_time_hr !== "" ? Number(max_time_hr) : (relax_matching ? 72 : 6)
  };
}

function makeQueryMeta(sql, { version, max_dist_km, max_time_hr, join_method }) {
  return {
    package_version: VERSION,
    release_version: version,
    params:          { max_dist_km, max_time_hr, join_method },
    source_urls:     extractSourceUrls(sql),
    generated_at:    new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC")
  };
}

// ─── public match*() wrappers ───────────────────────────────────────────────

// Mirror of cc_match_bio_env (bio + env strings supplied by caller).
export function matchBioEnv({
  bio, env,
  max_dist_km = 2, max_time_hr = 6,
  join_method = "nearest_time",
  version
}) {
  if (!version) throw new Error("matchBioEnv() requires a resolved version (e.g. 'v2026.05.14')");
  if (!bio || !env) throw new Error("matchBioEnv() needs both bio and env SELECT strings");
  const sql = buildMatchSQL({ bio, env, max_dist_km, max_time_hr, join_method });
  return { sql, queryMeta: makeQueryMeta(sql, { version, max_dist_km, max_time_hr, join_method }) };
}

// Mirror of cc_match_ichthyo_by_name
export function matchIchthyoByName({
  scientific_name,                  // string or string[]
  env_var = "temperature",
  exact_match = true,
  life_stage = null,
  date_min = null, date_max = null,
  depth_m_min = null, depth_m_max = null,
  max_dist_km = null, max_time_hr = null,
  relax_matching = false,
  join_method = "nearest_time",
  version
}) {
  if (!version) throw new Error("matchIchthyoByName() requires a resolved version");
  const names = (Array.isArray(scientific_name) ? scientific_name : [scientific_name])
    .filter(Boolean);
  if (!names.length) throw new Error("scientific_name must be a non-empty string or array");

  const { max_dist_km: dk, max_time_hr: th } = defaultTolerances({ max_dist_km, max_time_hr, relax_matching });

  const species_where = exact_match
    ? `t.scientific_name IN (${names.map(n => `'${sqlEsc(n)}'`).join(", ")})`
    : `(${names.map(n => `t.scientific_name ILIKE '%${sqlEsc(n)}%'`).join(" OR ")})`;

  const bio = buildBioSQLIchthyo({
    version, species_where,
    life_stage, date_min, date_max
  });
  const env = buildEnvSQL({
    env_var, version,
    depth_m_min, depth_m_max,
    date_min, date_max, pad_hours: th
  });

  const sql = buildMatchSQL({ bio, env, max_dist_km: dk, max_time_hr: th, join_method });
  return { sql, queryMeta: makeQueryMeta(sql, { version, max_dist_km: dk, max_time_hr: th, join_method }) };
}

// Mirror of cc_match_ichthyo_by_taxon
export function matchIchthyoByTaxon({
  worms_id,                         // number or number[]
  env_var = "temperature",
  life_stage = null,
  date_min = null, date_max = null,
  depth_m_min = null, depth_m_max = null,
  max_dist_km = null, max_time_hr = null,
  relax_matching = false,
  join_method = "nearest_time",
  version
}) {
  if (!version) throw new Error("matchIchthyoByTaxon() requires a resolved version");
  const ids = (Array.isArray(worms_id) ? worms_id : [worms_id])
    .map(v => Number.parseInt(v, 10))
    .filter(v => Number.isFinite(v));
  if (!ids.length) throw new Error("worms_id must be a non-empty integer or integer array");

  const { max_dist_km: dk, max_time_hr: th } = defaultTolerances({ max_dist_km, max_time_hr, relax_matching });
  const base = parquetBase(version);

  // recursive walk of the WoRMS taxon tree: seed taxa + every descendant.
  // Seed taxa by worms_id, walk descendants via parent_taxon_key; yields taxon_key.
  // Post-dedent indents: WITH at col 0, inner SELECT/FROM/JOIN/WHERE at col 4,
  // UNION ALL at col 2, closing ) at col 0.
  const taxon_cte = `WITH RECURSIVE taxon_tree AS (
    SELECT taxon_key
    FROM read_parquet('${base}/taxon.parquet')
    WHERE worms_id IN (${ids.join(", ")})
  UNION ALL
    SELECT t.taxon_key
    FROM read_parquet('${base}/taxon.parquet') t
    JOIN taxon_tree tt ON t.parent_taxon_key = tt.taxon_key
)`;

  const bio = buildBioSQLIchthyo({
    version,
    species_where: "o.taxon_key IN (SELECT taxon_key FROM taxon_tree)",
    taxon_cte,
    life_stage, date_min, date_max
  });
  const env = buildEnvSQL({
    env_var, version,
    depth_m_min, depth_m_max,
    date_min, date_max, pad_hours: th
  });

  const sql = buildMatchSQL({ bio, env, max_dist_km: dk, max_time_hr: th, join_method });
  return { sql, queryMeta: makeQueryMeta(sql, { version, max_dist_km: dk, max_time_hr: th, join_method }) };
}

// Mirror of cc_match_zooplankton_biomass
export function matchZooplanktonBiomass({
  env_var = "temperature",
  biomass_type = "totalplankton",   // or "smallplankton"
  date_min = null, date_max = null,
  depth_m_min = null, depth_m_max = null,
  max_dist_km = null, max_time_hr = null,
  relax_matching = false,
  join_method = "nearest_time",
  version
}) {
  if (!version) throw new Error("matchZooplanktonBiomass() requires a resolved version");
  if (!["totalplankton", "smallplankton"].includes(biomass_type))
    throw new Error(`biomass_type must be 'totalplankton' or 'smallplankton' (got: ${biomass_type})`);

  const { max_dist_km: dk, max_time_hr: th } = defaultTolerances({ max_dist_km, max_time_hr, relax_matching });
  const base = parquetBase(version);

  // map the biomass choice to its sample_measurement measurement_type; net
  // displacement-volume biomass is now long-format in sample_measurement,
  // joined to sample (sample_type = 'net') for position + time.
  const meas_type = {
    totalplankton: "total_plankton_biomass",
    smallplankton: "small_plankton_biomass"
  }[biomass_type];

  const filt = [
    "sm.dataset_key = 'swfsc_ichthyo'",
    `sm.measurement_type = '${meas_type}'`,
    "sm.measurement_value IS NOT NULL",
    "s.datetime IS NOT NULL",
    "s.longitude IS NOT NULL",
    "s.latitude IS NOT NULL"
  ];
  if (date_min) filt.push(`s.datetime >= TIMESTAMP '${sqlEsc(date_min)}'`);
  if (date_max) filt.push(`s.datetime <= TIMESTAMP '${sqlEsc(date_max)}'`);

  // Same post-dedent shape as the env / no-prefix bio templates:
  // SELECT (col 0), body (col 2), FROM/JOIN/WHERE (col 0), AND (col 4).
  const bio = `SELECT
  sm.sample_measurement_id::VARCHAR AS bio_id,
  s.datetime AS bio_datetime,
  s.longitude AS bio_lon,
  s.latitude AS bio_lat,
  sm.measurement_value AS bio_value,
  '${biomass_type}' AS biomass_type
FROM read_parquet('${base}/sample_measurement.parquet') sm
JOIN read_parquet('${base}/sample.parquet') s ON s.sample_key = sm.sample_key
WHERE ${filt.join("\n    AND ")}`;

  const env = buildEnvSQL({
    env_var, version,
    depth_m_min, depth_m_max,
    date_min, date_max, pad_hours: th
  });

  const sql = buildMatchSQL({ bio, env, max_dist_km: dk, max_time_hr: th, join_method });
  return { sql, queryMeta: makeQueryMeta(sql, { version, max_dist_km: dk, max_time_hr: th, join_method }) };
}

// Sentence header to write atop emitted .sql files so they're copy-paste runnable.
export const SQL_HEADER = [
  "-- Re-run in DuckDB (CLI, Python or R) against public CalCOFI release",
  "-- parquet. See https://calcofi.io/docs/data-access.html#reproducibility.",
  "INSTALL httpfs; LOAD httpfs;",
  "INSTALL spatial; LOAD spatial;",
  "",
  ""
].join("\n");

// Convenience: take a {sql} result and prefix the INSTALL/LOAD header.
export function withRunnableHeader(sql) {
  return SQL_HEADER + sql + "\n";
}
