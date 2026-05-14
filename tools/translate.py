import json
import urllib.request
import urllib.parse
import os

def translate_batch(texts, target_lang):
    # Combine texts with a rare delimiter
    combined = " \n\n ".join(texts)
    url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=" + target_lang + "&dt=t&q=" + urllib.parse.quote(combined)
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        response = urllib.request.urlopen(req)
        result = json.loads(response.read().decode('utf-8'))
        translated_combined = "".join([part[0] for part in result[0] if part[0]])
        # Split back
        translated_texts = [t.strip() for t in translated_combined.split('\n\n')]
        
        # Fallback if split count doesn't match
        if len(translated_texts) != len(texts):
            print(f"Warning: Batch mismatch for {target_lang}. Expected {len(texts)}, got {len(translated_texts)}.")
            # Fallback to returning original for safety if horribly broken
            return texts
            
        return translated_texts
    except Exception as e:
        print(f"Error translating batch to {target_lang} - {e}")
        return texts

languages = [
    'zh-CN', 'ja', 'ko', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ar',
    'hi', 'bn', 'ur', 'id', 'ms', 'vi', 'th', 'tr', 'nl', 'pl',
    'sv', 'fi', 'da', 'no', 'cs', 'el', 'he', 'uk'
]

print("Starting batch translation to 28 languages...")

with open('../locales/en.json', 'r', encoding='utf-8') as f:
    en_data = json.load(f)

# Extract flat list of strings
keys = []
texts = []

for key, value in en_data.items():
    if isinstance(value, list):
        for i, item in enumerate(value):
            keys.append((key, i))
            texts.append(item)
    else:
        keys.append(key)
        texts.append(value)

for lang in languages:
    out_file = f"../locales/{lang}.json"
    if os.path.exists(out_file):
        print(f"Skipping {lang}, already exists.")
        continue

    print(f"Translating to {lang}...")
    translated_texts = translate_batch(texts, lang)
    
    translated_data = {}
    for i, key in enumerate(keys):
        t_text = translated_texts[i] if i < len(translated_texts) else texts[i]
        
        if isinstance(key, tuple):
            k, idx = key
            if k not in translated_data:
                translated_data[k] = []
            translated_data[k].append(t_text)
        else:
            translated_data[key] = t_text
            
    with open(out_file, 'w', encoding='utf-8') as f:
        json.dump(translated_data, f, ensure_ascii=False, indent=2)
    
    print(f"Saved {lang}.json")

print("All translations completed!")
