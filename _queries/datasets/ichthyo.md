---
order: 10
label: ichthyoplankton
parameters:
  scientific_name:
    type: text
    default: "Sardinops sagax"
    hint: blank to match every species
  life_stage:
    type: radio
    options: ["", egg, larva]
    default: larva
  date_min:
    type: date
    default: "2014-01-01"
  date_max:
    type: date
    default: "2019-12-31"
  limit:
    type: number
    default: 500
  version:
    type: text
    default: v2026.07.16
sql: |
  SELECT
    t.scientific_name,
    t.common_name,
    o.life_stage,
    o.datetime              AS bio_datetime,
    o.longitude             AS bio_lon,
    o.latitude              AS bio_lat,
    o.measurement_value     AS raw_tally,
    o.measurement_value * shf.measurement_value / nullif(ps.measurement_value, 0) AS std_tally,
    shf.measurement_value   AS standard_haul_factor,
    ps.measurement_value    AS prop_sorted,
    vol.measurement_value   AS volume_sampled
  FROM read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/{{version}}/parquet/obs.parquet') o
  JOIN read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/{{version}}/parquet/taxon.parquet') t ON t.taxon_key = o.taxon_key
  LEFT JOIN read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/{{version}}/parquet/sample_measurement.parquet') shf ON shf.sample_key = o.sample_key AND shf.measurement_type = 'std_haul_factor'
  LEFT JOIN read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/{{version}}/parquet/sample_measurement.parquet') ps  ON ps.sample_key  = o.sample_key AND ps.measurement_type  = 'prop_sorted'
  LEFT JOIN read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/{{version}}/parquet/sample_measurement.parquet') vol ON vol.sample_key = o.sample_key AND vol.measurement_type = 'volume_sampled'
  WHERE o.realm = 'bio'
    AND o.dataset_key = 'swfsc_ichthyo'
    AND o.measurement_type = 'abundance'
    {{#if scientific_name}}AND t.scientific_name = '{{sqlesc scientific_name}}'{{/if}}
    {{#if life_stage}}AND o.life_stage = '{{sqlesc life_stage}}'{{/if}}
    AND o.datetime BETWEEN TIMESTAMP '{{date_min}}' AND TIMESTAMP '{{date_max}}'
  ORDER BY o.datetime
  {{#if limit}}LIMIT {{limit}}{{/if}};
---

**Single-table** ichthyoplankton — net-tow counts joined to species, net,
tow, and site, no environmental match. `std_tally` is the standardized
catch-per-effort: `standard_haul_factor × tally / prop_sorted`.

For the same observations **matched to CTD-bottle measurements** (one
`env_value` per row), see **Bio ↔ Env Matching → by name**.
