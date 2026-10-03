// SPDX-License-Identifier: Apache-2.0
import type { ParsedBoard } from "./boardParser";
import type { VirtualBoardVisual } from "./harnessVisualization";

export type AssemblySceneInput = { visual: VirtualBoardVisual; source?: ParsedBoard };
/** Count every displayed occurrence, including repeated instances of a design. */
export function boardSceneComplexity(primary: ParsedBoard | null, inputs: readonly AssemblySceneInput[]): number {
  const features = (board?: ParsedBoard | null) => board
    ? board.tracks.length + board.vias.length + board.pads.length + board.zones.length + board.components.length : 0;
  // In an assembly the primary scene is replaced by its occurrence scene.
  return (inputs.length > 1 ? 0 : features(primary))
    + inputs.reduce((total, input) => total + features(input.source), 0);
}
const sameNames = (a: Record<string, string> = {}, b: Record<string, string> = {}) => a === b
  || Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => a[key] === b[key]);
const sameGeometry = (a: VirtualBoardVisual, b: VirtualBoardVisual) => a.id === b.id && a.designId === b.designId
  && a.widthMm === b.widthMm && a.heightMm === b.heightMm && a.thicknessMm === b.thicknessMm
  && a.localCenterMm.every((value, i) => value === b.localCenterMm[i]) && sameNames(a.netIdsByName, b.netIdsByName);

/** Placement, board names and selection never invalidate GPU geometry/model loads.
 * Current transforms are applied separately; source replacement and net identity
 * changes still rebuild the affected scene input.
 */
export function retainAssemblySceneInputs(previous: readonly AssemblySceneInput[], boards: readonly VirtualBoardVisual[], sources: Record<string, ParsedBoard>): readonly AssemblySceneInput[] {
  const inputs = boards.filter(board => boards.length > 1 || !board.active);
  if (inputs.length === previous.length && inputs.every((board, i) => previous[i].source === sources[board.designId] && sameGeometry(previous[i].visual, board))) return previous;
  return inputs.map(visual => ({ visual, source: sources[visual.designId] }));
}
