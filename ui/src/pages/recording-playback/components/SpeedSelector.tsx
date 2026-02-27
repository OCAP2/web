import type { JSX } from "solid-js";
import { useEngine } from "../../../hooks/useEngine";
import { SelectDropdown } from "../../../components/SelectDropdown";

const SPEEDS = [1, 2, 5, 10, 20, 30, 60];
const SPEED_OPTIONS = SPEEDS.map(String);

export function SpeedSelector(): JSX.Element {
  const engine = useEngine();

  return (
    <SelectDropdown
      value={() => String(engine.playbackSpeed())}
      options={SPEED_OPTIONS}
      getLabel={(s) => `${s}x`}
      onSelect={(s) => engine.setSpeed(Number(s))}
    />
  );
}
