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
    default: v2026.05.14
sql: |
  SELECT
    sp.scientific_name,
    sp.common_name,
    i.life_stage,
    t.datetime_start_utc            AS bio_datetime,
    s.longitude             AS bio_lon,
    s.latitude              AS bio_lat,
    i.tally                 AS raw_tally,
    n.standard_haul_factor * i.tally / nullif(n.prop_sorted, 0) AS std_tally,
    n.standard_haul_factor,
    n.prop_sorted,
    n.volume_sampled
  FROM read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/{{version}}/parquet/ichthyo.parquet') i
  JOIN read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/{{version}}/parquet/species.parquet') sp ON i.species_id = sp.species_id
  JOIN read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/{{version}}/parquet/net.parquet')     n  ON i.net_uuid   = n.net_uuid
  JOIN read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/{{version}}/parquet/tow.parquet')     t  ON n.tow_uuid   = t.tow_uuid
  JOIN read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/{{version}}/parquet/site.parquet')    s  ON t.site_uuid  = s.site_uuid
  WHERE i.tally IS NOT NULL
    AND i.measurement_type IS NULL
    {{#if scientific_name}}AND sp.scientific_name = '{{sqlesc scientific_name}}'{{/if}}
    {{#if life_stage}}AND i.life_stage = '{{sqlesc life_stage}}'{{/if}}
    AND t.datetime_start_utc BETWEEN TIMESTAMP '{{date_min}}' AND TIMESTAMP '{{date_max}}'
  ORDER BY t.datetime_start_utc
  {{#if limit}}LIMIT {{limit}}{{/if}};
---

**Single-table** ichthyoplankton — net-tow counts joined to species, net,
tow, and site, no environmental match. `std_tally` is the standardized
catch-per-effort: `standard_haul_factor × tally / prop_sorted`.

For the same observations **matched to CTD-bottle measurements** (one
`env_value` per row), see **Bio ↔ Env Matching → by name**.
