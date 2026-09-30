/* =========================================================
   수어 단어장 - app.js
   firebase-config.js 에서 firebase.initializeApp() 이미 실행됨
   ========================================================= */

const auth = firebase.auth();
const db = firebase.firestore();

let allWords = [];        // Firestore 에서 불러온 전체 단어 목록
let currentCategory = "";
let currentSearch = "";

/* ---------- 화면 요소 ---------- */
const authScreen = document.getElementById("auth-screen");
const appScreen = document.getElementById("app-screen");

const loginForm = document.getElementById("login-form");
const signupForm = document.getElementById("signup-form");
const tabBtns = document.querySelectorAll(".tab-btn");

const userNameEl = document.getElementById("user-name");
const logoutBtn = document.getElementById("logout-btn");

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

/* ---------- 로그아웃 ---------- */
logoutBtn.addEventListener("click", () => auth.signOut());

/* ---------- 로그인 상태 감지 ---------- */
auth.onAuthStateChanged((user) => {
  if (user) {
    authScreen.classList.add("hidden");
    appScreen.classList.remove("hidden");
    userNameEl.textContent = user.displayName ? `${user.displayName}님` : user.email;
    loadWords();
  } else {
    authScreen.classList.remove("hidden");
    appScreen.classList.add("hidden");
  }
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

/* ---------- 유틸 ---------- */
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
  };
  return map[err.code] || `오류가 발생했습니다 (${err.code || err.message})`;
}
