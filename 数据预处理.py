# -*- coding: utf-8 -*-
"""
小米运动健康 CSV 导出 → 看板数据预处理管道
用法: python 数据预处理.py [导出目录]
     直接双击/不带参数运行会进入交互模式：自动探测或手动输入导出文件夹位置

产物 (写入脚本同目录的 data/):
  daily.js     每日汇总（全指标平行数组）
  sports.js    运动记录展平
  hourly.js    小时节律聚合（24h 分布 + 星期×小时矩阵）
  meta.js      用户档案 + 数据覆盖度 + 生涯统计
  minutes/YYYY-MM.js  分钟级明细按月分片（懒加载）
"""
import csv, json, os, sys, glob, time
from array import array
from datetime import datetime, timezone, timedelta

TZ = 8 * 3600  # Asia/Shanghai
EPOCH = datetime(1970, 1, 1)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

def day_str(ts):
    """unix 秒 -> CST 日期字符串"""
    return (EPOCH + timedelta(seconds=ts + TZ)).strftime('%Y-%m-%d')

def now_str():
    return datetime.now().strftime('%Y-%m-%d %H:%M')

# ---------------------------------------------------------------- 输入定位
def clean_path(s):
    """去掉路径两端引号/空白，展开 ~ 与环境变量"""
    s = s.strip().strip('"').strip("'").rstrip('\\/').strip()
    return os.path.expandvars(os.path.expanduser(s))

def find_input_dir():
    # 1) 命令行参数优先
    if len(sys.argv) > 1:
        p = clean_path(sys.argv[1])
        if os.path.isdir(p):
            return p
        print(f'目录不存在: {p}\n')

    # 2) 自动探测脚本所在目录
    cand = [d for d in sorted(
                glob.glob(os.path.join(SCRIPT_DIR, '*MiFitness*data*copy'))
                + glob.glob(os.path.join(SCRIPT_DIR, '*MiFitness*数据*')))
            if os.path.isdir(d)]

    if cand:
        print('在项目目录中找到导出数据：')
        for i, d in enumerate(cand, 1):
            print(f'  [{i}] {os.path.abspath(d)}')
        hint = '直接回车使用 [1]，或输入序号 / 其他文件夹绝对位置: '
    else:
        print('未在项目目录中自动找到导出数据。')
        hint = '请输入导出文件夹的绝对位置: '

    # 3) 交互输入，直到拿到合法目录
    while True:
        try:
            s = input(hint).strip()
        except (EOFError, KeyboardInterrupt):
            sys.exit('\n已取消。')
        if not s and cand:
            return cand[0]
        if not s:
            continue
        p = clean_path(s)
        if p.isdigit() and cand and 1 <= int(p) <= len(cand):
            return cand[int(p) - 1]
        if os.path.isdir(p):
            return p
        print(f'  目录不存在或无法访问: {p}，请重新输入（Ctrl+C 取消）')

IN = find_input_dir()
OUT = os.path.join(SCRIPT_DIR, 'data')
os.makedirs(os.path.join(OUT, 'minutes'), exist_ok=True)
print(f'\n输入目录: {os.path.abspath(IN)}')
print(f'输出目录: {OUT}')

def find_file(suffix):
    for f in glob.glob(os.path.join(IN, '*.csv')):
        if f.endswith(suffix):
            return f
    return None

# 核心文件校验
if not find_file('_hlth_center_aggregated_fitness_data.csv'):
    sys.exit('错误: 该目录下未找到 *_hlth_center_aggregated_fitness_data.csv，'
             '请确认这是小米运动健康导出的数据文件夹。')

def write_js(name, var, obj):
    p = os.path.join(OUT, name)
    with open(p, 'w', encoding='utf-8') as f:
        f.write(f'window.{var}=')
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
    print(f'  -> {name}  ({os.path.getsize(p)/1024:.0f} KB)')

samples = {}   # 未知 key 的样本打印
def peek(key, value):
    if key not in samples:
        samples[key] = value[:300]

# ---------------------------------------------------------------- 1. 用户档案
profile = {}
f = find_file('_user_member_profile.csv')
if f:
    with open(f, encoding='utf-8') as fp:
        for row in csv.DictReader(fp):
            profile = {
                'height': float(row['Height'] or 0),
                'birth': row['Birth'], 'sex': row['Sex'],
                'name': row['Name'],
            }
print('档案:', profile)

# 设备列表
devices = []
f = find_file('_hlth_center_data_source.csv')
if f:
    with open(f, encoding='utf-8') as fp:
        for row in csv.DictReader(fp):
            devices.append({'name': row['Name'], 'model': row['Model'], 'sid': row['Sid']})

# ---------------------------------------------------------------- 2. 每日汇总
# daily[key][day] = value
D = {k: {} for k in [
    'steps','dist','cal','goalSteps','goalCal','goalEx',
    'stand','intensity',
    'avgHr','maxHr','minHr','rhr',
    'zWarm','zFat','zAero','zAnaero','zExtreme',
    'slpTotal','slpDeep','slpLight','slpRem','slpAwake','slpScore',
    'bedMin','wakeMin','slpSegs','napMin','napWin',
    'spo2','spo2Min','spo2Lack',
    'stress','sRelax','sMild','sMod','sSev',
]}

f = find_file('_hlth_center_aggregated_fitness_data.csv')
print('\n[1/4] 解析每日汇总 ...')
n = 0
with open(f, encoding='utf-8') as fp:
    for row in csv.DictReader(fp):
        n += 1
        tag, key, ts = row['Tag'], row['Key'], int(row['Time'])
        day = day_str(ts)
        try:
            v = json.loads(row['Value'])
        except Exception:
            continue
        if tag == 'daily_report':
            if key == 'steps':
                D['steps'][day] = v.get('steps')
                D['dist'][day] = v.get('distance')
                D['goalSteps'][day] = v.get('goal')
            elif key == 'calories':
                D['cal'][day] = v.get('calories')
            elif key == 'heart_rate':
                D['avgHr'][day] = v.get('avg_hr')
                D['maxHr'][day] = v.get('max_hr')
                D['minHr'][day] = v.get('min_hr')
                D['rhr'][day] = v.get('avg_rhr')
                D['zWarm'][day] = v.get('warm_up_hr_zone_duration')
                D['zFat'][day] = v.get('fat_burning_hr_zone_duration')
                D['zAero'][day] = v.get('aerobic_hr_zone_duration')
                D['zAnaero'][day] = v.get('anaerobic_hr_zone_duration')
                D['zExtreme'][day] = v.get('extreme_hr_zone_duration')
            elif key == 'sleep':
                D['slpTotal'][day] = v.get('total_duration')
                D['slpDeep'][day] = v.get('sleep_deep_duration')
                D['slpLight'][day] = v.get('sleep_light_duration')
                D['slpRem'][day] = v.get('sleep_rem_duration')
                D['slpAwake'][day] = v.get('sleep_awake_duration')
                D['slpScore'][day] = v.get('sleep_score')
                segs = [s for s in (v.get('segment_details') or []) if s.get('bedtime')]
                if segs:
                    # 该日 CST 00:00 的 unix 时间戳；各段存为 [入睡偏移, 时长, 起床偏移]（入睡常为负值）
                    # 主睡眠/零星小睡在明细解析完成后统一判定（见 watch_daytime_sleep 合并处）
                    base = (ts + TZ) // 86400 * 86400 - TZ
                    D['slpSegs'][day] = sorted([round((s['bedtime'] - base) / 60),
                                                s.get('duration', 0),
                                                round((s.get('wake_up_time', 0) - base) / 60)] for s in segs)
            elif key == 'spo2':
                D['spo2'][day] = v.get('avg_spo2')
                D['spo2Min'][day] = v.get('min_spo2')
                D['spo2Lack'][day] = v.get('lack_spo2_count')
            elif key == 'stress':
                D['stress'][day] = v.get('avg_stress')
                sc = v.get('stress_scale') or {}
                D['sRelax'][day] = sc.get('relax')
                D['sMild'][day] = sc.get('mild')
                D['sMod'][day] = sc.get('moderate')
                D['sSev'][day] = sc.get('severe')
            elif key == 'valid_stand':
                D['stand'][day] = v.get('count')
            elif key == 'intensity':
                D['intensity'][day] = v.get('duration')
        elif tag == 'daily_fitness' and key == 'goal':
            for it in v.get('goal_items', []):
                fld, ach, tgt = it.get('field'), it.get('achieved_value'), it.get('target_value')
                if fld == 1: D['goalSteps'][day] = tgt
                elif fld == 2: D['goalCal'][day] = tgt
                elif fld == 4: D['goalEx'][day] = tgt
print(f'  {n} 行')

# ---------------------------------------------------------------- 3. 生涯统计 (奖牌)
medals = {}
f = find_file('_user_fitness_data_records.csv')
if f:
    print('\n[2/4] 解析生涯统计 ...')
    with open(f, encoding='utf-8') as fp:
        for row in csv.DictReader(fp):
            if row['tag'] != 'medal_statistics':
                continue
            key = row['key']
            try:
                v = json.loads(row['value'])
            except Exception:
                continue
            if key == 'medal_stats_total_steps':
                medals['totalSteps'] = v.get('total_steps')
                medals['stepGoalDays'] = v.get('total_goal_achieve')
                medals['scanTime'] = v.get('real_time_scan_time')
            elif key == 'medal_stats_total_calorie':
                medals['totalCalorie'] = v.get('total_calorie')
                medals['calGoalDays'] = v.get('total_goal_achieve')
            elif key == 'sport_stats_total_data':
                ta = v.get('total_achievement') or {}
                medals['sport'] = {
                    'distance': ta.get('distances', {}).get('int_value'),
                    'calories': ta.get('calories', {}).get('int_value'),
                    'avgPace': ta.get('avg_pace', {}).get('int_value'),
                    'duration': v.get('total_duration'),
                }

# ---------------------------------------------------------------- 4. 运动记录
SPORT_CN = {
    'outdoor_running': '户外跑', 'indoor_running': '室内跑', 'free_training': '自由训练',
    'outdoor_riding': '户外骑行', 'outdoor_walking': '户外步行', 'outdoor_hiking': '户外徒步',
    'indoor_cycling': '室内骑行', 'pool_swimming': '游泳', 'treadmill': '跑步机',
    'elliptical': '椭圆机', 'rowing_machine': '划船机',
}
sports = []
f = find_file('_hlth_center_sport_record.csv')
if f:
    print('\n[3/4] 解析运动记录 ...')
    with open(f, encoding='utf-8') as fp:
        for row in csv.DictReader(fp):
            try:
                v = json.loads(row['Value'])
            except Exception:
                continue
            st, et = v.get('start_time'), v.get('end_time')
            dur, dist = v.get('duration') or 0, v.get('distance') or 0
            sports.append({
                'd': day_str(st) if st else day_str(int(row['Time'])),
                't': row['Key'],
                'st': st, 'et': et,                # 起止 unix 秒
                'dur': dur,                      # 秒
                'dist': dist,                    # 米
                'cal': v.get('calories'),
                'aHr': v.get('avg_hrm'), 'mHr': v.get('max_hrm'), 'nHr': v.get('min_hrm'),
                'pace': round(dur / (dist / 1000), 1) if dist > 100 else None,  # 秒/公里
                # 小米的 min/max_pace 是速度域命名：min_pace=最慢、max_pace=最快
                'paceBest': v.get('max_pace'), 'paceWorst': v.get('min_pace'),
                'spd': v.get('avg_speed'), 'spdMax': v.get('max_speed'),        # km/h
                'climb': v.get('total_climbing'),
                'rise': v.get('rise_height'), 'fall': v.get('fall_height'),     # 米
                'steps': v.get('steps'), 'totalCal': v.get('total_cal'),
                'cad': v.get('avg_cadence'), 'cadMax': v.get('max_cadence'),    # 步频
                'stride': v.get('avg_stride'),                                  # 步幅 cm
                'tdc': v.get('avg_touchdown_duration'),                         # 触地 ms
                'vo': v.get('avg_vertical_amplitude'),                          # 垂直振幅 cm
                'vsr': v.get('avg_vertical_stride_ratio'),                      # 垂直步幅比 %
                'te': v.get('train_effect'), 'teAna': v.get('anaerobic_train_effect'),
                'load': v.get('train_load'), 'rec': v.get('recover_time'),      # 负荷 / 恢复小时
                'vo2': v.get('vo2_max'), 'rai': v.get('running_ability_index'),
                'zw': v.get('hrm_warm_up_duration'), 'zf': v.get('hrm_fat_burning_duration'),
                'za': v.get('hrm_aerobic_duration'), 'zn': v.get('hrm_anaerobic_duration'),
                'ze': v.get('hrm_extreme_duration'),
                'pred': [v.get('five_kilometre_grade_prediction_duration') or None,
                         v.get('ten_kilometre_grade_prediction_duration') or None,
                         v.get('half_marathon_grade_prediction_duration') or None,
                         v.get('full_marathon_grade_prediction_duration') or None],  # 5k/10k/半马/全马
            })
    sports.sort(key=lambda x: x['d'])
    for i, s in enumerate(sports):
        s['i'] = i

    # ---------------- GPS 轨迹（需联网下载 GPX，失败跳过；本地按 URL 哈希缓存） ----------------
    def parse_gpx(xml_text):
        """GPX -> [[lon, lat, ele, hr], ...]（ele/hr 缺失为 None）"""
        import xml.etree.ElementTree as ET
        try:
            root = ET.fromstring(xml_text)
        except Exception:
            return None
        pts = []
        for el in root.iter():
            if not el.tag.endswith('trkpt'):
                continue
            lat, lon = el.get('lat'), el.get('lon')
            if not lat or not lon:
                continue
            ele = hr = None
            for c in el.iter():
                txt = (c.text or '').strip()
                if txt and c.tag.endswith('ele'):
                    ele = round(float(txt))
                elif txt and c.tag.endswith('hr'):
                    hr = int(float(txt))
            pts.append([round(float(lon), 5), round(float(lat), 5), ele, hr])
        return pts or None

    track_f = find_file('_hlth_center_sport_track_data.csv')
    if track_f:
        print('\n[3.5/4] 下载并解析 GPS 轨迹（需联网，离线/失败自动跳过）...')
        import hashlib, urllib.request, gzip as _gzip
        urls = []
        with open(track_f, encoding='utf-8') as fp:
            for row in csv.DictReader(fp):
                u = (row.get('GPX') or '').strip()
                if u:
                    urls.append((row['Key'], int(row['Time']), u))
        ok = miss = fail = 0
        for s in sports:
            # 按开始时间就近匹配（±10 分钟）。轨迹行的 Key 与运动记录可能不一致
            # （如 outdoor_run_class vs outdoor_running），故不校验类型
            if not s.get('st'):
                miss += 1
                continue
            cand = [(abs(t - s['st']), u) for k, t, u in urls if abs(t - s['st']) < 600]
            if not cand:
                miss += 1
                continue
            hit = min(cand)[1]
            cache = os.path.join(OUT, 'gpx', hashlib.md5(hit.encode()).hexdigest()[:16] + '.gpx')
            try:
                if os.path.exists(cache):
                    raw = open(cache, 'rb').read()
                else:
                    os.makedirs(os.path.dirname(cache), exist_ok=True)
                    req = urllib.request.Request(hit, headers={'User-Agent': 'Mozilla/5.0'})
                    with urllib.request.urlopen(req, timeout=25) as resp:
                        raw = resp.read()
                    open(cache, 'wb').write(raw)
                if raw[:2] == b'\x1f\x8b':
                    raw = _gzip.decompress(raw)
                pts = parse_gpx(raw.decode('utf-8', 'ignore'))
                if pts and len(pts) > 1:
                    if len(pts) > 600:                      # 降采样，保留首尾
                        full = pts
                        step = -(-len(full) // 600)
                        pts = full[::step]
                        if pts[-1] != full[-1]:
                            pts.append(full[-1])
                    s['track'] = pts
                    ok += 1
                else:
                    fail += 1
            except Exception:
                fail += 1
                continue
        print(f'  轨迹: 成功 {ok}，无轨迹文件 {miss}，解析/下载失败 {fail}')

# ---------------------------------------------------------------- 5. 大明细文件（流式）
print('\n[4/4] 流式解析分钟级明细 (约 1GB, 需几分钟) ...')
import pandas as pd

# 分钟级月分片: months['2026-08'][day_num][metric] = array('h', 1440)
months = {}
# 小时节律聚合
hSteps = [0]*24; hCal = [0]*24; hHr = [0]*24; hHrN = [0]*24
wh = [[0]*24 for _ in range(7)]      # 星期×小时 步数和
whDays = [0]*7                        # 每星期有步数数据的天数
seen_step_days = set(); seen_hr_days = set()
# 大文件中的每日指标
big_daily = {'rhr':{}, 'weight':{}, 'pai':{}, 'vo2':{}, 'vitL':{}, 'vitM':{}, 'vitH':{}}

BIG = find_file('_hlth_center_fitness_data.csv')
t0 = time.time()
MIN_KEYS = {'steps','calories','heart_rate','stress','spo2'}

def month_day(ts):
    d = day_str(ts)
    return d[:7], int(d[8:10])

def ensure(md, dn):
    m = months.setdefault(md, {})
    day = m.setdefault(dn, {})
    for met in ('s','d','c','h','t','o'):
        if met not in day:
            day[met] = array('h', bytes(2880))   # 1440 个 int16 零值
    return day

if BIG:
    CH = 2_000_000
    total_rows = 0
    for ci, chunk in enumerate(pd.read_csv(
            BIG, chunksize=CH, usecols=['Key','Time','Value'],
            dtype={'Key':str,'Time':'int64','Value':str}, engine='c')):
        total_rows += len(chunk)
        for key, sub in chunk.groupby('Key', sort=False):
            if key in MIN_KEYS:
                for ts, val in zip(sub['Time'], sub['Value']):
                    try:
                        v = json.loads(val)
                    except Exception:
                        continue
                    md, dn = month_day(ts)
                    mi = ((ts + TZ) % 86400) // 60
                    day = ensure(md, dn)
                    if key == 'steps':
                        day['s'][mi] = v.get('steps') or 0
                        day['d'][mi] = v.get('distance') or 0
                        day['c'][mi] = round((v.get('calories') or 0) * 100)
                    elif key == 'calories':
                        day['c'][mi] = round((v.get('calories') or 0) * 100)
                    elif key == 'heart_rate':
                        bpm = v.get('bpm')
                        if bpm:
                            day['h'][mi] = bpm
                    elif key == 'stress':
                        day['t'][mi] = v.get('stress') or 0
                    elif key == 'spo2':
                        day['o'][mi] = v.get('spo2') or 0
            elif key == 'resting_heart_rate':
                for ts, val in zip(sub['Time'], sub['Value']):
                    try:
                        v = json.loads(val)
                    except Exception:
                        continue
                    d = day_str(v.get('date_time') or ts)
                    big_daily['rhr'][d] = v.get('bpm')
            elif key == 'weight':
                for ts, val in zip(sub['Time'], sub['Value']):
                    peek('weight', val)
                    try:
                        v = json.loads(val)
                    except Exception:
                        continue
                    w = v.get('weight') or v.get('weight_kg') or v.get('value')
                    if w:
                        big_daily['weight'][day_str(v.get('date_time') or v.get('time') or ts)] = w
            elif key == 'pai':
                for ts, val in zip(sub['Time'], sub['Value']):
                    peek('pai', val)
                    try:
                        v = json.loads(val)
                    except Exception:
                        continue
                    p = v.get('pai') or v.get('total_pai') or v.get('today_pai')
                    if p is not None:
                        big_daily['pai'][day_str(v.get('date_time') or v.get('time') or ts)] = p
            elif key == 'vo2_max':
                for ts, val in zip(sub['Time'], sub['Value']):
                    try:
                        v = json.loads(val)
                    except Exception:
                        continue
                    big_daily['vo2'][day_str(v.get('time') or ts)] = v.get('vo2_max')
            elif key == 'vitality':
                for ts, val in zip(sub['Time'], sub['Value']):
                    try:
                        v = json.loads(val)
                    except Exception:
                        continue
                    d = day_str(v.get('date_time') or ts)
                    big_daily['vitL'][d] = v.get('daily_low_intensity_vitality')
                    big_daily['vitM'][d] = v.get('daily_medium_intensity_vitality')
                    big_daily['vitH'][d] = v.get('daily_high_intensity_vitality')
            elif key == 'watch_daytime_sleep':
                # 白天睡眠记录：并入该日睡眠段列表，主睡眠/零星小睡随后统一判定
                for ts, val in zip(sub['Time'], sub['Value']):
                    try:
                        v = json.loads(val)
                    except Exception:
                        continue
                    dur = v.get('duration')
                    items = v.get('items') or []
                    if not dur or not items:
                        continue
                    t0 = v.get('date_time') or ts
                    base = (t0 + TZ) // 86400 * 86400 - TZ
                    b = round((items[0]['start_time'] - base) / 60)
                    w = round((items[-1]['end_time'] - base) / 60)
                    if w <= b:
                        continue
                    eps = D['slpSegs'].setdefault(day_str(t0), [])
                    # 与聚合分段大面积重叠视为同一段睡眠，跳过防重复计入
                    if any(min(w, e[2]) - max(b, e[0]) > 0.5 * min(dur, e[1]) for e in eps):
                        continue
                    eps.append([b, dur, w])
            else:
                peek(key, str(sub['Value'].iloc[0]))
        print(f'  chunk {ci}: 累计 {total_rows} 行, {time.time()-t0:.0f}s', flush=True)

    print(f'  明细解析完成: {total_rows} 行, 耗时 {time.time()-t0:.0f}s')
    if samples:
        print('  —— 未处理 key 样本（供参考）——')
        for k, v in samples.items():
            print(f'  {k}: {v}')
else:
    print('  未找到分钟级明细文件，跳过。')

# 主睡眠/零星小睡统一判定：先把间隔≤2小时的段合并为同一次睡眠
# （夜间短暂清醒被手环拆段不算分界），最长会话为主睡眠（含被归为"白天睡眠"
# 的长睡眠，如周末睡到下午）；其余会话中单段≤3小时的为零星小睡
NAP_CAP = 180
GAP_MERGE = 120
for day, eps in D['slpSegs'].items():
    if not eps:
        continue
    sessions = []   # [入睡偏移, 起床偏移, 睡眠总分钟, 段列表]
    for e in sorted(eps):
        b, dur, w = e
        if sessions and b - sessions[-1][1] <= GAP_MERGE:
            s = sessions[-1]
            s[1] = max(s[1], w)
            s[2] += dur
            s[3].append(e)
        else:
            sessions.append([b, w, dur, [e]])
    main = max(sessions, key=lambda s: s[2])
    D['bedMin'][day] = main[0]
    D['wakeMin'][day] = main[1]
    extra = 0
    wins = []
    for s in sessions:
        if s is main:
            continue
        for e in s[3]:
            if e[1] <= NAP_CAP:
                extra += e[1]
                wins.append([e[0], e[2]])
    if extra > 0:
        D['napMin'][day] = extra
        D['napWin'][day] = wins

# 小时节律：从月分片累计
for md, days in months.items():
    for dn, mets in days.items():
        s_arr = mets['s']; h_arr = mets['h']; c_arr = mets['c']
        has_s = any(s_arr); has_h = any(h_arr)
        date_key = f'{md}-{dn:02d}'
        if has_s:
            seen_step_days.add(date_key)
            wk = (datetime.strptime(date_key, '%Y-%m-%d').weekday())
            whDays[wk] += 1
            for mi in range(1440):
                st = s_arr[mi]
                if st:
                    hSteps[mi//60] += st
                    wh[wk][mi//60] += st
                    hCal[mi//60] += c_arr[mi]
        if has_h:
            seen_hr_days.add(date_key)
            for mi in range(1440):
                if h_arr[mi]:
                    hHr[mi//60] += h_arr[mi]
                    hHrN[mi//60] += 1

nStepDays = max(len(seen_step_days), 1)
nHrDays = max(len(seen_hr_days), 1)
hourly = {
    'hSteps': [round(x / nStepDays, 1) for x in hSteps],
    'hCal': [round(x / nStepDays, 2) for x in hCal],
    'hHr': [round(hHr[i] / hHrN[i], 1) if hHrN[i] else 0 for i in range(24)],
    'wh': [[round(wh[w][h] / max(whDays[w],1), 1) for h in range(24)] for w in range(7)],
    'stepDays': len(seen_step_days), 'hrDays': len(seen_hr_days),
}

# ---------------------------------------------------------------- 6. 合成 daily 平行数组
# 仅 goal 而无实际数据的日子（如 2001 年的脏记录）不纳入日期范围
GOAL_ONLY = {'goalSteps', 'goalCal', 'goalEx'}
all_days = set()
for k, m in D.items():
    if k not in GOAL_ONLY:
        all_days.update(d for d, v in m.items() if v is not None)
for m in big_daily.values():
    all_days.update(d for d, v in m.items() if v is not None)
if not all_days:
    sys.exit('未解析到任何每日数据')
dates = sorted(all_days)
first, last = dates[0], dates[-1]

# 补齐连续日期序列
cur = datetime.strptime(first, '%Y-%m-%d')
end = datetime.strptime(last, '%Y-%m-%d')
full_dates = []
while cur <= end:
    full_dates.append(cur.strftime('%Y-%m-%d'))
    cur += timedelta(days=1)
idx = {d: i for i, d in enumerate(full_dates)}

def arr(src, cast=None):
    out = [None] * len(full_dates)
    for d, v in src.items():
        if v is None or d not in idx: continue
        out[idx[d]] = cast(v) if cast else v
    return out

# rhr: daily_report 优先，缺则用大文件 resting_heart_rate
rhr_merge = dict(big_daily['rhr'])
for d, v in D['rhr'].items():
    if v is not None:
        rhr_merge[d] = v

daily = {
    'dates': full_dates,
    'steps': arr(D['steps']), 'dist': arr(D['dist']), 'cal': arr(D['cal']),
    'goalSteps': arr(D['goalSteps']), 'goalCal': arr(D['goalCal']), 'goalEx': arr(D['goalEx']),
    'stand': arr(D['stand']), 'intensity': arr(D['intensity']),
    'avgHr': arr(D['avgHr']), 'maxHr': arr(D['maxHr']), 'minHr': arr(D['minHr']),
    'rhr': arr(rhr_merge),
    'zWarm': arr(D['zWarm']), 'zFat': arr(D['zFat']), 'zAero': arr(D['zAero']),
    'zAnaero': arr(D['zAnaero']), 'zExtreme': arr(D['zExtreme']),
    'slpTotal': arr(D['slpTotal']), 'slpDeep': arr(D['slpDeep']),
    'slpLight': arr(D['slpLight']), 'slpRem': arr(D['slpRem']),
    'slpAwake': arr(D['slpAwake']), 'slpScore': arr(D['slpScore']),
    'bedMin': arr(D['bedMin']), 'wakeMin': arr(D['wakeMin']),
    'napMin': arr(D['napMin']),
    'napWin': arr(D['napWin']),
    'spo2': arr(D['spo2']), 'spo2Min': arr(D['spo2Min']), 'spo2Lack': arr(D['spo2Lack']),
    'stress': arr(D['stress']), 'sRelax': arr(D['sRelax']), 'sMild': arr(D['sMild']),
    'sMod': arr(D['sMod']), 'sSev': arr(D['sSev']),
    'weight': arr(big_daily['weight']), 'pai': arr(big_daily['pai']),
    'vo2': arr(big_daily['vo2']),
    'vitL': arr(big_daily['vitL']), 'vitM': arr(big_daily['vitM']),
    'vitH': arr(big_daily['vitH']),
    'segs': arr(D['slpSegs']),
}

# ---------------------------------------------------------------- 7. 写出产物
print('\n生成产物 ...')
write_js('daily.js', '__DAILY__', daily)

sports_out = {
    'list': sports,
    'typeCn': {k: v for k, v in SPORT_CN.items() if any(s['t'] == k for s in sports)},
}
write_js('sports.js', '__SPORTS__', sports_out)
write_js('hourly.js', '__HOURLY__', hourly)

# 覆盖度统计
cov = {}
for k in ('steps','cal','rhr','slpTotal','stress','spo2','weight','pai','vo2'):
    cov[k] = sum(1 for v in daily[k] if v is not None)
meta = {
    'profile': profile, 'devices': devices, 'coverage': cov,
    'first': first, 'last': last, 'days': len(full_dates),
    'medals': medals, 'generated': now_str(),
    'sportCount': len(sports),
}
write_js('meta.js', '__META__', meta)

# 分钟月分片（过滤 2015 年前的脏数据）
mn = 0
for md in sorted(months):
    if md < '2015-01':
        continue
    obj = {}
    for dn, mets in months[md].items():
        # 键补零两位，与日期字符串 '2026-09-05' 的 slice(8,10) 对齐
        obj[f'{dn:02d}'] = {met: list(a) for met, a in mets.items() if any(a)}
    p = os.path.join(OUT, 'minutes', f'{md}.js')
    with open(p, 'w', encoding='utf-8') as f:
        f.write(f'window.__MIN__=window.__MIN__||{{}};window.__MIN__["{md}"]="')
        # 存为字符串，加载端 JSON.parse
        f.write(json.dumps(obj, separators=(',', ':')).replace('\\', '\\\\').replace('"', '\\"'))
        f.write('"')
    mn += 1
print(f'  -> minutes/*.js  共 {mn} 个月份分片')

total_min_kb = sum(os.path.getsize(os.path.join(OUT,'minutes',x)) for x in os.listdir(os.path.join(OUT,'minutes')))/1024
print(f'  分钟分片总计 {total_min_kb/1024:.1f} MB')

print('\n全部完成！双击 index.html 即可打开看板。')
# 双击运行时窗口不会一闪而过
if sys.stdin.isatty():
    try:
        input('按回车键退出...')
    except (EOFError, KeyboardInterrupt):
        pass
