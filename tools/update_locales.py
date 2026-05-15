import json
import os

with open('locales/en.json', 'r', encoding='utf-8') as f:
    en = json.load(f)

en['canvas2d_render'] = 'Canvas 2D Graphics'
en['mode_stability'] = 'Stability'
en['radar_labels'] = ["Compute (CPU)", "Compute (String)", "Compute (Crypto)", "Memory (RAM)", "Storage (Local)", "Network (DL)", "Graphics (DOM)", "Graphics (GPU)", "Graphics (2D)"]

with open('locales/en.json', 'w', encoding='utf-8') as f:
    json.dump(en, f, indent=2, ensure_ascii=False)

with open('locales/zh-TW.json', 'r', encoding='utf-8') as f:
    tw = json.load(f)

tw['canvas2d_render'] = 'Canvas 2D 繪圖'
tw['mode_stability'] = '穩定'
tw['radar_labels'] = ["邏輯運算 (CPU)", "字串解析 (String)", "加密吞吐 (Crypto)", "記憶體 (RAM)", "本機存取 (Storage)", "網路下載 (Network)", "DOM 重繪 (DOM)", "WebGL 渲染 (GPU)", "Canvas 2D (2D)"]

with open('locales/zh-TW.json', 'w', encoding='utf-8') as f:
    json.dump(tw, f, indent=2, ensure_ascii=False)

print("Locales updated.")
