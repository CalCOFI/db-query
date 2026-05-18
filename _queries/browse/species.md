---
order: 20
label: species
parameters:
  name_like:
    type: text
    label: name contains
    default: sardine
    hint: substring match against common_name OR scientific_name
  limit:
    type: number
    default: 100
    hint: "0 for all rows"
  version:
    type: text
    default: v2026.05.14
sql: |
  SELECT
    species_id,
    scientific_name,
    common_name,
    worms_id,
    itis_id,
    gbif_id
  FROM read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/{{version}}/parquet/species.parquet')
  {{#if name_like}}
  WHERE   common_name     ILIKE '%{{sqlesc name_like}}%'
       OR scientific_name ILIKE '%{{sqlesc name_like}}%'
  {{/if}}
  ORDER BY scientific_name
  {{#if limit}}LIMIT {{limit}}{{/if}};
---

`species.parquet` is the project's taxonomic registry — 1150 rows — with
`scientific_name`, `common_name`, and the three taxonomic-authority IDs
(`worms_id`, `itis_id`, `gbif_id`). Substring filter on either name. Take
the `worms_id` of a hit and feed it to **Bio ↔ Env Matching → by taxon**
to get the matching subtree.
