<!-- SPDX-License-Identifier: Apache-2.0 -->
# ADR 0023: Integrated Python workspace

- Status: Accepted for the local engineering preview.
- Date: 2026-09-24

## Context

The external extension and automation contracts were callable from Python,
but a desktop user had no integrated place to inspect, edit, and run a script
against the current board and result.

## Decision

The desktop provides a Python editor with `.py` open/save, run/stop, a time
limit, and captured output. `run_python_script` executes code in a separate
local Python child process, not in the webview or resident worker. The child
receives normalized `spike/v1` SpiDeR and a bounded current result context.
The injected `spike` facade calls ordinary worker methods. Published results
return to the parent worker, which checks board binding, model status, finite
values, and sample limits before the desktop displays them.
Extensions trusted in the current worker session are made available to the
script child; scripts can invoke them through the same extension contract.

The child is user-authored Python with the user's filesystem and package
access. The process boundary supports worker cancellation and protects the
resident worker from ordinary script exceptions; it is not a security sandbox.
Code, input, output, time, and returned result sizes are bounded. The browser
preview offers editing and download, with execution limited to the desktop.

## Consequences

### Editor and debugger extension — 2026-10-03

The workspace now has a lazy `.py` file tree, independent tabs, Save/Save as,
optimistic file hashes, unsaved-close choices and session-scoped draft recovery.
The frontend owns presentation state; `python_workspace_files` owns bounded,
root-confined reads and atomic script writes. Native pickers remain in the thin
desktop host. A dedicated Help pane and categorized templates expose the
existing worker contracts, with guarded request-file runners and explicit inputs.

Debugging uses a separate, supervised child with `start_python_debug`,
`python_debug_status` and `python_debug_command`. UUID-addressed local session
files carry token-bound atomic commands and bounded snapshots. Revisions and
command acknowledgements prevent stale status from enabling repeat steps.
Breakpoints apply to the active script; stepping can enter local Python modules
under its selected working directory. The webview and resident worker remain
responsive while paused. Time and idle leases bound the debug child's lifetime,
and terminal results pass the same design-bound admission as ordinary runs.
Thread debugging, remote attach, arbitrary evaluation and third-party IDE
protocol parity are outside this change. See [Python workspace](../PYTHON_WORKSPACE.md).

### Bound library and completion — 2026-10-04

Run and Debug bind the same `spike` Python module to the script's board/result
snapshot. Board occurrences retain distinct identities, even when they share a
source design or net names. Collections expose boards, nets, layers, components,
assembly links and result data through that snapshot. Existing worker methods
remain the execution boundary for analysis and extensions.

`spike.ui` returns bounded, allowlisted action records; it cannot manipulate the
webview directly. The worker validates target identity, and the frontend admits
actions only from successful runs whose board context is still current. Result
publication keeps its existing independent admission checks.

Caret completion reads local symbols and a declarative API catalog shared with
the Python library. It never imports packages or evaluates script expressions.
Loaded-net suggestions preserve occurrence scope; user labels show net and board
names while inserted calls retain canonical identities. This static completion
is not a language server or full Python type inference.

Interactive scripts and unattended `SpikeAutomation` programs use the same
worker contracts. A script can inspect and exchange board data, automate
worker methods, and publish explicit analysis fields. Publishing a field does
not prove solver validity or imply other field quantities were computed.
