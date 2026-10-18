import type {
  PlayerSnapshotPayload,
  PlayerSnapshotType,
  RawPlayerSnapshot,
} from "../../data/types";
import { isSnapshotDiff } from "../../data/snapshotDiff";
import { GameEvent } from "./gameEvent";

export class PlayerSnapshotEvent extends GameEvent {
  /**
   * Full snapshot for this frame. Equal to `raw` unless the recording stored a
   * diff, in which case EventManager rebuilds it from the preceding snapshots.
   */
  payload: PlayerSnapshotPayload;

  constructor(
    frameNum: number,
    type: PlayerSnapshotType,
    id: number,
    /** Payload exactly as recorded: either a full snapshot or a diff. */
    public readonly raw: RawPlayerSnapshot,
  ) {
    super(frameNum, type, id);
    this.payload = raw as PlayerSnapshotPayload;
  }

  get unitId(): number {
    return this.raw.unitId;
  }

  get isDiff(): boolean {
    return isSnapshotDiff(this.raw);
  }
}
