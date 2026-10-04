# Building SPIKE

GitHub Actions builds the Windows x64 installer, Linux x86-64 Flatpak, and macOS
DMGs for Apple Silicon and Intel. Each platform builds on a runner with the
matching operating system and architecture. Linux builds use the GNOME 50
Flatpak runtime.

## Build all packages

Open **Actions → Build and release SPIKE → Run workflow**. Leave **Publish**
unchecked to build and test without creating a release. The four packages and
their SHA-256 files appear under that run's artifacts and are retained for
14 days.

From the command line:

```sh
gh workflow run release.yml --repo wayri/SPIKE --ref main
```

## Publish a new version

Set the new version in `app/package.json`, `app/package-lock.json`,
`app/src-tauri/tauri.conf.json`, `app/src-tauri/Cargo.toml`,
`python/spike_core/__init__.py`, and `CMakeLists.txt`. Commit the change, then
push a matching tag, for example:

```sh
git tag v0.3.5
git push origin main v0.3.5
```

Pushing a `v*` tag starts the complete build and publication chain. The tag must
match the application version. All four packages must pass before publication.
The workflow checks their hashes, uploads them to a draft release, then makes
the release visible. A failed upload leaves the draft unpublished, so the job
can be rerun. Published releases are not overwritten; use a new version for
different binaries.

For 0.3.5, the maintainer explicitly held Intel macOS. The pending Intel job
and automatic publication chain were canceled. The three successful platform
artifacts from the tagged commit were downloaded, checked against their SHA-256
files, and published separately. The release notes record this exception; the
default automated chain still requires all four platforms.

For a manual release, use **Run workflow**, check **Publish**, and enter the
matching version tag. A new tag is created at the selected commit if necessary.
An existing tag must point to that commit.

## What the chain checks

Version 0.3.7 is a Windows-only release. Run the standalone **Windows x64 package**
workflow at the release commit, then verify its installer and SHA-256 artifact
before publishing that exact commit as a prerelease. The all-platform helper
continues to require four packages; do not describe a Windows-only artifact set
as a complete all-platform build. Retain the 0.3.5 Linux and macOS downloads.

- Version consistency across the desktop, CLI, and native build.
- Frozen-worker health and existing numerical runtime checks.
- Every CLI command's help, version, board inspection, and structured errors.
- Windows silent installation and its installed CLI launcher.
- Flatpak installation and its installed CLI launcher.
- macOS app signing and CLI launcher.
- Desktop startup, reinstall, and removal on each platform.
- Linux CLI and desktop startup with network access disabled.
- A complete set of four packages with matching SHA-256 checksums.

Source checks also run on pull requests and code changes to `main`, covering
architecture rules, frontend compilation, the board parser, CLI forwarding,
errors, schemas, and release publication failure cases.

The current Windows installer is unsigned. macOS packages are ad-hoc signed
without Apple notarization. Linux and macOS outputs remain experimental.
Optional external engines are installed separately.

## Local builds

The GitHub workflows call the same checked-in scripts used for local builds:

- Windows: `scripts/build_windows_ci.ps1`, from an x64 MSVC development shell.
- Linux/macOS: `scripts/build_unix_release.sh`, then `scripts/package_unix_release.py`.

These scripts install build dependencies and prepare resources in a disposable
checkout. Staging emits a separate Tauri build configuration; bundling temporarily
installs it as the base configuration and restores the source afterward. Tauri's
`--config` merges resource maps and must not reintroduce the unstaged directories.
See [platform installation and CLI commands](PLATFORM_PACKAGES.md) for running
the finished packages.
