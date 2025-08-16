let coins = [];
let currentCurrency = "usd";
let currentCoinId = null;
let currentCoinName = "";
let currentTimeframe = 1;
let chart = null;
let watchlist = JSON.parse(localStorage.getItem('watchlist')) || [];
let portfolio = JSON.parse(localStorage.getItem('portfolio')) || [];
let isLoading = false;
let fxRates = { inr:1, gbp:1, jpy:1 };

// DOM elements
const coinList       = document.getElementById("coinList");
const currencySelect = document.getElementById("currencySelect");
const searchInput    = document.getElementById("searchInput");
const chartTitle     = document.getElementById("chartTitle");
const coinDetails    = document.getElementById("coinDetails");
const watchlistBtn   = document.getElementById("watchlistBtn");
const portfolioBtn   = document.getElementById("portfolioBtn");
const addHoldingBtn  = document.getElementById("addHoldingBtn");

// Expose handlers
window.toggleWatchlist = toggleWatchlist;
window.showWatchlist   = showWatchlist;
window.showPortfolio   = showPortfolio;

window.addEventListener('load', async () => {
  currentCurrency = currencySelect.value || "usd";
  await fetchFxRates();
  if (typeof Chart === 'undefined') {
    chartTitle.textContent = "Chart.js not loaded";
    return;
  }
  setupEventListeners();
  fetchCoins();
  setInterval(fetchCoins, 120000);
});

async function fetchFxRates() {
  try {
    const res = await fetch("https://v6.exchangerate-api.com/v6/4286e21f76e6c20dee3a5eb7/latest/USD");
    const data = await res.json();
    fxRates.inr = data.conversion_rates.INR;
    fxRates.gbp = data.conversion_rates.GBP;
    fxRates.jpy = data.conversion_rates.JPY;
  } catch {
    // keep defaults
  }
}

function convertUsd(amount) {
  if (currentCurrency === "usd") return amount;
  if (currentCurrency === "eur" && fxRates.EUR) return amount * fxRates.EUR;
  const rate = fxRates[currentCurrency];
  return rate ? amount * rate : amount;
}

function formatCurrency(v) {
  if (v == null) return 'N/A';
  const map = { usd:'en-US', eur:'en-EU', inr:'en-IN', gbp:'en-GB', jpy:'ja-JP' };
  const locale = map[currentCurrency] || 'en-US';
  return new Intl.NumberFormat(locale, {
    style:'currency',
    currency: currentCurrency.toUpperCase()
  }).format(v);
}

function formatNumber(v) {
  if (v == null) return 'N/A';
  if (v >= 1e12) return (v/1e12).toFixed(2)+'T';
  if (v >= 1e9 ) return (v/1e9 ).toFixed(2)+'B';
  if (v >= 1e6 ) return (v/1e6 ).toFixed(2)+'M';
  if (v >= 1e3 ) return (v/1e3 ).toFixed(2)+'K';
  return v.toLocaleString();
}

function setupEventListeners() {
  currencySelect.addEventListener("change", () => {
    currentCurrency = currencySelect.value;
    displayCoins(coins);
    loadChartWithRetry(currentCoinId, currentCoinName);
  });
  searchInput.addEventListener("input", handleSearch);
  document.querySelectorAll('.timeframe-btn').forEach(btn =>
    btn.addEventListener('click', e => handleTimeframeChange(e.target))
  );
  watchlistBtn.addEventListener('click', showWatchlist);
  portfolioBtn.addEventListener('click', showPortfolio);
  addHoldingBtn.addEventListener('click', addHolding);
}

async function fetchCoins() {
  try {
    coinList.innerHTML = '<div class="loading">Loading coins...</div>';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/markets?` +
      `vs_currency=usd&order=market_cap_desc&per_page=50&page=1` +
      `&sparkline=true&price_change_percentage=24h`,
      { mode:'cors', signal: controller.signal }
    );
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(res.statusText);
    coins = await res.json();
    if (!coins.length) throw new Error("No coins found");
    if (!currentCoinId) {
      currentCoinId   = coins[0].id;
      currentCoinName = coins.name;
    }
    displayCoins(coins);
    setTimeout(() => loadChartWithRetry(currentCoinId, currentCoinName), 500);
  } catch (err) {
    const msg = err.name==='AbortError'? 'Request timed out' : err.message;
    coinList.innerHTML = `<div class="coin-card">⚠️ ${msg}</div>`;
  }
}

function displayCoins(data) {
  coinList.innerHTML = "";
  data.forEach(c => {
    const card = document.createElement("div");
    card.className = "coin-card" + (c.id===currentCoinId ? " selected" : "");
    const ch = (c.price_change_percentage_24h||0).toFixed(2);
    const price = convertUsd(c.current_price);
    card.innerHTML = `
      <div class="coin-header">
        <div class="coin-title">
          <img src="${c.image}" class="coin-logo" onerror="this.style.display='none'">
          <div>
            <div class="coin-name">${c.name}</div>
            <div class="coin-symbol">${c.symbol.toUpperCase()}</div>
          </div>
        </div>
        <button class="action-btn">${watchlist.includes(c.id)?'★':'☆'}</button>
      </div>
      <div class="coin-stats">
        <div class="stat-item"><span class="stat-label">Price</span>
          <span class="stat-value price-value">${formatCurrency(price)}</span>
        </div>
        <div class="stat-item"><span class="stat-label">24h Change</span>
          <span class="stat-value ${ch>=0?'change-positive':'change-negative'}">
            ${ch>=0?'+':''}${ch}%
          </span>
        </div>
        <div class="stat-item"><span class="stat-label">Market Cap</span>
          <span class="stat-value">${formatNumber(convertUsd(c.market_cap))}</span>
        </div>
        <div class="stat-item"><span class="stat-label">Volume</span>
          <span class="stat-value">${formatNumber(convertUsd(c.total_volume))}</span>
        </div>
      </div>
    `;
    card.querySelector('.action-btn').addEventListener('click', e=>{
      e.stopPropagation(); toggleWatchlist(c.id);
    });
    card.addEventListener('click',()=>{
      currentCoinId=c.id; currentCoinName=c.name;
      displayCoins(coins);
      loadChartWithRetry(c.id,c.name);
      loadCoinDetails(c.id);
    });
    coinList.appendChild(card);
  });
}

async function loadChartWithRetry(coinId, coinName, retries=3) {
  for(let i=0;i<retries;i++){
    try { await loadChart(coinId, coinName); return; }
    catch { if(i<retries-1) await new Promise(r=>setTimeout(r,(i+1)*1000)); }
  }
  chartTitle.textContent=`${coinName} Chart (Unavailable)`;
}

async function loadChart(coinId, coinName="") {
  if(!coinId||isLoading) throw new Error("Busy");
  isLoading=true;
  chartTitle.textContent=`Loading ${coinName} chart…`;
  let prices;
  try {
    const controller=new AbortController();
    const timeoutId=setTimeout(()=>controller.abort(),10000);
    const res=await fetch(
      `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?`+
      `vs_currency=usd&days=${currentTimeframe}`,
      {mode:'cors',signal:controller.signal}
    );
    clearTimeout(timeoutId);
    if(res.status===404) throw new Error("Endpoint unsupported");
    if(!res.ok) throw new Error(res.statusText);
    const data=await res.json();
    if(!data.prices?.length) throw new Error("No data");
    prices=data.prices;
  } catch {
    const coin=coins.find(x=>x.id===coinId);
    if(coin?.sparkline_in_7d?.price){
      prices=coin.sparkline_in_7d.price.map((p,i)=>{
        const start=Date.now()-7*24*60*60*1e3;
        const ts=start+(i/coin.sparkline_in_7d.price.length)*7*24*60*60*1e3;
        return [ts,p];
      });
    } else {
      chartTitle.textContent=`${coinName} Chart (No Data)`;
      isLoading=false;
      return;
    }
  }
  const labels=[],dataPts=[];
  const step=Math.max(1,Math.floor(prices.length/8));
  prices.forEach((p,i)=>{
    const d=new Date(p[0]);
    const lbl=currentTimeframe===1
      ?d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})
      :d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
    labels.push(i%step?'':lbl);
    dataPts.push(convertUsd(p[1]));
  });
  if(chart)chart.destroy();
  const ctx=document.getElementById("coinChart").getContext("2d");
  chart=new Chart(ctx,{
    type:'line',
    data:{labels,datasets:[{label:`${coinName} Price`,data:dataPts,borderColor:'#2ecc71',backgroundColor:'rgba(46,204,113,0.1)',tension:0.4,pointRadius:0}]},
    options:{responsive:true,maintainAspectRatio:false,scales:{x:{ticks:{color:'#fff'},grid:{color:'rgba(255,255,255,0.1)'}},y:{ticks:{color:'#fff',callback:v=>formatCurrency(v)},grid:{color:'rgba(255,255,255,0.1)'}}},plugins:{legend:{labels:{color:'#fff'}}}}
  });
  chartTitle.textContent=`${coinName} Price Chart (${getTimeframeLabel()})`;
  isLoading=false;
}

async function loadCoinDetails(coinId) {
  try {
    const res=await fetch(
      `https://api.coingecko.com/api/v3/coins/${coinId}?`+
      `localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`,
      {mode:'cors'}
    );
    const d=await res.json();
    coinDetails.innerHTML=`
      <div class="detail-row"><span class="detail-label">Rank:</span><span class="detail-value">#${d.market_cap_rank||'N/A'}</span></div>
      <div class="detail-row"><span class="detail-label">ATH:</span><span class="detail-value">${formatCurrency(convertUsd(d.market_data?.ath?.usd||0))}</span></div>
    `;
  } catch {
    const c=coins.find(x=>x.id===coinId);
    coinDetails.innerHTML=`
      <div class="detail-row"><span class="detail-label">Price:</span><span class="detail-value">${formatCurrency(convertUsd(c.current_price))}</span></div>
      <div class="detail-row"><span class="detail-label">24h Change:</span><span class="detail-value ${c.price_change_percentage_24h>=0?'change-positive':'change-negative'}">${(c.price_change_percentage_24h||0).toFixed(2)}%</span></div>
      <div class="detail-row"><span class="detail-label">Market Cap:</span><span class="detail-value">${formatNumber(convertUsd(c.market_cap))}</span></div>
      <div class="detail-row"><span class="detail-label">Volume:</span><span class="detail-value">${formatNumber(convertUsd(c.total_volume))}</span></div>
      <div class="detail-row"><em>Additional details are currently unavailable.</em></div>
    `;
  }
}

function handleTimeframeChange(btn) {
  if(isLoading) return;
  document.querySelectorAll('.timeframe-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  currentTimeframe=parseInt(btn.dataset.days);
  loadChartWithRetry(currentCoinId,currentCoinName);
}

function handleSearch(){
  const kw=searchInput.value.trim().toLowerCase();
  displayCoins(coins.filter(c=>
    c.name.toLowerCase().includes(kw)||c.symbol.toLowerCase().includes(kw)
  ));
}

function toggleWatchlist(id){
  watchlist.includes(id)?watchlist=watchlist.filter(x=>x!==id):watchlist.push(id);
  localStorage.setItem('watchlist',JSON.stringify(watchlist));
  displayCoins(coins);
}

function showWatchlist(){
  displayCoins(coins.filter(c=>watchlist.includes(c.id)));
}

function showPortfolio(){
  alert(`You have ${portfolio.length} item(s) in your portfolio.`);
}

function addHolding(){
  const qty=prompt("Enter quantity for "+currentCoinName);
  if(!qty||isNaN(qty))return alert("Invalid quantity");
  portfolio.push({id:currentCoinId,qty:parseFloat(qty)});
  localStorage.setItem('portfolio',JSON.stringify(portfolio));
  alert("Added to portfolio");
}

function getTimeframeLabel(){
  return {1:'1D',7:'7D',30:'30D',90:'90D',365:'1Y'}[currentTimeframe]||`${currentTimeframe}D`;
}
