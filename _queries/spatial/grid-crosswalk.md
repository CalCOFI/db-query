---
order: 20
label: old grid keys → new cells
parameters:
  prev_grid_keys:
    type: text
    label: previous grid_key(s)
    default: "st30-ln90"
    hint: "comma-separated keys from a release before v2026.10.04, e.g. st30-ln90, st35-ln90"
  value:
    type: number
    default: 100
    hint: "an amount the old cell held (a sample count, say); blank for none"
  min_prev_frac:
    type: number
    default: 0.01
    hint: "skip slivers: new cells holding less than this share of the old cell (0 keeps all)"
  version:
    type: text
    default: v2026.07.16
sql: |
  WITH prev AS (
    SELECT trim(k) AS prev_grid_key
    FROM unnest(string_split('{{sqlesc prev_grid_keys}}', ',')) AS t(k)
    WHERE trim(k) <> ''
  )
  SELECT
    x.prev_grid_key,
    x.grid_key,
    x.prev_grid_key = x.grid_key                     AS same_name,
    g.pattern,
    g.line,
    g.station,
    round(x.overlap_km2, 1)                          AS overlap_km2,
    round(x.prev_frac, 3)                            AS prev_frac,
    round(x.grid_frac, 3)                            AS grid_frac,
    {{#if value}}round({{value}} * x.prev_frac / sum(x.prev_frac) OVER (PARTITION BY x.prev_grid_key), 2) AS value_share,{{/if}}
    round(sum(x.prev_frac) OVER (PARTITION BY x.prev_grid_key), 3) AS prev_frac_kept
  FROM __TBL:grid_crosswalk__ x
  JOIN prev USING (prev_grid_key)
  JOIN __TBL:grid__ g ON g.grid_key = x.grid_key
  {{#if min_prev_frac}}WHERE x.prev_frac >= {{min_prev_frac}}{{/if}}
  ORDER BY x.prev_grid_key, x.prev_frac DESC;
---

Where the water of a **previous** `grid_key` is now. From v2026.10.04 the grid
is one cell per official station (plus the historical cells it keeps), and a key
that survives as a name may name a different polygon: `st30-ln90` was the cell
of four stations and the cell that now carries its name holds about half of
that water. A `grid_key` stored from an earlier release — in a URL, a cache, a
per-cell table of your own — must be mapped through `grid_crosswalk`, never
matched by name.

One row per overlapping (previous cell, current cell) pair:

- `prev_frac` — the share of the **previous** cell's area that lies in this
  cell; `grid_frac` — the share of **this** cell that came from the previous one.
- `same_name` — the key is unchanged. It says nothing about the water: read
  `prev_frac`.
- `value_share` — your `value` split across the new cells in proportion to
  `prev_frac`, so the pieces add back to `value`. `prev_frac` itself is of the
  whole old cell and does not always sum to one (the finer coastline turns up to
  ~2% of an old cell into land), so the shares are rescaled by `prev_frac_kept`.
  To carry a table of per-cell quantities forward, join it to this crosswalk on
  `prev_grid_key` and `sum(value * prev_frac / prev_frac_kept)` by `grid_key`.
  This is right for **counts and totals**; for an intensive quantity (a mean, a
  concentration) use the cell's `prev_frac`-weighted average instead of the sum.
- `line` and `station` are doubles since this release (`st26.7-ln93.3`,
  `st27.7-ln90`): do not parse them out of the key with a whole-number pattern.

A key that returns no rows is not one of the previous release's keys.

`grid_crosswalk` exists from release v2026.10.04 on; pin an earlier `version`
and the query stops with a "table is not in the catalog" message.

Rows in the **sample** tables are already keyed to the current grid in
v2026.10.04; the crosswalk is for keys you hold from before. To go the other
way — which previous cell a current one came from — filter on `grid_key` in the
SQL shell.
