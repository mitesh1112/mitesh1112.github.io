import csv
import json

# Read CSV
data = []
with open('data.csv', 'r', encoding='utf-8') as f:
    reader = csv.reader(f)
    header = next(reader)  # Skip header
    rows = [row for row in reader if len(row[0].strip()) > 0]  # Filter out empty rows
    for row in rows:
        if len(row) >= 6:
            data.append({
                'code': row[0].strip(),
                'name': row[1].strip(),
                'std': row[2].strip(),
                'school': row[3].strip(),
                'mobile1': row[4].strip(),
                'mobile2': row[5].strip() if len(row) > 5 else ''
            })

# Write JSON
with open('data_complete.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f"✓ Converted {len(data)} records to JSON")
