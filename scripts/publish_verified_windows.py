# SPDX-License-Identifier: Apache-2.0
"""Publish a reviewed Windows-only preview from a successful retained CI run."""
from pathlib import Path
import hashlib
import json
import os
import re
import subprocess


def command(*args):
    return subprocess.check_output(args, text=True).strip()


def verify_assets(folder: Path, version: str):
    name = f"SPIKE_{version}_x64-setup.exe"
    expected = {name, name + ".sha256"}
    if {p.name for p in folder.iterdir()} != expected:
        raise ValueError("Windows artifact must contain exactly the installer and checksum")
    digest = hashlib.sha256((folder / name).read_bytes()).hexdigest()
    fields = (folder / (name + ".sha256")).read_text().strip().split()
    if fields != [digest, name]:
        raise ValueError("Installer checksum or checksum filename mismatch")
    return name, digest


def main():
    run_id = os.environ["VERIFIED_WINDOWS_RUN"]
    commit = os.environ["REVIEWED_RELEASE_COMMIT"]
    repo = os.environ["GITHUB_REPOSITORY"]
    if not re.fullmatch(r"[0-9]+", run_id) or not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("Invalid build run or reviewed commit")
    run = json.loads(command("gh", "api", f"repos/{repo}/actions/runs/{run_id}"))
    if run["conclusion"] != "success" or run["head_sha"] != commit or run["path"] != ".github/workflows/windows-release.yml":
        raise ValueError("Selected run is not the successful Windows build of the reviewed commit")
    version = json.loads(command("git", "show", f"{commit}:app/package.json"))["version"]
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
        raise ValueError("Invalid release version")
    folder = Path("dist-release")
    name, digest = verify_assets(folder, version)
    tag = "v" + version
    notes = Path("release-notes.md")
    notes.write_text(command("git", "show", f"{commit}:docs/releases/{tag}.md") + "\n")
    existing = subprocess.run(["gh", "release", "view", tag, "--repo", repo], capture_output=True)
    if existing.returncode == 0:
        raise ValueError("Release already exists; refusing to replace or overwrite its assets")
    command("gh", "release", "create", tag, str(folder / name), str(folder / (name + ".sha256")),
            "--repo", repo, "--target", commit, "--draft", "--prerelease",
            "--title", f"SPIKE {version} - Windows community preview", "--notes-file", str(notes))
    release = json.loads(command("gh", "api", f"repos/{repo}/releases/tags/{tag}"))
    assets = {asset["name"]: asset for asset in release["assets"]}
    if set(assets) != {name, name + ".sha256"} or assets[name].get("digest") != "sha256:" + digest:
        raise ValueError("Uploaded assets did not match the verified installer; release remains draft")
    command("gh", "release", "edit", tag, "--repo", repo, "--draft=false", "--prerelease")
    print(json.dumps({"tag": tag, "source_commit": commit, "windows_run": run_id, "sha256": digest}))


if __name__ == "__main__":
    main()
