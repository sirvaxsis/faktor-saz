"""Resize and encode the approved generated artwork; preserve its original alpha."""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / 'site'
full = Image.open(ROOT / 'design/app-icon-fullbleed.png').convert('RGB')
desktop = Image.open(ROOT / 'design/app-icon-desktop.png').convert('RGBA')
for size in (192, 512):
    desktop.resize((size, size), Image.Resampling.LANCZOS).save(SITE / f'icon-v18-{size}.png', optimize=True)
    full.resize((size, size), Image.Resampling.LANCZOS).save(SITE / f'icon-v18-maskable-{size}.png', optimize=True)
for size in (16, 32):
    desktop.resize((size, size), Image.Resampling.LANCZOS).save(SITE / f'favicon-v18-{size}.png', optimize=True)
desktop.resize((256, 256), Image.Resampling.LANCZOS).save(
    SITE / 'favicon-v18.ico', sizes=[(n, n) for n in (16, 24, 32, 48, 64, 128, 256)])
full.resize((180, 180), Image.Resampling.LANCZOS).save(SITE / 'apple-touch-icon-v18.png', optimize=True)
# Conventional fallback URLs for browsers that do not use the explicit links.
full.resize((180, 180), Image.Resampling.LANCZOS).save(SITE / 'apple-touch-icon.png', optimize=True)
(SITE / 'favicon.ico').write_bytes((SITE / 'favicon-v18.ico').read_bytes())
print('Built 10 installation/browser icon assets.')
