# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 SigHarmonic
"""Original retained-volume admission and occurrence-to-world SI lowering."""
import itertools
import math
import numpy as np

from .assembly_frames import IDENTITY, resolve_world, validate_rigid_transform
from .multiboard_identity import canonical_json_digest
from .tetra_mesh_refinement import _validate

MAX_CELLS = 100000
MAX_VERTICES = 100000


def identity(*values):
    return canonical_json_digest(list(values))


def keys(value, required, optional=()):
    if not isinstance(value, dict) or not set(required) <= set(value) or set(value)-set(required)-set(optional):
        raise ValueError('ASSEMBLY_FIELD_FIELDS: unexpected or missing fields')


def number(value, *, positive=False):
    if type(value) not in (int, float):
        raise ValueError('ASSEMBLY_FIELD_NUMBER: expected finite number, not bool/text')
    try:
        result = float(value)
    except OverflowError as exc:
        raise ValueError('ASSEMBLY_FIELD_NUMBER: unrepresentable number') from exc
    if not math.isfinite(result) or positive and result <= 0:
        raise ValueError('ASSEMBLY_FIELD_NUMBER: invalid finite positive property')
    return result


def thermal_tensor(value):
    if type(value) in (int, float):
        return np.eye(3)*number(value, positive=True)
    if not isinstance(value, list) or len(value) != 3 or any(not isinstance(row, list) or len(row) != 3 for row in value):
        raise ValueError('ASSEMBLY_FIELD_MATERIAL: expected scalar or SPD 3x3 thermal tensor')
    tensor = np.array([[number(item) for item in row] for row in value])
    eigenvalues = np.linalg.eigvalsh(tensor)
    if (not np.array_equal(tensor, tensor.T) or not np.isfinite(eigenvalues).all() or
        eigenvalues[0] <= 0 or eigenvalues[-1]/eigenvalues[0] > 1e12):
        raise ValueError('ASSEMBLY_FIELD_MATERIAL: thermal tensor must be symmetric positive definite')
    return tensor


def validate_frames(assembly):
    if assembly.frame.units != 'mm' or assembly.frame.handedness != 'right' or tuple(assembly.frame.transform) != IDENTITY or assembly.frame.parent_frame_id:
        raise ValueError('ASSEMBLY_FIELD_ROOT: require an identity millimetre assembly root')
    for occurrence in [*assembly.boards, *assembly.parts]:
        frame = occurrence.frame
        if frame.units != 'mm' or frame.handedness != 'right':
            raise ValueError('ASSEMBLY_FIELD_FRAME: require right-handed millimetre placements')
        for item in frame.transform:
            number(item)
        validate_rigid_transform(frame.transform, 'Field occurrence '+occurrence.id)
        rotation = np.array(frame.transform).reshape(4,4)[:3,:3]
        if np.max(np.abs(rotation@rotation.T-np.eye(3))) > 1e-12:
            raise ValueError('ASSEMBLY_FIELD_FRAME: rotation accuracy exceeds field handoff tolerance')


def lower_body(assembly, occurrence, body, material_ids):
    """Check both local and represented world geometry; retain separate nodes."""
    mesh, boundary = body['mesh'], body['boundary_faces']
    if not isinstance(boundary, list) or len(boundary) > 4*MAX_CELLS:
        raise ValueError('ASSEMBLY_FIELD_BOUNDARY: bounded complete exterior faces required')
    face_ids = set()
    for face in boundary:
        keys(face, ('id', 'vertices'))
        if not isinstance(face['id'], str) or not face['id'] or face['id'] in face_ids:
            raise ValueError('ASSEMBLY_FIELD_BOUNDARY: duplicate or invalid face identity')
        face_ids.add(face['id'])
    labels = [{'vertices': face['vertices'], 'label': face['id']} for face in boundary]
    _validate(mesh, labels, MAX_CELLS, MAX_VERTICES)
    used_sources = {source for cell in mesh['cells'] for source in cell['source_object_ids']}
    if used_sources != set(mesh['object_map']):
        raise ValueError('ASSEMBLY_FIELD_SOURCE: every declared mesh object must own cells')
    local_materials = {cell['material_id'] for cell in mesh['cells']}
    if not isinstance(body['material_map'], dict) or len(body['material_map']) > 1024 or set(body['material_map']) != local_materials:
        raise ValueError('ASSEMBLY_FIELD_MATERIAL: exact local material coverage required')
    if not set(body['material_map'].values()) <= material_ids:
        raise ValueError('ASSEMBLY_FIELD_MATERIAL: unknown physical material')
    scale = .001 if mesh['units'] == 'mm' else 1.
    matrix = np.array(resolve_world(assembly, occurrence.frame)).reshape(4,4)
    points = np.array(mesh['vertices'], dtype=float)*scale
    world = points@matrix[:3,:3].T + matrix[:3,3]*.001
    if not np.all(np.isfinite(world)) or np.max(np.abs(world)) > 1e6:
        raise ValueError('ASSEMBLY_FIELD_FRAME: world coordinates exceed representable SI budget')
    transformed = {**mesh, 'units': 'm', 'vertices': world.tolist()}
    _validate(transformed, labels, MAX_CELLS, MAX_VERTICES)
    volumes = []
    try:
        for cell in mesh['cells']:
            p, q = points[cell['vertices']], world[cell['vertices']]
            local_j, world_j = (p[1:]-p[0]).T, (q[1:]-q[0]).T
            expected_j = matrix[:3,:3]@local_j
            expected_inv = np.linalg.inv(local_j)@matrix[:3,:3].T
            actual_inv = np.linalg.inv(world_j)
            ratio = np.linalg.det(world_j)/np.linalg.det(local_j)
            errors = (abs(ratio-1), np.linalg.norm(world_j-expected_j)/np.linalg.norm(expected_j),
                      np.linalg.norm(actual_inv-expected_inv)/np.linalg.norm(expected_inv))
            if not all(math.isfinite(error) and error <= 1e-9 for error in errors):
                raise ValueError('ASSEMBLY_FIELD_FRAME: placement lost per-cell Jacobian accuracy')
            volumes.append(float(np.linalg.det(world_j)/6))
    except np.linalg.LinAlgError as exc:
        raise ValueError('ASSEMBLY_FIELD_FRAME: unrepresentable transformed cell Jacobian') from exc
    final_volume = math.fsum(volumes)
    return transformed, matrix, final_volume


def assert_disjoint_occurrences(mesh, cell_owners, max_comparisons=250000):
    """Independent convex-tetra SAT; no automatic welding/contact assumption.

    A bounded sweep excludes disjoint x intervals, then exact box separations.
    SAT uses face normals and cross-edge axes. Near-zero overlaps use a reported
    relative floating tolerance; this is not an exact CAD intersection proof.
    """
    points = np.array(mesh['vertices'])
    tets = [points[cell['vertices']] for cell in mesh['cells']]
    bounds = [(tet.min(axis=0), tet.max(axis=0)) for tet in tets]
    order = sorted(range(len(tets)), key=lambda index: bounds[index][0][0])
    comparisons = 0
    for offset, a in enumerate(order):
        for next_offset in range(offset+1, len(order)):
            b = order[next_offset]
            if bounds[b][0][0] >= bounds[a][1][0]:
                break
            comparisons += 1
            if comparisons > max_comparisons:
                raise ValueError('ASSEMBLY_FIELD_WORK: intersection comparison budget exceeded')
            if cell_owners[a] == cell_owners[b] or np.any(np.maximum(bounds[a][0],bounds[b][0]) >= np.minimum(bounds[a][1],bounds[b][1])):
                continue
            scale = max(np.ptp(np.vstack((tets[a],tets[b])), axis=0))
            p, q = (tets[a]-tets[a][0])/scale, (tets[b]-tets[a][0])/scale
            edges = lambda t: [t[j]-t[i] for i,j in itertools.combinations(range(4),2)]
            axes = [np.cross(t[j]-t[i],t[k]-t[i]) for t in (p,q) for i,j,k in itertools.combinations(range(4),3)]
            axes.extend(np.cross(e,f) for e in edges(p) for f in edges(q))
            separated = False
            for axis in axes:
                length = np.linalg.norm(axis)
                if length == 0:
                    continue
                u, v = p@(axis/length), q@(axis/length)
                if min(max(u),max(v))-max(min(u),min(v)) <= 1e-12:
                    separated = True
                    break
            if not separated:
                raise ValueError('ASSEMBLY_FIELD_OVERLAP: occurrence volumes intersect; supply repaired nonoverlapping geometry')
    return {'inter_occurrence_comparisons': comparisons, 'relative_sat_tolerance': 1e-12,
            'within_occurrence_global_intersection_check': False}
