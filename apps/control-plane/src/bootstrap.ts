/**
 * Wire the Control Plane runtime: store, journal, artifacts, leases, and the
 * state machine. Called once at boot by the server and the smoke script.
 */
import { ArtifactService } from "./artifacts/artifact-service.js"
import { systemClock  } from "./clock.js"
import type {Clock} from "./clock.js";
import type { Config } from "./config.js"
import { JournalService } from "./core/journal-service.js"
import { ControlPlane } from "./core/state-machine.js"
import { LeaseService } from "./leases/lease-service.js"
import type { Store} from "./store/store.js";
import { openStore } from "./store/store.js"

export interface Runtime {
  store: Store
  cp: ControlPlane
  config: Config
  clock: Clock
}

export async function bootstrap(config: Config, clock: Clock = systemClock): Promise<Runtime> {
  const store = await openStore(config)
  const journal = new JournalService(store)
  const artifacts = new ArtifactService(store, clock)
  const leases = new LeaseService(store, clock, config)
  const cp = new ControlPlane(store, journal, artifacts, leases, clock, config)
  return { store, cp, config, clock }
}
