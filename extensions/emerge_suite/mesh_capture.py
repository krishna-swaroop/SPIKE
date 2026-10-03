# SPDX-License-Identifier: Apache-2.0
"""Export bounded EMerge public Mesh3D arrays without running a field solve."""
from __future__ import annotations

MAX_MESH_NODES = 100_000
MAX_MESH_TETRAHEDRA = 200_000
MAX_MESH_TRIANGLES = 200_000


def capture_mesh(mesh):
    """Convert component-major SI runtime arrays to row-major mm topology.

    Connectivity indexes the returned node array, not Gmsh entity/node tags.
    Mesh triangles include internal tetrahedral faces. CAD face groups retain
    explicit engine entity tags without inventing copper net attribution.
    """
    import numpy as np
    for name in ("nodes", "tets", "tris", "vtag_to_tet", "ftag_to_tri"):
        if not hasattr(mesh, name):
            raise ValueError(f"EMerge mesh export requires the public Mesh3D.{name} API.")
    nodes = np.asarray(mesh.nodes)
    if nodes.ndim != 2 or nodes.shape[0] != 3 or not 4 <= nodes.shape[1] <= MAX_MESH_NODES or not np.issubdtype(nodes.dtype, np.floating) or not np.all(np.isfinite(nodes)):
        raise ValueError("EMerge mesh nodes must be a finite component-major 3-by-N array within bounds.")
    nodes_mm = nodes.T*1000.
    topology = {}
    for name, width, limit in (("tets", 4, MAX_MESH_TETRAHEDRA), ("tris", 3, MAX_MESH_TRIANGLES)):
        raw = np.asarray(getattr(mesh, name))
        if (raw.ndim != 2 or raw.shape[0] != width or not 1 <= raw.shape[1] <= limit or
                not np.issubdtype(raw.dtype, np.integer) or np.any(raw < 0) or np.any(raw >= len(nodes_mm))):
            raise ValueError(f"EMerge {name} connectivity is malformed, out of bounds or over budget.")
        rows = raw.T
        if np.any(np.diff(np.sort(rows, axis=1), axis=1) == 0):
            raise ValueError(f"EMerge {name} cells contain repeated node indices.")
        if len(np.unique(np.sort(rows, axis=1), axis=0)) != len(rows):
            raise ValueError(f"EMerge {name} connectivity contains duplicate cells.")
        topology[name] = rows
    tets = nodes_mm[topology["tets"]]
    volume6 = np.einsum("ij,ij->i", tets[:, 1]-tets[:, 0], np.cross(tets[:, 2]-tets[:, 0], tets[:, 3]-tets[:, 0]))
    span = np.max(np.linalg.norm(tets[:, 1:]-tets[:, :1], axis=2), axis=1)
    if not np.all(np.isfinite(volume6)) or np.any(abs(volume6) <= np.maximum(1e-18, span**3*1e-12)):
        raise ValueError("EMerge mesh contains degenerate or numerically unresolved tetrahedra.")

    def groups(name, count):
        mapping = getattr(mesh, name)
        if not isinstance(mapping, dict) or len(mapping) > 8192:
            raise ValueError("EMerge geometry entity groups exceed their supported mapping bound.")
        output, group_count = [], 0
        for tag, indices in sorted(mapping.items()):
            values = np.asarray(indices)
            if (isinstance(tag, bool) or not isinstance(tag, (int, np.integer)) or int(tag) < 1 or
                    values.ndim != 1 or not np.issubdtype(values.dtype, np.integer) or
                    np.any(values < 0) or np.any(values >= count) or len(np.unique(values)) != len(values)):
                raise ValueError("EMerge geometry entity group indices are malformed.")
            group_count += len(values)
            if group_count > count*2:
                raise ValueError("EMerge geometry groups exceed the cell index budget.")
            output.append({"entity_tag": int(tag), "indices": values.astype(int).tolist()})
        return output

    return {"contract": "spike/emerge-mesh/v1", "status": "completed", "model_status": "unvalidated",
            "solved": False, "units": "mm", "coordinate_frame": "design_top_copper",
            "nodes_mm": nodes_mm.tolist(), "tetrahedra": topology["tets"].astype(int).tolist(),
            "triangles": topology["tris"].astype(int).tolist(),
            "volume_groups": groups("vtag_to_tet", len(topology["tets"])),
            "surface_groups": groups("ftag_to_tri", len(topology["tris"])),
            "bounds_mm": [*nodes_mm.min(axis=0).tolist(), *nodes_mm.max(axis=0).tolist()],
            "node_count": len(nodes_mm), "tetrahedron_count": len(topology["tets"]), "triangle_count": len(topology["tris"]),
            "topology_order": "zero-based connectivity into nodes_mm; original EMerge tetrahedron ordering",
            "triangle_scope": "all Mesh3D triangular faces, including internal volume faces",
            "quality": {"minimum_absolute_volume_mm3": float(np.min(abs(volume6))/6),
                        "maximum_absolute_volume_mm3": float(np.max(abs(volume6))/6),
                        "negative_signed_tetrahedra": int(np.count_nonzero(volume6 < 0)),
                        "qualification": "finite nondegenerate topology check only; no physics, convergence or element quality validation"}}
