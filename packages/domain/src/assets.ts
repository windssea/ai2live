import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import path from "node:path";

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Content-addressed relative path: assets/sha256/ab/cd/<fullhash><ext> */
export function contentAddressedPath(hash: string, ext = ".png"): string {
  const h = hash.toLowerCase().replace(/^sha256:/, "");
  if (!/^[0-9a-f]{64}$/.test(h)) {
    throw new Error(`Invalid sha256 hash: ${hash}`);
  }
  return path.posix.join("assets", "sha256", h.slice(0, 2), h.slice(2, 4), `${h}${ext}`);
}

export async function storeAsset(
  rootDir: string,
  data: Buffer,
  ext = ".png"
): Promise<{ hash: string; relativePath: string; absolutePath: string }> {
  const hash = sha256Hex(data);
  const relativePath = contentAddressedPath(hash, ext);
  const absolutePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  try {
    await access(absolutePath);
  } catch {
    await writeFile(absolutePath, data);
  }
  return { hash, relativePath, absolutePath };
}

export async function readAsset(rootDir: string, hashOrPath: string): Promise<Buffer> {
  if (hashOrPath.includes("/") || hashOrPath.includes("\\")) {
    return readFile(path.isAbsolute(hashOrPath) ? hashOrPath : path.join(rootDir, hashOrPath));
  }
  const hash = hashOrPath.replace(/^sha256:/, "");
  const relativePath = contentAddressedPath(hash, ".png");
  return readFile(path.join(rootDir, relativePath));
}
