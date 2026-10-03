# GitHub launch checklist

The standalone source ZIP and FreeCAD installation ZIP can be built locally
with `python tools/package.py`. The original SPIKE checkout and its unrelated
working-tree changes must not be copied into the new repository.

## Before the first public push

- [ ] Confirm the new GitHub owner, repository name, visibility, maintainer
      contact, and package metadata. Replace the empty `package.xml` maintainer
      email only with a contact approved for publication.
- [ ] Resolve the screenshot and demo-board redistribution review in
      `THIRD_PARTY_NOTICES.md` and `docs/ASSET_PROVENANCE.md`. Record rights and
      notices, or remove/replace any asset that cannot be published. Check every
      Markdown image link after changes.
- [ ] Review the inherited Python source files without SPDX headers. Preserve
      the byte-for-byte mirrored `spike_freecad/session_contract.py` until a
      coordinated worker update; document any exception to the header policy.
- [ ] Check the standalone worker compatibility statement and test against the
      intended SPIKE worker checkout. The CI suite validates workbench contracts
      but does not establish solver qualification.
- [ ] Run `python -m unittest discover -s tests -v` and both `tools/package.py`
      modes from a clean standalone copy. Inspect the ZIP file lists and hashes.
- [ ] Verify installation, update, offline startup, and uninstall in FreeCAD;
      record a GUI check of linking, board/copper/model visibility, result
      overlay, probing, F1 help, and error recovery.
- [ ] Review the exact staged file list, credentials, paths, licenses, and DCO
      sign-off. Keep customer boards, STEP/FCStd files, local logs, and private
      results out of the repository.

## GitHub settings after creating the empty repository

- Set `main` as the default branch and require the **Workbench checks** job
  before merging pull requests once its first run passes.
- Enable private vulnerability reporting and set a private security contact.
- Add a concise repository description, topics (`freecad`, `kicad`, `pcb`,
  `simulation`), and the MIT license indication.
- Create a release only after reviewing the tag, installation ZIP, source ZIP,
  checksum, asset rights, and worker compatibility note.

See [GIT_WORKFLOW.md](GIT_WORKFLOW.md) for the staged export, first commit,
remote setup, and tag commands. No workflow in this source tree automatically
pushes a branch, creates a GitHub release, or publishes an installation ZIP.
