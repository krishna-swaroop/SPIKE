# SPDX-License-Identifier: Apache-2.0
"""Indexed, offline discovery and conservative resolution of 3D model assets.

The index stores paths and file metadata only.  Model data remains in its
source library and is never copied into SPIKE's cache.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any, Iterable


INDEX_VERSION = 1
MODEL_SUFFIXES = {".step", ".stp", ".wrl", ".vrml", ".glb", ".gltf"}
MAX_INDEX_ENTRIES = 1_000_000
_DISCOVERY_CACHE: tuple[tuple[tuple[str, str], ...], list[Path], str] | None = None


def _index_path() -> Path:
    override = os.environ.get("SPIKE_MODEL_INDEX_PATH")
    if override:
        return Path(override).expanduser()
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Roaming")))
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Caches"
    else:
        base = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache"))
    return base / "SPIKE" / "model-library-v1.sqlite3"


def _connect() -> sqlite3.Connection:
    path = _index_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=20)
    connection.row_factory = sqlite3.Row
    connection.executescript(
        """
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS roots (
          root TEXT PRIMARY KEY, priority INTEGER NOT NULL, mtime_ns INTEGER NOT NULL,
          indexed_at REAL NOT NULL, file_count INTEGER NOT NULL, truncated INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS assets (
          root TEXT NOT NULL, relative_path TEXT NOT NULL, relative_lower TEXT NOT NULL,
          name TEXT NOT NULL, name_lower TEXT NOT NULL, format TEXT NOT NULL,
          size INTEGER NOT NULL, mtime_ns INTEGER NOT NULL,
          PRIMARY KEY(root, relative_path)
        );
        CREATE INDEX IF NOT EXISTS assets_name ON assets(name_lower);
        CREATE INDEX IF NOT EXISTS assets_relative ON assets(relative_lower);
        CREATE TABLE IF NOT EXISTS aliases (
          alias_key TEXT PRIMARY KEY, reference TEXT NOT NULL, footprint TEXT NOT NULL,
          path TEXT NOT NULL, sha256 TEXT NOT NULL, registered_at REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS configured_roots (
          root TEXT PRIMARY KEY, added_at REAL NOT NULL
        );
        """
    )
    version = connection.execute("SELECT value FROM metadata WHERE key='version'").fetchone()
    if version is None:
        connection.execute("INSERT INTO metadata(key,value) VALUES('version',?)", (str(INDEX_VERSION),))
    elif version[0] != str(INDEX_VERSION):
        connection.execute("DELETE FROM assets")
        connection.execute("DELETE FROM roots")
        connection.execute("UPDATE metadata SET value=? WHERE key='version'", (str(INDEX_VERSION),))
    connection.commit()
    return connection


def _roots(additional_roots: Iterable[str | Path], connection: sqlite3.Connection | None = None,
           refresh_discovery: bool = False) -> list[Path]:
    # Lazy import avoids a models -> model_library -> models import cycle while
    # retaining the existing environment and installed-KiCad discovery policy.
    from . import models as models_module

    persisted = [] if connection is None else [row[0] for row in connection.execute(
        "SELECT root FROM configured_roots ORDER BY added_at,root")]
    fingerprint = tuple(sorted((key, value) for key, value in os.environ.items()
                               if key.upper() in {"PATH", "SPIKE_MODEL_LIBRARY", "SPIKE_KICAD_CLI"}
                               or re.fullmatch(r"KICAD\d+_(?:3DMODEL_DIR|3RD_PARTY)", key, re.I)))
    global _DISCOVERY_CACHE
    if refresh_discovery or _DISCOVERY_CACHE is None or _DISCOVERY_CACHE[0] != fingerprint:
        capability = models_module.kicad_scene_capabilities()
        _DISCOVERY_CACHE = (fingerprint, list(models_module.model_library_roots(())),
                            str(capability.get("path", "")))
    candidates = [*_DISCOVERY_CACHE[1], *[Path(item) for item in additional_roots],
                  *[Path(item) for item in persisted]]
    module_root = Path(__file__).resolve().parents[2]
    known = [
        module_root / "3dmodels",
        module_root.parent / "3dmodels",
    ]
    if _DISCOVERY_CACHE[2]:
        cli = Path(_DISCOVERY_CACHE[2]).expanduser()
        known.append(cli.parent.parent / "share" / "kicad" / "3dmodels")
    seen: set[str] = set()
    result: list[Path] = []
    for item in [*candidates, *known]:
        try:
            resolved = item.resolve()
        except OSError:
            continue
        key = os.path.normcase(str(resolved))
        if key not in seen and resolved.is_dir():
            seen.add(key)
            result.append(resolved)
    return result


def _root_mtime(root: Path) -> int:
    try:
        return root.stat().st_mtime_ns
    except OSError:
        return -1


def _stale(connection: sqlite3.Connection, roots: list[Path]) -> list[Path]:
    records = {row["root"]: row for row in connection.execute("SELECT * FROM roots")}
    return [root for root in roots if str(root) not in records or
            records[str(root)]["mtime_ns"] != _root_mtime(root)]


def _scan_root(root: Path):
    root_resolved = root.resolve()
    count = 0
    for current, directories, filenames in os.walk(root_resolved, followlinks=False):
        current_path = Path(current)
        # Symlinked directories are excluded even on platforms where os.walk
        # would otherwise expose them in the directory list.
        directories[:] = [name for name in directories if not (current_path / name).is_symlink()]
        for filename in filenames:
            path = current_path / filename
            if path.suffix.lower() not in MODEL_SUFFIXES or path.is_symlink():
                continue
            try:
                resolved = path.resolve()
                resolved.relative_to(root_resolved)
                stat = resolved.stat()
                relative = resolved.relative_to(root_resolved).as_posix()
            except (OSError, ValueError):
                continue
            yield (str(root_resolved), relative, relative.casefold(), resolved.stem,
                   resolved.stem.casefold(), resolved.suffix.lower().lstrip("."),
                   stat.st_size, stat.st_mtime_ns)
            count += 1
            if count >= MAX_INDEX_ENTRIES:
                return


def _refresh(connection: sqlite3.Connection, roots: list[Path], all_roots: list[Path]) -> None:
    connection.execute("BEGIN IMMEDIATE")
    try:
        priorities = {str(root): priority for priority, root in enumerate(all_roots)}
        for root in roots:
            priority = priorities[str(root)]
            root_text = str(root)
            connection.execute("DELETE FROM assets WHERE root=?", (root_text,))
            count = 0
            batch = []
            for row in _scan_root(root):
                batch.append(row)
                count += 1
                if len(batch) == 1000:
                    connection.executemany(
                        "INSERT INTO assets(root,relative_path,relative_lower,name,name_lower,format,size,mtime_ns) "
                        "VALUES(?,?,?,?,?,?,?,?)", batch,
                    )
                    batch.clear()
            if batch:
                connection.executemany(
                    "INSERT INTO assets(root,relative_path,relative_lower,name,name_lower,format,size,mtime_ns) "
                    "VALUES(?,?,?,?,?,?,?,?)", batch,
                )
            connection.execute(
                "INSERT OR REPLACE INTO roots(root,priority,mtime_ns,indexed_at,file_count,truncated) "
                "VALUES(?,?,?,?,?,?)",
                (root_text, priority, _root_mtime(root), time.time(), count,
                 int(count >= MAX_INDEX_ENTRIES)),
            )
        connection.commit()
    except Exception:
        connection.rollback()
        raise


def _ensure(refresh: bool, additional_roots: Iterable[str | Path]) -> tuple[sqlite3.Connection, list[Path], bool]:
    connection = _connect()
    roots = _roots(additional_roots, connection, refresh_discovery=refresh)
    stale_roots = _stale(connection, roots)
    stale = bool(stale_roots)
    if refresh or stale:
        _refresh(connection, roots if refresh else stale_roots, roots)
        stale = False
    connection.execute("CREATE TEMP TABLE IF NOT EXISTS active_roots(root TEXT PRIMARY KEY, priority INTEGER NOT NULL)")
    connection.execute("DELETE FROM active_roots")
    connection.executemany("INSERT INTO active_roots(root,priority) VALUES(?,?)",
                           ((str(root), priority) for priority, root in enumerate(roots)))
    return connection, roots, stale


def add_library_root(path: str | Path) -> dict[str, Any]:
    """Persist a validated source library root for future discovery."""
    candidate = Path(path).expanduser().resolve()
    if not candidate.is_dir():
        raise ValueError("model library root must be an existing directory")
    connection = _connect()
    try:
        connection.execute("INSERT OR IGNORE INTO configured_roots(root,added_at) VALUES(?,?)",
                           (str(candidate), time.time()))
        connection.commit()
    finally:
        connection.close()
    # Refresh now so callers can search the root immediately.
    status = library_status(refresh=True)
    return {"path": str(candidate), "added": True, "status": status}


def library_status(refresh: bool = False, additional_roots: Iterable[str | Path] = ()) -> dict[str, Any]:
    """Return index health and counts, refreshing stale roots when necessary."""
    connection, roots, stale = _ensure(refresh, additional_roots)
    try:
        records = connection.execute(
            "SELECT r.root,x.priority,r.mtime_ns,r.indexed_at,r.file_count,r.truncated "
            "FROM roots r JOIN active_roots x ON x.root=r.root ORDER BY x.priority"
        ).fetchall()
        return {
            "index_path": str(_index_path()), "version": INDEX_VERSION, "stale": stale,
            "asset_count": sum(row["file_count"] for row in records),
            "truncated": any(row["truncated"] for row in records),
            "roots": [dict(row) for row in records],
        }
    finally:
        connection.close()


def _entry(row: sqlite3.Row, reason: str = "search", confidence: float = 0.5,
           exact: bool = False) -> dict[str, Any]:
    return {
        "path": str(Path(row["root"]) / Path(row["relative_path"])),
        "name": row["name"], "format": row["format"], "root": row["root"],
        "relative_path": row["relative_path"], "reason": reason,
        "confidence": confidence, "exact": exact,
    }


def search_library(query: str = "", limit: int = 200,
                   additional_roots: Iterable[str | Path] = ()) -> dict[str, Any]:
    """Search indexed metadata without rescanning library subtrees."""
    connection, roots, _ = _ensure(False, additional_roots)
    bounded = max(1, min(int(limit), 1000))
    term = query.strip().casefold()
    try:
        params: list[Any] = []
        where = ""
        if term:
            escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            where = "WHERE a.name_lower LIKE ? ESCAPE '\\' OR a.relative_lower LIKE ? ESCAPE '\\'"
            params.extend([f"%{escaped}%", f"%{escaped}%"])
        rows = connection.execute(
            f"SELECT a.*,x.priority FROM assets a JOIN active_roots x ON x.root=a.root {where} "
            "ORDER BY CASE WHEN a.name_lower=? THEN 0 WHEN a.name_lower LIKE ? THEN 1 ELSE 2 END, "
            "x.priority,a.relative_lower LIMIT ?",
            [*params, term, f"{term}%", bounded + 1],
        ).fetchall()
        entries = [_entry(row, "name or relative path search", 0.55, False) for row in rows[:bounded]]
        return {"query": query, "entries": entries, "truncated": len(rows) > bounded,
                "indexed_roots": len(roots)}
    finally:
        connection.close()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _alias_key(reference: str, footprint: str) -> str:
    return json.dumps([reference.strip(), footprint.strip()], separators=(",", ":"))


def register_alias(reference: str = "", footprint: str = "", path: str | Path = "",
                   *, confirmed: bool = False) -> dict[str, Any]:
    """Persist a user-confirmed exact mapping, pinned to the asset's SHA-256."""
    if not confirmed:
        raise ValueError("alias registration requires explicit user confirmation")
    candidate = Path(path).expanduser().resolve()
    if not reference.strip() and not footprint.strip():
        raise ValueError("an alias requires a reference or footprint")
    if not candidate.is_file() or candidate.suffix.lower() not in MODEL_SUFFIXES:
        raise ValueError("alias target must be an existing supported model file")
    sha = _sha256(candidate)
    connection = _connect()
    try:
        connection.execute(
            "INSERT OR REPLACE INTO aliases(alias_key,reference,footprint,path,sha256,registered_at) "
            "VALUES(?,?,?,?,?,?)",
            (_alias_key(reference, footprint), reference.strip(), footprint.strip(), str(candidate), sha, time.time()),
        )
        connection.commit()
    finally:
        connection.close()
    return {"reference": reference.strip(), "footprint": footprint.strip(),
            "path": str(candidate), "sha256": sha, "confirmed": True}


def _normalized_relative(reference: str) -> str | None:
    value = reference.strip().replace("\\", "/")
    value = re.sub(r"^\$\{(?:KICAD\d+_3DMODEL_DIR|KICAD3DMOD)\}/", "", value, flags=re.I)
    if not value or Path(value).is_absolute() or value.startswith("../") or "/../" in value:
        return None
    return value.lstrip("./")


def resolve_model(reference: str = "", footprint: str = "",
                  additional_roots: Iterable[str | Path] = ()) -> dict[str, Any]:
    """Resolve only verified exact identities; fuzzy results remain candidates."""
    connection, _, _ = _ensure(False, additional_roots)
    candidates: list[dict[str, Any]] = []
    automatic_path: str | None = None
    status = "unresolved"
    try:
        original = Path(reference).expanduser() if reference.strip() else None
        if original is not None and original.is_absolute() and original.is_file() and original.suffix.lower() in MODEL_SUFFIXES:
            resolved = original.resolve()
            candidates.append({"path": str(resolved), "name": resolved.stem,
                "format": resolved.suffix.lower().lstrip("."), "root": "original",
                "relative_path": resolved.name, "reason": "existing original path",
                "confidence": 1.0, "exact": True})
            return {"reference": reference, "footprint": footprint, "status": "resolved_original",
                    "automatic_path": str(resolved), "candidates": candidates}
        alias = connection.execute("SELECT * FROM aliases WHERE alias_key=?",
                                   (_alias_key(reference, footprint),)).fetchone()
        if alias is None and footprint.strip():
            alias = connection.execute("SELECT * FROM aliases WHERE alias_key=?",
                                       (_alias_key("", footprint),)).fetchone()
        if alias:
            alias_path = Path(alias["path"])
            if alias_path.is_file() and _sha256(alias_path) == alias["sha256"]:
                automatic_path, status = str(alias_path), "alias"
                candidates.append({"path": str(alias_path), "name": alias_path.stem,
                    "format": alias_path.suffix.lower().lstrip("."), "root": "user-alias",
                    "relative_path": alias_path.name, "reason": "user-confirmed alias",
                    "confidence": 1.0, "exact": True})
                return {"reference": reference, "footprint": footprint, "status": status,
                        "automatic_path": automatic_path, "candidates": candidates}
            return {"reference": reference, "footprint": footprint, "status": "alias_changed",
                    "automatic_path": None, "candidates": []}

        relative = _normalized_relative(reference)
        identities: list[tuple[str, str]] = []
        if relative and Path(relative).suffix.lower() in MODEL_SUFFIXES:
            identities.append((relative, "exact model relative path"))
            # KiCad's standard libraries ship STEP counterparts for legacy
            # VRML references. Retain the complete package/path identity and
            # prefer an existing explicitly requested representation first.
            if Path(relative).suffix.lower() in {".wrl", ".vrml"} and re.match(
                r"^\$\{(?:KICAD\d+_3DMODEL_DIR|KICAD3DMOD)\}/",
                reference.replace("\\", "/"), re.I,
            ):
                for extension in (".step", ".stp"):
                    identities.append((Path(relative).with_suffix(extension).as_posix(),
                                       "exact standard KiCad model STEP counterpart"))
        footprint_match = re.fullmatch(r"([^:]+):([^:]+)", footprint.strip())
        if footprint_match:
            library, name = footprint_match.groups()
            for extension in ("step", "stp", "wrl"):
                identities.append((f"{library}.3dshapes/{name}.{extension}",
                                   "exact standard KiCad footprint identity"))

        exact_rows: list[tuple[sqlite3.Row, str]] = []
        chosen_rows: list[tuple[sqlite3.Row, str]] = []
        for identity, reason in identities:
            rows = connection.execute(
                "SELECT a.*,x.priority FROM assets a JOIN active_roots x ON x.root=a.root "
                "WHERE a.relative_lower=? ORDER BY x.priority", (identity.casefold(),),
            ).fetchall()
            identity_rows = [(row, reason) for row in rows]
            exact_rows.extend(identity_rows)
            if identity_rows and not chosen_rows:
                chosen_rows = identity_rows
        seen_paths: set[tuple[str, str]] = set()
        unique_rows: list[tuple[sqlite3.Row, str]] = []
        for row, reason in exact_rows:
            key = (row["root"], row["relative_path"])
            if key not in seen_paths:
                seen_paths.add(key)
                unique_rows.append((row, reason))
        exact_rows = unique_rows
        candidates.extend(_entry(row, reason, 1.0, True) for row, reason in exact_rows)
        if chosen_rows:
            hashes = {_sha256(Path(row["root"]) / row["relative_path"]) for row, _ in chosen_rows}
            if len(hashes) == 1:
                automatic_path = str(Path(chosen_rows[0][0]["root"]) / chosen_rows[0][0]["relative_path"])
                status = "resolved_exact"
            else:
                status = "ambiguous_exact"
        elif relative:
            basename = Path(relative).stem.casefold()
            rows = connection.execute(
                "SELECT a.*,x.priority FROM assets a JOIN active_roots x ON x.root=a.root "
                "WHERE a.name_lower=? ORDER BY x.priority,a.relative_lower LIMIT 200", (basename,),
            ).fetchall()
            candidates.extend(_entry(row, "same basename; manual selection required", 0.65, False)
                              for row in rows)
            if candidates and status == "unresolved":
                status = "candidates"
        if reference.strip() and not candidates and status == "unresolved":
            original = Path(reference).expanduser()
            status = "original_not_found" if original.is_absolute() else "unresolved"
        return {"reference": reference, "footprint": footprint, "status": status,
                "automatic_path": automatic_path, "candidates": candidates}
    finally:
        connection.close()
