import { lazy, Suspense } from "react";
import { Spinner } from "@/components/ui/primitives";

// Three.js and the rig model are a meaningful chunk of JS that only this tab
// needs -- lazy-loading keeps them out of the bundle every other page pays for.
const ConveyorRigView = lazy(() => import("@/components/rig/ConveyorRigView"));

export function Rig() {
  return (
    <div className="relative h-full w-full overflow-hidden">
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center bg-obsidian">
            <Spinner />
          </div>
        }
      >
        <ConveyorRigView />
      </Suspense>
    </div>
  );
}
