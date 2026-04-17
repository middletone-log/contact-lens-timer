// ============================================================
// コンタクトレンズ交換タイマー — Google Apps Script
// ============================================================
// 【デプロイ手順】
// 1. https://script.google.com で新規プロジェクト作成
// 2. このファイルの内容を全て貼り付け
// 3. NOTIFY_EMAIL を自分のGmailアドレスに変更
// 4. 「デプロイ」→「新しいデプロイ」→「Webアプリ」
//    - 実行ユーザー: 自分
//    - アクセス権限: 全員（匿名ユーザーも含む）
// 5. 発行されたURLをアプリの「GAS URL」欄に貼り付け
// 6. setupTrigger() を一度だけ手動実行してトリガーを登録
// ============================================================

const FILE_NAME    = 'contact_lens_timer.json';
const NOTIFY_EMAIL = 'ma34921@gmail.com'; // ← 通知先メールアドレス

// ------------------------------------------------------------
// エントリーポイント（POSTリクエスト）
// ------------------------------------------------------------
function doPost(e) {
  try {
    const params = JSON.parse(e.postData.contents);
    const action = params.action;

    let result;
    if      (action === 'save')   result = saveData(params);
    else if (action === 'load')   result = loadData();
    else if (action === 'notify') result = sendNotify(params);
    else throw new Error('Unknown action: ' + action);

    return jsonResponse({ ok: true, ...result });

  } catch (err) {
    return jsonResponse({ ok: false, error: err.message }, 500);
  }
}

// GETリクエスト（loadのショートカット）
function doGet(e) {
  try {
    const data = loadData();
    return jsonResponse({ ok: true, ...data });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message }, 500);
  }
}

// ------------------------------------------------------------
// 1. データ保存（Google Drive）
// ------------------------------------------------------------
function saveData(params) {
  const payload = {
    startDate:     params.startDate     || null,
    elapsedOffset: params.elapsedOffset || 0,
    notifyEnabled: params.notifyEnabled !== false,
    notifyTime:    params.notifyTime    || '04:00',
    savedAt:       new Date().toISOString(),
  };

  const file = getOrCreateFile();
  file.setContent(JSON.stringify(payload, null, 2));

  return { message: '保存しました', savedAt: payload.savedAt };
}

// ------------------------------------------------------------
// 2. データ読み込み（Google Drive）
// ------------------------------------------------------------
function loadData() {
  const file = getOrCreateFile();
  const raw  = file.getBlob().getDataAsString();

  if (!raw || raw.trim() === '') {
    return { data: null, message: 'データなし' };
  }

  return { data: JSON.parse(raw) };
}

// ------------------------------------------------------------
// 3. Gmail通知送信
// ------------------------------------------------------------
function sendNotify(params) {
  const exchangeDate = params.exchangeDate || '不明';
  const isTest       = params.isTest       || false;
  const subject      = isTest
    ? '【テスト】コンタクトレンズ交換リマインダー'
    : '【明日】コンタクトレンズの交換日です';

  const html = buildEmailHtml(exchangeDate, isTest);

  GmailApp.sendEmail(NOTIFY_EMAIL, subject, '', { htmlBody: html });

  return { message: '通知を送信しました', to: NOTIFY_EMAIL };
}

// ------------------------------------------------------------
// 4. 毎日自動チェック（トリガーから呼び出し）
// ------------------------------------------------------------
function dailyCheck() {
  let data;
  try {
    data = JSON.parse(getOrCreateFile().getBlob().getDataAsString());
  } catch (e) {
    return; // データなし → 何もしない
  }

  if (!data || !data.startDate || !data.notifyEnabled) return;

  const today        = toDateStr(new Date());
  const exchangeDate = addDays(data.startDate, 14 - (data.elapsedOffset || 0));
  const dayBefore    = addDays(exchangeDate, -1);

  if (today === dayBefore) {
    sendNotify({ exchangeDate, isTest: false });
    Logger.log('通知送信: ' + exchangeDate);
  }
}

// ------------------------------------------------------------
// 5. トリガー登録（一度だけ手動実行）
// ------------------------------------------------------------
function setupTrigger() {
  // 既存のトリガーを削除
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'dailyCheck')
    .forEach(t => ScriptApp.deleteTrigger(t));

  // 毎日 04:00〜05:00 に実行
  ScriptApp.newTrigger('dailyCheck')
    .timeBased()
    .everyDays(1)
    .atHour(4)
    .create();

  Logger.log('トリガーを登録しました（毎日04:00）');
}

// ============================================================
// ユーティリティ
// ============================================================

function getOrCreateFile() {
  const files = DriveApp.getFilesByName(FILE_NAME);
  if (files.hasNext()) return files.next();

  // ファイルが無ければ新規作成
  return DriveApp.createFile(FILE_NAME, '', MimeType.PLAIN_TEXT);
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

function jsonResponse(obj, code) {
  const output = ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
  return output;
}

function buildEmailHtml(exchangeDate, isTest) {
  const badge = isTest ? '<span style="background:#e0a000;color:#fff;padding:2px 10px;border-radius:20px;font-size:12px;">テスト送信</span><br><br>' : '';
  return `
<!DOCTYPE html>
<html lang="ja">
<body style="margin:0;padding:0;background:#EEF7FB;font-family:-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="480" cellpadding="0" cellspacing="0"
             style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,163,224,.15);">

        <!-- ヘッダー -->
        <tr>
          <td style="background:linear-gradient(135deg,#00A3E0,#0066CC);padding:24px 32px;">
            <p style="margin:0;color:rgba(255,255,255,.8);font-size:13px;">コンタクトレンズ交換タイマー</p>
            <h1 style="margin:6px 0 0;color:#fff;font-size:22px;">交換日のお知らせ</h1>
          </td>
        </tr>

        <!-- 本文 -->
        <tr>
          <td style="padding:32px;">
            ${badge}
            <p style="margin:0 0 24px;color:#1A2B3C;font-size:15px;line-height:1.7;">
              明日はコンタクトレンズの<strong>交換日</strong>です。<br>
              新しいレンズのご準備をお忘れなく。
            </p>

            <!-- 交換日バッジ -->
            <div style="background:#E0F4FC;border-left:4px solid #00A3E0;border-radius:0 12px 12px 0;padding:16px 20px;margin-bottom:24px;">
              <p style="margin:0;color:#6B8091;font-size:12px;font-weight:700;letter-spacing:.06em;">交換予定日</p>
              <p style="margin:6px 0 0;color:#0082B3;font-size:26px;font-weight:800;">${exchangeDate}</p>
            </div>

            <p style="margin:0;color:#6B8091;font-size:13px;line-height:1.6;">
              このメールはコンタクトレンズ交換タイマーから自動送信されました。<br>
              通知を停止するにはアプリの通知設定をオフにしてください。
            </p>
          </td>
        </tr>

        <!-- フッター -->
        <tr>
          <td style="background:#EEF7FB;padding:16px 32px;text-align:center;">
            <p style="margin:0;color:#6B8091;font-size:11px;">Contact Lens Timer</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
