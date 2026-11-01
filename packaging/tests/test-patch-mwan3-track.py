import hashlib
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

MODULE = Path(__file__).parents[1] / 'patch-mwan3-track.py'

class PatchTests(unittest.TestCase):
    def patcher(self):
        spec = importlib.util.spec_from_file_location('track_patch', MODULE)
        mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
        return mod

    def source(self):
        return """#!/bin/sh
validate_track_method() {
\tcase "$1" in
\t\tping) return 0 ;;
\tesac
}
main() {
\ttrack_method=tollgate-http
\tvalidate_track_method $track_method || {
\t\ttrack_method=ping
\t}
\t\t\t\tcase "$track_method" in
\t\t\t\t\tping) exit 0 ;;
\t\t\t\tesac
}
main
"""

    def test_unknown_original_hash_is_rejected(self):
        with self.assertRaises(ValueError): self.patcher().patch(self.source(), '0' * 64)

    def test_patch_is_bounded_and_shell_syntax_valid(self):
        source = self.source(); result = self.patcher().patch(source, hashlib.sha256(source.encode()).hexdigest())
        self.assertIn('--interface "$INTERFACE" --target "$track_ip"', result)
        self.assertNotIn('WRAP /usr/libexec/tollgate/uplink-probe', result)
        self.assertEqual(subprocess.run(['sh', '-n'], input=result.encode()).returncode, 0)

    def test_missing_probe_fails_closed_instead_of_silently_using_ping(self):
        source = self.source(); result = self.patcher().patch(source, hashlib.sha256(source.encode()).hexdigest())
        result = 'LOG() { :; }\n' + result
        self.assertNotEqual(subprocess.run(['sh'], input=result.encode(), capture_output=True).returncode, 0)

    def test_incompatible_layout_and_double_patch_are_rejected(self):
        source = self.source(); mod = self.patcher()
        changed = source.replace('validate_track_method() {', 'different() {')
        with self.assertRaises(ValueError): mod.patch(changed, hashlib.sha256(changed.encode()).hexdigest())
        result = mod.patch(source, hashlib.sha256(source.encode()).hexdigest())
        with self.assertRaises(ValueError): mod.patch(result, hashlib.sha256(result.encode()).hexdigest())

if __name__ == '__main__': unittest.main()
