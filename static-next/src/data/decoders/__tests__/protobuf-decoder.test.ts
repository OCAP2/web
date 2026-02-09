import { describe, expect, it } from "vitest";
import { ProtobufDecoder, ProtobufReader } from "../protobuf-decoder";

// ─── Helpers to build protobuf binary by hand ───

/** Encode a varint into bytes. */
function encodeVarint(value: number): number[] {
  const bytes: number[] = [];
  let v = value >>> 0;
  while (v > 0x7f) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v);
  return bytes;
}

/** Encode a ZigZag-encoded signed varint. */
function encodeSignedVarint(value: number): number[] {
  const zigzag = (value << 1) ^ (value >> 31);
  return encodeVarint(zigzag >>> 0);
}

/** Encode a tag (field number + wire type). */
function encodeTag(fieldNumber: number, wireType: number): number[] {
  return encodeVarint((fieldNumber << 3) | wireType);
}

/** Encode a float32 as 4 little-endian bytes. */
function encodeFloat(value: number): number[] {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setFloat32(0, value, true);
  return [...new Uint8Array(buf)];
}

/** Encode a length-delimited string field. */
function encodeStringField(fieldNumber: number, value: string): number[] {
  const encoded = new TextEncoder().encode(value);
  return [
    ...encodeTag(fieldNumber, 2),
    ...encodeVarint(encoded.length),
    ...encoded,
  ];
}

/** Encode a varint field. */
function encodeVarintField(fieldNumber: number, value: number): number[] {
  return [...encodeTag(fieldNumber, 0), ...encodeVarint(value)];
}

/** Encode a float32 field (wire type 5 = 32-bit). */
function encodeFloatField(fieldNumber: number, value: number): number[] {
  return [...encodeTag(fieldNumber, 5), ...encodeFloat(value)];
}

/** Encode a sub-message field (length-delimited). */
function encodeMessageField(fieldNumber: number, content: number[]): number[] {
  return [
    ...encodeTag(fieldNumber, 2),
    ...encodeVarint(content.length),
    ...content,
  ];
}

/** Convert a byte array to an ArrayBuffer. */
function toBuffer(bytes: number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

// ─── ProtobufReader tests ───

describe("ProtobufReader", () => {
  it("reads a single-byte varint", () => {
    const reader = new ProtobufReader(toBuffer([42]));
    expect(reader.readVarint()).toBe(42);
    expect(reader.pos).toBe(1);
  });

  it("reads a multi-byte varint", () => {
    // 300 = 0b100101100 → 0xAC 0x02
    const reader = new ProtobufReader(toBuffer([0xac, 0x02]));
    expect(reader.readVarint()).toBe(300);
  });

  it("reads varint 0", () => {
    const reader = new ProtobufReader(toBuffer([0x00]));
    expect(reader.readVarint()).toBe(0);
  });

  it("reads large varints correctly", () => {
    // 0xFFFFFFFF (max uint32) = five bytes
    const reader = new ProtobufReader(
      toBuffer([0xff, 0xff, 0xff, 0xff, 0x0f]),
    );
    expect(reader.readVarint()).toBe(0xffffffff);
  });

  it("throws on buffer overflow for varint", () => {
    const reader = new ProtobufReader(toBuffer([]));
    expect(() => reader.readVarint()).toThrow("Buffer overflow");
  });

  it("decodes ZigZag signed varints", () => {
    // ZigZag: 0→0, 1→-1, 2→1, 3→-2, 4→2
    expect(new ProtobufReader(toBuffer([0])).readSignedVarint()).toBe(0);
    expect(new ProtobufReader(toBuffer([1])).readSignedVarint()).toBe(-1);
    expect(new ProtobufReader(toBuffer([2])).readSignedVarint()).toBe(1);
    expect(new ProtobufReader(toBuffer([3])).readSignedVarint()).toBe(-2);
    expect(new ProtobufReader(toBuffer([4])).readSignedVarint()).toBe(2);
  });

  it("reads a float32", () => {
    const reader = new ProtobufReader(toBuffer(encodeFloat(3.14)));
    expect(reader.readFloat()).toBeCloseTo(3.14, 5);
  });

  it("reads a string", () => {
    const text = "hello";
    const encoded = new TextEncoder().encode(text);
    const bytes = [...encodeVarint(encoded.length), ...encoded];
    const reader = new ProtobufReader(toBuffer(bytes));
    expect(reader.readString()).toBe("hello");
  });

  it("reads an empty string", () => {
    const reader = new ProtobufReader(toBuffer([0]));
    expect(reader.readString()).toBe("");
  });

  it("reads a tag", () => {
    // field 2, wire type 0 → (2 << 3) | 0 = 16
    const reader = new ProtobufReader(toBuffer([16]));
    const tag = reader.readTag();
    expect(tag).toEqual({ fieldNumber: 2, wireType: 0 });
  });

  it("returns null for tag at end of buffer", () => {
    const reader = new ProtobufReader(toBuffer([]));
    expect(reader.readTag()).toBeNull();
  });

  it("skips varint fields", () => {
    const bytes = [...encodeVarint(999), 0x42]; // varint then sentinel byte
    const reader = new ProtobufReader(toBuffer(bytes));
    reader.skip(0); // WIRE_VARINT
    expect(reader.view.getUint8(reader.pos)).toBe(0x42);
  });

  it("skips length-delimited fields", () => {
    // 3 bytes of data + sentinel
    const bytes = [...encodeVarint(3), 0xaa, 0xbb, 0xcc, 0x42];
    const reader = new ProtobufReader(toBuffer(bytes));
    reader.skip(2); // WIRE_LENGTH_DELIMITED
    expect(reader.view.getUint8(reader.pos)).toBe(0x42);
  });

  it("skips 32-bit fields", () => {
    const bytes = [0x01, 0x02, 0x03, 0x04, 0x42];
    const reader = new ProtobufReader(toBuffer(bytes));
    reader.skip(5); // WIRE_32BIT
    expect(reader.view.getUint8(reader.pos)).toBe(0x42);
  });

  it("skips 64-bit fields", () => {
    const bytes = [0, 0, 0, 0, 0, 0, 0, 0, 0x42];
    const reader = new ProtobufReader(toBuffer(bytes));
    reader.skip(1); // WIRE_64BIT
    expect(reader.view.getUint8(reader.pos)).toBe(0x42);
  });

  it("throws on unknown wire type in skip", () => {
    const reader = new ProtobufReader(toBuffer([0]));
    expect(() => reader.skip(3)).toThrow("Unknown wire type: 3");
  });

  it("reads nested message bytes via readBytes", () => {
    const data = [10, 20, 30];
    const reader = new ProtobufReader(toBuffer(data));
    const bytes = reader.readBytes(3);
    expect([...bytes]).toEqual([10, 20, 30]);
  });

  it("supports offset and length constructor params", () => {
    const full = new Uint8Array([0xff, 0xff, 42, 0xff]).buffer;
    const reader = new ProtobufReader(full, 2, 1);
    expect(reader.readVarint()).toBe(42);
    expect(reader.pos).toBe(1);
  });
});

// ─── Manifest decoding tests ───

describe("ProtobufDecoder.decodeManifest", () => {
  const decoder = new ProtobufDecoder();

  it("decodes a minimal manifest", () => {
    const bytes = [
      ...encodeVarintField(1, 2), // version = 2
      ...encodeStringField(2, "Altis"), // worldName
      ...encodeStringField(3, "Test Op"), // missionName
      ...encodeVarintField(4, 1000), // frameCount
      ...encodeVarintField(5, 300), // chunkSize
      ...encodeVarintField(6, 1000), // captureDelayMs
      ...encodeVarintField(7, 4), // chunkCount
    ];

    const manifest = decoder.decodeManifest(toBuffer(bytes));

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
    const entityBytes = [
      ...encodeVarintField(1, 42), // id
      ...encodeVarintField(2, 1), // type = UNIT
      ...encodeStringField(3, "Player1"), // name
      ...encodeVarintField(4, 1), // side = WEST
      ...encodeStringField(5, "Alpha 1"), // groupName
      ...encodeStringField(6, "Rifleman"), // role
      ...encodeVarintField(7, 0), // startFrame
      ...encodeVarintField(8, 999), // endFrame
      ...encodeVarintField(9, 1), // isPlayer = true
    ];

    const bytes = [
      ...encodeVarintField(1, 1), // version
      ...encodeStringField(2, "Altis"),
      ...encodeStringField(3, "Op"),
      ...encodeVarintField(4, 1000),
      ...encodeVarintField(5, 300),
      ...encodeVarintField(6, 1000),
      ...encodeVarintField(7, 4),
      ...encodeMessageField(8, entityBytes),
    ];

    const manifest = decoder.decodeManifest(toBuffer(bytes));
    expect(manifest.entities).toHaveLength(1);

    const entity = manifest.entities[0];
    expect(entity.id).toBe(42);
    expect(entity.type).toBe("man"); // unit → man
    expect(entity.name).toBe("Player1");
    expect(entity.side).toBe("WEST");
    expect(entity.groupName).toBe("Alpha 1");
    expect(entity.role).toBe("Rifleman");
    expect(entity.startFrame).toBe(0);
    expect(entity.endFrame).toBe(999);
    expect(entity.isPlayer).toBe(true);
  });

  it("decodes entity with framesFired", () => {
    const firedBytes = [
      ...encodeVarintField(1, 50), // frameNum
      ...encodeFloatField(2, 100.5), // posX
      ...encodeFloatField(3, 200.5), // posY
      ...encodeFloatField(4, 10.0), // posZ
    ];

    const entityBytes = [
      ...encodeVarintField(1, 1),
      ...encodeVarintField(2, 1), // unit
      ...encodeStringField(3, "Shooter"),
      ...encodeVarintField(4, 2), // EAST
      ...encodeStringField(5, "Bravo"),
      ...encodeVarintField(7, 0),
      ...encodeVarintField(8, 500),
      ...encodeVarintField(9, 1),
      ...encodeMessageField(11, firedBytes),
    ];

    const bytes = [
      ...encodeVarintField(1, 1),
      ...encodeStringField(2, "Altis"),
      ...encodeStringField(3, "Op"),
      ...encodeVarintField(4, 500),
      ...encodeVarintField(5, 300),
      ...encodeVarintField(6, 1000),
      ...encodeVarintField(7, 2),
      ...encodeMessageField(8, entityBytes),
    ];

    const manifest = decoder.decodeManifest(toBuffer(bytes));
    const entity = manifest.entities[0];
    expect(entity.framesFired).toHaveLength(1);
    expect(entity.framesFired![0][0]).toBe(50); // frameNum
    expect(entity.framesFired![0][1][0]).toBeCloseTo(100.5); // posX
    expect(entity.framesFired![0][1][1]).toBeCloseTo(200.5); // posY
  });

  it("decodes hit/killed events", () => {
    const eventBytes = [
      ...encodeVarintField(1, 100), // frameNum
      ...encodeStringField(2, "killed"), // type
      ...encodeVarintField(3, 1), // sourceId
      ...encodeVarintField(4, 2), // targetId
      ...encodeFloatField(6, 150.0), // distance
      ...encodeStringField(7, "AK-47"), // weapon
    ];

    const bytes = [
      ...encodeVarintField(1, 1),
      ...encodeStringField(2, "Altis"),
      ...encodeStringField(3, "Op"),
      ...encodeVarintField(4, 500),
      ...encodeVarintField(5, 300),
      ...encodeVarintField(6, 1000),
      ...encodeVarintField(7, 2),
      ...encodeMessageField(10, eventBytes),
    ];

    const manifest = decoder.decodeManifest(toBuffer(bytes));
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
    const connectBytes = [
      ...encodeVarintField(1, 50),
      ...encodeStringField(2, "connected"),
      ...encodeStringField(5, "PlayerName"),
    ];

    const disconnectBytes = [
      ...encodeVarintField(1, 200),
      ...encodeStringField(2, "disconnected"),
      ...encodeStringField(5, "PlayerName2"),
    ];

    const bytes = [
      ...encodeVarintField(1, 1),
      ...encodeStringField(2, "Altis"),
      ...encodeStringField(3, "Op"),
      ...encodeVarintField(4, 500),
      ...encodeVarintField(5, 300),
      ...encodeVarintField(6, 1000),
      ...encodeVarintField(7, 2),
      ...encodeMessageField(10, connectBytes),
      ...encodeMessageField(10, disconnectBytes),
    ];

    const manifest = decoder.decodeManifest(toBuffer(bytes));
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
    const counterBytes = [
      ...encodeVarintField(1, 75),
      ...encodeStringField(2, "counterInit"),
      ...encodeStringField(5, "10,20,30"),
    ];

    const bytes = [
      ...encodeVarintField(1, 1),
      ...encodeStringField(2, "Altis"),
      ...encodeStringField(3, "Op"),
      ...encodeVarintField(4, 500),
      ...encodeVarintField(5, 300),
      ...encodeVarintField(6, 1000),
      ...encodeVarintField(7, 2),
      ...encodeMessageField(10, counterBytes),
    ];

    const manifest = decoder.decodeManifest(toBuffer(bytes));
    const event = manifest.events[0];
    expect(event.type).toBe("counterInit");
    if (event.type === "counterInit") {
      expect(event.data).toEqual([10, 20, 30]);
    }
  });

  it("decodes time samples", () => {
    const timeBytes = [
      ...encodeVarintField(1, 0), // frameNum
      ...encodeStringField(2, "2025-01-15T12:00:00Z"), // systemTimeUtc
    ];

    const bytes = [
      ...encodeVarintField(1, 1),
      ...encodeStringField(2, "Altis"),
      ...encodeStringField(3, "Op"),
      ...encodeVarintField(4, 500),
      ...encodeVarintField(5, 300),
      ...encodeVarintField(6, 1000),
      ...encodeVarintField(7, 2),
      ...encodeMessageField(9, timeBytes),
    ];

    const manifest = decoder.decodeManifest(toBuffer(bytes));
    expect(manifest.times).toHaveLength(1);
    expect(manifest.times[0].frameNum).toBe(0);
    expect(manifest.times[0].systemTimeUtc).toBe("2025-01-15T12:00:00Z");
  });

  it("decodes markers", () => {
    const posBytes = [
      ...encodeVarintField(1, 10), // frameNum
      ...encodeFloatField(2, 500.0), // posX
      ...encodeFloatField(3, 600.0), // posY
      ...encodeFloatField(4, 0.0), // posZ
      ...encodeFloatField(5, 90.0), // direction
      ...encodeFloatField(6, 0.8), // alpha
    ];

    const markerBytes = [
      ...encodeStringField(1, "mil_dot"), // type
      ...encodeStringField(2, "HQ"), // text
      ...encodeVarintField(3, 10), // startFrame
      ...encodeVarintField(4, 500), // endFrame
      // playerId: -1 → ZigZag: 1
      ...encodeTag(5, 0),
      ...encodeSignedVarint(-1),
      ...encodeStringField(6, "#FF0000"), // color
      ...encodeVarintField(7, 1), // side = WEST
      ...encodeMessageField(8, posBytes),
      ...encodeStringField(10, "ICON"), // shape
      ...encodeStringField(11, "Solid"), // brush
    ];

    const bytes = [
      ...encodeVarintField(1, 1),
      ...encodeStringField(2, "Altis"),
      ...encodeStringField(3, "Op"),
      ...encodeVarintField(4, 500),
      ...encodeVarintField(5, 300),
      ...encodeVarintField(6, 1000),
      ...encodeVarintField(7, 2),
      ...encodeMessageField(11, markerBytes),
    ];

    const manifest = decoder.decodeManifest(toBuffer(bytes));
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
    expect(marker.positions[0][0]).toBe(10); // frameNum
    expect(marker.positions[0][1]).toBeCloseTo(500.0); // posX
    expect(marker.positions[0][2]).toBeCloseTo(600.0); // posY
  });

  it("decodes vehicle entity type as unknown", () => {
    const entityBytes = [
      ...encodeVarintField(1, 5),
      ...encodeVarintField(2, 2), // VEHICLE
      ...encodeStringField(3, "Humvee"),
      ...encodeVarintField(4, 1), // WEST
      ...encodeStringField(5, "Alpha"),
      ...encodeVarintField(7, 0),
      ...encodeVarintField(8, 100),
    ];

    const bytes = [
      ...encodeVarintField(1, 1),
      ...encodeStringField(2, "Altis"),
      ...encodeStringField(3, "Op"),
      ...encodeVarintField(4, 100),
      ...encodeVarintField(5, 100),
      ...encodeVarintField(6, 1000),
      ...encodeVarintField(7, 1),
      ...encodeMessageField(8, entityBytes),
    ];

    const manifest = decoder.decodeManifest(toBuffer(bytes));
    expect(manifest.entities[0].type).toBe("unknown");
  });

  it("maps side enums correctly", () => {
    const sides = [
      { num: 1, expected: "WEST" },
      { num: 2, expected: "EAST" },
      { num: 3, expected: "GUER" },
      { num: 4, expected: "CIV" },
    ];

    for (const { num, expected } of sides) {
      const entityBytes = [
        ...encodeVarintField(1, num),
        ...encodeVarintField(2, 1),
        ...encodeStringField(3, "Test"),
        ...encodeVarintField(4, num),
        ...encodeStringField(5, "G"),
        ...encodeVarintField(7, 0),
        ...encodeVarintField(8, 10),
      ];

      const bytes = [
        ...encodeVarintField(1, 1),
        ...encodeStringField(2, "W"),
        ...encodeStringField(3, "M"),
        ...encodeVarintField(4, 10),
        ...encodeVarintField(5, 10),
        ...encodeVarintField(6, 1000),
        ...encodeVarintField(7, 1),
        ...encodeMessageField(8, entityBytes),
      ];

      const manifest = decoder.decodeManifest(toBuffer(bytes));
      expect(manifest.entities[0].side).toBe(expected);
    }
  });

  it("skips unknown fields gracefully", () => {
    const bytes = [
      ...encodeVarintField(1, 1), // version
      ...encodeStringField(2, "Altis"),
      ...encodeStringField(3, "Op"),
      ...encodeVarintField(4, 100),
      ...encodeVarintField(5, 100),
      ...encodeVarintField(6, 1000),
      ...encodeVarintField(7, 1),
      ...encodeVarintField(99, 42), // unknown field
      ...encodeStringField(100, "unknown"), // unknown field
    ];

    const manifest = decoder.decodeManifest(toBuffer(bytes));
    expect(manifest.version).toBe(1);
    expect(manifest.worldName).toBe("Altis");
  });
});

// ─── Chunk decoding tests ───

describe("ProtobufDecoder.decodeChunk", () => {
  const decoder = new ProtobufDecoder();

  it("decodes a chunk with entity states", () => {
    const entityState1 = [
      ...encodeVarintField(1, 10), // entityId
      ...encodeFloatField(2, 100.0), // posX
      ...encodeFloatField(3, 200.0), // posY
      ...encodeVarintField(4, 90), // direction
      ...encodeVarintField(5, 1), // alive
    ];

    const entityState2 = [
      ...encodeVarintField(1, 20), // entityId
      ...encodeFloatField(2, 300.0), // posX
      ...encodeFloatField(3, 400.0), // posY
      ...encodeVarintField(4, 180), // direction
      ...encodeVarintField(5, 1), // alive
    ];

    const frame0 = [
      ...encodeVarintField(1, 0), // frameNum
      ...encodeMessageField(2, entityState1),
      ...encodeMessageField(2, entityState2),
    ];

    const entityState1Frame1 = [
      ...encodeVarintField(1, 10), // entityId
      ...encodeFloatField(2, 105.0), // posX
      ...encodeFloatField(3, 205.0), // posY
      ...encodeVarintField(4, 95), // direction
      ...encodeVarintField(5, 1), // alive
    ];

    const frame1 = [
      ...encodeVarintField(1, 1), // frameNum
      ...encodeMessageField(2, entityState1Frame1),
    ];

    const bytes = [
      ...encodeVarintField(1, 0), // index
      ...encodeVarintField(2, 0), // startFrame
      ...encodeVarintField(3, 2), // frameCount
      ...encodeMessageField(4, frame0),
      ...encodeMessageField(4, frame1),
    ];

    const chunk = decoder.decodeChunk(toBuffer(bytes));

    // Entity 10 should have 2 states (one per frame)
    const states10 = chunk.entities.get(10);
    expect(states10).toBeDefined();
    expect(states10).toHaveLength(2);
    expect(states10![0].position).toEqual([100.0, 200.0]);
    expect(states10![0].direction).toBe(90);
    expect(states10![0].alive).toBe(1);
    expect(states10![1].position[0]).toBeCloseTo(105.0);
    expect(states10![1].position[1]).toBeCloseTo(205.0);

    // Entity 20 should have 1 state (only in frame 0)
    const states20 = chunk.entities.get(20);
    expect(states20).toBeDefined();
    expect(states20).toHaveLength(1);
    expect(states20![0].position).toEqual([300.0, 400.0]);
  });

  it("decodes entity state with crew, vehicle, name, and player fields", () => {
    const entityState = [
      ...encodeVarintField(1, 5), // entityId
      ...encodeFloatField(2, 50.0), // posX
      ...encodeFloatField(3, 60.0), // posY
      ...encodeVarintField(4, 45), // direction
      ...encodeVarintField(5, 1), // alive
      // crew_ids: packed repeated varint [10, 20]
      ...encodeTag(6, 2),
      ...encodeVarint(encodeVarint(10).length + encodeVarint(20).length),
      ...encodeVarint(10),
      ...encodeVarint(20),
      ...encodeVarintField(7, 99), // vehicleId
      ...encodeVarintField(8, 1), // isInVehicle
      ...encodeStringField(9, "NewName"), // name
      ...encodeVarintField(10, 1), // isPlayer
    ];

    const frame = [
      ...encodeVarintField(1, 0),
      ...encodeMessageField(2, entityState),
    ];

    const bytes = [
      ...encodeVarintField(1, 0),
      ...encodeVarintField(2, 0),
      ...encodeVarintField(3, 1),
      ...encodeMessageField(4, frame),
    ];

    const chunk = decoder.decodeChunk(toBuffer(bytes));
    const states = chunk.entities.get(5)!;
    expect(states).toHaveLength(1);

    const state = states[0];
    expect(state.position).toEqual([50.0, 60.0]);
    expect(state.direction).toBe(45);
    expect(state.alive).toBe(1);
    expect(state.crewIds).toEqual([10, 20]);
    expect(state.vehicleId).toBe(99);
    expect(state.isInVehicle).toBe(true);
    expect(state.name).toBe("NewName");
    expect(state.isPlayer).toBe(true);
  });

  it("decodes dead and unconscious alive states", () => {
    const deadState = [
      ...encodeVarintField(1, 1),
      ...encodeFloatField(2, 0),
      ...encodeFloatField(3, 0),
      ...encodeVarintField(4, 0),
      ...encodeVarintField(5, 0), // dead
    ];

    const unconsciousState = [
      ...encodeVarintField(1, 2),
      ...encodeFloatField(2, 0),
      ...encodeFloatField(3, 0),
      ...encodeVarintField(4, 0),
      ...encodeVarintField(5, 2), // unconscious
    ];

    const frame = [
      ...encodeVarintField(1, 0),
      ...encodeMessageField(2, deadState),
      ...encodeMessageField(2, unconsciousState),
    ];

    const bytes = [
      ...encodeVarintField(1, 0),
      ...encodeVarintField(2, 0),
      ...encodeVarintField(3, 1),
      ...encodeMessageField(4, frame),
    ];

    const chunk = decoder.decodeChunk(toBuffer(bytes));
    expect(chunk.entities.get(1)![0].alive).toBe(0);
    expect(chunk.entities.get(2)![0].alive).toBe(2);
  });

  it("returns empty map for empty chunk", () => {
    const bytes = [
      ...encodeVarintField(1, 0),
      ...encodeVarintField(2, 0),
      ...encodeVarintField(3, 0),
    ];

    const chunk = decoder.decodeChunk(toBuffer(bytes));
    expect(chunk.entities.size).toBe(0);
  });

  it("handles optional fields as undefined when absent", () => {
    const entityState = [
      ...encodeVarintField(1, 1),
      ...encodeFloatField(2, 10.0),
      ...encodeFloatField(3, 20.0),
      ...encodeVarintField(4, 0),
      ...encodeVarintField(5, 1),
      // No crewIds, vehicleId, isInVehicle, name, isPlayer
    ];

    const frame = [
      ...encodeVarintField(1, 0),
      ...encodeMessageField(2, entityState),
    ];

    const bytes = [
      ...encodeVarintField(1, 0),
      ...encodeVarintField(2, 0),
      ...encodeVarintField(3, 1),
      ...encodeMessageField(4, frame),
    ];

    const chunk = decoder.decodeChunk(toBuffer(bytes));
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
