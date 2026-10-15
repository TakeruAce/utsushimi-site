#!/usr/bin/env python3
"""Validate a static Astro build without third-party Python packages."""
import argparse
from collections import Counter
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import unquote, urljoin, urlsplit


class Page(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.ids = []
        self.references = []
        self.aria = []
        self.scripts = []
        self.script = None
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get('id'):
            self.ids.append(attrs['id'])
        for name in ('href', 'src', 'poster'):
            if attrs.get(name):
                self.references.append((name, attrs[name]))
        for candidate in attrs.get('srcset', '').split(','):
            if candidate.strip():
                self.references.append(('srcset', candidate.strip().split()[0]))
        for name in ('aria-labelledby', 'aria-describedby', 'aria-controls'):
            self.aria.extend(attrs.get(name, '').split())
        if tag == 'script' and not attrs.get('src') and attrs.get('type', '') in ('', 'module', 'text/javascript', 'application/javascript'):
            self.script = []

    def handle_data(self, data):
        if self.script is not None:
            self.script.append(data)

    def handle_endtag(self, tag):
        if tag == 'script' and self.script is not None:
            self.scripts.append(''.join(self.script))
            self.script = None


def check(root):
    root = root.resolve()
    pages = {path: Page(path.read_text()) for path in sorted(root.rglob('*.html'))}
    errors = []
    counts = dict(pages=len(pages), htmlReferences=0, anchors=0, ariaReferences=0, cssReferences=0, javascript=0)
    if not pages:
        errors.append('No HTML pages; run the build first.')

    def resolve(url, source):
        parsed = urlsplit(url)
        if parsed.scheme or parsed.netloc:
            return None
        source_url = '/' + source.relative_to(root).as_posix()
        path = root / unquote(urlsplit(urljoin(source_url, url)).path).lstrip('/')
        if path.is_dir():
            path /= 'index.html'
        elif not path.suffix and (path / 'index.html').exists():
            path /= 'index.html'
        return path, unquote(parsed.fragment)

    def reference(url, source, html=False):
        resolved = resolve(url, source)
        if resolved is None:
            return
        path, fragment = resolved
        if not path.is_file():
            errors.append(f'{source.relative_to(root)}: missing {url}')
        elif html and fragment and path in pages:
            counts['anchors'] += 1
            if fragment not in pages[path].ids:
                errors.append(f'{source.relative_to(root)}: missing anchor {url}')

    def javascript(code, label):
        result = subprocess.run(['node', '--check', '--input-type=module'], input=code, text=True, capture_output=True)
        counts['javascript'] += 1
        if result.returncode:
            errors.append(f'{label}: {result.stderr.strip()}')

    for path, page in pages.items():
        for ident, count in Counter(page.ids).items():
            if count > 1:
                errors.append(f'{path.relative_to(root)}: duplicate id {ident}')
        for _, url in page.references:
            if resolve(url, path) is not None:
                counts['htmlReferences'] += 1
            reference(url, path, html=True)
        for ident in page.aria:
            counts['ariaReferences'] += 1
            if ident not in page.ids:
                errors.append(f'{path.relative_to(root)}: missing ARIA target {ident}')
        for index, code in enumerate(page.scripts):
            javascript(code, f'{path.relative_to(root)} inline script {index + 1}')
    for path in sorted(root.rglob('*.css')):
        for url in re.findall(r'url\(\s*[\'\"]?([^\)\'\"]+)', path.read_text()):
            if resolve(url.strip(), path) is not None:
                counts['cssReferences'] += 1
            reference(url.strip(), path)
    for path in sorted(root.rglob('*.js')):
        javascript(path.read_text(), path.relative_to(root))
    return dict(**counts, errors=errors, passed=not errors)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', nargs='?', default='dist')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    report = check(Path(args.directory))
    output = json.dumps(report, ensure_ascii=False, indent=2) + '\n'
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(output)
    print(output, end='')
    raise SystemExit(0 if report['passed'] else 1)
