"""Turn dist-artifact/index.html into an Artifact page fragment with the sample DOCX embedded."""
import base64, json, pathlib, re
TITLE = '🦋️ SuperDoc Example - Floating SDT (via floating textbox container)'
root = pathlib.Path(__file__).resolve().parent.parent
dist = root / 'dist-artifact'
html = (dist / 'index.html').read_text()
links = re.findall(r'<link rel="stylesheet"[^>]*>', html)
scripts = re.findall(r'<script type="module"[^>]*></script>', html)
body = re.search(r'<body>(.*)</body>', html, re.S).group(1)
body = re.sub(r'\s*<script type="module"[^>]*></script>', '', body)
tokens = (root / 'src' / 'style.css').read_text().split('html, body')[0].strip()
sample_b64 = base64.b64encode((root / 'public' / 'sample.docx').read_bytes()).decode()
page = f'''<title>{TITLE}</title>
<style>
{tokens}
html, body {{ margin: 0; height: 100%; }}
body {{ background: var(--bg); color: var(--text); }}
</style>
{''.join(links)}
{body.strip()}
<script>window.__SAMPLE_DOCX_B64 = "{sample_b64}";</script>
{''.join(scripts)}
'''
(dist / 'artifact.html').write_text(page)
for asset in (dist / 'assets').glob('*.js'):
    text = asset.read_text(encoding='utf-8')
    if '\ufffd' in text:
        asset.write_text(text.replace('\ufffd', '\\uFFFD'), encoding='utf-8')
files = {f'assets/{p.name}': str(p) for p in sorted((dist / 'assets').iterdir())}
print(json.dumps(files, indent=1))
