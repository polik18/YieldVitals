import os

with open('js/app.js', 'r', encoding='utf-8') as f:
    text = f.read()

# Replace GPU hardcoded strings
text = text.replace("setStatus('gpu', '不支援 WebGL', 'error');", "setStatus('gpu', t('gpu_unsupported') || '不支援 WebGL', 'error');")
text = text.replace("setStatus('gpu', '渲染探測中...', 'running');", "setStatus('gpu', t('gpu_testing') || '渲染探測中...', 'running');")

# Note: Using regex to replace the backtick strings carefully
import re
text = re.sub(r'gpuStatusEl\.textContent = `\$\{phaseName\} - Vsync\.\.\.`;', r'gpuStatusEl.textContent = `${phaseName} - ${t("gpu_vsync") || "Vsync..."}`;', text)

text = re.sub(r'p1Frame\.getStatus = \(\) => `幾何實體化: \$\{\(p1Instances / 1000\)\.toFixed\(1\)\}k obj`;', r'p1Frame.getStatus = () => `${t("gpu_phase1") || "幾何實體化"}: ${(p1Instances / 1000).toFixed(1)}k obj`;', text)

text = re.sub(r'p2Frame\.getStatus = \(\) => `流體分形運算: \$\{p2Iters\} 疊代`;', r'p2Frame.getStatus = () => `${t("gpu_phase2") || "流體分形運算"}: ${p2Iters} iter`;', text)

text = re.sub(r'p3Frame\.getStatus = \(\) => `PBR 動態陰影光源: \$\{p3LightCount\} 盞`;', r'p3Frame.getStatus = () => `${t("gpu_phase3") || "PBR 動態陰影"}: ${p3LightCount} lights`;', text)

text = text.replace("reject(new Error('WebGL 記憶體耗盡或驅動崩潰'));", "reject(new Error(t('error_webgl_crash') || 'WebGL 記憶體耗盡或驅動崩潰'));")
text = text.replace("reject(new Error('使用者取消測試'));", "reject(new Error(t('error_user_cancelled') || '使用者取消測試'));")
text = text.replace("throw new Error('使用者取消測試');", "throw new Error(t('error_user_cancelled') || '使用者取消測試');")
text = text.replace("if (e.message !== '使用者取消測試')", "if (e.message !== (t('error_user_cancelled') || '使用者取消測試') && e.message !== '使用者取消測試')")

text = text.replace("setStatus('network', '連線逾時或失敗', 'error');", "setStatus('network', t('error_network_timeout') || '連線逾時或失敗', 'error');")
text = text.replace("error: '無法連線測試節點'", "error: t('error_network_node') || '無法連線測試節點'")

with open('js/app.js', 'w', encoding='utf-8') as f:
    f.write(text)

print('Replaced')
