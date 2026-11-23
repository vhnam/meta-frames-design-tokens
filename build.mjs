// Entry point for the design token generator. The runner is build.ts (Node type stripping).
// A Node without type stripping cannot load .ts files: report that instead of a stack trace.
try {
  await import("./build.ts");
} catch (error) {
  if (error?.code !== "ERR_UNKNOWN_FILE_EXTENSION") throw error;
  console.error("error: meta-frames-design-tokens/.node-version: this Node cannot run TypeScript (.ts files). Use the Node version that file names.");
  process.exit(1);
}
