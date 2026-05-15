import urllib.request
import urllib.parse
import json

def translate_text(text, target_lang):
    url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=" + target_lang + "&dt=t&q=" + urllib.parse.quote(text)
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req) as response:
            res = json.loads(response.read().decode('utf-8'))
            return "".join([part[0] for part in res[0]])
    except Exception as e:
        return f"ERROR: {e}"

print(translate_text("Hello world", "ja"))
