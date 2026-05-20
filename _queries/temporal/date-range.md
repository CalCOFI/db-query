---
order: 10
label: casts in date range
parameters:
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
    default: v2026.05.14
sql: |
  SELECT
    cast_id,
    cruise_key,
    datetime_utc,
    lon_dec,
    lat_dec,
    ship_name,
    bottom_depth_m
  FROM read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/{{version}}/parquet/casts.parquet')
  WHERE datetime_utc BETWEEN TIMESTAMP '{{date_min}}' AND TIMESTAMP '{{date_max}}'
  ORDER BY datetime_utc
  {{#if limit}}LIMIT {{limit}}{{/if}};
---

CTD casts whose `datetime_utc` falls in your date window — globally, no
spatial filter. Defaults to all of 2018. Pair this with the **Browse →
cruises** query to see one row per cruise instead of one per cast.
