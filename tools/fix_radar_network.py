"""
Fix: Remove Network (DL) from all radar_labels arrays in locales.js
Strategy: Match the full radar_labels block, find lines that contain network-related terms
(DL, Network, Rete, Réseau, Netzwerk, Red, Nät, etc.) and remove that specific line.
"""
import re
import sys

with open(r'e:\Github\YieldVitals\js\locales.js', 'r', encoding='utf-8') as f:
    content = f.read()

removed_count = 0

def remove_network_item(match):
    global removed_count
    block = match.group(0)
    lines = block.split('\n')
    
    new_lines = []
    for line in lines:
        stripped = line.strip()
        # Skip lines that are the network label (contain "DL" which is always preserved in all translations)
        # Looking at all locales: every network radar label contains "(DL)" since it's not translated
        if stripped.startswith('"') and '(DL)' in stripped:
            removed_count += 1
            continue  # Remove this line
        new_lines.append(line)
    
    return '\n'.join(new_lines)

pattern = r'"radar_labels":\s*\[[\s\S]*?\],'
new_content = re.sub(pattern, remove_network_item, content)

sys.stderr.write(f'Removed {removed_count} network label lines\n')

with open(r'e:\Github\YieldVitals\js\locales.js', 'w', encoding='utf-8') as f:
    f.write(new_content)

sys.stderr.write('Done.\n')
