# Contributing to the SPIKE FreeCAD Workbench

This repository is a FreeCAD client for a separately installed SPIKE worker.
Keep solver capability and validation claims tied to the worker's returned
contracts, statuses, units, and diagnostics. A visible command is not proof of
a validated physical model.

## Development

Use Python 3.11 or newer. The dependency-free tests run without FreeCAD:

```sh
python -m unittest discover -s tests -v
python tools/package.py --kind install --output dist/SPIKEWorkbench-review.zip
```

Choose a new ZIP path if that output already exists. The package script is
self-contained and needs no SPIKE parent checkout. For geometry or GUI changes,
also test in a supported FreeCAD installation. On this project's Windows
development host, `tests/freecad_kernel_smoke.py` passed with FreeCAD 1.1.3;
the CI matrix does not install FreeCAD and cannot replace a GUI review.

Keep the workbench source usable from a clean clone. Do not introduce imports
from an enclosing SPIKE checkout into the workbench package or its tests. The
worker runs separately through its documented service protocol. Update the
[user guide](docs/USER_GUIDE.md), contract tests, and compatibility notes when
changing a public workflow.

## Review and licensing

Use a focused pull request. Include behavior, recovery path, tests, and
remaining limits. Numerical code and physical validation claims require a
knowledgeable human review before release. Never replace `approximate`,
`experimental`, `unsupported`, or blocked statuses with an unqualified success.

Original workbench source is MIT licensed. New source files should start with
`# SPDX-License-Identifier: MIT` or the appropriate comment form. Record the
source, owner, license, and redistribution rights for any copied code, board,
model, icon, font, fixture, screenshot, or other asset in
[asset provenance](docs/ASSET_PROVENANCE.md) and
[third-party notices](THIRD_PARTY_NOTICES.md). Do not submit private boards,
local machine paths, credentials, STEP exports, or solver logs.

Every commit submitted for inclusion must have a real Developer Certificate of
Origin sign-off. Use `git commit -s` with the contributor's configured name and
email; do not invent another person's sign-off.
