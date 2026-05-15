"""
Fix: Remove Network (DL) from radar_labels in all individual locale JSON files.
"""
import re, sys, os

locales_dir = r'e:\Github\YieldVitals\locales'
fixed_count = 0

for filename in os.listdir(locales_dir):
    if not filename.endswith('.json'):
        continue
    filepath = os.path.join(locales_dir, filename)
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    removed_in_file = 0

    def remove_network_item(match):
        global removed_in_file
        block = match.group(0)
        lines = block.split('\n')
        new_lines = []
        for line in lines:
            stripped = line.strip()
            # Remove lines that are array items containing "(DL)"
            if stripped.startswith('"') and '(DL)' in stripped:
                removed_in_file += 1
                continue
            new_lines.append(line)
        return '\n'.join(new_lines)

    pattern = r'"radar_labels":\s*\[[\s\S]*?\]'
    new_content = re.sub(pattern, remove_network_item, content)

    if removed_in_file == 0:
        # Fallback: position-based removal for non-(DL) labels
        removed_in_file = 0
        def remove_sixth_item_pos(match):
            global removed_in_file
            block = match.group(0)
            lines = block.split('\n')
            in_array = False
            content_item_indices = []
            for i, line in enumerate(lines):
                stripped = line.strip()
                if '"radar_labels"' in stripped:
                    in_array = True
                    continue
                if in_array and stripped.startswith('"') and stripped not in ('"radar_labels": [', ''):
                    content_item_indices.append(i)
                if stripped in ('],', ']'):
                    in_array = False
            if len(content_item_indices) == 9:
                del lines[content_item_indices[5]]
                removed_in_file += 1
            return '\n'.join(lines)
        new_content = re.sub(pattern, remove_sixth_item_pos, content)

    if removed_in_file > 0:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        fixed_count += 1
        sys.stderr.write(f'Fixed: {filename}\n')
    else:
        sys.stderr.write(f'NO CHANGE: {filename}\n')

sys.stderr.write(f'\nTotal files fixed: {fixed_count}\n')
