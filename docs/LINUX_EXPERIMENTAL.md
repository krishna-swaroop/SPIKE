# Experimental Linux package

SPIKE 0.3.0 is available as an x86-64 Flatpak. It includes the desktop app,
a frozen Python worker, native kernels, and the full command-line interface.

See [installation and CLI commands](PLATFORM_PACKAGES.md#linux-flatpak).

The package was built and installed on Ubuntu 24.04 in CI. The bundled worker,
CLI command surface, board inspection, error output, and desktop startup were
checked. A full interactive analysis session on a physical Linux desktop has
not been tested.

Optional engines such as EMerge, openEMS, ngspice, and OpenFOAM are separate
installations. Host executables are not automatically available inside the
Flatpak sandbox. See the [solver status](SOLVER_STATUS.md) for analysis limits.
