# Security reports

Do not post a credential, private board, or exploit details in a public issue.
Until the standalone repository has a designated private contact, use GitHub's
private vulnerability reporting feature if the repository owner enables it.
Otherwise contact the repository owner through an existing private channel.

The workbench reads user-selected KiCad, STEP, and JSON files and can launch a
configured SPIKE worker and KiCad CLI. Review paths and project provenance
before opening files from an untrusted source. Report the workbench version,
FreeCAD version, affected contract, a minimal non-sensitive reproducer, and
whether a worker or external engine was involved.

The SPIKE worker, KiCad, FreeCAD, and external solvers have separate security
and update processes. Report issues in those applications to their respective
maintainers when the workbench is not the affected component.
