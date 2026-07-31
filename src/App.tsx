import { MapContainer } from "./components/MapContainer";
import { StationBoard } from "./components/StationBoard";
import { TimeControls } from "./components/TimeControls";
import { TimeScrubber } from "./components/TimeScrubber";
import { TrainInspector } from "./components/TrainInspector";
import { useAppStore } from "./stores/useAppStore";

export default function App() {
  const mapReady = useAppStore((s) => s.mapReady);

  return (
    <div className="relative h-dvh w-dvw overflow-hidden bg-slate-900">
      <MapContainer />
      <div className="pointer-events-none absolute left-4 top-4 rounded-xl bg-white/85 px-4 py-3 shadow-lg backdrop-blur">
        <h1 className="text-sm font-semibold text-slate-900">
          Greater Bangkok Metro Mini 3D
        </h1>
        <p className="text-xs text-slate-500">
          MVP 4 — BTS Green Line live schedule {mapReady ? "" : "· loading map…"}
        </p>
        <ul className="mt-2 space-y-1 text-xs text-slate-700">
          <li className="flex items-center gap-2">
            <span className="inline-block h-2 w-4 rounded-sm" style={{ background: "#7CB342" }} />
            Sukhumvit Line (Khu Khot – Kheha)
          </li>
          <li className="flex items-center gap-2">
            <span className="inline-block h-2 w-4 rounded-sm" style={{ background: "#00877C" }} />
            Silom Line (National Stadium – Bang Wa)
          </li>
        </ul>
        <p className="mt-2 text-[10px] text-slate-400">Click a train or station to inspect it.</p>
      </div>
      <TrainInspector />
      <StationBoard />
      <div className="pointer-events-none absolute inset-x-0 bottom-4 flex flex-col items-center gap-2">
        <TimeScrubber />
        <TimeControls />
      </div>
    </div>
  );
}
