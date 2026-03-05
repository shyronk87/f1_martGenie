import json

src = r"E:\nexbuy\result\homary_sku.jsonl"
dst = r"E:\nexbuy\result\product_ids.txt"

seen = set()
count = 0
kept = 0

with open(src, "r", encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        count += 1
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue

        sku_id = obj.get("sku_id")
        if sku_id is None:
            continue

        sku_id = str(sku_id).strip()
        if not sku_id or sku_id.lower() == "null":
            continue

        if sku_id not in seen:
            seen.add(sku_id)
            kept += 1

with open(dst, "w", encoding="utf-8") as out:
    for pid in sorted(seen, key=lambda x: int(x) if x.isdigit() else x):
        out.write(pid + "\n")

print(f"Read lines: {count}, unique product_ids: {kept}")
print("Saved to:", dst)