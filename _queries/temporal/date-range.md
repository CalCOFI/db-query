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
    default: v2026.07.16
sql: |
  SELECT
    s.sample_key        AS cast_key,
    s.cruise_key,
    s.datetime          AS datetime_start_utc,
    s.longitude,
    s.latitude,
    cr.ship_name
  FROM read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/{{version}}/parquet/sample.parquet') s
  LEFT JOIN read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/{{version}}/parquet/cruise.parquet') cr USING (cruise_key)
  WHERE s.dataset_key = 'calcofi_bottle' AND s.sample_type = 'cast'
    AND s.datetime BETWEEN TIMESTAMP '{{date_min}}' AND TIMESTAMP '{{date_max}}'
  ORDER BY s.datetime
  {{#if limit}}LIMIT {{limit}}{{/if}};
---

CTD casts whose `datetime_start_utc` falls in your date window — globally, no
spatial filter. Defaults to all of 2018. Pair this with the **Browse →
cruises** query to see one row per cruise instead of one per cast.
