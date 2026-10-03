# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 SigHarmonic
"""Bounded assembly field methods; no solver process/executable overrides."""
from .service_helpers import error_response, operation_id


def handle_assembly_field_request(method, params, *, request_id=None):
    methods = {'prepare_assembly_field_handoff', 'run_assembly_field_thermal', 'derive_assembly_view_factors',
               'export_assembly_field_study', 'import_assembly_field_study', 'run_assembly_electrothermal',
               'evaluate_electrical_heat_source'}
    if method not in methods:
        return None
    try:
        if not isinstance(params, dict):
            raise ValueError('ASSEMBLY_FIELD_FIELDS: parameters must be an object')
        if method in {'prepare_assembly_field_handoff', 'derive_assembly_view_factors'}:
            if set(params) != {'request'}:
                raise ValueError('ASSEMBLY_FIELD_FIELDS: only request accepted')
            if method == 'prepare_assembly_field_handoff':
                from .assembly_field_handoff import prepare_assembly_field_handoff
                result = prepare_assembly_field_handoff(params['request'])
            else:
                from .assembly_field_handoff import bounded_json
                from .assembly_view_factors import derive_assembly_view_factors
                bounded_json(params['request'])
                result = derive_assembly_view_factors(params['request'])
                bounded_json(result)
        elif method == 'run_assembly_electrothermal':
            if set(params) != {'request'}:
                raise ValueError('ELECTROTHERMAL_FIELDS: only request accepted')
            from .assembly_electrothermal import run_assembly_electrothermal
            result = run_assembly_electrothermal(params['request'])
        elif method == 'evaluate_electrical_heat_source':
            if set(params) != {'request','temperature_k'}:
                raise ValueError('ELECTROTHERMAL_FIELDS: source request and temperature required')
            from .electrical_heat_sources import evaluate_electrical_heat_source
            from .assembly_field_handoff import bounded_json
            bounded_json(params)
            result = evaluate_electrical_heat_source(params['request'],params['temperature_k'])
            bounded_json(result)
        elif method == 'run_assembly_field_thermal':
            if set(params) != {'request', 'problem'}:
                raise ValueError('ASSEMBLY_FIELD_FIELDS: request and problem required')
            from .assembly_field_thermal import run_assembly_field_thermal
            result = run_assembly_field_thermal(params['request'], params['problem'])
        elif method == 'export_assembly_field_study':
            if not {'request', 'problem'} <= set(params) or set(params)-{'request', 'problem', 'result', 'include_results'}:
                raise ValueError('ASSEMBLY_FIELD_FIELDS: invalid study export')
            from .assembly_field_study import export_assembly_field_study
            result = export_assembly_field_study(**params)
        else:
            if 'record' not in params or set(params)-{'record', 'current_request', 'current_problem'}:
                raise ValueError('ASSEMBLY_FIELD_FIELDS: invalid study import')
            from .assembly_field_study import import_assembly_field_study
            result = import_assembly_field_study(**params)
    except (ValueError, TypeError, KeyError, AttributeError, OverflowError) as exc:
        return error_response('SPIKE-BE-IPC-E-0001', 'Assembly field request is invalid or unsupported.',
                              operation_id=operation_id(request_id), detail=str(exc),
                              context={'method': method, 'boundary': 'assembly_field'}, error_type=type(exc).__name__)
    return {'ok': True, 'result': result}
