---
order: 20
label: by taxon
sql_builder: matchIchthyoByTaxon
parameters:
  worms_id:
    type: number
    default: 125724
    required: true
    hint: "WoRMS taxonID; 125724 = genus Engraulis"
  env_var:
    type: select
    options_from: measurement_types
    default: temperature
  life_stage:
    type: radio
    options: ["", egg, larva]
    default: ""
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
  max_time_hr:
    type: number
    default:
  join_method:
    type: radio
    options: [nearest_time, nearest_dist, average]
    default: nearest_time
  version:
    type: text
    default: v2026.07.16
---

Net-tow ichthyoplankton matched to CTD-bottle measurements by **WoRMS
taxon ID *and every descendant***. Replaces the retired
[`/itis_ichthyodata`](https://api.calcofi.io) Plumber endpoint, swapping the
dead ITIS `path` regex for a recursive walk of
`taxon.parentNameUsageID` over the WoRMS authority.

Look up a `worms_id` in **Browse → species**, or paste one from
[WoRMS](https://www.marinespecies.org). Default `125724` is the genus
*Engraulis* — its subtree currently resolves to *E. mordax* (northern
anchovy) in the CalCOFI taxonomy.

Mirrors [`calcofi4r::cc_match_ichthyo_by_taxon()`](https://calcofi.io/calcofi4r/reference/cc_match_ichthyo_by_taxon.html).
