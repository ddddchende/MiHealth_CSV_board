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
  /* 卫星图内存缓存：URL -> dataURL（会话级，上限 30 张，避免重复开关弹窗/来回缩放反复拉取） */
  const satCache = new Map();

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
    let dateLabels = null;   // 日期轴类目：点击绘图区时映射到具体一天
    const xa = option.xAxis;
    const isDateAxis = xa && xa._dateAxis && Array.isArray(xa.data) && xa.data.length > 0;
    if (isDateAxis) dateLabels = xa.data;
    if (isDateAxis && xa.data.length > 1) {
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
        if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) modal.open(d);
      });
    }
    /* 日期轴图表：点击绘图区任意位置即打开最近一天的明细。
       落点取整到类目索引；拖动超过 6px（缩放/平移）不触发；
       点在柱子/数据点上时 series click 也会触发，由 modal._cur 去重。
       注意：zr 监听必须延迟到本轮渲染结束后注册，boot 期间同步注册的
       zr 监听会丢失（实测），故用 setTimeout(0)。 */
    if (dateLabels) {
      setTimeout(() => {
        if (c.isDisposed()) return;
        const zr = c.getZr();
        let down = null;
        zr.on('mousedown', e => { down = [e.offsetX, e.offsetY]; });
        zr.on('click', e => {
          if (down && Math.hypot(e.offsetX - down[0], e.offsetY - down[1]) > 6) return;
          const pt = [e.offsetX, e.offsetY];
          if (!c.containPixel('grid', pt)) return;
          const conv = c.convertFromPixel({ seriesIndex: 0 }, pt);
          if (!conv) return;
          const i = Math.max(0, Math.min(dateLabels.length - 1, Math.round(conv[0])));
          modal.open(dateLabels[i]);
        });
      }, 0);
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
      if (this._cur === date && this.el.classList.contains('open')) return; // 同日重复触发只渲染一次
      this._cur = date;
      this.el.querySelector('.modal-h .date').textContent = date;
      this.el.querySelector('.modal-h .wd').textContent = weekday(date);
      this.el.classList.add('open');
      const body = this.el.querySelector('.modal-b');
      body.innerHTML = `<div class="loading">加载分钟级数据中…</div>`;
      this.render(date, i, body);
    },
    close() { this._cur = null; this.el.classList.remove('open'); },
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
        `<div class="mchip link" data-i="${s.i}">${S.typeCn[s.t] || s.t}<b>${fmtDurS(s.dur)}${s.dist > 100 ? ' · ' + fmtKm(s.dist) : ''}${s.cal ? ' · ' + s.cal + 'kcal' : ''}</b></div>`).join('')
        : '';

      const dayData = await loadMonth(date.slice(0, 7));
      // 分片键兼容两种格式：补零 '05'（新预处理）与不补零 '5'（旧分片）
      const dk = date.slice(8, 10);
      const day = dayData[dk] || dayData[+dk] || null;

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

      // 分钟偏移 -> HH:MM（取整，避免缩放后刻度出现小数）
      const xFmt = v => { const m = Math.round(v); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
      const xAxis = {
        type: 'value', min: 0, max: 1439, interval: 120,
        axisLabel: { color: '#8a90a3', fontSize: 11, formatter: v => xFmt(v) },
        axisLine: { show: false }, axisTick: { show: false },
        splitLine: { show: false },
      };
      const toPairs = arr => { const r = []; for (let m = 0; m < 1440; m++) if (arr[m]) r.push([m, arr[m]]); return r; };
      /* 分钟级图表缩放：全天 1440 个点，滚轮缩放 + 底部缩放条 */
      const minZoom = [
        { type: 'inside', xAxisIndex: 0 },
        { type: 'slider', height: 16, bottom: 6, labelFormatter: () => '' },
      ];

      // 步数
      mount('ddSteps', chartBase({
        tooltip: { trigger: 'axis', formatter: ps => `${xFmt(ps[0].value[0])} · <b>${ps[0].value[1]}</b> 步${day.d && day.d[ps[0].value[0]] ? ` · ${day.d[ps[0].value[0]]} 米` : ''}` },
        grid: { left: 50, right: 16, top: 30, bottom: 48 },
        dataZoom: minZoom,
        xAxis, yAxis: Object.assign({}, AXIS_VAL, { name: '步', max: v => Math.max(40, Math.ceil(v.max * 1.15)) }),
        series: [{ type: 'bar', data: toPairs(day.s || []), barWidth: '99%', itemStyle: { color: '#3b6df0', borderRadius: [2, 2, 0, 0] } }],
      }), { silent: true });

      // 心率 + 睡眠区间
      const bed = g('bedMin'), wake = g('wakeMin');
      const sleepArea = bed != null ? [[{ xAxis: Math.max(bed, -180) }, { xAxis: Math.min(wake, 1439) }]] : [];
      mount('ddHr', chartBase({
        tooltip: { trigger: 'axis', formatter: ps => `${xFmt(ps[0].value[0])} · <b>${ps[0].value[1]}</b> bpm` },
        grid: { left: 50, right: 16, top: 30, bottom: 48 },
        dataZoom: minZoom,
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
        grid: { left: 46, right: 16, top: 30, bottom: 48 },
        dataZoom: minZoom,
        xAxis, yAxis: Object.assign({}, AXIS_VAL, { name: unit }),
        series: [{ type: 'line', data: toPairs(arr), showSymbol: false, lineStyle: { width: 1.4, color }, itemStyle: { color } }],
      }), { silent: true });
      mkLine('ddStress', day.t || [], '#f76b15', v => v, '分');
      mkLine('ddSpo2', day.o || [], '#0e7f9f', v => v + '%', '%');
      // 运动条目点击 -> 单次运动弹层
      body.querySelectorAll('.mchip.link').forEach(el =>
        el.onclick = () => sportModal.open(+el.dataset.i));
    },
  };

  /* ---------------- 单次运动弹层 ---------------- */
  const S_ZONES = [
    ['zw', '热身', '#aebdf7'], ['zf', '燃脂', '#f5a623'], ['za', '有氧', '#3b6df0'],
    ['zn', '无氧', '#e5484d'], ['ze', '极限', '#8b1d3f'],
  ];
  const sportModal = {
    el: null,
    cur: -1,
    open(i) {
      const s = S && S.list[i];
      if (!s) return;
      if (this.cur === i && this.el.classList.contains('open')) return;
      this.cur = i;
      const wall = sec => {
        if (!sec) return '';
        const d = new Date((sec + 8 * 3600) * 1000);   // 平移为 CST 墙上时间
        return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
      };
      const range = s.st ? `${wall(s.st)} – ${wall(s.et || s.st + s.dur)}` : '';
      this.el.querySelector('.sm-title').textContent = S.typeCn[s.t] || s.t;
      this.el.querySelector('.sm-sub').textContent = `${s.d} ${weekday(s.d)}${range ? ' · ' + range : ''}`;
      this.el.querySelector('.sm-day').style.display = idxOf(s.d) >= 0 ? '' : 'none';
      this.el.classList.add('open');
      const body = this.el.querySelector('.modal-b');
      body.innerHTML = this.render(s);
      this.mountCharts(s);
    },
    close() { this.cur = -1; this.el.classList.remove('open'); },
    /* GPS 轨迹图 + 海拔/心率曲线 */
    mountCharts(s) {
      const trk = s.track;
      if (!trk || trk.length < 2) return;
      const rad = Math.PI / 180;
      const latMid = trk.reduce((a, p) => a + p[1], 0) / trk.length;
      /* 墨卡托投影（与 Esri 卫星图一致，消除纬度方向偏移）：
         X 与经度线性；Y = ln(tan(π/4 + φ/2))；统一按 latMid 缩放到真实公里 */
      const s0 = Math.cos(latMid * rad) * 111.32;              // 经度 1° -> 公里（latMid 处）
      const mercY = lat => Math.log(Math.tan(Math.PI / 4 + lat * rad / 2)) * s0 * 180 / Math.PI;
      const invMercY = y => (2 * Math.atan(Math.exp(y / (s0 * 180 / Math.PI))) - Math.PI / 2) / rad;
      const el = document.getElementById('trkMap');
      /* 绘图区 = 整个容器（与卫星图层同边界）：轨迹裁切边 = 容器边，
         拖到边缘时轨迹与卫星图同时到边，不会被网格提前裁切 */
      const gw = Math.max(80, el.clientWidth);    // 绘图区像素宽（占满容器）
      const gh = Math.max(80, el.clientHeight);   // 绘图区像素高
      const xs = trk.map(p => p[0] * s0), ys = trk.map(p => mercY(p[1]));
      const xMin = Math.min(...xs), xMax = Math.max(...xs);
      const yMin = Math.min(...ys), yMax = Math.max(...ys);
      /* GPS 噪声滤波：5 点滑动平均（截断窗口保端点），消除锯齿 */
      const sm = a => a.map((_, i) => {
        let s = 0, n = 0;
        for (let k = Math.max(0, i - 2); k <= Math.min(a.length - 1, i + 2); k++) { s += a[k]; n++; }
        return s / n;
      });
      const fxs = sm(xs), fys = sm(ys);
      const spanX = Math.max(xMax - xMin, 0.05), spanY = Math.max(yMax - yMin, 0.05);
      /* 默认视野：按轨迹边缘外扩一圈（各向 15% 跨度），轨迹尽量占满画面；双击复位同此视野 */
      const padX = spanX * 0.15, padY = spanY * 0.15;
      let L0 = xMin - padX, R0 = xMax + padX, B0 = yMin - padY, T0 = yMax + padY;
      /* 数据范围宽高比匹配像素宽高比（保持中心），卫星图占满容器且不变形 */
      let W = R0 - L0, H = T0 - B0;
      if (W / H > gw / gh) H = W * gh / gw; else W = H * gw / gh;
      const cX = (L0 + R0) / 2, cY = (B0 + T0) / 2;
      const L = cX - W / 2, R = cX + W / 2, B = cY - H / 2, T = cY + H / 2;
      /* 轨迹点用墨卡托数据坐标（公里，保留全精度避免缩放后台阶锯齿） */
      const pts = fxs.map((x, i) => [x, fys[i]]);
      /* 累计距离（投影平面，短距 ≈ 真实） */
      const cum = [0];
      for (let i = 1; i < pts.length; i++)
        cum.push(+(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])).toFixed(2));
      /* 里程渐变逐段配色：起点绿 → 终点红（与起/终点标记同色系，方向一目了然）。
         ECharts visualMap 对折线描边着色存在已知 bug（#20298/#20725，实测 5.6.0 不生效），
         故拆成逐段 lines 系列，每段按中点里程在五档色标间插值；
         折返重叠段处于不同里程颜色不同，走向即可分辨 */
      const RGBS = ['#22c55e', '#a3e635', '#facc15', '#fb923c', '#ef4444'].map(h =>
        [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
      const colorAt = t => {   // t∈[0,1] -> 色标线性插值
        t = Math.max(0, Math.min(1, t)) * (RGBS.length - 1);
        const i = Math.min(RGBS.length - 2, Math.floor(t)), f = t - i, a = RGBS[i], b = RGBS[i + 1];
        return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
      };
      const total = Math.max(1e-6, cum[cum.length - 1]);
      const segs = [];
      for (let i = 0; i < pts.length - 1; i++)
        segs.push({ coords: [[pts[i][0], pts[i][1]], [pts[i + 1][0], pts[i + 1][1]]],
          lineStyle: { color: colorAt((cum[i] + cum[i + 1]) / 2 / total) } });
      /* 每公里白色序号标记（1、2、3…） */
      const kmMarks = [];
      let nextKm = 1;
      for (let i = 1; i < pts.length; i++) {
        if (cum[i] >= nextKm) {
          kmMarks.push({ value: [pts[i][0], pts[i][1]], name: String(nextKm), idx: i });
          nextKm++;
        }
      }
      const hidden = { axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false }, splitLine: { show: false } };
      /* 视图窗口（数据坐标，公里）：滚轮以鼠标为锚点缩放、按住拖动平移共用 */
      const view = { L, R, B, T };
      let drag = null, zoomTimer = null;
      /* 禁用默认 tooltip（axis 触发在轨迹往返重叠时会多点横跳），改自定义最近点悬停。
         轨迹线初始只画起点，随后由 grow 动画延伸至终点 */
      const c = mount('trkMap', chartBase({
        animation: false,   // 轴范围与背景图同步跳变，避免缩放时轨迹与地图错位
        tooltip: { show: false },
        grid: { left: 0, top: 0, width: gw, height: gh },
        xAxis: Object.assign({ type: 'value', min: L, max: R }, hidden),
        yAxis: Object.assign({ type: 'value', min: B, max: T }, hidden),
        series: [
          /* 逐段 lines 系列：每段自带渐变色。cartesian2d 坐标系下无需 clip，
             视野外线段落在 canvas 外自然被裁切；silent 避免干扰自定义悬停 */
          { type: 'lines', coordinateSystem: 'cartesian2d', data: [], silent: true,
            lineStyle: { width: 2.5, cap: 'round' }, z: 1 },
          /* 起终点 scatter 同样禁用动画：避免每帧 setOption 反复重启缩放动画导致绿点“最后才出现” */
          { type: 'scatter', data: [pts[0]], symbolSize: 10, animation: false,
            itemStyle: { color: '#0e9f6e' }, z: 2, silent: true },
          { type: 'scatter', data: [], symbolSize: 10, animation: false,
            itemStyle: { color: '#e5484d' }, z: 2, silent: true },
          /* 每公里白色序号标记 */
          { type: 'scatter', data: [], symbolSize: 13, animation: false,
            itemStyle: { color: '#fff', borderColor: 'rgba(29,58,174,.75)', borderWidth: 1.5 },
            label: { show: true, formatter: p => p.name, fontSize: 10, fontWeight: 600, color: '#1d3fae' },
            z: 3, silent: true },
        ],
      }), { silent: true });
      /* 免费卫星图背景（Esri World Imagery，无需 key；联网加载，失败自动回落纯轨迹）。
         双层结构：底层一次性预载 3 倍世界窗口（拖动/缩小的边缘不露白），
         上层按当前视野动态取高清图。各层变换由自身窗口 -> 视图 推导，严格对齐 */
      const satURL = (l, r, b, t, w, h) => {
        /* 墨卡托公里 -> 经纬度（度）再拼 bbox */
        const lonL = l / s0, lonR = r / s0;
        const latB = invMercY(b), latT = invMercY(t);
        return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${lonL.toFixed(6)},${latB.toFixed(6)},${lonR.toFixed(6)},${latT.toFixed(6)}&bboxSR=4326&size=${Math.round(w)},${Math.round(h)}&format=jpg&f=image`;
      };
      el.style.position = 'relative';
      const W3 = W * 2, H3 = H * 2;
      /* 底图层窗口（已加载底图覆盖的数据范围）：初始 2 倍世界，拖动到边缘时扩展 */
      const baseImgWin = { L: cX - W3 / 2, R: cX + W3 / 2, B: cY - H3 / 2, T: cY + H3 / 2 };
      const mkLayer = (left, top, w, h, zi) => {
        const d = document.createElement('div');
        d.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${w}px;height:${h}px;z-index:${zi};opacity:0;transition:opacity 1s ease;background-repeat:no-repeat;transform-origin:50% 50%;will-change:transform;`;
        el.insertBefore(d, el.firstChild);
        return d;
      };
      /* 图层 z-index 0/1 保持在父容器内；ECharts canvas 用 CSS 提到 2（轨迹在上） */
      const bgBase = mkLayer(-gw, -gh, 2 * gw, 2 * gh, 0);
      const bg = mkLayer(0, 0, gw, gh, 1);
      /* bgView = 高清层当前覆盖的窗口 */
      let bgView = { L, R, B, T };
      let fetchSeq = 0;
      /* 层变换：把该层覆盖窗口 [wl,wt]-[ww,wh]（数据公里，像素 wpx×hpx，位于 lft,top）
         映射到当前视图 view，保证「数据->屏幕」与 ECharts 严格一致。
         推导：屏幕 = lft + (x-wl)*(wpx/ww)*s + (wpx/2)*(1-s) + tx ≡ (x-view.L)*k，
         s = k*ww/wpx（像素密度匹配），解出 tx/ty（网格原点为 0,0） */
      const layerT = (wl, wt, ww, wh, wpx, hpx, lft, top) => {
        const vw = view.R - view.L, vh = view.T - view.B;
        const k = gw / vw;                       // 视图尺度：像素/公里
        const s = k * (ww / wpx);                // 使该层像素密度与视图一致
        const tx = -lft + (wl - view.L) * k + (wpx / 2) * (s - 1);
        const ty = -top - (wt - view.T) * k + (hpx / 2) * (s - 1);
        return (Math.abs(s - 1) < 1e-3 && Math.abs(tx) < 0.5 && Math.abs(ty) < 0.5) ? 'none' : `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${s.toFixed(3)})`;
      };
      const syncBg = () => {
        bgBase.style.transform = layerT(baseImgWin.L, baseImgWin.T, baseImgWin.R - baseImgWin.L, baseImgWin.T - baseImgWin.B, 2 * gw, 2 * gh, -gw, -gh);
        const bw = bgView.R - bgView.L, bh = bgView.T - bgView.B;
        bg.style.transform = layerT(bgView.L, bgView.T, bw, bh, gw, gh, 0, 0);
      };
      /* 加载指示：微光扫过遮罩（首次无图时盖住视野）+ 右上角加载胶囊（任意请求进行中）。
         遮罩 z-index 0 且在 DOM 末尾 → 位于底图(0)之上、高清层(1)/轨迹 canvas(2) 之下，
         高清层淡入时自动被盖住，不会挡住已加载的影像 */
      let pending = 0;
      const shimmer = document.createElement('div');
      shimmer.className = 'sat-shimmer';
      shimmer.style.cssText = `left:0;top:0;width:${gw}px;height:${gh}px;`;
      el.appendChild(shimmer);
      const satTip = document.createElement('div');
      satTip.style.cssText = 'position:absolute;top:18px;right:28px;z-index:5;display:none;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;background:rgba(17,24,39,.72);color:#dfe6ff;font-size:11px;pointer-events:none;';
      satTip.innerHTML = '<span class="sat-spin"></span>卫星图加载中…';
      el.appendChild(satTip);
      const updateLoadUI = () => {
        satTip.style.display = pending > 0 ? 'flex' : 'none';
        if (pending <= 0) shimmer.style.display = 'none';   // 全部结束仍无图：停止动画，回落纯轨迹
      };
      const fetchSat = (l, r, b, t, fade, div, w, h, isHigh) => {
        const seq = isHigh ? ++fetchSeq : 0;     // 过期丢弃只作用于高清层
        const url = satURL(l, r, b, t, w, h);
        let counted = false, settled = false;
        const settle = () => { if (counted && !settled) { settled = true; pending--; updateLoadUI(); } };
        const apply = durl => {
          if (div !== bg && c.isDisposed()) { settle(); return; }   // 底图只检查销毁
          if (div === bg && seq !== fetchSeq) { settle(); return; } // 高清层：过期响应丢弃
          try {
            div.style.backgroundImage = `url(${durl})`;
            div.style.backgroundSize = `${w}px ${h}px`;
            if (div === bg) { bgView = { L: l, R: r, B: b, T: t }; shimmer.style.display = 'none'; }
            else { Object.assign(baseImgWin, { L: l, R: r, B: b, T: t }); }   // 底图：记录已覆盖窗口
            syncBg();
            div.style.opacity = '1';   // transition 1s 自动淡入，无需依赖 rAF
          } catch (e) { if (fade) div.remove(); }
          settle();
        };
        const cached = satCache.get(url);
        if (cached) { apply(cached); return; }   // 命中缓存：零网络直出
        counted = true; pending++; updateLoadUI();
        const img = new Image();
        img.crossOrigin = 'anonymous';
        let retry = 0;
        img.onload = () => {
          if (c.isDisposed()) { settle(); return; }
          if (isHigh && seq !== fetchSeq) { settle(); return; }   // 高清层：过期响应丢弃
          try {
            const cv = document.createElement('canvas');
            cv.width = Math.round(w); cv.height = Math.round(h);
            cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
            const durl = cv.toDataURL('image/jpeg', 0.85);   // 卫星影像用 JPEG，体积小 ~10 倍
            satCache.set(url, durl);
            if (satCache.size > 30) satCache.delete(satCache.keys().next().value);
            apply(durl);
          } catch (e) { if (fade) div.remove(); settle(); }
        };
        img.onerror = () => {   // Esri 偶发超时/限流：最多重试 2 次
          if (retry++ < 2 && !c.isDisposed() && (isHigh ? seq === fetchSeq : true)) {
            setTimeout(() => { img.src = url; }, 800);
          } else settle();
        };
        img.src = url;
      };
      /* 初始并发：高清层（当前视野，小图快，打开即显示）+ 底图（2 倍世界垫底） */
      fetchSat(L, R, B, T, true, bg, gw, gh, true);
      fetchSat(baseImgWin.L, baseImgWin.R, baseImgWin.B, baseImgWin.T, true, bgBase, 2 * gw, 2 * gh, false);
      /* 轨迹生长动画：约 5 秒从起点延伸至终点（dispose 后自动停止，可由播放按钮重播）。
         runId 令牌：重播时旧循环的帧自动作废，避免双循环并发 */
      const DUR = 5000;
      let t0 = null, runId = 0;
      const grow = (ts, id) => {
        if (c.isDisposed() || id !== runId) return;
        if (t0 == null) t0 = ts;
        const p = Math.min(1, (ts - t0) / DUR);
        const k = Math.max(1, Math.ceil(p * pts.length));
        const done = p >= 1;
        c.setOption({
          series: [
            { data: segs.slice(0, Math.max(0, k - 1)) },   // k 个点 = k-1 段
            { data: [pts[0]] },
            { data: done ? [pts[pts.length - 1]] : [] },
            { data: done ? kmMarks : kmMarks.filter(m => m.idx < k) },
          ],
        });
        if (!done) requestAnimationFrame(ts2 => grow(ts2, id));
      };
      const playTrack = () => { runId++; t0 = null; requestAnimationFrame(ts => grow(ts, runId)); };
      playTrack();
      /* 自定义悬停提示：光标到最近路径线段的像素垂距（阈值 8px，随缩放恒定），
         拖动/缩放过程中不显示 */
      const tip = document.createElement('div');
      tip.style.cssText = 'position:absolute;pointer-events:none;background:rgba(255,255,255,.96);border:1px solid #e7e9f0;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.1);padding:6px 10px;font-size:12px;line-height:1.6;color:#333a48;z-index:10;display:none;white-space:nowrap;';
      el.appendChild(tip);
      const hideTip = () => { tip.style.display = 'none'; };
      const distSeg = (px, py, ax, ay, bx, by) => {
        const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy || 1;
        let t = ((px - ax) * vx + (py - ay) * vy) / l2;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
      };
      const zr = c.getZr();
      zr.on('mousemove', e => {
        if (drag) return hideTip();
        const pt = [e.offsetX, e.offsetY];
        if (!c.containPixel('grid', pt)) return hideTip();
        const w = view.R - view.L, h = view.T - view.B;
        const kx = gw / w, ky = gh / h;          // 当前像素/公里
        let best = -1, bd = Infinity;
        for (let i = 0; i < pts.length - 1; i++) {
          const ax = (pts[i][0] - view.L) * kx, ay = (view.T - pts[i][1]) * ky;
          const bx = (pts[i + 1][0] - view.L) * kx, by = (view.T - pts[i + 1][1]) * ky;
          const d = distSeg(e.offsetX, e.offsetY, ax, ay, bx, by);
          if (d < bd) { bd = d; best = i; }
        }
        if (best < 0 || bd > 8) return hideTip();
        const d = trk[best + 1];
        let h2 = `累计里程 <b>${cum[best + 1].toFixed(2)} km</b>`;
        if (d[2] != null) h2 += `<br/>海拔 ${d[2]} m`;
        if (d[3] != null) h2 += `<br/>心率 ${d[3]} bpm`;
        tip.innerHTML = h2;
        tip.style.display = 'block';
        const X = Math.min(e.offsetX + 14, el.clientWidth - tip.offsetWidth - 6);
        const Y = Math.max(0, e.offsetY - tip.offsetHeight - 10);
        tip.style.left = X + 'px';
        tip.style.top = Y + 'px';
      });
      zr.on('globalout', hideTip);
      /* 地图交互：滚轮以鼠标位置为锚点缩放，按住拖动平移，双击复位。
         背景图层用 translate+scale 与数据窗口严格同步（公式由墨卡托线性映射推出）；
         操作停止 450ms 后按当前窗口重取高清图，并扩展底图覆盖（像地图软件拼接） */
      el.style.cursor = 'grab';
      let lastExtend = 0;
      const ensureBase = () => {
        /* 视图触碰底图边缘（留 0.8 视图宽余量）时，以视图为中心扩展底图并重新拉取 */
        const pad = (view.R - view.L) * 0.8, padY = (view.T - view.B) * 0.8;
        if (view.L > baseImgWin.L + pad && view.R < baseImgWin.R - pad &&
            view.B > baseImgWin.B + padY && view.T < baseImgWin.T - padY) return;
        const now = Date.now();
        if (now - lastExtend < 600) return;   // 节流，避免快速拖动连发请求
        lastExtend = now;
        const vcx = (view.L + view.R) / 2, vcy = (view.B + view.T) / 2;
        const w3 = Math.max(baseImgWin.R - baseImgWin.L, (view.R - view.L) * 2);
        const h3 = w3 * H / W;
        const nw = { L: vcx - w3 / 2, R: vcx + w3 / 2, B: vcy - h3 / 2, T: vcy + h3 / 2 };
        fetchSat(nw.L, nw.R, nw.B, nw.T, false, bgBase, 2 * gw, 2 * gh, false);
      };
      const applyView = refetch => {
        c.setOption({
          xAxis: { min: view.L, max: view.R },
          yAxis: { min: view.B, max: view.T },
        });
        syncBg();
        ensureBase();
        if (!refetch) return;
        clearTimeout(zoomTimer);
        zoomTimer = setTimeout(() => {
          if (c.isDisposed()) return;
          fetchSat(view.L, view.R, view.B, view.T, false, bg, gw, gh, true);
        }, 450);
      };
      zr.on('mousewheel', e => {
        const ev = e.event || e;
        if (ev.preventDefault) ev.preventDefault();   // 阻止弹窗随滚轮滚动
        const dz = e.wheelDelta || -e.deltaY || 0;
        if (!dz || !c.containPixel('grid', [e.offsetX, e.offsetY])) return;
        const dp = c.convertFromPixel({ seriesIndex: 0 }, [e.offsetX, e.offsetY]);
        if (!dp) return;
        const f = dz > 0 ? 1.15 : 1 / 1.15;
        const w0 = view.R - view.L;
        const nw = Math.min(W3, Math.max(W / 50, w0 / f));   // 窗口限制：50 倍放大 ~ 3 倍世界
        const nh = nw * H / W;
        const gx = e.offsetX / gw, gy = (gh - e.offsetY) / gh;   // 光标在网格内的比例
        view.L = dp[0] - gx * nw;               // 锚点：光标下的位置缩放后不动
        view.R = view.L + nw;
        view.B = dp[1] - gy * nh;
        view.T = view.B + nh;
        applyView(true);
      });
      zr.on('mousedown', e => {
        if (!c.containPixel('grid', [e.offsetX, e.offsetY])) return;
        drag = { x: e.offsetX, y: e.offsetY, v: { ...view } };
        el.style.cursor = 'grabbing';
        hideTip();
      });
      zr.on('mousemove', e => {
        if (!drag) return;
        const w = drag.v.R - drag.v.L, h = drag.v.T - drag.v.B;
        const dx = (e.offsetX - drag.x) * (w / gw);
        const dy = (e.offsetY - drag.y) * (h / gh);
        view.L = drag.v.L - dx;
        view.R = view.L + w;
        view.B = drag.v.B + dy;
        view.T = view.B + h;
        applyView(true);
      });
      const endDrag = () => { if (drag) { drag = null; el.style.cursor = 'grab'; } };
      zr.on('mouseup', endDrag);
      zr.on('globalout', endDrag);
      zr.on('dblclick', () => { Object.assign(view, { L, R, B, T }); applyView(true); });
      /* 右下角操作按钮：复位视野（同双击）+ 重播轨迹生长动画。
         按钮是独立 DOM（z-index 5），点击不会落入 zrender，不触发拖动/滚轮 */
      const bar = document.createElement('div');
      bar.style.cssText = 'position:absolute;right:12px;bottom:12px;z-index:5;display:flex;gap:8px;';
      const mkBtn = (title, svg, fn) => {
        const b = document.createElement('button');
        b.title = title;
        b.style.cssText = 'width:32px;height:32px;padding:0;border:none;border-radius:8px;background:rgba(17,24,39,.72);color:#dfe6ff;cursor:pointer;display:flex;align-items:center;justify-content:center;';
        b.innerHTML = svg;
        b.addEventListener('click', fn);
        b.addEventListener('mouseenter', () => { b.style.background = 'rgba(17,24,39,.92)'; });
        b.addEventListener('mouseleave', () => { b.style.background = 'rgba(17,24,39,.72)'; });
        bar.appendChild(b);
      };
      mkBtn('复位视野（同双击）',
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
        () => { Object.assign(view, { L, R, B, T }); applyView(true); });
      mkBtn('重播轨迹',
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"/></svg>',
        playTrack);
      el.appendChild(bar);
      /* 海拔 / 心率随里程 */
      const hasEle = trk.some(p => p[2] != null), hasHr = trk.some(p => p[3] != null);
      if (!hasEle && !hasHr) return;
      const eleData = trk.map((p, i) => p[2] != null ? [cum[i], p[2]] : null).filter(Boolean);
      const hrData = trk.map((p, i) => p[3] != null ? [cum[i], p[3]] : null).filter(Boolean);
      const yAxes = [];
      if (hasEle) yAxes.push(Object.assign({}, AXIS_VAL, { name: '海拔 m', scale: true }));
      if (hasHr) yAxes.push(Object.assign({}, AXIS_VAL, { name: 'bpm', scale: true, splitLine: { show: false } }));
      const series = [];
      if (hasEle) series.push({ type: 'line', name: '海拔', data: eleData, showSymbol: false,
        lineStyle: { width: 1.6, color: '#0e9f8a' }, itemStyle: { color: '#0e9f8a' },
        areaStyle: { color: 'rgba(14,159,138,.08)' }, yAxisIndex: 0 });
      if (hasHr) series.push({ type: 'line', name: '心率', data: hrData, showSymbol: false,
        lineStyle: { width: 1.4, color: '#e5484d' }, itemStyle: { color: '#e5484d' }, yAxisIndex: yAxes.length - 1 });
      mount('trkEle', chartBase({
        legend: hasEle && hasHr ? { top: 0, right: 10, itemWidth: 14, textStyle: { color: '#7b8296', fontSize: 11 } } : undefined,
        grid: { left: 44, right: hasEle && hasHr ? 44 : 20, top: hasEle && hasHr ? 28 : 20, bottom: 26 },
        xAxis: Object.assign({}, AXIS_VAL, { name: '公里', min: 0, max: cum[cum.length - 1] || 1,
          nameTextStyle: { color: '#8a90a3', fontSize: 10 } }),
        yAxis: yAxes,
        series,
      }), { silent: true });
    },
    render(s) {
      const num = v => v != null && v !== '' ? v : null;
      const pos = v => num(v) > 0 ? v : null;   // 步频/速度等 ≤0 视为脏数据
      const chip = (k, v) => v != null ? `<div class="mchip">${k}<b>${v}</b></div>` : '';
      const kvRow = (k, v) => v != null ? `<div><span>${k}</span><b>${v}</b></div>` : '';
      /* 顶部速览 */
      const chips = [
        chip('时长', fmtDurS(s.dur)),
        chip('距离', s.dist > 100 ? fmtKm(s.dist) : null),
        chip('平均配速', s.pace ? fmtPace(s.pace) + ' /公里' : null),
        chip('卡路里', s.cal != null ? s.cal + ' kcal' : null),
        chip('平均心率', s.aHr ? s.aHr + ' bpm' : null),
        chip('最高心率', s.mHr ? s.mHr + ' bpm' : null),
        chip('最低心率', s.nHr ? s.nHr + ' bpm' : null),
        chip('平均步频', pos(s.cad) ? s.cad + ' 步/分' : null),
        chip('训练负荷', pos(s.load)),
      ].join('');
      /* 心率区间 */
      const zones = S_ZONES.map(([k, n, col]) => ({ n, col, v: num(s[k]) })).filter(z => z.v);
      const zMax = Math.max(...zones.map(z => z.v), 1);
      const zoneHtml = zones.length ? `
        <div class="card col-6"><div class="card-h"><div><div class="t">心率区间时长</div><div class="s">共 ${fmtDur(zones.reduce((a, z) => a + z.v, 0))}</div></div></div>
          ${zones.map(z => `<div class="zone"><span class="lb">${z.n}</span><span class="tk"><i style="width:${(z.v / zMax * 100).toFixed(1)}%;background:${z.col}"></i></span><b>${fmtDur(z.v)}</b></div>`).join('')}
        </div>` : '';
      /* 训练效果 */
      const teBar = (lb, v, unit) => num(v) != null
        ? `<div class="tebar"><span class="lb">${lb}</span><span class="tk"><i style="width:${Math.min(100, (v / 5) * 100).toFixed(1)}%"></i></span><b>${v}${unit || ''}</b></div>` : '';
      const teHtml = (num(s.te) != null || num(s.teAna) != null || num(s.load) != null || num(s.rec) != null) ? `
        <div class="card col-6"><div class="card-h"><div><div class="t">训练效果与恢复</div><div class="s">训练效果满值 5.0</div></div></div>
          ${teBar('有氧训练效果', num(s.te))}
          ${teBar('无氧训练效果', num(s.teAna))}
          <div class="kv" style="margin-top:6px">
            ${kvRow('训练负荷', num(s.load))}
            ${kvRow('恢复时间', num(s.rec) != null ? s.rec + ' 小时' : null)}
            ${kvRow('单次 VO₂max', num(s.vo2) != null ? s.vo2 + ' ml/kg/min' : null)}
          </div>
        </div>` : '';
      /* 跑姿 */
      const formHtml = (pos(s.cad) != null || pos(s.stride) != null || pos(s.tdc) != null || pos(s.vo) != null || pos(s.vsr) != null) ? `
        <div class="card col-6"><div class="card-h"><div><div class="t">跑步形态</div><div class="s">来自手环运动传感器</div></div></div>
          <div class="kv" style="margin-top:6px">
            ${kvRow('平均步频', pos(s.cad) != null ? s.cad + ' 步/分' : null)}
            ${kvRow('最大步频', pos(s.cadMax) != null ? s.cadMax + ' 步/分' : null)}
            ${kvRow('平均步幅', pos(s.stride) != null ? s.stride + ' cm' : null)}
            ${kvRow('平均触地时间', pos(s.tdc) != null ? s.tdc + ' ms' : null)}
            ${kvRow('垂直振幅', pos(s.vo) != null ? s.vo + ' cm' : null)}
            ${kvRow('垂直步幅比', pos(s.vsr) != null ? s.vsr + ' %' : null)}
          </div>
        </div>` : '';
      /* 配速与地形 */
      const geoHtml = (pos(s.paceBest) || pos(s.paceWorst) || pos(s.spd) != null || pos(s.spdMax) != null || num(s.climb) != null || num(s.rise) != null) ? `
        <div class="card col-6"><div class="card-h"><div><div class="t">配速与地形</div></div></div>
          <div class="kv" style="margin-top:6px">
            ${kvRow('最快配速', pos(s.paceBest) ? fmtPace(s.paceBest) + ' /公里' : null)}
            ${kvRow('最慢配速', pos(s.paceWorst) ? fmtPace(s.paceWorst) + ' /公里' : null)}
            ${kvRow('平均速度', pos(s.spd) != null ? (+s.spd).toFixed(1) + ' km/h' : null)}
            ${kvRow('最大速度', pos(s.spdMax) != null ? (+s.spdMax).toFixed(1) + ' km/h' : null)}
            ${kvRow('累计爬升', num(s.climb) != null ? s.climb + ' m' : null)}
            ${kvRow('上升 / 下降', (num(s.rise) != null || num(s.fall) != null) ? `${num(s.rise) ?? '—'} / ${num(s.fall) ?? '—'} m` : null)}
          </div>
        </div>` : '';
      /* 其他 */
      const PRED_LB = ['5 公里', '10 公里', '半程马拉松', '全程马拉松'];
      const preds = (s.pred || []).map((p, i) => p ? `${PRED_LB[i]} ${fmtDurS(p)}` : null).filter(Boolean);
      const miscRows = [
        kvRow('运动步数', num(s.steps) != null ? fmtInt(s.steps) + ' 步' : null),
        kvRow('总消耗（含基础）', num(s.totalCal) != null ? s.totalCal + ' kcal' : null),
        kvRow('跑步能力指数', num(s.rai) != null && s.rai > 0 ? s.rai : null),
        kvRow('成绩预测', preds.join(' · ') || null),
      ].join('');
      const miscHtml = miscRows.trim() ? `
        <div class="card col-12"><div class="card-h"><div><div class="t">综合数据</div></div></div>
          <div class="kv" style="margin-top:6px;grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">${miscRows}</div>
        </div>` : '';
      /* GPS 轨迹 */
      const trkHtml = (s.track && s.track.length > 1) ? `
        <div class="card col-12"><div class="card-h"><div><div class="t">GPS 轨迹</div><div class="s">卫星图背景 · ${s.track.length} 个轨迹点 · 绿点起点 红点终点 · 悬停查看里程</div></div></div><div class="chart trk" id="trkMap"></div></div>` : '';
      const hasEle = s.track && s.track.some(p => p[2] != null);
      const hasHr = s.track && s.track.some(p => p[3] != null);
      const eleHtml = (hasEle || hasHr) ? `
        <div class="card col-12"><div class="card-h"><div><div class="t">${hasEle && hasHr ? '海拔与心率' : hasEle ? '海拔' : '心率'}</div><div class="s">横轴为累计里程（公里）</div></div></div><div class="chart short" id="trkEle"></div></div>` : '';
      return `<div class="chips">${chips}</div>
        <div class="grid">${trkHtml}${eleHtml}${zoneHtml}${teHtml}${formHtml}${geoHtml}${miscHtml}</div>`;
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
    const ovS = $('#sportModal');
    sportModal.el = ovS;
    ovS.addEventListener('click', e => { if (e.target === ovS) sportModal.close(); });
    ovS.querySelector('.close').addEventListener('click', () => sportModal.close());
    /* 弹层内滚轮不穿透主页面：modal-b 内部自然滚动（到边不外溢），
       悬停在弹层其他区域（头部/遮罩）时直接拦截 */
    [ov, ovS].forEach(o => o.addEventListener('wheel', e => {
      if (!e.target.closest('.modal-b')) e.preventDefault();
    }, { passive: false }));
    ovS.querySelector('.sm-day').addEventListener('click', () => {
      const s = S && S.list[sportModal.cur];
      sportModal.close();
      if (s && idxOf(s.d) >= 0) modal.open(s.d);
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { sportModal.close(); modal.close(); } });

    applyPreset('30');
    switchTab('overview');
  }

  return {
    D, S, H, META, state, sl, dates, idxOf, $,
    fmtInt, fmtNum, fmtDur, fmtDurS, fmtKm, fmtPace, fmtClock, fmtBig, weekday,
    avg, sum, cnt, movingAvg,
    chartBase, mount, AXIS_DATE, AXIS_VAL, loadMonth,
    openDay: d => modal.open(d), openSport: i => sportModal.open(i),
    register, rerender: renderActive,
    boot,
  };
})();
