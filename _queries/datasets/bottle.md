---
order: 20
label: bottle measurements
parameters:
  env_var:
    type: select
    options_from: measurement_types
    default: temperature
  depth_m_min:
    type: number
    default: 0
  depth_m_max:
    type: number
    default: 500
  date_min:
    type: date
    default: "2018-01-01"
  date_max:
    type: date
    default: "2018-12-31"
  limit:
    type: number
    default: 500
  version:
    type: text
    default: v2026.05.14
sql: |
  SELECT
    c.datetime_utc,
    c.cruise_key,
    c.site_key,
    c.lon_dec,
    c.lat_dec,
    b.depth_m,
    bm.measurement_type,
    bm.measurement_value,
    bm.measurement_qual
  FROM read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/{{version}}/parquet/bottle_measurement.parquet') bm
  JOIN read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/{{version}}/parquet/bottle.parquet') b ON bm.bottle_id = b.bottle_id
  JOIN read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/{{version}}/parquet/casts.parquet')  c ON b.cast_id    = c.cast_id
  WHERE bm.measurement_type = '{{sqlesc env_var}}'
    AND bm.measurement_value IS NOT NULL
    AND b.depth_m BETWEEN {{depth_m_min}} AND {{depth_m_max}}
    AND c.datetime_utc BETWEEN TIMESTAMP '{{date_min}}' AND TIMESTAMP '{{date_max}}'
  ORDER BY c.datetime_utc, b.depth_m
  {{#if limit}}LIMIT {{limit}}{{/if}};
---

`bottle_measurement` ⋈ `bottle` ⋈ `casts` for one `measurement_type` over a
depth + date window. Most CalCOFI oceanographic variables live here:
temperature, salinity, oxygen, nutrients, chlorophyll-a, sigma-theta,
dynamic height, pH, …

The `env_var` dropdown is populated on first focus from
`measurement_type.parquet` so it always reflects the release you're
querying.
