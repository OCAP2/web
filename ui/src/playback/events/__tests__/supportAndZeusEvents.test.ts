import { describe, it, expect } from "vitest";
import {
  ExplosionEvent,
  ServiceEvent,
  RadioTransmissionEvent,
  StaticWeaponEvent,
} from "../supportEvents";
import {
  ZeusEntityEvent,
  ZeusRemoteControlEvent,
  ZeusCameraEvent,
  ZeusPingEvent,
  ZeusModuleEvent,
} from "../zeusEvents";
import type {
  ExplosionPayload,
  ServiceEventPayload,
  RadioTransmissionPayload,
  StaticWeaponPayload,
  ZeusEntityPayload,
  ZeusRemoteControlPayload,
  ZeusCameraPayload,
  ZeusPingPayload,
  ZeusModulePayload,
} from "../../../data/types";

const explosion = (overrides: Partial<ExplosionPayload> = {}): ExplosionPayload => ({
  x: 100,
  y: 200,
  ammo: "R_80mm_HE",
  name: "80mm HE",
  radius: 30,
  power: 0.5,
  firerId: 3,
  vehicleId: 4,
  side: "WEST",
  source: "projectile",
  ...overrides,
});

const service = (overrides: Partial<ServiceEventPayload> = {}): ServiceEventPayload => ({
  kind: "repair",
  vehicleId: 10,
  vehicleName: "Hunter",
  unitId: 2,
  unitName: "Sgt Smith",
  side: "WEST",
  x: 5,
  y: 6,
  from: 0.8,
  to: 0.2,
  ...overrides,
});

const radio = (overrides: Partial<RadioTransmissionPayload> = {}): RadioTransmissionPayload => ({
  unitId: 7,
  radio: "tf_anprc152",
  type: "SW",
  action: "Start",
  channel: 1,
  additional: false,
  frequency: 85.5,
  code: "123",
  ...overrides,
});

const staticWeapon = (overrides: Partial<StaticWeaponPayload> = {}): StaticWeaponPayload => ({
  action: "assembled",
  unitId: 8,
  unitName: "Pvt Doe",
  side: "WEST",
  vehicleId: 9,
  class: "B_HMG_01_F",
  name: "HMG",
  x: 11,
  y: 12,
  ...overrides,
});

const zeusEntity = (overrides: Partial<ZeusEntityPayload> = {}): ZeusEntityPayload => ({
  curatorId: 1,
  name: "Zeus",
  playerUid: "7656119",
  bodyUnitId: 42,
  ...overrides,
});

const zeusRemote = (overrides: Partial<ZeusRemoteControlPayload> = {}): ZeusRemoteControlPayload => ({
  curatorId: 1,
  unitId: 5,
  active: true,
  playerUid: "7656119",
  playerName: "Zeus",
  ...overrides,
});

const zeusCamera = (overrides: Partial<ZeusCameraPayload> = {}): ZeusCameraPayload => ({
  curatorId: 1,
  x: 3,
  y: 4,
  dir: 90,
  fov: 40,
  pitch: 10,
  ...overrides,
});

const zeusPing = (overrides: Partial<ZeusPingPayload> = {}): ZeusPingPayload => ({
  curatorId: 1,
  unitId: 6,
  name: "Zeus",
  side: "WEST",
  x: 20,
  y: 21,
  ...overrides,
});

const zeusModule = (overrides: Partial<ZeusModulePayload> = {}): ZeusModulePayload => ({
  curatorId: 1,
  curatorName: "Zeus",
  className: "Module_F",
  displayName: "Module",
  category: "Debug",
  source: "curator",
  x: 30,
  y: 31,
  attachedUnitId: 2,
  attachedName: "Unit",
  ...overrides,
});

describe("supportEvents", () => {
  it("ExplosionEvent exposes position and blast radius", () => {
    const e = new ExplosionEvent(12, 1, explosion());
    expect(e.frameNum).toBe(12);
    expect(e.type).toBe("explosion");
    expect(e.id).toBe(1);
    expect(e.position).toEqual([100, 200]);
    expect(e.radius).toBe(30);
  });

  it("ExplosionEvent carries alternative source kinds", () => {
    const e = new ExplosionEvent(1, 2, explosion({ source: "explosive", radius: 0 }));
    expect(e.radius).toBe(0);
    expect(e.position).toEqual([100, 200]);
  });

  it("ServiceEvent exposes position and spans repair/refuel by absolute delta", () => {
    const e = new ServiceEvent(3, 5, service({ kind: "repair", from: 0.8, to: 0.2 }));
    expect(e.type).toBe("serviceEvent");
    expect(e.position).toEqual([5, 6]);
    expect(e.progress).toBe(Math.abs(0.2 - 0.8));
  });

  it("ServiceEvent refuel uses the absolute delta too", () => {
    const e = new ServiceEvent(3, 5, service({ kind: "refuel", from: 0.1, to: 0.9 }));
    expect(e.progress).toBe(0.8);
  });

  it("ServiceEvent rearm has no meaningful span", () => {
    const e = new ServiceEvent(3, 5, service({ kind: "rearm", from: 0, to: 0 }));
    expect(e.progress).toBeNull();
  });

  it("RadioTransmissionEvent exposes unit, start flag, non-start flag", () => {
    const start = new RadioTransmissionEvent(4, 6, radio({ action: "Start" }));
    const stop = new RadioTransmissionEvent(5, 6, radio({ action: "Stop" }));
    expect(start.type).toBe("radioTransmission");
    expect(start.unitId).toBe(7);
    expect(start.isStart).toBe(true);
    expect(stop.isStart).toBe(false);
  });

  it("StaticWeaponEvent exposes position and assembled flag", () => {
    const e = new StaticWeaponEvent(6, 7, staticWeapon({ action: "assembled" }));
    const d = new StaticWeaponEvent(6, 7, staticWeapon({ action: "disassembled" }));
    expect(e.type).toBe("staticWeapon");
    expect(e.position).toEqual([11, 12]);
    expect(e.assembled).toBe(true);
    expect(d.assembled).toBe(false);
  });
});

describe("zeusEvents", () => {
  it("ZeusEntityEvent exposes the curator id", () => {
    const e = new ZeusEntityEvent(1, 1, zeusEntity({ curatorId: 9 }));
    expect(e.type).toBe("zeusEntity");
    expect(e.curatorId).toBe(9);
  });

  it("ZeusRemoteControlEvent carries its payload", () => {
    const e = new ZeusRemoteControlEvent(2, 2, zeusRemote({ active: false, unitId: 5 }));
    expect(e.type).toBe("zeusRemoteControl");
    expect(e.payload.active).toBe(false);
    expect(e.payload.unitId).toBe(5);
    // Optional fields default undefined.
    expect(e.payload.playerUid).toBe("7656119");
  });

  it("ZeusCameraEvent exposes its payload", () => {
    const e = new ZeusCameraEvent(3, 3, zeusCamera({ fov: 45, pitch: undefined }));
    expect(e.type).toBe("zeusCamera");
    expect(e.payload.fov).toBe(45);
    expect(e.payload.pitch).toBeUndefined();
  });

  it("ZeusPingEvent exposes unit, position", () => {
    const e = new ZeusPingEvent(4, 4, zeusPing());
    expect(e.type).toBe("zeusPing");
    expect(e.unitId).toBe(6);
    expect(e.position).toEqual([20, 21]);
  });

  it("ZeusModuleEvent exposes curator id, position and optional fields", () => {
    const e = new ZeusModuleEvent(5, 5, zeusModule({ attachedUnitId: undefined, source: undefined }));
    expect(e.type).toBe("zeusModule");
    expect(e.curatorId).toBe(1);
    expect(e.position).toEqual([30, 31]);
    expect(e.payload.attachedUnitId).toBeUndefined();
  });
});
