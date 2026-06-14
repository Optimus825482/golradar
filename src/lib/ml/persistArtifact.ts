// ── ML Artifact Persistence (server-only) ─────────────────────────
// Splits fs writes out of the modules that get pulled into client
// bundles. The dynamic imports of node:fs/promises and node:path
// stay isolated here so Turbopack's static trace never reaches
// them from a client import graph.
//
// Called from admin/ml/* route handlers and the training scheduler
// only. Do not import from a component that ships to the browser.

export async function writeModelArtifact(
  artifactName: string,
  modelVersion: string,
  serialized: string,
): Promise<string> {
  // Lazy + namespaced to keep the bundler from tracing into
  // node: builtins at build time. turbopackIgnore is honored by
  // Next 16+ Turbopack.
  const { writeFile, mkdir } = await import(/* turbopackIgnore: true */ 'node:fs/promises');
  const { join } = await import(/* turbopackIgnore: true */ 'node:path');
  const dir = join(process.cwd(), 'data', 'ml-models');
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${artifactName}-v${modelVersion}.json`);
  await writeFile(filePath, serialized, 'utf-8');
  return filePath;
}
