# Project session adapter

`ProjectSession` is the wx independent persistence boundary for the ignored
native experiment. It stores worker JSON as opaque data and does not parse EDA
formats or reproduce Python package logic.

## Integration API

1. For **Open project**, send `ProjectSession::project_open_request(path)` with
   `WorkerBridge::send`. The request is `read_project_package` with only `path`,
   so the Python worker hydrates saved result artifacts. On success call
   `accept_project_open(path, reply.result)`.
2. Render `session.design()` if it is non-null. For an opened project this is
   `result.canonical.design_ir`, falling back to
   `project.design.canonical_design`; `project.design` itself is only a desktop
   source/persistence wrapper. The complete
   `reply.result.project` remains in `session.project()`; the complete open
   result, including canonical and manifest metadata, remains available as
   `session.source_result()`.
3. Apply UI changes through `edit_project`. The edit runs transactionally on a
   copy of the retained snapshot, so fields the native UI does not understand
   survive unchanged. Tauri stores native PI controls at
   `analysis.mode`, `analysis.power_nets`, and `analysis.pi_setup`; update those
   exact children rather than replacing the `analysis` object.
4. For **Save** or **Save As**, send
   `session.project_save_request(destination, include_results)`. It calls the
   same `write_project_package` method and `portable_project` profile as the
   Tauri client. For an opened package it also supplies the original
   `base_package_path`, allowing the Python worker to retain verified package
   members and canonical fields. After a successful save call
   `accept_project_save(reply.result)` so the saved package becomes the base for
   the next save.
5. For **Import design**, send `design_import_request(path, format_hint)` and
   call `accept_design_import(path, reply.result)`. An imported design remains a
   design source, with no project path or project-save request. Once the client
   has the exact UTF-8 source text, call `create_project_from_import` to create
   the bounded `spike-project-package/v2` desktop envelope used by Tauri. Its
   first save has no `base_package_path`; after `accept_project_save`, later
   saves use the new package as their lossless base. Keeping these two steps
   separate prevents an import response from silently replacing open project
   state.

Malformed replies and edits fail before replacing a valid session. The adapter
does not verify package signatures, read deferred artifacts, serialize board
visuals, or interpret project contracts. Those remain with the native host,
Python worker, and future UI integration respectively.

## Focused contract check

`tests/project_session_test.cpp` is a dependency-light executable. Compile it
with `src/project_session.cpp`, the `include` directory, and nlohmann-json. It
checks exact open/import/save methods and parameters, canonical design
selection, imported-project promotion, retention of unknown
top-level and nested fields, Save As base-path handoff, import/open separation,
and transactional rejection of malformed responses.
