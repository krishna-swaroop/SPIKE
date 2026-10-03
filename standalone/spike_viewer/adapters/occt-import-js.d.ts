// SPDX-License-Identifier: Apache-2.0
declare module "occt-import-js" {
  type OcctColor = [number, number, number];
  export type OcctImportResult = {
    success: boolean;
    root?: { name?: string; meshes?: number[]; children?: unknown[] };
    meshes?: Array<{
      name?: string;
      color?: OcctColor | null;
      brep_faces?: Array<{ first: number; last: number; color?: OcctColor | null }>;
      attributes?: {
        position?: { array?: number[] | ArrayLike<number> };
        normal?: { array?: number[] | ArrayLike<number> };
      };
      index?: { array?: number[] | ArrayLike<number> };
    }>;
  };
  export type OcctModule = {
    ReadStepFile(content: Uint8Array, params: unknown): OcctImportResult;
    ReadIgesFile(content: Uint8Array, params: unknown): OcctImportResult;
  };
  export default function createOcct(overrides?: { locateFile?: (path: string) => string }): Promise<OcctModule>;
}
