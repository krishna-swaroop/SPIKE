// SPDX-License-Identifier: Apache-2.0
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules", "occt-import-js", "dist");
const destination = join(root, "public", "vendor", "occt-import-js");
await mkdir(destination, { recursive: true });
await Promise.all([
  copyFile(join(source, "occt-import-js.js"), join(destination, "occt-import-js.js")),
  copyFile(join(source, "occt-import-js.wasm"), join(destination, "occt-import-js.wasm")),
  copyFile(join(source, "license.occt-import-js.txt"), join(destination, "LICENSE.occt-import-js.txt")),
  copyFile(join(source, "license.occt.txt"), join(destination, "LICENSE.occt.txt")),
  copyFile(join(root, "licenses", "OCCT_RUNTIME_SOURCE.txt"), join(destination, "SOURCE_AND_RELINK.txt")),
  copyFile(join(root, "adapters", "occt-import-worker.js"), join(destination, "occt-import-worker.js")),
]);
console.log(`Copied the local OCCT browser runtime to ${destination}`);
