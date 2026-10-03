# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 SigHarmonic
"""Offline field-study snapshots with explicit integrity and stale admission."""
import copy

from .assembly_field_geometry import keys
from .assembly_field_handoff import bounded_json, prepare_assembly_field_handoff
from .assembly_field_thermal import verify_assembly_field_result
from .multiboard_identity import canonical_json_digest


def export_assembly_field_study(request, problem, result=None, *, include_results=True):
    prepare_assembly_field_handoff(request)
    bounded_json(problem)
    if type(include_results) is not bool:
        raise ValueError('ASSEMBLY_FIELD_STUDY: include_results must be boolean')
    if result is not None:
        result = verify_assembly_field_result(request, problem, result)
    record = {'contract': 'spike/assembly-field-study-file/v1', 'request': copy.deepcopy(request),
              'problem': copy.deepcopy(problem), 'result': result if include_results else None}
    record['file_digest'] = canonical_json_digest(record)
    bounded_json(record)
    return record


def import_assembly_field_study(record, *, current_request=None, current_problem=None):
    bounded_json(record)
    keys(record, ('contract', 'request', 'problem', 'result', 'file_digest'))
    content = {k: v for k, v in record.items() if k != 'file_digest'}
    if record['contract'] != 'spike/assembly-field-study-file/v1' or canonical_json_digest(content) != record['file_digest']:
        raise ValueError('ASSEMBLY_FIELD_STUDY_DIGEST: altered or unsupported study')
    prepare_assembly_field_handoff(record['request'])
    if current_request is not None and canonical_json_digest(current_request) != canonical_json_digest(record['request']):
        raise ValueError('ASSEMBLY_FIELD_STALE: active assembly field request differs')
    if current_problem is not None and canonical_json_digest(current_problem) != canonical_json_digest(record['problem']):
        raise ValueError('ASSEMBLY_FIELD_STALE: active field problem differs')
    if record['result'] is not None:
        verify_assembly_field_result(record['request'], record['problem'], record['result'])
    return copy.deepcopy(record)
