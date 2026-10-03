# Preparing the SPIKE FreeCAD Workbench for its own Git repository

This procedure creates a clean, standalone source repository later. It does not change the current SPIKE checkout, its index, its branches, or any remote. Run the commands only from a separate PowerShell session when the workbench is ready to publish.

The standalone repository root is the current `SPIKEWorkbench` directory, not the enclosing `integrations/freecad` directory. Its package metadata expects `Init.py`, `InitGui.py`, `package.xml`, `Resources`, and `spike_freecad` at that root. The Solver Suite remains a client of a separately installed or checked out SPIKE worker; moving the workbench source does not bundle SPIKE or its runtimes.

## 1. Choose and review the exact source

From the SPIKE repository, first review only the material that is a candidate for the new repository. Do not use `git add -A`, `git commit -a`, or copy the whole SPIKE checkout: it currently contains unrelated modified, deleted, and untracked files.

```powershell
git status --short -- integrations/freecad
git diff --check -- integrations/freecad
git diff -- integrations/freecad/SPIKEWorkbench
python -m unittest discover -s integrations/freecad/SPIKEWorkbench/tests -v
```

Review every untracked workbench file explicitly before the export, including the solver UI, request builders, KiCad STEP bridge, result viewers, tests, icons and screenshots. Include them only after they have been reviewed and tested. Do not use `git clean` in this shared checkout.

If the collaboration contract has changed, make its intentional mirror match in
the SPIKE checkout before exporting. Then build both standalone ZIPs:

```powershell
python scripts/sync_freecad_contract.py
python integrations/freecad/SPIKEWorkbench/tools/package.py --kind install --output '.tmp/SPIKEWorkbench-review-install.zip'
python integrations/freecad/SPIKEWorkbench/tools/package.py --kind source --output '.tmp/SPIKEWorkbench-review-source.zip'
```

The SPIKE checkout's `scripts/package_freecad_workbench.py` checks the mirrored
session contract. The standalone helper builds ZIPs without that parent check;
run the mirror check separately when changing the contract. The install ZIP
is for FreeCAD's `Mod` directory; the source ZIP is the reviewed new-repository
candidate and includes GitHub metadata, source, docs, tests, and tooling.

## 2. Export to a new, empty staging directory

Use the source ZIP to stage the candidate. `destination` must be new and outside
the SPIKE checkout; the guard prevents merging with existing work. Replace the
example path with a local location, not a remote URL.

```powershell
$destination = 'C:\src\SPIKE-FreeCAD-Workbench'
$archive = (Resolve-Path '.tmp/SPIKEWorkbench-review-source.zip').Path

if (Test-Path -LiteralPath $destination) {
    throw "Destination already exists: $destination"
}
New-Item -ItemType Directory -Path $destination -ErrorAction Stop | Out-Null
Expand-Archive -LiteralPath $archive -DestinationPath $destination -ErrorAction Stop
Set-Location -LiteralPath (Join-Path $destination 'SPIKEWorkbench')
```

The explicit package allowlist keeps `package.xml`, the MIT `LICENSE`,
FreeCAD entry points, schemas, icons, examples, docs, tests, and `.github`
workflow files. It excludes `__pycache__`, user settings, build output, ZIPs,
logs, virtual environments, and the SPIKE runtime. The source includes a
narrow `.gitignore` that keeps required source visible:

```gitignore
__pycache__/
*.py[cod]
.pytest_cache/
.coverage
htmlcov/
.venv/
venv/
env/
build/
dist/
artifacts/
*.zip
*.FCStd1
*.log
.DS_Store
Thumbs.db
.vscode/
.idea/
.env
.env.*
*.pem
*.key
```

Review that file for the destination environment. If a supported developer fixture needs an `.FCStd` file, add that exact path with `git add -f` only after documenting its source, ownership, license, redistribution right, and size rationale.

## 3. Carry documentation, screenshots, and provenance deliberately

The workbench `README.md` is the install and runtime guide. Copy selected SPIKE documentation only when it is useful to workbench users, then repair relative links so they resolve inside the new repository. A practical initial set is:

```text
docs/FREECAD_COLLABORATION.md
docs/MCAD_EXPORT.md
docs/MULTIBOARD_HARNESS_ASSEMBLIES.md
docs/FREECAD_ASSEMBLY_THERMAL_EXTENSION_PLAN.md
docs/adr/0019-freecad-collaboration-sessions.md
docs/adr/0024-freecad-worker-client.md
docs/validation/freecad-collaboration-20260907.json
```

Copy `integrations/freecad/README.md` as `docs/WORKBENCH_OVERVIEW.md` if its broader feature description is wanted. Update its three `../../docs/...` links to paths under `docs/`. Update or remove links in the copied documents that still point to SPIKE-only documents, schemas, source files, or release artifacts. Do not copy SPIKE documentation that would make a standalone workbench claim ownership of SPIKE solver validation or package qualification.

Screenshots are optional source assets. Copy a screenshot only when the document that uses it is copied and its provenance, copyright, license, and redistribution right are recorded in the new repository's notice file. The SPIKE notice register records `docs/external-solver-center.png` and other images with their scope; it must not be treated as a blanket right to reuse them. Never export customer boards, paths, `.FCStd` documents, STEP models, screenshots, tokens, credentials, or local logs without an explicit ownership and redistribution review.

Preserve the current workbench `LICENSE` verbatim at repository root. Keep its MIT copyright, permission, and warranty text in all substantial copies. Before public release, add a scoped `THIRD_PARTY_NOTICES.md` and provenance record for every copied icon, screenshot, example, fixture, model, font, or dependency. FreeCAD itself is external software and is not bundled by this source repository.

## 4. Inspect the staged export before Git sees it

Run these checks from the extracted `SPIKEWorkbench` root. They distinguish a clean source export from an accidentally broad copy or an artifact containing secrets or credentials.

```powershell
Set-Location -LiteralPath (Join-Path $destination 'SPIKEWorkbench')
Get-ChildItem -Force
Get-ChildItem -Recurse -Force -Directory -Filter '__pycache__'
Get-ChildItem -Recurse -Force -File -Include '*.pyc', '*.pyo', '*.zip', '*.FCStd1'
Get-ChildItem -Recurse -Force -File | Select-String -Pattern `
    'BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36,}|xox[baprs]-' `
    -AllMatches
python -m unittest discover -s tests -v
```

The first three artifact commands should produce no unapproved output. Treat any secret-pattern match as a review stop: remove the secret from the staged copy, rotate any exposed credential through its owner, and re-run the scan. The pattern scan is a guardrail, not proof that no sensitive data exists.

For a real FreeCAD install, also run `tests/freecad_kernel_smoke.py` using `FreeCADCmd` or a FreeCAD Python console with the repository root on `sys.path`. The smoke test covers primitive import and mechanical export; GUI-only behavior still requires a recorded interactive review.

## 5. Initialize, make an auditable first commit, and inspect it

Only after the staged tree has passed review, create its independent history. Use the configured contributor identity and DCO sign-off required by SPIKE's contribution policy; the sign-off must state the real author name and email.

```powershell
Set-Location -LiteralPath (Join-Path $destination 'SPIKEWorkbench')
git init --initial-branch main
git status --short
git add -- Init.py InitGui.py package.xml LICENSE README.md GIT_WORKFLOW.md CONTRIBUTING.md SECURITY.md RELEASE_CHECKLIST.md Resources examples spike_freecad tests tools docs .gitignore .gitattributes .github THIRD_PARTY_NOTICES.md
git diff --cached --check
git diff --cached --stat
git diff --cached --name-only
git commit -s -m 'Initial SPIKE FreeCAD Workbench import'
git log -1 --format=full
git show --check --stat HEAD
```

Review the staged name list before committing; it is the final practical barrier against importing unrelated SPIKE changes. Use `git commit -s` on every later commit, including documentation and release changes.

## 6. Connect the new remote only when ready to publish

Replace the placeholder with the exact empty repository URL supplied by its owner. Verify it before the first push. These commands are intentionally deferred; they contact and modify the remote repository.

```powershell
$remoteUrl = 'https://github.com/OWNER/REPOSITORY.git' # replace with your new empty repository URL
git remote add origin $remoteUrl
git remote -v
git ls-remote --heads origin
git push -u origin main
```

Use a feature branch for later work:

```powershell
git switch -c feature/short-description
# edit, test, review staged paths
git add -- path/to/reviewed-file
git diff --cached --check
git commit -s -m 'Describe the change'
git push -u origin HEAD
```

## 7. Release tags and maintenance checks

Update `package.xml` version/date and the workbench README together. Test the
source tree and both ZIPs before a release. The standalone packager is
self-contained; when updating `session_contract.py`, compare it separately
against the intended SPIKE worker checkout and update compatibility evidence.

After the release commit is reviewed and pushed, create an annotated tag that matches `package.xml` and push it:

```powershell
git switch main
git pull --ff-only origin main
python -m unittest discover -s tests -v
git tag -a v0.5.0 -m 'SPIKE FreeCAD Workbench 0.5.0'
git show v0.5.0 --check
git push origin v0.5.0
```

For every update, repeat the focused unit tests, the real-kernel smoke when geometry or FreeCAD integration changes, the package ZIP integrity check, the license/provenance review for assets, `git diff --check`, and a staged-file review. Changes to the mirrored session contract need a coordinated SPIKE worker compatibility decision and versioning review; they cannot be validated by the standalone workbench alone.
