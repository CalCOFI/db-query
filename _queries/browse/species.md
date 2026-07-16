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
    default: v2026.07.16
sql: |
  SELECT
    taxon_key,
    scientific_name,
    common_name,
    rank,
    worms_id,
    itis_id,
    gbif_id
  FROM read_parquet('https://storage.googleapis.com/calcofi-db/ducklake/releases/{{version}}/parquet/taxon.parquet')
  {{#if name_like}}
  WHERE   common_name     ILIKE '%{{sqlesc name_like}}%'
       OR scientific_name ILIKE '%{{sqlesc name_like}}%'
  {{/if}}
  ORDER BY scientific_name
  {{#if limit}}LIMIT {{limit}}{{/if}};
---

`taxon.parquet` is the project's unified taxonomic registry — one row per taxon
across every dataset, keyed by `taxon_key` (`worms:<id>` / `itis:<id>`) — with
`scientific_name`, `common_name`, `rank`, and the authority IDs (`worms_id`,
`itis_id`, `gbif_id`). Substring filter on either name. Take the `worms_id` of a
hit and feed it to **Bio ↔ Env Matching → by taxon** to get the matching subtree.
