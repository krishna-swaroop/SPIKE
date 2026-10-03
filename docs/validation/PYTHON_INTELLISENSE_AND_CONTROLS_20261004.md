<!-- SPDX-License-Identifier: Apache-2.0 -->
# Python completion, shared controls and ECAD–MCAD organization

## Delivered behavior

- Caret suggestions rank local symbols, modules, API members, templates and loaded
  board nets without importing packages or evaluating expressions. Ctrl+Space
  opens suggestions; arrows choose, Tab/Enter inserts, Escape dismisses.
- A searchable net pane supports selected/all board occurrences, name insertion,
  scoped lookup insertion and selection. Labels show names; canonical numeric or
  string identities remain in the operation. Equal names never create links.
- Run and Debug bind the same `import spike` library. UI actions are bounded,
  target-validated, completion-only and rejected after board context changes.
- Shared theme controls cover the application and interactive previews, with a
  guard for imports, theme tokens and required states. Specialized scoped controls
  and self-contained report documents retain their documented styling boundary.
- The installed `spike-ui` skill now references the standard and guard; the
  skill-creator validator reports it valid.
- Assembly organization has four workflow stages, selected-board commands,
  inventory/search, package controls and bounded FreeCAD/attachment launch actions.

## Evidence

Passed: Python workspace, backup, file explorer, 53-template syntax and completion
tests; assembly workspace/draft and tool/gizmo tests; shared control guard;
TypeScript; parser regression; production Vite build; help reference and 1,883
control-site checks; Cargo (38 passed, one live-OS check ignored); Python API and
debugger integration (14 passed); scoped diff whitespace check.

Browser verification used the real retained SH-RPi inventory in two occurrences:
118 nets per occurrence. Selected-board filtering, name search, scoped lookup,
caret suggestions and keyboard insertion were exercised. A narrow CSS viewport
of 1,200 × 800 showed the popup contained in the editor with no horizontal page
overflow; the normal viewport was 1,706 × 960. Temporary viewport sizing was reset.
Captures: `build/python-intellisense-20261003/python-suggestions-wide.jpg` and
`python-suggestions-narrow.jpg` in the same directory. These are browser captures;
native window movement and live solver runs were not verified in this session.

## Required-gate limitations

The full Python run executed 2,402 tests in 492 seconds: one release-policy
failure, two model-library database errors and 13 skips. Both database tests
passed when rerun with `SPIKE_MODEL_INDEX_PATH` under the writable workspace;
the sandbox cannot use the default external model cache. The release-policy
failure is `test_current_candidate_is_technical_but_externally_blocked`, which
expects `PUBLIC_RELEASE_DEPENDENCY_APPROVAL_REQUIRED` absent from the current
release evidence. No release policy or test expectation was changed.

The architecture gate currently fails on concurrent `app/src/boardParser.ts`
changes: its source exceeds the 800-line limit, and a spread-extrema expression is
flagged. Those parser changes are outside this implementation. The dedicated
shared-control guard passes independently. The production build passed after
running outside the sandbox because Vite's config loader could not read parent
directories within it; existing large-chunk warnings remain.

Completion is static assistance, not full Python type inference or a language
server. The change adds no solver qualification or third-party dependency.
