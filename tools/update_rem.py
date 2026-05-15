import json
import os
import glob
import re

missing_keys = {
    'env_unknown': {
        'en': 'Unknown',
        'zh-TW': '未知',
        'zh-CN': '未知'
    },
    'env_unknown_mem': {
        'en': 'Unknown/Limited',
        'zh-TW': '未知/受限',
        'zh-CN': '未知/受限'
    },
    'env_unknown_gpu': {
        'en': 'Unknown (No WebGL Support)',
        'zh-TW': '未知 (無 WebGL 支援)',
        'zh-CN': '未知 (无 WebGL 支援)'
    },
    'error_webgl_oom': {
        'en': 'WebGL OOM or failed to start',
        'zh-TW': 'WebGL 記憶體耗盡或啟動失敗',
        'zh-CN': 'WebGL 内存耗尽或启动失败'
    },
    'status_gpu_p1': {
        'en': 'Objects:',
        'zh-TW': '物件:',
        'zh-CN': '物件:'
    },
    'status_gpu_p2': {
        'en': 'Post-process iters:',
        'zh-TW': '後處理:',
        'zh-CN': '后处理:'
    },
    'status_gpu_p3': {
        'en': 'PBR Lights:',
        'zh-TW': 'PBR 動態光:',
        'zh-CN': 'PBR 动态光:'
    },
    'warning_crypto': {
        'en': 'Values are unusually high. Might be affected by underlying cache or hardware acceleration.',
        'zh-TW': '數值異常偏高，可能受到底層快取或極端硬體加速影響',
        'zh-CN': '数值异常偏高，可能受到底层快取或极端硬件加速影响'
    },
    'error_worker': {
        'en': 'Worker failed',
        'zh-TW': 'Worker 執行失敗',
        'zh-CN': 'Worker 执行失败'
    },
    'error_network_endpoint': {
        'en': 'Failed to connect to the test endpoint',
        'zh-TW': '無法連接測速節點',
        'zh-CN': '无法连接测速节点'
    },
    'radar_dataset': {
        'en': 'Performance Metrics',
        'zh-TW': '效能指標',
        'zh-CN': '效能指标'
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
    ("navigator.hardwareConcurrency || '未知'", "navigator.hardwareConcurrency || t('env_unknown')"),
    ("navigator.deviceMemory ? `${navigator.deviceMemory} GB+` : '未知/受限'", "navigator.deviceMemory ? `${navigator.deviceMemory} GB+` : t('env_unknown_mem')"),
    ("navigator.platform || '未知'", "navigator.platform || t('env_unknown')"),
    ("'未知 (無 WebGL 支援)'", "t('env_unknown_gpu')"),
    ("console.warn(\"無法取得 GPU 資訊\");", "console.warn(\"Failed to get GPU info\");"),
    ("new Error('使用者取消測試')", "new Error(t('error_cancelled'))"),
    ("new Error('WebGL 記憶體耗盡或啟動失敗')", "new Error(t('error_webgl_oom'))"),
    ("`物件: ${(p1Instances / 1000).toFixed(1)}k`", "`\${t('status_gpu_p1')} \${(p1Instances / 1000).toFixed(1)}k`"),
    ("`後處理: ${p2Iters} 迭代`", "`\${t('status_gpu_p2')} \${p2Iters}`"),
    ("`PBR 動態光: ${p3LightCount} 盞`", "`\${t('status_gpu_p3')} \${p3LightCount}`"),
    ("warning: '數值異常偏高，可能受到底層快取或極端硬體加速影響'", "warning: t('warning_crypto')"),
    ("new Error('WebCrypto Worker 執行失敗')", "new Error('WebCrypto ' + t('error_worker'))"),
    ("new Error('Storage Worker 執行失敗')", "new Error('Storage ' + t('error_worker'))"),
    ("error: '無法連接測速節點'", "error: t('error_network_endpoint')"),
    ("label: '效能指標',", "label: t('radar_dataset'),"),
    ("console.error(\"i18n 未能正確載入雷達圖標籤\");", "console.error(\"i18n failed to load radar labels\");"),
    ("label: '快速'", "label: t('mode_quick')"),
    ("label: '標準'", "label: t('mode_standard')"),
    ("label: '極限'", "label: t('mode_extreme')"),
    ("label: '穩定'", "label: t('mode_stability')"),
    ("label: '燒機'", "label: t('mode_burnin')"),
    ("desc: '適合一般筆電或桌機'", "desc: t('mode_standard_desc')"),
    ("desc: '適合高階桌機 (不建議手機使用)'", "desc: t('mode_extreme_desc')"),
    ("desc: '多次取樣，減少波動與系統干擾'", "desc: t('mode_stability_desc')"),
    ("desc: '長時間壓力測試 (測量散熱與穩定度)'", "desc: t('mode_burnin_desc')")
]

for old, new in replacements:
    content = content.replace(old, new)

with open('js/app.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Updated remaining locales and app.js")
