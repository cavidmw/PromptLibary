/**********************
  GOOGLE OAUTH CLIENT ID
**********************/
const CLIENT_ID = "286422324721-8g647hr10o2fbjmhfoo5172nphnfqnj4.apps.googleusercontent.com";

/**********************
  FIREBASE CONFIG
**********************/
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDXLw4SXKnuARYniBfpvq7WHwmxdDjvY9c",
  authDomain: "promptsitem.firebaseapp.com",
  projectId: "promptsitem",
  storageBucket: "promptsitem.firebasestorage.app",
  messagingSenderId: "188322892342",
  appId: "1:188322892342:web:dde0a8cc587cf865c56697",
  measurementId: "G-XQVV0XCKF8"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

/**********************
  DOM
**********************/
const grid = document.getElementById("promptGrid");
const statusLine = document.getElementById("statusLine");

const boot = document.getElementById("boot");

const refreshBar = document.getElementById("refreshBar");
const syncBtn = document.getElementById("syncBtn");
const refreshCloseBtn = document.getElementById("refreshCloseBtn");

const loginBtn = document.getElementById("loginBtn");
const newPromptBtn = document.getElementById("newPromptBtn");

const modalBackdrop = document.getElementById("modalBackdrop");
const closeX = document.getElementById("closeX");
const cancelBtn = document.getElementById("cancelBtn");
const saveBtn = document.getElementById("saveBtn");
const titleInput = document.getElementById("titleInput");
const docUrlInput = document.getElementById("docUrlInput");

/**********************
  STATE
**********************/
let accessToken = null;
let tokenClient = null;
let dirty = false;

const promptCache = new Map(); // id -> prompt
let firestoreBound = false;
let firstSnapshotArrived = false;

const bootStart = Date.now();
let bootHidden = false;

/**********************
  STARS
**********************/
const starsLayer = document.getElementById("starsLayer");
function rand(min, max){ return Math.random() * (max - min) + min; }
function createStar(){
  const s = document.createElement("div");
  s.className = "star";
  const x = rand(0, 100);
  const y = rand(0, 100);
  const size = rand(1.2, 2.6);
  const twinkle = rand(7, 14);
  const floatDur = rand(18, 34);
  const dx = rand(-18, 18).toFixed(2) + "px";
  const dy = rand(-18, 18).toFixed(2) + "px";
  s.style.left = x + "vw";
  s.style.top = y + "vh";
  s.style.width = size + "px";
  s.style.height = size + "px";
  s.style.setProperty("--twinkleDur", twinkle + "s");
  s.style.setProperty("--floatDur", floatDur + "s");
  s.style.setProperty("--dx", dx);
  s.style.setProperty("--dy", dy);
  s.style.opacity = rand(0.10, 0.55);
  starsLayer.appendChild(s);
}
function initStars(){
  starsLayer.innerHTML = "";
  const count = Math.min(90, Math.max(45, Math.floor((window.innerWidth * window.innerHeight) / 22000)));
  for(let i=0;i<count;i++) createStar();
}
window.addEventListener("resize", () => {
  clearTimeout(window.__starTO);
  window.__starTO = setTimeout(initStars, 250);
});
initStars();

/**********************
  UI helpers
**********************/
function setStatus(msg){ statusLine.textContent = msg || ""; }

function showRefreshBar(){
  if(localStorage.getItem("PV_REFRESH_DISMISSED") === "1") return;
  refreshBar.style.display = "block";
  refreshBar.setAttribute("aria-hidden","false");
}
function hideRefreshBar(){
  refreshBar.style.display = "none";
  refreshBar.setAttribute("aria-hidden","true");
  localStorage.setItem("PV_REFRESH_DISMISSED","1");
  localStorage.removeItem("PV_NEEDS_REFRESH");
}

function setDirty(v){ dirty = v; }

/**********************
  Boot hide (1–2 sn)
**********************/
function maybeHideBoot(){
  if(bootHidden) return;
  if(!firstSnapshotArrived) return;

  const minShowMs = 1300; // 1–2 saniye arası “yakışan” süre
  const elapsed = Date.now() - bootStart;
  const remain = Math.max(0, minShowMs - elapsed);

  setTimeout(() => {
    if(bootHidden) return;
    boot.classList.add("hidden");
    boot.setAttribute("aria-hidden","true");
    bootHidden = true;
  }, remain);
}

/**********************
  Modal open/close (anim)
**********************/
function openModal(){
  modalBackdrop.classList.remove("closing");
  modalBackdrop.style.display = "flex";
  modalBackdrop.setAttribute("aria-hidden","false");
  document.body.style.overflow = "hidden";
  setDirty(false);
  titleInput.value = "";
  docUrlInput.value = "";
  setTimeout(()=> titleInput.focus(), 50);
}
function closeModalHard(){
  modalBackdrop.style.display = "none";
  modalBackdrop.setAttribute("aria-hidden","true");
  document.body.style.overflow = "";
  setDirty(false);
}
function closeModalAnimated(){
  modalBackdrop.classList.add("closing");
  setTimeout(() => {
    closeModalHard();
    modalBackdrop.classList.remove("closing");
  }, 190);
}
function tryCloseModal(){
  if(dirty){
    const ok = confirm("Değişiklikler kaybolabilir, emin misin?");
    if(!ok) return;
  }
  closeModalAnimated();
}

/**********************
  Utils
**********************/
function escapeHtml(str){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
function snippet(text){
  const t = (text || "").trim().replace(/\s+/g," ");
  return t.length > 92 ? t.slice(0, 92) + "…" : t;
}
async function copyToClipboardSafe(text){
  const t = (text || "").toString();
  try{
    if(window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText){
      await navigator.clipboard.writeText(t);
      return true;
    }
  }catch(e){}
  try{
    const ta = document.createElement("textarea");
    ta.value = t;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  }catch(e){
    return false;
  }
}
function extractDocId(url){
  if(!url) return null;
  const m = String(url).match(/\/document\/d\/([a-zA-Z0-9_-]+)\//);
  if(m && m[1]) return m[1];
  const m2 = String(url).match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if(m2 && m2[1]) return m2[1];
  return null;
}

/**********************
  Icons
**********************/
function svgExternal(){
  return `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M14 3h7v7"></path>
    <path d="M10 14L21 3"></path>
    <path d="M21 14v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6"></path>
  </svg>`;
}
function svgEdit(){
  return `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 20h9"></path>
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path>
  </svg>`;
}
function svgTrash(){
  return `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M3 6h18"></path>
    <path d="M8 6V4h8v2"></path>
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
    <path d="M10 11v6M14 11v6"></path>
  </svg>`;
}
function svgPin(){
  return `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 17v5"></path>
    <path d="M9 3l6 6"></path>
    <path d="M7 7l10 10"></path>
    <path d="M8 8l-2 2 4 4-2 2 4 4 2-2 4 4 2-2-4-4 2-2-4-4 2-2-4-4-2 2-4-4z" opacity="0"></path>
    <path d="M14.5 3.5l6 6"></path>
    <path d="M8.5 9.5l6 6"></path>
    <path d="M10 12l4-4"></path>
    <path d="M6 10l8 8"></path>
  </svg>`;
}
function svgUnpin(){
  return `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 17v5"></path>
    <path d="M15 9l-6 6"></path>
    <path d="M9 3l12 12"></path>
    <path d="M14.5 3.5l6 6"></path>
    <path d="M8.5 9.5l6 6"></path>
    <path d="M6 10l8 8"></path>
  </svg>`;
}

/**********************
  Firebase Auth (kalıcı)
**********************/
async function firebaseLogin(){
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  try{
    await auth.signInWithPopup(provider);
  }catch(err){
    const code = String(err?.code || "");
    if(code.includes("popup-blocked") || code.includes("popup-closed")){
      await auth.signInWithRedirect(provider);
      return;
    }
    alert("Giriş hatası: " + (err?.message || err));
  }
}

/**********************
  Google Docs token (GIS)
**********************/
function ensureTokenClient(){
  if(tokenClient) return;

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: "https://www.googleapis.com/auth/documents.readonly",
    callback: () => {}
  });
}

function ensureDocsToken(){
  return new Promise((resolve, reject) => {
    if(accessToken) return resolve(true);

    ensureTokenClient();

    // 1) sessiz dene
    tokenClient.callback = (resp) => {
      if(resp && resp.access_token){
        accessToken = resp.access_token;
        return resolve(true);
      }

      // 2) gerekirse izinli dene
      tokenClient.callback = (resp2) => {
        if(resp2 && resp2.access_token){
          accessToken = resp2.access_token;
          return resolve(true);
        }
        reject(new Error("Docs erişimi alınamadı."));
      };

      tokenClient.requestAccessToken({ prompt: "consent" });
    };

    tokenClient.requestAccessToken({ prompt: "" });
  });
}

/**********************
  Google Docs fetch (plain text)
**********************/
async function fetchDocPlainText(docId){
  await ensureDocsToken();

  const res = await fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if(!res.ok){
    const t = await res.text().catch(()=> "");
    throw new Error(`Docs API: ${res.status} ${res.statusText} ${t ? ("| " + t.slice(0,160)) : ""}`);
  }

  const data = await res.json();

  let out = "";
  const content = data?.body?.content || [];
  for(const el of content){
    const para = el?.paragraph;
    if(!para) continue;
    const elems = para.elements || [];
    for(const pe of elems){
      const tr = pe?.textRun?.content;
      if(typeof tr === "string") out += tr;
    }
  }
  return out.replace(/\s+\n/g,"\n").trim();
}

/**********************
  Firestore CRUD
**********************/
async function addPromptDoc(data){
  const ref = await db.collection("prompts").add(data);
  return ref.id;
}
async function deletePrompt(id){
  await db.collection("prompts").doc(id).delete();
}
async function updatePrompt(id, fields){
  await db.collection("prompts").doc(id).set(fields, { merge:true });
}

/**********************
  Sorting (Pinned)
  - Pinned önce
  - Pinned: pinnedAt küçük -> önce
  - Normal: updatedAt büyük -> önce
**********************/
function sortedPrompts(){
  const arr = Array.from(promptCache.entries()).map(([id, p]) => ({ id, ...p }));
  arr.sort((a,b) => {
    const ap = !!a.pinned, bp = !!b.pinned;
    if(ap !== bp) return ap ? -1 : 1;

    if(ap && bp){
      const aa = Number(a.pinnedAt || 0);
      const bb = Number(b.pinnedAt || 0);
      if(aa !== bb) return aa - bb; // ilk pinlenen en üstte
    }

    const au = Number(a.updatedAt || 0);
    const bu = Number(b.updatedAt || 0);
    return bu - au;
  });
  return arr;
}

/**********************
  Render
**********************/
function renderEmpty(){
  grid.innerHTML = `
    <div class="card" style="grid-column: 1 / -1;">
      <div class="cardTitle">Henüz prompt yok</div>
      <div class="cardMeta">Yeni Prompt ile ekle.</div>
    </div>
  `;
}

function renderCards(){
  grid.innerHTML = "";
  if(promptCache.size === 0){
    renderEmpty();
    return;
  }

  const items = sortedPrompts();

  for(const it of items){
    const id = it.id;
    const p = it;

    const card = document.createElement("div");
    card.className = "card" + (p.pinned ? " pinned" : "");

    const safeTitle = escapeHtml(p.title || "Başlıksız");
    const safeSnippet = escapeHtml(snippet(p.content || ""));

    card.innerHTML = `
      <div class="cardActionsTop">
        <button class="iconGlassBtn js-pin" title="${p.pinned ? "Sabiti kaldır" : "Sabitle"}" aria-label="Sabitle">
          ${p.pinned ? svgUnpin() : svgPin()}
        </button>
        <button class="iconGlassBtn js-fly" title="Panoya kopyala + Claude aç" aria-label="Uçur">${svgExternal()}</button>
        <button class="iconGlassBtn js-edit" title="Docs’ta düzenle" aria-label="Düzenle">${svgEdit()}</button>
      </div>

      <div class="cardTitle">${safeTitle}</div>
      <div class="cardMeta">${safeSnippet}</div>

      <div class="cardDelete">
        <button class="iconGlassBtn js-del" title="Sil" aria-label="Sil">${svgTrash()}</button>
      </div>

      <div class="cardDocInfo"></div>
    `;

    // PIN / UNPIN
    card.querySelector(".js-pin").addEventListener("click", async (e) => {
      e.stopPropagation();
      try{
        if(p.pinned){
          await updatePrompt(id, {
            pinned: false,
            pinnedAt: firebase.firestore.FieldValue.delete()
          });
        }else{
          await updatePrompt(id, {
            pinned: true,
            pinnedAt: Date.now()
          });
        }
      }catch(err){
        alert("Pin hatası: " + (err?.message || err));
      }
    });

    // UÇUR: içerik kopyala + Claude
    card.querySelector(".js-fly").addEventListener("click", async (e) => {
      e.stopPropagation();
      const txt = (p.content || "").trim();
      if(!txt){
        alert("Bu prompt henüz çekilmedi. Yenile.");
        localStorage.removeItem("PV_REFRESH_DISMISSED");
        showRefreshBar();
        return;
      }
      const ok = await copyToClipboardSafe(txt);
      if(!ok){
        alert("Kopyalama engellendi. Live Server ile aç.");
        return;
      }
      window.open("https://claude.ai/new","_blank");
    });

    // Düzenle: Docs aç + refresh bar
    card.querySelector(".js-edit").addEventListener("click", (e) => {
      e.stopPropagation();
      if(!p.docUrl){
        alert("Docs linki yok.");
        return;
      }
      localStorage.setItem("PV_NEEDS_REFRESH","1");
      localStorage.removeItem("PV_REFRESH_DISMISSED");
      showRefreshBar();
      window.open(p.docUrl, "_blank");
    });

    // Sil
    card.querySelector(".js-del").addEventListener("click", async (e) => {
      e.stopPropagation();
      const ok = confirm("Bu projeyi silmek istediğine emin misin?");
      if(!ok) return;
      try{
        await deletePrompt(id);
      }catch(err){
        alert("Silme hatası: " + (err?.message || err));
      }
    });

    grid.appendChild(card);
  }
}

/**********************
  Sync All
**********************/
async function syncAllDocs(){
  const items = Array.from(promptCache.entries()).map(([id, p]) => ({ id, ...p }));
  if(items.length === 0){
    hideRefreshBar();
    return;
  }

  let ok=0, fail=0;

  for(const it of items){
    const docId = extractDocId(it.docUrl);
    if(!docId){ fail++; continue; }
    try{
      const text = await fetchDocPlainText(docId);
      const now = Date.now();

      await updatePrompt(it.id, {
        content: text,
        lastSyncedAt: now,
        updatedAt: now
      });

      ok++;
    }catch(e){
      fail++;
      console.log("Sync error:", e);
    }
  }

  hideRefreshBar();
  if(fail > 0) alert(`Yenile tamamlandı. Hatalı: ${fail}`);
}

/**********************
  Firestore listener
**********************/
function bindFirestoreOnce(){
  if(firestoreBound) return;
  firestoreBound = true;

  db.collection("prompts")
    .onSnapshot((snap) => {
      promptCache.clear();

      snap.forEach((doc) => {
        const d = doc.data() || {};
        promptCache.set(doc.id, {
          title: d.title || "Başlıksız",
          docUrl: d.docUrl || "",
          content: d.content || "",
          lastSyncedAt: d.lastSyncedAt || 0,
          updatedAt: d.updatedAt || 0,
          pinned: !!d.pinned,
          pinnedAt: d.pinnedAt || 0
        });
      });

      renderCards();

      if(!firstSnapshotArrived){
        firstSnapshotArrived = true;
        maybeHideBoot();
      }
    }, (err) => {
      console.log("Firestore error:", err);
      if(!firstSnapshotArrived){
        firstSnapshotArrived = true;
        maybeHideBoot();
      }
    });
}

/**********************
  Events
**********************/
loginBtn.addEventListener("click", async () => {
  await firebaseLogin();
});

newPromptBtn.addEventListener("click", openModal);
closeX.addEventListener("click", tryCloseModal);
cancelBtn.addEventListener("click", tryCloseModal);

modalBackdrop.addEventListener("click", (e) => {
  if(e.target === modalBackdrop) tryCloseModal();
});

titleInput.addEventListener("input", () => setDirty(true));
docUrlInput.addEventListener("input", () => setDirty(true));
window.onbeforeunload = function(){ if(dirty) return true; };

saveBtn.addEventListener("click", async () => {
  const title = (titleInput.value || "").trim();
  const docUrl = (docUrlInput.value || "").trim();

  if(!title){ alert("Başlık boş olamaz."); return; }
  if(!docUrl){ alert("Docs linki boş olamaz."); return; }

  const docId = extractDocId(docUrl);
  if(!docId){ alert("Bu linkten Doc ID çıkaramadım."); return; }

  try{
    const text = await fetchDocPlainText(docId);
    const now = Date.now();

    await addPromptDoc({
      title,
      docUrl,
      content: text,
      lastSyncedAt: now,
      updatedAt: now,
      pinned: false
    });

    closeModalAnimated(); // otomatik kapanır
  }catch(err){
    alert("Ekleme hatası: " + (err?.message || err));
  }
});

syncBtn.addEventListener("click", async () => {
  await syncAllDocs();
});

refreshCloseBtn.addEventListener("click", () => {
  hideRefreshBar();
});

document.addEventListener("visibilitychange", () => {
  if(document.visibilityState === "visible"){
    if(localStorage.getItem("PV_NEEDS_REFRESH") === "1"){
      localStorage.removeItem("PV_REFRESH_DISMISSED");
      showRefreshBar();
    }
  }
});

/**********************
  START
**********************/
setStatus(""); // gereksiz metin yok
renderEmpty();

// Kalıcı oturum: sayfa açılınca otomatik tanır
auth.onAuthStateChanged((user) => {
  if(user){
    loginBtn.style.display = "none";
    newPromptBtn.disabled = false;
    bindFirestoreOnce();
  }else{
    loginBtn.style.display = "inline-flex";
    newPromptBtn.disabled = true;
    // promptları gösterme
    promptCache.clear();
    renderEmpty();
    if(!firstSnapshotArrived){
      // login yoksa da boot uzun kalmasın
      firstSnapshotArrived = true;
      maybeHideBoot();
    }
  }
});
