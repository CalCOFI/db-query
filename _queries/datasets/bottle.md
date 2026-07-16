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
    default: v2026.07.16
sql: |
  SELECT
    o.datetime          AS datetime_start_utc,
    o.cruise_key,
    o.grid_key,
    o.longitude,
    o.latitude,
    o.depth_min_m       AS depth_m,
    o.measurement_type,
    o.measurement_value,
    o.measurement_qual
  FROM read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/{{version}}/parquet/obs.parquet') o
  WHERE o.realm = 'env'
    AND o.dataset_key = 'calcofi_bottle'
    AND o.measurement_type = '{{sqlesc env_var}}'
    AND o.measurement_value IS NOT NULL
    AND o.depth_min_m BETWEEN {{depth_m_min}} AND {{depth_m_max}}
    AND o.datetime BETWEEN TIMESTAMP '{{date_min}}' AND TIMESTAMP '{{date_max}}'
  ORDER BY o.datetime, o.depth_min_m
  {{#if limit}}LIMIT {{limit}}{{/if}};
---

`bottle_measurement` ⋈ `bottle` ⋈ `casts` for one `measurement_type` over a
depth + date window. Most CalCOFI oceanographic variables live here:
temperature, salinity, oxygen, nutrients, chlorophyll-a, sigma-theta,
dynamic height, pH, …

The `env_var` dropdown is populated on first focus from
`measurement_type.parquet` so it always reflects the release you're
querying.
