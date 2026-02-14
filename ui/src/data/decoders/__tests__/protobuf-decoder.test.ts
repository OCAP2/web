import { describe, expect, it } from "vitest";
import { ProtobufDecoder } from "../protobuf-decoder";

import {
  Manifest as PbManifest,
  Chunk as PbChunk,
  EntityType as PbEntityType,
  Side as PbSide,
} from "../generated/ocap.pb";

// ─── Helper: encode a protobuf message to ArrayBuffer ───

function encodePb<T>(msg: { encode: (m: T) => { finish: () => Uint8Array }; fromPartial: (o: any) => T }, data: any): ArrayBuffer {
  const bytes = msg.encode(msg.fromPartial(data)).finish();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

// ─── Manifest decoding tests ───

describe("ProtobufDecoder.decodeManifest", () => {
  const decoder = new ProtobufDecoder();

  it("decodes a minimal manifest", () => {
    const buffer = encodePb(PbManifest, {
      version: 2,
      worldName: "Altis",
      missionName: "Test Op",
      frameCount: 1000,
      chunkSize: 300,
      captureDelayMs: 1000,
      chunkCount: 4,
    });

    const manifest = decoder.decodeManifest(buffer);

    expect(manifest.version).toBe(2);
    expect(manifest.worldName).toBe("Altis");
    expect(manifest.missionName).toBe("Test Op");
    expect(manifest.frameCount).toBe(1000);
    expect(manifest.chunkSize).toBe(300);
    expect(manifest.captureDelayMs).toBe(1000);
    expect(manifest.chunkCount).toBe(4);
    expect(manifest.entities).toEqual([]);
    expect(manifest.events).toEqual([]);
    expect(manifest.markers).toEqual([]);
    expect(manifest.times).toEqual([]);
  });

  it("decodes entity definitions", () => {
    const buffer = encodePb(PbManifest, {
      version: 1,
      worldName: "Altis",
      missionName: "Op",
      frameCount: 1000,
      chunkSize: 300,
      captureDelayMs: 1000,
      chunkCount: 4,
      entities: [{
        id: 42,
        type: PbEntityType.ENTITY_TYPE_UNIT,
        name: "Player1",
        side: PbSide.SIDE_WEST,
        groupName: "Alpha 1",
        role: "Rifleman",
        startFrame: 0,
        endFrame: 999,
        isPlayer: true,
      }],
    });

    const manifest = decoder.decodeManifest(buffer);
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

  it("decodes entity with framesFired", () => {
    const buffer = encodePb(PbManifest, {
      version: 1,
      worldName: "Altis",
      missionName: "Op",
      frameCount: 500,
      chunkSize: 300,
      captureDelayMs: 1000,
      chunkCount: 2,
      entities: [{
        id: 1,
        type: PbEntityType.ENTITY_TYPE_UNIT,
        name: "Shooter",
        side: PbSide.SIDE_EAST,
        groupName: "Bravo",
        startFrame: 0,
        endFrame: 500,
        isPlayer: true,
        framesFired: [{ frameNum: 50, posX: 100.5, posY: 200.5, posZ: 10.0 }],
      }],
    });

    const manifest = decoder.decodeManifest(buffer);
    const entity = manifest.entities[0];
    expect(entity.framesFired).toHaveLength(1);
    expect(entity.framesFired![0][0]).toBe(50);
    expect(entity.framesFired![0][1][0]).toBeCloseTo(100.5);
    expect(entity.framesFired![0][1][1]).toBeCloseTo(200.5);
  });

  it("decodes hit/killed events", () => {
    const buffer = encodePb(PbManifest, {
      version: 1,
      worldName: "Altis",
      missionName: "Op",
      frameCount: 500,
      chunkSize: 300,
      captureDelayMs: 1000,
      chunkCount: 2,
      events: [{
        frameNum: 100,
        type: "killed",
        sourceId: 1,
        targetId: 2,
        distance: 150.0,
        weapon: "AK-47",
      }],
    });

    const manifest = decoder.decodeManifest(buffer);
    expect(manifest.events).toHaveLength(1);

    const event = manifest.events[0];
    expect(event.frameNum).toBe(100);
    expect(event.type).toBe("killed");
    if (event.type === "killed") {
      expect(event.victimId).toBe(2);
      expect(event.causedById).toBe(1);
      expect(event.distance).toBeCloseTo(150.0);
      expect(event.weapon).toBe("AK-47");
    }
  });

  it("decodes connected/disconnected events", () => {
    const buffer = encodePb(PbManifest, {
      version: 1,
      worldName: "Altis",
      missionName: "Op",
      frameCount: 500,
      chunkSize: 300,
      captureDelayMs: 1000,
      chunkCount: 2,
      events: [
        { frameNum: 50, type: "connected", message: "PlayerName" },
        { frameNum: 200, type: "disconnected", message: "PlayerName2" },
      ],
    });

    const manifest = decoder.decodeManifest(buffer);
    expect(manifest.events).toHaveLength(2);

    const evt0 = manifest.events[0];
    expect(evt0.type).toBe("connected");
    if (evt0.type === "connected") {
      expect(evt0.unitName).toBe("PlayerName");
    }

    const evt1 = manifest.events[1];
    expect(evt1.type).toBe("disconnected");
    if (evt1.type === "disconnected") {
      expect(evt1.unitName).toBe("PlayerName2");
    }
  });

  it("decodes counter events", () => {
    const buffer = encodePb(PbManifest, {
      version: 1,
      worldName: "Altis",
      missionName: "Op",
      frameCount: 500,
      chunkSize: 300,
      captureDelayMs: 1000,
      chunkCount: 2,
      events: [{ frameNum: 75, type: "counterInit", message: "10,20,30" }],
    });

    const manifest = decoder.decodeManifest(buffer);
    const event = manifest.events[0];
    expect(event.type).toBe("counterInit");
    if (event.type === "counterInit") {
      expect(event.data).toEqual([10, 20, 30]);
    }
  });

  it("decodes time samples", () => {
    const buffer = encodePb(PbManifest, {
      version: 1,
      worldName: "Altis",
      missionName: "Op",
      frameCount: 500,
      chunkSize: 300,
      captureDelayMs: 1000,
      chunkCount: 2,
      times: [{ frameNum: 0, systemTimeUtc: "2025-01-15T12:00:00Z" }],
    });

    const manifest = decoder.decodeManifest(buffer);
    expect(manifest.times).toHaveLength(1);
    expect(manifest.times[0].frameNum).toBe(0);
    expect(manifest.times[0].systemTimeUtc).toBe("2025-01-15T12:00:00Z");
  });

  it("decodes markers", () => {
    const buffer = encodePb(PbManifest, {
      version: 1,
      worldName: "Altis",
      missionName: "Op",
      frameCount: 500,
      chunkSize: 300,
      captureDelayMs: 1000,
      chunkCount: 2,
      markers: [{
        type: "mil_dot",
        text: "HQ",
        startFrame: 10,
        endFrame: 500,
        playerId: -1,
        color: "#FF0000",
        side: PbSide.SIDE_WEST,
        positions: [{
          frameNum: 10,
          posX: 500.0,
          posY: 600.0,
          posZ: 0.0,
          direction: 90.0,
          alpha: 0.8,
        }],
        shape: "ICON",
        brush: "Solid",
      }],
    });

    const manifest = decoder.decodeManifest(buffer);
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
    expect(marker.positions).toHaveLength(1);
    expect(marker.positions[0][0]).toBe(10);
    expect(marker.positions[0][1]).toBeCloseTo(500.0);
    expect(marker.positions[0][2]).toBeCloseTo(600.0);
  });

  it("decodes vehicle entity type as unknown when no vehicleClass", () => {
    const buffer = encodePb(PbManifest, {
      version: 1,
      worldName: "Altis",
      missionName: "Op",
      frameCount: 100,
      chunkSize: 100,
      captureDelayMs: 1000,
      chunkCount: 1,
      entities: [{
        id: 5,
        type: PbEntityType.ENTITY_TYPE_VEHICLE,
        name: "Humvee",
        side: PbSide.SIDE_WEST,
        groupName: "Alpha",
        startFrame: 0,
        endFrame: 100,
      }],
    });

    const manifest = decoder.decodeManifest(buffer);
    expect(manifest.entities[0].type).toBe("unknown");
  });

  it("maps vehicle class correctly", () => {
    const buffer = encodePb(PbManifest, {
      version: 1,
      worldName: "Altis",
      missionName: "Op",
      frameCount: 100,
      chunkSize: 100,
      captureDelayMs: 1000,
      chunkCount: 1,
      entities: [{
        id: 5,
        type: PbEntityType.ENTITY_TYPE_VEHICLE,
        name: "Apache",
        side: PbSide.SIDE_WEST,
        groupName: "Alpha",
        startFrame: 0,
        endFrame: 100,
        vehicleClass: "heli",
      }],
    });

    const manifest = decoder.decodeManifest(buffer);
    expect(manifest.entities[0].type).toBe("heli");
  });

  it("maps side enums correctly", () => {
    const sides = [
      { num: PbSide.SIDE_WEST, expected: "WEST" },
      { num: PbSide.SIDE_EAST, expected: "EAST" },
      { num: PbSide.SIDE_GUER, expected: "GUER" },
      { num: PbSide.SIDE_CIV, expected: "CIV" },
    ];

    for (const { num, expected } of sides) {
      const buffer = encodePb(PbManifest, {
        version: 1,
        worldName: "W",
        missionName: "M",
        frameCount: 10,
        chunkSize: 10,
        captureDelayMs: 1000,
        chunkCount: 1,
        entities: [{
          id: num,
          type: PbEntityType.ENTITY_TYPE_UNIT,
          name: "Test",
          side: num,
          groupName: "G",
          startFrame: 0,
          endFrame: 10,
        }],
      });

      const manifest = decoder.decodeManifest(buffer);
      expect(manifest.entities[0].side).toBe(expected);
    }
  });

});

// ─── Chunk decoding tests ───

describe("ProtobufDecoder.decodeChunk", () => {
  const decoder = new ProtobufDecoder();

  it("decodes a chunk with entity states", () => {
    const buffer = encodePb(PbChunk, {
      index: 0,
      startFrame: 0,
      frameCount: 2,
      frames: [
        {
          frameNum: 0,
          entities: [
            { entityId: 10, posX: 100.0, posY: 200.0, direction: 90, alive: 1 },
            { entityId: 20, posX: 300.0, posY: 400.0, direction: 180, alive: 1 },
          ],
        },
        {
          frameNum: 1,
          entities: [
            { entityId: 10, posX: 105.0, posY: 205.0, direction: 95, alive: 1 },
          ],
        },
      ],
    });

    const chunk = decoder.decodeChunk(buffer);

    const states10 = chunk.entities.get(10);
    expect(states10).toBeDefined();
    expect(states10).toHaveLength(2);
    expect(states10![0].position).toEqual([100.0, 200.0, 0]);
    expect(states10![0].direction).toBe(90);
    expect(states10![0].alive).toBe(1);
    expect(states10![1].position[0]).toBeCloseTo(105.0);
    expect(states10![1].position[1]).toBeCloseTo(205.0);

    const states20 = chunk.entities.get(20);
    expect(states20).toBeDefined();
    expect(states20).toHaveLength(2);
    expect(states20![0].position).toEqual([300.0, 400.0, 0]);
    expect(states20![1]).toBeUndefined(); // entity 20 absent from frame 1
  });

  it("indexes entity states by frame offset (sparse entities)", () => {
    // Chunk with 5 frames, entity 99 only present in frames 0 and 4
    const buffer = encodePb(PbChunk, {
      index: 1,
      startFrame: 300,
      frameCount: 5,
      frames: [
        { frameNum: 300, entities: [{ entityId: 99, posX: 1, posY: 2, direction: 0, alive: 1 }] },
        { frameNum: 301, entities: [] },
        { frameNum: 302, entities: [] },
        { frameNum: 303, entities: [] },
        { frameNum: 304, entities: [{ entityId: 99, posX: 3, posY: 4, direction: 0, alive: 1 }] },
      ],
    });

    const chunk = decoder.decodeChunk(buffer);
    const states = chunk.entities.get(99)!;

    // Array length matches frameCount, not number of appearances
    expect(states).toHaveLength(5);
    expect(states[0].position).toEqual([1, 2, 0]); // frame 300 → index 0
    expect(states[1]).toBeUndefined();              // frame 301 → absent
    expect(states[2]).toBeUndefined();              // frame 302 → absent
    expect(states[3]).toBeUndefined();              // frame 303 → absent
    expect(states[4].position).toEqual([3, 4, 0]); // frame 304 → index 4
  });

  it("decodes entity state with crew, vehicle, name, and player fields", () => {
    const buffer = encodePb(PbChunk, {
      index: 0,
      startFrame: 0,
      frameCount: 1,
      frames: [{
        frameNum: 0,
        entities: [{
          entityId: 5,
          posX: 50.0,
          posY: 60.0,
          direction: 45,
          alive: 1,
          crewIds: [10, 20],
          vehicleId: 99,
          isInVehicle: true,
          name: "NewName",
          isPlayer: true,
        }],
      }],
    });

    const chunk = decoder.decodeChunk(buffer);
    const states = chunk.entities.get(5)!;
    expect(states).toHaveLength(1);

    const state = states[0];
    expect(state.position).toEqual([50.0, 60.0, 0]);
    expect(state.direction).toBe(45);
    expect(state.alive).toBe(1);
    expect(state.crewIds).toEqual([10, 20]);
    expect(state.vehicleId).toBe(99);
    expect(state.isInVehicle).toBe(true);
    expect(state.name).toBe("NewName");
    expect(state.isPlayer).toBe(true);
  });

  it("decodes posZ into position[2]", () => {
    const buffer = encodePb(PbChunk, {
      index: 0,
      startFrame: 0,
      frameCount: 1,
      frames: [{
        frameNum: 0,
        entities: [
          { entityId: 1, posX: 100.0, posY: 200.0, posZ: 50.5, direction: 90, alive: 1 },
          { entityId: 2, posX: 300.0, posY: 400.0, posZ: 0.0, direction: 0, alive: 1 },
        ],
      }],
    });

    const chunk = decoder.decodeChunk(buffer);
    const state1 = chunk.entities.get(1)![0];
    expect(state1.position).toEqual([100.0, 200.0, 50.5]);

    const state2 = chunk.entities.get(2)![0];
    expect(state2.position).toEqual([300.0, 400.0, 0.0]); // protobuf always has posZ
  });

  it("decodes dead and unconscious alive states", () => {
    const buffer = encodePb(PbChunk, {
      index: 0,
      startFrame: 0,
      frameCount: 1,
      frames: [{
        frameNum: 0,
        entities: [
          { entityId: 1, posX: 0, posY: 0, direction: 0, alive: 0 },
          { entityId: 2, posX: 0, posY: 0, direction: 0, alive: 2 },
        ],
      }],
    });

    const chunk = decoder.decodeChunk(buffer);
    expect(chunk.entities.get(1)![0].alive).toBe(0);
    expect(chunk.entities.get(2)![0].alive).toBe(2);
  });

  it("returns empty map for empty chunk", () => {
    const buffer = encodePb(PbChunk, {
      index: 0,
      startFrame: 0,
      frameCount: 0,
    });

    const chunk = decoder.decodeChunk(buffer);
    expect(chunk.entities.size).toBe(0);
  });

  it("handles optional fields as undefined when absent", () => {
    const buffer = encodePb(PbChunk, {
      index: 0,
      startFrame: 0,
      frameCount: 1,
      frames: [{
        frameNum: 0,
        entities: [{ entityId: 1, posX: 10.0, posY: 20.0, direction: 0, alive: 1 }],
      }],
    });

    const chunk = decoder.decodeChunk(buffer);
    const state = chunk.entities.get(1)![0];
    expect(state.crewIds).toBeUndefined();
    expect(state.vehicleId).toBeUndefined();
    expect(state.isInVehicle).toBeUndefined();
    expect(state.name).toBeUndefined();
    expect(state.isPlayer).toBeUndefined();
  });
});

// ─── DecoderStrategy interface compliance ───

describe("DecoderStrategy interface", () => {
  it("ProtobufDecoder has both required methods", () => {
    const decoder = new ProtobufDecoder();
    expect(typeof decoder.decodeManifest).toBe("function");
    expect(typeof decoder.decodeChunk).toBe("function");
  });
});
