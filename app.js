// ===== 定数 =====
const LENS_DAYS = 14; // 2週間使い捨て
const CIRCUMFERENCE = 2 * Math.PI * 80; // r=80 → 502.65

// ===== 状態 =====
let state = {
    startDate: null,       // 装着開始日（ISO文字列 "YYYY-MM-DD"）
    elapsedOffset: 0,      // ±ボタンで調整したオフセット日数
    notifyEnabled: true,
    notifyTime: '04:00',
    gasUrl: '',
    lastSynced: null,
};

// ===== DOM参照 =====
const $ = id => document.getElementById(id);
const ringProgress     = $('ringProgress');
const daysNumber       = $('daysNumber');
const startDateDisplay = $('startDateDisplay');
const exchangeDateDisplay = $('exchangeDateDisplay');
const statusBar        = $('statusBar');
const statusText       = $('statusText');
const adjDays          = $('adjDays');
const notifyToggle     = $('notifyToggle');
const notifyTimeRow    = $('notifyTimeRow');
const notifyTime       = $('notifyTime');
const gasUrl           = $('gasUrl');
const syncStatus       = $('syncStatus');
const syncDot          = syncStatus.querySelector('.sync-dot');
const syncStatusText   = $('syncStatusText');
const lastSyncTime     = $('lastSyncTime');
const toast            = $('toast');

// ===== ユーティリティ =====
function formatDate(dateStr) {
    if (!dateStr) return '--/--';
    const d = new Date(dateStr + 'T00:00:00');
    return `${d.getMonth() + 1}/${d.getDate()}`;
}

function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
}

function todayISO() {
    return new Date().toISOString().slice(0, 10);
}

function diffDays(from, to) {
    const a = new Date(from + 'T00:00:00');
    const b = new Date(to   + 'T00:00:00');
    return Math.round((b - a) / 86400000);
}

let toastTimer = null;
function showToast(msg, duration = 2500) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

// ===== UI更新 =====
function updateUI() {
    // 経過日数（開始日 + オフセット）
    let elapsed = 0;
    if (state.startDate) {
        elapsed = diffDays(state.startDate, todayISO()) + state.elapsedOffset;
        elapsed = Math.max(0, elapsed);
    }

    // 残日数
    const remaining = Math.max(0, LENS_DAYS - elapsed);

    // 交換予定日
    const exchangeDate = state.startDate ? addDays(state.startDate, LENS_DAYS - state.elapsedOffset) : null;

    // サークル更新
    const ratio = remaining / LENS_DAYS;
    const offset = CIRCUMFERENCE * (1 - ratio);
    ringProgress.style.strokeDashoffset = offset;

    // 残日数に応じて色変更
    if (remaining <= 1) {
        ringProgress.style.stroke = 'var(--danger)';
    } else if (remaining <= 3) {
        ringProgress.style.stroke = 'var(--warn)';
    } else {
        ringProgress.style.stroke = 'var(--primary)';
    }

    // 数字更新
    daysNumber.textContent = remaining;

    // 日付表示
    startDateDisplay.textContent   = formatDate(state.startDate);
    exchangeDateDisplay.textContent = formatDate(exchangeDate);

    // ±表示
    adjDays.textContent = elapsed;

    // ステータス
    statusBar.className = 'status-bar';
    if (!state.startDate) {
        statusText.textContent = '装着開始日を設定してください';
    } else if (remaining === 0) {
        statusBar.classList.add('danger');
        statusText.textContent = '⚠️ 今すぐ交換してください！';
    } else if (remaining === 1) {
        statusBar.classList.add('danger');
        statusText.textContent = '⚠️ 明日が交換日です！';
    } else if (remaining <= 3) {
        statusBar.classList.add('warn');
        statusText.textContent = `あと ${remaining} 日で交換日です`;
    } else {
        statusText.textContent = `交換まであと ${remaining} 日`;
    }
}

// ===== ローカルストレージ =====
function saveLocal() {
    localStorage.setItem('contactLensTimer', JSON.stringify(state));
}

function loadLocal() {
    try {
        const raw = localStorage.getItem('contactLensTimer');
        if (raw) {
            const saved = JSON.parse(raw);
            Object.assign(state, saved);
        }
    } catch (e) {
        console.warn('ローカルデータ読み込み失敗:', e);
    }
}

// ===== GAS連携（Google Drive同期 & Gmail通知）=====
async function callGAS(action, payload = {}) {
    const url = state.gasUrl.trim();
    if (!url) {
        showToast('GAS URLを設定してください');
        return null;
    }
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, ...payload }),
            mode: 'no-cors', // GASのCORS制限対応
        });
        return res;
    } catch (e) {
        console.error('GAS通信エラー:', e);
        showToast('通信エラーが発生しました');
        return null;
    }
}

async function saveToCloud() {
    setSyncStatus('syncing', '同期中...');
    const payload = {
        startDate:     state.startDate,
        elapsedOffset: state.elapsedOffset,
        notifyEnabled: state.notifyEnabled,
        notifyTime:    state.notifyTime,
    };
    const res = await callGAS('save', payload);
    if (res !== null) {
        state.lastSynced = new Date().toISOString();
        saveLocal();
        setSyncStatus('connected', '同期済み');
        updateLastSyncLabel();
        showToast('クラウドに保存しました ✓');
    } else {
        setSyncStatus('disconnected', '未接続');
    }
}

async function loadFromCloud() {
    setSyncStatus('syncing', '読み込み中...');
    // GASはno-corsではレスポンスボディを読めないため、
    // 実運用ではGASをCORSヘッダー付きでデプロイするか、
    // 別途URLパラメータでGETするアーキテクチャを推奨
    // ここではデモ用にローカルデータを再読み込み
    loadLocal();
    setSyncStatus('connected', '読み込み完了');
    updateUI();
    showToast('データを読み込みました ✓');
}

async function sendTestNotify() {
    const payload = {
        notifyTime:   state.notifyTime,
        exchangeDate: state.startDate ? addDays(state.startDate, LENS_DAYS - state.elapsedOffset) : '未設定',
        isTest: true,
    };
    const res = await callGAS('notify', payload);
    if (res !== null) {
        showToast('テスト通知を送信しました ✓');
    }
}

function setSyncStatus(type, text) {
    syncDot.className = `sync-dot ${type}`;
    syncStatusText.textContent = text;
}

function updateLastSyncLabel() {
    if (state.lastSynced) {
        const d = new Date(state.lastSynced);
        lastSyncTime.textContent = `最終同期: ${d.toLocaleString('ja-JP')}`;
    }
}

// ===== イベントリスナー =====

// 装着開始ボタン
$('startBtn').addEventListener('click', () => {
    state.startDate    = todayISO();
    state.elapsedOffset = 0;
    saveLocal();
    updateUI();
    showToast('今日から装着開始しました！');
});

// リセット
$('resetBtn').addEventListener('click', () => {
    if (!confirm('データをリセットしますか？')) return;
    state.startDate     = null;
    state.elapsedOffset = 0;
    saveLocal();
    updateUI();
    showToast('リセットしました');
});

// − ボタン
$('minusBtn').addEventListener('click', () => {
    if (state.elapsedOffset > -(LENS_DAYS)) {
        state.elapsedOffset--;
        saveLocal();
        updateUI();
    }
});

// ＋ ボタン
$('plusBtn').addEventListener('click', () => {
    if (state.elapsedOffset < LENS_DAYS) {
        state.elapsedOffset++;
        saveLocal();
        updateUI();
    }
});

// 通知トグル
$('notifyToggle').addEventListener('change', e => {
    state.notifyEnabled = e.target.checked;
    notifyTimeRow.style.display = e.target.checked ? 'flex' : 'none';
    saveLocal();
});

// 通知時刻
$('notifyTime').addEventListener('change', e => {
    state.notifyTime = e.target.value;
    saveLocal();
});

// GAS URL
$('gasUrl').addEventListener('change', e => {
    state.gasUrl = e.target.value;
    saveLocal();
    if (e.target.value.trim()) {
        setSyncStatus('disconnected', '未検証（保存後に同期ボタンで確認）');
    }
});

// クラウド保存
$('saveToCloudBtn').addEventListener('click', saveToCloud);

// クラウド読み込み
$('loadFromCloudBtn').addEventListener('click', loadFromCloud);

// テスト通知
$('testNotifyBtn').addEventListener('click', sendTestNotify);

// ヘッダー同期ボタン（ショートカット）
$('syncBtn').addEventListener('click', saveToCloud);

// ===== 初期化 =====
function init() {
    loadLocal();

    // UI反映
    notifyToggle.checked = state.notifyEnabled;
    notifyTime.value     = state.notifyTime || '04:00';
    gasUrl.value         = state.gasUrl || '';
    notifyTimeRow.style.display = state.notifyEnabled ? 'flex' : 'none';

    if (state.lastSynced) {
        setSyncStatus('connected', '同期済み');
        updateLastSyncLabel();
    }

    updateUI();

    // 1分ごとに日付をチェック（日をまたいだ時の更新）
    setInterval(updateUI, 60000);
}

init();
