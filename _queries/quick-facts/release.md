---
order: 10
label: release facts
parameters:
  version:
    type: text
    label: version
    default: v2026.07.16
    hint: pin a release for archival reproducibility
sql: |
  WITH
    cruise_n      AS (SELECT count(*) AS n FROM read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/{{version}}/parquet/cruise.parquet')),
    cast_n        AS (SELECT count(*) AS n FROM read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/{{version}}/parquet/sample.parquet') WHERE dataset_key='calcofi_bottle' AND sample_type='cast'),
    taxon_n       AS (SELECT count(*) AS n FROM read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/{{version}}/parquet/taxon.parquet')),
    ichthyo_n     AS (SELECT count(*) AS n FROM read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/{{version}}/parquet/obs.parquet') WHERE dataset_key='swfsc_ichthyo' AND measurement_type='abundance'),
    bottle_meas_n AS (SELECT count(*) AS n FROM read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/{{version}}/parquet/obs.parquet') WHERE realm='env' AND dataset_key='calcofi_bottle'),
    bio_date_rng  AS (SELECT min(datetime)::VARCHAR AS d0, max(datetime)::VARCHAR AS d1 FROM read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/{{version}}/parquet/obs.parquet') WHERE realm='bio'),
    env_date_rng  AS (SELECT min(datetime)::VARCHAR AS d0, max(datetime)::VARCHAR AS d1 FROM read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/{{version}}/parquet/obs.parquet') WHERE realm='env')
  SELECT  'release_version'  AS metric,  '{{version}}'                  AS value UNION ALL
  SELECT  'cruises',          (SELECT n::VARCHAR FROM cruise_n)         UNION ALL
  SELECT  'casts',            (SELECT n::VARCHAR FROM cast_n)           UNION ALL
  SELECT  'taxa',             (SELECT n::VARCHAR FROM taxon_n)          UNION ALL
  SELECT  'ichthyo_obs',      (SELECT n::VARCHAR FROM ichthyo_n)        UNION ALL
  SELECT  'bottle_obs',       (SELECT n::VARCHAR FROM bottle_meas_n)    UNION ALL
  SELECT  'bio_date_start',   (SELECT d0 FROM bio_date_rng)             UNION ALL
  SELECT  'bio_date_end',     (SELECT d1 FROM bio_date_rng)             UNION ALL
  SELECT  'env_date_start',   (SELECT d0 FROM env_date_rng)             UNION ALL
  SELECT  'env_date_end',     (SELECT d1 FROM env_date_rng);
---

Headline counts and date ranges from the pinned release. A 9-row scorecard:

- **cruises** · **casts** · **species** · **ichthyo_rows** · **bottle_measurements** — table-level row counts.
- **bio_date_start / bio_date_end** — net-tow temporal coverage (`tow.datetime_start_utc`).
- **env_date_start / env_date_end** — CTD-bottle env coverage (`casts.datetime_start_utc`). The gap between this and the bio coverage is why the bio↔env matching examples use 2018 dates.

Each `read_parquet()` URL is bound to `version` — change it and the whole scorecard refreshes against that release. See available releases on [GCS](https://storage.googleapis.com/calcofi-db/ducklake/releases/) (one folder per release).
