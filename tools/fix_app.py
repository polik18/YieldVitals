with open('js/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix 1: Fix broken MODE_SETTINGS desc - literal t() call in string
content = content.replace(
    "desc: 't('mode_quick_desc')'",
    "desc: '\u9069\u5408\u624b\u6a5f\u6216\u8f15\u5ea6\u6e2c\u8a66'"
)

# Fix 2: Fix broken finally block - updateDynamicElements injected inside finally without closing
BAD_BLOCK = "                } catch (fatalErr) {\n                    showError(\"\u56b4\u91cd\u932f\u8aa4: \" + fatalErr.message);\n                } finally {\n                    setButtonLoading(false);\n\nwindow.updateDynamicElements"

GOOD_BLOCK = "                } catch (fatalErr) {\n                    showError(\"\u56b4\u91cd\u932f\u8aa4: \" + fatalErr.message);\n                } finally {\n                    setButtonLoading(false);\n                }\n            });\n        });\n\n        window.updateDynamicElements"

if BAD_BLOCK in content:
    content = content.replace(BAD_BLOCK, GOOD_BLOCK)
    print("Fixed finally block")
else:
    print("WARNING: BAD_BLOCK not found - check manually")

# Fix 3: Remove the top-level envInfo DOM write (runs before DOM ready)
ENV_START = "        // \u53d6\u5f97\u74b0\u5883\u8cc7\u8a0a (\u4f7f\u7528 escapeHtml \u9632\u6b62 HTML \u6ce8\u5165)\n        document.getElementById('envInfo').innerHTML = `"
if ENV_START in content:
    start_idx = content.find(ENV_START)
    # Find the closing backtick and semicolon
    end_idx = content.find(";\n\n        // \u6a21\u5f0f\u5207\u63db\u6587\u5b57\u9023\u52d5", start_idx)
    if end_idx > 0:
        content = content[:start_idx] + content[end_idx + 2:]  # skip ;\n
        print("Removed top-level envInfo population")
    else:
        print("WARNING: Could not find end of envInfo block")
else:
    print("envInfo block not found (already removed or different)")

with open('js/app.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done!")
lines = content.strip().split('\n')
print("Last 8 lines of file:")
for l in lines[-8:]:
    print(repr(l))
