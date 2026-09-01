import { readFileSync } from "node:fs";
import type { ComponentInfo, Evidence, Relationship } from "../model/types.js";
import type { DocforceConfig } from "../config/types.js";
import { resolveScanScope, walkSourceFiles, type ScanScope } from "./scanScope.js";
import type { ComposeServiceInfo } from "./docker.js";
import { listComposeServices } from "./docker.js";
import { hostnameFromUrl, resolveComponentForFile } from "./relationships.js";

const HTTP_CALL = /\b(fetch|axios|got|ofetch|ky|\$fetch)\b|\baxios\.(get|post|put|patch|delete|head|request)\s*\(/;

const ENV_BIND = /(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\(?\s*process\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[["']([A-Za-z_][A-Za-z0-9_]*)["']\])/;

const ENV_DEFAULT_URL = /process\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[["']([A-Za-z_][A-Za-z0-9_]*)["']\])\s*(?:\?\?|\|\|)\s*["'`](https?:\/\/[^"'`]+)["'`]/;

const DIRECT_ENV_FETCH = /process\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[["']([A-Za-z_][A-Za-z0-9_]*)["']\])/;

const IDENT_FETCH = /\b(?:fetch|axios|got|ofetch|ky|\$fetch)\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)/;
const TEMPLATE_REF = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export function buildComposeDependsOnRelationships(services: readonly ComposeServiceInfo[]): Relationship[] {
  const rels: Relationship[] = [];
  for (const svc of services) {
    for (const dep of svc.dependsOn) {
      if (!services.some((s) => s.name === dep)) continue;
      rels.push({
        id: `rel:infra:${svc.name}:depends-on:infra:${dep}`,
        from: `infra:${svc.name}`,
        to: `infra:${dep}`,
        type: "depends-on",
        classification: "observation",
        confidence: "high",
        evidence: [{
          sourceFile: svc.composeFile,
          evidenceType: "compose-depends-on",
          detail: `${svc.name} depends_on ${dep}`,
        }],
        description: `Compose service ${svc.name} depends_on ${dep}`,
      });
    }
  }
  return rels;
}

export function buildSoftwareServiceDeployRelationships(
  components: readonly ComponentInfo[],
  services: readonly ComposeServiceInfo[],
): Relationship[] {
  const rels: Relationship[] = [];
  for (const svc of services) {
    const comp = components.find((c) => c.id === svc.name || c.name === svc.name);
    if (!comp) continue;
    rels.push({
      id: `rel:${comp.id}:deploys:infra:${svc.name}`,
      from: comp.id,
      to: `infra:${svc.name}`,
      type: "deploys",
      classification: "observation",
      confidence: "high",
      evidence: [{
        sourceFile: svc.composeFile,
        evidenceType: "compose-service",
        detail: `Software component ${comp.id} matches Compose service ${svc.name}`,
      }],
      description: `${comp.id} is deployed as Compose service ${svc.name}`,
    });
  }
  return rels;
}

export function buildLocalServiceHttpRelationships(
  repoRoot: string,
  components: readonly ComponentInfo[],
  analysisExclusions: readonly string[],
  config: DocforceConfig | undefined,
  services: readonly ComposeServiceInfo[],
): Relationship[] {
  if (services.length === 0) return [];
  const base = resolveScanScope(config);
  const scope: ScanScope = { ...base, exclude: [...base.exclude, ...analysisExclusions] };
  const rels: Relationship[] = [];
  const seen = new Set<string>();

  for (const file of walkSourceFiles(repoRoot, scope)) {
    if (file.relPath.endsWith(".py")) continue;
    const content = readFileSync(file.absPath, "utf-8");
    const calls = detectHttpEnvCalls(content, file.relPath);
    const comp = resolveComponentForFile(file.relPath, components);
    if (!comp) continue;

    for (const call of calls) {
      const resolved = resolveLocalService(call, services);
      if (!resolved) continue;
      const relId = `rel:${comp.id}:calls-api:infra:${resolved.service}`;
      const evidence = callEvidence(call, resolved);
      if (seen.has(relId)) {
        const existing = rels.find((rel) => rel.id === relId);
        if (existing) {
          const known = new Set(existing.evidence.map((item) => `${item.evidenceType}:${item.detail ?? ""}`));
          const extra = evidence.filter((item) => !known.has(`${item.evidenceType}:${item.detail ?? ""}`));
          if (extra.length > 0) {
            const idx = rels.indexOf(existing);
            rels[idx] = { ...existing, evidence: [...existing.evidence, ...extra] };
          }
        }
        continue;
      }
      seen.add(relId);
      rels.push({
        id: relId,
        from: comp.id,
        to: `infra:${resolved.service}`,
        type: "calls-api",
        classification: "observation",
        confidence: resolved.via === "name-convention" ? "medium" : "high",
        evidence,
        description: `${comp.id} calls local service ${resolved.service} over HTTP`,
      });
    }
  }

  return rels;
}

interface HttpEnvCall {
  sourceFile: string;
  line: number;
  envVar: string;
  defaultUrl?: string;
  ident?: string;
  requestPath?: string;
}

interface ResolvedService {
  service: string;
  via: "hostname" | "port" | "name-convention";
  detail: string;
}

function detectHttpEnvCalls(content: string, relPath: string): HttpEnvCall[] {
  const lines = content.split("\n");
  const bindings = new Map<string, { envVar: string; defaultUrl?: string }>();

  for (const line of lines) {
    const bind = line.match(ENV_BIND);
    if (!bind?.[1]) continue;
    const envVar = bind[2] ?? bind[3];
    if (!envVar) continue;
    const def = line.match(ENV_DEFAULT_URL);
    const defaultUrl = def?.[3];
    bindings.set(bind[1], { envVar, defaultUrl });
  }

  const calls: HttpEnvCall[] = [];
  for (let i = 0; i < lines.length; i++) {
    const window = [lines[i]!, lines[i + 1] ?? "", lines[i + 2] ?? ""].join("\n");
    if (!HTTP_CALL.test(window)) continue;

    const direct = window.match(DIRECT_ENV_FETCH);
    if (direct && HTTP_CALL.test(window)) {
      const envVar = direct[1] ?? direct[2];
      if (envVar) {
        const def = window.match(ENV_DEFAULT_URL)?.[3];
        calls.push({
          sourceFile: relPath,
          line: i + 1,
          envVar,
          defaultUrl: def,
          requestPath: extractRequestPath(window, envVar),
        });
      }
    }

    TEMPLATE_REF.lastIndex = 0;
    let tmpl: RegExpExecArray | null;
    while ((tmpl = TEMPLATE_REF.exec(window))) {
      const ident = tmpl[1]!;
      const bound = bindings.get(ident);
      if (bound) {
        calls.push({
          sourceFile: relPath,
          line: i + 1,
          envVar: bound.envVar,
          defaultUrl: bound.defaultUrl,
          ident,
          requestPath: extractRequestPath(window, ident),
        });
      }
    }

    const identFetch = window.match(IDENT_FETCH);
    if (identFetch?.[1]) {
      const bound = bindings.get(identFetch[1]);
      if (bound) {
        calls.push({
          sourceFile: relPath,
          line: i + 1,
          envVar: bound.envVar,
          defaultUrl: bound.defaultUrl,
          ident: identFetch[1],
          requestPath: extractRequestPath(window, identFetch[1]),
        });
      }
    }
  }

  const unique: HttpEnvCall[] = [];
  const seen = new Map<string, HttpEnvCall>();
  for (const call of calls) {
    const key = `${call.line}:${call.envVar}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, call);
      continue;
    }
    if (!existing.requestPath && call.requestPath) seen.set(key, { ...existing, requestPath: call.requestPath, ident: existing.ident ?? call.ident });
  }
  unique.push(...seen.values());
  return unique;
}

function resolveLocalService(call: HttpEnvCall, services: readonly ComposeServiceInfo[]): ResolvedService | null {
  const composeValue = findEnvValue(call.envVar, services);
  const url = composeValue || call.defaultUrl;
  if (url) {
    const host = hostnameFromUrl(url) ?? hostFromComposeDns(url);
    if (host) {
      const byName = matchServiceName(host, services);
      if (byName) {
        return {
          service: byName,
          via: "hostname",
          detail: `${call.envVar} → ${stripUserinfo(url)} (host ${host})`,
        };
      }
      if (isLoopback(host)) {
        const port = portFromUrl(url);
        if (port) {
          const byPort = matchServicePort(port, services);
          if (byPort) {
            return {
              service: byPort,
              via: "port",
              detail: `${call.envVar} → ${stripUserinfo(url)} (port ${port})`,
            };
          }
        }
      }
    }
  }

  const byConvention = matchEnvVarToService(call.envVar, services);
  if (byConvention) {
    return {
      service: byConvention,
      via: "name-convention",
      detail: `${call.envVar} names Compose service ${byConvention} and is used in an HTTP call`,
    };
  }
  return null;
}

function findEnvValue(envVar: string, services: readonly ComposeServiceInfo[]): string | undefined {
  for (const svc of services) {
    const binding = svc.envVars.find((e) => e.name === envVar && e.value);
    if (binding?.value && /^https?:\/\//i.test(binding.value)) return binding.value;
  }
  return undefined;
}

function hostFromComposeDns(url: string): string | null {
  const match = url.match(/^https?:\/\/([^/?#:]+)/i);
  return match?.[1]?.toLowerCase() ?? null;
}

function portFromUrl(url: string): string | null {
  const match = url.match(/^https?:\/\/[^/?#:]+:(\d+)/i);
  return match?.[1] ?? null;
}

function isLoopback(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1";
}

function matchServiceName(host: string, services: readonly ComposeServiceInfo[]): string | undefined {
  const normalized = host.toLowerCase();
  return services.find((s) => s.name.toLowerCase() === normalized)?.name;
}

function matchServicePort(port: string, services: readonly ComposeServiceInfo[]): string | undefined {
  return services.find((s) => s.ports.some((p) => p.split(":")[0] === port || p.split(":").includes(port)))?.name;
}

function matchEnvVarToService(envVar: string, services: readonly ComposeServiceInfo[]): string | undefined {
  const stripped = envVar.replace(/_(URL|HOST|ENDPOINT|BASE_URL|BASEURL)$/i, "");
  if (stripped === envVar) return undefined;
  const key = stripped.replace(/_/g, "").toLowerCase();
  return services.find((s) => s.name.replace(/[-_]/g, "").toLowerCase() === key)?.name;
}

function extractRequestPath(window: string, ident?: string): string | undefined {
  if (ident) {
    const escaped = ident.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const tmpl = window.match(new RegExp(`\\$\\{${escaped}\\}(/[A-Za-z0-9._~/-]*)`));
    if (tmpl?.[1] && tmpl[1].length > 1) return tmpl[1].replace(/\/$/, "") || tmpl[1];
    const concat = window.match(new RegExp(`${escaped}\\s*\\+\\s*["'\`](/[^"'\`?]+)`));
    if (concat?.[1]) return concat[1];
  }
  return undefined;
}

function stripUserinfo(url: string): string {
  return url.replace(/^(https?:\/\/)[^/?#]*:@/i, "$1").replace(/\?.*$/, "").replace(/#.*$/, "");
}

function callEvidence(call: HttpEnvCall, resolved: ResolvedService): Evidence[] {
  const evidence: Evidence[] = [
    {
      sourceFile: call.sourceFile,
      evidenceType: "local-service-http",
      line: call.line,
      detail: `HTTP client uses ${call.ident ?? `process.env.${call.envVar}`}`,
    },
    {
      sourceFile: call.sourceFile,
      evidenceType: "env-url-resolution",
      line: call.line,
      detail: resolved.detail,
    },
  ];
  if (call.requestPath) {
    evidence.push({
      sourceFile: call.sourceFile,
      evidenceType: "http-request-path",
      line: call.line,
      detail: `HTTP ${call.requestPath}`,
    });
  }
  return evidence;
}

export function buildVolumeMountRelationships(
  services: readonly ComposeServiceInfo[],
  namedVolumes: readonly string[],
): Relationship[] {
  const named = new Set(namedVolumes);
  const rels: Relationship[] = [];
  const seen = new Set<string>();
  for (const svc of services) {
    for (const mount of svc.volumeMounts) {
      if (!named.has(mount.source)) continue;
      const relId = `rel:infra:${svc.name}:mounts:infra:${mount.source}`;
      if (seen.has(relId)) continue;
      seen.add(relId);
      const target = mount.target ? ` at ${mount.target}` : "";
      rels.push({
        id: relId,
        from: `infra:${svc.name}`,
        to: `infra:${mount.source}`,
        type: "mounts",
        classification: "observation",
        confidence: "high",
        evidence: [{
          sourceFile: svc.composeFile,
          evidenceType: "compose-volume-mount",
          detail: `${svc.name} mounts ${mount.source}${target}`,
        }],
        description: `Compose service ${svc.name} mounts volume ${mount.source}${target}`,
      });
    }
  }
  return rels;
}

export function listNamedVolumes(services: readonly ComposeServiceInfo[]): string[] {
  return [...new Set(services.flatMap((svc) => svc.volumeMounts.map((m) => m.source)))];
}

export function loadComposeServices(repoRoot: string, config?: DocforceConfig): ComposeServiceInfo[] {
  return listComposeServices(repoRoot, config);
}
