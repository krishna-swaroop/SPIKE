// SPDX-License-Identifier: Apache-2.0
/* global importScripts, occtimportjs */
importScripts("./occt-import-js.js");

self.onmessage = async event => {
  try {
    const occt = await occtimportjs({
      locateFile: path => new URL(path, self.location.href).href,
    });
    const bytes = new Uint8Array(event.data.buffer);
    const params = { linearUnit: "millimeter" };
    const result = event.data.format === "step"
      ? occt.ReadStepFile(bytes, params)
      : occt.ReadIgesFile(bytes, params);
    self.postMessage({ ok: true, result });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
