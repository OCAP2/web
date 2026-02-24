import type { EntityDef, Side } from "../data/types";
import { Entity } from "./entities/entity";
import { Unit } from "./entities/unit";
import { Vehicle } from "./entities/vehicle";
import { Group } from "./entities/group";

/**
 * Manages all entities and groups for a mission playback session.
 * Pure data -- NO DOM, NO Leaflet, NO map dependencies.
 */
export class EntityManager {
  private entities: Map<number, Entity> = new Map();
  private groups: Group[] = [];

  /**
   * Create a Unit or Vehicle from an EntityDef and register it.
   * Type 'man' produces a Unit; everything else produces a Vehicle.
   */
  addEntity(def: EntityDef): Entity {
    let entity: Entity;

    if (def.type === "man") {
      entity = new Unit(
        def.id,
        def.name,
        def.type,
        def.startFrame,
        def.endFrame,
        def.side,
        def.isPlayer,
        def.groupName,
        def.role ?? "",
        def.positions ?? null,
        "man",
        def.framesFired ?? null,
      );
    } else {
      entity = new Vehicle(
        def.id,
        def.name,
        def.type,
        def.startFrame,
        def.endFrame,
        def.type, // vehicleType = EntityType string
        def.positions ?? null,
        def.type, // iconType = same as entity type
      );
    }

    this.entities.set(def.id, entity);
    return entity;
  }

  /** Look up an entity by ID. */
  getEntity(id: number): Entity | null {
    return this.entities.get(id) ?? null;
  }

  /** Return all registered entities. */
  getAll(): Entity[] {
    return Array.from(this.entities.values());
  }

  /** Return only Unit entities. */
  getUnits(): Unit[] {
    return this.getAll().filter((e): e is Unit => e instanceof Unit);
  }

  /** Return only Vehicle entities. */
  getVehicles(): Vehicle[] {
    return this.getAll().filter((e): e is Vehicle => e instanceof Vehicle);
  }

  /**
   * Return all Units belonging to a given side, deduplicated by name per group.
   * Respawns and JIPs create multiple entities for the same player;
   * only the longest-lived entity per name+group is returned.
   */
  getBySide(side: Side): Unit[] {
    const units = this.getUnits().filter((u) => u.side === side);
    // Deduplicate: key by "group\0name", keep the entity with the most frames.
    // Skip dedup for units with empty names — they are distinct AI/unnamed entities.
    const best = new Map<string, Unit>();
    const unnamed: Unit[] = [];
    for (const u of units) {
      if (!u.name) {
        unnamed.push(u);
        continue;
      }
      const key = `${u.groupName}\0${u.name}`;
      const existing = best.get(key);
      if (
        !existing ||
        u.endFrame - u.startFrame > existing.endFrame - existing.startFrame
      ) {
        best.set(key, u);
      }
    }
    return [...best.values(), ...unnamed];
  }

  /** Create and register a new Group. */
  addGroup(name: string, side: Side): Group {
    const group = new Group(name, side);
    this.groups.push(group);
    return group;
  }

  /** Find a group by name and side, or return null. */
  findGroup(name: string, side: Side): Group | null {
    return (
      this.groups.find((g) => g.name === name && g.side === side) ?? null
    );
  }

  /** Reset all entities and groups. */
  clear(): void {
    this.entities.clear();
    this.groups = [];
  }
}
