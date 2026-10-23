"""Extracts the Tel Aviv box from an OSM .pbf into Overpass-style JSON layers in data-raw/.
Usage: python scripts/pbf-to-raw.py <israel.osm.pbf>"""
import json, os, sys
import osmium

S, W, N, E = 32.035, 34.74, 32.135, 34.86
OUT = os.path.join(os.path.dirname(__file__), '..', 'data-raw')
inside = lambda lat, lon: S <= lat <= N and W <= lon <= E
AREA_KEYS = ('landuse', 'leisure', 'natural', 'amenity', 'waterway', 'water')
AREA_AMENITY = ('school', 'kindergarten', 'university', 'parking')

layers = {'buildings': [], 'roads': [], 'areas': [], 'trees': []}

def geom(nodes):
    return [{'lat': round(n.lat, 7), 'lon': round(n.lon, 7)} for n in nodes if n.location.valid()]

class H(osmium.SimpleHandler):
    def node(self, n):
        if n.tags.get('natural') == 'tree' and inside(n.location.lat, n.location.lon):
            layers['trees'].append({'type': 'node', 'id': n.id, 'lat': n.location.lat, 'lon': n.location.lon})

    def way(self, w):
        t = dict(w.tags)
        if not t:
            return
        line = t.get('highway') or t.get('railway') in ('rail', 'light_rail', 'subway') or t.get('natural') == 'coastline' or t.get('waterway') in ('river', 'stream', 'canal')
        if not line or w.is_closed() and t.get('area') == 'yes':
            return
        g = geom(w.nodes)
        if not any(inside(p['lat'], p['lon']) for p in g):
            if t.get('natural') != 'coastline' or not any(S - 0.05 <= p['lat'] <= N + 0.05 and W - 0.05 <= p['lon'] <= E for p in g):
                return
        layer = 'roads' if (t.get('highway') or t.get('railway')) else 'areas'
        layers[layer].append({'type': 'way', 'id': w.id, 'tags': t, 'geometry': g})

    def area(self, a):
        t = dict(a.tags)
        is_building = 'building' in t or 'building:part' in t
        is_area = any(k in t for k in AREA_KEYS) and (t.get('amenity') in AREA_AMENITY if 'amenity' in t and not any(k in t for k in AREA_KEYS if k != 'amenity') else True)
        if not (is_building or is_area) or t.get('natural') == 'coastline':
            return
        members = []
        for outer in a.outer_rings():
            og = geom(outer)
            members.append({'type': 'way', 'role': 'outer', 'geometry': og})
            for inner in a.inner_rings(outer):
                members.append({'type': 'way', 'role': 'inner', 'geometry': geom(inner)})
        if not members or not any(inside(p['lat'], p['lon']) for m in members if m['role'] == 'outer' for p in m['geometry']):
            return
        lats = [p['lat'] for m in members for p in m['geometry']]
        lons = [p['lon'] for m in members for p in m['geometry']]
        el = {'type': 'relation', 'id': a.orig_id() * 2 + (0 if a.from_way() else 1), 'tags': t, 'members': members,
              'bounds': {'minlat': min(lats), 'minlon': min(lons), 'maxlat': max(lats), 'maxlon': max(lons)}}
        layers['buildings' if is_building else 'areas'].append(el)

H().apply_file(sys.argv[1], locations=True, idx='flex_mem')
os.makedirs(OUT, exist_ok=True)
for name, els in layers.items():
    with open(os.path.join(OUT, f'{name}_pbf.json'), 'w') as f:
        json.dump({'elements': els}, f)
    print(name, len(els))
