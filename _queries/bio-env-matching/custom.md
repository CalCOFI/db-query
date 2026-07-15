---
order: 40
label: custom (bio + env)
sql_builder: matchBioEnv
parameters:
  bio:
    type: textarea
    label: "bio (SELECT string)"
    required: true
    hint: "must yield bio_id, bio_datetime, bio_lon, bio_lat, bio_value (+ optional descriptive columns)"
    default: |
      SELECT
        o.obs_id::VARCHAR AS bio_id,
        o.datetime AS bio_datetime,
        o.longitude AS bio_lon,
        o.latitude AS bio_lat,
        o.measurement_value * shf.measurement_value / nullif(ps.measurement_value, 0) AS bio_value,
        o.measurement_value AS tally,
        sp.scientific_name,
        o.life_stage
      FROM read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/__VERSION__/parquet/obs.parquet') o
      JOIN read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/__VERSION__/parquet/species.parquet') sp ON CAST(o.taxon_id AS INTEGER) = sp.species_id
      LEFT JOIN read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/__VERSION__/parquet/sample_measurement.parquet') shf ON shf.sample_key = o.sample_key AND shf.measurement_type = 'std_haul_factor'
      LEFT JOIN read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/__VERSION__/parquet/sample_measurement.parquet') ps ON ps.sample_key = o.sample_key AND ps.measurement_type = 'prop_sorted'
      WHERE o.realm = 'bio'
        AND o.dataset_key = 'swfsc_ichthyo'
        AND o.measurement_type = 'abundance'
        AND sp.scientific_name = 'Sardinops sagax'
        AND o.life_stage = 'larva'
        AND o.datetime BETWEEN TIMESTAMP '2018-01-01' AND TIMESTAMP '2018-03-31'
  env:
    type: textarea
    label: "env (SELECT string)"
    required: true
    hint: "must yield env_id, env_datetime, env_lon, env_lat, env_value, env_depth_m, measurement_type"
    default: |
      SELECT
        obs_id AS env_id,
        datetime AS env_datetime,
        longitude AS env_lon,
        latitude AS env_lat,
        measurement_value AS env_value,
        depth_min_m AS env_depth_m,
        measurement_type AS measurement_type
      FROM read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/__VERSION__/parquet/obs.parquet')
      WHERE realm = 'env'
        AND measurement_type = 'temperature'
        AND measurement_value IS NOT NULL
        AND datetime BETWEEN TIMESTAMP '2018-01-01' - INTERVAL '72 hours'
                         AND TIMESTAMP '2018-03-31' + INTERVAL '72 hours'
  max_dist_km:
    type: number
    default: 5
  max_time_hr:
    type: number
    default: 72
  join_method:
    type: radio
    options: [nearest_time, nearest_dist, average]
    default: nearest_time
  version:
    type: text
    default: v2026.05.14
---

Power-user mode. The engine ([`cc_match_bio_env`](https://calcofi.io/calcofi4r/reference/cc_match_bio_env.html))
just needs two `SELECT` sub-queries with the right column contract — drop
in your own and the temporal interval + spatial `ST_Distance_Sphere` join
runs on top.

**Contract.**
`bio` must yield `bio_id` (unique per observation), `bio_datetime`
(`TIMESTAMP`), `bio_lon`, `bio_lat` (decimal degrees) and `bio_value`
(`DOUBLE`). Any extras are carried through to the output as grouping
keys.
`env` must yield exactly `env_id`, `env_datetime`, `env_lon`, `env_lat`,
`env_value`, `env_depth_m`, `measurement_type`.

Default form is the worked example pre-filled — click Run and you get
the same 13 sardine-larva rows.
