export { runStaticQc, type StaticQcOptions } from "./static-qc.js";
export {
  runQualityGates,
  runGate0MasterBindability,
  runGate1LayerPlan,
  runGate2VisiblePixelFidelity,
  runGate4OverlapSufficiency,
  runGate5GeneratedRegion,
  runGate5GeneratedRegionScaffold,
  type GateId,
  type GateResult,
  type QualityGatesReport,
} from "./gates.js";
export { ANIME_UPPER_BODY_REQUIRED_SEMANTICS } from "./gate-semantics.js";
