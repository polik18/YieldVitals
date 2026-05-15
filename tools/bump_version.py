import re, glob

files = ['index.html', 'js/app.js', 'js/i18n.js', 'README.md']
files += glob.glob('locales/*.json')

for f in files:
    with open(f, encoding='utf-8') as fp:
        content = fp.read()
    new_content = content.replace('V1.0', 'V1.01').replace('v1.0', 'v1.01')
    if new_content != content:
        with open(f, 'w', encoding='utf-8') as fp:
            fp.write(new_content)
        print(f'Updated: {f}')

print('Done.')
