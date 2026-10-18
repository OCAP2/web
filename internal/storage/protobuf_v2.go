package storage

import (
	"encoding/json"

	pb "github.com/OCAP2/web/pkg/schemas/protobuf/v2"
	"google.golang.org/protobuf/proto"
)

// The storage engine serves metadata/stats for both formats. Legacy conversion
// continues writing v1; v2 is produced directly by live ingestion.
func readV2Manifest(data []byte) (*Manifest, error) {
	var p pb.Manifest
	if err := proto.Unmarshal(data, &p); err != nil {
		return nil, err
	}
	endFrame := p.FrameCount
	if endFrame > 0 {
		endFrame--
	}
	m := &Manifest{Version: p.Version, EndFrame: endFrame, ChunkSize: p.ChunkSize, CaptureDelayMs: p.CaptureDelayMs, ChunkCount: p.ChunkCount}
	if p.World != nil {
		m.WorldName = p.World.WorldName
	}
	if p.Mission != nil {
		m.MissionName = p.Mission.MissionName
		m.ExtensionVersion = p.Mission.ExtensionVersion
		m.AddonVersion = p.Mission.AddonVersion
	}
	for _, s := range p.Soldiers {
		m.Entities = append(m.Entities, EntityDef{ID: s.Id, Type: "unit", Name: s.Name, Side: v2Side(s.Side), Group: s.GroupName, Role: s.Role, StartFrame: s.StartFrame, EndFrame: s.EndFrame, IsPlayer: s.IsPlayer})
	}
	for _, v := range p.Vehicles {
		m.Entities = append(m.Entities, EntityDef{ID: v.Id, Type: "vehicle", Name: v.Name, VehicleClass: v.VehicleClass, StartFrame: v.StartFrame, EndFrame: v.EndFrame})
	}
	for _, e := range p.Events {
		evt := Event{FrameNum: e.FrameNum}
		switch {
		case e.GetKill() != nil:
			k := e.GetKill()
			evt.Type = "killed"
			evt.SourceID = k.KillerSoldierId
			evt.TargetID = k.VictimSoldierId
			evt.Weapon = k.EventText
			evt.Distance = k.Distance
			if k.KillerIsVehicle {
				evt.SourceID = k.KillerVehicleId
			}
			if k.VictimIsVehicle {
				evt.TargetID = k.VictimVehicleId
			}
		case e.GetHit() != nil:
			k := e.GetHit()
			evt.Type = "hit"
			evt.SourceID = k.ShooterSoldierId
			evt.TargetID = k.VictimSoldierId
			evt.Weapon = k.EventText
			evt.Distance = k.Distance
			if k.ShooterIsVehicle {
				evt.SourceID = k.ShooterVehicleId
			}
			if k.VictimIsVehicle {
				evt.TargetID = k.VictimVehicleId
			}
		case e.GetGeneral() != nil:
			g := e.GetGeneral()
			evt.Type = g.Name
			evt.Message = g.Message
			evt.Side = g.Side
			evt.ObjectType = g.ObjectType
			evt.UnitName = g.UnitName
			var extra struct {
				Side     string
				Position []float32
			}
			json.Unmarshal(g.ExtraDataJson, &extra)
			if evt.Side == "" {
				evt.Side = extra.Side
			}
			if len(extra.Position) >= 2 {
				evt.PosX = extra.Position[0]
				evt.PosY = extra.Position[1]
			}
		case e.GetConnect() != nil:
			c := e.GetConnect()
			evt.Type = "disconnected"
			if c.IsConnect {
				evt.Type = "connected"
			}
			evt.Message = c.UnitName
		case e.GetEndMission() != nil:
			k := e.GetEndMission()
			evt.Type = "endMission"
			evt.Side = k.Side
			evt.Message = k.Message
		default:
			continue
		}
		m.Events = append(m.Events, evt)
	}
	return m, nil
}

func v2Side(s pb.Side) string {
	switch s {
	case pb.Side_SIDE_WEST:
		return "WEST"
	case pb.Side_SIDE_EAST:
		return "EAST"
	case pb.Side_SIDE_GUER:
		return "GUER"
	case pb.Side_SIDE_CIV:
		return "CIV"
	default:
		return "UNKNOWN"
	}
}
