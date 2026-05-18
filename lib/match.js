// match.js — browser/Node port of calcofi4r/R/match.R
//
// Pure SQL builders (no I/O) that produce the same DuckDB CTE queries
// calcofi4r emits as `attr(d, "sql")`. The match*() wrappers return
// { sql, queryMeta } so the caller can run sql in DuckDB-WASM (this page),
// the duckdb CLI, Python, or any DuckDB client and get identical rows.
//
// 1:1 port: when calcofi4r/R/match.R changes, this file must follow.
// SQL fidelity is asserted by docs/match/scripts/diff-r-vs-js.sh.

export const VERSION = "0.1.0";

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

// ─── env (CTD-bottle) subquery ──────────────────────────────────────────────
// Mirror of .cc_env_sql
export function buildEnvSQL({
  env_var, version,
  depth_m_min = null, depth_m_max = null,
  date_min = null, date_max = null,
  pad_hours = 0
}) {
  const base = parquetBase(version);

  const filt = [
    `bm.measurement_type = '${sqlEsc(env_var)}'`,
    "bm.measurement_value IS NOT NULL",
    "c.datetime_utc IS NOT NULL",
    "c.lon_dec IS NOT NULL",
    "c.lat_dec IS NOT NULL"
  ];
  if (depth_m_min != null && depth_m_min !== "")
    filt.push(`b.depth_m >= ${Number(depth_m_min)}`);
  if (depth_m_max != null && depth_m_max !== "")
    filt.push(`b.depth_m <= ${Number(depth_m_max)}`);
  if (date_min)
    filt.push(`c.datetime_utc >= TIMESTAMP '${sqlEsc(date_min)}' - INTERVAL '${pad_hours} hours'`);
  if (date_max)
    filt.push(`c.datetime_utc <= TIMESTAMP '${sqlEsc(date_max)}' + INTERVAL '${pad_hours} hours'`);

  // Indents are post-dedent (mirroring R glue::glue's .trim=TRUE behaviour):
  // SELECT at col 0, body at col 2, FROM/JOIN/WHERE at col 0, AND continuations
  // at col 4 (the filt rows are joined verbatim into the WHERE clause).
  return `SELECT
  bm.bottle_measurement_id AS env_id,
  c.datetime_utc           AS env_datetime,
  c.lon_dec                AS env_lon,
  c.lat_dec                AS env_lat,
  bm.measurement_value     AS env_value,
  b.depth_m                AS env_depth_m,
  bm.measurement_type      AS measurement_type
FROM read_parquet('${base}/bottle_measurement.parquet') bm
JOIN read_parquet('${base}/bottle.parquet') b ON bm.bottle_id = b.bottle_id
JOIN read_parquet('${base}/casts.parquet')  c ON b.cast_id    = c.cast_id
WHERE ${filt.join("\n    AND ")}`;
}

// ─── ichthyo bio subquery (shared by name + taxon wrappers) ─────────────────
// Mirror of .cc_bio_sql_ichthyo
export function buildBioSQLIchthyo({
  version, species_where,
  taxon_cte = null,
  life_stage = null,
  date_min = null, date_max = null
}) {
  const base = parquetBase(version);

  const filt = [
    "i.tally IS NOT NULL",
    "i.measurement_type IS NULL",   // NULL measurement_type == count (tally) rows
    "t.time_start IS NOT NULL",
    "s.longitude IS NOT NULL",
    "s.latitude IS NOT NULL"
  ];
  if (species_where) filt.push(species_where);
  if (life_stage && life_stage.length) {
    const stages = (Array.isArray(life_stage) ? life_stage : [life_stage])
      .map(v => `'${sqlEsc(v)}'`).join(", ");
    filt.push(`i.life_stage IN (${stages})`);
  }
  if (date_min) filt.push(`t.time_start >= TIMESTAMP '${sqlEsc(date_min)}'`);
  if (date_max) filt.push(`t.time_start <= TIMESTAMP '${sqlEsc(date_max)}'`);

  // No prefix: SELECT at col 0, body at col 2 (R glue dedents the template
  // by its min common indent, which is 2). With a taxon_cte prefix the
  // prepended "\n  " indents SELECT to col 2, matching the body. Either way
  // FROM/JOIN/WHERE come out at col 0 and AND continuations at col 4.
  const prefix = taxon_cte ? `${taxon_cte}\n  ` : "";

  return `${prefix}SELECT
  i.ichthyo_uuid::VARCHAR AS bio_id,
  t.time_start            AS bio_datetime,
  s.longitude             AS bio_lon,
  s.latitude              AS bio_lat,
  n.std_haul_factor * i.tally / nullif(n.prop_sorted, 0) AS bio_value,
  sp.scientific_name,
  sp.common_name,
  sp.worms_id,
  i.life_stage,
  i.tally
FROM read_parquet('${base}/ichthyo.parquet') i
JOIN read_parquet('${base}/species.parquet') sp ON i.species_id = sp.species_id
JOIN read_parquet('${base}/net.parquet')     n  ON i.net_uuid   = n.net_uuid
JOIN read_parquet('${base}/tow.parquet')     t  ON n.tow_uuid   = t.tow_uuid
JOIN read_parquet('${base}/site.parquet')    s  ON t.site_uuid  = s.site_uuid
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
    ? `sp.scientific_name IN (${names.map(n => `'${sqlEsc(n)}'`).join(", ")})`
    : `(${names.map(n => `sp.scientific_name ILIKE '%${sqlEsc(n)}%'`).join(" OR ")})`;

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
  // Post-dedent indents: WITH at col 0, inner SELECT/FROM/JOIN/WHERE at col 4,
  // UNION ALL at col 2, closing ) at col 0.
  const taxon_cte = `WITH RECURSIVE taxon_tree AS (
    SELECT taxonID
    FROM read_parquet('${base}/taxon.parquet')
    WHERE authority = 'WoRMS' AND taxonID IN (${ids.join(", ")})
  UNION ALL
    SELECT t.taxonID
    FROM read_parquet('${base}/taxon.parquet') t
    JOIN taxon_tree tt ON t.parentNameUsageID = tt.taxonID
    WHERE t.authority = 'WoRMS'
)`;

  const bio = buildBioSQLIchthyo({
    version,
    species_where: "sp.worms_id IN (SELECT taxonID FROM taxon_tree)",
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

  const filt = [
    `n.${biomass_type} IS NOT NULL`,
    "t.time_start IS NOT NULL",
    "s.longitude IS NOT NULL",
    "s.latitude IS NOT NULL"
  ];
  if (date_min) filt.push(`t.time_start >= TIMESTAMP '${sqlEsc(date_min)}'`);
  if (date_max) filt.push(`t.time_start <= TIMESTAMP '${sqlEsc(date_max)}'`);

  // Same post-dedent shape as the env / no-prefix bio templates:
  // SELECT (col 0), body (col 2), FROM/JOIN/WHERE (col 0), AND (col 4).
  const bio = `SELECT
  n.net_uuid::VARCHAR AS bio_id,
  t.time_start        AS bio_datetime,
  s.longitude         AS bio_lon,
  s.latitude          AS bio_lat,
  n.${biomass_type}    AS bio_value,
  '${biomass_type}'    AS biomass_type,
  n.side,
  t.tow_type_key
FROM read_parquet('${base}/net.parquet') n
JOIN read_parquet('${base}/tow.parquet')  t ON n.tow_uuid  = t.tow_uuid
JOIN read_parquet('${base}/site.parquet') s ON t.site_uuid = s.site_uuid
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
