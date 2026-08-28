from pathlib import Path
from PIL import Image

project = Path('/home/ubuntu/lsa-new-repair')
source = Path('/home/ubuntu/kira-heat-intelligence-icon.png')
res = project / 'android/app/src/main/res'
asset_copy = project / 'assets/kira-heat-intelligence-icon.png'
asset_copy.parent.mkdir(parents=True, exist_ok=True)
asset_copy.write_bytes(source.read_bytes())

sizes = {
    'mipmap-mdpi': 48,
    'mipmap-hdpi': 72,
    'mipmap-xhdpi': 96,
    'mipmap-xxhdpi': 144,
    'mipmap-xxxhdpi': 192,
}

with Image.open(source) as original:
    image = original.convert('RGBA')
    for density, size in sizes.items():
        target = res / density
        target.mkdir(parents=True, exist_ok=True)
        resized = image.resize((size, size), Image.Resampling.LANCZOS)
        for filename in ('ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png'):
            resized.save(target / filename, format='PNG', optimize=True)

print('Generated Kira launcher icons for all Android densities.')
