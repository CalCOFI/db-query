// distanceKmSql(): the haversine that replaced ST_Distance_Sphere(ST_Point(lon, lat)) in the match SQL.
//
//   npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { distanceKmSql, buildMatchSQL } from "../lib/match.js";

// calcofi4r 1.29.0: cc_distance_km_sql("bio.bio_lon", "bio.bio_lat", "env.env_lon", "env.env_lat")
const R_SQL = "(2 * 6371.0088 * asin(sqrt(pow(sin(radians((env.env_lat) - (bio.bio_lat)) / 2), 2) + cos(radians(bio.bio_lat)) * cos(radians(env.env_lat)) * pow(sin(radians((env.env_lon) - (bio.bio_lon)) / 2), 2))))";

test("distanceKmSql is character-for-character calcofi4r's cc_distance_km_sql()", () => {
  assert.equal(distanceKmSql("bio.bio_lon", "bio.bio_lat", "env.env_lon", "env.env_lat"), R_SQL);
});

test("the match SQL measures distance with the haversine, never ST_Distance_Sphere", () => {
  const sql = buildMatchSQL({ bio: "SELECT 1", env: "SELECT 1", max_dist_km: 5, max_time_hr: 24, join_method: "average" });
  assert.ok(sql.includes(R_SQL + " AS dist_km"));
  assert.ok(!/ST_Distance_Sphere/i.test(sql));
});

// the formula itself, evaluated in JS: 1° of latitude is 111.2 km (the swapped call gave 55.6)
test("1 degree of latitude evaluates to 111.195 km", () => {
  const f = distanceKmSql("lon1", "lat1", "lon2", "lat2")
    .replace(/radians/g, "rad").replace(/pow\(/g, "Math.pow(")
    .replace(/\b(asin|sqrt|sin|cos)\(/g, "Math.$1(");
  const rad = (d) => d * Math.PI / 180;
  const km = new Function("rad", "lon1", "lat1", "lon2", "lat2", "return " + f)(rad, -120, 34, -120, 35);
  assert.ok(Math.abs(km - 2 * Math.PI * 6371.0088 / 360) < 1e-9);
});
