package ingestion

import (
	"sort"

	"github.com/OCAP2/extension/v5/pkg/core"
	pb "github.com/OCAP2/web/pkg/schemas/protobuf/v2"
)

func lastFrame(count core.Frame) core.Frame {
	if count > 0 {
		return count - 1
	}
	return 0
}

func (s *Session) seedChunkBoundaries() error {
	cf := s.chunkFlusher
	for _, r := range s.soldiers {
		sort.SliceStable(r.States, func(i, j int) bool { return r.States[i].CaptureFrame < r.States[j].CaptureFrame })
	}
	for _, r := range s.vehicles {
		sort.SliceStable(r.States, func(i, j int) bool { return r.States[i].CaptureFrame < r.States[j].CaptureFrame })
	}
	for idx := uint32(1); idx < cf.ChunkCount(); idx++ {
		frame := core.Frame(idx * cf.ChunkSize())
		var soldiers []*pb.SoldierState
		var vehicles []*pb.VehicleState
		for _, r := range s.soldiers {
			if (r.deleted || r.Soldier.DeleteFrame > 0) && frame > r.Soldier.DeleteFrame {
				continue
			}
			i := sort.Search(len(r.States), func(i int) bool { return r.States[i].CaptureFrame > frame })
			if i > 0 {
				soldiers = append(soldiers, SoldierStateToProto(r.States[i-1]))
			}
		}
		for _, r := range s.vehicles {
			if (r.deleted || r.Vehicle.DeleteFrame > 0) && frame > r.Vehicle.DeleteFrame {
				continue
			}
			i := sort.Search(len(r.States), func(i int) bool { return r.States[i].CaptureFrame > frame })
			if i > 0 {
				vehicles = append(vehicles, VehicleStateToProto(r.States[i-1]))
			}
		}
		if len(soldiers)+len(vehicles) > 0 {
			if err := cf.SeedFrame(uint32(frame), soldiers, vehicles); err != nil {
				return err
			}
		}
	}
	return nil
}
