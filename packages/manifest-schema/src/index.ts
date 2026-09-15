import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import type { CharacterSpec, LayerManifest, ValidationReport } from "@ai2live/domain";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020") as new (opts?: object) => {
  compile: (schema: object) => ((data: unknown) => boolean) & { errors?: object[] | null };
};
const addFormats = require("ajv-formats") as (ajv: unknown) => void;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveSchema(name: string): string {
  const candidates = [
    path.resolve(__dirname, "../../../schemas", name),
    path.resolve(process.cwd(), "schemas", name),
    path.resolve(process.cwd(), "../../schemas", name),
  ];
  for (const c of candidates) {
    try {
      return readFileSync(c, "utf8");
    } catch {
      /* try next */
    }
  }
  throw new Error(`Schema not found: ${name}`);
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

function load(name: string) {
  return JSON.parse(resolveSchema(name)) as object;
}

export const characterSchema = load("character.schema.json");
export const layerManifestSchema = load("layer-manifest.schema.json");
export const validationSchema = load("validation.schema.json");

const validateCharacterFn = ajv.compile(characterSchema);
const validateLayerManifestFn = ajv.compile(layerManifestSchema);
const validateValidationFn = ajv.compile(validationSchema);

export interface ValidationResult {
  valid: boolean;
  errors: object[] | null | undefined;
}

export function validateCharacter(data: unknown): ValidationResult {
  const valid = Boolean(validateCharacterFn(data));
  return { valid, errors: validateCharacterFn.errors };
}

export function validateLayerManifest(data: unknown): ValidationResult {
  const valid = Boolean(validateLayerManifestFn(data));
  return { valid, errors: validateLayerManifestFn.errors };
}

export function validateValidationReport(data: unknown): ValidationResult {
  const valid = Boolean(validateValidationFn(data));
  return { valid, errors: validateValidationFn.errors };
}

export function assertLayerManifest(data: unknown): LayerManifest {
  const r = validateLayerManifest(data);
  if (!r.valid) {
    throw new Error(`Invalid LayerManifest: ${JSON.stringify(r.errors)}`);
  }
  return data as LayerManifest;
}

export function assertCharacter(data: unknown): CharacterSpec {
  const r = validateCharacter(data);
  if (!r.valid) {
    throw new Error(`Invalid CharacterSpec: ${JSON.stringify(r.errors)}`);
  }
  return data as CharacterSpec;
}

export function assertValidationReport(data: unknown): ValidationReport {
  const r = validateValidationReport(data);
  if (!r.valid) {
    throw new Error(`Invalid ValidationReport: ${JSON.stringify(r.errors)}`);
  }
  return data as ValidationReport;
}
