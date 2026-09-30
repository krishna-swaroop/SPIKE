# SPDX-License-Identifier: Apache-2.0
"""Numerical STEP surface meshing with explicit units and rigid placement.

Independently authored using Gmsh's public OCC/mesh API documentation:
https://gmsh.info/doc/texinfo/ . This is not the MCAD visual tessellation path.
"""
from __future__ import annotations

import hashlib
import math
from pathlib import Path

import numpy as np

MAX_TRIANGLES = 40_000
MAX_SOURCE_BYTES = 64 * 1024**2


def rigid_matrix(translation_mm, rotation_deg) -> np.ndarray:
    """Active right-handed intrinsic XYZ rotation: world = Rz Ry Rx local+t."""
    vectors = []
    for raw in (translation_mm, rotation_deg):
        if not isinstance(raw, (list, tuple)) or len(raw) != 3 or any(
                isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in raw):
            raise ValueError("Placement needs three finite numeric values per vector.")
        vectors.append(np.asarray(raw, dtype=float))
    if np.max(np.abs(vectors[0])) > 1e6 or np.max(np.abs(vectors[1])) > 360:
        raise ValueError("Placement exceeds bounded translation or rotation limits.")
    x, y, z = np.radians(vectors[1])
    rx = np.array([[1, 0, 0], [0, np.cos(x), -np.sin(x)], [0, np.sin(x), np.cos(x)]])
    ry = np.array([[np.cos(y), 0, np.sin(y)], [0, 1, 0], [-np.sin(y), 0, np.cos(y)]])
    rz = np.array([[np.cos(z), -np.sin(z), 0], [np.sin(z), np.cos(z), 0], [0, 0, 1]])
    matrix = np.eye(4)
    matrix[:3, :3] = rz @ ry @ rx
    matrix[:3, 3] = vectors[0]
    return matrix


def mesh_step(path, *, mesh_size_mm, translation_mm=(0, 0, 0), rotation_deg=(0, 0, 0),
              expected_sha256=None) -> dict:
    """Admit a closed-solid STEP and generate outward linear triangles in mm."""
    source = Path(path).resolve()
    if source.suffix.lower() not in {".step", ".stp"} or not source.is_file():
        raise ValueError("Select an existing STEP/STP structure.")
    if not 0 < source.stat().st_size <= MAX_SOURCE_BYTES:
        raise ValueError("STEP source must be nonempty and at most 64 MiB.")
    payload = source.read_bytes()
    if b"ISO-10303-21" not in payload[:4096].upper():
        raise ValueError("Structure requires a STEP exchange header.")
    digest = hashlib.sha256(payload).hexdigest()
    if expected_sha256 is not None and digest != expected_sha256:
        raise ValueError("STEP source changed after preparation.")
    if isinstance(mesh_size_mm, bool) or not isinstance(mesh_size_mm, (int, float)) or not math.isfinite(mesh_size_mm) or not .01 <= mesh_size_mm <= 1000:
        raise ValueError("Surface mesh size must be 0.01..1000 mm.")
    matrix = rigid_matrix(translation_mm, rotation_deg)
    import gmsh
    if gmsh.isInitialized():
        raise ValueError("STEP meshing requires its own isolated Gmsh process state.")
    gmsh.initialize()
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        gmsh.option.setString("Geometry.OCCTargetUnit", "MM")
        gmsh.model.add("SPIKE_optycal_structure")
        gmsh.model.occ.importShapes(str(source), highestDimOnly=True)
        gmsh.model.occ.synchronize()
        solids = gmsh.model.getEntities(3)
        if not 1 <= len(solids) <= 32:
            raise ValueError("PO structure requires 1..32 closed solids; sheet-only STEP needs an explicit side model.")
        oriented_faces = {}
        reference_volume = 0.
        for solid in solids:
            reference_volume += gmsh.model.occ.getMass(*solid)
            for dim, tag in gmsh.model.getBoundary([solid], combined=False, oriented=True, recursive=False):
                if dim != 2 or abs(tag) in oriented_faces:
                    raise ValueError("Shared/internal faces require an externally fused structure.")
                oriented_faces[abs(tag)] = 1 if tag > 0 else -1
        if len(oriented_faces) > 4096:
            raise ValueError("STEP surface count exceeds 4096.")
        bbox = gmsh.model.getBoundingBox(-1, -1)
        extents = np.asarray(bbox[3:]) - bbox[:3]
        if not np.isfinite(extents).all() or extents.max() > 1e5 or extents.min() <= 1e-8:
            raise ValueError("STEP extent exceeds bounds or has no solid thickness.")
        # Fail before generating a grossly oversized surface mesh.
        area = sum(gmsh.model.occ.getMass(2, tag) for tag in oriented_faces)
        if area / mesh_size_mm**2 > MAX_TRIANGLES / 3:
            raise ValueError("Requested mesh exceeds the surface preflight budget; increase mesh size.")
        gmsh.option.setNumber("Mesh.ElementOrder", 1)
        gmsh.option.setNumber("Mesh.MeshSizeMin", mesh_size_mm)
        gmsh.option.setNumber("Mesh.MeshSizeMax", mesh_size_mm)
        gmsh.model.mesh.generate(2)
        tags, coordinates, _ = gmsh.model.mesh.getNodes()
        vertices = np.asarray(coordinates).reshape(-1, 3)
        index = {int(tag): i for i, tag in enumerate(tags)}
        triangles = []
        for face, sign in oriented_faces.items():
            types, _, node_lists = gmsh.model.mesh.getElements(2, face)
            for kind, nodes in zip(types, node_lists):
                if kind != 2:
                    raise ValueError("Only first-order triangle surfaces are supported.")
                for nodes3 in np.asarray(nodes).reshape(-1, 3):
                    tri = [index[int(node)] for node in nodes3]
                    # Gmsh's surface element order already follows the solid's
                    # outward orientation. Signed CAD boundary tags describe
                    # underlying face orientation and must not flip it again.
                    triangles.append(tri)
                    if len(triangles) > MAX_TRIANGLES:
                        raise ValueError("Surface mesh exceeds 40000 triangles.")
        faces = np.asarray(triangles, dtype=int)
        if len(faces) == 0 or not np.isfinite(vertices).all():
            raise ValueError("STEP produced no finite surface mesh.")
        edges = {}
        for a, b, c in faces:
            for first, second in ((a, b), (b, c), (c, a)):
                key = (min(first, second), max(first, second))
                count, direction = edges.get(key, (0, 0))
                edges[key] = (count + 1, direction + (1 if first < second else -1))
        if any(count != 2 or direction != 0 for count, direction in edges.values()):
            raise ValueError("Structure surface must be a consistently oriented closed manifold.")
        # A closed oriented shell must reproduce OCC volume. Use a nearby origin
        # to avoid catastrophic cancellation for globally translated assemblies.
        v = vertices[faces] - vertices.mean(axis=0)
        volume = float(np.einsum("ij,ij->i", v[:, 0], np.cross(v[:, 1], v[:, 2])).sum() / 6)
        if volume <= 0 or not np.isclose(volume, reference_volume, rtol=.02, atol=1e-6):
            raise ValueError("Surface orientation/closure does not reproduce the STEP solid volume within 2%; refine or repair CAD.")
        placed = vertices @ matrix[:3, :3].T + matrix[:3, 3]
        if hashlib.sha256(source.read_bytes()).hexdigest() != digest:
            raise ValueError("STEP source changed during numerical meshing.")
        return {"contract": "spike/optycal-structure-mesh/v1", "vertices_mm": placed.tolist(),
                "triangles": faces.tolist(), "source_sha256": digest, "mesh_size_mm": mesh_size_mm,
                "bounds_mm": [*placed.min(axis=0).tolist(), *placed.max(axis=0).tolist()],
                "surface_count": len(oriented_faces), "solid_count": len(solids),
                "world_from_local_mm": matrix.tolist(), "surface_volume_mm3": volume,
                "cad_volume_mm3": reference_volume, "geometry_status": "numerically_tessellated_closed_pec_surface"}
    finally:
        gmsh.finalize()
