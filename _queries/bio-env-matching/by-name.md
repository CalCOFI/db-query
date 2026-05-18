---
order: 10
label: by scientific name
sql_builder: matchIchthyoByName
parameters:
  scientific_name:
    type: text
    default: "Sardinops sagax"
    required: true
    hint: toggle exact_match off for ILIKE substring
  env_var:
    type: select
    options_from: measurement_types
    default: temperature
  exact_match:
    type: checkbox
    default: true
  life_stage:
    type: radio
    options: ["", egg, larva]
    default: larva
  date_min:
    type: date
    default: "2018-01-01"
  date_max:
    type: date
    default: "2018-03-31"
  depth_m_min:
    type: number
    default:
    hint: "optional"
  depth_m_max:
    type: number
    default:
    hint: "optional"
  relax_matching:
    type: checkbox
    default: true
    label: relax_matching (5 km / 72 hr)
  max_dist_km:
    type: number
    default:
    hint: "override; leave blank to use relax_matching default"
  max_time_hr:
    type: number
    default:
    hint: "override; leave blank to use relax_matching default"
  join_method:
    type: radio
    options: [nearest_time, nearest_dist, average]
    default: nearest_time
  version:
    type: text
    default: v2026.05.14
---

Net-tow ichthyoplankton matched to CTD-bottle measurements by **scientific
name**. Replaces the retired [`/ichthyodata`](https://api.calcofi.io) Plumber
endpoint.

Mirrors [`calcofi4r::cc_match_ichthyo_by_name()`](https://calcofi.io/calcofi4r/reference/cc_match_ichthyo_by_name.html) —
the SQL emitted here is **character-identical** to its `attr(d, "sql")`. See
the [Matching Helpers](https://calcofi.io/docs/helpers.html) chapter for the
windows, join methods, and version pinning.

Default form returns 13 rows — the same Q1 2018 sardine-larva worked example
used across the docs and the
[vignette](https://calcofi.io/calcofi4r/articles/bio-env-matching.html).
