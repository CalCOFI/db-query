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
      FROM __TBL:taxon__
      WHERE common_name ILIKE '%sardine%'
      ORDER BY scientific_name;
sql: |
  {{{sql}}}
---

Free-form DuckDB SQL against the release Parquet — same engine as the other
queries, no form-driven template. The `httpfs` and `spatial` extensions are
already loaded.

Name a release table as `__TBL:table__` (any table in the release's
`catalog.json` — `__TBL:obs__`, `__TBL:sample__`, `__TBL:cruise__`, …). It is
resolved at Run into the `read_parquet(...)` expression for the pinned release,
so the SQL tab shows exactly what ran and copies anywhere.

Useful for:

- Ad-hoc queries the other forms don't cover
- Trying out a SQL pattern before turning it into a permanent query (drop a
  `.md` file in [the right `_queries/` subfolder](https://github.com/CalCOFI/db-query#adding-a-query))
- Joining tables that aren't paired in the named queries — e.g. `taxa_rank`,
  `cast_condition`, `spatial`, `dic_*`

For arbitrary SQL with no UI at all, [shell.duckdb.org](https://shell.duckdb.org)
is DuckDB's official WASM shell. Same engine, no CalCOFI context.
