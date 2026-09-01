import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DocforceConfig } from "../config/types.js";
import type { DeviceInfo, InfrastructureInfo, Provenance, Relationship, TechnologyInfo } from "../model/types.js";
import type { ComponentInfo } from "../model/types.js";
import { isInInclude, resolveScanScope, walkSourceFiles, walkScopedFiles } from "./scanScope.js";
import { resolveComponentForFile, sanitizeId } from "./relationships.js";

export interface BalenaFindings {
  infrastructure: InfrastructureInfo[];
  devices: DeviceInfo[];
  technologies: TechnologyInfo[];
}

function obs(sourceFile: string, evidenceType: string, detail: string): Provenance {
  return {
    kind: "observation",
    confidence: "high",
    evidence: [{ sourceFile, evidenceType, detail }],
  };
}

export function scanBalena(repoRoot: string, config?: DocforceConfig): BalenaFindings {
  const result: BalenaFindings = { infrastructure: [], devices: [], technologies: [] };
  const balenaPath = join(repoRoot, "balena.yml");
  const hasBalena = existsSync(balenaPath);
  if (!hasBalena) return result;

  const scope = resolveScanScope(config);
  if (scope.include.length > 0 && !isInInclude("balena.yml", scope.include)) {
    return result;
  }

  const content = readFileSync(balenaPath, "utf-8");
  const nameMatch = content.match(/^name:\s*(.+)$/m);
  const fleetName = nameMatch?.[1]?.trim() ?? "balena-application";

  result.technologies.push({
    name: "Balena",
    category: "device-fleet",
    purpose: "Device fleet application manifest",
    provenance: obs("balena.yml", "balena-config", "balena.yml exists"),
  });

  result.infrastructure.push({
    type: "device-fleet",
    name: fleetName,
    detail: "Balena application manifest",
    provenance: obs("balena.yml", "balena-config", `name: ${fleetName}`),
  });

  let machinePlaceholder = /%%BALENA_MACHINE_NAME%%/.test(content);
  let dockerfileMentionsMachine = false;
  const allDocker = walkScopedFiles(
    repoRoot,
    scope,
    "manifest",
    (_rel, name) => name.startsWith("Dockerfile") || name.endsWith(".Dockerfile"),
  );
  for (const file of allDocker) {
    const text = readFileSync(file.absPath, "utf-8");
    if (text.includes("%%BALENA_MACHINE_NAME%%") || /balenalib\//.test(text)) {
      dockerfileMentionsMachine = true;
    }
    if (/%%BALENA_MACHINE_NAME%%/.test(text)) machinePlaceholder = true;
  }

  result.devices.push({
    id: "device:balena-fleet",
    kind: "device",
    name: fleetName,
    detail: machinePlaceholder || dockerfileMentionsMachine
      ? "Balena machine target (architecture from BALENA_MACHINE_NAME placeholder)"
      : "Balena fleet application",
    provenance: obs("balena.yml", "balena-config", "Device-fleet deployment target"),
  });

  return result;
}

export function scanDevices(
  repoRoot: string,
  components: readonly ComponentInfo[],
  config?: DocforceConfig,
): { devices: DeviceInfo[]; relationships: Relationship[] } {
  const devices: DeviceInfo[] = [];
  const relationships: Relationship[] = [];
  const scope = resolveScanScope(config);
  const files = [
    ...walkSourceFiles(repoRoot, scope),
    ...walkScopedFiles(repoRoot, scope, "source", (_rel, name) => name.endsWith(".sh") || name.endsWith(".py")),
  ];
  const seen = new Set<string>();

  const push = (device: DeviceInfo): void => {
    if (seen.has(device.id)) {
      const existing = devices.find((d) => d.id === device.id);
      if (existing) {
        (existing as { provenance: Provenance }).provenance = {
          ...existing.provenance,
          evidence: [...existing.provenance.evidence, ...device.provenance.evidence],
        };
      }
      return;
    }
    seen.add(device.id);
    devices.push(device);
  };

  for (const file of files) {
    let content: string;
    try { content = readFileSync(file.absPath, "utf-8"); } catch { continue; }
    const rel = file.relPath;
    const comp = resolveComponentForFile(rel, components);

    if (/navigator\.serial\b|"serial" in navigator|navigator\["serial"\]/.test(content)) {
      push({
        id: "iface:serial",
        kind: "communication-interface",
        name: "serial",
        detail: "Web Serial API",
        provenance: obs(rel, "web-serial-api", "navigator.serial"),
      });
      if (comp) {
        addRel(relationships, {
          id: `rel:${comp.id}:communicates-over:iface:serial`,
          from: comp.id,
          to: "iface:serial",
          type: "communicates-over",
          classification: "observation",
          confidence: "high",
          evidence: [{ sourceFile: rel, evidenceType: "web-serial-api", detail: "navigator.serial" }],
          description: `${comp.id} communicates-over serial`,
        });
      }
    }

    if (/\/dev\/usb\/lp\d+/.test(content)) {
      push({
        id: "peripheral:usb-lp",
        kind: "peripheral",
        name: "USB printer",
        detail: "USB line-printer device path",
        provenance: obs(rel, "usb-device-path", "/dev/usb/lp*"),
      });
      if (comp) {
        addRel(relationships, {
          id: `rel:${comp.id}:attached-to:peripheral:usb-lp`,
          from: comp.id,
          to: "peripheral:usb-lp",
          type: "attached-to",
          classification: "observation",
          confidence: "high",
          evidence: [{ sourceFile: rel, evidenceType: "usb-device-path", detail: "/dev/usb/lp*" }],
          description: `${comp.id} attached-to USB printer`,
        });
      }
    }

    if (/getUserMedia\s*\(/.test(content)) {
      const video = /getUserMedia\s*\(\s*\{[^}]*video/.test(content) || /video:\s*true/.test(content);
      const audio = /getUserMedia\s*\(\s*\{[^}]*audio/.test(content) || /audio:\s*true/.test(content);
      if (video) {
        push({
          id: "peripheral:camera",
          kind: "peripheral",
          name: "camera",
          detail: "getUserMedia video",
          provenance: obs(rel, "media-device-api", "getUserMedia({ video })"),
        });
        if (comp) {
          addRel(relationships, {
            id: `rel:${comp.id}:attached-to:peripheral:camera`,
            from: comp.id,
            to: "peripheral:camera",
            type: "attached-to",
            classification: "observation",
            confidence: "high",
            evidence: [{ sourceFile: rel, evidenceType: "media-device-api", detail: "getUserMedia video" }],
            description: `${comp.id} attached-to camera`,
          });
        }
      }
      if (audio) {
        push({
          id: "peripheral:microphone",
          kind: "peripheral",
          name: "microphone",
          detail: "getUserMedia audio",
          provenance: obs(rel, "media-device-api", "getUserMedia({ audio })"),
        });
        if (comp) {
          addRel(relationships, {
            id: `rel:${comp.id}:attached-to:peripheral:microphone`,
            from: comp.id,
            to: "peripheral:microphone",
            type: "attached-to",
            classification: "observation",
            confidence: "high",
            evidence: [{ sourceFile: rel, evidenceType: "media-device-api", detail: "getUserMedia audio" }],
            description: `${comp.id} attached-to microphone`,
          });
        }
      }
    }

    if (/\balsa\b/i.test(content) && (rel.endsWith(".sh") || /asound|pcm\./i.test(content))) {
      push({
        id: "iface:alsa",
        kind: "communication-interface",
        name: "alsa",
        detail: "ALSA audio configuration",
        provenance: obs(rel, "alsa-configuration", "ALSA device configuration"),
      });
    }
  }

  return { devices, relationships };
}

export function linkComponentsToDevice(
  components: readonly ComponentInfo[],
  devices: readonly DeviceInfo[],
): Relationship[] {
  const device = devices.find((d) => d.kind === "device");
  if (!device) return [];
  const rels: Relationship[] = [];
  for (const comp of components) {
    addRel(rels, {
      id: `rel:${comp.id}:runs-on:${device.id}`,
      from: comp.id,
      to: device.id,
      type: "runs-on",
      classification: "observation",
      confidence: "medium",
      evidence: device.provenance.evidence,
      derivedFrom: [],
      description: `${comp.id} runs-on ${device.name}`,
    });
  }
  return rels;
}

function addRel(rels: Relationship[], rel: Relationship): void {
  if (rels.some((r) => r.id === rel.id)) return;
  rels.push(rel);
}

export { sanitizeId };
