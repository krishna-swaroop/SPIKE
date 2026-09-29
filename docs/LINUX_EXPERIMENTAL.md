# Experimental Linux package

An experimental Debian package for Ubuntu 24.04 on x86-64 is being tested.
The Linux package is not attached
to the release yet. The build contains the SPIKE desktop app and a frozen local
Python worker.

The package was built on Ubuntu 24.04 under WSL2. Its extracted worker passed
SPIKE's packaged-worker checks and answered a health request, and the Debian
package installed successfully in that test environment. The desktop was
launched briefly under WSLg;
that session reported graphics-driver warnings. A full GUI analysis run on a
physical Linux desktop has not been checked. Older distributions and other CPU
architectures have not been tested.

Optional solver engines such as EMerge, openEMS, ngspice, and OpenFOAM are
separate installations. The tested package does not download or include them. See the
[solver status](SOLVER_STATUS.md) for the current analysis limits.
