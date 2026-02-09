import { describe, expect, it } from "vitest";
import * as flatbuffers from "flatbuffers";
import { FlatBuffersDecoder } from "../flatbuffers-decoder";
import { stripVersionPrefix } from "../../loaders/loader";
import { Manifest as FbManifest } from "../generated/fb/manifest";
import { Chunk as FbChunk } from "../generated/fb/chunk";
import { Frame as FbFrame } from "../generated/fb/frame";
import { EntityDef as FbEntityDef } from "../generated/fb/entity-def";
import { EntityState as FbEntityState } from "../generated/fb/entity-state";
import { EntityType as FbEntityType } from "../generated/fb/entity-type";
import { Side as FbSide } from "../generated/fb/side";
import { Event as FbEvent } from "../generated/fb/event";
import { MarkerDef as FbMarkerDef } from "../generated/fb/marker-def";
import { MarkerPosition as FbMarkerPosition } from "../generated/fb/marker-position";
import { TimeSample as FbTimeSample } from "../generated/fb/time-sample";

// ─── Helper: finish a builder and return an ArrayBuffer ───

function finishToBuffer(builder: flatbuffers.Builder): ArrayBuffer {
  const buf = builder.asUint8Array();
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

// ─── FlatBuffersDecoder manifest tests ───

describe("FlatBuffersDecoder.decodeManifest", () => {
  const decoder = new FlatBuffersDecoder();

  it("decodes a minimal manifest with scalar fields", () => {
    const builder = new flatbuffers.Builder(256);
    const worldName = builder.createString("Altis");
    const missionName = builder.createString("Test Op");

    const offset = FbManifest.createManifest(
      builder,
      /* version */ 1,
      worldName,
      missionName,
      /* frameCount */ 500,
      /* chunkSize */ 300,
      /* captureDelayMs */ 1000,
      /* chunkCount */ 2,
      /* entities */ 0,
      /* times */ 0,
      /* events */ 0,
      /* markers */ 0,
      /* extensionVersion */ 0,
      /* addonVersion */ 0,
    );
    builder.finish(offset);

    const manifest = decoder.decodeManifest(finishToBuffer(builder));

    expect(manifest.version).toBe(1);
    expect(manifest.worldName).toBe("Altis");
    expect(manifest.missionName).toBe("Test Op");
    expect(manifest.frameCount).toBe(500);
    expect(manifest.chunkSize).toBe(300);
    expect(manifest.captureDelayMs).toBe(1000);
    expect(manifest.chunkCount).toBe(2);
    expect(manifest.entities).toEqual([]);
    expect(manifest.events).toEqual([]);
    expect(manifest.markers).toEqual([]);
    expect(manifest.times).toEqual([]);
  });

  it("defaults missing fields to zero/empty", () => {
    // Need enough string data so the root offset exceeds 15 bytes,
    // otherwise stripVersionPrefix misidentifies the root offset as a version prefix.
    const builder = new flatbuffers.Builder(256);
    const wn = builder.createString("Altis");
    const mn = builder.createString("Minimal Test");
    const offset = FbManifest.createManifest(
      builder, 1, wn, mn, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    );
    builder.finish(offset);

    const manifest = decoder.decodeManifest(finishToBuffer(builder));

    expect(manifest.version).toBe(1);
    expect(manifest.worldName).toBe("Altis");
    expect(manifest.missionName).toBe("Minimal Test");
    expect(manifest.frameCount).toBe(0);
    expect(manifest.chunkSize).toBe(0);
    expect(manifest.entities).toEqual([]);
    expect(manifest.events).toEqual([]);
    expect(manifest.markers).toEqual([]);
  });

  it("decodes entity definitions", () => {
    const builder = new flatbuffers.Builder(512);
    const name = builder.createString("Player1");
    const group = builder.createString("Alpha 1");
    const role = builder.createString("Rifleman");
    const vehicleClass = builder.createString("");

    const entityOffset = FbEntityDef.createEntityDef(
      builder, 42, FbEntityType.Unit, name, FbSide.West,
      group, role, 0, 999, true, vehicleClass,
    );
    const entitiesVec = FbManifest.createEntitiesVector(builder, [entityOffset]);

    const worldName = builder.createString("Altis");
    const missionName = builder.createString("Op");

    const manifestOffset = FbManifest.createManifest(
      builder, 1, worldName, missionName, 1000, 300, 1000, 4,
      entitiesVec, 0, 0, 0, 0, 0,
    );
    builder.finish(manifestOffset);

    const manifest = decoder.decodeManifest(finishToBuffer(builder));
    expect(manifest.entities).toHaveLength(1);

    const entity = manifest.entities[0];
    expect(entity.id).toBe(42);
    expect(entity.type).toBe("man");
    expect(entity.name).toBe("Player1");
    expect(entity.side).toBe("WEST");
    expect(entity.groupName).toBe("Alpha 1");
    expect(entity.role).toBe("Rifleman");
    expect(entity.startFrame).toBe(0);
    expect(entity.endFrame).toBe(999);
    expect(entity.isPlayer).toBe(true);
  });

  it("decodes vehicle entity with vehicleClass", () => {
    const builder = new flatbuffers.Builder(256);
    const name = builder.createString("Apache");
    const group = builder.createString("Air");
    const role = builder.createString("");
    const vehicleClass = builder.createString("heli");

    const entityOffset = FbEntityDef.createEntityDef(
      builder, 5, FbEntityType.Vehicle, name, FbSide.West,
      group, role, 0, 100, false, vehicleClass,
    );
    const entitiesVec = FbManifest.createEntitiesVector(builder, [entityOffset]);
    const worldName = builder.createString("Altis");
    const missionName = builder.createString("Op");

    const offset = FbManifest.createManifest(
      builder, 1, worldName, missionName, 100, 100, 1000, 1,
      entitiesVec, 0, 0, 0, 0, 0,
    );
    builder.finish(offset);

    const manifest = decoder.decodeManifest(finishToBuffer(builder));
    expect(manifest.entities[0].type).toBe("heli");
  });

  it("maps side enums correctly", () => {
    const sides = [
      { fbSide: FbSide.West, expected: "WEST" },
      { fbSide: FbSide.East, expected: "EAST" },
      { fbSide: FbSide.Guer, expected: "GUER" },
      { fbSide: FbSide.Civ, expected: "CIV" },
    ];

    for (const { fbSide, expected } of sides) {
      const builder = new flatbuffers.Builder(256);
      const name = builder.createString("Test");
      const group = builder.createString("G");
      const vc = builder.createString("");

      const entityOffset = FbEntityDef.createEntityDef(
        builder, 1, FbEntityType.Unit, name, fbSide, group, 0, 0, 10, false, vc,
      );
      const entitiesVec = FbManifest.createEntitiesVector(builder, [entityOffset]);
      const wn = builder.createString("W");
      const mn = builder.createString("M");

      const offset = FbManifest.createManifest(
        builder, 1, wn, mn, 10, 10, 1000, 1, entitiesVec, 0, 0, 0, 0, 0,
      );
      builder.finish(offset);

      const manifest = decoder.decodeManifest(finishToBuffer(builder));
      expect(manifest.entities[0].side).toBe(expected);
    }
  });

  it("decodes hit/killed events", () => {
    const builder = new flatbuffers.Builder(256);
    const typeStr = builder.createString("killed");
    const weapon = builder.createString("AK-47");

    const eventOffset = FbEvent.createEvent(
      builder, 100, typeStr, /* sourceId */ 1, /* targetId */ 2,
      /* message */ 0, /* distance */ 150.0, weapon,
    );
    const eventsVec = FbManifest.createEventsVector(builder, [eventOffset]);
    const wn = builder.createString("Altis");
    const mn = builder.createString("Op");

    const offset = FbManifest.createManifest(
      builder, 1, wn, mn, 500, 300, 1000, 2, 0, 0, eventsVec, 0, 0, 0,
    );
    builder.finish(offset);

    const manifest = decoder.decodeManifest(finishToBuffer(builder));
    expect(manifest.events).toHaveLength(1);

    const event = manifest.events[0];
    expect(event.type).toBe("killed");
    if (event.type === "killed") {
      expect(event.victimId).toBe(2);
      expect(event.causedById).toBe(1);
      expect(event.distance).toBeCloseTo(150.0);
      expect(event.weapon).toBe("AK-47");
    }
  });

  it("decodes connected/disconnected events", () => {
    const builder = new flatbuffers.Builder(256);
    const connType = builder.createString("connected");
    const connMsg = builder.createString("PlayerName");
    const evt1 = FbEvent.createEvent(builder, 50, connType, 0, 0, connMsg, 0, 0);

    const discType = builder.createString("disconnected");
    const discMsg = builder.createString("PlayerName2");
    const evt2 = FbEvent.createEvent(builder, 200, discType, 0, 0, discMsg, 0, 0);

    const eventsVec = FbManifest.createEventsVector(builder, [evt1, evt2]);
    const wn = builder.createString("Altis");
    const mn = builder.createString("Op");

    const offset = FbManifest.createManifest(
      builder, 1, wn, mn, 500, 300, 1000, 2, 0, 0, eventsVec, 0, 0, 0,
    );
    builder.finish(offset);

    const manifest = decoder.decodeManifest(finishToBuffer(builder));
    expect(manifest.events).toHaveLength(2);
    expect(manifest.events[0].type).toBe("connected");
    if (manifest.events[0].type === "connected") {
      expect(manifest.events[0].unitName).toBe("PlayerName");
    }
    expect(manifest.events[1].type).toBe("disconnected");
    if (manifest.events[1].type === "disconnected") {
      expect(manifest.events[1].unitName).toBe("PlayerName2");
    }
  });

  it("decodes markers", () => {
    const builder = new flatbuffers.Builder(512);

    const posOffset = FbMarkerPosition.createMarkerPosition(
      builder, /* frameNum */ 10, /* posX */ 500.0, /* posY */ 600.0,
      /* posZ */ 0.0, /* direction */ 90.0, /* alpha */ 0.8, /* lineCoords */ 0,
    );
    const positionsVec = FbMarkerDef.createPositionsVector(builder, [posOffset]);
    const sizeVec = FbMarkerDef.createSizeVector(builder, [100.0, 200.0]);
    const typeStr = builder.createString("mil_dot");
    const text = builder.createString("HQ");
    const color = builder.createString("#FF0000");
    const shape = builder.createString("ICON");
    const brush = builder.createString("Solid");

    const markerOffset = FbMarkerDef.createMarkerDef(
      builder, typeStr, text, 10, 500, -1, color, FbSide.West,
      positionsVec, sizeVec, shape, brush,
    );
    const markersVec = FbManifest.createMarkersVector(builder, [markerOffset]);
    const wn = builder.createString("Altis");
    const mn = builder.createString("Op");

    const offset = FbManifest.createManifest(
      builder, 1, wn, mn, 500, 300, 1000, 2, 0, 0, 0, markersVec, 0, 0,
    );
    builder.finish(offset);

    const manifest = decoder.decodeManifest(finishToBuffer(builder));
    expect(manifest.markers).toHaveLength(1);

    const marker = manifest.markers[0];
    expect(marker.type).toBe("mil_dot");
    expect(marker.text).toBe("HQ");
    expect(marker.shape).toBe("ICON");
    expect(marker.color).toBe("#FF0000");
    expect(marker.side).toBe("WEST");
    expect(marker.player).toBe(-1);
    expect(marker.alpha).toBeCloseTo(0.8);
    expect(marker.brush).toBe("Solid");
    expect(marker.size).toEqual([100.0, 200.0]);
    expect(marker.positions).toHaveLength(1);
    expect(marker.positions[0][0]).toBe(10);
    expect(marker.positions[0][1]).toBeCloseTo(500.0);
    expect(marker.positions[0][2]).toBeCloseTo(600.0);
  });

  it("decodes time samples", () => {
    const builder = new flatbuffers.Builder(256);
    const utcStr = builder.createString("2025-01-15T12:00:00Z");

    const timeOffset = FbTimeSample.createTimeSample(
      builder, 0, utcStr, /* date */ 0, /* timeMultiplier */ 0, /* time */ 0,
    );
    const timesVec = FbManifest.createTimesVector(builder, [timeOffset]);
    const wn = builder.createString("Altis");
    const mn = builder.createString("Op");

    const offset = FbManifest.createManifest(
      builder, 1, wn, mn, 500, 300, 1000, 2, 0, timesVec, 0, 0, 0, 0,
    );
    builder.finish(offset);

    const manifest = decoder.decodeManifest(finishToBuffer(builder));
    expect(manifest.times).toHaveLength(1);
    expect(manifest.times[0].frameNum).toBe(0);
    expect(manifest.times[0].systemTimeUtc).toBe("2025-01-15T12:00:00Z");
  });

  it("works with stripVersionPrefix from loader", () => {
    const builder = new flatbuffers.Builder(256);
    const wn = builder.createString("Tanoa");
    const mn = builder.createString("PrefixTest");
    const offset = FbManifest.createManifest(
      builder, 3, wn, mn, 100, 50, 1000, 2, 0, 0, 0, 0, 0, 0,
    );
    builder.finish(offset);

    const data = builder.asUint8Array();
    // Prepend 4-byte version prefix: [5, 0, 0, 0]
    const prefixed = new Uint8Array(4 + data.length);
    prefixed[0] = 5;
    prefixed.set(data, 4);

    // Loader strips the prefix before passing to decoder
    const stripped = stripVersionPrefix(prefixed.buffer);
    const manifest = decoder.decodeManifest(stripped);
    expect(manifest.version).toBe(3);
    expect(manifest.worldName).toBe("Tanoa");
    expect(manifest.missionName).toBe("PrefixTest");
  });
});

// ─── FlatBuffersDecoder chunk tests ───

describe("FlatBuffersDecoder.decodeChunk", () => {
  const decoder = new FlatBuffersDecoder();

  it("decodes a chunk with entity states", () => {
    const builder = new flatbuffers.Builder(512);

    // Frame 0: two entities
    const es1 = FbEntityState.createEntityState(
      builder, 10, 100.0, 200.0, 90, 1, 0, 0, false, 0, false,
    );
    const es2 = FbEntityState.createEntityState(
      builder, 20, 300.0, 400.0, 180, 1, 0, 0, false, 0, false,
    );
    const frame0Entities = FbFrame.createEntitiesVector(builder, [es1, es2]);
    const frame0 = FbFrame.createFrame(builder, 0, frame0Entities);

    // Frame 1: one entity
    const es3 = FbEntityState.createEntityState(
      builder, 10, 105.0, 205.0, 95, 1, 0, 0, false, 0, false,
    );
    const frame1Entities = FbFrame.createEntitiesVector(builder, [es3]);
    const frame1 = FbFrame.createFrame(builder, 1, frame1Entities);

    const framesVec = FbChunk.createFramesVector(builder, [frame0, frame1]);
    const chunkOffset = FbChunk.createChunk(builder, 0, 0, 2, framesVec);
    builder.finish(chunkOffset);

    const chunk = decoder.decodeChunk(finishToBuffer(builder));

    const states10 = chunk.entities.get(10);
    expect(states10).toHaveLength(2);
    expect(states10![0].position).toEqual([100.0, 200.0]);
    expect(states10![0].direction).toBe(90);
    expect(states10![0].alive).toBe(1);
    expect(states10![1].position[0]).toBeCloseTo(105.0);
    expect(states10![1].position[1]).toBeCloseTo(205.0);

    const states20 = chunk.entities.get(20);
    expect(states20).toHaveLength(1);
    expect(states20![0].position).toEqual([300.0, 400.0]);
  });

  it("decodes entity state with crew, vehicle, name, and player", () => {
    const builder = new flatbuffers.Builder(256);

    const crewVec = FbEntityState.createCrewIdsVector(builder, [10, 20]);
    const nameStr = builder.createString("NewName");

    FbEntityState.startEntityState(builder);
    FbEntityState.addEntityId(builder, 5);
    FbEntityState.addPosX(builder, 50.0);
    FbEntityState.addPosY(builder, 60.0);
    FbEntityState.addDirection(builder, 45);
    FbEntityState.addAlive(builder, 1);
    FbEntityState.addCrewIds(builder, crewVec);
    FbEntityState.addVehicleId(builder, 99);
    FbEntityState.addIsInVehicle(builder, true);
    FbEntityState.addName(builder, nameStr);
    FbEntityState.addIsPlayer(builder, true);
    const esOffset = FbEntityState.endEntityState(builder);

    const entVec = FbFrame.createEntitiesVector(builder, [esOffset]);
    const frameOffset = FbFrame.createFrame(builder, 0, entVec);
    const framesVec = FbChunk.createFramesVector(builder, [frameOffset]);
    const chunkOffset = FbChunk.createChunk(builder, 0, 0, 1, framesVec);
    builder.finish(chunkOffset);

    const chunk = decoder.decodeChunk(finishToBuffer(builder));
    const state = chunk.entities.get(5)![0];

    expect(state.position).toEqual([50.0, 60.0]);
    expect(state.direction).toBe(45);
    expect(state.alive).toBe(1);
    expect(state.crewIds).toEqual([10, 20]);
    expect(state.vehicleId).toBe(99);
    expect(state.isInVehicle).toBe(true);
    expect(state.name).toBe("NewName");
    expect(state.isPlayer).toBe(true);
  });

  it("returns empty map for empty chunk", () => {
    const builder = new flatbuffers.Builder(64);
    const chunkOffset = FbChunk.createChunk(builder, 0, 0, 0, 0);
    builder.finish(chunkOffset);

    const chunk = decoder.decodeChunk(finishToBuffer(builder));
    expect(chunk.entities.size).toBe(0);
  });
});

// ─── DecoderStrategy interface compliance ───

describe("FlatBuffersDecoder - DecoderStrategy interface", () => {
  it("has both required methods", () => {
    const decoder = new FlatBuffersDecoder();
    expect(typeof decoder.decodeManifest).toBe("function");
    expect(typeof decoder.decodeChunk).toBe("function");
  });
});
