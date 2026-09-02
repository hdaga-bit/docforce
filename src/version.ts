import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Single source of truth for the DocForce tool version.
 *
 * MODEL_SCHEMA_VERSION is intentionally separate: it only changes when the
 * SystemModel shape changes. It participates in the model fingerprint, so
 * bumping it invalidates previously generated proposals.
 *
 * Package installation paths, this version string, and any packed git
 * revision are not part of a consumer repository's product model fingerprint.
 */
export const DOCFORCE_PACKAGE_NAME = "@mary/docforce";
export const DOCFORCE_VERSION = "1.4.0";
export const MODEL_SCHEMA_VERSION = "1.0.0";

export interface DocforcePackageIdentity {
  readonly name: string;
  readonly version: string;
  readonly gitRevision: string | null;
  readonly packedAt: string | null;
}

interface PackedIdentityFile {
  readonly gitRevision?: string | null;
  readonly packedAt?: string | null;
}

let cachedPacked: PackedIdentityFile | null | undefined;

function loadPackedIdentity(): PackedIdentityFile | null {
  if (cachedPacked !== undefined) return cachedPacked;
  try {
    const path = fileURLToPath(new URL("../identity.json", import.meta.url));
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as PackedIdentityFile;
    cachedPacked = parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    cachedPacked = null;
  }
  return cachedPacked;
}

/**
 * Runtime identity of the installed package. Git revision is stamped at
 * `npm pack` time when the source tree is a git repo.
 */
export function getPackageIdentity(): DocforcePackageIdentity {
  const packed = loadPackedIdentity();
  return {
    name: DOCFORCE_PACKAGE_NAME,
    version: DOCFORCE_VERSION,
    gitRevision: typeof packed?.gitRevision === "string" ? packed.gitRevision : null,
    packedAt: typeof packed?.packedAt === "string" ? packed.packedAt : null,
  };
}

export function formatPackageIdentity(): string {
  const id = getPackageIdentity();
  return id.gitRevision
    ? `${id.name} ${id.version} (${id.gitRevision.slice(0, 12)})`
    : `${id.name} ${id.version}`;
}
