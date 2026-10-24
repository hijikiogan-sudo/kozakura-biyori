# App Store版へ向けた構成

## 現状（v1.12.0）

Capacitor 8（Swift Package Manager）のiOSプロジェクトを `ios/` に追加した。Web版は今までどおりリポジトリ直下をGitHub Pagesで配信し、iOS版は `npm run ios:sync` で `www/` にコピーした同じファイルを同梱する（`www/` と `ios/App/App/public/` は生成物なのでコミットしない）。

- `native.js`：iOSアプリの中だけで動く。`window.KozabotaNativeNotifications`（タイマー・お世話の端末内通知）と `window.KozabotaNativeFiles`（共有シートへのファイル書き出し）を用意する。ブラウザでは何もしない。
- 放鳥タイマー：ID 104001。カウントダウン開始時に終了時刻を予約し、終了・取消・復元で差し替える。予約済みなら前面でもWebAudioの終了音は鳴らさず、OSの通知音に任せる。
- お世話の予定：`KozakuraModel.careNotificationPlan` が14日先まで・最大60件（iOSの保留上限64件から余裕を残す）をID 200000〜209999で作る。保存のたび・アプリに戻るたびに作り直し、記録済みの回は外す。許可ダイアログは予定を保存したとき・「通知の許可を確認」を押したときだけ出す。
- バックアップ・CSVは共有シートへ。受診用レポートの印刷はWKWebViewで動かないため、iOS版ではボタンを隠している（今後の課題）。
- `Info.plist`：カメラ・マイク・写真の利用目的、暗号化なし（`ITSAppUsesNonExemptEncryption`）。Bundle IDは `io.github.hijikiogansudo.kozakurabiyori`（App Store Connectに登録する前なら変更できる）。

テスト：`tests/test_ios_bridge.py` はCapacitorの偽物を読み込ませて、画面操作から予約・取消・共有までを確認する。`tests/test_care_notifications.cjs` は予約計画と受け渡しの単体テスト。どちらもiOSが実際に通知を届けることまでは確かめないので、シミュレーターと実機で確認する。

## Xcodeでの確認手順

1. `npm install` → `npm run ios:sync` → `npm run ios:open`
2. Xcodeで「Signing & Capabilities」のTeamに自分のApple IDを選ぶ（無料のApple IDで可）。
3. シミュレーターで起動し、通知の許可・タイマー終了・お世話の予定・アプリを閉じた状態での通知・共有シートを確認する。
4. App Store提出前：1024pxのアプリアイコンを用意、`PrivacyInfo.xcprivacy` をアプリターゲットに追加、受診用レポートのPDF出力をネイティブで用意する。

## 以前の設計メモ

`platform.js` は端末機能を接続する境界で、ブラウザでは権限要求・通知予約・通信を行いません。

## 実装済みの接続点

- `model.js`: 記録とタイマーのデータ。DB・バックアップ形式は変更しない。
- `app.js`: 操作・保存。保存成功後と再読込時にタイマーの通知予約を同期する。保存失敗時は通知を変更しない。
- `platform.js`: 許可の確認、終了予定の生成、予約の差し替え、取り消しを直列化する。カウントアップ・終了済み・取り消したタイマーには予約しない。
- `sw.js`: PWAのオフライン資材。ネイティブの通知をService Workerで代用しない。

今のWebAudioによる表示中の終了音と、標準カレンダー向けICSは継続する。Web Pushや外部配信サーバーは追加しない。

## 将来のiOSブリッジ契約

iOS用の起動処理から、`app.js` が実行される前に `window.KozabotaNativeNotifications` を設定する。Capacitor等でSwiftの `UNUserNotificationCenter` に接続する実装が候補。全メソッドはPromiseを返し、失敗時はrejectする。Web版にはスタブを注入しない。

| メソッド | 引数・返り値 | iOS側の責務 |
| --- | --- | --- |
| `getPermission()` | `granted` / `denied` / `prompt` | 現在の許可を確認する。許可ダイアログを出さない |
| `requestPermission()` | `granted` / `denied` | 開始ボタン・通知確認ボタンから呼ばれたときだけOS許可を求める |
| `replaceTimerNotification(request)` | 下記オブジェクト。返り値は不要 | 同一IDの保留中の予約を置き換える。処理完了後にresolve。絶対時刻が過ぎていれば予約しない |
| `cancelTimerNotification({id})` | 数値ID。返り値は不要 | このアプリの当該IDの保留中の予約だけを解除。未予約でも成功する |

```js
{
  id: 104001, // 放鳥タイマー専用。お世話等の予約と共有しない
  deadline: 1792500000000, // startedAt + durationSeconds * 1000（UTCのミリ秒）
  title: 'コザボタ日和',
  body: '放鳥の設定時間になりました。愛鳥を確認してください。',
  sound: 'default'
}
```

通知処理にはプロフィール、写真、記録、バックアップ全体を渡さない。予約は端末内のOS機能で行う。接続側の権限要求が失敗した場合、サービスの返り値は `error` になる。通知失敗・拒否でもタイマーの保存と放鳥記録を続行し、失敗を画面に表示する。起動時にはOSの保留中の予約も調べ、アプリの現在のタイマーと照合して置き換える実装にする。

前面でOS通知音も鳴らすとWebAudioの終了音と重なる。iOS側で前面の通知音を抑えるなど、音の担当を統一してから公開する。通知は消音・集中モード・OS許可に従うため、時計アプリと同じ保証を表示しない。

## データを引き継ぐ

公開URL `https://hijikiogan-sudo.github.io/kozakura-biyori/`、IndexedDB名 `kozakura-biyori-local-v1`（v1.11.0からDBバージョン2、写真・動画は `media` ストア）、バックアップ識別子 `kozakura-biyori` を維持する。ただしSafari/PWAとネイティブのWKWebViewは保存領域を自動共有しない。App Store版への移行には既存のv2バックアップ書き出し・復元を用意し、写真・記録・設定・進行中タイマーの移行を実機確認する。PWAの削除を移行手順にしない。

## iOS実装時に残る作業

1. iOSプロジェクトと通知ブリッジを実装し、アプリにWeb資材を同梱する。OSローカル通知と端末内保存を使う。
2. 通知の許可・拒否・設定変更、終了時刻を予約、早期終了・取消・再開始・復元時の差し替えを実機確認する。
3. 画面ロック、バックグラウンド、アプリ終了、再起動、消音・集中モード、時刻変更、前面での音の重複を確認する。
4. バックアップ移行・オフライン・写真選択・端末容量不足を実機確認し、プライバシー申告とストア審査を準備する。

ブリッジを模した自動テストは接続契約を確認するためのもの。OSの通知配信・音を検証したことにはならない。

## お世話スケジュールの接続（v1.5.0）

`settings.reminders` の `startDate`・`interval`・`time`・`extraTimes` が予定の正本。`model.js` の `nextCareDate`・`reminderTimes` から通知候補を生成できる。現時点で `platform.js` のiOSブリッジは放鳥タイマー専用で、お世話のOS通知予約は行わない。iOS実装時にはタイマーID104001とは別の専用ID範囲で、複数時刻・日数間隔・予定変更/無効化/復元・OSの予約件数上限を扱う。開始日からの位相を維持し、起動時に予約を照合する。単純な毎日の繰り返しだけで「3日おき」を代用しない。

## 受診用レポートの印刷（v1.11.0）

PWAでは `window.print()` で印刷・PDF保存を行う。WKWebViewでは `window.print()` が動作しないため、iOS版では `UIPrintInteractionController`（またはWKWebViewの印刷フォーマッタ）につなぐブリッジが必要。CSVはファイル書き出しと同じく共有シートに渡す。
