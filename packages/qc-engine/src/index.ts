export { runStaticQc, type StaticQcOptions } from "./static-qc.js";
export {
  runQualityGates,
  runGate0MasterBindability,
  runGate1LayerPlan,
  runGate2VisiblePixelFidelity,
  runGate4OverlapSufficiency,
  runGate5GeneratedRegionScaffold,
  type GateId,
  type GateResult,
  type QualityGatesReport,
} from "./gates.js";
