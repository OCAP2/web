import { describe, expect, it } from "vitest";
import { JsonDecoder } from "../json-decoder";

/** Convert a JSON object to an ArrayBuffer. */
function toBuffer(obj: unknown): ArrayBuffer {
  const text = JSON.stringify(obj);
  return new TextEncoder().encode(text).buffer;
}

describe("JsonDecoder.decodeManifest", () => {
  const decoder = new JsonDecoder();

  it("decodes a minimal operation", () => {
    const data = {
      worldName: "Altis",
      missionName: "Test Op",
      endFrame: 500,
      captureDelay: 1,
    };

    const manifest = decoder.decodeManifest(toBuffer(data));

    expect(manifest.version).toBe(0);
    expect(manifest.worldName).toBe("Altis");
    expect(manifest.missionName).toBe("Test Op");
    expect(manifest.frameCount).toBe(500);
    expect(manifest.captureDelayMs).toBe(1000);
    expect(manifest.chunkSize).toBe(500);
    expect(manifest.chunkCount).toBe(1);
    expect(manifest.entities).toEqual([]);
    expect(manifest.events).toEqual([]);
    expect(manifest.markers).toEqual([]);
    expect(manifest.times).toEqual([]);
  });

  it("decodes unit entities", () => {
    const data = {
      worldName: "Altis",
      missionName: "Op",
      endFrame: 100,
      captureDelay: 1,
      entities: [
        {
          id: 1,
          type: "unit",
          name: "Player1",
          side: "WEST",
          group: "Alpha 1",
          isPlayer: 1,
          startFrameNum: 0,
          role: "Rifleman",
          positions: [
            [[100, 200], 90, 1, 0, "Player1", 1],
            [[105, 205], 95, 1, 0, "Player1", 1],
          ],
        },
      ],
    };

    const manifest = decoder.decodeManifest(toBuffer(data));
    expect(manifest.entities).toHaveLength(1);

    const entity = manifest.entities[0];
    expect(entity.id).toBe(1);
    expect(entity.type).toBe("man");
    expect(entity.name).toBe("Player1");
    expect(entity.side).toBe("WEST");
    expect(entity.groupName).toBe("Alpha 1");
    expect(entity.isPlayer).toBe(true);
    expect(entity.startFrame).toBe(0);
    expect(entity.endFrame).toBe(1); // startFrame + positions.length - 1
    expect(entity.role).toBe("Rifleman");
  });

  it("detects isInVehicle from vehicle entity ID (not just boolean 1)", () => {
    // In legacy JSON, field[3] for units is 0 (not in vehicle)
    // or a vehicle entity ID (e.g. 17) when riding in that vehicle
    const data = {
      worldName: "Altis",
      missionName: "Op",
      endFrame: 10,
      captureDelay: 1,
      entities: [
        {
          id: 1,
          type: "unit",
          name: "Pilot",
          side: "WEST",
          startFrameNum: 0,
          positions: [
            [[100, 200], 0, 1, 17, "Pilot", 1],   // in vehicle 17
            [[100, 200], 0, 1, 0, "Pilot", 1],     // on foot
            [[100, 200], 0, 1, 1, "Pilot", 1],     // in vehicle 1
          ],
        },
      ],
    };

    const manifest = decoder.decodeManifest(toBuffer(data));
    const positions = manifest.entities[0].positions!;

    expect(positions[0].isInVehicle).toBe(true);
    expect(positions[0].vehicleId).toBe(17);

    expect(positions[1].isInVehicle).toBe(false);
    expect(positions[1].vehicleId).toBeUndefined();

    expect(positions[2].isInVehicle).toBe(true);
    expect(positions[2].vehicleId).toBe(1);
  });

  it("decodes vehicle entities as unknown type", () => {
    const data = {
      worldName: "Altis",
      missionName: "Op",
      endFrame: 50,
      captureDelay: 1,
      entities: [
        {
          id: 10,
          type: "vehicle",
          name: "Humvee",
          side: "WEST",
          group: "Alpha",
          isPlayer: 0,
          startFrameNum: 5,
          class: "B_MRAP_01_F",
          positions: [
            [[300, 400], 180, 1, []],
          ],
        },
      ],
    };

    const manifest = decoder.decodeManifest(toBuffer(data));
    const entity = manifest.entities[0];
    expect(entity.type).toBe("unknown");
    expect(entity.isPlayer).toBe(false);
    expect(entity.startFrame).toBe(5);
    expect(entity.endFrame).toBe(5);
  });

  it("maps vehicle type to correct entity type", () => {
    const types = [
      ["heli", "heli"],
      ["tank", "tank"],
      ["car", "car"],
      ["apc", "apc"],
      ["truck", "truck"],
      ["sea", "ship"],
      ["plane", "plane"],
      ["parachute", "parachute"],
      ["static-weapon", "staticWeapon"],
      ["static-mortar", "staticMortar"],
    ] as const;

    for (const [rawType, expectedType] of types) {
      const data = {
        worldName: "Altis",
        missionName: "Op",
        endFrame: 10,
        captureDelay: 1,
        entities: [
          {
            id: 1,
            type: rawType,
            name: "Veh",
            side: "WEST",
            startFrameNum: 0,
            positions: [[[0, 0], 0, 1, []]],
          },
        ],
      };
      const manifest = decoder.decodeManifest(toBuffer(data));
      expect(manifest.entities[0].type).toBe(expectedType);
    }
  });

  it("decodes vehicle positions with crew IDs", () => {
    const data = {
      worldName: "Altis",
      missionName: "Op",
      endFrame: 10,
      captureDelay: 1,
      entities: [
        {
          id: 5,
          type: "vehicle",
          name: "UH-80 Ghost Hawk",
          side: "WEST",
          startFrameNum: 0,
          class: "heli",
          positions: [
            [[1000, 2000], 45, 1, [10, 11, 12]],
            [[1010, 2010], 50, 1, [10, 11]],
            [[1020, 2020], 55, 1, []],
          ],
        },
      ],
    };

    const manifest = decoder.decodeManifest(toBuffer(data));
    const entity = manifest.entities[0];
    expect(entity.type).toBe("heli");
    expect(entity.positions).toHaveLength(3);
    expect(entity.positions![0].crewIds).toEqual([10, 11, 12]);
    expect(entity.positions![1].crewIds).toEqual([10, 11]);
    expect(entity.positions![2].crewIds).toEqual([]);
  });

  it("expands RLE vehicle positions into dense per-frame array", () => {
    // Vehicle positions with [startFrame, endFrame] at index 4 are RLE-encoded:
    // the same position applies for all frames in the range.
    const data = {
      worldName: "Altis",
      missionName: "Op",
      endFrame: 10,
      captureDelay: 1,
      entities: [
        {
          id: 20,
          type: "vehicle",
          name: "LAAT",
          side: "WEST",
          startFrameNum: 0,
          class: "heli",
          positions: [
            // RLE entry: frames 0-4 (5 frames), stationary
            [[100, 200], 0, 1, [1, 2], [0, 4]],
            // RLE entry: frames 5-7 (3 frames), moved
            [[150, 250], 45, 1, [1], [5, 7]],
            // RLE entry: frames 8-9 (2 frames), moved again
            [[200, 300], 90, 0, [], [8, 9]],
          ],
        },
      ],
    };

    const manifest = decoder.decodeManifest(toBuffer(data));
    const entity = manifest.entities[0];

    // 3 RLE entries expand to 5 + 3 + 2 = 10 per-frame positions
    expect(entity.positions).toHaveLength(10);
    expect(entity.endFrame).toBe(9); // 0 + 10 - 1

    // Frames 0-4: stationary at [100, 200]
    for (let i = 0; i < 5; i++) {
      expect(entity.positions![i].position).toEqual([100, 200]);
      expect(entity.positions![i].direction).toBe(0);
      expect(entity.positions![i].alive).toBe(1);
      expect(entity.positions![i].crewIds).toEqual([1, 2]);
    }

    // Frames 5-7: moved to [150, 250]
    for (let i = 5; i < 8; i++) {
      expect(entity.positions![i].position).toEqual([150, 250]);
      expect(entity.positions![i].direction).toBe(45);
      expect(entity.positions![i].crewIds).toEqual([1]);
    }

    // Frames 8-9: moved to [200, 300], destroyed
    for (let i = 8; i < 10; i++) {
      expect(entity.positions![i].position).toEqual([200, 300]);
      expect(entity.positions![i].alive).toBe(0);
      expect(entity.positions![i].crewIds).toEqual([]);
    }
  });

  it("handles mixed dense and RLE vehicle positions", () => {
    const data = {
      worldName: "Altis",
      missionName: "Op",
      endFrame: 5,
      captureDelay: 1,
      entities: [
        {
          id: 30,
          type: "vehicle",
          name: "Offroad",
          side: "CIV",
          startFrameNum: 0,
          class: "car",
          positions: [
            // Dense entry (no frame range)
            [[100, 200], 0, 1, []],
            // RLE entry: frames 1-3
            [[110, 210], 10, 1, [], [1, 3]],
            // Dense entry (no frame range)
            [[120, 220], 20, 1, []],
          ],
        },
      ],
    };

    const manifest = decoder.decodeManifest(toBuffer(data));
    const entity = manifest.entities[0];

    // 1 dense + 3 RLE + 1 dense = 5
    expect(entity.positions).toHaveLength(5);
    expect(entity.endFrame).toBe(4);
    expect(entity.positions![0].position).toEqual([100, 200]);
    expect(entity.positions![1].position).toEqual([110, 210]);
    expect(entity.positions![2].position).toEqual([110, 210]);
    expect(entity.positions![3].position).toEqual([110, 210]);
    expect(entity.positions![4].position).toEqual([120, 220]);
  });

  it("uses raw.class for vehicle entity type mapping", () => {
    // In legacy JSON, raw.type is always "vehicle" for non-units,
    // while raw.class carries the simplified vehicle class (e.g. "heli", "car")
    const data = {
      worldName: "Altis",
      missionName: "Op",
      endFrame: 10,
      captureDelay: 1,
      entities: [
        {
          id: 1,
          type: "vehicle",
          name: "Orca",
          side: "EAST",
          startFrameNum: 0,
          class: "heli",
          positions: [[[0, 0], 0, 1, []]],
        },
        {
          id: 2,
          type: "vehicle",
          name: "Offroad",
          side: "CIV",
          startFrameNum: 0,
          class: "car",
          positions: [[[0, 0], 0, 1, []]],
        },
      ],
    };

    const manifest = decoder.decodeManifest(toBuffer(data));
    expect(manifest.entities[0].type).toBe("heli");
    expect(manifest.entities[1].type).toBe("car");
  });

  it("decodes entity with framesFired", () => {
    const data = {
      worldName: "Altis",
      missionName: "Op",
      endFrame: 100,
      captureDelay: 1,
      entities: [
        {
          id: 1,
          type: "unit",
          name: "Shooter",
          side: "EAST",
          group: "Bravo",
          isPlayer: 1,
          startFrameNum: 0,
          positions: [[[100, 200], 90, 1, 0, "Shooter", 1]],
          framesFired: [
            [50, [100.5, 200.5]],
            [75, [110.0, 210.0, 5.0]],
          ],
        },
      ],
    };

    const manifest = decoder.decodeManifest(toBuffer(data));
    const entity = manifest.entities[0];
    expect(entity.framesFired).toHaveLength(2);
    expect(entity.framesFired![0][0]).toBe(50);
    expect(entity.framesFired![0][1]).toEqual([100.5, 200.5]);
    expect(entity.framesFired![1][0]).toBe(75);
    expect(entity.framesFired![1][1]).toEqual([110.0, 210.0]);
  });

  it("decodes hit/killed events", () => {
    const data = {
      worldName: "Altis",
      missionName: "Op",
      endFrame: 100,
      captureDelay: 1,
      events: [
        [100, "killed", 2, [1, "AK-47"], 150],
        [50, "hit", 3, [1, "M4A1"], 75.5],
      ],
    };

    const manifest = decoder.decodeManifest(toBuffer(data));
    expect(manifest.events).toHaveLength(2);

    const evt0 = manifest.events[0];
    expect(evt0.frameNum).toBe(100);
    expect(evt0.type).toBe("killed");
    if (evt0.type === "killed") {
      expect(evt0.victimId).toBe(2);
      expect(evt0.causedById).toBe(1);
      expect(evt0.weapon).toBe("AK-47");
      expect(evt0.distance).toBe(150);
    }

    const evt1 = manifest.events[1];
    expect(evt1.type).toBe("hit");
    if (evt1.type === "hit") {
      expect(evt1.victimId).toBe(3);
      expect(evt1.distance).toBe(75.5);
    }
  });

  it("decodes connected/disconnected events", () => {
    const data = {
      worldName: "Altis",
      missionName: "Op",
      endFrame: 100,
      captureDelay: 1,
      events: [
        [10, "connected", "PlayerA"],
        [200, "disconnected", "PlayerB"],
      ],
    };

    const manifest = decoder.decodeManifest(toBuffer(data));
    expect(manifest.events).toHaveLength(2);

    const evt0 = manifest.events[0];
    expect(evt0.type).toBe("connected");
    if (evt0.type === "connected") {
      expect(evt0.unitName).toBe("PlayerA");
    }

    const evt1 = manifest.events[1];
    expect(evt1.type).toBe("disconnected");
    if (evt1.type === "disconnected") {
      expect(evt1.unitName).toBe("PlayerB");
    }
  });

  it("decodes counter events", () => {
    const data = {
      worldName: "Altis",
      missionName: "Op",
      endFrame: 100,
      captureDelay: 1,
      events: [
        [30, "counterInit", [10, 20, 30]],
        [50, "respawnTickets", [5, 3]],
      ],
    };

    const manifest = decoder.decodeManifest(toBuffer(data));
    expect(manifest.events).toHaveLength(2);

    const evt0 = manifest.events[0];
    expect(evt0.type).toBe("counterInit");
    if (evt0.type === "counterInit") {
      expect(evt0.data).toEqual([10, 20, 30]);
    }

    const evt1 = manifest.events[1];
    expect(evt1.type).toBe("respawnTickets");
    if (evt1.type === "respawnTickets") {
      expect(evt1.data).toEqual([5, 3]);
    }
  });

  it("decodes markers", () => {
    const data = {
      worldName: "Altis",
      missionName: "Op",
      endFrame: 100,
      captureDelay: 1,
      Markers: [
        [
          "mil_dot",
          "HQ",
          10,
          500,
          -1,
          "#FF0000",
          1, // side index (1+1=2 → "GUER" in MARKER_SIDE_MAP)
          [[10, 500, 600]],
          [100, 100],
          "ICON",
          "Solid",
        ],
      ],
    };

    const manifest = decoder.decodeManifest(toBuffer(data));
    expect(manifest.markers).toHaveLength(1);

    const marker = manifest.markers[0];
    expect(marker.type).toBe("mil_dot");
    expect(marker.text).toBe("HQ");
    expect(marker.shape).toBe("ICON");
    expect(marker.color).toBe("#FF0000");
    expect(marker.player).toBe(-1);
    expect(marker.size).toEqual([100, 100]);
    expect(marker.brush).toBe("Solid");
    expect(marker.positions).toHaveLength(1);
  });

  it("decodes markers with minimal fields", () => {
    const data = {
      worldName: "Altis",
      missionName: "Op",
      endFrame: 100,
      captureDelay: 1,
      Markers: [
        [
          "mil_dot",
          "",
          0,
          100,
          -1,
          "ColorBlue",
          0, // side index (0+1=1 → "EAST")
          [[0, 100, 200]],
        ],
      ],
    };

    const manifest = decoder.decodeManifest(toBuffer(data));
    expect(manifest.markers).toHaveLength(1);

    const marker = manifest.markers[0];
    expect(marker.shape).toBe("ICON"); // default
    expect(marker.side).toBe("EAST");
    expect(marker.size).toBeUndefined();
  });

  it("decodes time samples", () => {
    const data = {
      worldName: "Altis",
      missionName: "Op",
      endFrame: 100,
      captureDelay: 1,
      times: [
        { frameNum: 0, systemTimeUTC: "2025-01-15T12:00:00Z" },
        { frameNum: 100, systemTimeUTC: "2025-01-15T12:05:00Z" },
      ],
    };

    const manifest = decoder.decodeManifest(toBuffer(data));
    expect(manifest.times).toHaveLength(2);
    expect(manifest.times[0]).toEqual({
      frameNum: 0,
      systemTimeUtc: "2025-01-15T12:00:00Z",
    });
  });

  it("maps sides correctly", () => {
    const sides = ["WEST", "EAST", "GUER", "CIV"];
    for (const side of sides) {
      const data = {
        worldName: "W",
        missionName: "M",
        endFrame: 1,
        captureDelay: 1,
        entities: [
          {
            id: 1,
            type: "unit",
            name: "T",
            side,
            group: "G",
            isPlayer: 0,
            startFrameNum: 0,
            positions: [[[0, 0], 0, 1, 0, "T", 0]],
          },
        ],
      };

      const manifest = decoder.decodeManifest(toBuffer(data));
      expect(manifest.entities[0].side).toBe(side);
    }
  });

  it("handles missing optional fields gracefully", () => {
    const data = {
      worldName: "Altis",
      missionName: "Op",
      endFrame: 100,
      captureDelay: 1,
      // No entities, events, Markers, or times
    };

    const manifest = decoder.decodeManifest(toBuffer(data));
    expect(manifest.entities).toEqual([]);
    expect(manifest.events).toEqual([]);
    expect(manifest.markers).toEqual([]);
    expect(manifest.times).toEqual([]);
  });

  it("sets captureDelayMs to captureDelay * 1000", () => {
    const data = {
      worldName: "Altis",
      missionName: "Op",
      endFrame: 100,
      captureDelay: 0.5,
    };

    const manifest = decoder.decodeManifest(toBuffer(data));
    expect(manifest.captureDelayMs).toBe(500);
  });

  it("includes missionAuthor when present", () => {
    const data = {
      worldName: "Altis",
      missionName: "Op",
      missionAuthor: "TestAuthor",
      endFrame: 100,
      captureDelay: 1,
    };

    const manifest = decoder.decodeManifest(toBuffer(data));
    expect(manifest.missionAuthor).toBe("TestAuthor");
  });
});

describe("JsonDecoder.decodeChunk", () => {
  const decoder = new JsonDecoder();

  it("throws an error since JSON does not support chunked loading", () => {
    const buffer = new ArrayBuffer(0);
    expect(() => decoder.decodeChunk(buffer)).toThrow(
      "JSON decoder does not support chunked loading",
    );
  });
});

describe("JsonDecoder - DecoderStrategy interface", () => {
  it("has both required methods", () => {
    const decoder = new JsonDecoder();
    expect(typeof decoder.decodeManifest).toBe("function");
    expect(typeof decoder.decodeChunk).toBe("function");
  });
});
