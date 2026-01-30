const timetable = [
  ["DVAT","IS","Break","NLP","FCA","Break","BS","NLP","Break","Free","DM"],
  ["CNAP","FCA","Break","DVAT","NLP","Break","IS","BS","Break","BS","DM"],
  ["IS","FCA","Break","DVAT","FCA","Break","CNAP","CNAP LAB / IS LAB","Break","CNAP LAB / IS LAB","CNAP LAB / IS LAB"],
  ["NLP","FCA","Break","CNAP","IS","Break","BS","IS LAB / CNAP LAB","Break","IS LAB / CNAP LAB","IS LAB / CNAP LAB"],
  ["NLP","DM","Break","NLP","DVAT","Break","IS","MINI PROJECT","Break","MINI PROJECT","MINI PROJECT"],
  ["DVAT","CNAP","Break","BS","DM","Break","Free","GE","Break","Free","CLUB"]
];

const times = [
  ["09:00","09:50"],
  ["09:50","10:40"],
  ["10:40","10:55"],
  ["10:55","11:45"],
  ["11:45","12:35"],
  ["12:35","13:15"],
  ["13:15","14:05"],
  ["14:05","14:55"],
  ["14:55","15:10"],
  ["15:10","16:00"],
  ["16:00","16:50"]
];

const days = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
let boundaryTimer = null;
let tickTimer = null;
let cellMap = new Map();
let activeKey = null;
let lastScrollKey = null;
let selectedCell = null;
let settings = {
  theme: "light",
  vibrate: false,
  notify: false,
  edit: false
};

let fb = {
  enabled: false,
  auth: null,
  db: null,
  user: null,
  profile: null
};

let editingCell = null;
let editingKey = null;
let editingOriginal = null;

let published = {
  loadedAt: 0,
  items: [],
  query: "",
  sort: "recent"
};

let currentTab = "tabHome";
let activateTabFn = null;

function encodeTimetableForFirestore(tt) {
  const out = {};
  if (!Array.isArray(tt)) return out;
  for (let i = 0; i < tt.length; i++) {
    const row = Array.isArray(tt[i]) ? tt[i] : [];
    out[`d${i}`] = row.map(v => String(v));
  }
  return out;
}

function decodeTimetableFromFirestore(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return null;

  if (data.timetableByDay && typeof data.timetableByDay === "object") {
    const byDay = data.timetableByDay;
    const rows = [];
    for (let i = 0; i < timetable.length; i++) {
      const r = Array.isArray(byDay[`d${i}`]) ? byDay[`d${i}`] : null;
      if (!r) return null;
      rows.push(r.map(v => String(v)));
    }
    return rows;
  }

  const hasD0 = Object.prototype.hasOwnProperty.call(data, "d0");
  if (hasD0) {
    const rows = [];
    for (let i = 0; i < timetable.length; i++) {
      const r = Array.isArray(data[`d${i}`]) ? data[`d${i}`] : null;
      if (!r) return null;
      rows.push(r.map(v => String(v)));
    }
    return rows;
  }

  return null;
}

function toMin(t) {
  const [h,m] = t.split(":").map(Number);
  return h * 60 + m;
}

function initFirebase() {
  const hasFirebase = typeof firebase !== "undefined" && firebase.apps && typeof firebase.initializeApp === "function";
  if (!hasFirebase) {
    setSyncHint("Firebase not loaded");
    setAuthUI(null);
    return;
  }

  const firebaseConfig = window.FIREBASE_CONFIG;
  if (!firebaseConfig || !firebaseConfig.apiKey || !firebaseConfig.projectId) {
    setSyncHint("Firebase config missing. Create firebase-config.js");
    setAuthUI(null);
    return;
  }

  try {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    fb.auth = firebase.auth();
    fb.db = firebase.firestore();
    fb.enabled = true;
  } catch (_) {
    setSyncHint("Firebase config missing/invalid");
    setAuthUI(null);
    return;
  }

  fb.auth.onAuthStateChanged(async user => {
    fb.user = user || null;
    fb.profile = null;
    await refreshAuthState();
  });

  wireAuthButtons();
}

function wireAuthButtons() {
  const loginBtn = document.getElementById("loginBtn");
  const signupBtn = document.getElementById("signupBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const saveProfileBtn = document.getElementById("saveProfileBtn");

  if (loginBtn) loginBtn.addEventListener("click", async () => {
    if (!fb.auth) return;
    const email = document.getElementById("authEmail").value.trim();
    const password = document.getElementById("authPassword").value;
    if (!email || !password) {
      setSyncHint("Enter email + password");
      return;
    }
    try {
      await fb.auth.signInWithEmailAndPassword(email, password);
    } catch (e) {
      setSyncHint(e && e.message ? e.message : "Login failed");
    }
  });

  if (signupBtn) signupBtn.addEventListener("click", async () => {
    if (!fb.auth) return;
    const email = document.getElementById("authEmail").value.trim();
    const password = document.getElementById("authPassword").value;
    if (!email || !password) {
      setSyncHint("Enter email + password");
      return;
    }
    try {
      await fb.auth.createUserWithEmailAndPassword(email, password);
    } catch (e) {
      setSyncHint(e && e.message ? e.message : "Signup failed");
    }
  });

  if (logoutBtn) logoutBtn.addEventListener("click", async () => {
    if (!fb.auth) return;
    await fb.auth.signOut();
  });

  if (saveProfileBtn) saveProfileBtn.addEventListener("click", async () => {
    if (!fb.user || !fb.db) {
      setSyncHint("Login first");
      return;
    }
    await saveProfile();
    await refreshAuthState();
  });
}

async function refreshAuthState() {
  if (!fb.enabled) {
    setAuthUI(null);
    return;
  }

  if (!fb.user) {
    setAuthUI(null);
    updateProfileHero();
    enforceLoggedOutDefaults();
    setSyncHint("Login to save and sync your timetable");
    return;
  }

  setAuthUI(fb.user);
  await loadProfile();
  applyProfileToInputs();
  updateProfileHero();
  await loadCloudTimetables();
}

function setAuthUI(user) {
  const authStatus = document.getElementById("authStatus");
  const authForm = document.getElementById("authForm");
  const profileForm = document.getElementById("profileForm");
  const editToggle = document.getElementById("editToggle");

  if (!authStatus || !authForm || !profileForm) return;

  if (!user) {
    authStatus.textContent = "Not signed in";
    authForm.style.display = "grid";
    profileForm.style.display = "none";
    enforceLoggedOutDefaults();
    updateEditControls();
    return;
  }

  authStatus.textContent = `Signed in: ${user.email || user.uid}`;
  authForm.style.display = "none";
  profileForm.style.display = "grid";
  updateEditControls();
}

async function loadProfile() {
  if (!fb.user || !fb.db) return;
  const doc = await fb.db.collection("users").doc(fb.user.uid).get();
  fb.profile = doc.exists ? doc.data() : null;
}

function applyProfileToInputs() {
  const username = document.getElementById("profileUsername");
  const dept = document.getElementById("profileDept");
  const year = document.getElementById("profileYear");
  const sem = document.getElementById("profileSem");
  const role = document.getElementById("profileRole");
  if (!username || !dept || !year || !sem || !role) return;
  username.value = fb.profile && fb.profile.username ? fb.profile.username : "";
  dept.value = fb.profile && fb.profile.dept ? fb.profile.dept : "";
  year.value = fb.profile && fb.profile.year ? fb.profile.year : "";
  sem.value = fb.profile && fb.profile.sem ? fb.profile.sem : "";
  role.value = fb.profile && fb.profile.role ? fb.profile.role : "student";
}

async function saveProfile() {
  const usernameRaw = document.getElementById("profileUsername").value;
  const dept = document.getElementById("profileDept").value.trim().toUpperCase();
  const year = document.getElementById("profileYear").value.trim().toUpperCase();
  const sem = document.getElementById("profileSem").value.trim().toUpperCase();
  const role = document.getElementById("profileRole").value;
  const username = normalizeUsername(usernameRaw);
  if (!dept || !year || !sem) {
    setSyncHint("Fill dept, year, sem");
    return;
  }

  if (!username) {
    setSyncHint("Enter a username (letters/numbers/._, 3-20 chars)");
    return;
  }

  const classKey = `${dept}_${year}_${sem}`;

  try {
    await reserveUsername(username);

    await fb.db.collection("users").doc(fb.user.uid).set({
      email: fb.user.email || "",
      username,
      dept,
      year,
      sem,
      classKey,
      role: role === "teacher" ? "teacher" : "student",
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    setSyncHint(`Profile saved • ${classKey}`);
  } catch (e) {
    setSyncHint(e && e.message ? e.message : "Failed to save profile");
  }
}

function normalizeUsername(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!/^[a-z0-9._]{3,20}$/.test(s)) return "";
  if (s.startsWith(".") || s.endsWith(".")) return "";
  if (s.includes("..")) return "";
  return s;
}

async function reserveUsername(username) {
  if (!fb.db || !fb.user) throw new Error("Not logged in");
  const uid = fb.user.uid;
  const ref = fb.db.collection("usernames").doc(username);
  await fb.db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const data = snap.data() || {};
      if (data.uid && data.uid !== uid) {
        throw new Error("Username already taken");
      }
    }
    tx.set(ref, {
      uid,
      email: fb.user.email || "",
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });
}

async function loadCloudTimetables() {
  if (!fb.user || !fb.db) return;
  const key = classKeyFromProfile(fb.profile);
  if (!key) {
    setSyncHint("Save profile to load class timetable");
    return;
  }

  const classDoc = await fb.db.collection("classTimetables").doc(key).get();
  if (classDoc.exists && classDoc.data()) {
    const decoded = Array.isArray(classDoc.data().timetable)
      ? classDoc.data().timetable
      : decodeTimetableFromFirestore(classDoc.data());

    if (decoded && Array.isArray(decoded)) {
    try {
      localStorage.setItem("tt_class_timetable", JSON.stringify(decoded));
    } catch (_) {
    }
    applyRemoteTimetable(decoded);
    setSyncHint("Loaded class timetable");
    } else {
    setSyncHint("No class timetable yet (teacher can publish)");
    }
  }

  const personalDoc = await fb.db.collection("personalTimetables").doc(fb.user.uid).get();
  if (personalDoc.exists && personalDoc.data()) {
    const decoded = Array.isArray(personalDoc.data().timetable)
      ? personalDoc.data().timetable
      : decodeTimetableFromFirestore(personalDoc.data());

    if (decoded && Array.isArray(decoded)) {
      applyRemoteTimetable(decoded);
      setSyncHint("Loaded personal timetable");
    }
  }

  const publishBtn = document.getElementById("publishClassBtn");
  if (publishBtn) publishBtn.disabled = !(fb.profile && fb.profile.role === "teacher");

  const viewStudentsBtn = document.getElementById("viewStudentsBtn");
  if (viewStudentsBtn) viewStudentsBtn.disabled = !(fb.profile && fb.profile.role === "teacher");
}

function applyRemoteTimetable(remote) {
  if (!Array.isArray(remote) || remote.length !== timetable.length) return;
  for (let i = 0; i < remote.length; i++) {
    if (!Array.isArray(remote[i]) || remote[i].length !== timetable[i].length) return;
  }
  for (let i = 0; i < timetable.length; i++) {
    timetable[i] = remote[i].map(v => String(v));
  }
  saveTimetable();
  buildTable();
  updateUI();
}

async function savePersonalTimetable() {
  try {
    const timetableByDay = encodeTimetableForFirestore(timetable);
    await fb.db.collection("personalTimetables").doc(fb.user.uid).set({
      timetableByDay,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    setSyncHint("Saved personal timetable");
  } catch (e) {
    setSyncHint(e && e.message ? e.message : "Failed to save personal timetable");
    throw e;
  }
}

async function publishClassTimetable() {
  const key = classKeyFromProfile(fb.profile);
  if (!key) {
    setSyncHint("Save profile first");
    return;
  }
  try {
    const timetableByDay = encodeTimetableForFirestore(timetable);
    await fb.db.collection("classTimetables").doc(key).set({
      timetableByDay,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: fb.user.uid
    }, { merge: true });
    setSyncHint(`Published to class • ${key}`);
    published.loadedAt = 0;
    await refreshPublishedTimetables(true);
  } catch (e) {
    setSyncHint(e && e.message ? e.message : "Failed to publish to class");
    throw e;
  }
}

function loadTimetable() {
  const raw = localStorage.getItem("tt_timetable");
  if (!raw) {
    applyBlankTimetable();
    return;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    if (parsed.length !== timetable.length) return;
    for (let i = 0; i < parsed.length; i++) {
      if (!Array.isArray(parsed[i]) || parsed[i].length !== timetable[i].length) return;
    }
    for (let i = 0; i < timetable.length; i++) {
      timetable[i] = parsed[i].map(v => String(v));
    }
  } catch (_) {
  }
}

function applyBlankTimetable() {
  for (let d = 0; d < timetable.length; d++) {
    for (let s = 0; s < times.length; s++) {
      if (s === 5) {
        timetable[d][s] = "Lunch";
      } else if (s === 2 || s === 8) {
        timetable[d][s] = "Break";
      } else {
        timetable[d][s] = "";
      }
    }
  }
}

function saveTimetable() {
  try {
    localStorage.setItem("tt_timetable", JSON.stringify(timetable));
  } catch (_) {
  }
}

function classKeyFromProfile(profile) {
  if (!profile) return null;
  const dept = String(profile.dept || "").trim().toUpperCase();
  const year = String(profile.year || "").trim().toUpperCase();
  const sem = String(profile.sem || "").trim().toUpperCase();
  if (!dept || !year || !sem) return null;
  return `${dept}_${year}_${sem}`;
}

function setSyncHint(text) {
  const el = document.getElementById("syncHint");
  if (!el) return;
  el.textContent = text;
  el.classList.remove("toast");
  void el.offsetWidth;
  el.classList.add("toast");
  clearTimeout(setSyncHint._t);
  setSyncHint._t = setTimeout(() => {
    el.classList.remove("toast");
  }, 1600);
}

function startEditing(td) {
  if (!td) return;
  if (td.classList.contains("pause")) return;
  const row = td.closest("tr");
  if (!row || !row.dataset.day) return;
  const dayIndex = Number(row.dataset.day);
  const slotIndex = Number(td.dataset.slot || "-1");
  if (dayIndex < 0 || dayIndex >= timetable.length) return;
  if (slotIndex < 0 || slotIndex >= times.length) return;

  const current = normalizeSlotLabel(slotIndex, timetable[dayIndex][slotIndex]);
  if (!isEditableLabel(current)) return;

  if (editingCell && editingCell !== td) commitEditing();

  editingCell = td;
  editingKey = { dayIndex, slotIndex };
  editingOriginal = td.textContent;

  td.classList.add("editing");
  td.setAttribute("contenteditable", "true");
  td.setAttribute("spellcheck", "false");
  td.focus();

  const range = document.createRange();
  range.selectNodeContents(td);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  td.addEventListener("blur", commitEditing, { once: true });
  td.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitEditing();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cancelEditing();
    }
  }, { once: true });
}

function cancelEditing() {
  if (!editingCell) return;
  editingCell.textContent = editingOriginal;
  cleanupEditing();
}

function commitEditing() {
  if (!editingCell || !editingKey) return;
  const raw = editingCell.textContent;
  const nextLabel = String(raw || "").trim().replace(/\s+/g, " ");
  if (nextLabel && isEditableLabel(nextLabel)) {
    const { dayIndex, slotIndex } = editingKey;
    const span = Number(editingCell.dataset.span || "1");
    for (let k = 0; k < span; k++) {
      const idx = slotIndex + k;
      if (idx >= 0 && idx < timetable[dayIndex].length) {
        const prev = normalizeSlotLabel(idx, timetable[dayIndex][idx]);
        if (!isPauseLabel(prev)) timetable[dayIndex][idx] = nextLabel;
      }
    }
    saveTimetable();
  } else {
    editingCell.textContent = editingOriginal;
  }

  cleanupEditing();
  buildTable();
  updateUI();
}

function cleanupEditing() {
  if (!editingCell) return;
  editingCell.classList.remove("editing");
  editingCell.removeAttribute("contenteditable");
  editingCell.removeAttribute("spellcheck");
  editingCell = null;
  editingKey = null;
  editingOriginal = null;
}

function nowMin() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

function formatClock(d = new Date()) {
  const rawH = d.getHours();
  const h12 = ((rawH + 11) % 12) + 1;
  const m = d.getMinutes().toString().padStart(2, "0");
  const ap = rawH >= 12 ? "PM" : "AM";
  return `${h12}:${m} ${ap}`;
}

function formatRange(start, end) {
  return `${formatTime12(start)} - ${formatTime12(end)}`;
}

function formatTime12(t) {
  const [hStr, mStr] = t.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  const h12 = ((h + 11) % 12) + 1;
  const ap = h >= 12 ? "PM" : "AM";
  return `${h12}:${m.toString().padStart(2, "0")} ${ap}`;
}

function durationText(start, end) {
  const total = Math.round((toMin(end) - toMin(start)) * 60);
  const minutes = Math.floor(total / 60);
  return `${minutes}m`;
}

function periodProgress(start, end, now) {
  const total = toMin(end) - toMin(start);
  const elapsed = Math.min(Math.max(now - toMin(start), 0), total);
  const percent = total > 0 ? (elapsed / total) * 100 : 0;
  return { elapsed, total, percent };
}

function normalizeSlotLabel(slotIndex, value) {
  const v = String(value || "").trim();
  const isBreak = v.toLowerCase().includes("break");
  if (!isBreak) return v;
  if (slotIndex === 5) return "Lunch";
  return "Break";
}

function isEditableLabel(v) {
  const s = String(v || "").trim();
  return !isPauseLabel(s);
}

function isPauseLabel(v) {
  const s = String(v || "").toLowerCase();
  return s === "break" || s === "lunch";
}

function buildHeaderLabels() {
  let p = 0;
  return times.map((_, i) => {
    const sample = normalizeSlotLabel(i, timetable[0][i]);
    if (isPauseLabel(sample)) return sample;
    p += 1;
    return `${p}`;
  });
}

function computeVerticalMergeSlots(normalized) {
  const slots = new Set();
  for (let s = 0; s < times.length; s++) {
    const first = normalized[0][s];
    if (!isPauseLabel(first)) continue;
    let allSame = true;
    for (let d = 1; d < normalized.length; d++) {
      if (normalized[d][s] !== first) {
        allSame = false;
        break;
      }
    }
    if (allSame) slots.add(s);
  }
  return slots;
}

function keyFor(dayIndex, slotIndex) {
  return `${dayIndex}-${slotIndex}`;
}

function currentPeriodIndex() {
  const n = nowMin();
  for (let i = 0; i < times.length; i++) {
    if (n >= toMin(times[i][0]) && n < toMin(times[i][1])) return i;
  }
  return -1;
}

function buildTable() {
  const table = document.getElementById("table");
  table.innerHTML = "";

  cellMap = new Map();
  activeKey = null;
  lastScrollKey = null;

  const normalized = timetable.map(row => row.map((v, i) => normalizeSlotLabel(i, v)));
  const headerLabels = buildHeaderLabels();
  const verticalMergeSlots = computeVerticalMergeSlots(normalized);

  const header = document.createElement("tr");
  header.innerHTML = "<th>Day</th>" + times.map((_, i) => {
    const top = headerLabels[i];
    return `<th><div class="th-top">${top}</div></th>`;
  }).join("");
  table.appendChild(header);

  normalized.forEach((row, dayIndex) => {
    const tr = document.createElement("tr");
    tr.dataset.day = String(dayIndex);
    tr.innerHTML = `<th>${days[dayIndex]}</th>`;
    table.appendChild(tr);

    let s = 0;
    while (s < row.length) {
      const label = row[s];

      if (dayIndex !== 0 && verticalMergeSlots.has(s)) {
        s += 1;
        continue;
      }

      let span = 1;
      while (label && s + span < row.length && row[s + span] === label && !verticalMergeSlots.has(s + span)) {
        span += 1;
      }

      const td = document.createElement("td");
      td.textContent = label;
      td.dataset.slot = String(s);
      td.dataset.span = String(span);
      td.classList.toggle("pause", isPauseLabel(label));

      if (span > 1) td.colSpan = span;
      if (dayIndex === 0 && verticalMergeSlots.has(s)) td.rowSpan = normalized.length;

      tr.appendChild(td);

      if (dayIndex === 0 && verticalMergeSlots.has(s)) {
        for (let d = 0; d < normalized.length; d++) {
          cellMap.set(keyFor(d, s), td);
        }
      } else {
        for (let k = 0; k < span; k++) {
          cellMap.set(keyFor(dayIndex, s + k), td);
        }
      }

      s += span;
    }
  });
}

function updateUI() {
  const now = new Date();
  const dayIndex = now.getDay() - 1;
  const periodIndex = currentPeriodIndex();
  const status = document.getElementById("status");
  const clock = document.getElementById("clock");
  const currentTitle = document.getElementById("currentTitle");
  const currentSub = document.getElementById("currentSub");
  const periodMeta = document.getElementById("periodMeta");
  const progressFill = document.getElementById("progressFill");
  const progressMeta = document.getElementById("progressMeta");

  clock.textContent = formatClock(now);

  if (dayIndex < 0 || dayIndex > 5 || periodIndex === -1) {
    status.textContent = "No class now";
    currentTitle.textContent = "No class";
    currentSub.textContent = "--";
    periodMeta.textContent = "--";
    progressFill.style.width = "0%";
    progressMeta.textContent = "Outside class hours";
    if (activeKey) {
      const prev = cellMap.get(activeKey);
      if (prev) prev.classList.remove("active", "break");
      activeKey = null;
    }
    return;
  }

  const subjectLabel = normalizeSlotLabel(periodIndex, timetable[dayIndex][periodIndex]);
  const subject = subjectLabel || "Free";
  const isBreak = isPauseLabel(subjectLabel);
  const [start, end] = times[periodIndex];
  const nowMinutes = nowMin();
  const { elapsed, total, percent } = periodProgress(start, end, nowMinutes);
  const remaining = Math.max(total - elapsed, 0);
  const remainingMin = Math.floor(remaining);

  const k = keyFor(dayIndex, periodIndex);
  const cell = cellMap.get(k);
  const periodChanged = k !== activeKey;
  if (periodChanged) {
    if (activeKey) {
      const prev = cellMap.get(activeKey);
      if (prev) prev.classList.remove("active", "break");
    }
    if (cell) {
      cell.classList.add("active");
      cell.classList.toggle("break", isBreak);
    }
    activeKey = k;
    onPeriodBoundary(dayIndex, periodIndex, subject);
  } else {
    if (cell) cell.classList.toggle("break", isBreak);
  }

  const todayRow = document.querySelector("tr.today");
  if (todayRow) todayRow.classList.remove("today");
  const row = document.querySelector(`tr[data-day="${dayIndex}"]`);
  if (row) row.classList.add("today");

  if (cell && lastScrollKey !== k) {
    cell.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    lastScrollKey = k;
  }

  let periodNumber = 0;
  for (let i = 0; i <= periodIndex; i++) {
    const label = normalizeSlotLabel(i, timetable[dayIndex][i]);
    if (!isPauseLabel(label)) periodNumber += 1;
  }
  const periodTag = isPauseLabel(subject) ? subject : `Hour ${periodNumber}`;

  status.textContent = `${days[dayIndex]} - ${periodTag} - ${subject}`;
  currentTitle.textContent = subject;
  currentSub.textContent = `${days[dayIndex]} • ${periodTag}`;
  periodMeta.textContent = `${formatRange(start, end)} • ${durationText(start, end)}`;
  progressFill.style.width = `${percent.toFixed(2)}%`;
  const elapsedMin = Math.floor(elapsed);
  const next = nextUp(dayIndex, periodIndex);
  progressMeta.textContent = `${elapsedMin}m elapsed • ${remainingMin}m left${next ? ` • Next: ${next}` : ""}`;
}

function onPeriodBoundary(dayIndex, periodIndex, subject) {
  if (settings.vibrate) triggerVibrate();
  if (settings.notify) triggerNotify(dayIndex, periodIndex, subject);
}

function triggerVibrate() {
  if (!("vibrate" in navigator)) return;
  navigator.vibrate([60, 80, 60]);
}

function triggerNotify(dayIndex, periodIndex, subject) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  const [start, end] = times[periodIndex];
  const title = subject;
  const body = `${days[dayIndex]} • ${formatRange(start, end)}`;
  try {
    new Notification(title, { body });
  } catch (_) {
  }
}

function nextUp(dayIndex, currentSlot) {
  for (let i = currentSlot + 1; i < times.length; i++) {
    const label = normalizeSlotLabel(i, timetable[dayIndex][i]);
    if (!label) continue;
    return `${label} (${formatTime12(times[i][0])})`;
  }
  return null;
}

function scheduleNextBoundary() {
  if (boundaryTimer) clearTimeout(boundaryTimer);

  const n = nowMin();
  let next = null;

  for (let t of times) {
    const end = toMin(t[1]);
    if (end > n) {
      next = end;
      break;
    }
  }

  if (next !== null) {
    boundaryTimer = setTimeout(() => {
      updateUI();
      scheduleNextBoundary();
    }, (next - n) * 60000);
  }
}

function initTabs() {
  const tabButtons = Array.from(document.querySelectorAll(".tab-btn"));
  const views = Array.from(document.querySelectorAll(".tab-view"));

  if (!tabButtons.length || !views.length) return;

  const activate = (tabId, { force = false } = {}) => {
    if (!force && currentTab === tabId) return;
    currentTab = tabId;

    tabButtons.forEach(btn => {
      const isActive = (btn.dataset.tab || "") === tabId;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    views.forEach(view => {
      const isActive = view.id === tabId;
      view.classList.toggle("active", isActive);
      view.setAttribute("aria-hidden", isActive ? "false" : "true");
    });

    if (tabId === "tabExplore") {
      if (!published.loadedAt) {
        refreshPublishedTimetables(false);
      } else {
        renderPublishedTimetables();
      }
    }

    if (tabId === "tabProfile") {
      updateProfileHero();
    }
  };

  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => activate(btn.dataset.tab || "tabHome", { force: true }));
  });

  activateTabFn = (tabId, opts) => activate(tabId, opts);
  activate(currentTab, { force: true });
}

function initHomeView() {
  const tableEditBtns = Array.from(document.querySelectorAll(".table-edit-btn"));
  if (tableEditBtns.length) {
    tableEditBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        setEditMode(!settings.edit);
      });
    });
  }

  updateEditControls();
}

function initControls() {
  const vibrateToggle = document.getElementById("vibrateToggle");
  const notifyToggle = document.getElementById("notifyToggle");
  const editToggle = document.getElementById("editToggle");
  const savePersonalBtn = document.getElementById("savePersonalBtn");
  const publishClassBtn = document.getElementById("publishClassBtn");

  setToggleState(vibrateToggle, settings.vibrate);
  setToggleState(notifyToggle, settings.notify);
  setToggleState(editToggle, settings.edit);

  if (vibrateToggle) vibrateToggle.addEventListener("click", () => {
    settings.vibrate = !settings.vibrate;
    setToggleState(vibrateToggle, settings.vibrate);
    saveSettings();
    if (settings.vibrate) triggerVibrate();
  });

  if (notifyToggle) notifyToggle.addEventListener("click", async () => {
    if (!settings.notify) {
      if ("Notification" in window) {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") {
          settings.notify = false;
          setToggleState(notifyToggle, false);
          saveSettings();
          return;
        }
      } else {
        return;
      }
    }
    settings.notify = !settings.notify;
    setToggleState(notifyToggle, settings.notify);
    saveSettings();
    if (settings.notify) {
      const now = new Date();
      const dayIndex = now.getDay() - 1;
      const periodIndex = currentPeriodIndex();
      if (dayIndex >= 0 && dayIndex <= 5 && periodIndex !== -1) {
        const subjectLabel = normalizeSlotLabel(periodIndex, timetable[dayIndex][periodIndex]);
        triggerNotify(dayIndex, periodIndex, subjectLabel || "Free");
      }
    }
  });

  if (editToggle) editToggle.addEventListener("click", () => {
    setEditMode(!settings.edit);
  });

  if (savePersonalBtn) savePersonalBtn.addEventListener("click", async () => {
    if (!fb.user || !fb.db) {
      setSyncHint("Login to save personal timetable");
      return;
    }
    try {
      await savePersonalTimetable();
    } catch (_) {
    }
  });

  if (publishClassBtn) publishClassBtn.addEventListener("click", async () => {
    if (!fb.user || !fb.db) {
      setSyncHint("Login to publish class timetable");
      return;
    }
    if (!fb.profile || fb.profile.role !== "teacher") {
      setSyncHint("Only teachers can publish to class");
      return;
    }
    try {
      await publishClassTimetable();
    } catch (_) {
    }
  });
}

function initExplore() {
  const refresh = document.getElementById("homeRefresh");
  const search = document.getElementById("homeSearch");
  const sort = document.getElementById("homeSort");

  if (refresh) refresh.addEventListener("click", async () => {
    await refreshPublishedTimetables(true);
  });

  if (sort) {
    sort.value = published.sort;
    sort.addEventListener("change", () => {
      published.sort = sort.value || "recent";
      renderPublishedTimetables();
    });
  }

  if (search) {
    search.value = published.query;
    search.addEventListener("input", () => {
      published.query = search.value || "";
      renderPublishedTimetables();
    });
  }

  renderPublishedTimetables();
}

function setEditMode(on, options = {}) {
  const next = Boolean(on);
  const { silentHint = false, force = false } = options;
  if (!force && next === settings.edit) {
    updateEditControls();
    return;
  }

  settings.edit = next;
  saveSettings();
  if (!next) commitEditing();
  updateEditControls();
  if (next && !silentHint && (!fb.enabled || !fb.user)) {
    setSyncHint("Edit mode enabled (local only). Login to sync.");
  }
}

function updateEditControls() {
  const editToggle = document.getElementById("editToggle");
  const tableEditBtns = Array.from(document.querySelectorAll(".table-edit-btn"));

  setToggleState(editToggle, settings.edit);

  tableEditBtns.forEach(btn => {
    btn.classList.toggle("on", settings.edit);
    btn.setAttribute("aria-label", settings.edit ? "Disable editing" : "Enable editing");
    btn.title = settings.edit ? "Editing enabled" : "Enable editing";
  });

  document.body.classList.toggle("editing-active", settings.edit);
}

function enforceLoggedOutDefaults() {
  if (fb.user) return;
  setEditMode(false, { silentHint: true, force: true });
}

function updateProfileHero() {
  const nameEl = document.getElementById("profileHeroName");
  const emailEl = document.getElementById("profileHeroEmail");
  const avatarEl = document.getElementById("profileAvatar");
  const initialEl = document.getElementById("profileAvatarInitial");

  if (!nameEl || !emailEl || !avatarEl || !initialEl) return;

  let displayName = "Guest";
  let detail = "Sign in to personalise your timetable";

  if (fb.user) {
    const profileName = fb.profile && fb.profile.username ? fb.profile.username : "";
    if (profileName) {
      displayName = profileName;
    } else if (fb.user.displayName) {
      displayName = fb.user.displayName;
    } else if (fb.user.email) {
      displayName = fb.user.email.split("@")[0];
    }
    const classKey = fb.profile && fb.profile.classKey ? fb.profile.classKey : null;
    if (classKey) {
      detail = `${classKey} • ${fb.profile.role === "teacher" ? "Teacher" : "Student"}`;
    } else {
      detail = fb.user.email || fb.user.uid;
    }
  }

  nameEl.textContent = displayName;
  emailEl.textContent = detail;

  const initial = (displayName || "?").trim().charAt(0).toUpperCase() || "?";
  initialEl.textContent = initial;
  avatarEl.dataset.initial = initial;
}

function init() {
  loadSettings();
  loadTimetable();
  enforceLoggedOutDefaults();
  buildTable();
  initTabs();
  initHomeView();
  initControls();
  initExplore();
  initStudents();
  initFirebase();
  updateUI();
  scheduleNextBoundary();
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(updateUI, 2000);

  document.getElementById("table").addEventListener("click", event => {
    const td = event.target.closest("td");
    if (!td) return;

    if (settings.edit) {
      startEditing(td);
      return;
    }

    if (selectedCell && selectedCell !== td) selectedCell.classList.remove("selected");
    td.classList.add("selected");
    selectedCell = td;

    const rect = td.getBoundingClientRect();
    const ripple = document.createElement("span");
    ripple.className = "ripple";
    const size = Math.max(rect.width, rect.height);
    ripple.style.width = `${size}px`;
    ripple.style.height = `${size}px`;
    ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
    td.appendChild(ripple);
    setTimeout(() => ripple.remove(), 520);
  });

  document.addEventListener("pointerdown", event => {
    if (!editingCell) return;
    const insideTable = Boolean(event.target.closest("#table"));
    if (!insideTable) commitEditing();
  });

  updateEditControls();
  initTheme();
}

function initStudents() {
  const viewBtn = document.getElementById("viewStudentsBtn");
  const screen = document.getElementById("studentsScreen");
  const back = document.getElementById("studentsBack");
  const refresh = document.getElementById("studentsRefresh");
  const search = document.getElementById("studentsSearch");
  const sort = document.getElementById("studentsSort");

  if (!viewBtn || !screen) return;

  let state = { loadedAt: 0, items: [], query: "", sort: "username" };

  function open() {
    screen.classList.add("show");
    screen.setAttribute("aria-hidden", "false");
    if (sort) sort.value = state.sort;
    if (search) search.value = state.query;
    refreshList(false);
  }

  function close() {
    screen.classList.remove("show");
    screen.setAttribute("aria-hidden", "true");
  }

  viewBtn.addEventListener("click", () => {
    if (!fb.user || !fb.db) {
      setSyncHint("Login to view students");
      return;
    }
    if (!fb.profile || fb.profile.role !== "teacher") {
      setSyncHint("Only teachers can view students");
      return;
    }
    open();
  });

  if (back) back.addEventListener("click", () => close());
  if (refresh) refresh.addEventListener("click", async () => {
    await refreshList(true);
  });

  if (sort) sort.addEventListener("change", () => {
    state.sort = sort.value || "username";
    render();
  });

  if (search) search.addEventListener("input", () => {
    state.query = search.value || "";
    render();
  });

  async function refreshList(force) {
    const meta = document.getElementById("studentsMeta");
    const list = document.getElementById("studentsList");
    if (!meta || !list) return;

    if (!fb.user || !fb.db || !fb.profile) {
      meta.textContent = "Not available";
      list.innerHTML = "";
      return;
    }

    const classKey = fb.profile.classKey || classKeyFromProfile(fb.profile);
    if (!classKey) {
      meta.textContent = "Save profile first";
      list.innerHTML = "";
      return;
    }

    const now = Date.now();
    if (!force && state.items.length && now - state.loadedAt < 30_000) {
      render();
      return;
    }

    meta.textContent = "Loading…";
    try {
      const snap = await fb.db.collection("users").where("classKey", "==", classKey).where("role", "==", "student").get();
      const items = [];
      snap.forEach(doc => {
        const d = doc.data() || {};
        items.push({
          uid: doc.id,
          username: String(d.username || ""),
          email: String(d.email || "")
        });
      });
      state.items = items;
      state.loadedAt = now;
      render();
    } catch (e) {
      meta.textContent = e && e.message ? e.message : "Failed to load";
      list.innerHTML = "";
    }
  }

  function render() {
    const meta = document.getElementById("studentsMeta");
    const list = document.getElementById("studentsList");
    if (!meta || !list) return;

    const q = state.query.trim().toLowerCase();
    let items = state.items.slice();
    if (q) {
      items = items.filter(it => {
        const hay = `${it.username} ${it.email}`.toLowerCase();
        return hay.includes(q);
      });
    }

    items.sort((a, b) => {
      if (state.sort === "email") return (a.email || "").localeCompare(b.email || "");
      return (a.username || "").localeCompare(b.username || "") || (a.email || "").localeCompare(b.email || "");
    });

    list.innerHTML = "";
    const group = document.createElement("div");
    group.className = "students-group";

    const head = document.createElement("div");
    head.className = "students-group-head";
    const title = document.createElement("div");
    title.className = "students-group-title";
    title.textContent = "Students";
    const sub = document.createElement("div");
    sub.className = "students-group-sub";
    sub.textContent = fb.profile && fb.profile.classKey ? fb.profile.classKey : "";
    head.appendChild(title);
    head.appendChild(sub);
    group.appendChild(head);

    const itemsWrap = document.createElement("div");
    itemsWrap.className = "students-items";

    for (const it of items) {
      const row = document.createElement("div");
      row.className = "students-item";

      const main = document.createElement("div");
      main.className = "students-item-main";

      const t = document.createElement("div");
      t.className = "students-item-title";
      t.textContent = it.username || "(no username)";

      const s = document.createElement("div");
      s.className = "students-item-sub";
      s.textContent = it.email;

      const chip = document.createElement("div");
      chip.className = "students-item-chip";
      chip.textContent = "Student";

      main.appendChild(t);
      main.appendChild(s);
      row.appendChild(main);
      row.appendChild(chip);

      itemsWrap.appendChild(row);
    }

    group.appendChild(itemsWrap);
    list.appendChild(group);
    meta.textContent = `${items.length} students`;
  }
}

function parseClassKey(classKey) {
  const raw = String(classKey || "");
  const parts = raw.split("_");
  return {
    raw,
    dept: parts[0] ? parts[0].toUpperCase() : "",
    year: parts[1] ? parts[1].toUpperCase() : "",
    sem: parts[2] ? parts[2].toUpperCase() : ""
  };
}

function toMillis(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.seconds === "number") return ts.seconds * 1000;
  return 0;
}

async function refreshPublishedTimetables(force) {
  const meta = document.getElementById("homeMeta");
  const list = document.getElementById("homeList");

  if (!meta || !list) return;

  if (!fb.enabled || !fb.db) {
    meta.textContent = "Firebase not configured";
    list.innerHTML = "";
    return;
  }

  const now = Date.now();
  if (!force && published.items.length && now - published.loadedAt < 30_000) {
    renderPublishedTimetables();
    return;
  }

  meta.textContent = "Loading…";
  try {
    const snap = await fb.db.collection("classTimetables").get();
    const items = [];
    snap.forEach(doc => {
      const data = doc.data() || {};
      const decoded = Array.isArray(data.timetable) ? data.timetable : decodeTimetableFromFirestore(data);
      if (!decoded) return;
      const parsed = parseClassKey(doc.id);
      items.push({
        id: doc.id,
        dept: parsed.dept,
        year: parsed.year,
        sem: parsed.sem,
        updatedAt: data.updatedAt || null,
        updatedBy: data.updatedBy || "",
        timetable: decoded
      });
    });
    published.items = items;
    published.loadedAt = now;
    renderPublishedTimetables();
  } catch (e) {
    meta.textContent = e && e.message ? e.message : "Failed to load";
    list.innerHTML = "";
  }
}

function renderPublishedTimetables() {
  const meta = document.getElementById("homeMeta");
  const list = document.getElementById("homeList");
  if (!meta || !list) return;

  if (!fb.enabled || !fb.db) {
    meta.textContent = "Firebase not configured";
    list.innerHTML = "";
    return;
  }

  const q = published.query.trim().toLowerCase();
  let items = published.items.slice();
  if (q) {
    items = items.filter(it => {
      const hay = `${it.dept} ${it.year} ${it.sem} ${it.id}`.toLowerCase();
      return hay.includes(q);
    });
  }

  const sortMode = published.sort || "recent";
  items.sort((a, b) => {
    if (sortMode === "dept") return (a.dept || "").localeCompare(b.dept || "") || a.id.localeCompare(b.id);
    if (sortMode === "year") return (a.year || "").localeCompare(b.year || "") || a.id.localeCompare(b.id);
    if (sortMode === "sem") return (a.sem || "").localeCompare(b.sem || "") || a.id.localeCompare(b.id);
    const am = toMillis(a.updatedAt);
    const bm = toMillis(b.updatedAt);
    return (bm - am) || a.id.localeCompare(b.id);
  });

  const grouped = new Map();
  for (const it of items) {
    const dept = it.dept || "UNKNOWN";
    if (!grouped.has(dept)) grouped.set(dept, []);
    grouped.get(dept).push(it);
  }

  const deptKeys = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b));
  list.innerHTML = "";

  let count = 0;
  for (const dept of deptKeys) {
    const deptItems = grouped.get(dept) || [];
    count += deptItems.length;

    const group = document.createElement("div");
    group.className = "explore-group";

    const head = document.createElement("div");
    head.className = "explore-group-head";

    const title = document.createElement("div");
    title.className = "explore-group-title";
    title.textContent = dept;

    const sub = document.createElement("div");
    sub.className = "explore-group-sub";
    sub.textContent = `College • ${deptItems.length} published`;

    head.appendChild(title);
    head.appendChild(sub);
    group.appendChild(head);

    const itemsWrap = document.createElement("div");
    itemsWrap.className = "explore-items";

    for (const it of deptItems) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "explore-item";

      const main = document.createElement("div");
      main.className = "explore-item-main";

      const t = document.createElement("div");
      t.className = "explore-item-title";
      t.textContent = `${it.year || ""} ${it.sem || ""}`.trim() || it.id;

      const s = document.createElement("div");
      s.className = "explore-item-sub";
      s.textContent = `${it.dept}_${it.year || ""}_${it.sem || ""}`;

      const chip = document.createElement("div");
      chip.className = "explore-item-chip";
      const ms = toMillis(it.updatedAt);
      chip.textContent = ms ? new Date(ms).toLocaleDateString() : "Published";

      main.appendChild(t);
      main.appendChild(s);

      btn.appendChild(main);
      btn.appendChild(chip);

      btn.addEventListener("click", () => {
        applyRemoteTimetable(it.timetable);
        try {
          localStorage.setItem("tt_class_timetable", JSON.stringify(it.timetable));
        } catch (_) {
        }
        buildTable();
        updateUI();
        setSyncHint(`Loaded published timetable: ${it.id}`);
        if (typeof activateTabFn === "function") activateTabFn("tabHome", { force: true });
      });

      itemsWrap.appendChild(btn);
    }

    group.appendChild(itemsWrap);
    list.appendChild(group);
  }

  meta.textContent = `${count} published timetables`;
}

function initTheme() {
  const toggle = document.getElementById("themeToggle");
  const stored = settings.theme;
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const initial = stored || (prefersDark ? "dark" : "light");
  setTheme(initial, false);
  setToggleState(toggle, initial === "dark");
  toggle.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    setTheme(next, true);
    settings.theme = next;
    setToggleState(toggle, next === "dark");
    saveSettings();
  });
}

function setTheme(theme, animate) {
  if (animate) document.documentElement.classList.add("theme-anim");
  document.documentElement.dataset.theme = theme;
  if (animate) {
    setTimeout(() => document.documentElement.classList.remove("theme-anim"), 420);
  }
}

function loadSettings() {
  const raw = localStorage.getItem("tt_settings");
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      settings = {
        theme: parsed.theme || settings.theme,
        vibrate: Boolean(parsed.vibrate),
        notify: Boolean(parsed.notify),
        edit: Boolean(parsed.edit)
      };
    } catch (_) {
    }
  }
}

function saveSettings() {
  localStorage.setItem("tt_settings", JSON.stringify(settings));
}

function setToggleState(btn, on) {
  if (!btn) return;
  btn.classList.toggle("on", on);
}

function initDrawer() {
  const btn = document.getElementById("settingsBtn");
  const drawer = document.getElementById("settingsDrawer");
  const backdrop = document.getElementById("settingsBackdrop");
  const close = document.getElementById("settingsClose");
  const vibrateToggle = document.getElementById("vibrateToggle");
  const notifyToggle = document.getElementById("notifyToggle");
  const editToggle = document.getElementById("editToggle");
  const savePersonalBtn = document.getElementById("savePersonalBtn");
  const publishClassBtn = document.getElementById("publishClassBtn");

  setToggleState(vibrateToggle, settings.vibrate);
  setToggleState(notifyToggle, settings.notify);
  setToggleState(editToggle, settings.edit);

  btn.addEventListener("click", () => openDrawer());
  close.addEventListener("click", () => closeDrawer());
  backdrop.addEventListener("click", () => closeDrawer());
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeDrawer();
  });

  if (vibrateToggle) vibrateToggle.addEventListener("click", () => {
    settings.vibrate = !settings.vibrate;
    setToggleState(vibrateToggle, settings.vibrate);
    saveSettings();
    if (settings.vibrate) triggerVibrate();
  });

  if (notifyToggle) notifyToggle.addEventListener("click", async () => {
    if (!settings.notify) {
      if ("Notification" in window) {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") {
          settings.notify = false;
          setToggleState(notifyToggle, false);
          saveSettings();
          return;
        }
      } else {
        return;
      }
    }
    settings.notify = !settings.notify;
    setToggleState(notifyToggle, settings.notify);
    saveSettings();
    if (settings.notify) {
      const now = new Date();
      const dayIndex = now.getDay() - 1;
      const periodIndex = currentPeriodIndex();
      if (dayIndex >= 0 && dayIndex <= 5 && periodIndex !== -1) {
        const subjectLabel = normalizeSlotLabel(periodIndex, timetable[dayIndex][periodIndex]);
        triggerNotify(dayIndex, periodIndex, subjectLabel || "Free");
      }
    }
  });

  if (editToggle) editToggle.addEventListener("click", () => {
    settings.edit = !settings.edit;
    setToggleState(editToggle, settings.edit);
    saveSettings();
    if (!settings.edit) commitEditing();
    if (settings.edit && (!fb.enabled || !fb.user)) {
      setSyncHint("Edit mode enabled (local only). Login to sync.");
    }
  });

  if (savePersonalBtn) savePersonalBtn.addEventListener("click", async () => {
    if (!fb.user || !fb.db) {
      setSyncHint("Login to save personal timetable");
      return;
    }
    try {
      await savePersonalTimetable();
    } catch (_) {
    }
  });

  if (publishClassBtn) publishClassBtn.addEventListener("click", async () => {
    if (!fb.user || !fb.db) {
      setSyncHint("Login to publish class timetable");
      return;
    }
    if (!fb.profile || fb.profile.role !== "teacher") {
      setSyncHint("Only teachers can publish to class");
      return;
    }
    try {
      await publishClassTimetable();
    } catch (_) {
    }
  });

  function openDrawer() {
    drawer.classList.add("show");
    backdrop.classList.add("show");
    drawer.setAttribute("aria-hidden", "false");
    backdrop.setAttribute("aria-hidden", "false");
  }

  function closeDrawer() {
    drawer.classList.remove("show");
    backdrop.classList.remove("show");
    drawer.setAttribute("aria-hidden", "true");
    backdrop.setAttribute("aria-hidden", "true");
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    updateUI();
    scheduleNextBoundary();
  }
});

window.onload = init;
