import json
import re

# Read complete JSON data
with open('bjs_complete.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# Read current index.html
with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Normalize the data structure for consistency
normalized_data = []
for item in data:
    normalized_data.append({
        "code": item.get('code', ''),
        "name": item.get('name', ''),
        "std": item.get('std', ''),
        "school": item.get('school', ''),
        "mobile1": item.get('mobile1', ''),
        "mobile2": item.get('mobile2', '')
    })

# Convert to JavaScript format
data_js = json.dumps(normalized_data, ensure_ascii=False)

# Find the embeddedData section
pattern = r'const embeddedData = \[.*?\];'

# Create replacement with proper formatting
replacement = f'const embeddedData = {data_js};'

# Replace in content
new_content = re.sub(pattern, replacement, content, flags=re.DOTALL)

# Verify replacement happened
if new_content == content:
    print("ERROR: Pattern not found!")
    print("Trying alternative approach...")
    # Try finding the line differently
    lines = content.split('\n')
    for i, line in enumerate(lines):
        if 'const embeddedData = ' in line:
            print(f"Found at line {i}: {line[:80]}...")
else:
    # Write back
    with open('index.html', 'w', encoding='utf-8') as f:
        f.write(new_content)
    print(f"✓ Successfully updated index.html with {len(normalized_data)} records")
