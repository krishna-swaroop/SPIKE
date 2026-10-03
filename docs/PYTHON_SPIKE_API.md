<!-- SPDX-License-Identifier: Apache-2.0 -->
# SPIKE Python API

The Python workspace binds an importable `spike` module in both Run and Debug.
The injected `spike` name refers to the same module, so existing scripts that
omit `import spike` continue to work. The module is created for each child
process from a finite JSON snapshot; it is not a general in-process desktop API.

## Workspace snapshot

The worker accepts this additional execution parameter:

```json
{
  "workspace": {
    "boards": [
      {"id": "occurrence-1", "name": "Controller", "design_id": "design-1", "design": {}}
    ],
    "selected_board_id": "occurrence-1",
    "assembly": {"connector_links": []}
  }
}
```

`id` identifies a board occurrence. It is unique within the snapshot and is the
only identity used for cross-board queries or UI actions. `design_id` identifies
the underlying normalized design and may be repeated by multiple occurrences.
Equal board or net names do not merge items or create electrical connectivity.
Name lookup fails when it is ambiguous.

Snapshots contain at most 256 boards and share the existing 64 MB request
limit. IDs, finite JSON values, embedded design IDs, and assembly shape are
validated before starting the child. `selected_board_id` may be `null`; lists
and explicit board ID queries remain available, while a board-scoped query that
omits its board ID raises `ValueError`. `assembly` may be `null` and is exposed
as an empty assembly. If `workspace` is absent, the legacy `design` parameter is
exposed as one selected occurrence. When both are supplied and a board is
selected, its design ID must match the legacy design ID. `spike.design` and
publication binding continue to use the supplied legacy design.

## Data access

All inventory getters return detached values. Changing a returned dictionary
does not change the desktop workspace.

| Member | Behavior |
| --- | --- |
| `spike.design` | Selected normalized design, or `None`. Preserves the legacy API. |
| `spike.results` | Current result context, or `None`. Preserves the legacy API. |
| `spike.boards.list()` | Board occurrence summaries with `id`, `name`, `design_id`, and `selected`. |
| `spike.boards.get(board_id=None, *, name=None)` | Full occurrence record. Omission selects `selected_board_id`. |
| `spike.nets.list(board_id=None)` | Normalized nets for one board occurrence. |
| `spike.nets.get(net_id=None, *, name=None, board_id=None)` | One board-scoped net. |
| `spike.layers.list(board_id=None)` | Normalized layer inventory for one board occurrence. |
| `spike.layers.get(layer_id=None, *, name=None, board_id=None)` | One board-scoped layer. |
| `spike.components.list(board_id=None)` | Normalized component inventory for one board occurrence. |
| `spike.components.get(component_id=None, *, reference=None, board_id=None)` | One board-scoped component. |
| `spike.assembly.connector_links()` | Explicit connector mappings from `assembly.connector_links` or the compatibility `connector_mappings` field. |
| `spike.result_data.current` / `.get()` | Detached current result context without replacing `spike.results`. |

Example:

```python
import spike

for board in spike.boards.list():
    print(board["id"], board["name"], board["design_id"])

selected = spike.boards.get()
for net in spike.nets.list(selected["id"]):
    print(net.get("id"), net.get("name"))

for link in spike.assembly.connector_links():
    print(link)
```

The connector API reports saved mappings only. It does not infer a link from
matching board, connector, pin, or net names.

## Worker analysis, extensions, and publication

`spike.analysis.run(method, params)` delegates to `spike.call` and therefore
uses the registered worker method's existing input validation, availability,
model status, and result contract. `spike.analysis.catalog()` returns the
worker's current capabilities and solver catalog. A catalog entry indicates
registration; it does not establish runtime availability, convergence, or
model validation.

The established members remain available:

- `spike.call(method, params=None)`
- `spike.extensions()`
- `spike.invoke_extension(extension_id, contribution_id, parameters=None)`
- `spike.publish_result(result)`
- `spike.publish_scalar_field(name, samples, ...)`

Nested Run or Debug starts are rejected. Extension trust and permissions remain
session bound. Published results still pass host-side design binding and
AnalysisResult admission after the child exits. No solver or numerical contract
is changed by this module.

## Declarative UI actions

Scripts request a small allowlisted action; they never receive a callable
desktop object:

```python
spike.ui.select_net("occurrence-1", 12)
spike.ui.focus_board("occurrence-1")
spike.ui.open_panel("nets")
```

Allowed panels are `layers`, `nets`, `connector_links`, `results`, and `issues`.
Board and net IDs must exist in the execution snapshot. Each session may return
at most 64 actions. Successful Run and Debug results expose them in
`ui_actions`, for example:

```json
[
  {"action": "select_net", "board_id": "occurrence-1", "net_id": 12},
  {"action": "open_panel", "panel": "nets"}
]
```

The parent validates this untrusted child payload again. The desktop applies
actions only after successful completion and after confirming that the current
workspace still matches the snapshot used for execution. A failed script,
invalid payload, stale context, or rejected published result yields no actions.

## Completion metadata

[`python-workspace-api-v1.json`](../schemas/python-workspace-api-v1.json) is the
shared static completion catalog. Each entry has `path`, `kind`, `signature`,
`description`, and optional `insert_text`. It lists implemented members only.
Completion consumers read this file as data; they do not import packages,
reflect on runtime objects, or execute user code. It is a SPIKE API catalog,
not a general Python language server or installed-package index.
