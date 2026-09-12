/* ============================================================
 * 功能模块：总览 / 步数 / 心率 / 睡眠 / 运动 / 身体 / 压力
 * ============================================================ */
(function () {
  'use strict';
  const B = window.Board;
  const { D, S, H, META, state, sl, dates, $, chartBase, mount, AXIS_DATE, AXIS_VAL,
    fmtInt, fmtNum, fmtDur, fmtDurS, fmtKm, fmtPace, fmtClock, fmtBig,
    avg, sum, cnt, movingAvg } = B;

  const C = { steps: '#3b6df0', hr: '#e5484d', sleep: '#7a5af8', sport: '#8147d8',
    weight: '#0e9f8a', stress: '#f76b15', spo2: '#0e7f9f', ok: '#0e9f6e' };

  /* tooltip 数值格式化辅助：vf(格式函数) -> { tooltip: { valueFormatter } } */
  const vf = f => ({ tooltip: { valueFormatter: v => v == null ? '—' : f(v) } });
  const fmtKg = v => (v % 1 ? v.toFixed(1) : v) + ' 公斤';

  /* ---------- 通用片段 ---------- */
  function card(id, title, sub, span, height) {
    return `<div class="card col-${span}">
      <div class="card-h"><div><div class="t">${title}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div></div>
      <div class="chart ${height || ''}" id="${id}"></div></div>`;
  }
  function statCard(label, value, unit, delta, color, goodDir) {
    const len = state.end - state.start + 1;
    const pe = state.start - 1, ps = Math.max(0, state.start - len);
    const tip = pe >= 0 ? ` title="上一时段：${D.dates[ps]} ~ ${D.dates[pe]}，按同等天数取均值对比"` : '';
    let d = '';
    if (delta != null && isFinite(delta) && Math.abs(delta) > 0.05) {
      const up = delta > 0, good = goodDir === 0 ? null : (goodDir > 0 ? up : !up);
      d = `<div class="d"${tip}>较前${len}天 <b class="${good === null ? '' : good ? 'good' : 'bad'}">${up ? '▲' : '▼'} ${Math.abs(delta).toFixed(1)}%</b></div>`;
    } else if (delta != null) {
      d = `<div class="d"${tip}>与前${len}天持平</div>`;
    }
    return `<div class="card stat col-2">
      <div class="k"><i style="background:${color}"></i>${label}</div>
      <div class="v">${value}<small>${unit || ''}</small></div>${d}</div>`;
  }
  function emptyCard(title, sub, span) {
    return `<div class="card col-${span}"><div class="card-h"><div><div class="t">${title}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div></div><div class="empty" style="height:200px">该时段无数据</div></div>`;
  }
  function hasData(name) { return cnt(sl(name)) > 0; }
  function zoom(dsLen) {
    return dsLen > 120 ? [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 6, labelFormatter: () => '' }] : [{ type: 'inside' }];
  }
  /* 有缩放条时底部留 48，无则用紧凑底距 */
  const zB = (n, base) => n > 120 ? 48 : base;
  /* 范围前一时段均值（用于对比） */
  function prevAvg(name) {
    const len = state.end - state.start + 1;
    const pe = state.start - 1, ps = state.start - len;
    if (pe < 0) return null;
    return avg(D[name].slice(Math.max(0, ps), pe + 1));
  }
  function deltaPct(name) {
    const a = avg(sl(name)), b = prevAvg(name);
    if (a == null || b == null || !b) return null;
    return (a - b) / b * 100;
  }

  /* ============================================================ 总览 */
  B.register('overview', sec => {
    const ds = dates();
    const last = D.dates[state.end];
    // 最新一天目标完成度
    const li = state.end;
    const gs = D.goalSteps[li] || 6000, gc = D.goalCal[li] || 500, ge = D.goalEx[li] || 30;
    const st = D.steps[li], cl = D.cal[li];
    const prog = (label, v, g, unit) => `
      <div class="prog"><div class="row"><span>${label}</span><span>${v != null ? fmtInt(v) + ' / ' + fmtInt(g) + unit : '无数据'}</span></div>
      <div class="bar"><i style="width:${v == null ? 0 : Math.min(100, v / g * 100)}%"></i></div></div>`;
    // 覆盖度
    const covRows = [
      ['步数', 'steps'], ['活动卡路里', 'cal'], ['静息心率', 'rhr'], ['睡眠', 'slpTotal'],
      ['压力', 'stress'], ['血氧', 'spo2'], ['体重', 'weight'], ['PAI', 'pai'],
    ].map(([n, k]) => {
      const arr = D[k];
      let first = null, lastI = null, c = 0;
      for (let i = 0; i < arr.length; i++) if (arr[i] != null) { if (first === null) first = i; lastI = i; c++; }
      return `<div><span>${n}</span><b>${c ? `${c} 天 · ${D.dates[first].slice(0, 7)} ~ ${D.dates[lastI].slice(0, 7)}` : '无'}</b></div>`;
    }).join('');
    // 生涯
    const M = META.medals || {};
    const lifeRows = `
      <div><span>累计步数</span><b>${fmtBig(M.totalSteps != null ? M.totalSteps : sum(D.steps))} 步</b></div>
      <div><span>累计活动消耗</span><b>${fmtBig(M.totalCalorie != null ? M.totalCalorie : sum(D.cal))} kcal</b></div>
      <div><span>步数达标天数</span><b>${fmtInt(M.stepGoalDays)}</b></div>
      <div><span>运动次数</span><b>${(S ? S.list.length : 0)} 次</b></div>
      <div><span>运动总里程</span><b>${M.sport ? fmtKm(M.sport.distance) : '—'}</b></div>
      <div><span>数据总天数</span><b>${D.dates.length} 天</b></div>`;

    const wArr = sl('weight');
    let wLast = null; for (const v of wArr) if (v != null) wLast = v;

    sec.innerHTML = `
      <div class="grid">
        ${statCard('日均步数', fmtInt(avg(sl('steps'))), '步', deltaPct('steps'), C.steps, 1)}
        ${statCard('日均活动卡路里', fmtInt(avg(sl('cal'))), 'kcal', deltaPct('cal'), C.weight, 0)}
        ${statCard('平均睡眠', fmtDur(avg(sl('slpTotal'))), '', deltaPct('slpTotal'), C.sleep, 1)}
        ${statCard('平均静息心率', fmtNum(avg(sl('rhr')), 1), 'bpm', deltaPct('rhr'), C.hr, -1)}
        ${statCard('日均压力', fmtNum(avg(sl('stress')), 1), '', deltaPct('stress'), C.stress, -1)}
        ${statCard('当前体重', wLast != null ? fmtNum(wLast, 1) : '—', 'kg', null, C.weight, 0)}
        <div class="card col-4"><div class="card-h"><div><div class="t">最新一天 · ${last}</div><div class="s">目标完成情况</div></div></div>
          ${prog('步数', st, gs, ' 步')}${prog('活动卡路里', cl, gc, ' kcal')}
          <div class="note" style="margin-top:2px">数据截至当天已有记录，目标：${fmtInt(gs)} 步 / ${fmtInt(gc)} kcal</div>
        </div>
        <div class="card col-4"><div class="card-h"><div><div class="t">数据覆盖度</div><div class="s">各指标记录情况（全量历史）</div></div></div>
          <div class="kv" style="margin-top:4px;grid-template-columns:1fr">${covRows}</div>
        </div>
        <div class="card col-4"><div class="card-h"><div><div class="t">生涯数据</div><div class="s">自 2016 年有记录以来</div></div></div>
          <div class="kv" style="margin-top:4px">${lifeRows}</div>
        </div>
        ${card('ovSteps', '步数趋势', '当前范围', 12, '')}
        ${card('ovSleep', '睡眠时长', '', 6, 'short')}
        ${card('ovRhr', '静息心率', '', 6, 'short')}
      </div>`;

    const ds2 = dates();
    mount('ovSteps', chartBase(Object.assign({
      grid: { left: 58, right: 36, top: 32, bottom: zB(ds2.length, 30) },
      dataZoom: zoom(ds2.length),
      xAxis: Object.assign({}, AXIS_DATE, { data: ds2 }),
      yAxis: Object.assign({}, AXIS_VAL, { name: '步' }),
      series: [{
        type: 'bar', name: '步数', data: sl('steps'),
        itemStyle: { color: p => p.value >= (D.goalSteps[p.dataIndex + state.start] || 6000) ? '#3b6df0' : '#aebdf7', borderRadius: [2, 2, 0, 0] },
      }],
    }, vf(v => fmtInt(v) + ' 步'))));
    mount('ovSleep', chartBase(Object.assign({
      grid: { left: 50, right: 36, top: 30, bottom: zB(ds2.length, 26) },
      dataZoom: zoom(ds2.length),
      xAxis: Object.assign({}, AXIS_DATE, { data: ds2 }),
      yAxis: Object.assign({}, AXIS_VAL, { name: '小时', minInterval: 1 }),
      series: [{ type: 'line', name: '睡眠', data: sl('slpTotal').map(v => v == null ? null : v / 60),
        showSymbol: false, lineStyle: { width: 1.5, color: C.sleep }, itemStyle: { color: C.sleep },
        areaStyle: { color: 'rgba(122,90,248,.08)' } }],
    }, vf(v => fmtDur(v * 60)))));
    mount('ovRhr', chartBase(Object.assign({
      grid: { left: 46, right: 36, top: 32, bottom: zB(ds2.length, 26) },
      dataZoom: zoom(ds2.length),
      xAxis: Object.assign({}, AXIS_DATE, { data: ds2 }),
      yAxis: Object.assign({}, AXIS_VAL, { scale: true, name: 'bpm' }),
      series: [{ type: 'line', name: '静息心率', data: sl('rhr'),
        showSymbol: false, lineStyle: { width: 1.5, color: C.hr }, itemStyle: { color: C.hr } }],
    }, vf(v => Math.round(v) + ' 次/分'))));
  });

  /* ============================================================ 步数与活动 */
  B.register('steps', sec => {
    const yr = state.heatYear || +D.dates[state.end].slice(0, 4);
    state.heatYear = yr;
    const years = [];
    for (let i = +D.dates[0].slice(0, 4); i <= +D.dates[D.dates.length - 1].slice(0, 4); i++) years.push(i);

    // 达标统计
    const st = sl('steps'), gl = sl('goalSteps');
    let hit = 0, tot = 0, curStreak = 0, bestStreak = 0, run = 0;
    for (let i = 0; i < st.length; i++) {
      if (st[i] == null) { run = 0; continue; }
      tot++;
      const g = gl[i] || 6000;
      if (st[i] >= g) { hit++; run++; bestStreak = Math.max(bestStreak, run); } else run = 0;
    }
    curStreak = run;
    const rate = tot ? (hit / tot * 100).toFixed(1) : 0;

    sec.innerHTML = `
      <div class="grid">
        ${card('stBar', '每日步数', '深色 = 达标当日', 12, '')}
        <div class="card col-8"><div class="card-h">
            <div><div class="t">年度热力日历</div><div class="s">颜色越深步数越多，点击任意一天查看当日明细</div></div>
            <div class="tools"><div class="mini-nav">
              <button id="hyPrev">‹</button><span class="yr">${yr}</span><button id="hyNext">›</button>
            </div></div>
          </div><div class="chart tall" id="stHeat"></div></div>
        <div class="card col-4"><div class="card-h"><div><div class="t">一天中的节律</div><div class="s">各小时平均步数（全量历史）</div></div></div><div class="chart fill" id="stHour"></div></div>
        ${card('stWh', '星期 × 小时', '平均步数', 4, 'short')}
        ${card('stDist', '每日距离', '', 4, 'short')}
        ${card('stCal', '每日活动卡路里', '', 4, 'short')}
        <div class="card col-4"><div class="card-h"><div><div class="t">达标情况</div><div class="s">当前范围</div></div></div>
          <div style="display:flex;gap:18px;align-items:center;margin:14px 0 6px">
            <div><div class="v" style="font-size:30px;font-weight:700">${rate}<small style="font-size:13px;color:var(--sub)"> %</small></div><div class="note">达标率（${hit}/${tot} 天）</div></div>
            <div><div class="v" style="font-size:30px;font-weight:700">${bestStreak}<small style="font-size:13px;color:var(--sub)"> 天</small></div><div class="note">最长连续达标</div></div>
            <div><div class="v" style="font-size:30px;font-weight:700">${curStreak}<small style="font-size:13px;color:var(--sub)"> 天</small></div><div class="note">当前连续</div></div>
          </div>
        </div>
        ${card('stStand', '每日站立', '活跃站立次数', 4, 'short')}
        ${card('stInt', '活动强度', '中高强度时长（分钟）', 4, 'short')}
      </div>`;

    const ds = dates();
    mount('stBar', chartBase(Object.assign({
      grid: { left: 58, right: 50, top: 32, bottom: zB(ds.length, 30) },
      dataZoom: zoom(ds.length),
      xAxis: Object.assign({}, AXIS_DATE, { data: ds }),
      yAxis: Object.assign({}, AXIS_VAL, { name: '步' }),
      series: [{
        type: 'bar', name: '步数', data: st, large: ds.length > 1500,
        itemStyle: { color: '#3b6df0', borderRadius: [2, 2, 0, 0] },
        markLine: {
          silent: true, symbol: 'none',
          lineStyle: { color: '#f5a623', type: 'dashed' },
          label: { formatter: '目标', color: '#b07818', fontSize: 11 },
          data: [{ yAxis: gl[gl.length - 1] || 6000 }],
        },
      }],
    }, vf(v => fmtInt(v) + ' 步'))));

    // 热力日历
    const yStart = D.dates.findIndex(d => d >= yr + '-01-01');
    const yEnd = D.dates.findIndex(d => d >= (yr + 1) + '-01-01');
    const heatData = [];
    const goalOf = {};
    if (yStart >= 0) {
      const e = yEnd < 0 ? D.dates.length : yEnd;
      for (let i = yStart; i < e; i++) {
        if (D.steps[i] != null) {
          heatData.push([D.dates[i], D.steps[i]]);
          goalOf[D.dates[i]] = D.goalSteps[i] || 6000;
        }
      }
    }
    mount('stHeat', chartBase({
      tooltip: {
        trigger: 'item', backgroundColor: 'rgba(255,255,255,.96)', borderColor: '#e7e9f0',
        textStyle: { color: '#333a48', fontSize: 12.5 },
        formatter: p => {
          const g = goalOf[p.value[0]] || 6000;
          return `${p.value[0]}<br/>步数 <b>${fmtInt(p.value[1])}</b> / 目标 ${fmtInt(g)}<br/>${p.value[1] >= g ? '✓ 达标' : '未达标'}`;
        },
      },
      visualMap: {
        min: 0, max: 15000, calculable: false, orient: 'horizontal', left: 'center', bottom: 0,
        itemHeight: 90, itemWidth: 12, textStyle: { color: '#8a90a3', fontSize: 10 },
        inRange: { color: ['#eef1f8', '#c4d3fb', '#7d9bf9', '#3b6df0', '#1d3fae'] },
      },
      calendar: {
        range: yr, cellSize: ['auto', 'auto'], left: 44, right: 8, top: 34, bottom: 52,
        itemStyle: { borderWidth: 2, borderColor: '#fff' },
        yearLabel: { show: false },
        dayLabel: { nameMap: 'ZH', color: '#8a90a3', fontSize: 10 },
        monthLabel: { nameMap: 'ZH', color: '#8a90a3', fontSize: 10 },
        splitLine: { show: false },
      },
      series: [{
        type: 'heatmap', coordinateSystem: 'calendar', data: heatData,
        itemStyle: { borderRadius: 2 },
      }],
    }), { silent: false });

    $('#hyPrev').onclick = () => { if (yr > years[0]) { state.heatYear = yr - 1; B.rerender(); } };
    $('#hyNext').onclick = () => { if (yr < years[years.length - 1]) { state.heatYear = yr + 1; B.rerender(); } };

    mount('stHour', chartBase(Object.assign({
      grid: { left: 46, right: 24, top: 32, bottom: 26 },
      xAxis: { type: 'category', data: [...Array(24)].map((_, i) => i + '时'),
        axisLabel: { color: '#8a90a3', fontSize: 10, showMaxLabel: true } },
      yAxis: Object.assign({}, AXIS_VAL, { name: '步' }),
      series: [{ type: 'bar', name: '平均步数', data: H.hSteps, itemStyle: { color: '#3b6df0', borderRadius: [3, 3, 0, 0] } }],
    }, vf(v => Math.round(v) + ' 步'))), { silent: true });

    const WD_CN = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    mount('stWh', chartBase({
      grid: { left: 44, right: 24, top: 14, bottom: 44 },
      tooltip: { position: 'top', trigger: 'item',
        formatter: p => `${WD_CN[p.value[1]]} ${p.value[0]}时 · 平均 <b>${Math.round(p.value[2])}</b> 步` },
      xAxis: { type: 'category', data: [...Array(24)].map((_, i) => i), axisLabel: { color: '#8a90a3', fontSize: 10, showMaxLabel: true } },
      yAxis: { type: 'category', data: ['一', '二', '三', '四', '五', '六', '日'],
        axisLabel: { color: '#8a90a3', fontSize: 11 } },
      visualMap: { show: false, min: 0, max: Math.max(...H.wh.flat()) || 100,
        inRange: { color: ['#f2f4fa', '#c4d3fb', '#7d9bf9', '#3b6df0', '#1d3fae'] } },
      series: [{ type: 'heatmap', data: H.wh.flatMap((row, w) => row.map((v, h) => [h, w, v])) }],
    }), { silent: true });

    const mkTrend = (id, name, data, color, vfn, unit) => mount(id, chartBase(Object.assign({
      grid: { left: 52, right: 36, top: 32, bottom: zB(ds.length, 26) },
      dataZoom: zoom(ds.length),
      xAxis: Object.assign({}, AXIS_DATE, { data: ds }),
      yAxis: Object.assign({}, AXIS_VAL, { name: unit }),
      series: [{ type: 'line', name, data, showSymbol: false,
        lineStyle: { width: 1.4, color }, itemStyle: { color },
        areaStyle: { color: color + '14' } }],
    }, vfn ? vf(vfn) : {})));
    mkTrend('stDist', '距离', sl('dist').map(v => v == null ? null : +(v / 1000).toFixed(2)), C.weight,
      v => fmtInt(v * 1000) + ' 米', '公里');
    mkTrend('stCal', '卡路里', sl('cal'), '#f5a623', v => fmtInt(v) + ' 千卡', '千卡');
    mount('stStand', chartBase(Object.assign({
      grid: { left: 40, right: 36, top: 32, bottom: zB(ds.length, 26) },
      dataZoom: zoom(ds.length),
      xAxis: Object.assign({}, AXIS_DATE, { data: ds }),
      yAxis: Object.assign({}, AXIS_VAL, { name: '次' }),
      series: [{ type: 'bar', name: '站立次数', data: sl('stand'), itemStyle: { color: '#0e9f6e', borderRadius: [2, 2, 0, 0] } }],
    }, vf(v => fmtInt(v) + ' 次'))));
    mount('stInt', chartBase(Object.assign({
      grid: { left: 40, right: 36, top: 32, bottom: zB(ds.length, 26) },
      dataZoom: zoom(ds.length),
      xAxis: Object.assign({}, AXIS_DATE, { data: ds }),
      yAxis: Object.assign({}, AXIS_VAL, { name: '分钟' }),
      series: [{ type: 'bar', name: '中高强度时长', data: sl('intensity'), itemStyle: { color: '#f76b15', borderRadius: [2, 2, 0, 0] } }],
    }, vf(v => fmtInt(v) + ' 分钟'))));
  });

  /* ============================================================ 心率 */
  B.register('heart', sec => {
    const ds = dates();
    if (!cnt(sl('rhr')) && !cnt(sl('avgHr'))) {
      sec.innerHTML = emptyCard('心率数据', '', 12); return;
    }
    let maxRec = null, maxDate = '', minRhr = null;
    sl('maxHr').forEach((v, i) => { if (v != null && (maxRec == null || v > maxRec)) { maxRec = v; maxDate = ds[i]; } });
    sl('rhr').forEach(v => { if (v != null && (minRhr == null || v < minRhr)) minRhr = v; });
    const zNames = [['zWarm', '热身', '#aebdf7'], ['zFat', '燃脂', '#f5a623'], ['zAero', '有氧', '#3b6df0'], ['zAnaero', '无氧', '#e5484d'], ['zExtreme', '极限', '#8b1d3f']];

    sec.innerHTML = `
      <div class="grid">
        ${card('hrRhr', '静息心率', '长期趋势（叠 30 日均线）—— 最有健康价值的曲线', 12, '')}
        ${card('hrBand', '心率区间带', '每日最高 / 平均 / 最低心率', 8, '')}
        <div class="card col-4"><div class="card-h"><div><div class="t">心率摘要</div></div></div>
          <div class="kv" style="margin-top:6px">
            <div><span>最新静息心率</span><b>${(() => { let v = null; for (const x of sl('rhr')) if (x != null) v = x; return v != null ? v + ' bpm' : '—'; })()}</b></div>
            <div><span>范围均值</span><b>${fmtNum(avg(sl('rhr')), 1)} bpm</b></div>
            <div><span>历史最低静息</span><b>${minRhr != null ? minRhr + ' bpm' : '—'}</b></div>
            <div><span>范围最高心率</span><b>${maxRec != null ? maxRec + ' bpm' : '—'}</b></div>
            <div><span>最高纪录日期</span><b>${maxDate || '—'}</b></div>
            <div><span>平均心率均值</span><b>${fmtNum(avg(sl('avgHr')), 1)} bpm</b></div>
          </div>
        </div>
        ${card('hrZone', '心率区间时长', '热身 / 燃脂 / 有氧 / 无氧 / 极限（分钟，堆叠）', 12, '')}
      </div>`;

    mount('hrRhr', chartBase(Object.assign({
      grid: { left: 50, right: 64, top: 32, bottom: zB(ds.length, 30) },
      dataZoom: zoom(ds.length),
      xAxis: Object.assign({}, AXIS_DATE, { data: ds }),
      yAxis: Object.assign({}, AXIS_VAL, { scale: true, name: 'bpm' }),
      series: [
        { type: 'line', name: '静息心率', data: sl('rhr'), showSymbol: false,
          lineStyle: { width: 1.5, color: C.hr }, itemStyle: { color: C.hr },
          markLine: { silent: true, symbol: 'none', lineStyle: { color: '#c3c8d6', type: 'dashed' },
            label: { formatter: '均值 {c}', color: '#8a90a3', fontSize: 11 },
            data: [{ yAxis: +(avg(sl('rhr')) || 0).toFixed(1) }] } },
        { type: 'line', name: '30日均线', data: movingAvg(sl('rhr'), 30), showSymbol: false,
          lineStyle: { width: 2.2, color: '#1d3fae' }, itemStyle: { color: '#1d3fae' } },
      ],
    }, vf(v => Math.round(v) + ' 次/分'))));
    const bandSeries = [['maxHr', '最高', '#f0a4aa'], ['avgHr', '平均', '#e5484d'], ['minHr', '最低', '#f7d5d8']]
      .map(([k, n, col]) => ({ type: 'line', name: n, data: sl(k), showSymbol: false,
        lineStyle: { width: n === '平均' ? 1.8 : 1, color: col }, itemStyle: { color: col } }));
    mount('hrBand', chartBase(Object.assign({
      grid: { left: 46, right: 36, top: 32, bottom: zB(ds.length, 30) },
      dataZoom: zoom(ds.length),
      xAxis: Object.assign({}, AXIS_DATE, { data: ds }),
      yAxis: Object.assign({}, AXIS_VAL, { scale: true, name: 'bpm' }),
      series: bandSeries,
    }, vf(v => Math.round(v) + ' 次/分'))));
    mount('hrZone', chartBase(Object.assign({
      grid: { left: 50, right: 36, top: 30, bottom: zB(ds.length, 30) },
      dataZoom: zoom(ds.length),
      xAxis: Object.assign({}, AXIS_DATE, { data: ds }),
      yAxis: Object.assign({}, AXIS_VAL, { name: '分钟' }),
      series: zNames.map(([k, n, col]) => ({
        type: 'bar', name: n, stack: 'z', data: sl(k),
        itemStyle: { color: col }, barWidth: '90%',
      })),
    }, vf(v => fmtInt(v) + ' 分钟'))));
  });

  /* ============================================================ 睡眠 */
  B.register('sleep', sec => {
    if (!cnt(sl('slpTotal'))) { sec.innerHTML = emptyCard('睡眠数据', '', 12); return; }
    const ds = dates();
    const bed = sl('bedMin'), wake = sl('wakeMin');
    let bedAvg = null, wakeAvg = null;
    { let s = 0, n = 0, s2 = 0, n2 = 0;
      bed.forEach(v => { if (v != null) { s += v; n++; } });
      wake.forEach(v => { if (v != null) { s2 += v; n2++; } });
      if (n) bedAvg = s / n; if (n2) wakeAvg = s2 / n2; }

    sec.innerHTML = `
      <div class="grid">
        ${card('slpTotal', '睡眠时长', `平均入睡 ${fmtClock(bedAvg)} · 平均起床 ${fmtClock(wakeAvg)} · 参考带 7–9 小时`, 12, '')}
        ${card('slpStruct', '睡眠结构', '深睡 / 浅睡 / REM / 清醒（小时，堆叠）', 8, '')}
        ${card('slpScore', '睡眠评分', '', 4, '')}
        ${card('slpSched', '作息节律', '入睡 ● 起床 ○ 时间散点', 12, '')}
      </div>`;

    mount('slpTotal', chartBase(Object.assign({
      grid: { left: 50, right: 36, top: 32, bottom: zB(ds.length, 30) },
      dataZoom: zoom(ds.length),
      tooltip: {
        formatter: ps => {
          let h = `<div style="font-weight:600;margin-bottom:2px">${ps[0].name}</div>`;
          ps.forEach(p => { h += `${p.marker}${p.seriesName} <b>${p.value != null ? fmtDur(p.value * 60) : '—'}</b><br/>`; });
          const i = ds.indexOf(ps[0].name);
          if (i >= 0) {
            const b = sl('bedMin')[i], w = sl('wakeMin')[i];
            if (b != null && w != null) h += `<div style="border-top:1px solid #eceef4;margin-top:4px;padding-top:4px"><span style="color:#8a90a3">入睡 / 起床</span> <b>${fmtClock(b)} ~ ${fmtClock(w)}</b></div>`;
          }
          return h;
        },
      },
      xAxis: Object.assign({}, AXIS_DATE, { data: ds }),
      yAxis: Object.assign({}, AXIS_VAL, { name: '小时', minInterval: 1 }),
      series: [
        { type: 'line', name: '睡眠时长', data: sl('slpTotal').map(v => v == null ? null : +(v / 60).toFixed(2)),
          showSymbol: false, lineStyle: { width: 1.4, color: C.sleep }, itemStyle: { color: C.sleep },
          areaStyle: { color: 'rgba(122,90,248,.08)' },
          markArea: { silent: true, itemStyle: { color: 'rgba(14,159,110,.05)' },
            label: { show: true, position: 'insideTop', color: '#0e9f6e', fontSize: 10 },
            data: [[{ yAxis: 7, name: '建议 7–9 小时' }, { yAxis: 9 }]] } },
        { type: 'line', name: '7日均线', data: movingAvg(sl('slpTotal'), 7).map(v => v == null ? null : +(v / 60).toFixed(2)),
          showSymbol: false, lineStyle: { width: 2.2, color: '#4c2fd6' }, itemStyle: { color: '#4c2fd6' } },
      ],
    })));
    const toH = a => a.map(v => v == null ? null : +(v / 60).toFixed(2));
    mount('slpStruct', chartBase(Object.assign({
      grid: { left: 50, right: 36, top: 30, bottom: zB(ds.length, 30) },
      dataZoom: zoom(ds.length),
      xAxis: Object.assign({}, AXIS_DATE, { data: ds }),
      yAxis: Object.assign({}, AXIS_VAL, { name: '小时' }),
      series: [
        { type: 'bar', name: '深睡', stack: 's', data: toH(sl('slpDeep')), itemStyle: { color: '#3d2ba8' }, barWidth: '90%' },
        { type: 'bar', name: '浅睡', stack: 's', data: toH(sl('slpLight')), itemStyle: { color: '#9b8af5' } },
        { type: 'bar', name: 'REM', stack: 's', data: toH(sl('slpRem')), itemStyle: { color: '#c9c0ff' } },
        { type: 'bar', name: '清醒', stack: 's', data: toH(sl('slpAwake')), itemStyle: { color: '#f0b8b4' } },
      ],
    }, vf(v => fmtDur(v * 60)))));
    mount('slpScore', chartBase(Object.assign({
      grid: { left: 40, right: 36, top: 32, bottom: zB(ds.length, 26) },
      dataZoom: zoom(ds.length),
      xAxis: Object.assign({}, AXIS_DATE, { data: ds }),
      yAxis: Object.assign({}, AXIS_VAL, { min: 0, max: 100, name: '分' }),
      series: [{ type: 'line', name: '睡眠评分', data: sl('slpScore'),
        showSymbol: ds.length < 90, symbolSize: 4,
        lineStyle: { width: 1.4, color: C.sleep }, itemStyle: { color: C.sleep } }],
    }, vf(v => fmtInt(v) + ' 分'))));
    // 作息散点：y 为相对 00:00 的分钟（-420 = 前一日 18:00）
    const sc = arr => ds.map((d, i) => arr[i] == null ? null : [d, arr[i]])
      .filter(v => v != null && v[1] > -420 && v[1] < 1140);
    mount('slpSched', chartBase({
      grid: { left: 60, right: 36, top: 26, bottom: zB(ds.length, 30) },
      dataZoom: zoom(ds.length),
      xAxis: Object.assign({}, AXIS_DATE, { data: ds }),
      yAxis: { type: 'value', min: -420, max: 1140, interval: 120,
        axisLabel: { color: '#8a90a3', fontSize: 11, formatter: v => fmtClock(v) },
        splitLine: { lineStyle: { color: '#f0f1f6' } } },
      tooltip: {
        trigger: 'axis',
        formatter: ps => {
          let h = `<div style="font-weight:600;margin-bottom:2px">${ps[0].axisValue}</div>`;
          ps.forEach(p => { h += `${p.marker}${p.seriesName} <b>${fmtClock(p.value[1])}</b><br/>`; });
          const i = ds.indexOf(ps[0].axisValue);
          if (i >= 0) {
            const b = sl('bedMin')[i], w = sl('wakeMin')[i];
            if (b != null && w != null) h += `<div style="border-top:1px solid #eceef4;margin-top:4px;padding-top:4px"><span style="color:#8a90a3">时长</span> <b>${fmtDur((w - b + 1440) % 1440)}</b></div>`;
          }
          return h;
        },
      },
      series: [
        { type: 'scatter', name: '入睡', data: sc(bed, C.sleep), symbolSize: 4, itemStyle: { color: '#7a5af8', opacity: .55 } },
        { type: 'scatter', name: '起床', data: sc(wake, C.ok), symbolSize: 4, itemStyle: { color: '#0e9f6e', opacity: .55 } },
      ],
    }));
  });

  /* ============================================================ 运动 */
  B.register('sports', sec => {
    const all = S ? S.list : [];
    // 按时间范围过滤；类型 chips 计数基于当前范围，若已选类型在本时段无记录则回退“全部”
    const inRange = all.filter(s => s.d >= D.dates[state.start] && s.d <= D.dates[state.end]);
    if (state.sportType !== 'all' && !inRange.some(s => s.t === state.sportType)) state.sportType = 'all';
    const list = state.sportType === 'all' ? inRange : inRange.filter(s => s.t === state.sportType);
    const typeCn = S ? S.typeCn : {};
    const totDist = sum(list.map(s => s.dist || 0));
    const totDur = sum(list.map(s => s.dur || 0));
    const totCal = sum(list.map(s => s.cal || 0));

    // 月度里程
    const byMonth = {};
    list.forEach(s => { if ((s.dist || 0) > 100) byMonth[s.d.slice(0, 7)] = (byMonth[s.d.slice(0, 7)] || 0) + s.dist; });
    const mk = Object.keys(byMonth).sort();

    // 排序
    const k = state.sortKey, dir = state.sortDir;
    const sorted = [...list].sort((a, b) => {
      const va = a[k], vb = b[k];
      return (va == null ? -1 : vb == null ? 1 : (va > vb ? 1 : va < vb ? -1 : 0)) * dir;
    });
    const COLS = [['d', '日期'], ['t', '类型'], ['dur', '时长'], ['dist', '距离'], ['pace', '配速'],
      ['cal', '卡路里'], ['aHr', '均心率'], ['mHr', '最高心率'], ['climb', '爬升(m)']];
    const rows = sorted.map(s => `<tr data-d="${s.d}">
      <td>${s.d}</td><td><span class="tag">${typeCn[s.t] || s.t}</span></td>
      <td>${fmtDurS(s.dur)}</td><td>${s.dist > 100 ? fmtKm(s.dist) : '—'}</td>
      <td>${s.pace ? fmtPace(s.pace) : '—'}</td><td>${s.cal != null ? s.cal : '—'}</td>
      <td>${s.aHr || '—'}</td><td>${s.mHr || '—'}</td><td>${s.climb || '—'}</td></tr>`).join('');

    const typeChips = `<button class="chip ${state.sportType === 'all' ? 'on' : ''}" data-t="all">全部 ${inRange.length}</button>` +
      Object.entries(typeCn).filter(([t]) => inRange.some(s => s.t === t)).map(([t, cn]) => {
        const n = inRange.filter(s => s.t === t).length;
        return `<button class="chip ${state.sportType === t ? 'on' : ''}" data-t="${t}">${cn} ${n}</button>`;
      }).join('');

    sec.innerHTML = `
      <div class="grid">
        ${statCardRange('运动次数', list.length, '次', C.sport)}
        ${statCardRange('总里程', totDist > 1000 ? (totDist / 1000).toFixed(1) : totDist, 'km', C.sport)}
        ${statCardRange('总时长', totDur >= 3600 ? (totDur / 3600).toFixed(1) : Math.round(totDur / 60), totDur >= 3600 ? '小时' : '分钟', C.sport)}
        ${statCardRange('总卡路里', fmtInt(totCal), 'kcal', C.sport)}
        ${card('spPie', '类型分布', '按次数', 4, '')}
        ${card('spMonth', '月度运动里程', '', 8, '')}
        ${card('spPace', '跑步配速趋势', '仅跑步记录 · 越靠上越快', 6, '')}
        ${card('spHr', '运动心率', '每次运动的平均心率', 6, '')}
        <div class="card col-12"><div class="card-h">
          <div><div class="t">运动记录</div><div class="s">点击表头排序 · 点击行查看当日</div></div>
          <div class="tools type-chips">${typeChips}</div></div>
          <div class="table-wrap"><table><thead><tr>
            ${COLS.map(c => `<th data-k="${c[0]}">${c[1]}${k === c[0] ? (dir > 0 ? ' ↑' : ' ↓') : ''}</th>`).join('')}
          </tr></thead><tbody>${rows || '<tr><td colspan="9" style="text-align:center;color:#aab0c0;padding:30px">无记录</td></tr>'}</tbody></table></div>
        </div>
      </div>`;

    sec.querySelectorAll('.type-chips .chip').forEach(b => b.onclick = () => {
      state.sportType = b.dataset.t; B.rerender();
    });
    sec.querySelectorAll('thead th').forEach(th => th.onclick = () => {
      const kk = th.dataset.k;
      if (state.sortKey === kk) state.sortDir *= -1; else { state.sortKey = kk; state.sortDir = -1; }
      B.rerender();
    });
    sec.querySelectorAll('tbody tr').forEach(tr => tr.onclick = () => B.openDay(tr.dataset.d));

    // 类型饼图
    const typeCnt = {};
    list.forEach(s => typeCnt[s.t] = (typeCnt[s.t] || 0) + 1);
    mount('spPie', {
      tooltip: { trigger: 'item', formatter: '{b}<br/><b>{c}</b> 次（{d}%）' },
      series: [{
        type: 'pie', radius: ['44%', '70%'], center: ['50%', '52%'],
        itemStyle: { borderRadius: 5, borderColor: '#fff', borderWidth: 2 },
        label: { color: '#7b8296', fontSize: 11 },
        data: Object.entries(typeCnt).map(([t, c]) => ({ name: typeCn[t] || t, value: c })),
      }],
    }, { silent: true });

    mount('spMonth', chartBase(Object.assign({
      grid: { left: 50, right: 30, top: 32, bottom: mk.length > 40 ? 48 : 30 },
      dataZoom: mk.length > 40 ? [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 6, labelFormatter: () => '' }] : [{ type: 'inside' }],
      xAxis: { type: 'category', data: mk, axisLabel: { color: '#8a90a3', fontSize: 10, rotate: mk.length > 24 ? 40 : 0, showMaxLabel: true } },
      yAxis: Object.assign({}, AXIS_VAL, { name: '公里' }),
      series: [{ type: 'bar', name: '运动里程', data: mk.map(m => +(byMonth[m] / 1000).toFixed(1)),
        itemStyle: { color: '#8147d8', borderRadius: [3, 3, 0, 0] } }],
    }, vf(v => v + ' 公里'))), { silent: true });

    const runs = list.filter(s => s.t.includes('running') && s.pace);
    mount('spPace', chartBase(Object.assign({
      grid: { left: 54, right: 36, top: 32, bottom: zB(runs.length, 30) },
      dataZoom: zoom(runs.length),
      xAxis: Object.assign({}, AXIS_DATE, { data: runs.map(s => s.d) }),
      yAxis: Object.assign({}, AXIS_VAL, { inverse: true, min: v => Math.floor(v.min - 15), name: '分/公里', nameLocation: 'start',
        axisLabel: { color: '#8a90a3', fontSize: 11, formatter: v => fmtPace(v) } }),
      series: [{ type: 'scatter', name: '配速', data: runs.map(s => s.pace), symbolSize: 6,
        itemStyle: { color: p => p.value < 300 ? '#0e9f6e' : p.value < 360 ? '#3b6df0' : '#aebdf7', opacity: .8 } }],
    }, vf(v => fmtPace(v) + ' /公里'))));
    const hrPts = list.filter(s => s.aHr);
    mount('spHr', chartBase(Object.assign({
      grid: { left: 46, right: 36, top: 32, bottom: zB(hrPts.length, 30) },
      dataZoom: zoom(hrPts.length),
      xAxis: Object.assign({}, AXIS_DATE, { data: hrPts.map(s => s.d) }),
      yAxis: Object.assign({}, AXIS_VAL, { scale: true, name: 'bpm' }),
      series: [{ type: 'scatter', name: '运动平均心率',
        data: hrPts.map(s => s.aHr), symbolSize: 6,
        itemStyle: { color: '#e5484d', opacity: .75 } }],
    }, vf(v => Math.round(v) + ' 次/分'))));
  });

  function statCardRange(label, value, unit, color) {
    return `<div class="card stat col-3"><div class="k"><i style="background:${color}"></i>${label}</div>
      <div class="v">${value}<small>${unit}</small></div><div class="d">当前范围</div></div>`;
  }

  /* ============================================================ 身体 */
  B.register('body', sec => {
    const hM = (META.profile && META.profile.height) / 100 || 1.75;
    const hasW = cnt(sl('weight')) > 0;
    const wLow = +(18.5 * hM * hM).toFixed(1), wHigh = +(24 * hM * hM).toFixed(1);
    let wLast = null, wPrev = null;
    sl('weight').forEach(v => { if (v != null) { wPrev = wLast; wLast = v; } });
    const bmi = wLast != null ? (wLast / (hM * hM)).toFixed(1) : null;

    const vitHas = D.vitL && cnt(sl('vitL')) + cnt(sl('vitM')) + cnt(sl('vitH')) > 0;

    sec.innerHTML = `
      <div class="grid">
        ${hasW ? card('bw', '体重趋势', `身高 ${META.profile.height}cm · BMI 正常区间对应 ${wLow}–${wHigh}kg · 最新 ${fmtNum(wLast, 1)}kg（BMI ${bmi}）`, 8, '')
               : emptyCard('体重趋势', '', 8)}
        ${card('bvo2', 'VO₂max', '最大摄氧量', 4, '')}
        ${card('bspo2', '血氧', '日均 / 最低', 6, '')}
        ${card('bpai', 'PAI 活力指数', '7 日滚动 · 100 分达标', 6, '')}
        ${vitHas ? card('bvit', '活力时长', '低 / 中 / 高强度活动分钟数', 12, '') : ''}
      </div>`;

    if (hasW) mount('bw', chartBase(Object.assign({
      grid: { left: 48, right: 36, top: 32, bottom: zB(dates().length, 30) },
      dataZoom: zoom(dates().length),
      xAxis: Object.assign({}, AXIS_DATE, { data: dates() }),
      yAxis: Object.assign({}, AXIS_VAL, { scale: true, name: 'kg' }),
      series: [{ type: 'line', name: '体重', data: sl('weight'),
        symbol: 'circle', symbolSize: 4, connectNulls: true,
        lineStyle: { width: 1.8, color: C.weight }, itemStyle: { color: C.weight },
        areaStyle: { color: 'rgba(14,159,138,.07)' },
        markArea: { silent: true, itemStyle: { color: 'rgba(14,159,138,.06)' },
          label: { show: true, position: 'insideTop', color: '#0e9f8a', fontSize: 10 },
          data: [[{ yAxis: wLow, name: 'BMI 18.5–24' }, { yAxis: wHigh }]] } }],
    }, vf(fmtKg))));
    mount('bvo2', chartBase(Object.assign({
      grid: { left: 40, right: 36, top: 32, bottom: zB(dates().length, 26) },
      dataZoom: zoom(dates().length),
      xAxis: Object.assign({}, AXIS_DATE, { data: dates() }),
      yAxis: Object.assign({}, AXIS_VAL, { scale: true, name: 'ml/kg/min' }),
      series: [{ type: 'line', name: 'VO₂max', data: sl('vo2'),
        symbol: 'circle', symbolSize: 5, connectNulls: true,
        lineStyle: { width: 1.6, color: '#8147d8' }, itemStyle: { color: '#8147d8' } }],
    }, vf(v => fmtInt(v) + ' ml/kg/min'))));
    mount('bspo2', chartBase(Object.assign({
      grid: { left: 44, right: 36, top: 32, bottom: zB(dates().length, 30) },
      dataZoom: zoom(dates().length),
      xAxis: Object.assign({}, AXIS_DATE, { data: dates() }),
      yAxis: Object.assign({}, AXIS_VAL, { min: 80, max: 100, name: '%' }),
      series: [
        { type: 'line', name: '日均血氧', data: sl('spo2'), showSymbol: false,
          lineStyle: { width: 1.5, color: C.spo2 }, itemStyle: { color: C.spo2 } },
        { type: 'line', name: '最低血氧', data: sl('spo2Min'), showSymbol: false,
          lineStyle: { width: 1, color: '#8fc6d8', type: 'dashed' }, itemStyle: { color: '#8fc6d8' } },
      ],
    }, vf(v => fmtInt(v) + ' %'))));
    mount('bpai', chartBase(Object.assign({
      grid: { left: 44, right: 64, top: 32, bottom: zB(dates().length, 30) },
      dataZoom: zoom(dates().length),
      xAxis: Object.assign({}, AXIS_DATE, { data: dates() }),
      yAxis: Object.assign({}, AXIS_VAL, { name: '分' }),
      series: [
        { type: 'bar', name: 'PAI', data: sl('pai'), itemStyle: { color: '#f5a623', borderRadius: [2, 2, 0, 0] } },
        { type: 'line', name: '7日均线', data: movingAvg(sl('pai'), 7), showSymbol: false,
          lineStyle: { width: 1.8, color: '#d97e00' }, itemStyle: { color: '#d97e00' },
          markLine: { silent: true, symbol: 'none', lineStyle: { color: '#0e9f6e', type: 'dashed' },
            label: { formatter: '目标 100', color: '#0e9f6e', fontSize: 11 }, data: [{ yAxis: 100 }] } },
      ],
    }, vf(v => (v % 1 ? v.toFixed(1) : v) + ' 分'))));
    if (vitHas) mount('bvit', chartBase(Object.assign({
      grid: { left: 50, right: 36, top: 30, bottom: zB(dates().length, 30) },
      dataZoom: zoom(dates().length),
      xAxis: Object.assign({}, AXIS_DATE, { data: dates() }),
      yAxis: Object.assign({}, AXIS_VAL, { name: '分钟' }),
      series: [
        { type: 'bar', name: '低强度', stack: 'v', data: sl('vitL'), itemStyle: { color: '#aebdf7' }, barWidth: '90%' },
        { type: 'bar', name: '中强度', stack: 'v', data: sl('vitM'), itemStyle: { color: '#3b6df0' } },
        { type: 'bar', name: '高强度', stack: 'v', data: sl('vitH'), itemStyle: { color: '#1d3fae' } },
      ],
    }, vf(v => fmtInt(v) + ' 分钟'))));
  });

  /* ============================================================ 压力 */
  B.register('stress', sec => {
    if (!cnt(sl('stress'))) { sec.innerHTML = emptyCard('压力数据', '', 12); return; }
    const ds = dates();
    let hiDay = null, hiV = -1, loDay = null, loV = 1e9;
    sl('stress').forEach((v, i) => {
      if (v != null) { if (v > hiV) { hiV = v; hiDay = ds[i]; } if (v < loV) { loV = v; loDay = ds[i]; } }
    });
    // 压力 vs 睡眠评分
    const vsData = [];
    sl('stress').forEach((v, i) => {
      const s = sl('slpScore')[i];
      if (v != null && s != null) vsData.push([v, s, ds[i]]);
    });

    sec.innerHTML = `
      <div class="grid">
        ${card('psTrend', '日均压力', '0–39 放松 · 40–59 轻度 · 60–79 中度 · 80+ 重度（叠 30 日均线）', 12, '')}
        ${card('psScale', '压力构成', '放松 / 轻度 / 中度 / 重度时长（分钟，堆叠）', 8, '')}
        <div class="card col-4"><div class="card-h"><div><div class="t">压力摘要</div></div></div>
          <div class="kv" style="margin-top:6px">
            <div><span>范围均值</span><b>${fmtNum(avg(sl('stress')), 1)}</b></div>
            <div><span>最放松一天</span><b>${loDay ? loDay + ' · ' + loV : '—'}</b></div>
            <div><span>压力最大一天</span><b>${hiDay ? hiDay + ' · ' + hiV : '—'}</b></div>
            <div><span>有压力记录</span><b>${cnt(sl('stress'))} 天</b></div>
          </div>
          <div class="note" style="margin-top:10px">压力由手环根据心率变异性(HRV)估算，仅供参考。</div>
        </div>
        ${vsData.length > 10 ? card('psVs', '压力 × 睡眠质量', '日均压力 vs 睡眠评分（探索性）', 12, '') : ''}
      </div>`;

    mount('psTrend', chartBase(Object.assign({
      grid: { left: 46, right: 36, top: 32, bottom: zB(ds.length, 30) },
      dataZoom: zoom(ds.length),
      xAxis: Object.assign({}, AXIS_DATE, { data: ds }),
      yAxis: Object.assign({}, AXIS_VAL, { max: 100, name: '分' }),
      series: [
        { type: 'line', name: '日均压力', data: sl('stress'), showSymbol: false,
          lineStyle: { width: 1.4, color: C.stress }, itemStyle: { color: C.stress },
          areaStyle: { color: 'rgba(247,107,21,.08)' } },
        { type: 'line', name: '30日均线', data: movingAvg(sl('stress'), 30), showSymbol: false,
          lineStyle: { width: 2.2, color: '#c24f00' }, itemStyle: { color: '#c24f00' } },
      ],
    }, vf(v => Math.round(v) + ''))));
    mount('psScale', chartBase(Object.assign({
      grid: { left: 50, right: 36, top: 30, bottom: zB(ds.length, 30) },
      dataZoom: zoom(ds.length),
      xAxis: Object.assign({}, AXIS_DATE, { data: ds }),
      yAxis: Object.assign({}, AXIS_VAL, { name: '分钟' }),
      series: [
        { type: 'bar', name: '放松', stack: 'p', data: sl('sRelax'), itemStyle: { color: '#b8e6cf' }, barWidth: '90%' },
        { type: 'bar', name: '轻度', stack: 'p', data: sl('sMild'), itemStyle: { color: '#f7c48f' } },
        { type: 'bar', name: '中度', stack: 'p', data: sl('sMod'), itemStyle: { color: '#f79c5e' } },
        { type: 'bar', name: '重度', stack: 'p', data: sl('sSev'), itemStyle: { color: '#e0470f' } },
      ],
    }, vf(v => fmtDur(v)))));
    if (vsData.length > 10) mount('psVs', chartBase({
      tooltip: { trigger: 'item', backgroundColor: 'rgba(255,255,255,.96)', borderColor: '#e7e9f0',
        textStyle: { color: '#333a48', fontSize: 12.5 },
        formatter: p => `${p.value[2]}<br/>日均压力 <b>${Math.round(p.value[0])}</b> · 睡眠评分 <b>${Math.round(p.value[1])}</b> 分` },
      grid: { left: 50, right: 24, top: 26, bottom: 40 },
      xAxis: { type: 'value', name: '日均压力', nameLocation: 'middle', nameGap: 26,
        nameTextStyle: { color: '#8a90a3', fontSize: 11 }, splitLine: { lineStyle: { color: '#f0f1f6' } },
        axisLabel: { color: '#8a90a3', fontSize: 11 } },
      yAxis: { type: 'value', name: '睡眠评分', min: 0, max: 100,
        nameTextStyle: { color: '#8a90a3', fontSize: 11 }, splitLine: { lineStyle: { color: '#f0f1f6' } },
        axisLabel: { color: '#8a90a3', fontSize: 11 } },
      series: [{ type: 'scatter', data: vsData, symbolSize: 7,
        itemStyle: { color: '#7a5af8', opacity: .5 } }],
    }), { silent: true });
  });
})();
