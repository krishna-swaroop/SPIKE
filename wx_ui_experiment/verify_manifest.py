"""Static parity checks for the generated local UI snapshot."""

from __future__ import annotations

import json
import hashlib
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent
manifest = json.loads((ROOT / "ui_manifest.json").read_text(encoding="utf-8"))
source = (ROOT.parent / manifest["reference"]).read_bytes().decode("utf-8")


def between(start: str, end: str) -> str:
    first = source.index(start)
    return source[first:source.index(end, first + len(start))]


tab_source = between("const tabs:", "const initialLayers:")
ribbon_source = between("const ribbonContent = (() => {", "const universalSearchItems")
menu_source = between('<nav className="menu-bar"', "</nav>")
digest = hashlib.sha256((tab_source + ribbon_source + menu_source).encode("utf-8")).hexdigest()
assert manifest.get("sourceDigest") == digest, "Tauri ribbon/menu source changed; run node extract_ui.mjs"
expected_tabs = re.findall(r'\{ name: "([^"]+)", icon: (\w+) \}', tab_source)
assert [(tab["tab"], tab["icon"]) for tab in manifest["tabs"]] == expected_tabs
expected_menus = re.findall(r'<MenuButton label=(?:\{tr\("([^"]+)"\)\}|"([^"]+)")', menu_source)
assert [menu["label"] for menu in manifest["menus"]] == [a or b for a, b in expected_menus]
assert len(manifest["boardView"]) == 9
for tab in manifest["tabs"]:
    assert tab["groups"], tab["tab"]
    assert all(group["tools"] or group.get("dynamic") for group in tab["groups"]), tab["tab"]
static_tools = set(re.findall(r'<Tool\b[^>]*?label="([^"]+)"', ribbon_source))
captured_tools = {tool["label"] for tab in manifest["tabs"] for group in tab["groups"] for tool in group["tools"]}
missing_tools = static_tools - captured_tools
assert not missing_tools, f"Static ribbon commands missing from snapshot: {sorted(missing_tools)}"
commands = [tool for tab in manifest["tabs"] for group in tab["groups"] for tool in group["tools"]]
commands += [item for menu in manifest["menus"] for item in menu["items"]]
ids = [command.get("id") for command in commands]
assert all(ids) and len(ids) == len(set(ids)), "Commands require unique stable IDs"
synthetic = {"menu/view/minimize-command-ribbon", "menu/view/show-net-names"}
assert all(command.get("handler") or command["id"] in synthetic for command in commands), "Missing Tauri command handler"
icons = {tab["icon"] for tab in manifest["tabs"]}
icons.update(action["icon"] for action in manifest["boardView"])
icons.update(action["icon"] for tab in manifest["tabs"] for group in tab["groups"] for action in group["tools"])
icons.update(action["icon"] for menu in manifest["menus"] for action in menu["items"])
icons.update(("Search", "Bell", "CircleHelp"))
missing = sorted(icon for icon in icons if not (ROOT / "assets" / "icons" / f"{icon}.svg").is_file())
assert not missing, f"Missing Lucide icons: {missing}"
for source in (ROOT / "CMakeLists.txt", *ROOT.glob("src/*.cpp"), *ROOT.glob("include/*.hpp")):
    assert "wx_desktop" not in source.read_text(encoding="utf-8"), source
print(f"Manifest verified: {len(manifest['tabs'])} tabs, {len(manifest['menus'])} menus, {len(commands)} commands, {len(icons)} chrome icons")
