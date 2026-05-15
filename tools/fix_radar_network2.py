"""
Fix remaining radar_labels with 9 items by removing the 6th item (network label).
Uses position-based removal but correctly skips the "radar_labels": [ header line.
"""
import re, sys

with open(r'e:\Github\YieldVitals\js\locales.js', 'r', encoding='utf-8') as f:
    content = f.read()

removed_count = 0

def remove_sixth_content_item(match):
    global removed_count
    block = match.group(0)
    lines = block.split('\n')
    
    # Find all content lines (array items) - these are lines whose stripped content
    # starts with a quote char and is INSIDE the array (not the "radar_labels" key itself)
    content_item_indices = []
    in_array = False
    for i, line in enumerate(lines):
        stripped = line.strip()
        if '"radar_labels"' in stripped:
            in_array = True
            continue
        if in_array and stripped.startswith('"') and stripped not in ('"radar_labels": [', ''):
            # This is an array item
            content_item_indices.append(i)
        if stripped == '],' or stripped == ']':
            in_array = False
    
    if len(content_item_indices) == 9:
        # Remove the 6th item (index 5 = network)
        line_to_remove = content_item_indices[5]
        del lines[line_to_remove]
        removed_count += 1
    
    return '\n'.join(lines)

pattern = r'"radar_labels":\s*\[[\s\S]*?\],'
new_content = re.sub(pattern, remove_sixth_content_item, content)

sys.stderr.write(f'Additional removals: {removed_count}\n')

with open(r'e:\Github\YieldVitals\js\locales.js', 'w', encoding='utf-8') as f:
    f.write(new_content)

sys.stderr.write('Done.\n')
