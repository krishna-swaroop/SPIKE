// SPDX-License-Identifier: Apache-2.0
import { ASSEMBLY_LIMITS, validateAssemblyDocument } from "../src/assembly/validation";
import type { AssemblyDocument } from "../src/assembly/types";

export function parseAssemblyProject(text:string):AssemblyDocument {
  if(new TextEncoder().encode(text).length>ASSEMBLY_LIMITS.jsonBytes) throw new Error("Assembly JSON exceeds 64 MiB.");
  return validateAssemblyDocument(JSON.parse(text));
}
export function serializeAssemblyProject(document:AssemblyDocument):string {
  validateAssemblyDocument(document);
  const result=JSON.stringify(document);
  if(new TextEncoder().encode(result).length>ASSEMBLY_LIMITS.jsonBytes) throw new Error("Assembly JSON exceeds 64 MiB.");
  return result;
}
