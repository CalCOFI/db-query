---
order: 30
label: measurement types
parameters:
  provider:
    type: select
    options: [calcofi, swfsc, pic, sccoos, ""]
    default: calcofi
    hint: "blank for all providers"
  version:
    type: text
    default: v2026.05.14
sql: |
  SELECT
    measurement_type,
    units,
    description,
    provider,
    dataset
  FROM read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/{{version}}/parquet/measurement_type.parquet')
  {{#if provider}}
  WHERE provider = '{{sqlesc provider}}'
  {{/if}}
  ORDER BY provider, measurement_type;
---

The `measurement_type` registry — every variable that can appear as a
`measurement_type` value in `bottle_measurement`, `ctd_thin`, `dic_*`,
`ichthyo` etc. Each row has `units` and `description`. Use this list to
pick the right `env_var` for the bio↔env queries.
