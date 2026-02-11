// St. John Medical Center - Cost Itemizer Application
// Data format: items are arrays [desc, gross, dc, codes_str, drug_u, drug_t, setting, min, max]
// Indices:      0     1      2    3           4       5       6       7    8

const I = { DESC: 0, GROSS: 1, DC: 2, CODES: 3, DRUG_U: 4, DRUG_T: 5, SETTING: 6, MIN: 7, MAX: 8 };

class DrugParser {
    static ROUTES = {
        'PO': 'Oral', 'IV': 'Intravenous', 'IM': 'Intramuscular',
        'SC': 'Subcutaneous', 'SQ': 'Subcutaneous', 'TD': 'Transdermal',
        'TOP': 'Topical', 'PR': 'Rectal', 'SL': 'Sublingual',
        'INH': 'Inhalation', 'NA': 'Nasal', 'OP': 'Ophthalmic',
        'OT': 'Otic', 'VAG': 'Vaginal', 'EX': 'External', 'RE': 'Rectal'
    };

    static FORMS = {
        'SOLN': 'Solution', 'SOLR': 'Solution for Reconstitution',
        'SUSP': 'Suspension', 'TABS': 'Tablet', 'TAB': 'Tablet',
        'TBEC': 'Enteric Coated Tablet', 'TBDP': 'Disintegrating Tablet',
        'CAPS': 'Capsule', 'CAP': 'Capsule', 'CPEP': 'Capsule ER',
        'CREA': 'Cream', 'OINT': 'Ointment', 'NEBU': 'Nebulizer Solution',
        'INJ': 'Injection', 'PACK': 'Packet', 'SUPP': 'Suppository',
        'GEL': 'Gel', 'LOTN': 'Lotion', 'PWDR': 'Powder', 'AERO': 'Aerosol',
        'SOSY': 'Syrup'
    };

    static DRUG_TYPE_MAP = {
        'ME': 'mg', 'ML': 'mL', 'GM': 'g', 'UN': 'units', 'EA': 'ea'
    };

    static parse(description) {
        if (!description) return null;
        const result = {
            name: '', strength: null, strengthUnit: null,
            concentration: null, route: null, routeFull: null,
            form: null, formFull: null, isConcentration: false
        };

        let desc = description.toUpperCase().trim();

        for (const [abbr, full] of Object.entries(this.FORMS)) {
            if (new RegExp(`\\b${abbr}\\b`, 'i').test(desc)) {
                result.form = abbr;
                result.formFull = full;
                break;
            }
        }

        for (const [abbr, full] of Object.entries(this.ROUTES)) {
            if (new RegExp(`\\b${abbr}\\b`, 'i').test(desc)) {
                result.route = abbr;
                result.routeFull = full;
                break;
            }
        }

        const concentrationMatch = desc.match(/(\d+\.?\d*)\s*(MG|MCG|G|MEQ|UNITS?|INT'?L?\s*UNITS?)\s*\/\s*(\d*\.?\d*)\s*(ML|L|HR|24HR|ACT|DOSE)?/i);
        if (concentrationMatch) {
            const amount = parseFloat(concentrationMatch[1]);
            const unit = concentrationMatch[2].replace(/INT'?L?\s*/i, '').toUpperCase();
            const perAmount = concentrationMatch[3] ? parseFloat(concentrationMatch[3]) : 1;
            const perUnit = (concentrationMatch[4] || 'ML').toUpperCase();
            result.concentration = `${amount} ${unit}/${perAmount > 1 ? perAmount : ''}${perUnit}`;
            result.strength = amount;
            result.strengthUnit = unit;
            result.isConcentration = true;
        } else {
            const strengthMatch = desc.match(/(\d+\.?\d*)\s*(MG|MCG|G|MEQ|UNITS?|%)/i);
            if (strengthMatch) {
                result.strength = parseFloat(strengthMatch[1]);
                result.strengthUnit = strengthMatch[2].toUpperCase();
            }
        }

        const nameMatch = desc.match(/^([A-Z][A-Z\s\-]+?)(?:\s+\d|$)/);
        result.name = nameMatch ? nameMatch[1].trim() : desc.split(/\s+/).slice(0, 2).join(' ');

        return result;
    }

    static calculateUnitPrice(row, price) {
        const drugU = row[I.DRUG_U];
        const drugT = row[I.DRUG_T];
        if (!drugU || !drugT || !price) return null;

        const typeLabel = this.DRUG_TYPE_MAP[drugT] || drugT;

        if (drugU > 1) {
            return { pricePerUnit: price / drugU, unitLabel: typeLabel };
        }
        return null;
    }
}

class HospitalCostItemizer {
    constructor() {
        this.meta = null;
        this.items = [];       // flat array of all item rows
        this.payerList = null;
        this.currentPayerRates = null;
        this.cart = [];
        this.priceType = 'gross';
        this.searchTimeout = null;
        this.darkMode = false;
        this.init();
    }

    async init() {
        this.bindElements();
        this.bindEvents();
        this.loadTheme();
        await this.loadData();
        this.loadCartFromStorage();
        this.updateCartDisplay();
    }

    bindElements() {
        this.searchInput = document.getElementById('search-input');
        this.priceTypeSelect = document.getElementById('price-type');
        this.payerSelectWrapper = document.getElementById('payer-select-wrapper');
        this.payerSelect = document.getElementById('payer-select');
        this.payerLoading = document.getElementById('payer-loading');
        this.searchResults = document.getElementById('search-results');
        this.cartItems = document.getElementById('cart-items');
        this.subtotalEl = document.getElementById('subtotal');
        this.totalEl = document.getElementById('total');
        this.clearCartBtn = document.getElementById('clear-cart');
        this.printListBtn = document.getElementById('print-list');
        this.hospitalInfo = document.getElementById('hospital-info');
        this.lastUpdated = document.getElementById('last-updated');
        this.darkModeToggle = document.getElementById('dark-mode-toggle');
    }

    bindEvents() {
        this.searchInput.addEventListener('input', () => this.handleSearch());
        this.priceTypeSelect.addEventListener('change', (e) => {
            this.priceType = e.target.value;
            if (this.priceType === 'payer') {
                this.payerSelectWrapper.style.display = 'block';
            } else {
                this.payerSelectWrapper.style.display = 'none';
                this.currentPayerRates = null;
            }
            this.handleSearch();
            this.updateCartDisplay();
        });
        this.payerSelect.addEventListener('change', () => this.handlePayerChange());
        this.clearCartBtn.addEventListener('click', () => this.clearCart());
        this.printListBtn.addEventListener('click', () => this.printList());
        this.darkModeToggle.addEventListener('click', () => this.toggleDarkMode());
    }

    loadTheme() {
        const savedTheme = localStorage.getItem('sjTheme');
        if (savedTheme === 'dark') {
            this.darkMode = true;
            document.documentElement.setAttribute('data-theme', 'dark');
        } else if (!savedTheme && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
            this.darkMode = true;
            document.documentElement.setAttribute('data-theme', 'dark');
        }
    }

    toggleDarkMode() {
        this.darkMode = !this.darkMode;
        if (this.darkMode) {
            document.documentElement.setAttribute('data-theme', 'dark');
            localStorage.setItem('sjTheme', 'dark');
        } else {
            document.documentElement.removeAttribute('data-theme');
            localStorage.setItem('sjTheme', 'light');
        }
    }

    async loadData() {
        this.searchResults.innerHTML = '<div class="loading">Loading hospital data...</div>';

        try {
            // Load meta + payers first (tiny files)
            const [metaResp, payersResp] = await Promise.all([
                fetch('data/meta.json'),
                fetch('data/payers.json')
            ]);
            if (!metaResp.ok || !payersResp.ok) throw new Error('Failed to load metadata');

            const metaData = await metaResp.json();
            this.meta = metaData.meta;
            const numChunks = metaData.chunks;
            const totalItems = metaData.total_items;
            this.payerList = await payersResp.json();

            this.displayHospitalInfo();
            this.populatePayerSelect();

            // Load all item chunks in parallel
            this.searchResults.innerHTML = `<div class="loading">Loading ${totalItems.toLocaleString()} items...</div>`;
            const chunkPromises = [];
            for (let i = 0; i < numChunks; i++) {
                chunkPromises.push(fetch(`data/items_${i}.json`).then(r => r.json()));
            }

            const chunks = await Promise.all(chunkPromises);
            this.items = [];
            for (const chunk of chunks) {
                for (const item of chunk) {
                    this.items.push(item);
                }
            }

            this.searchResults.innerHTML = `<p class="no-results">Search ${this.items.length.toLocaleString()} items by description or code...</p>`;
        } catch (error) {
            console.error('Error loading data:', error);
            this.searchResults.innerHTML = '<div class="no-results"><p>Error loading hospital data. Please refresh the page.</p></div>';
        }
    }

    displayHospitalInfo() {
        if (!this.meta) return;
        const m = this.meta;
        this.hospitalInfo.innerHTML = `
            <p><strong>${m.hospital_name || 'Hospital'}</strong></p>
            <p>${m.hospital_location || ''} &mdash; ${m.hospital_address || ''}</p>
        `;
        this.lastUpdated.textContent = m.last_updated_on || 'Unknown';
    }

    populatePayerSelect() {
        if (!this.payerList) return;
        this.payerSelect.innerHTML = '<option value="">-- Select Your Insurance / Payer --</option>';
        this.payerList.forEach((payer, idx) => {
            const opt = document.createElement('option');
            opt.value = idx;
            opt.textContent = `${payer.name} (${payer.count.toLocaleString()} items)`;
            this.payerSelect.appendChild(opt);
        });
    }

    async handlePayerChange() {
        const idx = this.payerSelect.value;
        if (idx === '') {
            this.currentPayerRates = null;
            this.handleSearch();
            this.updateCartDisplay();
            return;
        }

        const payer = this.payerList[idx];
        this.payerLoading.style.display = 'block';
        this.payerLoading.textContent = `Loading ${payer.name} rates...`;

        try {
            const resp = await fetch(`data/${payer.file}`);
            if (!resp.ok) throw new Error('Failed to load payer data');
            this.currentPayerRates = await resp.json();
            this.payerLoading.style.display = 'none';
            this.handleSearch();
            this.updateCartDisplay();
        } catch (error) {
            console.error('Error loading payer data:', error);
            this.payerLoading.textContent = 'Error loading payer rates.';
            this.currentPayerRates = null;
        }
    }

    getItemPrice(row, itemIndex) {
        if (this.priceType === 'payer' && this.currentPayerRates && itemIndex !== undefined) {
            const rate = this.currentPayerRates[String(itemIndex)];
            if (rate !== undefined) return rate;
            return null;
        }
        if (this.priceType === 'discounted_cash') {
            return row[I.DC] || row[I.GROSS] || 0;
        }
        return row[I.GROSS] || 0;
    }

    handleSearch() {
        clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => this.performSearch(), 250);
    }

    performSearch() {
        const query = this.searchInput.value.trim().toLowerCase();

        if (!query || query.length < 2) {
            this.searchResults.innerHTML = `<p class="no-results">Enter at least 2 characters to search ${this.items.length.toLocaleString()} items...</p>`;
            return;
        }

        if (!this.items.length) {
            this.searchResults.innerHTML = '<p class="no-results">No data available.</p>';
            return;
        }

        const terms = query.split(/\s+/);
        const results = [];

        for (let i = 0; i < this.items.length; i++) {
            const row = this.items[i];
            const desc = (row[I.DESC] || '').toLowerCase();
            const codes = (row[I.CODES] || '').toLowerCase();
            const searchText = desc + ' ' + codes;

            if (terms.every(t => searchText.includes(t))) {
                results.push({ row, index: i });
                if (results.length >= 100) break;
            }
        }

        this.displaySearchResults(results);
    }

    getItemType(row) {
        const desc = (row[I.DESC] || '').toLowerCase();
        const codes = row[I.CODES] || '';
        const hasCPT = codes.includes('CPT:');
        const hasHCPCS = codes.includes('HCPCS:');
        const hasRC = codes.includes('RC:');
        const hasDrug = row[I.DRUG_U] && row[I.DRUG_T];

        if (hasDrug || hasHCPCS) return { type: 'pharmacy', label: 'Rx' };
        if (desc.includes('room') || desc.includes('bed')) return { type: 'room', label: 'Room' };
        if (hasCPT) return { type: 'procedure', label: 'Proc' };
        if (hasRC) return { type: 'supply', label: 'Supply' };
        return { type: 'other', label: 'Other' };
    }

    displaySearchResults(results) {
        if (results.length === 0) {
            this.searchResults.innerHTML = '<p class="no-results">No items found matching your search.</p>';
            return;
        }

        const priceLabel = this.getPriceLabel();

        const html = results.map(({ row, index }) => {
            const price = this.getItemPrice(row, index);
            const codeInfo = this.getCodeDisplay(row);
            const drugBadges = this.getDrugBadges(row, price);
            const itemType = this.getItemType(row);
            const unitPriceInfo = DrugParser.calculateUnitPrice(row, price);

            let unitPriceHtml = '';
            if (unitPriceInfo) {
                unitPriceHtml = `<div class="item-unit-price">${this.formatCurrency(unitPriceInfo.pricePerUnit)}/${unitPriceInfo.unitLabel}</div>`;
            }

            let priceHtml;
            if (price === null) {
                priceHtml = '<div class="item-price no-rate">N/A</div><div class="item-unit-price">Not contracted</div>';
            } else {
                priceHtml = `<div class="item-price">${this.formatCurrency(price)}</div>${unitPriceHtml}`;
            }

            let rangeHtml = '';
            if (row[I.MIN] != null && row[I.MAX] != null && row[I.MIN] !== row[I.MAX]) {
                rangeHtml = `<div class="item-range">Range: ${this.formatCurrency(row[I.MIN])} - ${this.formatCurrency(row[I.MAX])}</div>`;
            }

            let settingHtml = '';
            const setting = row[I.SETTING];
            if (setting && setting !== 'BOTH') {
                settingHtml = `<span class="setting-badge ${setting.toLowerCase()}">${setting}</span>`;
            }

            return `
                <div class="search-result-item" data-index="${index}">
                    <div class="item-info">
                        <div class="item-description">
                            <span class="item-type-badge ${itemType.type}">${itemType.label}</span>
                            ${settingHtml}
                            ${this.escapeHtml(row[I.DESC])}
                        </div>
                        ${codeInfo ? `<div class="item-code">${codeInfo}</div>` : ''}
                        ${drugBadges}
                        ${rangeHtml}
                    </div>
                    <div class="item-price-container">
                        ${priceHtml}
                    </div>
                    <button class="btn btn-add" onclick="app.addToCart(${index})" ${price === null ? 'disabled' : ''}>Add</button>
                </div>
            `;
        }).join('');

        this.searchResults.innerHTML = `
            <div class="results-count">Found ${results.length} item${results.length !== 1 ? 's' : ''} &mdash; showing ${priceLabel}</div>
            ${html}
        `;
    }

    getPriceLabel() {
        if (this.priceType === 'payer') {
            const idx = this.payerSelect.value;
            if (idx !== '' && this.payerList[idx]) {
                return this.payerList[idx].name + ' rates';
            }
            return 'Select a payer above';
        }
        return this.priceType === 'discounted_cash' ? 'Discounted Cash prices' : 'Gross Charge prices';
    }

    getCodeDisplay(row) {
        const codes = row[I.CODES];
        if (!codes) return '';
        // codes is "CDM:617036415|CPT:36415"
        const parts = codes.split('|');
        const priorityTypes = ['CPT', 'HCPCS', 'CDM', 'RC', 'MS-DRG'];
        parts.sort((a, b) => {
            const at = a.split(':')[0];
            const bt = b.split(':')[0];
            const ai = priorityTypes.indexOf(at);
            const bi = priorityTypes.indexOf(bt);
            return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        });
        return parts.map(p => {
            const [type, code] = p.split(':');
            return `${type}: ${code}`;
        }).join(' | ');
    }

    getDrugBadges(row, price) {
        const parsed = DrugParser.parse(row[I.DESC]);
        const drugU = row[I.DRUG_U];
        const drugT = row[I.DRUG_T];

        if (!parsed && !drugU) return '';

        let badges = [];

        if (parsed?.concentration) {
            badges.push(`<span class="dose-badge strength">${parsed.concentration}</span>`);
        } else if (parsed?.strength && parsed?.strengthUnit) {
            badges.push(`<span class="dose-badge strength">${parsed.strength} ${parsed.strengthUnit}</span>`);
        }

        if (parsed?.routeFull) {
            badges.push(`<span class="dose-badge route">${parsed.routeFull}</span>`);
        }

        if (parsed?.formFull) {
            badges.push(`<span class="dose-badge form">${parsed.formFull}</span>`);
        }

        if (drugU && drugT) {
            const typeLabel = DrugParser.DRUG_TYPE_MAP[drugT] || drugT;
            badges.push(`<span class="dose-badge package">${drugU} ${typeLabel}</span>`);
        }

        if (badges.length === 0) return '';
        return `<div class="item-dose-info">${badges.join('')}</div>`;
    }

    addToCart(itemIndex) {
        if (!this.items[itemIndex]) return;

        const existing = this.cart.findIndex(c => c.idx === itemIndex);
        if (existing !== -1) {
            this.cart[existing].qty++;
        } else {
            this.cart.push({ idx: itemIndex, qty: 1 });
        }

        this.saveCartToStorage();
        this.updateCartDisplay();
    }

    removeFromCart(cartIndex) {
        this.cart.splice(cartIndex, 1);
        this.saveCartToStorage();
        this.updateCartDisplay();
    }

    updateQuantity(cartIndex, delta) {
        const newQty = this.cart[cartIndex].qty + delta;
        if (newQty <= 0) {
            this.removeFromCart(cartIndex);
        } else {
            this.cart[cartIndex].qty = newQty;
            this.saveCartToStorage();
            this.updateCartDisplay();
        }
    }

    clearCart() {
        if (this.cart.length === 0) return;
        if (confirm('Are you sure you want to clear all items?')) {
            this.cart = [];
            this.saveCartToStorage();
            this.updateCartDisplay();
        }
    }

    updateCartDisplay() {
        if (this.cart.length === 0) {
            this.cartItems.innerHTML = '<p class="empty-cart">No items added yet. Search and add items above.</p>';
            this.subtotalEl.textContent = '$0.00';
            this.totalEl.textContent = '$0.00';
            return;
        }

        let subtotal = 0;

        const html = this.cart.map((cartItem, cartIndex) => {
            const row = this.items[cartItem.idx];
            const price = this.getItemPrice(row, cartItem.idx);
            const lineTotal = (price || 0) * cartItem.qty;
            subtotal += lineTotal;

            const codeInfo = this.getCodeDisplay(row);
            const drugU = row[I.DRUG_U];
            const drugT = row[I.DRUG_T];
            let doseInfo = '';
            if (drugU && drugT) {
                const typeLabel = DrugParser.DRUG_TYPE_MAP[drugT] || drugT;
                doseInfo = `${drugU} ${typeLabel}`;
            }

            const priceDisplay = price === null
                ? '<span class="no-rate">N/A</span>'
                : this.formatCurrency(lineTotal);

            return `
                <div class="cart-item">
                    <div class="cart-item-info">
                        <div class="cart-item-description">${this.escapeHtml(row[I.DESC])}</div>
                        ${codeInfo ? `<div class="cart-item-code">${codeInfo}</div>` : ''}
                        ${doseInfo ? `<div class="cart-item-dose">${doseInfo}</div>` : ''}
                    </div>
                    <div class="cart-item-controls">
                        <div class="quantity-control">
                            <button onclick="app.updateQuantity(${cartIndex}, -1)">-</button>
                            <span>${cartItem.qty}</span>
                            <button onclick="app.updateQuantity(${cartIndex}, 1)">+</button>
                        </div>
                        <div class="cart-item-price">${priceDisplay}</div>
                        <button class="btn btn-danger" onclick="app.removeFromCart(${cartIndex})">X</button>
                    </div>
                </div>
            `;
        }).join('');

        this.cartItems.innerHTML = html;
        this.subtotalEl.textContent = this.formatCurrency(subtotal);
        this.totalEl.textContent = this.formatCurrency(subtotal);
    }

    formatCurrency(amount) {
        return new Intl.NumberFormat('en-US', {
            style: 'currency', currency: 'USD',
            minimumFractionDigits: 2, maximumFractionDigits: 2
        }).format(amount);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    saveCartToStorage() {
        try {
            localStorage.setItem('sjCart', JSON.stringify(this.cart));
            localStorage.setItem('sjPriceType', this.priceType);
        } catch (e) {}
    }

    loadCartFromStorage() {
        try {
            const saved = localStorage.getItem('sjCart');
            const savedType = localStorage.getItem('sjPriceType');
            if (saved) this.cart = JSON.parse(saved);
            if (savedType) {
                this.priceType = savedType;
                this.priceTypeSelect.value = savedType;
                if (savedType === 'payer') {
                    this.payerSelectWrapper.style.display = 'block';
                }
            }
        } catch (e) {
            this.cart = [];
        }
    }

    printList() {
        window.print();
    }
}

let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new HospitalCostItemizer();
});
