/* ============================================================
 * 核心层：状态 / 工具 / 图表挂载 / 范围切换 / 单日钻取
 * ============================================================ */
window.Board = (function () {
  'use strict';

  const D = window.__DAILY__, S = window.__SPORTS__, H = window.__HOURLY__, META = window.__META__;
  const $ = s => document.querySelector(s);

  const state = {
    start: 0,
    end: D ? D.dates.length - 1 : 0,
    tab: 'overview',
    heatYear: null,      // 步数热力图当前年
    sportType: 'all',    // 运动类型筛选
    sortKey: 'd', sortDir: -1,
  };

  /* ---------------- 工具 ---------------- */
  const WD = ['日', '一', '二', '三', '四', '五', '六'];
  const weekday = d => '周' + WD[new Date(d + 'T00:00:00').getDay()];

  function fmtInt(n) { return n == null ? '—' : Math.round(n).toLocaleString('zh-CN'); }
  function fmtNum(n, p = 1) { return n == null ? '—' : (+n).toFixed(p); }
  function fmtDur(min) {
    if (min == null) return '—';
    min = Math.round(min);
    const h = Math.floor(min / 60), m = min % 60;
    if (!h) return `${m}分钟`;
    return m ? `${h}小时${m}分` : `${h}小时`;
  }
  function fmtDurS(sec) {
    if (sec == null) return '—';
    const h = Math.floor(sec / 3600), m = Math.round(sec % 3600 / 60);
    return h ? `${h}小时${m}分` : `${m}分钟`;
  }
  function fmtKm(m) { return m == null ? '—' : (m / 1000).toFixed(2) + ' km'; }
  function fmtPace(secPerKm) {
    if (!secPerKm || !isFinite(secPerKm)) return '—';
    const m = Math.floor(secPerKm / 60), s = Math.round(secPerKm % 60);
    return `${m}'${String(s).padStart(2, '0')}"`;
  }
  function fmtClock(minOffset) {   // 相对当日 00:00 的分钟偏移（可为负）
    if (minOffset == null) return '—';
    let m = ((Math.round(minOffset) % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }
  function fmtBig(n) {            // 21807432 -> 2180.7万
    if (n == null) return '—';
    if (n >= 1e8) return (n / 1e8).toFixed(2) + ' 亿';
    if (n >= 1e4) return (n / 1e4).toFixed(1) + ' 万';
    return fmtInt(n);
  }
  function avg(a) { let s = 0, n = 0; for (const v of a) if (v != null) { s += v; n++; } return n ? s / n : null; }
  function sum(a) { let s = 0; for (const v of a) if (v != null) s += v; return s; }
  function cnt(a) { let n = 0; for (const v of a) if (v != null) n++; return n; }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  function movingAvg(a, w) {
    const out = new Array(a.length).fill(null);
    let s = 0, n = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] != null) { s += a[i]; n++; }
      if (i >= w && a[i - w] != null) { s -= a[i - w]; n--; }
      out[i] = n >= Math.min(3, w) ? +(s / n).toFixed(2) : null;
    }
    return out;
  }

  /* 范围切片 */
  const sl = name => D[name].slice(state.start, state.end + 1);
  const dates = () => D.dates.slice(state.start, state.end + 1);
  const idxOf = date => D.dates.indexOf(date);

  /* ---------------- 图表挂载 ---------------- */
  const charts = new Map();

  function chartBase(extra = {}) {
    // tooltip 允许部分覆盖（如只传 valueFormatter），其余样式沿用默认
    const { tooltip, ...rest } = extra;
    const base = Object.assign({
      animationDuration: 250,
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: '#c3c8d6' } },
        backgroundColor: 'rgba(255,255,255,.96)',
        borderColor: '#e7e9f0', textStyle: { color: '#333a48', fontSize: 12.5 },
        extraCssText: 'box-shadow:0 4px 16px rgba(0,0,0,.1);border-radius:10px;padding:8px 12px;',
      },
      grid: { left: 54, right: 20, top: 32, bottom: 28 },
    }, rest);
    if (tooltip) Object.assign(base.tooltip, tooltip);
    return base;
  }

  function mount(id, option, opts = {}) {
    const el = document.getElementById(id);
    if (!el) return null;
    if (charts.has(id)) { charts.get(id).dispose(); charts.delete(id); }

    // 日期轴（带 _dateAxis 标记）：标签以可视窗口末尾为锚点均匀回推，
    // 保证最右日期一定显示、全程间距均匀；缩放后按新窗口重算步长
    let tailAnchor = null;
    let nAll = 0;
    const xa = option.xAxis;
    if (xa && xa._dateAxis && Array.isArray(xa.data) && xa.data.length > 1) {
      nAll = xa.data.length;
      const clean = Object.assign({}, xa);
      delete clean._dateAxis;
      option.xAxis = clean;
      tailAnchor = (s, e) => {
        const maxL = Math.max(2, Math.floor(el.clientWidth / 95));
        const step = Math.max(1, Math.ceil((e - s) / maxL));
        c.setOption({ xAxis: { axisLabel: { interval: i => i === e || (e - i) % step === 0 } } });
      };
    }

    const c = echarts.init(el);
    c.setOption(option);
    if (tailAnchor) {
      tailAnchor(0, nAll - 1);
      c.on('dataZoom', debounce(ev => {
        const dz = ev.batch ? ev.batch[0] : ev;
        let s = dz.startValue, e = dz.endValue;
        if (s == null || e == null) {
          s = Math.round(dz.start / 100 * (nAll - 1));
          e = Math.round(dz.end / 100 * (nAll - 1));
        }
        // 端点归一化：窗口触及数据边界时强制对齐，避免差一导致末尾标签丢失
        if (s <= 0) s = 0;
        if (e >= nAll - 1) e = nAll - 1;
        tailAnchor(s, e);
      }, 120));
    }
    charts.set(id, c);
    if (!opts.silent) {
      c.on('click', p => {
        const d = p.name || (Array.isArray(p.value) ? p.value[0] : null);
        if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) openDay(d);
      });
    }
    return c;
  }
  function disposeAll() { charts.forEach(c => c.dispose()); charts.clear(); }
  const resizeAll = debounce(() => charts.forEach(c => c.resize()), 150);
  window.addEventListener('resize', resizeAll);

  const AXIS_DATE = {
    type: 'category',
    _dateAxis: true,
    axisLine: { lineStyle: { color: '#d8dbe4' } },
    axisTick: { show: false },
    axisLabel: { color: '#8a90a3', fontSize: 11 },
    boundaryGap: false,
  };
  const AXIS_VAL = {
    type: 'value',
    splitLine: { lineStyle: { color: '#f0f1f6' } },
    axisLabel: { color: '#8a90a3', fontSize: 11 },
  };

  /* ---------------- 分钟月分片懒加载 ---------------- */
  const minCache = {};
  function loadMonth(ym) {
    if (minCache[ym]) return Promise.resolve(minCache[ym]);
    return new Promise(res => {
      const s = document.createElement('script');
      s.src = `data/minutes/${ym}.js`;
      s.onload = () => {
        const v = window.__MIN__ && window.__MIN__[ym];
        minCache[ym] = v ? JSON.parse(v) : {};
        res(minCache[ym]);
      };
      s.onerror = () => { minCache[ym] = {}; res({}); };
      document.head.appendChild(s);
    });
  }

  /* ---------------- 单日钻取弹层 ---------------- */
  const modal = {
    el: null,
    open(date) {
      const i = idxOf(date);
      if (i < 0) return;
      this.el.querySelector('.modal-h .date').textContent = date;
      this.el.querySelector('.modal-h .wd').textContent = weekday(date);
      this.el.classList.add('open');
      const body = this.el.querySelector('.modal-b');
      body.innerHTML = `<div class="loading">加载分钟级数据中…</div>`;
      this.render(date, i, body);
    },
    close() { this.el.classList.remove('open'); },
    async render(date, i, body) {
      const g = k => D[k] ? D[k][i] : null;
      // 指标 chips
      const chips = [
        ['步数', g('steps') != null ? fmtInt(g('steps')) + ' 步' : null],
        ['距离', g('dist') != null ? fmtKm(g('dist')) : null],
        ['活动卡路里', g('cal') != null ? g('cal') + ' kcal' : null],
        ['睡眠', g('slpTotal') != null ? fmtDur(g('slpTotal')) : null],
        ['睡眠评分', g('slpScore') != null ? g('slpScore') + ' 分' : null],
        ['入睡 / 起床', g('bedMin') != null ? `${fmtClock(g('bedMin'))} ~ ${fmtClock(g('wakeMin'))}` : null],
        ['静息心率', g('rhr') != null ? g('rhr') + ' bpm' : null],
        ['平均心率', g('avgHr') != null ? g('avgHr') + ' bpm' : null],
        ['血氧', g('spo2') != null ? g('spo2') + '%' : null],
        ['压力', g('stress') != null ? g('stress') : null],
        ['体重', g('weight') != null ? g('weight') + ' kg' : null],
        ['PAI', g('pai') != null ? fmtNum(g('pai')) : null],
      ].filter(c => c[1]);
      const sports = (S ? S.list : []).filter(s => s.d === date);
      const sportHtml = sports.length ? sports.map(s =>
        `<div class="mchip">${S.typeCn[s.t] || s.t}<b>${fmtDurS(s.dur)}${s.dist > 100 ? ' · ' + fmtKm(s.dist) : ''}${s.cal ? ' · ' + s.cal + 'kcal' : ''}</b></div>`).join('')
        : '';

      const dayData = await loadMonth(date.slice(0, 7));
      const day = dayData[date.slice(8, 10)] || null;

      body.innerHTML = `
        <div class="chips">${chips.map(c => `<div class="mchip">${c[0]}<b>${c[1]}</b></div>`).join('')}</div>
        ${sportHtml ? `<div class="chips" style="margin-top:-6px">${sportHtml}</div>` : ''}
        ${day ? `
        <div class="grid">
          <div class="card col-12"><div class="card-h"><div><div class="t">步数 / 距离（分钟级）</div></div></div><div class="chart short" id="ddSteps"></div></div>
          <div class="card col-12"><div class="card-h"><div><div class="t">心率（分钟级）</div><div class="s">灰色区间为睡眠时段</div></div></div><div class="chart short" id="ddHr"></div></div>
          <div class="card col-6"><div class="card-h"><div><div class="t">压力</div></div></div><div class="chart short" id="ddStress"></div></div>
          <div class="card col-6"><div class="card-h"><div><div class="t">血氧</div></div></div><div class="chart short" id="ddSpo2"></div></div>
        </div>` : `<div class="empty" style="height:200px">这一天没有分钟级明细数据</div>`}`;

      if (!day) return;

      const xFmt = v => `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
      const xAxis = {
        type: 'value', min: 0, max: 1439, interval: 120,
        axisLabel: { color: '#8a90a3', fontSize: 11, formatter: v => xFmt(v) },
        axisLine: { show: false }, axisTick: { show: false },
        splitLine: { show: false },
      };
      const toPairs = arr => { const r = []; for (let m = 0; m < 1440; m++) if (arr[m]) r.push([m, arr[m]]); return r; };

      // 步数
      mount('ddSteps', chartBase({
        tooltip: { trigger: 'axis', formatter: ps => `${xFmt(ps[0].value[0])} · <b>${ps[0].value[1]}</b> 步${day.d && day.d[ps[0].value[0]] ? ` · ${day.d[ps[0].value[0]]} 米` : ''}` },
        grid: { left: 50, right: 16, top: 30, bottom: 26 },
        xAxis, yAxis: Object.assign({}, AXIS_VAL, { name: '步', max: v => Math.max(40, Math.ceil(v.max * 1.15)) }),
        series: [{ type: 'bar', data: toPairs(day.s || []), barWidth: '99%', itemStyle: { color: '#3b6df0', borderRadius: [2, 2, 0, 0] } }],
      }), { silent: true });

      // 心率 + 睡眠区间
      const bed = g('bedMin'), wake = g('wakeMin');
      const sleepArea = bed != null ? [[{ xAxis: Math.max(bed, -180) }, { xAxis: Math.min(wake, 1439) }]] : [];
      mount('ddHr', chartBase({
        tooltip: { trigger: 'axis', formatter: ps => `${xFmt(ps[0].value[0])} · <b>${ps[0].value[1]}</b> bpm` },
        grid: { left: 50, right: 16, top: 30, bottom: 26 },
        xAxis, yAxis: Object.assign({}, AXIS_VAL, { name: 'bpm', min: v => Math.max(35, Math.floor(v.min - 8)) }),
        series: [{
          type: 'line', data: toPairs(day.h || []), showSymbol: false, smooth: false,
          lineStyle: { width: 1.4, color: '#e5484d' }, itemStyle: { color: '#e5484d' },
          areaStyle: { color: 'rgba(229,72,77,.08)' },
          markArea: sleepArea.length ? { silent: true, itemStyle: { color: 'rgba(122,90,248,.07)' }, label: { show: false }, data: sleepArea } : undefined,
        }],
      }), { silent: true });

      // 压力 / 血氧
      const mkLine = (id, arr, color, fmt, unit) => mount(id, chartBase({
        tooltip: { trigger: 'axis', formatter: ps => `${xFmt(ps[0].value[0])} · <b>${fmt(ps[0].value[1])}</b>` },
        grid: { left: 46, right: 16, top: 30, bottom: 26 },
        xAxis, yAxis: Object.assign({}, AXIS_VAL, { name: unit }),
        series: [{ type: 'line', data: toPairs(arr), showSymbol: false, lineStyle: { width: 1.4, color }, itemStyle: { color } }],
      }), { silent: true });
      mkLine('ddStress', day.t || [], '#f76b15', v => v, '分');
      mkLine('ddSpo2', day.o || [], '#0e7f9f', v => v + '%', '%');
    },
  };

  /* ---------------- 日期范围 ---------------- */
  const PRESETS = [
    ['7', '近7天'], ['30', '近30天'], ['90', '近90天'], ['ytd', '今年'],
    ['1y', '近1年'], ['3y', '近3年'], ['all', '全部'], ['custom', '自定义'],
  ];
  let curPreset = '30';

  function applyPreset(p) {
    curPreset = p;
    const n = D.dates.length;
    const end = n - 1;
    let start = 0;
    if (p === '7') start = Math.max(0, end - 6);
    else if (p === '30') start = Math.max(0, end - 29);
    else if (p === '90') start = Math.max(0, end - 89);
    else if (p === 'ytd') start = D.dates.findIndex(d => d >= D.dates[end].slice(0, 4) + '-01-01');
    else if (p === '1y') start = D.dates.findIndex(d => d >= D.dates[end - 364 >= 0 ? end - 364 : 0]);
    else if (p === '3y') start = D.dates.findIndex(d => d >= D.dates[end - 1094 >= 0 ? end - 1094 : 0]);
    if (start < 0) start = 0;
    state.start = start; state.end = end;
    updateRangeUI();
    renderActive();
  }

  function applyCustom(from, to) {
    let a = idxOf(from), b = idxOf(to);
    if (a < 0) a = D.dates.findIndex(d => d >= from);
    if (b < 0) { const t = D.dates.filter(d => d <= to); b = t.length - 1; }
    if (a < 0 || b < 0 || a > b) return;
    state.start = a; state.end = b;
    updateRangeUI();
    renderActive();
  }

  function updateRangeUI() {
    document.querySelectorAll('.ranges .chip').forEach(b =>
      b.classList.toggle('on', b.dataset.r === curPreset));
    const lb = $('#rangeLabel');
    if (lb) lb.textContent = `${D.dates[state.start]} ~ ${D.dates[state.end]} · ${state.end - state.start + 1} 天`;
  }

  /* ---------------- Tab / 渲染 ---------------- */
  const MODULES = {};
  function register(name, fn) { MODULES[name] = fn; }

  function renderActive() {
    disposeAll();
    document.querySelectorAll('.module').forEach(m => m.classList.remove('on'));
    const sec = document.getElementById('tab-' + state.tab);
    sec.classList.add('on');
    MODULES[state.tab](sec);
    sec.querySelectorAll('.chart').forEach(el => {
      const c = charts.get(el.id);
      if (c) c.resize();
    });
  }

  function switchTab(name) {
    state.tab = name;
    document.querySelectorAll('.tabs button').forEach(b =>
      b.classList.toggle('on', b.dataset.tab === name));
    renderActive();
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    // 顶栏范围
    const ranges = $('.ranges');
    ranges.insertAdjacentHTML('afterbegin', PRESETS.map(p =>
      `<button class="chip" data-r="${p[0]}">${p[1]}</button>`).join(''));
    ranges.insertAdjacentHTML('beforeend', `
      <span class="custom-box" id="customBox">
        <input type="date" id="dFrom"> <span class="note">至</span> <input type="date" id="dTo">
        <button class="apply" id="dApply">应用</button>
      </span>
      <span class="note" id="rangeLabel"></span>`);
    ranges.addEventListener('click', e => {
      const b = e.target.closest('.chip'); if (!b) return;
      const r = b.dataset.r;
      if (r === 'custom') {
        $('#customBox').classList.toggle('show');
        $('#dFrom').min = D.dates[0]; $('#dFrom').max = D.dates[D.dates.length - 1];
        $('#dTo').min = D.dates[0]; $('#dTo').max = D.dates[D.dates.length - 1];
        $('#dFrom').value = D.dates[state.start]; $('#dTo').value = D.dates[state.end];
        return;
      }
      $('#customBox').classList.remove('show');
      applyPreset(r);
    });
    $('#dApply').addEventListener('click', () => {
      const f = $('#dFrom').value, t = $('#dTo').value;
      if (f && t) applyCustom(f, t);
    });

    // Tabs
    document.querySelectorAll('.tabs button').forEach(b =>
      b.addEventListener('click', () => switchTab(b.dataset.tab)));

    // 弹层
    const ov = $('#dayModal');
    modal.el = ov;
    ov.addEventListener('click', e => { if (e.target === ov) modal.close(); });
    ov.querySelector('.close').addEventListener('click', () => modal.close());
    document.addEventListener('keydown', e => { if (e.key === 'Escape') modal.close(); });

    applyPreset('30');
    switchTab('overview');
  }

  return {
    D, S, H, META, state, sl, dates, idxOf, $,
    fmtInt, fmtNum, fmtDur, fmtDurS, fmtKm, fmtPace, fmtClock, fmtBig, weekday,
    avg, sum, cnt, movingAvg,
    chartBase, mount, AXIS_DATE, AXIS_VAL, loadMonth,
    openDay: d => modal.open(d), register, rerender: renderActive,
    boot,
  };
})();
