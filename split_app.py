import re
import os

os.makedirs('js/core', exist_ok=True)
os.makedirs('js/benchmarks', exist_ok=True)

with open('js/app.js', 'r', encoding='utf-8-sig') as f:
    lines = f.readlines()

def extract_funcs(func_names):
    extracted = []
    i = 0
    while i < len(lines):
        line = lines[i]
        # match 'function NAME(' or 'async function NAME(' or 'const NAME ='
        match = False
        for name in func_names:
            if re.search(r'\b' + name + r'\s*[(=]', line):
                match = True
                break
        if match:
            # start capturing
            start = i
            braces = 0
            in_block = False
            while i < len(lines):
                for char in lines[i]:
                    if char == '{':
                        braces += 1
                        in_block = True
                    elif char == '}':
                        braces -= 1
                i += 1
                if in_block and braces == 0:
                    break
            extracted.extend(lines[start:i])
            # remove from lines
            del lines[start:i]
            i = start # reset i
        else:
            i += 1
    return "".join(extracted)

def write_file(path, content):
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)

utils_funcs = ['escapeHtml', 'isCancelledRun', 'getDeviceSpecs', 'showToast', 'setStatus', 'setButtonLoading', 'resetUI', 'showError', 'hideError', 'showFatalError', 'checkDependencies', 'withTimeout', 'normalize', 'supportsWebGL', 'generateAntiCacheParam']
utils_code = extract_funcs(utils_funcs)
write_file('js/core/utils.js', utils_code)

cpu_code = extract_funcs(['runCPUMultiCore'])
write_file('js/benchmarks/cpu.js', cpu_code)

dom_code = extract_funcs(['runStringTest', 'runDOMTest'])
write_file('js/benchmarks/dom.js', dom_code)

mem_code = extract_funcs(['runRAMTest'])
write_file('js/benchmarks/memory.js', mem_code)

gpu_code = extract_funcs(['runCanvas2DTest', 'runThreeJSTest'])
write_file('js/benchmarks/gpu.js', gpu_code)

crypto_code = extract_funcs(['runCryptoTest'])
write_file('js/benchmarks/crypto.js', crypto_code)

storage_code = extract_funcs(['runIDBTest', 'runStorageTest'])
write_file('js/benchmarks/storage.js', storage_code)

network_code = extract_funcs(['runNetworkTest', 'NETWORK_TEST_ENDPOINTS'])
write_file('js/benchmarks/network.js', network_code)

scoring_code = extract_funcs(['runWithSampling', 'calculateReliability', 'calculateFinalScore', 'getDiagnostics'])
write_file('js/core/scoring.js', scoring_code)

report_code = extract_funcs(['generateReportText', 'renderResult', 'initChart'])
write_file('js/core/report.js', report_code)

# Whatever is left is state + main
# Wait, NETWORK_TEST_ENDPOINTS might not have braces? It's an array.
# The brace counter works for arrays too if it contains {}. But NETWORK_TEST_ENDPOINTS is an array '[' and ']'.
