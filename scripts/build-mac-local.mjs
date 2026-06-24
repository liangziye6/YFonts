import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import packageJson from "../package.json" with { type: "json" };

const root = process.cwd();
const productName = "YFonts";
const version = packageJson.version;
const universal = process.argv.includes("--universal");
const targetRoot = universal
  ? path.join("src-tauri", "target", "universal-apple-darwin", "release")
  : path.join("src-tauri", "target", "release");
const appPath = path.join(
  root,
  targetRoot,
  "bundle",
  "macos",
  `${productName}.app`
);
const dmgPath = path.join(
  root,
  targetRoot,
  "bundle",
  "dmg",
  `${productName}_${version}_${universal ? "universal" : "aarch64"}.dmg`
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    ...options
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
  }
}

if (process.platform !== "darwin") {
  throw new Error("desktop:build:mac:local must be run on macOS.");
}

run("npx", [
  "tauri",
  "build",
  ...(universal ? ["--target", "universal-apple-darwin"] : []),
  "--bundles",
  "app"
]);

run("codesign", [
  "--force",
  "--deep",
  "--sign",
  "-",
  "--options",
  "runtime",
  appPath
]);
run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);

const dmgRoot = await mkdtemp(path.join(os.tmpdir(), "yfonts-dmg-root-"));
try {
  await mkdir(path.dirname(dmgPath), { recursive: true });
  const stagedAppPath = path.join(dmgRoot, `${productName}.app`);
  run("ditto", [appPath, stagedAppPath]);
  await symlink("/Applications", path.join(dmgRoot, "Applications"));
  run("hdiutil", [
    "create",
    "-volname",
    productName,
    "-srcfolder",
    dmgRoot,
    "-ov",
    "-format",
    "UDZO",
    dmgPath
  ]);
  run("hdiutil", ["verify", dmgPath]);
} finally {
  await rm(dmgRoot, { recursive: true, force: true });
}

console.log(`Created local macOS app: ${appPath}`);
console.log(`Created local macOS DMG: ${dmgPath}`);
