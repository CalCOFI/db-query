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
        i.ichthyo_uuid::VARCHAR AS bio_id,
        t.time_start            AS bio_datetime,
        s.longitude             AS bio_lon,
        s.latitude              AS bio_lat,
        n.std_haul_factor * i.tally / nullif(n.prop_sorted, 0) AS bio_value,
        sp.scientific_name,
        i.life_stage,
        i.tally
      FROM read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/v2026.05.14/parquet/ichthyo.parquet') i
      JOIN read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/v2026.05.14/parquet/species.parquet') sp ON i.species_id = sp.species_id
      JOIN read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/v2026.05.14/parquet/net.parquet')     n  ON i.net_uuid   = n.net_uuid
      JOIN read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/v2026.05.14/parquet/tow.parquet')     t  ON n.tow_uuid   = t.tow_uuid
      JOIN read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/v2026.05.14/parquet/site.parquet')    s  ON t.site_uuid  = s.site_uuid
      WHERE i.tally IS NOT NULL
        AND i.measurement_type IS NULL
        AND sp.scientific_name = 'Sardinops sagax'
        AND i.life_stage = 'larva'
        AND t.time_start BETWEEN TIMESTAMP '2018-01-01' AND TIMESTAMP '2018-03-31'
  env:
    type: textarea
    label: "env (SELECT string)"
    required: true
    hint: "must yield env_id, env_datetime, env_lon, env_lat, env_value, env_depth_m, measurement_type"
    default: |
      SELECT
        bm.bottle_measurement_id AS env_id,
        c.datetime_utc           AS env_datetime,
        c.lon_dec                AS env_lon,
        c.lat_dec                AS env_lat,
        bm.measurement_value     AS env_value,
        b.depth_m                AS env_depth_m,
        bm.measurement_type      AS measurement_type
      FROM read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/v2026.05.14/parquet/bottle_measurement.parquet') bm
      JOIN read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/v2026.05.14/parquet/bottle.parquet') b ON bm.bottle_id = b.bottle_id
      JOIN read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/v2026.05.14/parquet/casts.parquet')  c ON b.cast_id    = c.cast_id
      WHERE bm.measurement_type = 'temperature'
        AND bm.measurement_value IS NOT NULL
        AND c.datetime_utc BETWEEN TIMESTAMP '2018-01-01' - INTERVAL '72 hours'
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
