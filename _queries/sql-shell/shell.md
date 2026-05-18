---
order: 10
label: shell
parameters:
  sql:
    type: textarea
    label: "SQL"
    required: true
    default: |
      SELECT scientific_name, common_name, worms_id
      FROM read_parquet(
        'https://storage.googleapis.com/calcofi-db/ducklake/releases/v2026.05.14/parquet/species.parquet')
      WHERE common_name ILIKE '%sardine%'
      ORDER BY scientific_name;
sql: |
  {{{sql}}}
---

Free-form DuckDB SQL against the release Parquet — same engine as the other
queries, no form-driven template. The `httpfs` and `spatial` extensions are
already loaded.

Useful for:

- Ad-hoc queries the other forms don't cover
- Trying out a SQL pattern before turning it into a permanent query (drop a
  `.md` file in [the right `_queries/` subfolder](https://github.com/CalCOFI/query#adding-a-query))
- Joining tables that aren't paired in the named queries — e.g. `taxa_rank`,
  `cast_condition`, `_spatial`, `dic_*`

For arbitrary SQL with no UI at all, [shell.duckdb.org](https://shell.duckdb.org)
is DuckDB's official WASM shell. Same engine, no CalCOFI context.
