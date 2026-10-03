# SPIKE Board Viewer working instructions

This is a self-contained TypeScript/React visualization project. Read README.md,
docs/VIRTUAL_DATA.md and docs/EXTRACTION.md before changing public boundaries.
Preserve upstream notices and the source provenance record.

- Keep board parsing, native IPC, file access, solvers and project persistence
  outside src. Depend on React/Three and typed display inputs only.
- Preserve source millimetres, board/revision binding, original samples, units,
  missing values and provenance. Display interpolation never creates solver data.
- Use one coordinate transform and pick contract across 2D and 3D. Keep viewer
  instances isolated and dispose owned GPU resources when replacing scenes.
- New modules should remain under 800 lines. The inherited engine composition
  modules are recorded extraction debt, not examples for new implementation.
- Run npm run check, then browser checks appropriate to the change at wide and
  narrow sizes. Test actual picking, visibility, invalid imports and recovery.
  Generated mockups are not evidence of runtime rendering.
- Keep source updates immutable. Do not regenerate engine files over edits or
  change the parent SPIKE application without a deliberate integration task.
- Numerical interpretation needs separate reference evidence and review; visual
  success cannot establish solver validity.
