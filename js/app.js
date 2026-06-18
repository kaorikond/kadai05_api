import { firebaseConfig } from "./firebase.js";

const firebaseCdnVersion = "10.12.5";
const dbPath = "progressMessages";
const noticeMilestones = new Set(["25", "50", "75", "100"]);
const trades = ["配管", "ダクト", "保温", "計装", "機器搬入"];
const fallbackKey = "mepla-progress-demo-records";

const form = document.querySelector("#progressForm");
const chatList = document.querySelector("#chatList");
const template = document.querySelector("#messageTemplate");
const progressInput = document.querySelector("#progress");
const progressValue = document.querySelector("#progressValue");
const messageCount = document.querySelector("#messageCount");
const tradeSummary = document.querySelector("#tradeSummary");
const overallProgress = document.querySelector("#overallProgress");
const connectionDot = document.querySelector("#connectionDot");
const connectionLabel = document.querySelector("#connectionLabel");
const connectionText = document.querySelector("#connectionText");
const seedButton = document.querySelector("#seedButton");
const exportButton = document.querySelector("#exportButton");
const filterButtons = Array.from(document.querySelectorAll(".filter-chip"));

let records = [];
let activeFilter = "all";
let store = createLocalStore();

progressInput.addEventListener("input", () => {
  progressValue.value = `${progressInput.value}%`;
});

form.addEventListener("submit", async (event) => {

console.log("入力された");

  event.preventDefault();
  const formData = new FormData(form);
  const progressRecord = {
    uname: valueOf(formData, "uname"),
    floor: valueOf(formData, "floor"),
    area: valueOf(formData, "area"),
    trade: valueOf(formData, "trade"),
    work: valueOf(formData, "work"),
    progress: valueOf(formData, "progress"),
    check: "未確認",
    text: valueOf(formData, "text"),
    type: "progress",
    createdAt: new Date().toISOString(),
  };

  console.log("Firebase保存開始");
  await store.push(progressRecord);
  console.log("Firebase保存完了");

  console.log("通知条件判定");
  console.log(progressRecord.progress);
  console.log(progressRecord.check);
  if (shouldCreateNotice(progressRecord)) {
    await store.push(createNotice(progressRecord));
  }

  form.reset();
  progressInput.value = "50";
  progressValue.value = "50%";
});

seedButton.addEventListener("click", async () => {

  const samples = [
    ["〇〇設備", "2F", "A工区", "配管", "冷温水配管施工", "50", "未確認", "明日吊込み完了予定"],
    ["△△電気", "1F", "B工区", "計装", "盤まわり配線", "80", "未確認", "検査前自主確認中"],
    ["□□空調", "3F", "C工区", "ダクト", "ダクト吊込み", "40", "未確認", "明日2t資材搬入"],
    ["◇◇保温", "RF", "A工区", "保温", "冷水配管保温", "25", "未確認", "確認後検査可能"],
  ];

  for (const item of samples) {
    const record = {
      uname: item[0],
      floor: item[1],
      area: item[2],
      trade: item[3],
      work: item[4],
      progress: item[5],
      check: item[6],
      text: item[7],
      type: "progress",
      createdAt: new Date(Date.now() - Math.random() * 3600000).toISOString(),
    };
    await store.push(record);
    if (shouldCreateNotice(record)) {
      await store.push(createNotice(record));
    }
  }
});

exportButton.addEventListener("click", () => {

  console.log("CSV出力開始");
  console.log(records);

  const csvRows = [
    ["日時", "業者名", "階", "工区", "工種", "作業内容", "進捗率", "コメント", "担当者確認"],
    ...records
      .filter((record) => record.type === "progress")
      .map((record) => [
        formatDateTime(record.createdAt),
        record.uname,
        record.floor,
        record.area,
        record.trade,
        record.work,
        `${record.progress}%`,
        record.text,
        record.check,
      ]),
  ];
  const csv = csvRows.map((row) => row.map(escapeCsv).join(",")).join("\n");
  
  console.log("CSVデータ生成完了");
  console.log(csv);

  downloadFile(`mepla-progress-${dateStamp()}.csv`, `\ufeff${csv}`, "text/csv;charset=utf-8");

console.log("CSVダウンロード実行")

});

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    filterButtons.forEach((item) => item.classList.toggle("is-active", item === button));
    render();
  });
});

init();

async function init() {
  store = await createStore();
  store.subscribe((nextRecords) => {
    records = nextRecords.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    render();
  });
}

async function createStore() {
  if (!hasFirebaseConfig(firebaseConfig)) {
    setConnection("デモモード", "Firebase設定後にリアルタイム同期します", false);
    return createLocalStore();
  }

  try {
    const [{ initializeApp }, database] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${firebaseCdnVersion}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${firebaseCdnVersion}/firebase-database.js`),
    ]);
    const app = initializeApp(firebaseConfig);
    const db = database.getDatabase(app);
    const messagesRef = database.ref(db, dbPath);

    setConnection("Firebase接続中", "Realtime Databaseを正本として保存中", true);

    return {
      push(record) {
        return database.push(messagesRef, record);
      },
      subscribe(callback) {
        database.onValue(messagesRef, (snapshot) => {

          console.log("Firebaseから取得");

          const value = snapshot.val() || {};

          console.log(value);

          callback(Object.entries(value).map(([id, record]) => ({ id, ...record })));
        });
      },
    };
  } catch (error) {
    console.warn("Firebase initialization failed. Fallback to local demo store.", error);
    setConnection("デモモード", "Firebase接続に失敗したためローカル表示中", false);
    return createLocalStore();
  }
}

function createLocalStore() {
  return {
    async push(record) {
      const current = readLocalRecords();
      current.push({ id: crypto.randomUUID(), ...record });
      localStorage.setItem(fallbackKey, JSON.stringify(current));
      window.dispatchEvent(new CustomEvent("local-progress-update"));
    },
    subscribe(callback) {
      const emit = () => callback(readLocalRecords());
      window.addEventListener("local-progress-update", emit);
      emit();
    },
  };
}

function render() {

  console.log("画面描画");

  const filtered = filterRecords(records);
  chatList.replaceChildren(...filtered.map(renderMessage));
  messageCount.textContent = `${filtered.length}件`;
  renderSummary();
}

function renderMessage(record) {
  const node = template.content.firstElementChild.cloneNode(true);
  const isNotice = record.type === "notice";
  node.classList.toggle("is-notice", isNotice);
  node.querySelector(".message-uname").textContent = record.uname || "未設定";
  node.querySelector(".message-time").textContent = formatDateTime(record.createdAt);
  node.querySelector(".message-meta").textContent = `${record.floor}・${record.area}・${record.trade}`;
  node.querySelector(".message-work").textContent = `「${record.work}」`;
  node.querySelector(".message-progress strong").textContent = `${record.progress}%`;
  node.querySelector(".bar span").style.width = `${Number(record.progress) || 0}%`;
  node.querySelector(".message-text").textContent = record.text || "コメントなし";

  const badge = node.querySelector(".check-badge");
  badge.textContent = record.check || "未確認";
  badge.classList.toggle("is-unchecked", record.check !== "確認済");

  return node;
}

function renderSummary() {

  console.log("集計実行");

  const progressRecords = records.filter((record) => record.type === "progress");
  const summaries = trades.map((trade) => {
    const tradeRecords = progressRecords.filter((record) => record.trade === trade);
    const average = averageProgress(tradeRecords);
    return { trade, average, count: tradeRecords.length };
  });

  const overall = averageProgress(progressRecords);
  overallProgress.textContent = `${overall}%`;

  tradeSummary.replaceChildren(
    ...summaries.map((summary) => {
      const card = document.createElement("article");
      card.className = "summary-card";
      card.innerHTML = `
        <span>${summary.trade} / ${summary.count}件</span>
        <strong>${summary.average}%</strong>
        <div class="message-progress" aria-hidden="true">
          <span class="bar"><span style="width: ${summary.average}%"></span></span>
        </div>
      `;
      return card;
    }),
  );
}

function filterRecords(source) {
  if (activeFilter === "progress") {
    return source.filter((record) => record.type === "progress");
  }
  if (activeFilter === "notice") {
    return source.filter((record) => record.type === "notice");
  }
  if (activeFilter === "unchecked") {
    return source.filter((record) => record.check !== "確認済" && record.type === "progress");
  }
  return source;
}

function createNotice(record) {
  return {
    uname: "システム通知",
    floor: record.floor,
    area: record.area,
    trade: record.trade,
    work: record.work,
    progress: record.progress,
    check: "確認済",
    text: "出来高支払書を近日中に送付します。",
    type: "notice",
    createdAt: new Date().toISOString(),
  };
}

function shouldCreateNotice(record) {
  return record.check === "確認済" && noticeMilestones.has(String(record.progress));
}

function averageProgress(source) {
  if (!source.length) return 0;
  const total = source.reduce((sum, record) => sum + Number(record.progress || 0), 0);
  return Math.round(total / source.length);
}

function valueOf(formData, key) {
  return String(formData.get(key) || "").trim();
}

function readLocalRecords() {
  try {
    return JSON.parse(localStorage.getItem(fallbackKey) || "[]");
  } catch {
    return [];
  }
}

function setConnection(label, text, online) {
  connectionLabel.textContent = label;
  connectionText.textContent = text;
  connectionDot.classList.toggle("is-online", online);
}

function hasFirebaseConfig(config) {
  return Boolean(config.apiKey && config.databaseURL && !config.apiKey.includes("YOUR_"));
}

function formatDateTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10).replaceAll("-", "");
}

function escapeCsv(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
