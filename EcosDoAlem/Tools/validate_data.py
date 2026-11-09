#!/usr/bin/env python3
"""Valida map_data.json e props_layout.json: cômodos, portas, área de abertura das portas,
móveis fora do lugar/sobrepostos/em cima de escadas e se todos os cômodos são alcançáveis.
Uso: python3 validate_data.py [pasta com os JSONs]"""
import json, sys, os, itertools, collections
d = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'Assets', 'Data')
m = json.load(open(os.path.join(d, 'map_data.json'), encoding='utf-8'))
p = json.load(open(os.path.join(d, 'props_layout.json'), encoding='utf-8'))
errors, warns = [], []
FH = m['dimensions']['floor_height']
def rect(r): return (*r['bounds']['min'], *r['bounds']['max'])
def overlap(a, b, e=1e-6): return a[0] < b[2]-e and b[0] < a[2]-e and a[1] < b[3]-e and b[1] < a[3]-e
def inside(pt, r): return r[0] <= pt[0] <= r[2] and r[1] <= pt[1] <= r[3]
def room_at(rooms, x, z):
    for n, r in rooms.items():
        if r[0] < x < r[2] and r[1] < z < r[3]: return n
    return None

rooms, outdoor = {}, set()
for f in m['floors']:
    for a, b in itertools.combinations(f['rooms'], 2):
        if overlap(rect(a), rect(b)): errors.append(f"Andar {f['floor_index']}: '{a['name']}' sobrepõe '{b['name']}'")
    rooms[f['floor_index']] = {r['name']: rect(r) for r in f['rooms']}
    outdoor |= {r['name'] for r in f['rooms'] if r.get('outdoor')}

holes = [(c['position']['x'][0], c['position']['z'][0], c['position']['x'][1], c['position']['z'][1]) for c in m['vertical_connectors']]
blocks = [(b['min'][0], b['min'][2], b['max'][0], b['max'][2], b.get('floor', 0)) for b in m.get('solid_blocks', [])]

# Portas: sobre a borda compartilhada + área de giro livre
swings = []  # (floor, rect, door id)
graph = collections.defaultdict(set)
for f in m['floors']:
    fr = rooms[f['floor_index']]
    for dr in f.get('doors', []):
        a, b = dr['rooms']; cx, cz = dr['center']; w = dr['width']
        for n in (a, b):
            if n != 'EXTERIOR' and n not in fr: errors.append(f"{dr['id']}: cômodo '{n}' não existe no andar {f['floor_index']}")
        ra, rb = fr.get(a), fr.get(b)
        if ra is None and rb is None: continue
        base = ra or rb
        on_x = abs(cx - base[0]) < .01 or abs(cx - base[2]) < .01   # parede vertical (x fixo)
        on_z = abs(cz - base[1]) < .01 or abs(cz - base[3]) < .01
        if not (on_x or on_z): errors.append(f"{dr['id']}: centro {dr['center']} não está na borda de '{a if ra else b}'"); continue
        def side(dx, dz): return room_at(fr, cx + dx, cz + dz) or 'EXTERIOR'
        if on_x:
            lo, hi = side(-.02, 0), side(.02, 0)
            ends = [side(-.02, -w/2 + .002), side(.02, -w/2 + .002), side(-.02, w/2 - .002), side(.02, w/2 - .002)]
        else:
            lo, hi = side(0, -.02), side(0, .02)
            ends = [side(-w/2 + .002, -.02), side(-w/2 + .002, .02), side(w/2 - .002, -.02), side(w/2 - .002, .02)]
        if {lo, hi} != {a, b}: errors.append(f"{dr['id']}: a parede em {dr['center']} separa '{lo}'/'{hi}', não '{a}'/'{b}'"); continue
        if set(ends) != {a, b}: errors.append(f"{dr['id']}: largura {w} m passa do trecho de parede entre '{a}' e '{b}'")
        if a != 'EXTERIOR' and b != 'EXTERIOR':
            graph[(f['floor_index'], a)].add((f['floor_index'], b)); graph[(f['floor_index'], b)].add((f['floor_index'], a))
        if dr['type'] in ('door', 'double_door'):
            leaf = w / 2 if dr['type'] == 'double_door' else w
            into = dr.get('swing_into', a)
            sgn = 1 if into == hi else -1
            sw = (cx, cz - w/2, cx + sgn*leaf, cz + w/2) if on_x else (cx - w/2, cz, cx + w/2, cz + sgn*leaf)
            sw = (min(sw[0], sw[2]), min(sw[1], sw[3]), max(sw[0], sw[2]), max(sw[1], sw[3]))
            swings.append((f['floor_index'], sw, dr['id']))
            for hh in holes:
                if overlap(sw, hh): errors.append(f"{dr['id']}: a porta abre por cima de uma escada")

# Escadas ligam os andares
for c, hh in zip(m['vertical_connectors'], holes):
    dirn = c['ascend_direction']; x0, z0, x1, z1 = hh; mx, mz = (x0+x1)/2, (z0+z1)/2
    bottom = {'-z': (mx, z1 + .1), '+z': (mx, z0 - .1), '-x': (x1 + .1, mz), '+x': (x0 - .1, mz)}[dirn]
    top = {'-z': (mx, z0 - .1), '+z': (mx, z1 + .1), '-x': (x0 - .1, mz), '+x': (x1 + .1, mz)}[dirn]
    rb, rt = room_at(rooms[0], *bottom), room_at(rooms[1], *top)
    if not rb or not rt: errors.append(f"{c['type']}: base ({rb}) ou chegada ({rt}) fora de um cômodo"); continue
    graph[(0, rb)].add((1, rt)); graph[(1, rt)].add((0, rb))

start = (0, next(iter(rooms[0])))
for n in rooms[0]:
    if n in outdoor: start = (0, n); break
seen, todo = {start}, [start]
while todo:
    for nb in graph[todo.pop()]:
        if nb not in seen: seen.add(nb); todo.append(nb)
for fi, fr in rooms.items():
    for n in fr:
        if (fi, n) not in seen: errors.append(f"Cômodo inalcançável: andar {fi} '{n}'")

# Móveis
cat = {c['id']: c for c in p['props_catalog']}
sp = p['spawned_props']
if p.get('total_props') != len(sp): errors.append(f"total_props={p.get('total_props')} mas há {len(sp)} móveis")
boxes = []
for s in sp:
    c = cat.get(s['type'])
    if not c: errors.append(f"{s['id']}: tipo '{s['type']}' não existe no catálogo"); continue
    fr = rooms.get(s['floor'], {})
    if s['room'] not in fr: errors.append(f"{s['id']}: cômodo '{s['room']}' não existe no andar {s['floor']}"); continue
    x, y, z = s['position']['x'], s['position']['y'], s['position']['z']
    bw, bh, bd = c.get('dimensions', [0.5, 1, 0.5])
    if round(s['rotation_y']) % 180 == 90: bw, bd = bd, bw
    elif round(s['rotation_y']) % 90 != 0:
        k = max(bw, bd); bw = bd = k * 1.2  # rotação diagonal: caixa aproximada
    box = (x-bw/2, z-bd/2, x+bw/2, z+bd/2)
    if not inside((x, z), fr[s['room']]): errors.append(f"{s['id']}: posição ({x},{z}) fora de '{s['room']}'")
    elif not (inside(box[:2], fr[s['room']]) and inside(box[2:], fr[s['room']])): warns.append(f"{s['id']}: encosta/atravessa a parede de '{s['room']}'")
    if y < s['floor']*FH - 0.01 or y > (s['floor']+1)*FH: errors.append(f"{s['id']}: altura y={y} fora do andar {s['floor']}")
    sup = s.get('on_top_of')
    if sup:
        base = next((o for o in sp if o['id'] == sup), None)
        if base is None: errors.append(f"{s['id']}: on_top_of '{sup}' não existe")
        else:
            bc = cat[base['type']]; top = bc.get('top_surface', bc['dimensions'][1])
            bw2, _, bd2 = bc['dimensions']
            if round(base['rotation_y']) % 180 == 90: bw2, bd2 = bd2, bw2
            bb = (base['position']['x']-bw2/2, base['position']['z']-bd2/2, base['position']['x']+bw2/2, base['position']['z']+bd2/2)
            if base['floor'] != s['floor']: errors.append(f"{s['id']}: apoiado em móvel de outro andar")
            if abs(y - (base['position']['y'] + top)) > 0.01: errors.append(f"{s['id']}: y={y} não está na superfície de '{sup}' (esperado {base['position']['y']+top:.3f})")
            if not (inside(box[:2], bb) and inside(box[2:], bb)): errors.append(f"{s['id']}: sai para fora do tampo de '{sup}'")
    floor_level = y < s['floor']*FH + 1.0 and not sup
    if floor_level:
        for hh in holes:
            if overlap(box, hh): errors.append(f"{s['id']}: em cima de uma escada")
        for b in blocks:
            if b[4] == s['floor'] and overlap(box, b[:4]): errors.append(f"{s['id']}: dentro de um bloco sólido da escada")
        for fl, sw, did in swings:
            if fl == s['floor'] and overlap(box, sw): errors.append(f"{s['id']}: bloqueia a abertura da porta '{did}'")
    boxes.append((s, box, y, y+bh))
supported = {(s['id'], s.get('on_top_of')) for s in sp if s.get('on_top_of')}
for (a, ba, ya0, ya1), (b, bb, yb0, yb1) in itertools.combinations(boxes, 2):
    if (a['id'], b['id']) in supported or (b['id'], a['id']) in supported: continue
    if a['floor'] == b['floor'] and ya0 < yb1 and yb0 < ya1 and overlap(ba, bb):
        errors.append(f"{a['id']} ({a['type']}) sobrepõe {b['id']} ({b['type']})")

for e in errors: print("ERRO :", e)
for x in warns: print("AVISO:", x)
nd = sum(len(f.get('doors', [])) for f in m['floors'])
print(f"{len(sp)} móveis, {sum(len(v) for v in rooms.values())} cômodos, {nd} portas/vãos, {len(seen)} cômodos alcançáveis -> {len(errors)} erro(s), {len(warns)} aviso(s)")
sys.exit(1 if errors else 0)
