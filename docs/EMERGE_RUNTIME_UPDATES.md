<!-- SPDX-License-Identifier: Apache-2.0 -->
# Updating the local EMerge runtime

Open the EMerge setup and its runtime update controls. Select the solver
Python executable, choose **Prerelease** or **Stable**, and check for updates.
Review the installed and offered versions, then start the update. The app
shows the background operation and its bounded log. The default prerelease
channel includes EMerge 3 alphas, matching the upstream
[EMerge hub](https://github.com/FennisRobert/EMerge-hub) installation channel.
Stable never substitutes EMerge 2 if no stable 3+ wheel exists.

An explicit interpreter must be a dedicated virtual environment. With no
selection the updater searches `.venv-emerge3`, `.venv-rf`, then `.venv-emerge`
under the distribution root, checking Windows `Scripts/python.exe` and POSIX
`bin/python`. It does not fall back to the worker or system Python. Select the
same interpreter for the subsequent EMerge solve. The running worker's own
environment and virtual environments exposing system site packages cannot be
updated. This updater does not create environments or install missing pip.

The start button authorizes installing the displayed, exact EMerge release
and any dependencies needed by pip in that selected environment. Use a
dedicated solver environment; installing dependencies may affect other tools
sharing it. This feature does not bundle or relicense EMerge. Upstream runtime
licenses continue to apply as recorded in `THIRD_PARTY_NOTICES.md`.

## Result and recovery

- `succeeded` means the exact selected package version was read back, `pip
  check` passed, and the adapter detected its required APIs in a fresh process.
  This is API compatibility evidence, not numerical or physics validation.
- `failed` includes the reason, log, observed installed version when readable,
  `install_completed`, `pip_check_passed`, and the full adapter probe when run.
  A package install can complete while its dependency or API checks fail.
- An install is not transactional. There is no automatic rollback. After a
  failure, inspect the runtime before solving; select or recreate a separate
  known-good EMerge 3+ environment when necessary. The updater prohibits
  downgrades and equal-version reinstalls, including from stale update checks.
- Keep the app open until completion. A normal worker input close waits for
  the maintenance thread. A forced process termination or machine shutdown
  can interrupt pip and lose operation status; a child installer may remain
  alive. Wait until the installer has stopped before reopening the app or
  repairing/checking the environment. Unknown operation IDs remain errors,
  rather than falsely reporting that an unobserved installer has stopped.

Within a resident worker, EMerge and Optycal probes, meshes and solves cannot
overlap an update, and updates cannot start during either engine's execution.
Optycal uses the same default solver environment and can be affected by pip's
dependency changes. This guard conservatively covers both engines even when
an explicitly selected path differs; unrelated extensions remain available.
A per-environment OS
file lock prevents simultaneous updates from other SPIKE workers. It releases
when the update finishes or the owning worker exits. It does not coordinate
external terminals or other applications using that environment; stop those
uses before an update. Forced worker termination can release the lock before
an orphaned installer exits, so the recovery rule above remains necessary.

## Worker contract

All successful method envelopes contain `ok: true` and a result with
`contract: spike/emerge-runtime-update/v1` and `model_status: unvalidated`.
Input/network/process errors return `ok: false`, an error string and type.

| Method | Parameters | Result |
| --- | --- | --- |
| `check_emerge_update` | Optional `python_executable`; `channel` is `prerelease` (default) or `stable` | `status: checked`, resolved `python_executable`, `channel`, `installed_version`, `target_version`, `can_update`, `reason`, `compatibility: null` |
| `start_emerge_update` | Same interpreter and channel, plus the checked `target_version` | `operation_id`, `status: running`, versions/path/channel, empty initial `log`, `install_completed: false`, `pip_check_passed: false`, `compatibility: null` |
| `emerge_update_status` | `operation_id` | Snapshot with `running`, `succeeded`, or `failed`, bounded `log`, observed installed version, install/dependency flags, optional full adapter `compatibility` and failure `recovery` |

Checks are cached for 15 minutes, bound to interpreter/channel/version; start
requires one of these checked candidates. The installed version is rechecked
immediately before pip runs. A worker retains the latest 16 operation records
and up to 32 checked candidates in memory. At most one update runs per worker.
The start call returns immediately after acquiring the environment lock and
launching the background thread. Check performs bounded metadata reads and
does not import the solver in the worker. Poll status while the update runs;
a lost polling response is not proof that the installer terminated.

## Process and network boundary

`emerge_runtime_updates.py` owns state and worker execution guards;
`emerge_runtime_updates_io.py` owns validation and process/network boundaries.
The service dispatcher delegates both ordinary extension invocation and
SPIKE-Em's fixed-engine invocation through the same update guard. The adapter's
existing `_probe_executable` remains authoritative for API checks.

Release metadata comes only from the HTTPS PyPI `emerge` JSON endpoint, with
redirects and environment proxies disabled and a 4 MiB response limit. The
latest non-yanked wheel release in the requested channel and major version
3+ is offered. Standard public release, alpha, beta, RC, post and dev version
forms are admitted; arbitrary URLs, Git refs, ranges, epochs and local version
suffixes are rejected. Wheel availability for the actual Python/platform is
decided by pip during installation, so an offered release is not a promise of
platform or API compatibility.

Pip runs with an argv list, `shell=False`, isolated Python (`-I`), no input,
the exact `emerge==VERSION`, the fixed HTTPS PyPI simple index, wheels only,
and no cache. Existing `PIP_*`, proxy and `PYTHONPATH` settings are discarded.
`PIP_CONFIG_FILE=os.devnull` disables all pip configuration files, following
the [pip configuration contract](https://pip.pypa.io/en/stable/topics/configuration/).
`PIP_REQUIRE_VIRTUALENV=true` is an additional runtime guard. Dependencies are
resolved normally; the selected EMerge prerelease is pinned without globally
enabling prereleases of unrelated dependencies. Corporate custom indexes,
source builds and Git installs are deliberately outside this workflow.

Pip installation has a 900-second timeout, dependency checking 60 seconds,
metadata probes 15 seconds, and the adapter API probe its existing timeout.
The runner drains output continuously and retains only the last 24,000 bytes
per command; operation status retains the last 24,000 log characters. A
timed-out direct child is killed and reaped before its lock is released.
Readiness checking does not run a mesh or solve. Production packages still
need clean-machine, offline, actual upgrade and uninstall release acceptance;
the unit tests do not substitute for those checks.

## Verification

Run `python -m unittest tests.python.test_emerge_runtime_updates -v` in the
repository's populated development environment. Tests mock network and package
processes: no EMerge package is installed or changed. They cover channel and
version ordering, input/environment rejection, exact commands, pip isolation,
stale downgrades, concurrent update/solve guards, real service routes,
timeouts, log bounds, dependency/API failures and lock recovery.
