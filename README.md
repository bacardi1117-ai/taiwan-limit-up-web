# 漲停觀測站：網站與公開查詢

此目錄是無建置步驟的繁體中文靜態網站。`config.js` 的 Web App `/exec` 網址是公開查詢端點，絕不可放 `LIMIT_UP_API_SECRET`、Spreadsheet ID 或 OAuth 檔案。網站使用 Google 官方文件描述的唯讀 JSONP，因為 Apps Script ContentService 的跨來源 JSON 回應不保證可由 GitHub Pages `fetch()` 使用。JSONP 只包含白名單化的漲停行情欄位；所有文字以 `textContent` 放入頁面。

## 資料正確性

- Apps Script `doGet` 預設拒絕公開查詢。只有指令碼屬性 `PUBLIC_READ_ENABLED=true` 時才開放；`doPost` 的寫入與檢查仍需原有 secret。
- `days` 查詢最多 270 個日曆日，使用 TWSE 官方 `FMTQIK` 逐月交易日期資料；歷史月份在 Apps Script 快取六小時、當月快取五分鐘。查詢只讀取每日狀態索引，不掃描整張歷史明細。
- `rows` 查詢依每日索引讀取對應行段，每頁最多 500 筆。只回傳 `date, market, stock_id, stock_name, close, limit_up_price`，不回傳工作表 ID、密鑰或其他工作表內容。
- 每次完整上傳且讀回驗證通過，才把日期記為 `complete`，附兩市場筆數及行段索引。失敗的排程可記為 `failed`，但不覆蓋既有 `complete`。未出現於官方交易日清單的日期視為休市；官方交易日沒有完成紀錄為 `missing`。舊歷史資料若只有漲停列而無完成證明，標為 `unverified`，不推定完整。
- 若兩個官方市場都已通過完整性檢查而真的沒有任何普通股漲停，Python 以獨立的受密鑰保護動作標記零筆完成日；一般空批次上傳仍被拒絕。
- 只有觀察區間所有 N 個官方交易日都已驗證完成，才計算最長與目前連板。完整市場日沒有某股票漲停列，按「該交易日未漲停」處理；停牌、無成交、未上市及特殊交易制度無法由漲停清單再細分，皆按此規則中斷逐市場交易日連板。缺漏與失敗日則讓連板顯示 `—`，不當作中斷。
- 「目前連板」是截至所選期間最後一個官方交易日，在所選 N 日窗口內的連續次數；若已達 N 日，可能仍有更早的連續紀錄，網站不宣稱窗口外的天數。

## 部署狀態與網站發布

2026-10-24 已用 `clasp` 將 `Code.gs` 與 `PublicApi.gs` 同步至既有 Apps Script 專案，並將**原有** Web App 部署更新至第 6 版，Deployment ID 與 `/exec` URL 未變。試算表擁有者已授權 `UrlFetchApp` 讀取 TWSE 官方交易日 API；指令碼屬性 `PUBLIC_READ_ENABLED=true`。`site/config.js` 已填入公開唯讀網址，沒有寫入密鑰。

匿名實測 `days` 可回傳官方交易日與 `complete`／`missing` 狀態，`rows` 回傳 2026-10-02 共 55 筆（TWSE 24、TPEx 31）及六個白名單欄位。原本受 secret 保護的 POST 經 GitHub 真實驗證工作流程重跑，新增 0 筆、略過 55 筆，重跑亦不新增。這份資料目前只有 **1 個已驗證完成的交易日**；網站不能將 5、10、20、30、60 日顯示為完整統計。其他既有歷史可用受 secret 保護的 `action: reindex` 建立 `unverified` 索引，並逐日驗證後才重新上傳標記完整；不得直接把所有舊列當成完整交易日。

下一步建議保留主儲存庫 Private，另建**專門公開的前端儲存庫**，只複製 `site/index.html`、`site/styles.css`、`site/stats.js`、`site/app.js`、`site/config.js`（不含本說明也可）。逐檔白名單複製，確認沒有 `.clasp.json`、`.clasprc.json`、`.local/`、密鑰、OAuth 檔、CSV、Python 程式或其他工作表設定，再啟用 GitHub Pages。不要把現有主儲存庫改公開。公開唯讀 API 只適合存放可公開的漲停資料，切勿在同一份資料表加入私人欄位。

## 本機與回補

`node tests/test_site_stats.js` 使用固定市場日資料驗證統計；`node tests/test_apps_script.js` 使用模擬 Sheets 與官方交易日資料驗證公開 API、分頁、狀態與寫入保護。不需要即時外部 API。

回補採明確列出日期、每次最多五天、預設只預覽：

```powershell
python backfill.py --date 2026-10-01 --date 2026-10-02
python backfill.py --date 2026-10-01 --date 2026-10-02 --execute --upload
```

執行模式逐日呼叫原本 `fetch_limit_up.py`，每兩日間隔五秒；任何一天來源不完整就停止。不要直接批量匯入未驗證的 CSV。上線前仍須人工確認每個回補日期與官方來源負載。
