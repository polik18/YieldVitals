import json
import os
import glob

missing_keys = {
    'mode_quick_desc': {
        'en': 'Suitable for mobile or light testing',
        'zh-TW': '適合手機或輕度測試',
        'zh-CN': '适合手机或轻度测试'
    },
    'mode_standard_desc': {
        'en': 'Suitable for general laptops or desktops',
        'zh-TW': '適合一般筆電或桌機',
        'zh-CN': '适合一般笔电或桌机'
    },
    'mode_extreme_desc': {
        'en': 'Suitable for high-end desktops (not recommended for mobile)',
        'zh-TW': '適合高階桌機 (不建議手機使用)',
        'zh-CN': '适合高阶桌机 (不建议手机使用)'
    },
    'mode_stability_desc': {
        'en': 'Multiple sampling to reduce fluctuations and system interference',
        'zh-TW': '多次取樣，減少波動與系統干擾',
        'zh-CN': '多次采样，减少波动与系统干扰'
    },
    'mode_burnin_desc': {
        'en': 'Long-term stress test (measures cooling and stability)',
        'zh-TW': '長時間壓力測試 (測量散熱與穩定度)',
        'zh-CN': '长时间压力测试 (测量散热与稳定度)'
    },
    'status_running_cpu': {
        'en': 'Running CPU...',
        'zh-TW': '全核運算中...',
        'zh-CN': '全核运算中...'
    },
    'status_running_string': {
        'en': 'Parsing...',
        'zh-TW': '解析中...',
        'zh-CN': '解析中...'
    },
    'status_running_ram': {
        'en': 'Allocating...',
        'zh-TW': '分配中...',
        'zh-CN': '分配中...'
    },
    'status_running_canvas2d': {
        'en': 'Drawing...',
        'zh-TW': '繪製中...',
        'zh-CN': '绘制中...'
    },
    'status_running_dom': {
        'en': 'Repainting...',
        'zh-TW': '重繪中...',
        'zh-CN': '重绘中...'
    },
    'status_running_gpu': {
        'en': 'Probing Render...',
        'zh-TW': '渲染探測中...',
        'zh-CN': '渲染探测中...'
    },
    'status_running_crypto': {
        'en': 'AES-GCM Accelerating...',
        'zh-TW': 'AES-GCM 加速中...',
        'zh-CN': 'AES-GCM 加速中...'
    },
    'status_running_storage': {
        'en': 'I/O Testing...',
        'zh-TW': '讀寫測試中...',
        'zh-CN': '读写测试中...'
    },
    'error_cancelled': {
        'en': 'Cancelled by user',
        'zh-TW': '使用者取消測試',
        'zh-CN': '用户取消测试'
    },
    'error_no_webgl': {
        'en': 'WebGL not supported',
        'zh-TW': '不支援 WebGL',
        'zh-CN': '不支持 WebGL'
    },
    'error_network_failed': {
        'en': 'Connection failed or timed out',
        'zh-TW': '連線失敗或逾時',
        'zh-CN': '连接失败或超时'
    },
    'btn_retest': {
        'en': 'Test Again',
        'zh-TW': '重新測試',
        'zh-CN': '重新测试'
    },
    'btn_cancel': {
        'en': 'Cancel',
        'zh-TW': '取消',
        'zh-CN': '取消'
    },
    'error_env': {
        'en': 'Environment error, cannot run',
        'zh-TW': '環境錯誤無法執行',
        'zh-CN': '环境错误无法执行'
    },
    'toast_copy_success': {
        'en': 'Report successfully copied to clipboard!',
        'zh-TW': '報告已成功複製到剪貼簿！',
        'zh-CN': '报告已成功复制到剪贴簿！'
    },
    'toast_copy_fail': {
        'en': 'Copy failed, please select manually',
        'zh-TW': '複製失敗，請手動圈選',
        'zh-CN': '复制失败，请手动圈选'
    },
    'toast_json_export': {
        'en': 'JSON report exported!',
        'zh-TW': 'JSON 報告已匯出！',
        'zh-CN': 'JSON 报告已汇出！'
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

print('Updated all locales')
