# St. John Medical Center - Cost Itemizer

A static website for searching and itemizing hospital costs at Ascension St. John Medical Center (Tulsa, OK). Users can search through all 65,000+ hospital charges, select their insurance payer to see negotiated rates, add items to a cart, and see itemized costs with totals.

## Features

- Search all hospital charges by description or code (CPT, CDM, HCPCS, etc.)
- Toggle between Gross Charge, Discounted Cash, and Insurance/Payer negotiated rates
- 39 insurance payers with on-demand rate loading
- Drug items show strength, route, form, and per-unit pricing
- Add items to an itemized list with quantity controls
- Cart persists across browser sessions (localStorage)
- Print-friendly itemized list
- Dark mode with system preference detection
- Mobile responsive design

## Data Architecture

The data is split for fast loading:
- `data/base.json` — All items with gross charge, discounted cash, codes, drug info, min/max (~9 MB, loads once)
- `data/payers.json` — Payer index and file mapping
- `data/payer_*.json` — Per-payer negotiated rates (loaded on-demand when selected)

## Updating the Data

1. Place the CSV file in the project root
2. Update `INPUT_CSV` in `convert.py` if the filename differs
3. Run `python convert.py`
4. Commit and push the updated `data/` directory

## Deployment on GitHub Pages

1. Go to repository Settings > Pages
2. Source: Deploy from branch `main`, folder `/ (root)`
3. Save

## Disclaimer

This tool is for informational purposes only. Actual hospital charges may vary based on individual circumstances, insurance coverage, and other factors.
