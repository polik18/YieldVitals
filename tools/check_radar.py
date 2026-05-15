import re, sys

with open(r'e:\Github\YieldVitals\js\locales.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Find radar_labels blocks that still have 9 items (network label still present)
pattern = r'"radar_labels":\s*\[[\s\S]*?\],'
blocks = re.findall(pattern, content)

still_9 = []
for b in blocks:
    lines = b.split('\n')
    item_lines = [l for l in lines if l.strip().startswith('"') and len(l.strip()) > 15]
    if len(item_lines) == 9:
        still_9.append(item_lines[5])

sys.stderr.write(f'Blocks still with 9 items: {len(still_9)}\n')
for item in still_9:
    sys.stderr.write(f'  6th item: {item.strip()}\n')
