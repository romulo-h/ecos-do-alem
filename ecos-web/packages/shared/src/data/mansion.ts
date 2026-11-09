import mapJson from "./map_data.json";
import propsJson from "./props_layout.json";

/**
 * Leitura dos JSON da mansão (os mesmos do projeto Unity, em Assets/Data).
 * Coordenadas: metros, mesmas do Unity. x/z no plano, y para cima. Frente da casa = +z.
 */

export interface Rect2 {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface RoomDef extends Rect2 {
  name: string;
  floor: number;
  outdoor: boolean;
}

export type DoorType = "door" | "double_door" | "arch" | "open";

export interface DoorDef {
  id: string;
  floor: number;
  roomA: string;
  roomB: string;
  centerX: number;
  centerZ: number;
  width: number;
  type: DoorType;
  swingInto?: string;
  locked: boolean;
  hinge?: "min" | "max";
}

export type AscendDirection = "+x" | "-x" | "+z" | "-z";

export interface StairDef extends Rect2 {
  name: string;
  h0: number;
  h1: number;
  ascend: AscendDirection;
}

export interface SolidDef {
  name: string;
  min: [number, number, number];
  max: [number, number, number];
}

export type PropCategory =
  | "decor"
  | "assento"
  | "armazenamento"
  | "iluminacao"
  | "sanitario"
  | "hidraulica"
  | "dormitorio"
  | "planta"
  | "louca";

export interface PropTypeDef {
  id: string;
  name: string;
  category: PropCategory;
  /** largura (x), altura (y), profundidade (z) */
  dimensions: [number, number, number];
  model: string;
  topSurface?: number;
}

export interface PropDef {
  id: string;
  type: PropTypeDef;
  floor: number;
  room: string;
  x: number;
  y: number;
  z: number;
  /** graus, mesma convenção do Unity (e do rotation.y do Three.js) */
  rotationY: number;
  onTopOf?: string;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface MansionData {
  floorHeight: number;
  doorHeight: number;
  archHeight: number;
  railingHeight: number;
  wallThickness: number;
  rooms: RoomDef[];
  doors: DoorDef[];
  stairs: StairDef[];
  solids: SolidDef[];
  props: PropDef[];
  spawns: { hunters: Vec3[]; ghosts: Vec3[] };
}

interface RawMap {
  dimensions: { floor_height: number };
  door_settings: { door_height: number; arch_height: number; railing_height: number; wall_thickness: number };
  floors: {
    floor_index: number;
    rooms: { name: string; bounds: { min: number[]; max: number[] }; outdoor?: boolean }[];
    doors?: { id: string; rooms: string[]; center: number[]; width: number; type?: string; swing_into?: string; locked?: boolean; hinge?: string }[];
  }[];
  vertical_connectors: { type: string; position: { x: number[]; z: number[] }; height_range: number[]; ascend_direction?: string }[];
  solid_blocks?: { name: string; min: number[]; max: number[] }[];
  spawn_points: { hunters: Vec3[]; ghosts: Vec3[] };
}

interface RawProps {
  props_catalog: { id: string; name: string; category: string; dimensions: number[]; model: string; top_surface?: number }[];
  spawned_props: { id: string; type: string; floor: number; room: string; position: Vec3; rotation_y: number; on_top_of?: string }[];
}

export function parseMansion(rawMap: unknown = mapJson, rawProps: unknown = propsJson): MansionData {
  const map = rawMap as RawMap;
  const props = rawProps as RawProps;

  const rooms: RoomDef[] = [];
  const doors: DoorDef[] = [];
  for (const f of map.floors) {
    for (const r of f.rooms) {
      rooms.push({
        name: r.name,
        floor: f.floor_index,
        outdoor: !!r.outdoor,
        minX: r.bounds.min[0],
        minZ: r.bounds.min[1],
        maxX: r.bounds.max[0],
        maxZ: r.bounds.max[1],
      });
    }
    for (const d of f.doors ?? []) {
      doors.push({
        id: d.id,
        floor: f.floor_index,
        roomA: d.rooms[0],
        roomB: d.rooms[1],
        centerX: d.center[0],
        centerZ: d.center[1],
        width: d.width,
        type: (d.type || "door") as DoorType,
        swingInto: d.swing_into,
        locked: !!d.locked,
        hinge: d.hinge === "max" ? "max" : d.hinge === "min" ? "min" : undefined,
      });
    }
  }

  const stairs: StairDef[] = map.vertical_connectors.map((c) => ({
    name: c.type,
    minX: c.position.x[0],
    maxX: c.position.x[1],
    minZ: c.position.z[0],
    maxZ: c.position.z[1],
    h0: c.height_range[0],
    h1: c.height_range[1],
    ascend: (c.ascend_direction || "+z") as AscendDirection,
  }));

  const solids: SolidDef[] = (map.solid_blocks ?? []).map((b) => ({
    name: b.name,
    min: [b.min[0], b.min[1], b.min[2]],
    max: [b.max[0], b.max[1], b.max[2]],
  }));

  const catalog = new Map<string, PropTypeDef>();
  for (const c of props.props_catalog) {
    catalog.set(c.id, {
      id: c.id,
      name: c.name,
      category: c.category as PropCategory,
      dimensions: [c.dimensions[0], c.dimensions[1], c.dimensions[2]],
      model: c.model,
      topSurface: c.top_surface,
    });
  }

  const propDefs: PropDef[] = props.spawned_props.map((s) => {
    const type = catalog.get(s.type);
    if (!type) throw new Error(`Móvel ${s.id}: tipo desconhecido ${s.type}`);
    return {
      id: s.id,
      type,
      floor: s.floor,
      room: s.room,
      x: s.position.x,
      y: s.position.y,
      z: s.position.z,
      rotationY: s.rotation_y,
      onTopOf: s.on_top_of,
    };
  });

  return {
    floorHeight: map.dimensions.floor_height,
    doorHeight: map.door_settings.door_height,
    archHeight: map.door_settings.arch_height,
    railingHeight: map.door_settings.railing_height,
    wallThickness: map.door_settings.wall_thickness,
    rooms,
    doors,
    stairs,
    solids,
    props: propDefs,
    spawns: map.spawn_points,
  };
}
