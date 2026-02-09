import type { Side } from "../../data/types";

/**
 * A group of units -- pure data, NO DOM, NO Leaflet, NO map dependencies.
 */
export class Group {
  readonly name: string;
  readonly side: Side;

  constructor(name: string, side: Side) {
    this.name = name;
    this.side = side;
  }
}
