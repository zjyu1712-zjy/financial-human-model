from html.parser import HTMLParser
from pathlib import Path
import re

root = Path(__file__).resolve().parent.parent


class Check(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = set()
        self.labels = []
        self.assets = []
        self.page = None
        self.pages = {}
        self.owners = {}
        self.steps = {}
        self.controls = []
        self.links = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if 'guide-step' in attrs.get('class', '').split():
            self.steps[attrs['id']] = 'hidden' in attrs
        if 'aria-controls' in attrs:
            self.controls.append(attrs['aria-controls'])
        if tag == 'section' and 'app-page' in attrs.get('class', '').split():
            assert self.page is None, 'Nested functional pages'
            self.page = attrs['id']
            self.pages[self.page] = 'hidden' in attrs
        if 'id' in attrs:
            assert attrs['id'] not in self.ids, f"Duplicate ID: {attrs['id']}"
            self.ids.add(attrs['id'])
            self.owners[attrs['id']] = self.page
        if tag == 'label' and 'for' in attrs:
            self.labels.append(attrs['for'])
        if tag == 'a' and attrs.get('href') and not attrs['href'].startswith(('#', 'https://')):
            self.links.append(attrs['href'].split('#')[0])
        if tag in ('script', 'link'):
            url = attrs.get('src') or attrs.get('href')
            if url:
                self.assets.append(url)

    def handle_endtag(self, tag):
        if tag == 'section':
            self.page = None


check = Check()
check.feed((root / 'index.html').read_text())
for target in check.labels:
    assert target in check.ids, f'Missing label target {target}'
for target in check.controls:
    assert target in check.ids, f'Missing controlled panel {target}'
for target in re.findall(r"\$\('#([\w-]+)'\)", (root / 'src/app.js').read_text()):
    assert target in check.ids, f'Missing static script target {target}'
for target in re.findall(r"\$\('([\w-]+)'\)", (root / 'src/sleep-diary-ui.js').read_text()):
    assert target in check.ids, f'Missing diary target {target}'
for link in check.links:
    assert (root / link).is_file(), f'Missing local document: {link}'
for asset in check.assets:
    assert '://' not in asset, f'External runtime dependency: {asset}'
    assert (root / asset).is_file(), f'Missing asset: {asset}'
print(f'PASS: {len(check.ids)} unique static IDs, label targets, local script/style assets')
expected_pages = {'guide', 'decision', 'demo', 'marginal', 'systems', 'evidence', 'model', 'files'}
assert set(check.pages) == expected_pages
assert [key for key, hidden in check.pages.items() if not hidden] == ['guide']
for page, ids in {
    'guide': ['guide-goal-learn', 'guide-goal-recover', 'guide-goal-income', 'guide-income-mode',
              'guide-protect-learn', 'guide-amount', 'guide-amount-value', 'guide-comparisons', 'guide-options', 'guide-note',
              'guide-save', 'guide-load', 'guide-back', 'guide-next', 'guide-progress',
              'personal-inputs', 'personal-error', 'guide-weeks', 'guide-period',
              'guide-limit-minCash', 'guide-limit-minSleep', 'guide-limit-maxIncomeLoss',
              'guide-compare-panel', 'guide-compare-a', 'guide-compare-b', 'guide-margins',
              'guide-trend-chart', 'guide-trend-details', 'guide-full-values', 'guide-direct-summary',
              'sleep-helper', 'diary-reference-field', 'diary-save', 'diary-history',
              *[f'diary-stage-{i}' for i in range(1, 4)],
              *[f'guide-step-{i}' for i in range(1, 6)], *[f'guide-nav-{i}' for i in range(1, 6)]],
    'decision': ['summary', 'verdict', 'plan-controls', 'trajectory'],
    'demo': ['demo-results', 'demo-baseline', 'demo-1', 'demo-all', 'demo-goal-learn',
             'demo-goal-recover', 'demo-goal-income', 'demo-action', 'demo-pay', 'demo-start',
             'sleep-demo-results', 'sleep-demo-chart', 'sleep-demo-source', 'sleep-demo-other', 'sleep-demo-weekly'],
    'marginal': ['marginal-target', 'marginal-summary', 'marginal-contributions'],
    'systems': ['state-controls'],
    'evidence': ['analyze', 'uncertainty', 'calibration-result'],
    'model': ['parameters', 'weights', 'trace', 'dictionary', 'marginal-formula', 'system-equations',
              'model-results', 'model-demos', 'model-analysis', 'model-storage', 'demo-model-definitions', 'model-language', 'model-diary'],
    'files': ['save', 'load', 'export', 'import'],
}.items():
    for element in ids:
        assert check.owners[element] == page, f'{element} is in the wrong page'
    assert f'nav-{page}' in check.ids
print('PASS: 8 isolated pages; guided decision is the default; controls and model definitions have the intended owners')
assert set(check.steps) == {f'guide-step-{i}' for i in range(1, 6)}
assert [key for key, hidden in check.steps.items() if not hidden] == ['guide-step-1']
print('PASS: 5 guided steps; initially only the goal step is visible; step navigation targets exist')
print('Static structure only; no browser rendering or viewport verification.')
