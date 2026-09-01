/**
 * Controlled evidence type vocabulary.
 * Each evidence type has defined semantics for what relationship types it can support.
 */
export const EVIDENCE_TYPES = {
  "package-dependency": {
    description: "Dependency declared in package.json or similar manifest",
    supports: ["depends-on", "imports"] as const,
  },
  "module-import": {
    description: "Static or dynamic import/require statement in source code",
    supports: ["imports", "depends-on"] as const,
  },
  "configuration": {
    description: "Value provided via configuration file (e.g. docforce.yml)",
    supports: ["configures"] as const,
  },
  "local-constant-resolution": {
    description: "API URL resolved from a same-file constant binding",
    supports: ["calls-api"] as const,
  },
  "api-request": {
    description: "Direct HTTP/network request to an external API endpoint",
    supports: ["calls-api"] as const,
  },
  "process-spawn": {
    description: "Spawning or executing an external process",
    supports: ["spawns"] as const,
  },
  "database-import": {
    description: "Import of a database driver or client library",
    supports: ["depends-on", "persists-to"] as const,
  },
    "source-analysis": {
    description: "General source code analysis observation",
    supports: ["imports", "depends-on", "invokes", "reads-from", "writes-to", "persists-to", "calls-api", "spawns", "publishes-to", "receives-from", "deploys", "configures", "runs-on", "attached-to", "communicates-over", "mounts"] as const,
  },
  "env-variable": {
    description: "Environment variable configuration",
    supports: ["configures", "persists-to"] as const,
  },
  "file-exists": {
    description: "File or directory existence observation",
    supports: ["depends-on", "configures"] as const,
  },
  "directory-exists": {
    description: "Directory existence observation",
    supports: ["depends-on"] as const,
  },
  "dependency": {
    description: "Package dependency from manifest",
    supports: ["depends-on", "imports"] as const,
  },
  "package-manifest": {
    description: "Information from package.json manifest",
    supports: ["depends-on", "imports"] as const,
  },
  "next-app-route": {
    description: "Next.js App Router page, layout, or route handler file",
    supports: ["configures"] as const,
  },
  "python-import": {
    description: "Python import statement",
    supports: ["imports", "depends-on"] as const,
  },
  "python-dependency": {
    description: "Dependency declared in requirements.txt or pyproject.toml",
    supports: ["depends-on"] as const,
  },
  "compose-service": {
    description: "Docker Compose service definition",
    supports: ["deploys", "depends-on", "runs-on"] as const,
  },
  "compose-volume": {
    description: "Docker Compose named volume",
    supports: ["configures", "mounts"] as const,
  },
  "dockerfile-template": {
    description: "Dockerfile or Dockerfile.template build definition",
    supports: ["deploys", "configures"] as const,
  },
  "balena-config": {
    description: "Balena fleet/application configuration",
    supports: ["deploys", "runs-on", "configures"] as const,
  },
  "web-serial-api": {
    description: "Browser Web Serial API usage",
    supports: ["communicates-over", "depends-on"] as const,
  },
  "usb-device-path": {
    description: "USB or /dev device path reference",
    supports: ["attached-to", "communicates-over"] as const,
  },
  "media-device-api": {
    description: "getUserMedia or mediaDevices camera/microphone access",
    supports: ["attached-to", "depends-on"] as const,
  },
  "alsa-configuration": {
    description: "ALSA audio device configuration",
    supports: ["communicates-over", "configures"] as const,
  },
  "indexeddb-operation": {
    description: "IndexedDB usage in source",
    supports: ["persists-to", "reads-from", "writes-to"] as const,
  },
  "browser-storage-operation": {
    description: "localStorage or sessionStorage usage in source",
    supports: ["persists-to", "reads-from", "writes-to"] as const,
  },
  "env-url-resolution": {
    description: "Same-file environment variable resolved to a local or remote URL used in an HTTP call",
    supports: ["calls-api"] as const,
  },
  "local-service-http": {
    description: "HTTP client call whose destination resolves to a Compose/local service",
    supports: ["calls-api"] as const,
  },
  "compose-depends-on": {
    description: "Docker Compose depends_on between services",
    supports: ["depends-on"] as const,
  },
  "compose-volume-mount": {
    description: "Docker Compose service volume mapping to a named volume",
    supports: ["mounts"] as const,
  },
  "http-request-path": {
    description: "Same-file HTTP request path appended to a resolved service URL",
    supports: ["calls-api"] as const,
  },
  "firestore-operation": {
    description: "Firestore/Firebase read or write operation in source",
    supports: ["reads-from", "writes-to", "persists-to"] as const,
  },
  "docker-config": {
    description: "Docker or Compose configuration observation",
    supports: ["deploys", "configures", "depends-on"] as const,
  },
} as const;

export type EvidenceType = keyof typeof EVIDENCE_TYPES;

/**
 * Check if an evidence type can support a given relationship type.
 * Unknown evidence types are permissively allowed (for forward compatibility).
 */
export function evidenceSupportsRelationship(
  evidenceType: string,
  relationshipType: string,
): boolean {
  const spec = EVIDENCE_TYPES[evidenceType as EvidenceType];
  if (!spec) return true;
  return (spec.supports as readonly string[]).includes(relationshipType);
}
