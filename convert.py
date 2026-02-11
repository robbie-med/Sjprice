"""
Convert St. John Medical Center CSV to optimized JSON for the static site.

Strategy: Split into multiple files for fast loading:
  - data/base.json:  All 65K items with gross charge, discounted cash, codes, drug info, min/max
  - data/payer_N.json: Per-payer file with just { item_index: negotiated_rate }
  - data/payers.json: Payer index list + file mapping

The base file loads on page load (~8-9MB). Payer files load on-demand when selected (~1-2MB each).
No information is lost.
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
    """Convert payer name to filesystem-safe slug."""
    s = name.lower().strip()
    s = re.sub(r'[^a-z0-9]+', '_', s)
    s = s.strip('_')
    return s


def main():
    items = OrderedDict()
    all_payers = set()
    # Track payer rates per item: payer_name -> { item_key -> rate }
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
            "license_number": meta_values[5].split("|")[0] if meta_values[5] else "",
            "financial_aid_policy": meta_values[7],
            "billing_class": meta_values[9],
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
            negotiated_pct = parse_float(row[14]) if len(row) > 14 else None
            estimated_amount = parse_float(row[16]) if len(row) > 16 else None
            min_charge = parse_float(row[18]) if len(row) > 18 else None
            max_charge = parse_float(row[19]) if len(row) > 19 else None

            key = (description, code1)

            if key not in items:
                item = {
                    "d": description,
                    "g": gross,
                    "dc": discounted_cash,
                }

                codes = []
                if code1 and code1_type:
                    codes.append({"c": code1, "t": code1_type})
                if code2 and code2_type:
                    codes.append({"c": code2, "t": code2_type})
                if codes:
                    item["codes"] = codes

                if drug_unit is not None and drug_type:
                    item["drug"] = {"u": drug_unit, "t": drug_type}

                if setting:
                    item["s"] = setting

                if min_charge is not None:
                    item["min"] = min_charge
                if max_charge is not None:
                    item["max"] = max_charge

                items[key] = item

            item = items[key]

            # Update min/max
            if min_charge is not None:
                if "min" not in item or min_charge < item["min"]:
                    item["min"] = min_charge
            if max_charge is not None:
                if "max" not in item or max_charge > item["max"]:
                    item["max"] = max_charge

            # Track payer rates
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

    # Build item list and key-to-index mapping
    items_list = list(items.values())
    key_list = list(items.keys())
    key_to_idx = {key: idx for idx, key in enumerate(key_list)}

    # Sort payers alphabetically
    sorted_payers = sorted(all_payers)

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # === Write base.json (all items, no payer-specific rates) ===
    base_output = {
        "meta": metadata,
        "items": items_list,
    }
    base_path = os.path.join(OUTPUT_DIR, "base.json")
    with open(base_path, "w", encoding="utf-8") as f:
        json.dump(base_output, f, separators=(",", ":"))
    print(f"\nbase.json: {os.path.getsize(base_path) / 1024 / 1024:.1f} MB")

    # === Write per-payer files ===
    payer_info = []
    for payer_name in sorted_payers:
        slug = slugify(payer_name)
        filename = f"payer_{slug}.json"
        filepath = os.path.join(OUTPUT_DIR, filename)

        rates = payer_rates.get(payer_name, {})
        # Build compact dict: item_index -> rate
        indexed_rates = {}
        for key, rate in rates.items():
            idx = key_to_idx[key]
            indexed_rates[idx] = rate

        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(indexed_rates, f, separators=(",", ":"))

        size_kb = os.path.getsize(filepath) / 1024
        payer_info.append({
            "name": payer_name,
            "file": filename,
            "count": len(indexed_rates),
        })
        print(f"  {filename}: {size_kb:.0f} KB ({len(indexed_rates)} items)")

    # === Write payers.json (index + file mapping) ===
    payers_path = os.path.join(OUTPUT_DIR, "payers.json")
    with open(payers_path, "w", encoding="utf-8") as f:
        json.dump(payer_info, f, separators=(",", ":"))
    print(f"\npayers.json: {os.path.getsize(payers_path) / 1024:.0f} KB")

    # Total size
    total = 0
    for fname in os.listdir(OUTPUT_DIR):
        fpath = os.path.join(OUTPUT_DIR, fname)
        if os.path.isfile(fpath):
            total += os.path.getsize(fpath)
    print(f"\nTotal data size: {total / 1024 / 1024:.1f} MB")


if __name__ == "__main__":
    main()
