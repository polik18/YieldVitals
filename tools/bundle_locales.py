import json
import os
import glob

locales = {}
for file_path in glob.glob('locales/*.json'):
    lang = os.path.basename(file_path).split('.')[0]
    with open(file_path, 'r', encoding='utf-8') as f:
        locales[lang] = json.load(f)

js_content = f"window.YIELDVITALS_LOCALES = {json.dumps(locales, ensure_ascii=False, indent=2)};"

with open('js/locales.js', 'w', encoding='utf-8') as f:
    f.write(js_content)

print("Generated js/locales.js")
