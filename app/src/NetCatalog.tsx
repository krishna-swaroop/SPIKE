// SPDX-License-Identifier: Apache-2.0
import type { ReactNode } from "react";
import { CircleDot } from "./icons";
import DataTable from "./DataTable";

export type NetCatalogMetrics = { layers: number | null; tracks: number | null; vias: number | null; pads: number | null; zones: number | null; parts: number | null };
export type NetCatalogRow = { id: string; name: string; metrics: NetCatalogMetrics };

/** Shared catalog presentation; identity and analysis actions belong to its caller. */
export default function NetCatalog({ rows, activeId, onSelect, onPreview, role }: {
  rows: NetCatalogRow[]; activeId: string; onSelect: (id: string) => void;
  onPreview?: (id: string | null) => void; role?: (id: string) => ReactNode;
}) {
  return <div className="net-catalog"><DataTable label="Imported net catalog" searchable={false} pageSize={100} emptyMessage="No imported net matches this filter." className="net-table">
    <thead><tr><th>Net</th>{role && <th>Role</th>}<th>Layers</th><th>Tracks</th><th>Vias</th><th>Pads</th><th>Zones</th><th>Parts</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.id} className={activeId === row.id ? "active" : ""} onClick={() => onSelect(row.id)} onMouseEnter={() => onPreview?.(row.id)} onMouseLeave={() => onPreview?.(null)}>
      <td><button type="button" className="net-name" aria-label={`Select net ${row.name}`} onClick={event => { event.stopPropagation(); onSelect(row.id); }}><CircleDot size={13}/><b title={row.name}>{row.name}</b></button></td>
      {role && <td>{role(row.id)}</td>}
      {(["layers", "tracks", "vias", "pads", "zones", "parts"] as const).map(key => <td key={key} title={row.metrics[key] === null ? "Geometry inventory unavailable" : undefined}>{row.metrics[key] ?? "—"}</td>)}
    </tr>)}</tbody>
  </DataTable></div>;
}
