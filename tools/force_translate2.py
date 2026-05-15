import json
import urllib.request
import urllib.parse
import os
import glob

def translate_single(text, target_lang):
    url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=" + target_lang + "&dt=t&q=" + urllib.parse.quote(text)
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        response = urllib.request.urlopen(req)
        result = json.loads(response.read().decode('utf-8'))
        return "".join([part[0] for part in result[0] if part[0]])
    except Exception as e:
        print(f"Failed to translate {text} to {target_lang}: {e}")
        return text

with open('../locales/en.json', 'r', encoding='utf-8') as f:
    en = json.load(f)

for file in glob.glob('../locales/*.json'):
    lang = os.path.basename(file).split('.')[0]
    if lang in ['en', 'zh-TW']:
        continue
        
    with open(file, 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    print(f"Updating {lang}...")
    
    updated = False
    if 'canvas2d_render' not in data or data['canvas2d_render'] == 'Canvas 2D Graphics':
        data['canvas2d_render'] = translate_single('Canvas 2D Graphics', lang)
        updated = True
        
    if 'mode_stability' not in data or data['mode_stability'] == 'Stability':
        data['mode_stability'] = translate_single('Stability', lang)
        updated = True
        
    if len(data.get('radar_labels', [])) < 9:
        res = translate_single('Graphics (2D)', lang)
        labels = en['radar_labels'].copy()
        for i in range(8):
            if i < len(data['radar_labels']):
                labels[i] = data['radar_labels'][i]
        labels[8] = res
        data['radar_labels'] = labels
        updated = True
        
    if updated:
        with open(file, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

print("Done updating all languages.")
