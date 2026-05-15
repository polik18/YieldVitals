import re

with open('js/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

replacements = [
    ("setStatus('cpu', '全核運算中...', 'running')", "setStatus('cpu', t('status_running_cpu'), 'running')"),
    ("setStatus('string', '解析中...', 'running')", "setStatus('string', t('status_running_string'), 'running')"),
    ("setStatus('ram', '分配中...', 'running')", "setStatus('ram', t('status_running_ram'), 'running')"),
    ("setStatus('canvas2d', '繪製中...', 'running')", "setStatus('canvas2d', t('status_running_canvas2d'), 'running')"),
    ("setStatus('dom', '重繪中...', 'running')", "setStatus('dom', t('status_running_dom'), 'running')"),
    ("setStatus('gpu', '渲染探測中...', 'running')", "setStatus('gpu', t('status_running_gpu'), 'running')"),
    ("setStatus('crypto', 'AES-GCM 加速中...', 'running')", "setStatus('crypto', t('status_running_crypto'), 'running')"),
    ("setStatus('storage', '讀寫測試中...', 'running')", "setStatus('storage', t('status_running_storage'), 'running')"),
    ("setStatus('gpu', '不支援 WebGL', 'error')", "setStatus('gpu', t('error_no_webgl'), 'error')"),
    ("setStatus('network', '連線失敗或逾時', 'error')", "setStatus('network', t('error_network_failed'), 'error')"),
    ("throw new Error('使用者取消測試')", "throw new Error(t('error_cancelled'))"),
    ("e.message === '使用者取消測試'", "e.message === t('error_cancelled') || e.message === '使用者取消測試'"),
    ("e.message !== '使用者取消測試'", "e.message !== t('error_cancelled') && e.message !== '使用者取消測試'"),
    ("text.textContent = '評測執行中...'", "text.textContent = t('status_running')"),
    ("text.textContent = '重新測試'", "text.textContent = t('btn_retest')"),
    ("document.querySelector('.btn-text').textContent = '環境錯誤無法執行'", "document.querySelector('.btn-text').textContent = t('error_env')"),
    ("errDiv.textContent = `⚠️ 測試中斷: ${message}`", "errDiv.textContent = `⚠️ ${t('error_msg')}: ${message}`"),
    ("setStatus(id, '失敗/中斷', 'error')", "setStatus(id, t('status_error') || 'Error', 'error')"),
    ("showToast('報告已成功複製到剪貼簿！')", "showToast(t('toast_copy_success'))"),
    ("showToast('複製失敗，請手動圈選')", "showToast(t('toast_copy_fail'))"),
    ("showToast('JSON 報告已匯出！')", "showToast(t('toast_json_export'))"),
    ("descEl.textContent = mode.desc;", "descEl.textContent = t('mode_' + e.target.value + '_desc') || mode.desc;")
]

for old, new in replacements:
    content = content.replace(old, new)

with open('js/app.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Updated app.js")
