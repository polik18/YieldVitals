with open('js/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Move cancelBtn event listeners INSIDE DOMContentLoaded
cancel_block = "        // \u53d6\u6d88\u4e8b\u4ef6\u7e81\u5b9a (\u905e\u5897 currentRunId \u4f7f\u6240\u6709\u9032\u884c\u4e2d\u7684\u6e2c\u8a66\u8996\u70ba\u5df2\u53d6\u6d88)\n        document.getElementById('cancelBtn').addEventListener('click', () => currentRunId++);\n        document.getElementById('fullscreenCancelBtn').addEventListener('click', () => currentRunId++);\n"

if cancel_block in content:
    content = content.replace(cancel_block, "")
    print("Removed top-level cancel listeners")
else:
    print("WARNING: cancel_block not found, trying alternate search...")
    idx = content.find("cancelBtn').addEventListener")
    print(f"cancelBtn listener at char: {idx}")
    print(repr(content[idx-80:idx+80]))

# Insert cancel listeners inside DOMContentLoaded
dom_marker = "        window.addEventListener('DOMContentLoaded', () => {\n"
if dom_marker in content:
    insert_code = "        window.addEventListener('DOMContentLoaded', () => {\n            // \u53d6\u6d88\u4e8b\u4ef6\u7e81\u5b9a\n            document.getElementById('cancelBtn').addEventListener('click', () => currentRunId++);\n            document.getElementById('fullscreenCancelBtn').addEventListener('click', () => currentRunId++);\n\n"
    content = content.replace(dom_marker, insert_code, 1)
    print("Inserted cancel listeners inside DOMContentLoaded")
else:
    print("WARNING: DOMContentLoaded marker not found!")

# Add t() fallback at top of file (after the let currentRunId line)
if "window.t = function" not in content:
    first_line_end = content.find("\n", 0) + 1
    fallback = "        // Fallback t() before i18n loads\n        if (typeof window.t === 'undefined') { window.t = function(k) { return k; }; }\n\n"
    content = fallback + content
    print("Added t() fallback")

# Also fix mode event listener - it reads MODE_SETTINGS.desc which no longer uses t()
# ensure the initial modeDesc shows the quick mode description on load
# by adding an initial trigger inside DOMContentLoaded
init_mode_trigger = "\n            // Trigger initial mode description display\n            const initModeEvt = new Event('change');\n            document.querySelector('input[name=\"testMode\"]:checked').dispatchEvent(initModeEvt);\n"

# Add before the Chart.js init inside DOMContentLoaded
chart_init = "            // \u521d\u59cb\u5316 Chart.js\n            if (window.Chart) {"
if chart_init in content and init_mode_trigger not in content:
    content = content.replace(chart_init, init_mode_trigger + "\n            // \u521d\u59cb\u5316 Chart.js\n            if (window.Chart) {")
    print("Added initial mode trigger")

with open('js/app.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("All fixes applied!")

# Verification
with open('js/app.js', 'r', encoding='utf-8') as f:
    final = f.read()

cancel_idx = final.find("cancelBtn').addEventListener")
dom_idx = final.find("window.addEventListener('DOMContentLoaded'")
print(f"\ncancelBtn listener at char {cancel_idx}")
print(f"DOMContentLoaded at char {dom_idx}")
print("cancelBtn is INSIDE DOMContentLoaded:", cancel_idx > dom_idx)
print(f"Total lines: {final.count(chr(10))}")
