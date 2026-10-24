# Macaw Sky · Tel Aviv (תוכי בשמי תל אביב)

A browser game made for Amit and Or. Fly a blue-and-gold or scarlet macaw at golden hour over a real Tel Aviv, and find and land on two special places: David Yellin school (12 Kehilat Varsha St) and Gan Hadar kindergarten (7 Hadar Yosef St).

## Controls

| Action | Keyboard | Touch | Gamepad |
|---|---|---|---|
| Steer, climb, dive (walk on the ground) | Arrows or WASD | Left joystick | Left stick |
| Flap (take off, go up) | Space | Flap button | A |
| Turbo | Shift | Turbo button | RT |
| Land / take off | L | Land button | B |
| Squawk | X | Macaw button | Y |
| Barrel roll | Q / E | | LB / RB |
| Next time of day (sunrise, noon, sunset, night) | T | Pause menu | D-pad left / right |
| Rain on or off | R | Pause menu | D-pad up / down |
| Pause | Esc or P | Pause button | Start |

The start screen and the pause menu also pick the time of day and the rain. Press Land anywhere to glide down. Near a special place, the macaw homes in and lands on it.

## Development

```bash
npm install
npm run dev
```

`npm test` runs the flight behavior tests. `npm run build` type-checks and builds to `dist/`. Each module has a harness page under `dev/` (for example `/dev/city.html`).

The city comes from OpenStreetMap. To refresh it, download `israel-and-palestine-latest.osm.pbf` from Geofabrik, then run `python3 scripts/pbf-to-raw.py <file.pbf>` (needs `pip install osmium`) and `npm run build-data`.

Map data © OpenStreetMap contributors, available under the Open Database License.
