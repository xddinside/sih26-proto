/**
 * Demo CI barrel: the local git adapter, the CI-shaped runner, and the Compose
 * release adapter contract.
 */
export { LocalGitAdapter } from "./git-adapter.js"
export type { CandidateResult, GitAdapterOptions } from "./git-adapter.js"
export { CIRunner } from "./ci-runner.js"
export type { CIRunReceipt, ScopedResult } from "./ci-runner.js"
export {
  COMPOSE_RELEASE_CONTRACT,
  findContract,
  isWriteApproved,
} from "./release-adapter.js"
export type { AdapterContract, WriteClass } from "./release-adapter.js"
