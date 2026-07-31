import { LineSelector } from "./components/LineSelector";
import { MapContainer } from "./components/MapContainer";
import { StationBoard } from "./components/StationBoard";
import { TimeControls } from "./components/TimeControls";
import { TimeScrubber } from "./components/TimeScrubber";
import { TrainInspector } from "./components/TrainInspector";

export default function App() {
  return (
    <div className="relative h-dvh w-dvw overflow-hidden bg-slate-900">
      <MapContainer />
      <LineSelector />
      <TrainInspector />
      <StationBoard />
      <div className="pointer-events-none absolute inset-x-0 bottom-4 flex flex-col items-center gap-2">
        <TimeScrubber />
        <TimeControls />
      </div>
    </div>
  );
}
