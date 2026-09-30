# SPDX-License-Identifier: Apache-2.0
"""Stage tracked release resources without local caches or machine paths."""
import json
from pathlib import Path
import shutil
import subprocess

root = Path(__file__).resolve().parents[1]
tracked = set(subprocess.check_output(['git', 'ls-files'], cwd=root, text=True).splitlines())
config_path = root / 'app/src-tauri/tauri.conf.json'
config = json.loads(config_path.read_text())
stage = root / 'build/unix-resources'
stage.mkdir(parents=True, exist_ok=True)
for src, dst in config['bundle']['resources'].items():
    source = (config_path.parent / src).resolve()
    if source == root / 'app/src-tauri/resources/worker':
        shutil.copytree(source, stage / dst, symlinks=True, dirs_exist_ok=True)
        continue
    files = source.rglob('*') if source.is_dir() else [source]
    for file in files:
        if not file.is_file() or '__pycache__' in file.parts or file.suffix in {'.pyc', '.pyo'}:
            continue
        generated_worker = source == root / 'app/src-tauri/resources/worker'
        if not generated_worker and file.relative_to(root).as_posix() not in tracked:
            continue
        target = stage / dst / file.relative_to(source) if source.is_dir() else stage / dst
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(file, target)
config['bundle']['resources'] = {'../../build/unix-resources/': './'}
config['bundle']['macOS'] = {'minimumSystemVersion': '14.0', 'signingIdentity': '-'}
# Supply a complete configuration so original resource mappings cannot be merged back.
config_path.write_text(json.dumps(config, indent=2) + '\n')
(root / 'build/tauri-unix.json').write_text('{}\n')
