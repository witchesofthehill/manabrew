from pathlib import Path

from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
W, H = 1800, 2400
INK = '#202020'
MUTED = '#666666'
LABEL = ImageFont.load_default(size=25)
SMALL = ImageFont.load_default(size=20)
WEIGHTS = ['Light', 'Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold', 'Black']


def font(style, size):
    return ImageFont.truetype(str(ROOT / 'ttf' / f'ManabrewBrush-{style}.ttf'), size)


def page(title, subtitle):
    image = Image.new('RGB', (W, H), 'white')
    d = ImageDraw.Draw(image)
    d.text((100, 70), title, font=LABEL, fill=INK)
    d.text((100, 112), subtitle, font=SMALL, fill=MUTED)
    d.line((100, 165, W - 100, 165), fill='#cccccc', width=2)
    return image, d


def line(d, x, y, text, style='Regular', size=70, max_width=1600):
    face = font(style, size)
    while face.getlength(text) > max_width:
        size -= 1
        face = font(style, size)
    d.text((x, y), text, font=face, fill=INK, anchor='ls')


def main():
    pages = []
    image, d = page('MANABREW BRUSH', 'Original broad-nib lettering / seven weights / upright and italic')
    line(d, 100, 400, 'Manabrew', 'Bold', 250)
    line(d, 100, 540, 'Freshly drawn. Ready to brew.', 'Regular', 85)
    d.text((100, 670), 'UPRIGHT', font=LABEL, fill=MUTED)
    d.text((950, 670), 'ITALIC', font=LABEL, fill=MUTED)
    for i, weight in enumerate(WEIGHTS):
        y = 810 + i * 200
        line(d, 100, y, 'Manabrew', weight, 108, 720)
        line(d, 950, y, 'Manabrew', weight + 'Italic', 108, 720)
        d.text((105, y + 30), f'{weight} / {300 + i * 100}', font=SMALL, fill=MUTED)
        d.text((955, y + 30), f'{weight} Italic', font=SMALL, fill=MUTED)
    line(d, 100, 2310, 'Independent letterforms. No Costa outlines or font files used.', 'Light', 31)
    image.save(ROOT / 'specimen.png')
    pages.append(image)
    preview = Image.new('RGB', (1600, 640), 'white')
    preview_draw = ImageDraw.Draw(preview)
    for y, style in [(90, 'Bold'), (390, 'Black')]:
        preview_draw.text((75, y - 40), f'MANABREW BRUSH / {style.upper()}', font=SMALL, fill=MUTED)
        line(preview_draw, 65, y + 160, 'Manabrew', style, 245, 1460)
    preview.save(ROOT / 'preview.png')
    for style in ('Regular', 'Bold', 'RegularItalic', 'BlackItalic'):
        image, d = page(f'MANABREW BRUSH / {style.upper()}', 'Alphabet, numerals, accents, punctuation, and text sizes')
        for y, text in [(310, 'ABCDEFGHIJKLM'), (440, 'NOPQRSTUVWXYZ'), (650, 'abcdefghijklm'), (780, 'nopqrstuvwxyz'), (980, '0123456789  € £ ¥ $ % & @'), (1180, 'ÀÁÂÃÄÅ Æ Ç ÈÉÊË Ð Ñ Ø Œ'), (1300, 'àáâãäå æ ç èéêë ð ñ ø œ ß'), (1420, 'Č Ď Ę Ğ İ Ł Ň Ő Ř Ș Ț Ű Ž'), (1540, 'č ď ę ğ ı ł ň ő ř ș ț ű ž'), (1720, '“Brewed with care.” — €12.50'), (1830, 'fi fl ff ffi ffl / AVATAR / WA To Ya')]:
            line(d, 100, y, text, style, 95)
        for y, size in [(1960, 54), (2070, 38), (2150, 28), (2220, 22)]:
            line(d, 100, y, f'{size}px  The quick brown fox jumps over the lazy dog. À bientôt, birra e caffè!', style, size)
        if style in ('Regular', 'BlackItalic'):
            image.save(ROOT / f'specimen-{style.lower()}.png')
        pages.append(image)
    cmap = TTFont(ROOT / 'ttf' / 'ManabrewBrush-Regular.ttf').getBestCmap()
    chars = [chr(cp) for cp in sorted(cmap) if not chr(cp).isspace() and cp not in (0xAD, 0x200B)]
    for start in range(0, len(chars), 144):
        image, d = page('MANABREW BRUSH / CHARACTER MAP', 'Regular / Unicode coverage / combining marks shown independently')
        for index, char in enumerate(chars[start:start + 144]):
            row, col = divmod(index, 12)
            x, y = 100 + col * 135, 200 + row * 175
            d.text((x + 50, y + 95), char, font=font('Regular', 80), fill=INK, anchor='ms')
            d.text((x + 4, y + 125), f'U+{ord(char):04X}', font=SMALL, fill=MUTED)
        pages.append(image)
    pages[0].save(ROOT / 'specimen.pdf', save_all=True, append_images=pages[1:], resolution=150)
    print(f'Rendered {len(pages)} specimen pages and specimen.png using FreeType.')


if __name__ == '__main__':
    main()
