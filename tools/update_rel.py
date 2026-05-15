import json
import os
import glob
import re

missing_keys = {
    'rel_high': {
        'en': 'High',
        'zh-TW': '高',
        'zh-CN': '高'
    },
    'rel_med': {
        'en': 'Medium',
        'zh-TW': '中',
        'zh-CN': '中'
    },
    'rel_low': {
        'en': 'Low',
        'zh-TW': '低',
        'zh-CN': '低'
    },
    'rel_none': {
        'en': 'None',
        'zh-TW': '無',
        'zh-CN': '无'
    },
    'rel_reason_high': {
        'en': 'All test items completed successfully without abnormal fluctuations.',
        'zh-TW': '所有測試項目皆順利完成，無異常波動。',
        'zh-CN': '所有测试项目皆顺利完成，无异常波动。'
    },
    'rel_reason_cancelled': {
        'en': 'Test manually interrupted by the user.',
        'zh-TW': '測試遭使用者手動中斷。',
        'zh-CN': '测试遭用户手动中断。'
    },
    'rel_reason_core_err': {
        'en': 'Core tests (CPU/GPU) encountered errors or did not complete. Total score is not indicative.',
        'zh-TW': '核心測試 (CPU/GPU) 發生錯誤或未完成，總分不具參考價值。',
        'zh-CN': '核心测试 (CPU/GPU) 发生错误或未完成，总分不具参考价值。'
    },
    'rel_reason_sub_err': {
        'en': 'Some secondary tests were interrupted. Total score may be slightly biased.',
        'zh-TW': '部分次要測試發生中斷，總分可能略有偏差。',
        'zh-CN': '部分次要测试发生中断，总分可能略有偏差。'
    },
    'rel_reason_crypto_warn': {
        'en': 'Crypto throughput is abnormally high. It might be affected by underlying cache or extreme hardware acceleration.',
        'zh-TW': 'Crypto 數值異常偏高，可能受到底層快取或極端硬體加速影響。',
        'zh-CN': 'Crypto 数值异常偏高，可能受到底层快取或极端硬件加速影响。'
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
    ("score = '高';", "score = t('rel_high');"),
    ("score = '中';", "score = t('rel_med');"),
    ("score = '低';", "score = t('rel_low');"),
    ("score: '無'", "score: t('rel_none')"),
    ("reason = '所有測試項目皆順利完成，無異常波動。';", "reason = t('rel_reason_high');"),
    ("reason: '測試遭使用者手動中斷。'", "reason: t('rel_reason_cancelled')"),
    ("reason = '核心測試 (CPU/GPU) 發生錯誤或未完成，總分不具參考價值。';", "reason = t('rel_reason_core_err');"),
    ("reason = '部分次要測試發生中斷，總分可能略有偏差。';", "reason = t('rel_reason_sub_err');"),
    ("reason = 'Crypto 數值異常偏高，可能受到底層快取或極端硬體加速影響。';", "reason = t('rel_reason_crypto_warn');"),
]

for old, new in replacements:
    content = content.replace(old, new)

with open('js/app.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Updated rel locales and app.js")
