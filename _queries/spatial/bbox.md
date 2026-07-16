---
order: 10
label: casts in bbox
parameters:
  lon_min:
    type: number
    default: -125
  lon_max:
    type: number
    default: -117
  lat_min:
    type: number
    default: 30
  lat_max:
    type: number
    default: 38
  date_min:
    type: date
    default: "2018-01-01"
  date_max:
    type: date
    default: "2018-12-31"
  limit:
    type: number
    default: 500
    hint: "0 for all rows"
  version:
    type: text
    default: v2026.07.16
sql: |
  SELECT
    s.sample_key        AS cast_key,
    s.cruise_key,
    s.grid_key,
    s.datetime          AS datetime_start_utc,
    s.longitude,
    s.latitude,
    cr.ship_name
  FROM read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/{{version}}/parquet/sample.parquet') s
  LEFT JOIN read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/{{version}}/parquet/cruise.parquet') cr USING (cruise_key)
  WHERE s.dataset_key = 'calcofi_bottle' AND s.sample_type = 'cast'
    AND s.longitude BETWEEN {{lon_min}} AND {{lon_max}}
    AND s.latitude BETWEEN {{lat_min}} AND {{lat_max}}
    AND s.datetime BETWEEN TIMESTAMP '{{date_min}}' AND TIMESTAMP '{{date_max}}'
  ORDER BY s.datetime
  {{#if limit}}LIMIT {{limit}}{{/if}};
---

CTD casts whose decimal lon/lat fall inside the bounding box and whose
`datetime_start_utc` falls in the date range. Pasted straight from the CalCOFI
sampling grid: defaults (-125 to -117 lon, 30 to 38 lat) cover the full
historical pattern from Pt. Conception south to Baja and out to ~Sta. 60.

For richer spatial filtering (polygon, transect, distance to shore) use
the **SQL shell** with `ST_Within` / `ST_Distance_Sphere`.
