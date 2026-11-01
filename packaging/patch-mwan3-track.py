#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-only
"""Add a fixed, fail-closed probe method to a reviewed mwan3 2.12 tracker.

Runs on the build/deployment host, never through an admin-supplied path. The
original hash is mandatory: a package upgrade requires fresh source review.
"""
import argparse
import hashlib
from pathlib import Path
import subprocess

MARKER = '# TollGate bound DNS/HTTP tracker extension v1'


def patch(source: str, expected_sha256: str) -> str:
    if hashlib.sha256(source.encode()).hexdigest() != expected_sha256:
        raise ValueError('Original tracker hash differs from the reviewed input')
    if MARKER in source:
        raise ValueError('Tracker is already extended; verify the installed hash')
    changes = [
        ('validate_track_method() {\n\tcase "$1" in\n',
         'validate_track_method() {\n\tcase "$1" in\n'
         '\t\ttollgate-http)\n'
         '\t\t\t[ -x /usr/libexec/tollgate/uplink-probe ] || return 1\n'
         '\t\t\t;;\n'),
        ('\tvalidate_track_method $track_method || {\n',
         '\tvalidate_track_method $track_method || {\n'
         '\t\tif [ "$track_method" = tollgate-http ]; then\n'
         '\t\t\tLOG err "TollGate HTTP probe missing; refusing weaker tracking"\n'
         '\t\t\texit 1\n'
         '\t\tfi\n'),
        ('\t\t\t\tcase "$track_method" in\n',
         '\t\t\t\tcase "$track_method" in\n'
         '\t\t\t\t\ttollgate-http)\n'
         '\t\t\t\t\t\t/usr/libexec/tollgate/uplink-probe --interface "$INTERFACE" --target "$track_ip" >/dev/null 2>&1 &\n'
         '\t\t\t\t\t\twait $!\n'
         '\t\t\t\t\t\tresult=$?\n'
         '\t\t\t\t\t\t;;\n'),
    ]
    for before, after in changes:
        if source.count(before) != 1:
            raise ValueError('Unsupported tracker layout; review the package upgrade')
        source = source.replace(before, after, 1)
    return source.replace('#!/bin/sh\n', '#!/bin/sh\n' + MARKER + '\n', 1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--expect-sha256', required=True)
    args = parser.parse_args()
    result = patch(args.source.read_text(), args.expect_sha256)
    subprocess.run(['sh', '-n'], input=result.encode(), check=True)
    args.output.write_text(result)
    print(hashlib.sha256(result.encode()).hexdigest())


if __name__ == '__main__':
    main()
