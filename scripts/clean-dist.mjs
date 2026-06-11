import fs from "node:fs";
import path from "node:path";

const outputDirectory = path.resolve("dist");
const workspaceDirectory = path.resolve(".");
const relativeOutput = path.relative(workspaceDirectory, outputDirectory);

if (
  !relativeOutput ||
  relativeOutput.startsWith("..") ||
  path.isAbsolute(relativeOutput)
) {
  throw new Error(`Refusing to clean output outside the workspace: ${outputDirectory}`);
}

fs.rmSync(outputDirectory, { recursive: true, force: true });
