"""
Convert St. John Medical Center CSV to optimized JSON for the static site.

Strategy: Split into multiple files for fast loading:
  - data/base.json:  All items as compact arrays + metadata
  - data/payer_N.json: Per-payer file with { item_index: negotiated_rate }
  - data/payers.json: Payer index list + file mapping

Items stored as arrays to minimize JSON size:
  [description, gross, discounted_cash, codes_str, drug_unit, drug_type, setting, min, max]
  Index: 0=desc, 1=gross, 2=dc, 3=codes, 4=drug_u, 5=drug_t, 6=setting, 7=min, 8=max
"""

import csv
import json
import os
import re
from collections import OrderedDict

INPUT_CSV = "730579286_st-john-medical-center-inc_standardcharges.csv"
OUTPUT_DIR = "data"


def parse_float(val):
    if not val or val.strip() == "":
        return None
    try:
        return round(float(val), 2)
    except ValueError:
        return None


def clean_drug_unit(val):
    if not val:
        return None
    try:
        f = float(val)
        if f == int(f):
            return int(f)
        return round(f, 2)
    except ValueError:
        return None


def slugify(name):
    s = name.lower().strip()
    s = re.sub(r'[^a-z0-9]+', '_', s)
    s = s.strip('_')
    return s


def main():
    items = OrderedDict()
    all_payers = set()
    payer_rates = {}

    with open(INPUT_CSV, "r", encoding="utf-8") as f:
        reader = csv.reader(f)

        meta_header = next(reader)
        meta_values = next(reader)
        data_headers = next(reader)

        metadata = {
            "hospital_name": meta_values[0],
            "last_updated_on": meta_values[1],
            "version": meta_values[2],
            "hospital_location": meta_values[3],
            "hospital_address": meta_values[4],
            "financial_aid_policy": meta_values[7],
        }

        row_count = 0
        for row in reader:
            row_count += 1
            if len(row) < 10:
                continue

            description = row[0].strip()
            code1 = row[1].strip()
            code1_type = row[2].strip()
            code2 = row[3].strip()
            code2_type = row[4].strip()
            setting = row[6].strip()
            drug_unit = clean_drug_unit(row[7])
            drug_type = row[8].strip() if len(row) > 8 else ""
            gross = parse_float(row[9])
            discounted_cash = parse_float(row[10])
            payer_name = row[11].strip() if len(row) > 11 else ""
            negotiated_dollar = parse_float(row[13]) if len(row) > 13 else None
            estimated_amount = parse_float(row[16]) if len(row) > 16 else None
            min_charge = parse_float(row[18]) if len(row) > 18 else None
            max_charge = parse_float(row[19]) if len(row) > 19 else None

            key = (description, code1)

            if key not in items:
                # Build codes string: "CDM:617036415|CPT:36415"
                codes_parts = []
                if code1 and code1_type:
                    codes_parts.append(f"{code1_type}:{code1}")
                if code2 and code2_type:
                    codes_parts.append(f"{code2_type}:{code2}")
                codes_str = "|".join(codes_parts)

                # Store as dict temporarily, will convert to array later
                items[key] = {
                    "d": description,
                    "g": gross,
                    "dc": discounted_cash,
                    "codes": codes_str,
                    "du": drug_unit,
                    "dt": drug_type or "",
                    "s": setting,
                    "min": min_charge,
                    "max": max_charge,
                }

            item = items[key]

            if min_charge is not None:
                if item["min"] is None or min_charge < item["min"]:
                    item["min"] = min_charge
            if max_charge is not None:
                if item["max"] is None or max_charge > item["max"]:
                    item["max"] = max_charge

            if payer_name and payer_name != "CDM DEFAULT":
                all_payers.add(payer_name)
                rate = estimated_amount or negotiated_dollar
                if rate is not None:
                    if payer_name not in payer_rates:
                        payer_rates[payer_name] = {}
                    if key not in payer_rates[payer_name]:
                        payer_rates[payer_name][key] = rate

        print(f"Processed {row_count} data rows")
        print(f"Unique items: {len(items)}")
        print(f"Unique payers: {len(all_payers)}")

    # Build item arrays
    # Format: [desc, gross, dc, codes_str, drug_unit, drug_type, setting, min, max]
    key_list = list(items.keys())
    key_to_idx = {key: idx for idx, key in enumerate(key_list)}

    items_array = []
    for key in key_list:
        item = items[key]
        items_array.append([
            item["d"],
            item["g"],
            item["dc"],
            item["codes"],
            item["du"],
            item["dt"],
            item["s"],
            item["min"],
            item["max"],
        ])

    sorted_payers = sorted(all_payers)

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Write chunked item files (~15K items per chunk, ~1.5MB each)
    CHUNK_SIZE = 15000
    num_chunks = (len(items_array) + CHUNK_SIZE - 1) // CHUNK_SIZE
    print(f"\nSplitting {len(items_array)} items into {num_chunks} chunks...")

    for ci in range(num_chunks):
        start = ci * CHUNK_SIZE
        end = min(start + CHUNK_SIZE, len(items_array))
        chunk = items_array[start:end]
        chunk_path = os.path.join(OUTPUT_DIR, f"items_{ci}.json")
        with open(chunk_path, "w", encoding="utf-8") as f:
            json.dump(chunk, f, separators=(",", ":"))
        size_mb = os.path.getsize(chunk_path) / 1024 / 1024
        print(f"  items_{ci}.json: {size_mb:.1f} MB ({len(chunk)} items)")

    # Write meta.json (small file with metadata + chunk count)
    meta_output = {
        "meta": metadata,
        "chunks": num_chunks,
        "total_items": len(items_array),
    }
    meta_path = os.path.join(OUTPUT_DIR, "meta.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta_output, f, separators=(",", ":"))
    print(f"  meta.json: {os.path.getsize(meta_path) / 1024:.0f} KB")

    # Write per-payer files
    payer_info = []
    for payer_name in sorted_payers:
        slug = slugify(payer_name)
        filename = f"payer_{slug}.json"
        filepath = os.path.join(OUTPUT_DIR, filename)

        rates = payer_rates.get(payer_name, {})
        indexed_rates = {}
        for key, rate in rates.items():
            idx = key_to_idx[key]
            indexed_rates[str(idx)] = rate

        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(indexed_rates, f, separators=(",", ":"))

        size_kb = os.path.getsize(filepath) / 1024
        payer_info.append({
            "name": payer_name,
            "file": filename,
            "count": len(indexed_rates),
        })
        print(f"  {filename}: {size_kb:.0f} KB ({len(indexed_rates)} items)")

    # Write payers.json
    payers_path = os.path.join(OUTPUT_DIR, "payers.json")
    with open(payers_path, "w", encoding="utf-8") as f:
        json.dump(payer_info, f, separators=(",", ":"))
    print(f"\npayers.json: {os.path.getsize(payers_path) / 1024:.0f} KB")

    total = sum(
        os.path.getsize(os.path.join(OUTPUT_DIR, f))
        for f in os.listdir(OUTPUT_DIR)
        if os.path.isfile(os.path.join(OUTPUT_DIR, f))
    )
    print(f"\nTotal data size: {total / 1024 / 1024:.1f} MB")


if __name__ == "__main__":
    main()
