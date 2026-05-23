import { describe, expect, it } from "vitest";
import { ProtobufDecoderV2 } from "../protobufDecoderV2";

import {
  Manifest as PbManifest,
  Chunk as PbChunk,
  Side as PbSide,
} from "../generated/v2/ocap_v2";

// ─── Helper: encode a protobuf message to ArrayBuffer ───

function encodePb<T>(msg: { encode: (m: T) => { finish: () => Uint8Array }; fromPartial: (o: any) => T }, data: any): ArrayBuffer {
  const bytes = msg.encode(msg.fromPartial(data)).finish();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

// ─── Manifest decoding tests ───

describe("ProtobufDecoderV2.decodeManifest", () => {
  const decoder = new ProtobufDecoderV2();

  it("decodes a minimal v2 manifest", () => {
    const buffer = encodePb(PbManifest, {
      version: 2,
      world: { worldName: "Altis", worldSize: 30720 },
      mission: { missionName: "Test Op", extensionVersion: "5.0.0" },
      frameCount: 1000,
      chunkSize: 300,
      captureDelayMs: 1000,
      chunkCount: 4,
    });

    const manifest = decoder.decodeManifest(buffer);

    expect(manifest.version).toBe(2);
    expect(manifest.worldName).toBe("Altis");
    expect(manifest.missionName).toBe("Test Op");
    expect(manifest.endFrame).toBe(1000);
    expect(manifest.chunkSize).toBe(300);
    expect(manifest.captureDelayMs).toBe(1000);
    expect(manifest.chunkCount).toBe(4);
    expect(manifest.entities).toEqual([]);
    expect(manifest.events).toEqual([]);
    expect(manifest.markers).toEqual([]);
    expect(manifest.times).toEqual([]);
    expect(manifest.extensionVersion).toBe("5.0.0");
  });

  it("decodes soldier definitions", () => {
    const buffer = encodePb(PbManifest, {
      version: 2,
      world: { worldName: "Altis" },
      mission: { missionName: "Op" },
      frameCount: 1000,
      chunkSize: 300,
      captureDelayMs: 1000,
      chunkCount: 4,
      soldiers: [{
        id: 42,
        name: "Player1",
        side: PbSide.SIDE_WEST,
        groupName: "Alpha 1",
        role: "Rifleman",
        startFrame: 0,
        endFrame: 999,
        isPlayer: true,
        className: "B_Soldier_F",
        playerUid: "76561198000000000",
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
    expect(entity.isPlayer).toBe(true);
  });

  it("decodes vehicle definitions", () => {
    const buffer = encodePb(PbManifest, {
      version: 2,
      world: { worldName: "Altis" },
      mission: { missionName: "Op" },
      frameCount: 100,
      chunkSize: 100,
      captureDelayMs: 1000,
      chunkCount: 1,
      vehicles: [{
        id: 5,
        name: "Hunter",
        vehicleClass: "car",
        startFrame: 0,
        endFrame: 100,
      }],
    });

    const manifest = decoder.decodeManifest(buffer);
    expect(manifest.entities).toHaveLength(1);
    expect(manifest.entities[0].type).toBe("car");
    expect(manifest.entities[0].name).toBe("Hunter");
  });

  it("decodes v2 world metadata", () => {
    const buffer = encodePb(PbManifest, {
      version: 2,
      world: {
        worldName: "Altis",
        worldSize: 30720,
        latitude: -35.09,
        longitude: 16.81,
        author: "BIS",
        displayName: "Altis",
      },
      mission: { missionName: "Op" },
      frameCount: 100,
      chunkSize: 100,
      captureDelayMs: 1000,
      chunkCount: 1,
    });

    const manifest = decoder.decodeManifest(buffer);
    expect(manifest.world).toBeDefined();
    expect(manifest.world!.worldSize).toBeCloseTo(30720);
    expect(manifest.world!.latitude).toBeCloseTo(-35.09, 1);
    expect(manifest.world!.longitude).toBeCloseTo(16.81, 1);
  });

  it("decodes v2 mission metadata", () => {
    const buffer = encodePb(PbManifest, {
      version: 2,
      world: { worldName: "Altis" },
      mission: {
        missionName: "Op",
        serverName: "TestServer",
        briefingName: "Briefing",
        playableSlots: { west: 10, east: 8, independent: 4, civilian: 2 },
        sideFriendly: { eastWest: false, eastIndependent: true, westIndependent: false },
        addons: [{ name: "CBA_A3", workshopId: "450814997" }],
      },
      frameCount: 100,
      chunkSize: 100,
      captureDelayMs: 1000,
      chunkCount: 1,
    });

    const manifest = decoder.decodeManifest(buffer);
    expect(manifest.mission).toBeDefined();
    expect(manifest.mission!.serverName).toBe("TestServer");
    expect(manifest.mission!.briefingName).toBe("Briefing");
    expect(manifest.mission!.playableSlots?.west).toBe(10);
    expect(manifest.mission!.sideFriendly?.eastIndependent).toBe(true);
    expect(manifest.mission!.addons).toHaveLength(1);
    expect(manifest.mission!.addons![0].name).toBe("CBA_A3");
  });

  it("decodes kill events", () => {
    const buffer = encodePb(PbManifest, {
      version: 2,
      world: { worldName: "Altis" },
      mission: { missionName: "Op" },
      frameCount: 500,
      chunkSize: 300,
      captureDelayMs: 1000,
      chunkCount: 2,
      events: [{
        frameNum: 100,
        kill: {
          victimSoldierId: 2,
          killerSoldierId: 1,
          weaponName: "arifle_MX_F",
          eventText: "Player1 killed Player2",
          distance: 150.0,
        },
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
      expect(event.weapon).toBe("Player1 killed Player2");
      expect(event.distance).toBeCloseTo(150.0);
    }
  });

  it("decodes connect/disconnect events", () => {
    const buffer = encodePb(PbManifest, {
      version: 2,
      world: { worldName: "Altis" },
      mission: { missionName: "Op" },
      frameCount: 500,
      chunkSize: 300,
      captureDelayMs: 1000,
      chunkCount: 2,
      events: [
        { frameNum: 50, connect: { unitName: "Player1", isConnect: true } },
        { frameNum: 200, connect: { unitName: "Player2", isConnect: false } },
      ],
    });

    const manifest = decoder.decodeManifest(buffer);
    expect(manifest.events).toHaveLength(2);

    expect(manifest.events[0].type).toBe("connected");
    if (manifest.events[0].type === "connected") {
      expect(manifest.events[0].unitName).toBe("Player1");
    }

    expect(manifest.events[1].type).toBe("disconnected");
    if (manifest.events[1].type === "disconnected") {
      expect(manifest.events[1].unitName).toBe("Player2");
    }
  });

  it("decodes captured/contested sector events with typed fields", () => {
    const buffer = encodePb(PbManifest, {
      version: 2,
      world: { worldName: "Altis" },
      mission: { missionName: "Op" },
      frameCount: 500,
      chunkSize: 300,
      captureDelayMs: 1000,
      chunkCount: 2,
      events: [
        { frameNum: 100, general: { name: "captured", objectType: "Sector_A", unitName: "Squad 1", side: "WEST" } },
        { frameNum: 200, general: { name: "contested", objectType: "Sector_B", unitName: "Squad 2", side: "EAST" } },
        { frameNum: 300, general: { name: "capturedFlag", objectType: "flag", unitName: "Player1" } },
      ],
    });

    const manifest = decoder.decodeManifest(buffer);
    expect(manifest.events).toHaveLength(3);

    const captured = manifest.events[0];
    expect(captured.type).toBe("captured");
    if (captured.type === "captured") {
      expect(captured.objectType).toBe("Sector_A");
      expect(captured.unitName).toBe("Squad 1");
      expect(captured.side).toBe("WEST");
    }

    const contested = manifest.events[1];
    expect(contested.type).toBe("contested");
    if (contested.type === "contested") {
      expect(contested.objectType).toBe("Sector_B");
      expect(contested.unitName).toBe("Squad 2");
      expect(contested.side).toBe("EAST");
    }

    const flag = manifest.events[2];
    expect(flag.type).toBe("capturedFlag");
    if (flag.type === "capturedFlag") {
      expect(flag.objectType).toBe("flag");
      expect(flag.unitName).toBe("Player1");
    }
  });

  it("decodes time samples", () => {
    const buffer = encodePb(PbManifest, {
      version: 2,
      world: { worldName: "Altis" },
      mission: { missionName: "Op" },
      frameCount: 500,
      chunkSize: 300,
      captureDelayMs: 1000,
      chunkCount: 2,
      times: [{ frameNum: 0, systemTimeUtc: "2025-01-15T12:00:00Z" }],
    });

    const manifest = decoder.decodeManifest(buffer);
    expect(manifest.times).toHaveLength(1);
    expect(manifest.times[0].systemTimeUtc).toBe("2025-01-15T12:00:00Z");
  });
});

// ─── Chunk decoding tests ───

describe("ProtobufDecoderV2.decodeChunk", () => {
  const decoder = new ProtobufDecoderV2();

  it("decodes a chunk with soldier and vehicle states", () => {
    const buffer = encodePb(PbChunk, {
      index: 0,
      startFrame: 0,
      frameCount: 2,
      frames: [
        {
          frameNum: 0,
          soldiers: [{
            id: 1,
            position: { x: 100.0, y: 200.0, z: 10.0 },
            bearing: 90,
            lifestate: 1,
            name: "Player1",
            isPlayer: true,
            groupName: "Alpha",
            side: "WEST",
          }],
          vehicles: [{
            id: 10,
            position: { x: 300.0, y: 400.0, z: 5.0 },
            bearing: 180,
            alive: true,
            crewIds: [1],
            fuel: 0.75,
            side: "WEST",
          }],
        },
        {
          frameNum: 1,
          soldiers: [{
            id: 1,
            position: { x: 105.0, y: 205.0, z: 10.0 },
            bearing: 95,
            lifestate: 1,
          }],
        },
      ],
    });

    const chunk = decoder.decodeChunk(buffer);

    // Soldier states
    const soldierStates = chunk.entities.get(1);
    expect(soldierStates).toBeDefined();
    expect(soldierStates).toHaveLength(2);
    expect(soldierStates![0].position).toEqual([100.0, 200.0, 10.0]);
    expect(soldierStates![0].direction).toBe(90);
    expect(soldierStates![0].alive).toBe(1);
    expect(soldierStates![0].groupName).toBe("Alpha");
    expect(soldierStates![0].side).toBe("WEST");

    // Vehicle states
    const vehicleStates = chunk.entities.get(10);
    expect(vehicleStates).toBeDefined();
    expect(vehicleStates).toHaveLength(2);
    expect(vehicleStates![0].position).toEqual([300.0, 400.0, 5.0]);
    expect(vehicleStates![0].alive).toBe(1);
    expect(vehicleStates![0].crewIds).toEqual([1]);
    expect(vehicleStates![0].fuel).toBeCloseTo(0.75);
    expect(vehicleStates![1]).toBeUndefined(); // vehicle absent from frame 1
  });

  it("decodes v2 soldier extensions", () => {
    const buffer = encodePb(PbChunk, {
      index: 0,
      startFrame: 0,
      frameCount: 1,
      frames: [{
        frameNum: 0,
        soldiers: [{
          id: 1,
          position: { x: 100.0, y: 200.0, z: 10.0 },
          bearing: 90,
          lifestate: 1,
          vehicleRole: "driver",
          stance: "CROUCH",
          hasStableVitals: true,
          isDraggedCarried: false,
          scores: {
            infantryKills: 2,
            vehicleKills: 1,
            armorKills: 0,
            airKills: 0,
            deaths: 0,
            totalScore: 5,
          },
        }],
      }],
    });

    const chunk = decoder.decodeChunk(buffer);
    const state = chunk.entities.get(1)![0];
    expect(state.vehicleRole).toBe("driver");
    expect(state.stance).toBe("CROUCH");
    expect(state.hasStableVitals).toBe(true);
    expect(state.scores).toBeDefined();
    expect(state.scores!.infantryKills).toBe(2);
    expect(state.scores!.totalScore).toBe(5);
  });

  it("decodes v2 vehicle extensions", () => {
    const buffer = encodePb(PbChunk, {
      index: 0,
      startFrame: 0,
      frameCount: 1,
      frames: [{
        frameNum: 0,
        vehicles: [{
          id: 10,
          position: { x: 300.0, y: 400.0, z: 5.0 },
          bearing: 180,
          alive: true,
          fuel: 0.6,
          damage: 0.2,
          locked: true,
          engineOn: true,
          turretAzimuth: 45.0,
          turretElevation: -5.0,
        }],
      }],
    });

    const chunk = decoder.decodeChunk(buffer);
    const state = chunk.entities.get(10)![0];
    expect(state.fuel).toBeCloseTo(0.6);
    expect(state.damage).toBeCloseTo(0.2);
    expect(state.locked).toBe(true);
    expect(state.engineOn).toBe(true);
    expect(state.turretAzimuth).toBeCloseTo(45.0);
    expect(state.turretElevation).toBeCloseTo(-5.0);
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
});

// ─── DecoderStrategy interface compliance ───

describe("DecoderStrategy interface", () => {
  it("ProtobufDecoderV2 has both required methods", () => {
    const decoder = new ProtobufDecoderV2();
    expect(typeof decoder.decodeManifest).toBe("function");
    expect(typeof decoder.decodeChunk).toBe("function");
  });
});
