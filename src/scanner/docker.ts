import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { DocforceConfig } from "../config/types.js";
import type { InfrastructureInfo, Provenance, TechnologyInfo, Evidence } from "../model/types.js";
import { isAlwaysExcludedPath, isInInclude, resolveScanScope } from "./scanScope.js";

export interface DockerFindings {
  technologies: TechnologyInfo[];
  infrastructure: InfrastructureInfo[];
}

function obs(sourceFile: string, evidenceType: string, detail: string): Provenance {
  const evidence: Evidence[] = [{ sourceFile, evidenceType, detail }];
  return { kind: "observation", confidence: "high", evidence };
}

function isDockerfileName(name: string): boolean {
  if (name === "Dockerfile" || name === "Dockerfile.template") return true;
  if (name.startsWith("Dockerfile.")) return true;
  if (name.endsWith(".Dockerfile")) return true;
  return false;
}

function isComposeName(name: string): boolean {
  return /^docker-compose(\.[a-zA-Z0-9_-]+)?\.ya?ml$/.test(name);
}

function findNamedFiles(repoRoot: string, config: DocforceConfig | undefined, predicate: (name: string) => boolean): string[] {
  const scope = resolveScanScope(config);
  const found: string[] = [];

  function walk(dir: string, depth: number): void {
    if (depth > 8) return;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    entries.sort();
    for (const name of entries) {
      if (name === "node_modules" || name === ".git" || name === "vendor" || name === ".next") continue;
      const abs = join(dir, name);
      const rel = relative(repoRoot, abs).replace(/\\/g, "/");
      if (isAlwaysExcludedPath(rel)) continue;
      try {
        const st = statSync(abs);
        if (st.isDirectory()) {
          walk(abs, depth + 1);
        } else if (predicate(name)) {
          const include = scope.include.length > 0 ? scope.include : ["**"];
          if (scope.include.length === 0 && depth > 0 && !isDockerfileName(name) && !isComposeName(name)) continue;
          if (isInInclude(rel, include) || scope.include.length === 0 && depth === 0) {
            found.push(rel);
          } else if (scope.include.length > 0 && isInInclude(rel, scope.include)) {
            found.push(rel);
          }
        }
      } catch { /* skip */ }
    }
  }

  walk(repoRoot, 0);
  // Unconfigured consumers: still see root Dockerfiles (v0.9.1 contract)
  if ((config?.scanning.include.length ?? 0) === 0) {
    for (const name of ["Dockerfile", "Dockerfile.dev", "Dockerfile.prod", "Dockerfile.template", "docker-compose.yml", "docker-compose.yaml"]) {
      if (existsSync(resolve(repoRoot, name)) && !found.includes(name)) found.push(name);
    }
  }
  return [...new Set(found)].sort();
}

function scanDockerfile(repoRoot: string, relPath: string): DockerFindings {
  const result: DockerFindings = { technologies: [], infrastructure: [] };
  const filePath = resolve(repoRoot, relPath);
  if (!existsSync(filePath)) return result;
  const content = readFileSync(filePath, "utf-8");
  const evidenceType = /template/i.test(relPath) ? "dockerfile-template" : "docker-config";

  const fromLines = content.match(/^FROM\s+(\S+)/gm);
  if (fromLines) {
    for (const line of fromLines) {
      const image = line.replace(/^FROM\s+/, "").split(/\s/)[0]!;
      result.infrastructure.push({
        type: "container-image",
        name: image,
        detail: `Base image in ${relPath}`,
        provenance: obs(relPath, evidenceType, `FROM ${image}`),
      });
    }
  }

  const exposeLines = content.match(/^EXPOSE\s+(\d+)/gm);
  if (exposeLines) {
    for (const line of exposeLines) {
      const port = line.replace(/^EXPOSE\s+/, "").trim();
      result.infrastructure.push({
        type: "exposed-port",
        name: `Port ${port}`,
        detail: `Container exposes port ${port}`,
        provenance: obs(relPath, evidenceType, `EXPOSE ${port}`),
      });
    }
  }

  result.technologies.push({
    name: "Docker",
    category: "containerization",
    purpose: `Container build defined in ${relPath}`,
    provenance: obs(relPath, evidenceType, "Dockerfile exists"),
  });

  return result;
}

export interface ComposeEnvBinding {
  readonly name: string;
  readonly value?: string;
}

export interface ComposeVolumeMount {
  readonly source: string;
  readonly target?: string;
  readonly mode?: string;
}

export interface ComposeService {
  name: string;
  image?: string;
  dockerfile?: string;
  dependsOn: string[];
  ports: string[];
  volumes: string[];
  volumeMounts: ComposeVolumeMount[];
  networkMode?: string;
  envNames: string[];
  envVars: ComposeEnvBinding[];
  command?: string;
}

export interface ComposeServiceInfo extends ComposeService {
  readonly composeFile: string;
}

function parseCompose(content: string): { services: ComposeService[]; volumes: string[]; networks: string[] } {
  const lines = content.split(/\r?\n/);
  let section: "services" | "volumes" | "networks" | "other" | null = null;
  let current: ComposeService | null = null;
  let currentField: string | null = null;
  const services: ComposeService[] = [];
  const volumes: string[] = [];
  const networks: string[] = [];

  function flush(): void {
    if (current) services.push(current);
    current = null;
    currentField = null;
  }

  for (const raw of lines) {
    if (/^\s*#/.test(raw) || raw.trim() === "") continue;
    const indent = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();

    if (indent === 0 && trimmed.endsWith(":")) {
      flush();
      const key = trimmed.slice(0, -1);
      if (key === "services") section = "services";
      else if (key === "volumes") section = "volumes";
      else if (key === "networks") section = "networks";
      else section = "other";
      continue;
    }

    if (section === "services" && indent === 2 && trimmed.endsWith(":") && !trimmed.startsWith("-")) {
      flush();
      current = {
        name: trimmed.slice(0, -1),
        dependsOn: [],
        ports: [],
        volumes: [],
        volumeMounts: [],
        envNames: [],
        envVars: [],
      };
      currentField = null;
      continue;
    }

    if (section === "volumes" && indent === 2 && /^[\w.-]+:/.test(trimmed) && !trimmed.startsWith("-")) {
      volumes.push(trimmed.split(":")[0]!.trim());
      continue;
    }
    if (section === "networks" && indent === 2 && /^[\w.-]+:/.test(trimmed) && !trimmed.startsWith("-")) {
      networks.push(trimmed.split(":")[0]!.trim());
      continue;
    }

    if (!current || section !== "services") continue;

    if (indent === 4 && trimmed.endsWith(":") && !trimmed.startsWith("-")) {
      currentField = trimmed.slice(0, -1);
      const inline = trimmed;
      void inline;
      continue;
    }

    if (indent === 4 && trimmed.includes(":")) {
      const colon = trimmed.indexOf(":");
      const key = trimmed.slice(0, colon).trim();
      const value = trimmed.slice(colon + 1).trim().replace(/^["']|["']$/g, "");
      currentField = key;
      if (key === "image") current.image = value;
      if (key === "network_mode") current.networkMode = value;
      if (key === "command") current.command = value;
      if (key === "dockerfile") current.dockerfile = value;
      continue;
    }

    if (trimmed.startsWith("- ")) {
      const item = trimmed.slice(2).trim().replace(/^["']|["']$/g, "");
      if (currentField === "depends_on") current.dependsOn.push(item.split(":")[0]!);
      if (currentField === "ports") current.ports.push(item);
      if (currentField === "volumes") {
        const mount = parseVolumeMount(item);
        current.volumeMounts.push(mount);
        if (!current.volumes.includes(mount.source)) current.volumes.push(mount.source);
      }
      if (currentField === "environment") {
        const eq = item.indexOf("=");
        const name = (eq === -1 ? item : item.slice(0, eq)).replace(/^- /, "").trim();
        const value = eq === -1 ? undefined : item.slice(eq + 1).trim();
        if (name) {
          current.envNames.push(name);
          current.envVars.push({ name, value: value || undefined });
        }
      }
    }

    if (indent === 6 && currentField === "environment" && trimmed.includes(":") && !trimmed.startsWith("-")) {
      const colon = trimmed.indexOf(":");
      const name = trimmed.slice(0, colon).trim();
      const value = trimmed.slice(colon + 1).trim().replace(/^["']|["']$/g, "");
      if (name) {
        current.envNames.push(name);
        current.envVars.push({ name, value: value || undefined });
      }
    }

    if (indent === 6 && currentField === "build" && trimmed.startsWith("dockerfile:")) {
      current.dockerfile = trimmed.slice("dockerfile:".length).trim().replace(/^["']|["']$/g, "");
    }
  }
  flush();
  return { services, volumes, networks };
}

function scanComposeFile(repoRoot: string, relPath: string): DockerFindings {
  const result: DockerFindings = { technologies: [], infrastructure: [] };
  const filePath = resolve(repoRoot, relPath);
  if (!existsSync(filePath)) return result;
  const content = readFileSync(filePath, "utf-8");

  result.technologies.push({
    name: "Docker Compose",
    category: "containerization",
    purpose: `Multi-service orchestration in ${relPath}`,
    provenance: obs(relPath, "compose-service", "docker-compose file exists"),
  });

  const parsed = parseCompose(content);
  for (const svc of parsed.services) {
    const bits = [
      svc.image ? `image ${svc.image}` : undefined,
      svc.dockerfile ? `dockerfile ${svc.dockerfile}` : undefined,
      svc.dependsOn.length ? `depends_on ${svc.dependsOn.join(",")}` : undefined,
      svc.ports.length ? `ports ${svc.ports.join(",")}` : undefined,
      svc.networkMode ? `network_mode ${svc.networkMode}` : undefined,
      svc.envNames.length ? `env ${svc.envNames.join(",")}` : undefined,
    ].filter(Boolean);
    result.infrastructure.push({
      type: "docker-service",
      name: svc.name,
      detail: bits.length > 0 ? bits.join("; ") : `Docker Compose service defined in ${relPath}`,
      provenance: obs(relPath, "compose-service", `Service: ${svc.name}`),
    });
  }
  for (const vol of parsed.volumes) {
    result.infrastructure.push({
      type: "docker-volume",
      name: vol,
      detail: `Named volume defined in ${relPath}`,
      provenance: obs(relPath, "compose-volume", `Volume: ${vol}`),
    });
  }
  for (const net of parsed.networks) {
    result.infrastructure.push({
      type: "docker-network",
      name: net,
      detail: `Network defined in ${relPath}`,
      provenance: obs(relPath, "compose-service", `Network: ${net}`),
    });
  }
  return result;
}

export function scanDocker(repoRoot: string, config?: DocforceConfig): DockerFindings {
  const result: DockerFindings = { technologies: [], infrastructure: [] };
  const files = findNamedFiles(repoRoot, config, (name) => isDockerfileName(name) || isComposeName(name));
  const seenTech = new Set<string>();

  for (const rel of files) {
    const name = rel.split("/").pop()!;
    const findings = isComposeName(name) ? scanComposeFile(repoRoot, rel) : scanDockerfile(repoRoot, rel);
    for (const t of findings.technologies) {
      const key = `${t.name}:${t.purpose}`;
      if (seenTech.has(key)) continue;
      seenTech.add(key);
      result.technologies.push(t);
    }
    result.infrastructure.push(...findings.infrastructure);
  }
  return result;
}

export function listComposeServices(repoRoot: string, config?: DocforceConfig): ComposeServiceInfo[] {
  const files = findNamedFiles(repoRoot, config, (name) => isComposeName(name));
  const services: ComposeServiceInfo[] = [];
  for (const rel of files) {
    const filePath = resolve(repoRoot, rel);
    if (!existsSync(filePath)) continue;
    const parsed = parseCompose(readFileSync(filePath, "utf-8"));
    for (const svc of parsed.services) {
      services.push({ ...svc, composeFile: rel });
    }
  }
  return services;
}

export function parseVolumeMount(item: string): ComposeVolumeMount {
  const cleaned = item.replace(/^["']|["']$/g, "");
  const parts = cleaned.split(":");
  if (parts.length === 1) return { source: parts[0]! };
  if (parts.length === 2) return { source: parts[0]!, target: parts[1] };
  return { source: parts[0]!, target: parts[1], mode: parts.slice(2).join(":") };
}

export { parseCompose, isDockerfileName };
