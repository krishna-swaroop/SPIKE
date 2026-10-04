"""Regression guards for the Windows preview packaging boundary.

These source-contract checks supplement, not replace, native application launch
acceptance: Tauri interprets absolute Windows drive paths as frontend URLs.
"""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


class WindowsInstallerScriptTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.script = (ROOT / "scripts/build_windows_installer.ps1").read_text(encoding="utf-8-sig")

    def test_frontend_snapshot_is_a_relative_path_not_a_drive_url(self):
        self.assertIn('$snapshotRelativePath = "../../build/frontend-snapshots/', self.script)
        self.assertIn('frontendDist = $snapshotRelativePath', self.script)
        self.assertNotIn('frontendDist = $frontendSnapshot }', self.script)

    def test_native_ui_build_does_not_generate_installers(self):
        self.assertIn('[switch]$BuildOnly', self.script)
        self.assertIn('$previewBuildArguments += "--no-bundle"', self.script)
        self.assertLess(self.script.index('No installer was generated.'), self.script.index('$bundleRoot ='))
        self.assertIn('BuildOnly is for preview native-UI verification', self.script)

    def test_competing_build_is_rejected_and_mutex_is_released(self):
        self.assertIn('$buildMutex.WaitOne(0)', self.script)
        self.assertIn('Another SPIKE installer build owns this checkout', self.script)
        self.assertIn('catch [System.Threading.AbandonedMutexException]', self.script)
        # Configuration restoration may precede mutex release in the cleanup
        # block. Both must remain in finally, with disposal after release.
        cleanup = self.script[self.script.rindex('\nfinally {'):]
        self.assertIn('if ($ownsBuildMutex) { $buildMutex.ReleaseMutex() }', cleanup)
        self.assertLess(cleanup.index('$buildMutex.ReleaseMutex()'), cleanup.index('$buildMutex.Dispose()'))

    def test_default_staging_follows_worker_build(self):
        stage = self.script.index('"scripts/prepare_release_resources.py"')
        self.assertLess(self.script.index('"scripts/build_packaged_worker.py"'), stage)
        self.assertLess(stage, self.script.index('Copy-Item -LiteralPath $ResourceConfig'))
        self.assertIn('if (-not $ResourceConfig)', self.script)

    def test_ci_bundler_replaces_resource_map_and_restores_source_bytes(self):
        script = (ROOT / 'scripts/build_windows_ci.ps1').read_text(encoding='utf-8-sig')
        stage = script.index('"scripts/prepare_release_resources.py"')
        replace = script.index('Copy-Item -LiteralPath (Join-Path $root "build\\tauri.release.json")')
        bundle = script.index('@("run", "tauri", "build", "--", "--bundles", "nsis")')
        restore = script.index('[System.IO.File]::WriteAllBytes($tauriConfig, $sourceConfigBytes)')
        self.assertLess(stage, replace)
        self.assertLess(replace, bundle)
        self.assertLess(bundle, restore)
        self.assertIn('finally {', script[bundle:restore])
        self.assertNotIn('"--config", "../build/tauri.release.json"', script)


if __name__ == "__main__":
    unittest.main()
