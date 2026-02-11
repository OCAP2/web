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

  /** Return all Units belonging to a given side. */
  getBySide(side: Side): Unit[] {
    return this.getUnits().filter((u) => u.side === side);
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
