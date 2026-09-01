export function serviceDisplayLabel(
  serviceName: string,
  softwareNames: ReadonlySet<string>,
): string {
  if (softwareNames.has(serviceName)) return `${serviceName} service`;
  return serviceName;
}
