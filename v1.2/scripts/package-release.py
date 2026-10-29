"""Package only approved deliverables and verify the browser report and ZIP."""
import hashlib
import json
from html.parser import HTMLParser
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT.parent / 'releases'
NAME = 'financial-human-model-1.2-guided'
TOP_FILES = (
    'index.html', 'styles.css', 'app.offline.js', 'browser-check.html',
    'package.json', 'LICENSE', 'README.txt', 'HANDOFF.txt', 'CHANGELOG.txt',
    'MODEL_SPEC.txt', 'MODEL_SPEC_1.0.txt', 'SLEEP_MODEL.txt', 'SLEEP_DIARY.txt', 'LANGUAGE_RESEARCH.txt', 'model-definition.json', 'VALIDATION.txt', 'UI_REVIEW.txt',
)
FOLDERS = {'src': {'.js'}, 'test': {'.mjs', '.js'}, 'scripts': {'.mjs', '.py'},
           'examples': {'.json'}, 'qa': {'.json', '.tap', '.png'}}


def sha(data):
    return hashlib.sha256(data).hexdigest()


report = json.loads((ROOT / 'qa/browser-report.json').read_text())
checks = report['checks']
assert report['version'] == '1.2.0' and report['passed'] is True
assert not report['errors'] and len(checks) == 120 and all(c['pass'] for c in checks)
assert len({(c['width'], c['name']) for c in checks}) == 120
assert {c['width'] for c in checks} == {390, 720, 1024, 1440}
assert all(sum(c['width'] == w for c in checks) == 30 for w in (390, 720, 1024, 1440))
assert set(report['integrity']) == {'index.html', 'styles.css', 'app.offline.js'}
for name, expected in report['integrity'].items():
    assert sha((ROOT / name).read_bytes()) == expected, f'Browser report is stale: {name}'
assert report['runnerVersion'] == '1.2-visibility-fix'
assert set(report['runnerIntegrity']) == {'test/browser-check.js', 'test/browser-layout.mjs'}
for name, expected in report['runnerIntegrity'].items():
    assert sha((ROOT / name).read_bytes()) == expected, f'Browser runner is stale: {name}'
assert json.loads((ROOT / 'package.json').read_text())['version'] == '1.2.0'
assert json.loads((ROOT / 'model-definition.json').read_text())['version'] == '1.2.0'

paths = [ROOT / name for name in TOP_FILES]
for folder, suffixes in FOLDERS.items():
    paths.extend(p for p in (ROOT / folder).iterdir() if p.is_file() and p.suffix in suffixes)
files = {p.relative_to(ROOT).as_posix(): p.read_bytes() for p in sorted(paths)}


class Links(HTMLParser):
    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if key in ('href', 'src') and value and not value.startswith(('#', 'https://pubmed.ncbi.nlm.nih.gov/', 'https://www.nngroup.com/', 'https://pmc.ncbi.nlm.nih.gov/', 'https://support.ouraring.com/')):
                assert value.split('#')[0] in files, f'Missing packaged link: {value}'


Links().feed(files['index.html'].decode())
manifest = ''.join(f'{sha(data)}  {name}\n' for name, data in sorted(files.items())).encode()
files['SHA256SUMS.txt'] = manifest
(ROOT / 'SHA256SUMS.txt').write_bytes(manifest)
OUT.mkdir(exist_ok=True)
archive = OUT / f'{NAME}.zip'
temporary = OUT / f'{NAME}.building.zip'
with ZipFile(temporary, 'w', compression=ZIP_DEFLATED, compresslevel=9) as bundle:
    for name, data in sorted(files.items()):
        info = ZipInfo(f'{NAME}/{name}', (2026, 10, 29, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        bundle.writestr(info, data, compresslevel=9)
with ZipFile(temporary) as bundle:
    assert bundle.testzip() is None
    assert len(bundle.namelist()) == len(files)
    for name, data in files.items():
        assert bundle.read(f'{NAME}/{name}') == data, f'Archive content mismatch: {name}'
if archive.exists() and archive.read_bytes() != temporary.read_bytes():
    temporary.unlink()
    raise FileExistsError(f'Refusing to replace an existing different release: {archive}')
temporary.replace(archive)
checksum = sha(archive.read_bytes())
(OUT / f'{NAME}.sha256').write_text(f'{checksum}  {archive.name}\n')
print(f'PASS: browser build hashes, 120 unique checks, packaged links and {len(files)} files')
print(f'Archive: {archive}')
print(f'Size: {archive.stat().st_size} bytes')
print(f'SHA256: {checksum}')
