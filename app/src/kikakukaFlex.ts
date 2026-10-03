// SPDX-License-Identifier: Apache-2.0

import type {
  ParsedBendLine, ParsedDrawing, ParsedFlexIssue, ParsedLayerDefinition, ParsedStackupLayer, Point,
} from "./boardParser";

type GraphicText = { id: string; text: string; at: Point; layer: string };
type ParameterKey = "a" | "r" | "s";

const ANNOTATION_TOLERANCE_MM = 0.1;
const LENGTH_FACTORS_MM: Record<string, number> = {
  "": 1, mm: 1, cm: 10, um: 0.001, "µm": 0.001, "μm": 0.001, in: 25.4, mil: 0.0254,
};

function issue(code: string, severity: ParsedFlexIssue["severity"], message: string): ParsedFlexIssue {
  return { code, severity, message };
}

function annotation(text: string): { values: Partial<Record<ParameterKey, number>>; mentioned: Set<string> } {
  const values: Partial<Record<ParameterKey, number>> = {};
  const aliases: Record<string, ParameterKey> = { a: "a", angle: "a", r: "r", radius: "r", s: "s", span: "s" };
  const pattern = /(?:^|[^A-Za-z0-9_])(angle|radius|span|[ars])\s*(?:=|:)?\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*(deg|mm|cm|um|µm|μm|in|mil)?(?![A-Za-z0-9_])/gi;
  for (const match of text.matchAll(pattern)) {
    const key = aliases[match[1].toLowerCase()];
    const unit = (match[3] ?? "").toLowerCase();
    let value = Number(match[2]);
    if (!Number.isFinite(value) || (key === "a" && unit && unit !== "deg") || (key !== "a" && unit === "deg")) continue;
    if (key !== "a") {
      value *= LENGTH_FACTORS_MM[unit] ?? 1;
      if (!Number.isFinite(value)) continue;
    }
    if (values[key] === undefined) values[key] = value;
  }
  const mentioned = new Set([...text.matchAll(/(?:^|[^A-Za-z0-9_])(angle|radius|span|[ars])(?=\s*(?:=|:|[+\-.\d]))/gi)].map(match => aliases[match[1].toLowerCase()]));
  return { values, mentioned };
}

export function parseKikakukaBends(
  layerDefinitions: ParsedLayerDefinition[], drawings: ParsedDrawing[], texts: GraphicText[], stackup: ParsedStackupLayer[],
): { bendLines: ParsedBendLine[]; flexIssues: ParsedFlexIssue[] } {
  const bendLines: ParsedBendLine[] = [];
  const flexIssues: ParsedFlexIssue[] = [];
  const boardThicknessMm = stackup.reduce((sum, layer) => sum + (Number.isFinite(layer.thickness) && (layer.thickness ?? 0) > 0 ? layer.thickness! : 0), 0);
  const boardThicknessIsFinite = Number.isFinite(boardThicknessMm) && boardThicknessMm > 0;
  layerDefinitions.filter(definition => definition.userName?.trim().toLowerCase() === "freekicad").forEach(definition => {
    const lines = drawings.filter(drawing => drawing.layer === definition.name && drawing.type === "line" && drawing.points.length >= 2);
    const layerTexts = texts.filter(text => text.layer === definition.name);
    const assignments = new Map<number, { distance: number; textIndex: number; text: GraphicText; ambiguous: boolean }[]>();
    lines.forEach((_line, index) => assignments.set(index, []));
    layerTexts.forEach((text, textIndex) => {
      const candidates = lines.map((line, lineIndex) => {
        const start = line.points[0];
        const end = line.points[line.points.length - 1];
        const startDistance = Math.hypot(text.at[0] - start[0], text.at[1] - start[1]);
        const endDistance = Math.hypot(text.at[0] - end[0], text.at[1] - end[1]);
        return { lineIndex, distance: Math.min(startDistance, endDistance) };
      }).filter(candidate => candidate.distance <= ANNOTATION_TOLERANCE_MM + 1e-12)
        .sort((left, right) => left.distance - right.distance || left.lineIndex - right.lineIndex);
      if (!candidates.length) {
        flexIssues.push(issue("KIKAKUKA_ANNOTATION_ORPHAN", "warning", `FreekiCAD annotation ${JSON.stringify(text.text)} is not within 0.1 mm of a bend-line endpoint.`));
        return;
      }
      const selected = candidates[0];
      assignments.get(selected.lineIndex)!.push({ distance: selected.distance, textIndex, text, ambiguous: candidates.length > 1 && Math.abs(candidates[1].distance - selected.distance) <= 1e-12 });
    });
    lines.forEach((line, lineIndex) => {
      const matches = assignments.get(lineIndex)!.sort((left, right) => left.distance - right.distance || left.textIndex - right.textIndex);
      const selected = matches[0]?.text;
      const parsed = annotation(selected?.text ?? "");
      const issues: ParsedFlexIssue[] = [];
      if (!selected) issues.push(issue("KIKAKUKA_BEND_ANNOTATION_MISSING", "info", "FreekiCAD bend line has no annotation within 0.1 mm; the line remains editable with unset bend parameters."));
      if (matches.length > 1) issues.push(issue("KIKAKUKA_BEND_ANNOTATION_CONFLICT", "warning", "Multiple FreekiCAD annotations match this bend line; the nearest annotation in source order was used."));
      if (matches[0]?.ambiguous) issues.push(issue("KIKAKUKA_BEND_ASSOCIATION_AMBIGUOUS", "warning", "The FreekiCAD annotation is equally close to multiple bend lines; the first line in source order was used."));
      [...parsed.mentioned].filter(key => parsed.values[key as ParameterKey] === undefined).sort().forEach(key => issues.push(issue("KIKAKUKA_BEND_ANNOTATION_MALFORMED", "warning", `FreekiCAD annotation contains an invalid ${key} value; that parameter remains unset.`)));
      if (parsed.values.r !== undefined && parsed.values.s !== undefined) issues.push(issue("KIKAKUKA_BEND_RADIUS_PRECEDENCE", "info", "Both r and s are present; the explicit radius r takes precedence."));
      let radiusMm = parsed.values.r;
      let radiusSource: ParsedBendLine["radiusSource"] = radiusMm === undefined ? undefined : "r";
      if (radiusMm === undefined && parsed.values.s !== undefined) {
        if (parsed.values.a === undefined || Math.abs(parsed.values.a) <= 1e-12) issues.push(issue("KIKAKUKA_BEND_SPAN_NEEDS_ANGLE", "warning", "Bend span s cannot derive a radius without a non-zero angle a."));
        else if (!boardThicknessIsFinite) issues.push(issue("KIKAKUKA_BEND_SPAN_NEEDS_THICKNESS", "warning", "Bend span s is retained, but radius derivation requires a finite, positive explicit board stackup thickness."));
        else {
          const angleRadians = Math.abs(parsed.values.a * Math.PI / 180);
          const derivedRadius = angleRadians > 0 && Number.isFinite(angleRadians) ? parsed.values.s / angleRadians - boardThicknessMm / 2 : Number.POSITIVE_INFINITY;
          if (Number.isFinite(derivedRadius)) {
            radiusMm = derivedRadius;
            radiusSource = "s";
          } else issues.push(issue("KIKAKUKA_BEND_RADIUS_NONFINITE", "warning", "Bend span and angle would derive a non-finite radius; span is retained and radius remains unset."));
        }
      }
      if (radiusMm !== undefined && radiusMm < 0) issues.push(issue("KIKAKUKA_BEND_RADIUS_NEGATIVE", "warning", "Bend radius is negative; the raw value is retained but is not usable as bend geometry. Zero radius is valid."));
      bendLines.push({
        id: `bend:${line.id}`, name: `FreekiCAD bend ${lineIndex + 1}`, points: line.points, sourceLayer: definition.name,
        sourceLayerUserName: definition.userName, sourceDrawingId: line.id, source: "kikakuka-freekicad", format: "kikakuka/freekicad-v1",
        annotation: selected?.text, annotationPosition: selected?.at, configured: Boolean(selected && Object.keys(parsed.values).length),
        radiusMm, radiusSource, angleDeg: parsed.values.a, spanMm: parsed.values.s, issues,
      });
      flexIssues.push(...issues);
    });
  });
  return { bendLines, flexIssues };
}
