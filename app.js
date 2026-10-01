/* =========================================================
   수어 단어장 - app.js
   firebase-config.js 에서 firebase.initializeApp() 이미 실행됨
   ========================================================= */

const auth = firebase.auth();
const db = firebase.firestore();

let allWords = [];        // Firestore 에서 불러온 전체 단어 목록
let currentCategory = "";
let currentSearch = "";

/* ---------- 관리자 설정 ----------
   여기 적힌 이메일로 로그인한 사람에게만 "단어 관리" 버튼이 보임.
   실제 쓰기 권한은 firestore.rules 의 isAdmin() 목록이 진짜 보안 경계이고,
   이 목록은 화면에 버튼을 보여줄지 말지 결정하는 용도일 뿐이라 둘 다 같은
   이메일로 맞춰둬야 함. */
const ADMIN_EMAILS = ["kjk3090@gmail.com"];

/* ---------- 화면 요소 ---------- */
const authScreen = document.getElementById("auth-screen");
const appScreen = document.getElementById("app-screen");

const loginForm = document.getElementById("login-form");
const signupForm = document.getElementById("signup-form");
const tabBtns = document.querySelectorAll(".tab-btn");
const googleLoginBtn = document.getElementById("google-login-btn");
const googleErrorEl = document.getElementById("google-error");

const userNameEl = document.getElementById("user-name");
const logoutBtn = document.getElementById("logout-btn");

const adminToggleBtn = document.getElementById("admin-toggle-btn");
const adminPanel = document.getElementById("admin-panel");
const adminForm = document.getElementById("admin-form");
const adminWordInput = document.getElementById("admin-word");
const adminCategoryInput = document.getElementById("admin-category");
const adminYoutubeInput = document.getElementById("admin-youtube");
const adminCategoryList = document.getElementById("admin-category-list");
const adminErrorEl = document.getElementById("admin-error");
const adminSuccessEl = document.getElementById("admin-success");
const adminBulkFile = document.getElementById("admin-bulk-file");
const adminBulkBtn = document.getElementById("admin-bulk-btn");
const adminBulkStatus = document.getElementById("admin-bulk-status");

const searchInput = document.getElementById("search-input");
const categoryFilter = document.getElementById("category-filter");
const refreshBtn = document.getElementById("refresh-btn");
const wordGrid = document.getElementById("word-grid");
const resultCount = document.getElementById("result-count");
const emptyMessage = document.getElementById("empty-message");

const modal = document.getElementById("video-modal");
const modalClose = document.getElementById("modal-close");
const modalWord = document.getElementById("modal-word");
const modalCategory = document.getElementById("modal-category");
const modalVideo = document.getElementById("modal-video");

/* ---------- 탭 전환 (로그인 / 회원가입) ---------- */
tabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    loginForm.classList.toggle("hidden", tab !== "login");
    signupForm.classList.toggle("hidden", tab !== "signup");
  });
});

/* ---------- 회원가입 ---------- */
signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("signup-name").value.trim();
  const email = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value;
  const errorEl = document.getElementById("signup-error");
  errorEl.textContent = "";

  try {
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    await cred.user.updateProfile({ displayName: name });
    // 회원가입과 동시에 로그인 상태가 되어 onAuthStateChanged 가 처리함
  } catch (err) {
    errorEl.textContent = friendlyAuthError(err);
  }
});

/* ---------- 로그인 ---------- */
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const errorEl = document.getElementById("login-error");
  errorEl.textContent = "";

  try {
    await auth.signInWithEmailAndPassword(email, password);
  } catch (err) {
    errorEl.textContent = friendlyAuthError(err);
  }
});

/* ---------- Google 로그인 ---------- */
googleLoginBtn.addEventListener("click", async () => {
  googleErrorEl.textContent = "";
  const provider = new firebase.auth.GoogleAuthProvider();
  try {
    await auth.signInWithPopup(provider);
    // 처음 로그인하는 사람이면 Firebase가 자동으로 계정을 만들어줌 (회원가입/로그인 구분 없음)
  } catch (err) {
    if (err.code !== "auth/popup-closed-by-user") {
      googleErrorEl.textContent = friendlyAuthError(err);
    }
  }
});

/* ---------- 로그아웃 ---------- */
logoutBtn.addEventListener("click", () => auth.signOut());

/* ---------- 로그인 상태 감지 ---------- */
auth.onAuthStateChanged((user) => {
  if (user) {
    authScreen.classList.add("hidden");
    appScreen.classList.remove("hidden");
    userNameEl.textContent = user.displayName ? `${user.displayName}님` : user.email;

    const isAdmin = !!user.email && ADMIN_EMAILS.includes(user.email);
    adminToggleBtn.classList.toggle("hidden", !isAdmin);
    if (!isAdmin) adminPanel.classList.add("hidden");

    loadWords();
  } else {
    authScreen.classList.remove("hidden");
    appScreen.classList.add("hidden");
    adminPanel.classList.add("hidden");
  }
});

adminToggleBtn.addEventListener("click", () => {
  adminPanel.classList.toggle("hidden");
});

/* ---------- 단어 목록 캐시 (Firestore 읽기 횟수 절약용) ----------
   로그인할 때마다 전체 단어를 다시 불러오면, 단어 개수만큼 Firestore
   읽기가 소모됨 (단어 962개 -> 로그인 1번에 읽기 962번). 단어 목록은
   자주 바뀌는 게 아니므로, 브라우저에 12시간 동안 저장해두고 그 안에는
   Firestore를 다시 부르지 않도록 함. 단어가 아무리 늘어나도 이후
   읽기 횟수에는 거의 영향이 없음. */
const WORDS_CACHE_KEY = "signWordsCache_v1";
const WORDS_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12시간

function readWordsCache() {
  try {
    const raw = localStorage.getItem(WORDS_CACHE_KEY);
    if (!raw) return null;
    const { savedAt, data } = JSON.parse(raw);
    if (!savedAt || !data || Date.now() - savedAt > WORDS_CACHE_TTL_MS) return null;
    return data;
  } catch {
    return null; // localStorage 사용 불가 환경이어도 그냥 Firestore에서 불러오면 됨
  }
}

function writeWordsCache(data) {
  try {
    localStorage.setItem(WORDS_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data }));
  } catch {
    /* 저장 실패해도 사이트 동작에는 지장 없음 */
  }
}

function clearWordsCache() {
  try {
    localStorage.removeItem(WORDS_CACHE_KEY);
  } catch {
    /* 무시 */
  }
}

/* ---------- Firestore 에서 단어 목록 불러오기 ---------- */
async function loadWords(forceRefresh = false) {
  if (!forceRefresh) {
    const cached = readWordsCache();
    if (cached) {
      allWords = cached;
      buildCategoryOptions();
      renderWords();
      return;
    }
  }

  wordGrid.innerHTML = `<p class="empty-message">불러오는 중...</p>`;
  try {
    const snapshot = await db.collection("words").orderBy("word").get();
    allWords = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    writeWordsCache(allWords);
    buildCategoryOptions();
    renderWords();
  } catch (err) {
    wordGrid.innerHTML = `<p class="empty-message">단어를 불러오지 못했습니다: ${err.message}</p>`;
  }
}

refreshBtn.addEventListener("click", () => {
  clearWordsCache();
  loadWords(true);
});

/* ---------- 카테고리 드롭다운 구성 ---------- */
function buildCategoryOptions() {
  const categories = [...new Set(allWords.map((w) => w.category).filter(Boolean))].sort();
  categoryFilter.innerHTML = `<option value="">전체 카테고리</option>` +
    categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");

  // 관리자 패널에서 카테고리 입력할 때 기존 카테고리 이름이 자동완성으로 뜨도록
  adminCategoryList.innerHTML = categories.map((c) => `<option value="${escapeHtml(c)}">`).join("");
}

/* ---------- 검색 / 필터 ---------- */
searchInput.addEventListener("input", (e) => {
  currentSearch = e.target.value.trim();
  renderWords();
});

categoryFilter.addEventListener("change", (e) => {
  currentCategory = e.target.value;
  renderWords();
});

function renderWords() {
  const hasQuery = currentSearch.length > 0 || currentCategory.length > 0;

  // 검색어도 없고 카테고리 선택도 안 한 초기 상태 -> 전체 목록을 다 뿌리지 않고
  // 구글처럼 "검색해보세요" 안내만 보여줌 (스크롤 압박 방지)
  if (!hasQuery) {
    wordGrid.innerHTML = "";
    resultCount.textContent = `총 ${allWords.length}개 단어 중 검색해보세요`;
    emptyMessage.textContent = "🔍 위 검색창에 찾고 싶은 단어를 입력하거나, 카테고리를 선택해보세요.";
    emptyMessage.classList.remove("hidden");
    return;
  }

  const filtered = allWords.filter((w) => {
    const matchesSearch = !currentSearch || (w.word || "").includes(currentSearch);
    const matchesCategory = !currentCategory || w.category === currentCategory;
    return matchesSearch && matchesCategory;
  });

  resultCount.textContent = `검색 결과 ${filtered.length}개`;
  emptyMessage.textContent = "검색 결과가 없습니다.";
  emptyMessage.classList.toggle("hidden", filtered.length !== 0);

  wordGrid.innerHTML = filtered.map((w) => `
    <div class="word-card" data-id="${w.id}">
      <p class="word-title">${escapeHtml(w.word || "")}</p>
      <span class="word-category">${escapeHtml(w.category || "미분류")}</span>
    </div>
  `).join("");

  wordGrid.querySelectorAll(".word-card").forEach((card) => {
    card.addEventListener("click", () => openModal(card.dataset.id));
  });
}

/* ---------- 영상 모달 ---------- */
function openModal(id) {
  const w = allWords.find((x) => x.id === id);
  if (!w) return;
  modalWord.textContent = w.word || "";
  modalCategory.textContent = w.category || "";
  modalVideo.src = `https://www.youtube.com/embed/${w.youtube_id}`;
  modal.classList.remove("hidden");
}

function closeModal() {
  modal.classList.add("hidden");
  modalVideo.src = "";
}

modalClose.addEventListener("click", closeModal);
modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});

/* ---------- 관리자: 단어 추가/수정 ---------- */
adminForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  adminErrorEl.textContent = "";
  adminSuccessEl.textContent = "";

  const word = adminWordInput.value.trim();
  const category = adminCategoryInput.value.trim();
  const youtubeRaw = adminYoutubeInput.value.trim();
  const youtube_id = extractYoutubeId(youtubeRaw);

  if (!word || !category) {
    adminErrorEl.textContent = "단어와 카테고리를 입력해주세요.";
    return;
  }
  if (!youtube_id) {
    adminErrorEl.textContent = "유튜브 링크(또는 영상 ID)를 확인해주세요.";
    return;
  }

  // upload_words.py 와 동일한 규칙으로 문서 ID 생성 (같은 단어+카테고리면 덮어써서 수정됨)
  const safeWord = word.replace(/\//g, "-");
  const safeCategory = category.replace(/\//g, "-");
  const docId = `${safeWord}__${safeCategory}`;

  try {
    await db.collection("words").doc(docId).set({ word, category, youtube_id });
    adminSuccessEl.textContent = `"${word}" (${category}) 저장했습니다.`;
    adminWordInput.value = "";
    adminYoutubeInput.value = "";
    clearWordsCache();
    await loadWords(true);
  } catch (err) {
    if (err.code === "permission-denied") {
      adminErrorEl.textContent = "저장 권한이 없습니다. firestore.rules 의 관리자 이메일 목록을 확인해주세요.";
    } else {
      adminErrorEl.textContent = `저장 중 오류가 발생했습니다: ${err.message}`;
    }
  }
});

/* ---------- 관리자: 엑셀/CSV 파일로 한번에 추가 ----------
   두 가지 형식을 자동으로 구분함:
   1) 첫 번째 시트 첫 줄에 "word" 라는 글자가 있으면 -> word,category,youtube_id 형식
   2) 그게 아니면 -> 수어연구회의 어휘목록 형식 (분류 / 원본 영상 제목 / 유튜브 링크,
      여러 시트 전부 처리, 제목 앞 번호(1. , 001. 등)는 자동 제거) */
function parseWordsFromWorkbook(workbook) {
  const firstSheetRows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
    header: 1,
    defval: "",
  });
  const firstRowText = (firstSheetRows[0] || []).join(" ").toLowerCase();
  const isSimpleFormat = firstRowText.includes("word");

  const rows = [];

  if (isSimpleFormat) {
    for (const sheetName of workbook.SheetNames) {
      const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
      for (const r of data) {
        const key = Object.keys(r).find((k) => k.toLowerCase().trim() === "word");
        const catKey = Object.keys(r).find((k) => k.toLowerCase().trim() === "category");
        const ytKey = Object.keys(r).find((k) => k.toLowerCase().trim() === "youtube_id");
        if (!key) continue;
        const word = String(r[key] || "").trim();
        const category = catKey ? String(r[catKey] || "").trim() : "";
        const youtube_id = extractYoutubeId(ytKey ? String(r[ytKey] || "") : "");
        if (word && youtube_id) rows.push({ word, category, youtube_id });
      }
    }
  } else {
    for (const sheetName of workbook.SheetNames) {
      const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });
      for (const row of data) {
        const category = String(row[0] || "").trim();
        const titleRaw = String(row[1] || "").trim();
        const linkRaw = String(row[2] || "").trim();
        if (!titleRaw || !linkRaw.startsWith("http")) continue;
        const word = titleRaw.replace(/^\s*\d+\.\s*/, "").trim();
        const youtube_id = extractYoutubeId(linkRaw);
        if (word && youtube_id) rows.push({ word, category, youtube_id });
      }
    }
  }

  return rows;
}

adminBulkBtn.addEventListener("click", async () => {
  adminBulkStatus.textContent = "";
  const file = adminBulkFile.files[0];
  if (!file) {
    adminBulkStatus.textContent = "먼저 파일을 선택해주세요.";
    return;
  }

  adminBulkBtn.disabled = true;
  adminBulkStatus.textContent = "파일을 읽는 중...";

  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const parsed = parseWordsFromWorkbook(workbook);

    if (parsed.length === 0) {
      adminBulkStatus.textContent = "인식할 수 있는 단어를 찾지 못했습니다. 파일 형식을 확인해주세요.";
      adminBulkBtn.disabled = false;
      return;
    }

    // 같은 단어+카테고리가 여러 번 나오면 번호를 붙여 구분 (upload_words.py 와 동일한 방식)
    const idCounts = {};
    const docs = parsed.map(({ word, category, youtube_id }) => {
      const safeWord = word.replace(/\//g, "-");
      const safeCategory = category.replace(/\//g, "-");
      const baseId = category ? `${safeWord}__${safeCategory}` : safeWord;
      idCounts[baseId] = (idCounts[baseId] || 0) + 1;
      const docId = idCounts[baseId] === 1 ? baseId : `${baseId}__${idCounts[baseId]}`;
      return { docId, word, category, youtube_id };
    });

    // Firestore 는 배치 하나에 최대 500개 작업까지만 허용 -> 500개씩 나눠서 순서대로 저장
    const CHUNK_SIZE = 450;
    let done = 0;
    for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
      const chunk = docs.slice(i, i + CHUNK_SIZE);
      const batch = db.batch();
      chunk.forEach(({ docId, word, category, youtube_id }) => {
        batch.set(db.collection("words").doc(docId), { word, category, youtube_id });
      });
      await batch.commit();
      done += chunk.length;
      adminBulkStatus.textContent = `업로드 중... (${done} / ${docs.length})`;
    }

    adminBulkStatus.textContent = `완료: 총 ${docs.length}개 단어를 저장했습니다.`;
    adminBulkFile.value = "";
    clearWordsCache();
    await loadWords(true);
  } catch (err) {
    adminBulkStatus.textContent = `업로드 중 오류가 발생했습니다: ${err.message}`;
  } finally {
    adminBulkBtn.disabled = false;
  }
});

/* ---------- 유틸 ---------- */
function extractYoutubeId(input) {
  const str = (input || "").trim();
  const match = str.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
  if (match) return match[1];
  if (/^[A-Za-z0-9_-]{11}$/.test(str)) return str; // 링크 없이 영상 ID만 입력한 경우
  return "";
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function friendlyAuthError(err) {
  const map = {
    "auth/email-already-in-use": "이미 가입된 이메일입니다.",
    "auth/invalid-email": "이메일 형식이 올바르지 않습니다.",
    "auth/weak-password": "비밀번호는 6자 이상이어야 합니다.",
    "auth/user-not-found": "가입되지 않은 이메일입니다.",
    "auth/wrong-password": "비밀번호가 올바르지 않습니다.",
    "auth/invalid-credential": "이메일 또는 비밀번호가 올바르지 않습니다.",
    "auth/too-many-requests": "시도 횟수가 많아 잠시 후 다시 시도해주세요.",
    "auth/popup-blocked": "브라우저가 팝업을 차단했습니다. 팝업 차단을 해제한 뒤 다시 시도해주세요.",
    "auth/account-exists-with-different-credential": "이미 이메일/비밀번호로 가입된 계정입니다. 그 방법으로 로그인해주세요.",
  };
  return map[err.code] || `오류가 발생했습니다 (${err.code || err.message})`;
}
