with open('js/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the exact cancel listener block by character position
idx = content.find("cancelBtn').addEventListener")
print("Found cancelBtn at:", idx)
print("Context:", repr(content[idx-120:idx+120]))
