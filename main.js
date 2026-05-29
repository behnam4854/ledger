// ---------- DATA MODEL ----------
let buys = [];
let sells = [];
let nextBuyId = 100;
let usdBalance = 0;

// ---------- REAL-TIME PRICE FETCHING ----------
let autoRefreshInterval = null;
let autoRefreshEnabled = true;

const assetToCoinGeckoId = {
    'BTC': 'bitcoin',
    'ETH': 'ethereum',
    'XAUT': 'tether-gold'
};

let currentPrices = {
    'BTC': 0,
    'ETH': 0,
    'XAUT': 0
};

// Pagination and Sorting
let currentPage = 1;
let rowsPerPage = 10;
let currentSort = { column: 'date', direction: 'asc' };
let ledgerData = [];

// Helper: load/save
function loadData() {
    const storedBuys = localStorage.getItem('ledgrs_buys');
    const storedSells = localStorage.getItem('ledgrs_sells');
    const storedId = localStorage.getItem('ledgrs_nextId');
    if(storedBuys) buys = JSON.parse(storedBuys);
    if(storedSells) sells = JSON.parse(storedSells);
    if(storedId) nextBuyId = parseInt(storedId);
    if(buys.length === 0 && sells.length === 0) {
        addDemoData();
    }
    recalcRemainingFromSells();
}

function recalcRemainingFromSells() {
    buys.forEach(b => { b.remaining = b.amount; });
    for(let sell of sells) {
        const buy = buys.find(b => b.id == sell.buyId);
        if(buy) {
            buy.remaining = Math.max(0, buy.remaining - sell.amount);
        }
    }
    saveAll();
}

function saveAll() {
    localStorage.setItem('ledgrs_buys', JSON.stringify(buys));
    localStorage.setItem('ledgrs_sells', JSON.stringify(sells));
    localStorage.setItem('ledgrs_nextId', nextBuyId);
}

// USD Balance functions
function loadUsdBalance() {
    const stored = localStorage.getItem('ledgrs_usd_balance');
    if (stored !== null) {
        usdBalance = parseFloat(stored);
    } else {
        usdBalance = 10000;
    }
    updateUsdDisplay();
}

function saveUsdBalance() {
    localStorage.setItem('ledgrs_usd_balance', usdBalance);
}

function updateUsdDisplay() {
    const usdElement = document.getElementById('usdBalance');
    if (usdElement) {
        usdElement.innerHTML = `$${usdBalance.toFixed(2)}`;
    }
}

function addUsd(amount) {
    if (amount > 0) {
        usdBalance += amount;
        saveUsdBalance();
        updateUsdDisplay();
        alert(`Added $${amount.toFixed(2)} to USD balance. New balance: $${usdBalance.toFixed(2)}`);
    }
}

function withdrawUsd(amount) {
    if (amount > 0 && amount <= usdBalance) {
        usdBalance -= amount;
        saveUsdBalance();
        updateUsdDisplay();
        alert(`Withdrew $${amount.toFixed(2)} from USD balance. New balance: $${usdBalance.toFixed(2)}`);
    } else if (amount > usdBalance) {
        alert(`Insufficient funds! Available: $${usdBalance.toFixed(2)}`);
    }
}

function addDemoData() {
    const today = new Date().toISOString().slice(0,10);
    const lastMonth = new Date(Date.now() - 30*86400000).toISOString().slice(0,10);
    buys.push({ id: nextBuyId++, wallet: "Main", asset: "BTC", amount: 0.2, price: 42000, date: lastMonth, remaining: 0.2 });
    buys.push({ id: nextBuyId++, wallet: "Main", asset: "ETH", amount: 2.5, price: 2800, date: lastMonth, remaining: 1.2 });
    buys.push({ id: nextBuyId++, wallet: "Ledger", asset: "XAUT", amount: 0.5, price: 2750, date: lastMonth, remaining: 0.5 });
    
    const btcBuy = buys[0];
    const soldAmount = 0.1;
    const sellPrice = 51000;
    const costBasis = soldAmount * btcBuy.price;
    const proceeds = soldAmount * sellPrice;
    const profit = proceeds - costBasis;
    sells.push({ id: Date.now()+1, buyId: btcBuy.id, amount: soldAmount, sellPrice: sellPrice, sellDate: today, profit: profit });
    btcBuy.remaining -= soldAmount;
    saveAll();
}

function addSellTransaction(buyId, amountToSell, sellPricePerUnit, sellDate) {
    const buy = buys.find(b => b.id == buyId);
    if(!buy) return { success: false, error: "Buy not found" };
    if(amountToSell <= 0) return { success: false, error: "Amount must be >0" };
    if(buy.remaining < amountToSell - 0.000001) return { success: false, error: `Not enough remaining. Available: ${buy.remaining.toFixed(6)}` };
    
    const costBasis = amountToSell * buy.price;
    const proceeds = amountToSell * sellPricePerUnit;
    const realizedProfit = proceeds - costBasis;
    
    const newSell = {
        id: Date.now(),
        buyId: buy.id,
        amount: amountToSell,
        sellPrice: sellPricePerUnit,
        sellDate: sellDate,
        profit: realizedProfit
    };
    sells.push(newSell);
    buy.remaining -= amountToSell;
    saveAll();
    return { success: true, profit: realizedProfit };
}

function addBuy(wallet, asset, amount, price, date) {
    if(!wallet || !asset || amount<=0 || price<=0 || !date) return false;
    const newBuy = {
        id: nextBuyId++,
        wallet: wallet.trim(),
        asset: asset.trim().toUpperCase(),
        amount: parseFloat(amount),
        price: parseFloat(price),
        date: date,
        remaining: parseFloat(amount)
    };
    buys.push(newBuy);
    saveAll();
    return true;
}

function deleteBuy(buyId) {
    const linkedSells = sells.filter(s => s.buyId == buyId);
    if(linkedSells.length > 0) {
        alert(`Cannot delete buy: ${linkedSells.length} sell(s) linked. Delete sells first.`);
        return false;
    }
    buys = buys.filter(b => b.id !== buyId);
    saveAll();
    return true;
}

function deleteSell(sellId) {
    const sell = sells.find(s => s.id == sellId);
    if(!sell) return;
    const buy = buys.find(b => b.id == sell.buyId);
    if(buy) {
        buy.remaining += sell.amount;
    }
    sells = sells.filter(s => s.id !== sellId);
    saveAll();
}

// Price helper
function getCurrentPriceForAsset(asset) {
    if (currentPrices[asset] && currentPrices[asset] > 0) {
        return currentPrices[asset];
    }
    const btcPrice = parseFloat(document.getElementById('currentBTC')?.value) || 0;
    const xautPrice = parseFloat(document.getElementById('currentXAUT')?.value) || 0;
    const ethPrice = parseFloat(document.getElementById('currentETH')?.value) || 0;
    
    const priceMap = {
        'BTC': btcPrice,
        'XAUT': xautPrice,
        'ETH': ethPrice
    };
    return priceMap[asset] || 0;
}

// Unrealized PnL calculation
function calculateUnrealizedPnl() {
    const btcPrice = getCurrentPriceForAsset('BTC');
    const xautPrice = getCurrentPriceForAsset('XAUT');
    const ethPrice = getCurrentPriceForAsset('ETH');
    
    const priceMap = {
        'BTC': btcPrice,
        'XAUT': xautPrice,
        'ETH': ethPrice
    };
    
    let totalUnrealized = 0;
    
    for(let buy of buys) {
        if(buy.remaining > 0.000001) {
            const currentPrice = priceMap[buy.asset];
            if(currentPrice > 0) {
                const currentValue = buy.remaining * currentPrice;
                const costBasis = buy.remaining * buy.price;
                const unrealized = currentValue - costBasis;
                totalUnrealized += unrealized;
            }
        }
    }
    
    const unrealizedElement = document.getElementById('unrealizedPnl');
    if(unrealizedElement) {
        unrealizedElement.innerHTML = totalUnrealized >= 0 ? `+$${totalUnrealized.toFixed(2)}` : `-$${Math.abs(totalUnrealized).toFixed(2)}`;
        unrealizedElement.style.color = totalUnrealized >= 0 ? '#1f8a4c' : '#c2412c';
    }
    
    return totalUnrealized;
}

// Live price fetching from CoinGecko
async function fetchLivePrices() {
    try {
        const statusEl = document.getElementById('priceStatus');
        if (statusEl) {
            statusEl.innerHTML = '🟡 Fetching prices...';
            statusEl.style.background = '#fff3cd';
        }
        
        const assetIds = Object.values(assetToCoinGeckoId).join(',');
        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${assetIds}&vs_currencies=usd`;
        
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        for (const [asset, coinId] of Object.entries(assetToCoinGeckoId)) {
            if (data[coinId] && data[coinId].usd) {
                currentPrices[asset] = data[coinId].usd;
            }
        }
        
        const btcInput = document.getElementById('currentBTC');
        const ethInput = document.getElementById('currentETH');
        const xautInput = document.getElementById('currentXAUT');
        
        if (btcInput && currentPrices['BTC'] > 0) btcInput.value = currentPrices['BTC'];
        if (ethInput && currentPrices['ETH'] > 0) ethInput.value = currentPrices['ETH'];
        if (xautInput && currentPrices['XAUT'] > 0) xautInput.value = currentPrices['XAUT'];
        
        if (statusEl) {
            const timestamp = new Date().toLocaleTimeString();
            statusEl.innerHTML = `🟢 Live • Last update: ${timestamp}`;
            statusEl.style.background = '#d4edda';
        }
        
        calculateUnrealizedPnl();
        renderLedger();
        
        const selectedOption = document.getElementById('sellBuyId');
        if (selectedOption && selectedOption.value) {
            const selectedBuyId = parseInt(selectedOption.value);
            const currentBuy = buys.find(b => b.id === selectedBuyId);
            if (currentBuy && currentBuy.remaining > 0) {
                const currentPrice = getCurrentPriceForAsset(currentBuy.asset);
                const currentValue = currentBuy.remaining * currentPrice;
                const costBasis = currentBuy.remaining * currentBuy.price;
                const unrealizedPnl = currentValue - costBasis;
                
                document.getElementById('detailCurrentValue').innerHTML = currentPrice > 0 ? `$${currentValue.toFixed(2)}` : '—';
                const unrealizedEl = document.getElementById('detailUnrealized');
                if (unrealizedEl) {
                    unrealizedEl.innerHTML = currentPrice > 0 ? (unrealizedPnl >= 0 ? `+$${unrealizedPnl.toFixed(2)}` : `-$${Math.abs(unrealizedPnl).toFixed(2)}`) : '—';
                    unrealizedEl.style.color = unrealizedPnl >= 0 ? '#1f8a4c' : '#c2412c';
                }
            }
        }
        
        return true;
        
    } catch (error) {
        console.error('Price fetch error:', error);
        const statusEl = document.getElementById('priceStatus');
        if (statusEl) {
            statusEl.innerHTML = '🔴 Failed to fetch. Click Refresh';
            statusEl.style.background = '#f8d7da';
        }
        return false;
    }
}

function startAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }
    autoRefreshInterval = setInterval(() => {
        if (autoRefreshEnabled) {
            fetchLivePrices();
        }
    }, 10000);
}

function toggleAutoRefresh() {
    autoRefreshEnabled = !autoRefreshEnabled;
    const btn = document.getElementById('toggleAutoRefreshBtn');
    if (autoRefreshEnabled) {
        btn.innerHTML = '⏸️ Pause Auto-Refresh';
        btn.style.background = '#eef2f8';
        fetchLivePrices();
    } else {
        btn.innerHTML = '▶️ Resume Auto-Refresh';
        btn.style.background = '#f8f9fa';
    }
}

// UI update
function updateStats() {
    const totalCostAllBuys = buys.reduce((sum, b) => sum + (b.amount * b.price), 0);
    const totalProceeds = sells.reduce((sum, s) => sum + (s.amount * s.sellPrice), 0);
    const totalProfit = sells.reduce((sum, s) => sum + s.profit, 0);
    const openPositions = buys.filter(b => b.remaining > 0.000001).length;
    
    document.getElementById('totalCost').innerHTML = `$${totalCostAllBuys.toFixed(2)}<span class="stat-sub">total bought</span>`;
    document.getElementById('totalSold').innerHTML = `$${totalProceeds.toFixed(2)}<span class="stat-sub">from sells</span>`;
    document.getElementById('totalProfit').innerHTML = totalProfit >= 0 ? `+$${totalProfit.toFixed(2)}` : `-$${Math.abs(totalProfit).toFixed(2)}`;
    document.getElementById('totalProfit').style.color = totalProfit >= 0 ? '#1f8a4c' : '#c2412c';
    document.getElementById('openPositions').innerText = openPositions;
    
    calculateUnrealizedPnl();
}

function updateSellDropdown() {
    const select = document.getElementById('sellBuyId');
    const openBuys = buys.filter(b => b.remaining > 0.000001);
    select.innerHTML = '';
    
    // Add empty/default option
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = '-- Select a position to sell --';
    emptyOption.disabled = false;
    emptyOption.selected = true;
    select.appendChild(emptyOption);
    
    if(openBuys.length === 0) {
        const noOption = document.createElement('option');
        noOption.value = '';
        noOption.textContent = 'No open buys — add a buy first';
        noOption.disabled = true;
        select.appendChild(noOption);
    } else {
        openBuys.forEach(b => {
            const option = document.createElement('option');
            option.value = b.id;
            option.textContent = `${b.wallet} | ${b.asset} | ${b.remaining.toFixed(6)} left @ $${b.price} (bought ${b.date})`;
            select.appendChild(option);
        });
    }
    
    // Hide details panel when dropdown is empty/default
    updateSellSliderMax();
}

function buildLedgerData() {
    const buyEntries = buys.map(b => ({ 
        type: 'buy', 
        date: b.date, 
        wallet: b.wallet, 
        asset: b.asset, 
        amount: b.amount, 
        price: b.price,
        total: b.amount * b.price,
        profit: null,
        id: b.id,
        isBuy: true,
        remaining: b.remaining,
        currentPrice: getCurrentPriceForAsset(b.asset),
        unrealized: null
    }));
    
    const sellEntries = sells.map(s => {
        const buyRef = buys.find(b => b.id == s.buyId);
        return {
            type: 'sell',
            date: s.sellDate,
            wallet: buyRef ? buyRef.wallet : '?',
            asset: buyRef ? buyRef.asset : '?',
            amount: s.amount,
            price: s.sellPrice,
            total: s.amount * s.sellPrice,
            profit: s.profit,
            id: s.id,
            isBuy: false,
            buyId: s.buyId,
            currentPrice: null,
            unrealized: null
        };
    });
    
    for (let entry of buyEntries) {
        if (entry.remaining > 0.000001 && entry.currentPrice > 0) {
            const currentValue = entry.remaining * entry.currentPrice;
            const costBasis = entry.remaining * entry.price;
            entry.unrealized = currentValue - costBasis;
        }
    }
    
    return [...buyEntries, ...sellEntries];
}

function sortLedgerData(data) {
    return [...data].sort((a, b) => {
        let aVal = a[currentSort.column];
        let bVal = b[currentSort.column];
        
        if (currentSort.column === 'date') {
            aVal = new Date(aVal);
            bVal = new Date(bVal);
        } else if (currentSort.column === 'amount' || currentSort.column === 'price' || currentSort.column === 'total' || currentSort.column === 'profit') {
            aVal = parseFloat(aVal) || 0;
            bVal = parseFloat(bVal) || 0;
        } else {
            aVal = String(aVal || '').toLowerCase();
            bVal = String(bVal || '').toLowerCase();
        }
        
        if (aVal < bVal) return currentSort.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return currentSort.direction === 'asc' ? 1 : -1;
        return 0;
    });
}

function renderLedger() {
    const tbody = document.getElementById('ledgerBody');
    if (!tbody) return;
    
    ledgerData = buildLedgerData();
    const sortedData = sortLedgerData(ledgerData);
    
    const startIndex = (currentPage - 1) * rowsPerPage;
    const endIndex = startIndex + rowsPerPage;
    const paginatedData = sortedData.slice(startIndex, endIndex);
    
    const totalPages = Math.ceil(sortedData.length / rowsPerPage);
    document.getElementById('pageInfo').innerHTML = `Page ${currentPage} of ${totalPages || 1}`;
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');
    if (prevBtn) prevBtn.disabled = currentPage === 1;
    if (nextBtn) nextBtn.disabled = currentPage === totalPages || totalPages === 0;
    
    tbody.innerHTML = '';
    
    for(let row of paginatedData) {
        const tr = document.createElement('tr');
        if(row.type === 'buy') {
            let unrealizedCell = '—';
            let currentPriceDisplay = '—';
            
            if(row.remaining > 0.000001 && row.currentPrice > 0) {
                currentPriceDisplay = `$${row.currentPrice.toFixed(2)}`;
                const unrealizedClass = row.unrealized >= 0 ? 'profit-positive' : 'profit-negative';
                unrealizedCell = `<span class="${unrealizedClass}">${row.unrealized >= 0 ? '+' : ''}$${row.unrealized.toFixed(2)}</span>`;
            }
            
            tr.innerHTML = `
                <td>${row.date}</td>
                <td>🟢 BUY</td>
                <td>${row.wallet}</td>
                <td>${row.asset}</td>
                <td>${row.amount.toFixed(6)} (${row.remaining.toFixed(6)} open)</td>
                <td>$${row.price.toFixed(2)}</td>
                <td>$${row.total.toFixed(2)}</td>
                <td>${currentPriceDisplay}</td>
                <td>${unrealizedCell}</td>
                <td><button class="delete-btn btn-small" data-type="buy" data-id="${row.id}">✖</button></td>
            `;
        } else {
            const profitClass = row.profit >=0 ? 'profit-positive' : 'profit-negative';
            tr.innerHTML = `
                <td>${row.date}</td>
                <td>🔴 SELL</td>
                <td>${row.wallet}</td>
                <td>${row.asset}</td>
                <td>${row.amount.toFixed(6)}</td>
                <td>$${row.price.toFixed(2)}</td>
                <td>$${row.total.toFixed(2)}</td>
                <td>—</td>
                <td class="${profitClass}">${row.profit>=0 ? '+' : ''}$${row.profit.toFixed(2)}</td>
                <td><button class="delete-btn btn-small" data-type="sell" data-id="${row.id}">✖</button></td>
            `;
        }
        tbody.appendChild(tr);
    }
    
    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const type = btn.getAttribute('data-type');
            const id = parseInt(btn.getAttribute('data-id'));
            if(type === 'buy') {
                if(confirm('Delete this BUY? (only possible if no linked sells)')) deleteBuy(id);
            } else {
                if(confirm('Delete this SELL? (amount will be returned to buy)')) deleteSell(id);
            }
            updateUI();
        });
    });
}

function updateUI() {
    updateStats();
    updateSellDropdown();
    renderLedger();
}

// Slider functionality
function setupSliders() {
    const buyAmountInput = document.getElementById('buyAmount');
    const buyAmountSlider = document.getElementById('buyAmountSlider');
    
    if (buyAmountInput && buyAmountSlider) {
        buyAmountInput.addEventListener('input', () => {
            let val = parseFloat(buyAmountInput.value) || 0;
            buyAmountSlider.value = Math.min(1, val);
        });
        
        buyAmountSlider.addEventListener('input', () => {
            let val = parseFloat(buyAmountSlider.value);
            buyAmountInput.value = val.toFixed(6);
        });
        
        document.querySelectorAll('.quick-btn[data-amount]').forEach(btn => {
            btn.addEventListener('click', () => {
                let amount = parseFloat(btn.getAttribute('data-amount'));
                buyAmountInput.value = amount;
                buyAmountSlider.value = Math.min(1, amount);
            });
        });
    }
    
    const sellAmountInput = document.getElementById('sellAmount');
    const sellAmountSlider = document.getElementById('sellAmountSlider');
    
    if (sellAmountInput && sellAmountSlider) {
        sellAmountInput.addEventListener('input', () => {
            let val = parseFloat(sellAmountInput.value) || 0;
            sellAmountSlider.value = val;
        });
        
        sellAmountSlider.addEventListener('input', () => {
            let val = parseFloat(sellAmountSlider.value);
            sellAmountInput.value = val.toFixed(6);
        });
    }
}

function updateSellSliderMax() {
    const selectedOption = document.getElementById('sellBuyId');
    const selectedBuyId = parseInt(selectedOption?.value);
    const buy = buys.find(b => b.id === selectedBuyId);
    const sellAmountSlider = document.getElementById('sellAmountSlider');
    const sellAmountInput = document.getElementById('sellAmount');
    const detailsPanel = document.getElementById('sellDetailsPanel');
    
    // Hide details panel if no valid buy selected
    if (!selectedBuyId || !buy || buy.remaining <= 0) {
        if (detailsPanel) detailsPanel.style.display = 'none';
        
        // Reset sell amount inputs
        if (sellAmountInput) sellAmountInput.value = '';
        if (sellAmountSlider) sellAmountSlider.value = 0;
        sellAmountSlider.max = 1;
        
        // Reset percentage buttons to simple percentages
        const sellQuickContainer = document.getElementById('sellQuickButtons');
        if (sellQuickContainer) {
            const percentages = [0.25, 0.5, 0.75, 1];
            sellQuickContainer.innerHTML = percentages.map(p => 
                `<button type="button" class="quick-btn" data-percent="${p}">${p*100}%</button>`
            ).join('');
            
            sellQuickContainer.querySelectorAll('.quick-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const percent = parseFloat(btn.getAttribute('data-percent'));
                    if (!isNaN(percent) && buy && selectedBuyId) {
                        const amount = (buy.remaining * percent).toFixed(6);
                        if (sellAmountInput && sellAmountSlider) {
                            sellAmountInput.value = amount;
                            sellAmountSlider.value = amount;
                            sellAmountInput.dispatchEvent(new Event('input'));
                        }
                    } else {
                        alert('Please select a position first');
                    }
                });
            });
        }
        return;
    }
    
    // Show details panel for valid selection
    if (detailsPanel) detailsPanel.style.display = 'block';
    
    const maxAmount = buy.remaining;
    sellAmountSlider.max = maxAmount;
    sellAmountSlider.step = maxAmount / 1000;
    
    const currentPrice = getCurrentPriceForAsset(buy.asset);
    const currentValue = buy.remaining * currentPrice;
    const costBasis = buy.remaining * buy.price;
    const unrealizedPnl = currentValue - costBasis;
    
    document.getElementById('detailAsset').innerHTML = buy.asset;
    document.getElementById('detailWallet').innerHTML = buy.wallet;
    document.getElementById('detailBuyPrice').innerHTML = `$${buy.price.toFixed(2)}`;
    document.getElementById('detailRemaining').innerHTML = `${buy.remaining.toFixed(6)} ${buy.asset}`;
    document.getElementById('detailCostBasis').innerHTML = `$${costBasis.toFixed(2)}`;
    document.getElementById('detailCurrentValue').innerHTML = currentPrice > 0 ? `$${currentValue.toFixed(2)}` : '—';
    const unrealizedEl = document.getElementById('detailUnrealized');
    if (unrealizedEl) {
        unrealizedEl.innerHTML = currentPrice > 0 ? (unrealizedPnl >= 0 ? `+$${unrealizedPnl.toFixed(2)}` : `-$${Math.abs(unrealizedPnl).toFixed(2)}`) : '—';
        unrealizedEl.style.color = unrealizedPnl >= 0 ? '#f97316' : '#dc2626';
    }
    document.getElementById('detailBuyDate').innerHTML = buy.date;
    
    const sellQuickContainer = document.getElementById('sellQuickButtons');
    if (sellQuickContainer) {
        const percentages = [0.25, 0.5, 0.75, 1];
        sellQuickContainer.innerHTML = percentages.map(p => {
            const amount = (buy.remaining * p).toFixed(6);
            return `<button type="button" class="quick-btn" data-percent="${p}" data-amount-value="${amount}">${p*100}% (${amount})</button>`;
        }).join('');
        
        sellQuickContainer.querySelectorAll('.quick-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const amountValue = parseFloat(btn.getAttribute('data-amount-value'));
                if (!isNaN(amountValue) && sellAmountInput && sellAmountSlider) {
                    sellAmountInput.value = amountValue.toFixed(6);
                    sellAmountSlider.value = amountValue;
                    sellAmountInput.dispatchEvent(new Event('input'));
                }
            });
        });
    }
}

// Sortable headers
function setupSortableHeaders() {
    const headers = [
        { column: 'date', index: 1 },
        { column: 'type', index: 2 },
        { column: 'wallet', index: 3 },
        { column: 'asset', index: 4 },
        { column: 'amount', index: 5 },
        { column: 'price', index: 6 },
        { column: 'total', index: 7 }
    ];
    
    headers.forEach(h => {
        const header = document.querySelector(`th:nth-child(${h.index})`);
        if (header) {
            header.classList.add('sortable');
            header.addEventListener('click', () => {
                if (currentSort.column === h.column) {
                    currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
                } else {
                    currentSort.column = h.column;
                    currentSort.direction = 'asc';
                }
                currentPage = 1;
                renderLedger();
                updateSortIndicators();
            });
        }
    });
}

function updateSortIndicators() {
    const indices = { date: 1, type: 2, wallet: 3, asset: 4, amount: 5, price: 6, total: 7 };
    const activeIndex = indices[currentSort.column];
    document.querySelectorAll('.sortable').forEach(el => {
        el.classList.remove('asc', 'desc');
    });
    const activeHeader = document.querySelector(`th:nth-child(${activeIndex})`);
    if (activeHeader) {
        activeHeader.classList.add(currentSort.direction);
    }
}

// Collapsible sections - START COLLAPSED BY DEFAULT
function setupCollapsible() {
    const buyHeader = document.getElementById('buySectionHeader');
    const buyContent = document.getElementById('buySectionContent');
    const sellHeader = document.getElementById('sellSectionHeader');
    const sellContent = document.getElementById('sellSectionContent');
    
    if (buyHeader && buyContent) {
        // Start collapsed
        buyContent.classList.add('collapsed');
        buyHeader.classList.add('collapsed');
        
        buyHeader.addEventListener('click', () => {
            buyContent.classList.toggle('collapsed');
            buyHeader.classList.toggle('collapsed');
        });
    }
    
    if (sellHeader && sellContent) {
        // Start collapsed
        sellContent.classList.add('collapsed');
        sellHeader.classList.add('collapsed');
        
        sellHeader.addEventListener('click', () => {
            sellContent.classList.toggle('collapsed');
            sellHeader.classList.toggle('collapsed');
        });
    }
}

// Pagination event listeners
function setupPagination() {
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');
    const rowsSelect = document.getElementById('rowsPerPageSelect');
    
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                renderLedger();
            }
        });
    }
    
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            const totalPages = Math.ceil(ledgerData.length / rowsPerPage);
            if (currentPage < totalPages) {
                currentPage++;
                renderLedger();
            }
        });
    }
    
    if (rowsSelect) {
        rowsSelect.addEventListener('change', (e) => {
            rowsPerPage = parseInt(e.target.value);
            currentPage = 1;
            renderLedger();
        });
    }
}

// USD Balance event listeners
function setupUsdControls() {
    const addBtn = document.getElementById('usdAddBtn');
    const withdrawBtn = document.getElementById('usdWithdrawBtn');
    const amountInput = document.getElementById('usdAddAmount');
    
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            const amount = parseFloat(amountInput?.value);
            if (!isNaN(amount) && amount > 0) {
                addUsd(amount);
                amountInput.value = '';
            } else {
                alert('Please enter a valid amount');
            }
        });
    }
    
    if (withdrawBtn) {
        withdrawBtn.addEventListener('click', () => {
            const amount = parseFloat(amountInput?.value);
            if (!isNaN(amount) && amount > 0) {
                withdrawUsd(amount);
                amountInput.value = '';
            } else {
                alert('Please enter a valid amount');
            }
        });
    }
}

document.getElementById('addSellBtn').addEventListener('click', () => {
    const selectedValue = document.getElementById('sellBuyId').value;
    if(!selectedValue || selectedValue === '') { 
        alert("Please select a position to sell from the dropdown"); 
        return; 
    }
    const buyId = parseInt(selectedValue);
    if(isNaN(buyId)) { alert("No open buy selected"); return; }
    let amount = parseFloat(document.getElementById('sellAmount').value);
    const sellPrice = parseFloat(document.getElementById('sellPrice').value);
    let sellDate = document.getElementById('sellDate').value;
    if(!sellDate) sellDate = new Date().toISOString().slice(0,10);
    if(isNaN(amount) || isNaN(sellPrice) || amount<=0 || sellPrice<=0) {
        alert("Valid amount and sell price required");
        return;
    }
    const buy = buys.find(b => b.id == buyId);
    if(buy && amount > buy.remaining) {
        alert(`Max sellable: ${buy.remaining.toFixed(6)}`);
        return;
    }
    const result = addSellTransaction(buyId, amount, sellPrice, sellDate);
    if(result.success) {
        updateUI();
        document.getElementById('sellAmount').value = '';
        document.getElementById('sellPrice').value = '';
        // Reset dropdown to empty option after successful sell
        const dropdown = document.getElementById('sellBuyId');
        if(dropdown) dropdown.value = '';
        // Hide details panel
        const detailsPanel = document.getElementById('sellDetailsPanel');
        if(detailsPanel) detailsPanel.style.display = 'none';
    } else {
        alert(result.error);
    }
});

// Import CSV functionality
document.getElementById('importCSVBtn').addEventListener('click', () => {
    document.getElementById('importFileInput').click();
});

document.getElementById('importFileInput').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const csvContent = e.target.result;
        const lines = csvContent.split('\n');
        const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
        
        let importedBuys = 0;
        let importedSells = 0;
        
        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            
            const values = lines[i].split(',').map(v => v.replace(/"/g, '').trim());
            const row = {};
            headers.forEach((header, idx) => { row[header] = values[idx]; });
            
            if (row.Type === 'BUY') {
                const newBuy = {
                    id: nextBuyId++,
                    wallet: row.Wallet || 'Main',
                    asset: row.Asset?.toUpperCase() || 'BTC',
                    amount: parseFloat(row.Amount),
                    price: parseFloat(row['Price USD']),
                    date: row.Date,
                    remaining: parseFloat(row.Amount)
                };
                if (!isNaN(newBuy.amount) && !isNaN(newBuy.price) && newBuy.date) {
                    buys.push(newBuy);
                    importedBuys++;
                }
            } else if (row.Type === 'SELL') {
                const profit = parseFloat(row['Realized P&L USD']);
                const newSell = {
                    id: Date.now() + i,
                    buyId: null,
                    amount: parseFloat(row.Amount),
                    sellPrice: parseFloat(row['Price USD']),
                    sellDate: row.Date,
                    profit: isNaN(profit) ? 0 : profit
                };
                if (!isNaN(newSell.amount) && !isNaN(newSell.sellPrice) && newSell.sellDate) {
                    sells.push(newSell);
                    importedSells++;
                }
            }
        }
        
        for (let sell of sells) {
            if (!sell.buyId) {
                const matchingBuys = buys.filter(b => 
                    b.asset === sell.asset && 
                    Math.abs(b.price - sell.sellPrice) < b.price * 0.1
                );
                if (matchingBuys.length > 0) {
                    sell.buyId = matchingBuys[0].id;
                }
            }
        }
        
        recalcRemainingFromSells();
        saveAll();
        updateUI();
        alert(`Imported ${importedBuys} buys and ${importedSells} sells`);
    };
    reader.readAsText(file);
    event.target.value = '';
});

// Event listeners
document.getElementById('addBuyBtn').addEventListener('click', () => {
    const wallet = document.getElementById('buyWallet').value.trim();
    const asset = document.getElementById('buyAsset').value;
    const amount = parseFloat(document.getElementById('buyAmount').value);
    const price = parseFloat(document.getElementById('buyPrice').value);
    let date = document.getElementById('buyDate').value;
    if(!date) date = new Date().toISOString().slice(0,10);
    if(!wallet || !asset || isNaN(amount) || isNaN(price) || amount<=0 || price<=0) {
        alert("Please fill all fields (amount & price >0)");
        return;
    }
    addBuy(wallet, asset, amount, price, date);
    updateUI();
    document.getElementById('buyAmount').value = '';
    document.getElementById('buyPrice').value = '';
});

document.getElementById('addSellBtn').addEventListener('click', () => {
    const buyId = parseInt(document.getElementById('sellBuyId').value);
    if(isNaN(buyId)) { alert("No open buy selected"); return; }
    let amount = parseFloat(document.getElementById('sellAmount').value);
    const sellPrice = parseFloat(document.getElementById('sellPrice').value);
    let sellDate = document.getElementById('sellDate').value;
    if(!sellDate) sellDate = new Date().toISOString().slice(0,10);
    if(isNaN(amount) || isNaN(sellPrice) || amount<=0 || sellPrice<=0) {
        alert("Valid amount and sell price required");
        return;
    }
    const buy = buys.find(b => b.id == buyId);
    if(buy && amount > buy.remaining) {
        alert(`Max sellable: ${buy.remaining.toFixed(6)}`);
        return;
    }
    const result = addSellTransaction(buyId, amount, sellPrice, sellDate);
    if(result.success) {
        updateUI();
        document.getElementById('sellAmount').value = '';
        document.getElementById('sellPrice').value = '';
    } else {
        alert(result.error);
    }
});

document.getElementById('exportCSVBtn').addEventListener('click', () => {
    let csvRows = [["Date","Type","Wallet","Asset","Amount","Price USD","Total USD","Realized P&L USD"]];
    const allRows = [];
    buys.forEach(b => {
        allRows.push([b.date,"BUY",b.wallet,b.asset,b.amount,b.price,b.amount*b.price,""]);
    });
    sells.forEach(s => {
        const buyRef = buys.find(b=>b.id==s.buyId);
        const wallet = buyRef?.wallet || "";
        const asset = buyRef?.asset || "";
        allRows.push([s.sellDate,"SELL",wallet,asset,s.amount,s.sellPrice,s.amount*s.sellPrice,s.profit]);
    });
    allRows.sort((a,b)=> (a[0] < b[0] ? -1 : 1));
    allRows.forEach(row => csvRows.push(row));
    const csv = csvRows.map(row => row.map(cell => `"${cell}"`).join(",")).join("\n");
    const blob = new Blob([csv], {type: "text/csv"});
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `ledgrs_export_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
});

document.getElementById('refreshNowBtn')?.addEventListener('click', () => {
    fetchLivePrices();
});

document.getElementById('toggleAutoRefreshBtn')?.addEventListener('click', toggleAutoRefresh);

const sellBuySelect = document.getElementById('sellBuyId');
if (sellBuySelect) {
    sellBuySelect.addEventListener('change', () => {
        updateSellSliderMax();
        const sellAmountInput = document.getElementById('sellAmount');
        const sellAmountSlider = document.getElementById('sellAmountSlider');
        if (sellAmountInput) sellAmountInput.value = '';
        if (sellAmountSlider) sellAmountSlider.value = 0;
    });
}

// Initialize price fetching
async function initPriceFetching() {
    await fetchLivePrices();
    startAutoRefresh();
}

// Initial load
loadUsdBalance();
loadData();
setupSliders();
setupCollapsible();
setupSortableHeaders();
setupPagination();
setupUsdControls();
updateUI();
initPriceFetching();

if(!document.getElementById('buyDate').value) document.getElementById('buyDate').value = new Date().toISOString().slice(0,10);
if(!document.getElementById('sellDate').value) document.getElementById('sellDate').value = new Date().toISOString().slice(0,10);