import { AboutButton, AboutPanel } from "./components/AboutPanel";
import { JourneyPlanner, PlannerButton } from "./components/JourneyPlanner";
import { LineSelector } from "./components/LineSelector";
import { Tour } from "./components/Tour";
import { MapContainer } from "./components/MapContainer";
import { StationBoard } from "./components/StationBoard";
import { TimeControls } from "./components/TimeControls";
import { TimeScrubber } from "./components/TimeScrubber";
import { TrainInspector } from "./components/TrainInspector";

/**
 * `h-dvh` (not `h-screen`) so the layout tracks a mobile browser's collapsing
 * URL bar instead of being sized to the tallest possible viewport and hiding
 * the bottom controls behind it. `w-full` rather than `w-dvw`, which includes
 * the scrollbar gutter on desktop and causes a sliver of horizontal overflow.
 */
export default function App() {
  return (
    <div className="relative h-dvh w-full overflow-hidden bg-slate-900">
      <MapContainer />
      <LineSelector />
      <AboutButton />
      <PlannerButton />
      <TrainInspector />
      <StationBoard />
      {/* Bottom stack: inset by the home-indicator safe area on phones, and
          z-indexed below the detail panels so a bottom sheet covers it rather
          than fighting it for the same pixels. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-2 px-2 pb-safe-b sm:px-4">
        <TimeScrubber />
        <TimeControls />
        <div className="h-2 sm:h-4" />
      </div>
      {/* Above the bottom stack in z-order: both are transient and the user is
          reading them, so they win the corner while they are open. */}
      <JourneyPlanner />
      <Tour />
      <AboutPanel />
    </div>
  );
}
