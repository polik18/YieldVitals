import json
import os
import glob
from googletrans import Translator

translator = Translator()

with open('../locales/en.json', 'r', encoding='utf-8') as f:
    en = json.load(f)

for file in glob.glob('../locales/*.json'):
    lang = os.path.basename(file).split('.')[0]
    if lang in ['en', 'zh-TW']:
        continue
        
    with open(file, 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    print(f"Updating {lang}...")
    
    # Update new keys
    try:
        if 'canvas2d_render' not in data or data['canvas2d_render'] == 'Canvas 2D Graphics':
            res = translator.translate('Canvas 2D Graphics', dest=lang)
            data['canvas2d_render'] = res.text
            
        if 'mode_stability' not in data or data['mode_stability'] == 'Stability':
            res = translator.translate('Stability', dest=lang)
            data['mode_stability'] = res.text
            
        # Radar labels has 9 items now
        if len(data.get('radar_labels', [])) < 9:
            res = translator.translate('Graphics (2D)', dest=lang)
            labels = en['radar_labels'].copy()
            for i in range(8):
                if i < len(data['radar_labels']):
                    labels[i] = data['radar_labels'][i]
            labels[8] = res.text
            data['radar_labels'] = labels
            
        with open(file, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            
    except Exception as e:
        print(f"Error on {lang}: {e}")

print("Done updating all languages.")
