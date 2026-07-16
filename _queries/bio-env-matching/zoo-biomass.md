---
order: 30
label: zooplankton biomass
sql_builder: matchZooplanktonBiomass
parameters:
  biomass_type:
    type: radio
    options: [totalplankton, smallplankton]
    default: totalplankton
    hint: net displacement-volume biomass (mL)
  env_var:
    type: select
    options_from: measurement_types
    default: temperature
  date_min:
    type: date
    default: "2018-01-01"
  date_max:
    type: date
    default: "2018-12-31"
  depth_m_min:
    type: number
    default:
  depth_m_max:
    type: number
    default:
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

Net-tow **displacement-volume biomass** matched to environmental measurements.
Biomass comes from the `total_plankton_biomass` / `small_plankton_biomass`
measurement types in `sample_measurement` (mL per net haul, joined to `sample`
for position + time); the env side is the same consolidated `obs` table
(`realm = 'env'`) as the other bio↔env queries.

Replaces the retired
[`/zooplankton_biomass`](https://api.calcofi.io) Plumber endpoint. Mirrors
[`calcofi4r::cc_match_zooplankton_biomass()`](https://calcofi.io/calcofi4r/reference/cc_match_zooplankton_biomass.html).
