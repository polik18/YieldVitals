import json
import os
import glob

missing_keys = {
    'error_chart_load': {
        'en': 'Failed to load Chart.js. Check your network connection.',
        'zh-TW': 'Chart.js 載入失敗，無法顯示圖表。請檢查網路連線。',
        'zh-CN': 'Chart.js 载入失败，无法显示图表。请检查网络连线。'
    },
    'error_three_load': {
        'en': 'Failed to load Three.js. Check your network connection.',
        'zh-TW': 'Three.js 載入失敗，無法執行圖形測試。請檢查網路連線。',
        'zh-CN': 'Three.js 载入失败，无法执行图形测试。请检查网络连线。'
    },
    'error_timeout': {
        'en': 'Test timeout',
        'zh-TW': '測試逾時',
        'zh-CN': '测试超时'
    },
    'error_fatal': {
        'en': 'Fatal error:',
        'zh-TW': '嚴重錯誤:',
        'zh-CN': '严重错误:'
    }
}

for file_path in glob.glob('locales/*.json'):
    lang = os.path.basename(file_path).split('.')[0]
    with open(file_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    for key, trans in missing_keys.items():
        if key not in data:
            if lang in trans:
                data[key] = trans[lang]
            else:
                data[key] = trans['en'] # fallback to English
                
    with open(file_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

with open('js/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

replacements = [
    ("return 'Chart.js 載入失敗，無法顯示圖表。請檢查網路連線。';", "return t('error_chart_load');"),
    ("return 'Three.js 載入失敗，無法執行圖形測試。請檢查網路連線。';", "return t('error_three_load');"),
    ("reject(new Error(`${label} 測試逾時 (${ms}ms)`))", "reject(new Error(`${label} ${t('error_timeout')} (${ms}ms)`))"),
    ('showError("嚴重錯誤: " + fatalErr.message);', 'showError(t("error_fatal") + " " + fatalErr.message);')
]

for old, new in replacements:
    content = content.replace(old, new)

with open('js/app.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Updated rel locales and app.js")
