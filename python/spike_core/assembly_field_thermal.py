# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 SigHarmonic
"""Bind retained occurrence faces/cells to the experimental 3D thermal kernel."""
import copy
import math
import numpy as np

from .assembly_field_geometry import identity, keys, number
from .assembly_field_handoff import bounded_json, prepare_assembly_field_handoff, text
from .assembly_tetra_thermal import run_assembly_tetra_thermal
from .multiboard_identity import canonical_json_digest
from .spider_v2 import AssemblyIRV1


def run_assembly_field_thermal(request, problem):
    """All unspecified exterior faces are explicitly reported as adiabatic.

    Contacts require caller-bound matching triangles. Assemblies with thermal
    contacts not completely represented, or other unresolved connectivity,
    fail rather than silently running a disconnected subset.
    """
    bounded_json(problem)
    keys(problem, ('contract', 'boundaries', 'heat_sources', 'contacts'))
    if problem['contract'] != 'spike/assembly-field-thermal-problem/v1' or request.get('domain') != 'thermal':
        raise ValueError('ASSEMBLY_FIELD_THERMAL_CONTRACT: thermal handoff/problem required')
    handoff = prepare_assembly_field_handoff(request)
    if handoff['execution_issues']:
        raise ValueError('ASSEMBLY_FIELD_CONNECTIVITY_UNSUPPORTED: assembly has unrepresented coupled links')
    faces = {(f['occurrence_id'], f['local_face_id']): f for f in handoff['boundary_faces']}
    traces = {t['occurrence_id']: t for t in handoff['source_traceability']}

    def face(endpoint):
        keys(endpoint, ('occurrence_id', 'face_id'))
        resolved = faces.get((text(endpoint['occurrence_id']), text(endpoint['face_id'])))
        if not resolved:
            raise ValueError('ASSEMBLY_FIELD_BOUNDARY: unknown occurrence-scoped exterior face')
        return resolved

    if any(not isinstance(problem[k], list) for k in ('boundaries', 'heat_sources', 'contacts')):
        raise ValueError('ASSEMBLY_FIELD_THERMAL_FIELDS: lists required')
    if len(problem['boundaries']) > 20000 or len(problem['heat_sources']) > 5000 or len(problem['contacts']) > 5000:
        raise ValueError('ASSEMBLY_FIELD_RESOURCE: thermal problem budget exceeded')
    boundaries, assigned = [], set()
    allowed = {'temperature': ('temperature_k',), 'heat_flux': ('heat_flux_w_m2',),
               'convection': ('heat_transfer_coefficient_w_m2k', 'ambient_temperature_k'), 'adiabatic': ()}
    for entry in problem['boundaries']:
        if not isinstance(entry, dict) or entry.get('type') not in allowed:
            raise ValueError('ASSEMBLY_FIELD_BOUNDARY: unsupported thermal boundary')
        keys(entry, ('face', 'type', *allowed[entry['type']]))
        resolved = face(entry['face'])
        if resolved['id'] in assigned:
            raise ValueError('ASSEMBLY_FIELD_BOUNDARY: duplicate thermal boundary')
        assigned.add(resolved['id'])
        boundaries.append({'id': resolved['id'], 'vertices': resolved['vertices'],
                           **{k: v for k, v in entry.items() if k != 'face'}})
    sources = {}
    for entry in problem['heat_sources']:
        keys(entry, ('occurrence_id', 'cell_id', 'heat_source_w_m3'))
        trace = traces.get(text(entry['occurrence_id']), {})
        cid = trace.get('cell_map', {}).get(text(entry['cell_id']))
        if cid is None or cid in sources:
            raise ValueError('ASSEMBLY_FIELD_SOURCE: unknown or duplicate occurrence cell load')
        sources[cid] = number(entry['heat_source_w_m3'])
    assembly = AssemblyIRV1.from_dict(request['assembly'])
    retained_contacts = {c.id: c for c in assembly.thermal_contacts}
    contacts, contact_ids, contact_faces = [], set(), set()
    for entry in problem['contacts']:
        keys(entry, ('contact_id', 'face_pairs', 'thermal_contact_conductance_w_m2k'))
        cid = text(entry['contact_id'])
        retained = retained_contacts.get(cid)
        if retained is None or cid in contact_ids:
            raise ValueError('ASSEMBLY_FIELD_CONTACT: unknown or duplicate retained contact')
        contact_ids.add(cid)
        if not isinstance(entry['face_pairs'], list) or not 1 <= len(entry['face_pairs']) <= 256:
            raise ValueError('ASSEMBLY_FIELD_CONTACT: bounded nonempty contact face pairs required')
        conductance = number(entry['thermal_contact_conductance_w_m2k'], positive=True)
        total_area = 0.0
        for index, pair in enumerate(entry['face_pairs']):
            keys(pair, ('left', 'right'))
            left, right = face(pair['left']), face(pair['right'])
            if (retained.endpoint_a, retained.endpoint_b) != (left['occurrence_id'], right['occurrence_id']):
                raise ValueError('ASSEMBLY_FIELD_CONTACT: exact retained occurrence endpoints required')
            if left['id'] == right['id'] or {left['id'], right['id']} & (assigned | contact_faces):
                raise ValueError('ASSEMBLY_FIELD_CONTACT: duplicate or boundary-constrained contact face')
            contact_faces.update((left['id'], right['id']))
            xyz = np.array([handoff['mesh']['vertices'][v] for v in left['vertices']])
            total_area += float(np.linalg.norm(np.cross(xyz[1]-xyz[0], xyz[2]-xyz[0]))/2)
            contacts.append({'id': identity('contact', cid, index), 'left_vertices': left['vertices'],
                             'right_vertices': right['vertices'], 'thermal_contact_conductance_w_m2k': conductance})
        if retained.contact_area_mm2 is not None and not math.isclose(total_area*1e6, retained.contact_area_mm2, rel_tol=1e-8):
            raise ValueError('ASSEMBLY_FIELD_CONTACT: face area disagrees with retained contact area')
        if retained.thermal_resistance_k_per_w is not None:
            resistance = 1/(conductance*total_area)
            if not math.isclose(resistance, retained.thermal_resistance_k_per_w, rel_tol=1e-8):
                raise ValueError('ASSEMBLY_FIELD_CONTACT: conductance disagrees with retained thermal resistance')
    if contact_ids != set(retained_contacts):
        raise ValueError('ASSEMBLY_FIELD_CONTACT: every retained contact needs an explicit matched-face model')
    materials = [{k: m[k] for k in ('id', 'thermal_conductivity_w_mk')} for m in handoff['materials']]
    # Keep the public solver-mesh/v1 object map schema unchanged. The kernel's
    # internal ownership admission needs occurrence tags at coincident contacts.
    thermal_mesh = copy.deepcopy(handoff['mesh'])
    for trace in handoff['source_traceability']:
        for sid in trace['source_map'].values():
            thermal_mesh['object_map'][sid]['occurrence_id'] = trace['occurrence_id']
    result = run_assembly_tetra_thermal({'contract': 'spike/assembly-tetra-thermal-request/v1',
               'mesh': thermal_mesh, 'materials': materials, 'boundaries': boundaries,
               'heat_sources_w_m3': sources, 'contacts': contacts})
    occurrence_temperatures = {}
    for oid, trace in traces.items():
        start, stop = trace['vertex_range']
        samples = result['node_temperatures_k'][start:stop]
        occurrence_temperatures[oid] = {'minimum_k': min(samples), 'maximum_k': max(samples),
                                       'vertex_range': [start, stop]}
    output = {'contract': 'spike/assembly-field-thermal-result/v1', 'model_status': 'experimental',
              'production_qualified': False, 'assembly_digest': handoff['assembly_digest'],
              'request_digest': handoff['request_digest'], 'handoff_digest': handoff['handoff_digest'],
              'problem_digest': canonical_json_digest(problem), 'field_result': result,
              'occurrence_temperatures': occurrence_temperatures,
              'source_traceability': handoff['source_traceability'],
              'adiabatic_face_ids': [f['id'] for f in handoff['boundary_faces'] if f['id'] not in assigned | contact_faces],
              'limitations': handoff['limitations']}
    output['result_digest'] = canonical_json_digest(output)
    bounded_json(output)
    return copy.deepcopy(output)


def verify_assembly_field_result(request, problem, result):
    """Integrity/staleness admission only, not proof that computation is correct."""
    bounded_json(result)
    if not isinstance(result, dict) or result.get('contract') != 'spike/assembly-field-thermal-result/v1':
        raise ValueError('ASSEMBLY_FIELD_RESULT: unsupported result contract')
    content = {k: v for k, v in result.items() if k != 'result_digest'}
    if result.get('result_digest') != canonical_json_digest(content):
        raise ValueError('ASSEMBLY_FIELD_RESULT_DIGEST: changed result payload')
    current = prepare_assembly_field_handoff(request)
    for key in ('assembly_digest', 'request_digest', 'handoff_digest'):
        if result.get(key) != current[key]:
            raise ValueError('ASSEMBLY_FIELD_STALE: geometry, material or placement changed')
    if result.get('problem_digest') != canonical_json_digest(problem):
        raise ValueError('ASSEMBLY_FIELD_STALE: thermal study changed')
    if result.get('model_status') != 'experimental' or result.get('production_qualified') is not False:
        raise ValueError('ASSEMBLY_FIELD_RESULT: unsupported qualification claim')
    from .assembly_field_result import validate_thermal_result_shape
    validate_thermal_result_shape(result, current)
    return copy.deepcopy(result)
