import json
import os
import glob
from deep_translator import GoogleTranslator

missing_keys = {
    'mode_quick_desc': 'Suitable for mobile or light testing',
    'mode_standard_desc': 'Suitable for general laptops or desktops',
    'mode_extreme_desc': 'Suitable for high-end desktops (not recommended for mobile)',
    'mode_stability_desc': 'Multiple sampling to reduce fluctuations and system interference',
    'mode_burnin_desc': 'Long-term stress test (measures cooling and stability)',
    'status_running_cpu': 'Running CPU...',
    'status_running_string': 'Parsing...',
    'status_running_ram': 'Allocating...',
    'status_running_canvas2d': 'Drawing...',
    'status_running_dom': 'Repainting...',
    'status_running_gpu': 'Probing Render...',
    'status_running_crypto': 'AES-GCM Accelerating...',
    'status_running_storage': 'I/O Testing...',
    'error_cancelled': 'Cancelled by user',
    'error_no_webgl': 'WebGL not supported',
    'error_network_failed': 'Connection failed or timed out',
    'btn_retest': 'Test Again',
    'btn_cancel': 'Cancel',
    'error_env': 'Environment error, cannot run',
    'toast_copy_success': 'Report successfully copied to clipboard!',
    'toast_copy_fail': 'Copy failed, please select manually',
    'toast_json_export': 'JSON report exported!',
    'rel_high': 'High',
    'rel_med': 'Medium',
    'rel_low': 'Low',
    'rel_none': 'None',
    'rel_reason_high': 'All test items completed successfully without abnormal fluctuations.',
    'rel_reason_cancelled': 'Test manually interrupted by the user.',
    'rel_reason_core_err': 'Core tests (CPU/GPU) encountered errors or did not complete. Total score is not indicative.',
    'rel_reason_sub_err': 'Some secondary tests were interrupted. Total score may be slightly biased.',
    'rel_reason_crypto_warn': 'Crypto throughput is abnormally high. It might be affected by underlying cache or extreme hardware acceleration.',
    'error_chart_load': 'Failed to load Chart.js. Check your network connection.',
    'error_three_load': 'Failed to load Three.js. Check your network connection.',
    'error_timeout': 'Test timeout',
    'error_fatal': 'Fatal error:',
    'env_unknown': 'Unknown',
    'env_unknown_mem': 'Unknown/Limited',
    'env_unknown_gpu': 'Unknown (No WebGL Support)',
    'error_webgl_oom': 'WebGL OOM or failed to start',
    'status_gpu_p1': 'Objects:',
    'status_gpu_p2': 'Post-process iters:',
    'status_gpu_p3': 'PBR Lights:',
    'warning_crypto': 'Values are unusually high. Might be affected by underlying cache or hardware acceleration.',
    'error_worker': 'Worker failed',
    'error_network_endpoint': 'Failed to connect to the test endpoint',
    'radar_dataset': 'Performance Metrics'
}

lang_map = {
    'zh-TW': 'zh-TW', 'zh-CN': 'zh-CN', 'ja': 'ja', 'ko': 'ko', 'es': 'es',
    'fr': 'fr', 'de': 'de', 'it': 'it', 'pt': 'pt', 'ru': 'ru', 'ar': 'ar',
    'hi': 'hi', 'bn': 'bn', 'ur': 'ur', 'id': 'id', 'ms': 'ms', 'vi': 'vi',
    'th': 'th', 'tr': 'tr', 'nl': 'nl', 'pl': 'pl', 'sv': 'sv', 'fi': 'fi',
    'da': 'da', 'no': 'no', 'cs': 'cs', 'el': 'el', 'he': 'iw', 'uk': 'uk' # he -> iw for google translator sometimes
}

for file_path in glob.glob('locales/*.json'):
    lang = os.path.basename(file_path).split('.')[0]
    if lang in ['en', 'zh-TW', 'zh-CN']:
        continue # Already translated manually

    g_lang = lang_map.get(lang, lang)
    print(f"Translating for {lang} ({g_lang})...")
    
    with open(file_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    keys_to_translate = []
    texts_to_translate = []
    
    for k, v in missing_keys.items():
        if data.get(k) == v: # It is currently the English fallback
            keys_to_translate.append(k)
            texts_to_translate.append(v)
            
    if not keys_to_translate:
        continue
        
    try:
        translator = GoogleTranslator(source='en', target=g_lang)
        for i, k in enumerate(keys_to_translate):
            try:
                translated_text = translator.translate(texts_to_translate[i])
                data[k] = translated_text
            except Exception as e_inner:
                print(f"Failed to translate key {k} for {lang}: {e_inner}")
    except Exception as e:
        print(f"Failed translation for {lang}: {e}")
        continue
        
    with open(file_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

print("Done translating. Now bundling locales...")
locales = {}
for file_path in glob.glob('locales/*.json'):
    lang = os.path.basename(file_path).split('.')[0]
    with open(file_path, 'r', encoding='utf-8') as f:
        locales[lang] = json.load(f)

js_content = f"window.YIELDVITALS_LOCALES = {json.dumps(locales, ensure_ascii=False, indent=2)};"

with open('js/locales.js', 'w', encoding='utf-8') as f:
    f.write(js_content)

print("Finished bundling.")
