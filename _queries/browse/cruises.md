---
order: 10
label: cruises
parameters:
  date_min:
    type: date
    default: "1949-01-01"
  date_max:
    type: date
    default: "2026-12-31"
  limit:
    type: number
    default: 200
    hint: "0 for all rows"
  version:
    type: text
    default: v2026.05.14
sql: |
  WITH cruise_casts AS (
    SELECT
      cruise_key,
      min(datetime_utc) AS date_start,
      max(datetime_utc) AS date_end,
      any_value(ship_name) AS ship_name,
      count(*) AS n_casts
    FROM read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/{{version}}/parquet/casts.parquet')
    WHERE datetime_utc BETWEEN TIMESTAMP '{{date_min}}' AND TIMESTAMP '{{date_max}}'
    GROUP BY cruise_key
  )
  SELECT *
  FROM cruise_casts
  ORDER BY date_start DESC
  {{#if limit}}LIMIT {{limit}}{{/if}};
---

One row per CalCOFI cruise, filtered by the cast `datetime_utc` falling in
your date range. Columns: `cruise_key` (`YYYY-MM-NODC` natural key — see
[Database](https://calcofi.io/docs/db.html)), date span, ship name, number
of casts.

`cruise.parquet` itself only has 691 rows; the `count(*)` lookup against
`casts.parquet` makes the date-window filter meaningful and adds `n_casts`.
