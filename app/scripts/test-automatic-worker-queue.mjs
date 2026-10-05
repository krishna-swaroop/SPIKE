// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { importTestTypescript } from "./import-test-typescript.mjs";

const { runSerializedAutomaticWorker } = await importTestTypescript("automaticWorkerQueue");
const connectorSource = readFileSync(new URL("../src/ConnectorGraphEditor.tsx", import.meta.url), "utf8");
const fieldSource = readFileSync(new URL("../src/AssemblyFieldStudyEditor.tsx", import.meta.url), "utf8");
assert.match(connectorSource, /runSerializedAutomaticWorker\(\(\) => runLocalWorker\(request\), isCurrent\)/,
  "automatic connector discovery uses the shared serial queue");
assert.match(fieldSource, /entry\.read = runSerializedAutomaticWorker\(async \(\) => \{/,
  "automatic field read and handoff preparation share one queued operation");
assert.match(fieldSource, /const loaded = await pending\.read;/, "effect replay awaits the shared manifest-bound operation");
const pending = [];
const calls = [];
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

const first = deferred();
const firstRun = runSerializedAutomaticWorker(async () => {
  calls.push("field-read:start");
  await first.promise;
  calls.push("field-read:end");
  return "field";
});
const secondRun = runSerializedAutomaticWorker(async () => {
  calls.push("connector-discovery:start");
  return "connectors";
});
pending.push(firstRun, secondRun);
await Promise.resolve();
assert.deepEqual(calls, ["field-read:start"], "simultaneous automatic heavy work starts one operation");
first.resolve();
assert.deepEqual(await Promise.all(pending), ["field", "connectors"]);
assert.deepEqual(calls, ["field-read:start", "field-read:end", "connector-discovery:start"], "the next operation starts only after the first settles");

let current = true;
const blocker = deferred();
const blockingRun = runSerializedAutomaticWorker(() => blocker.promise);
await Promise.resolve();
const staleRun = runSerializedAutomaticWorker(async () => { throw new Error("stale work dispatched"); }, () => current);
current = false;
blocker.resolve("done");
await blockingRun;
assert.equal(await staleRun, undefined, "stale queued work is skipped before dispatch");

const failed = runSerializedAutomaticWorker(async () => { throw new Error("expected"); });
await assert.rejects(failed, /expected/);
assert.equal(await runSerializedAutomaticWorker(async () => "recovered"), "recovered", "a failed operation does not poison the queue");
console.log("Automatic worker serialization, stale suppression and rejection recovery passed");
