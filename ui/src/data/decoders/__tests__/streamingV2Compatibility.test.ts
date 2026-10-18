import { describe,it,expect } from "vitest";
import { ProtobufDecoderV2 } from "../protobufDecoderV2";
import { Manifest,Chunk } from "../generated/v2/ocap_v2";
import { PlayerSnapshotSeries } from "../generated/ocap.pb";

function buffer(bytes: Uint8Array): ArrayBuffer { return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer; }

describe("streamed v2 playback compatibility",()=>{
  const decoder=new ProtobufDecoderV2();
  it("uses upstream events, telemetry and snapshot sidecars",()=>{
    const data=Manifest.encode(Manifest.fromPartial({version:2,frameCount:606,snapshotUnitIds:[1],events:[
      {frameNum:0,general:{name:"inventorySnapshot",message:JSON.stringify({unitId:1,reason:"periodic"})}},
      {frameNum:300,general:{name:"captured",objectType:"sector",unitName:"A",side:"WEST",extraDataJson:new TextEncoder().encode(JSON.stringify({position:[100,200,0]}))}},
      {frameNum:604,telemetry:{fpsAverage:48,fpsMin:40,weather:{rain:0.5}}},
      {frameNum:300,radio:{soldierId:1,frequency:50,startEnd:"start",code:"net"}},
    ]})).finish();
    const manifest=decoder.decodeManifest(buffer(data));
    expect(manifest.endFrame).toBe(605);
    expect(manifest.snapshotUnitIds).toEqual([1]);
    expect(manifest.events).toContainEqual({frameNum:0,type:"inventorySnapshot",payload:{unitId:1,reason:"periodic"}});
    expect(manifest.events.find(e=>e.type==="captured")).toMatchObject({position:[100,200],side:"WEST"});
    expect(manifest.events).toContainEqual({frameNum:604,type:"serverFps",fps:48});
    expect(manifest.events.find(e=>e.type==="weather")).toMatchObject({payload:{rain:0.5}});
    expect(manifest.events.find(e=>e.type==="radioTransmission")).toMatchObject({payload:{unitId:1,frequency:50,code:"net"}});
    const sidecar=PlayerSnapshotSeries.encode(PlayerSnapshotSeries.fromPartial({events:[{frameNum:300,type:"staminaSnapshot",message:'{"unitId":1,"stamina":0.5}'}]})).finish();
    expect(decoder.decodePlayerSnapshots(buffer(sidecar))).toEqual([{frameNum:300,type:"staminaSnapshot",payload:{unitId:1,stamina:0.5}}]);
  });

  it("preserves marker coordinate shapes and style changes",()=>{
    const data=Manifest.encode(Manifest.fromPartial({version:2,markers:[
      {type:"mil_dot",shape:"ICON",positions:[{frameNum:0,position:{x:100,y:200,z:0},alpha:1},{frameNum:5,position:{x:300,y:400,z:0},alpha:0.5,hasStyle:true,text:"moved",color:"0000ff",type:"mil_dot",shape:"ICON",size:[2,2]}]},
      {shape:"POLYLINE",positions:[{frameNum:0,lineCoords:[1,2,3,4],alpha:1}]},
    ]})).finish();
    const manifest=decoder.decodeManifest(buffer(data));
    expect(manifest.markers[0].positions[0]).toEqual([0,[100,200,0],0,1]);
    expect(manifest.markers[0].positions[1]).toEqual([5,[300,400,0],0,0.5,"moved","0000ff",[2,2],"mil_dot","","ICON"]);
    expect(manifest.markers[1].positions[0]).toEqual([0,[[1,2],[3,4]],0,1]);
  });

  it("expands sparse chunks and retains explicit zero/false state",()=>{
    const data=Chunk.encode(Chunk.fromPartial({index:1,startFrame:300,frameCount:3,frames:[
      {frameNum:300,soldiers:[{id:1,lifestate:1,isPlayer:true,inVehicle:true,vehicleId:0,role:"Medic"}]},
      {frameNum:302,soldiers:[{id:1,lifestate:1,isPlayer:false,inVehicle:false}],vehicles:[{id:0,alive:true,fuel:0,damage:0,engineOn:false,crewIds:[]}]},
    ]})).finish();
    const chunk=decoder.decodeChunk(buffer(data));const states=chunk.entities.get(1)!;
    expect(states[0]).toMatchObject({isPlayer:true,isInVehicle:true,vehicleId:0,role:"Medic"});
    expect(states[1]).toEqual(states[0]);
    expect(states[2]).toMatchObject({isPlayer:false,isInVehicle:false});
    expect(states[2].vehicleId).toBeUndefined();
    expect(chunk.entities.get(0)![2]).toMatchObject({fuel:0,damage:0,engineOn:false,crewIds:[]});
  });
});
