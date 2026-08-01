const days = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const cat = document.getElementById("cat");

cat.onload = () => {
    cat.classList.add("loaded");
};

cat.onerror = () => {
    console.error("Failed to load cat_lofi.webp");
    // Optional fallback
    // cat.src = "./assets/fallback.png";
};
const timesDefault = [
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

const timesFY = [
  ["08:45","09:35"],
  ["09:35","10:25"],
  ["10:25","11:15"],
  ["11:15","11:30"],
  ["11:30","12:20"],
  ["12:20","13:10"],
  ["13:10","13:50"],
  ["13:50","14:40"],
  ["14:40","15:30"],
  ["15:30","16:20"]
];

const timesBPT = [
  ["09:00","09:50"],
  ["09:50","10:40"],
  ["10:40","11:00"],
  ["11:00","11:50"],
  ["11:50","12:40"],
  ["12:40","13:30"],
  ["13:30","14:15"],
  ["14:15","15:05"],
  ["15:05","15:55"],
  ["15:55","16:45"]
];

function blankTimetableLike(timesArr, pauseLabelsBySlot) {
  return days.map(() => timesArr.map((_, i) => pauseLabelsBySlot[i] || ""));
}

const templates = {
  default: {
    id: "default",
    times: timesDefault,
    blank: () => blankTimetableLike(timesDefault, { 2: "Break", 5: "Lunch", 8: "Break" })
  },
  fy: {
    id: "fy",
    times: timesFY,
    blank: () => blankTimetableLike(timesFY, { 3: "Break", 6: "Lunch" })
  },
  bpt: {
    id: "bpt",
    times: timesBPT,
    blank: () => blankTimetableLike(timesBPT, { 2: "Break", 6: "Lunch" })
  }
};

let activeTemplateId = "default";
let timetable = templates.default.blank();

function loadTemplateFromLocal() {
  try {
    const raw = String(localStorage.getItem("tt_template") || "").trim().toLowerCase();
    if (raw && templates[raw]) activeTemplateId = raw;
  } catch (_) {
  }
}

function getActiveTemplate() {
  return templates[activeTemplateId] || templates.default;
}

function getActiveTimes() {
  return getActiveTemplate().times;
}

function getActiveBlankTimetable() {
  return getActiveTemplate().blank();
}

function computeAutoTemplateId(profile) {
  const dept = String(profile && profile.dept ? profile.dept : "").trim().toUpperCase();
  const year = String(profile && profile.year ? profile.year : "").trim().toUpperCase();
  const sem = String(profile && profile.sem ? profile.sem : "").trim().toUpperCase();
  if (dept === "BPT") return "bpt";
  if (year === "I" && (sem === "I" || sem === "II")) return "fy";
  return "default";
}

function resolveTemplateId(profile) {
  const override = String(profile && profile.templateId ? profile.templateId : "").trim().toLowerCase();
  if (override && templates[override]) return override;
  return computeAutoTemplateId(profile);
}

function setActiveTemplate(templateId, { resetTimetable = false } = {}) {
  const next = templates[templateId] ? templateId : "default";
  if (next === activeTemplateId && !resetTimetable) return;
  activeTemplateId = next;
  try {
    localStorage.setItem("tt_template", activeTemplateId);
  } catch (_) {
  }
  if (resetTimetable) {
    timetable = getActiveBlankTimetable();
    saveTimetable();
  }
  buildTable();
  updateUI();
  updateHomeEmptyHint();
}

function legacyClassKeyFromProfile(profile) {
  if (!profile) return null;
  const dept = String(profile.dept || "").trim().toUpperCase();
  const year = String(profile.year || "").trim().toUpperCase();
  const sem = String(profile.sem || "").trim().toUpperCase();
  if (!dept || !year || !sem) return null;
  return `${dept}_${year}_${sem}`;
}

async function fetchClassTimetableDoc(key) {
  if (!key || !fb.db) return null;
  try {
    const doc = await fb.db.collection("classTimetables").doc(key).get();
    if (!doc.exists) return null;
    return doc;
  } catch (_) {
    return null;
  }
}

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

let profileDirty = false;

let currentTab = "tabHome";
let activateTabFn = null;

let activeClassKey = null;

function allowedSemsForYear(year) {
  const y = String(year || "").trim().toUpperCase();
  const map = {
    I: ["I", "II"],
    II: ["III", "IV"],
    III: ["V", "VI"],
    IV: ["VII", "VIII"]
  };
  return map[y] || ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];
}

function updateSemOptions() {
  const yearEl = document.getElementById("profileYear");
  const semEl = document.getElementById("profileSem");
  if (!yearEl || !semEl) return;

  const current = String(semEl.value || "").trim().toUpperCase();
  const allowed = allowedSemsForYear(yearEl.value);

  semEl.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Sem";
  semEl.appendChild(placeholder);

  allowed.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    semEl.appendChild(opt);
  });

  semEl.value = allowed.includes(current) ? current : "";
}

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
    const baseDays = days.length;
    for (let i = 0; i < baseDays; i++) {
      const r = Array.isArray(byDay[`d${i}`]) ? byDay[`d${i}`] : null;
      if (!r) return null;
      rows.push(r.map(v => String(v)));
    }
    return rows;
  }

  const hasD0 = Object.prototype.hasOwnProperty.call(data, "d0");
  if (hasD0) {
    const rows = [];
    const baseDays = days.length;
    for (let i = 0; i < baseDays; i++) {
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

  const updateSaveProfileState = () => {
    if (!saveProfileBtn) return;
    saveProfileBtn.classList.toggle("is-unsaved", profileDirty);
    saveProfileBtn.classList.toggle("is-saved", !profileDirty);
  };

  const markProfileDirty = () => {
    profileDirty = true;
    updateSaveProfileState();
  };

  const wireProfileDirtyListeners = () => {
    const username = document.getElementById("profileUsername");
    const dept = document.getElementById("profileDept");
    const year = document.getElementById("profileYear");
    const sem = document.getElementById("profileSem");
    const templateEl = document.getElementById("profileTemplate");
    const role = document.getElementById("profileRole");
    [username, dept, year, sem, templateEl, role].forEach(el => {
      if (!el) return;
      el.addEventListener("input", markProfileDirty);
      el.addEventListener("change", markProfileDirty);
    });

    if (year) {
      year.addEventListener("change", () => {
        updateSemOptions();
      });
    }
  };

  wireProfileDirtyListeners();
  updateSaveProfileState();

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

    const originalText = saveProfileBtn.textContent;
    saveProfileBtn.disabled = true;
    saveProfileBtn.textContent = "Saving...";
    try {
      const ok = await saveProfile();
      await refreshAuthState();
      if (ok) {
        profileDirty = false;
        updateSaveProfileState();
        saveProfileBtn.textContent = "Profile updated";
      } else {
        markProfileDirty();
        saveProfileBtn.textContent = originalText;
      }
    } finally {
      setTimeout(() => {
        saveProfileBtn.textContent = originalText;
        saveProfileBtn.disabled = false;
      }, 1200);
    }
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
  if (fb.profile) {
    const resolved = resolveTemplateId(fb.profile);
    setActiveTemplate(resolved, { resetTimetable: false });
  }
}

function applyProfileToInputs() {
  const username = document.getElementById("profileUsername");
  const dept = document.getElementById("profileDept");
  const year = document.getElementById("profileYear");
  const sem = document.getElementById("profileSem");
  const templateEl = document.getElementById("profileTemplate");
  const role = document.getElementById("profileRole");
  if (!username || !dept || !year || !sem || !role) return;
  username.value = fb.profile && fb.profile.username ? fb.profile.username : "";
  dept.value = fb.profile && fb.profile.dept ? fb.profile.dept : "";
  year.value = fb.profile && fb.profile.year ? fb.profile.year : "";
  sem.value = fb.profile && fb.profile.sem ? fb.profile.sem : "";
  role.value = fb.profile && fb.profile.role ? fb.profile.role : "student";

  if (templateEl) {
    templateEl.value = "";
    templateEl.style.display = "none";
  }

  updateSemOptions();

  profileDirty = false;
  const saveProfileBtn = document.getElementById("saveProfileBtn");
  if (saveProfileBtn) {
    saveProfileBtn.classList.remove("is-unsaved");
    saveProfileBtn.classList.add("is-saved");
  }
}

async function saveProfile() {
  const usernameRaw = document.getElementById("profileUsername").value;
  const dept = document.getElementById("profileDept").value.trim().toUpperCase();
  const year = document.getElementById("profileYear").value.trim().toUpperCase();
  const sem = document.getElementById("profileSem").value.trim().toUpperCase();
  const templateOverride = "";
  const role = document.getElementById("profileRole").value;
  const username = normalizeUsername(usernameRaw);
  if (!dept || !year || !sem) {
    setSyncHint("Fill dept, year, sem");
    return false;
  }

  const allowed = allowedSemsForYear(year);
  if (!allowed.includes(sem)) {
    setSyncHint(`Invalid semester for Year ${year}`);
    updateSemOptions();
    return false;
  }

  if (!username) {
    setSyncHint("Enter a username (letters/numbers/._, 3-20 chars)");
    return false;
  }

  const computedProfile = { dept, year, sem, templateId: "" };
  const resolvedTemplate = resolveTemplateId(computedProfile);
  const classKey = `${dept}_${year}_${sem}_${resolvedTemplate}`;
  const shouldResetTemplate = resolvedTemplate !== activeTemplateId;

  try {
    await reserveUsername(username);

    await fb.db.collection("users").doc(fb.user.uid).set({
      email: fb.user.email || "",
      username,
      dept,
      year,
      sem,
      templateId: templateOverride || "",
      classKey,
      role: role === "teacher" ? "teacher" : "student",
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    setSyncHint(`Profile saved • ${classKey}`);
    if (fb.profile) fb.profile.templateId = "";
    setActiveTemplate(resolvedTemplate, { resetTimetable: shouldResetTemplate });
    return true;
  } catch (e) {
    setSyncHint(e && e.message ? e.message : "Failed to save profile");
    return false;
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
  const legacyKey = legacyClassKeyFromProfile(fb.profile);
  if (!key && !legacyKey) {
    setSyncHint("Save profile to load class timetable");
    return;
  }

  const desiredKey = key || legacyKey;
  if (activeClassKey !== desiredKey) {
    activeClassKey = desiredKey;
    commitEditing();
  }

  const doc = (await fetchClassTimetableDoc(key)) || (await fetchClassTimetableDoc(legacyKey));
  if (doc && doc.data()) {
    const data = doc.data() || {};
    const templateFromDoc = String(data.templateId || "").trim().toLowerCase();
    if (templateFromDoc && templates[templateFromDoc]) {
      setActiveTemplate(templateFromDoc, { resetTimetable: false });
    }

    const decoded = Array.isArray(data.timetable)
      ? data.timetable
      : decodeTimetableFromFirestore(data);

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
  } else {
    setSyncHint("No class timetable yet (teacher can publish)");
  }

  const publishBtn = document.getElementById("publishClassBtn");
  if (publishBtn) publishBtn.disabled = !(fb.profile && fb.profile.role === "teacher");

  const viewStudentsBtn = document.getElementById("viewStudentsBtn");
  if (viewStudentsBtn) viewStudentsBtn.disabled = !(fb.profile && fb.profile.role === "teacher");
}

function applyRemoteTimetable(remote) {
  if (!Array.isArray(remote) || remote.length !== days.length) return;
  const slotCount = getActiveTimes().length;
  for (let i = 0; i < remote.length; i++) {
    if (!Array.isArray(remote[i]) || remote[i].length !== slotCount) return;
  }
  timetable = remote.map(r => r.map(v => String(v)));
  saveTimetable();
  buildTable();
  updateUI();
  updateHomeEmptyHint();
}

async function savePersonalTimetable() {
  try {
    const timetableByDay = encodeTimetableForFirestore(timetable);
    await fb.db.collection("personalTimetables").doc(fb.user.uid).set({
      timetableByDay,
      templateId: activeTemplateId,
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
      templateId: activeTemplateId,
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
    if (parsed.length !== days.length) return;
    const slotCount = getActiveTimes().length;
    for (let i = 0; i < parsed.length; i++) {
      if (!Array.isArray(parsed[i]) || parsed[i].length !== slotCount) return;
    }
    timetable = parsed.map(r => r.map(v => String(v)));
  } catch (_) {
  }
}

function applyBlankTimetable() {
  timetable = getActiveBlankTimetable();
}

function clearLocalTimetables() {
  try {
    localStorage.removeItem("tt_timetable");
    localStorage.removeItem("tt_class_timetable");
  } catch (_) {
  }
}

function saveTimetable() {
  try {
    localStorage.setItem("tt_timetable", JSON.stringify(timetable));
    localStorage.setItem("tt_template", activeTemplateId);
  } catch (_) {
  }
}

function classKeyFromProfile(profile) {
  if (!profile) return null;
  const dept = String(profile.dept || "").trim().toUpperCase();
  const year = String(profile.year || "").trim().toUpperCase();
  const sem = String(profile.sem || "").trim().toUpperCase();
  if (!dept || !year || !sem) return null;
  const templateId = resolveTemplateId(profile);
  return `${dept}_${year}_${sem}_${templateId}`;
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

function timetableHasAnySubject() {
  for (let d = 0; d < timetable.length; d++) {
    for (let s = 0; s < timetable[d].length; s++) {
      const label = normalizeSlotLabel(s, timetable[d][s]);
      if (!isPauseLabel(label) && String(label || "").trim()) return true;
    }
  }
  return false;
}

function updateHomeEmptyHint() {
  const hint = document.getElementById("homeEmptyHint");
  if (!hint) return;

  const isEmpty = !timetableHasAnySubject();
  if (!isEmpty) {
    hint.style.display = "none";
    hint.textContent = "";
    hint.classList.remove("is-clickable");
    return;
  }

  hint.style.display = "block";
  hint.classList.add("is-clickable");
  hint.textContent = settings.edit
    ? "No subjects yet — tap a cell to add your first subject (e.g., XYZ)"
    : "No subjects yet — tap here to enable edit mode and add your first subject (e.g., XYZ)";
}

function focusFirstEditableCell() {
  const td = document.querySelector("#table td:not(.pause)");
  if (!td) return;
  td.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  if (!settings.edit) setEditMode(true, { silentHint: true });
  startEditing(td);
}

function startEditing(td) {
  if (!td) return;
  if (!settings.edit) return;
  if (td.classList.contains("pause")) return;
  const row = td.closest("tr");
  if (!row || !row.dataset.day) return;
  const dayIndex = Number(row.dataset.day);
  const slotIndex = Number(td.dataset.slot || "-1");
  if (dayIndex < 0 || dayIndex >= timetable.length) return;
  const t = getActiveTimes();
  if (slotIndex < 0 || slotIndex >= t.length) return;

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
  updateHomeEmptyHint();
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
  const lower = v.toLowerCase();
  if (lower.includes("lunch")) return "Lunch";
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
  const t = getActiveTimes();
  return t.map((_, i) => {
    const sample = normalizeSlotLabel(i, timetable[0][i]);
    if (isPauseLabel(sample)) return sample;
    p += 1;
    return `${p}`;
  });
}

function computeVerticalMergeSlots(normalized) {
  const slots = new Set();
  const t = getActiveTimes();
  for (let s = 0; s < t.length; s++) {
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
  const t = getActiveTimes();
  for (let i = 0; i < t.length; i++) {
    if (n >= toMin(t[i][0]) && n < toMin(t[i][1])) return i;
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
  const t = getActiveTimes();

  const header = document.createElement("tr");
  header.innerHTML = "<th>Day</th>" + t.map((_, i) => {
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
  // const progressMeta = document.getElementById("progressMeta");

  clock.textContent = formatClock(now);

  if (dayIndex < 0 || dayIndex > 5 || periodIndex === -1) {
    status.textContent = "No class now";
    currentTitle.textContent = "No class";
    currentSub.textContent = "--";
    periodMeta.textContent = "--";
    progressFill.style.width = "0%";
    // progressMeta.textContent = "Outside class hours";
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
  const t = getActiveTimes();
  const [start, end] = t[periodIndex];
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

  const showSubject = String(subject).trim().toLowerCase() !== String(periodTag).trim().toLowerCase();
  status.textContent = showSubject
    ? `${days[dayIndex]} - ${periodTag} - ${subject}`
    : `${days[dayIndex]} - ${periodTag}`;
  currentTitle.textContent = subject;
  currentSub.textContent = `${days[dayIndex]} • ${periodTag}`;
  periodMeta.textContent = `${formatRange(start, end)} • ${durationText(start, end)}`;
  progressFill.style.width = `${percent.toFixed(2)}%`;
  // const elapsedMin = Math.floor(elapsed);
  const next = nextUp(dayIndex, periodIndex);
  // progressMeta.textContent = `${remainingMin}m left${next ? ` Next: ${next}` : ""}`;
}

function onPeriodBoundary(dayIndex, periodIndex, subject) {
  if (settings.vibrate) triggerVibrate();
  if (settings.notify) triggerNotify(dayIndex, periodIndex, subject);
}

function triggerVibrate() {
  if (!("vibrate" in navigator)) return;
  navigator.vibrate([1000, 220, 1000]);
}

function triggerNotify(dayIndex, periodIndex, subject) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  const t = getActiveTimes();
  const [start, end] = t[periodIndex];
  const title = subject;
  const body = `${days[dayIndex]} • ${formatRange(start, end)}`;
  try {
    new Notification(title, { body });
  } catch (_) {
  }
}

function nextUp(dayIndex, currentSlot) {
  const t = getActiveTimes();
  for (let i = currentSlot + 1; i < t.length; i++) {
    const label = normalizeSlotLabel(i, timetable[dayIndex][i]);
    if (!label) continue;
    return `${label} (${formatTime12(t[i][0])})`;
  }
  return null;
}

function scheduleNextBoundary() {
  if (boundaryTimer) clearTimeout(boundaryTimer);

  const n = nowMin();
  let next = null;

  for (let t of getActiveTimes()) {
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

let tableZoom = 1;
const minTableZoom = 0.55;
const maxTableZoom = 1.25;
const tableZoomStep = 0.1;
const tableMenuIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 7h14v2H5V7zm0 4h14v2H5v-2zm0 4h14v2H5v-2z"/></svg>';
const tableCloseIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4 6.4 5z"/></svg>';
const tableEditIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 17.25V21h3.75l11.06-11.06-3.75-3.75L3 17.25zm3.92 2.33H5v-1.92l9.06-9.06 1.92 1.92-9.06 9.06zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg><span class="sr-only">Enable editing</span>';
const tableSaveIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 3h12.2L21 6.8V21H5V3zm2 2v14h12V7.62L16.38 5H16v5H8V5H7zm3 0v3h4V5h-4zm-1 9h8v2H9v-2z"/></svg><span class="sr-only">Save timetable changes</span>';

function clampTableZoom(value) {
  return Math.min(maxTableZoom, Math.max(minTableZoom, value));
}

function setTableZoom(value) {
  tableZoom = clampTableZoom(value);
  const wrapper = document.getElementById("tableWrapper");
  if (wrapper) wrapper.style.setProperty("--table-zoom", tableZoom.toFixed(2));
}

function fitTableToView() {
  const wrapper = document.getElementById("tableWrapper");
  const scroller = wrapper ? wrapper.querySelector(".table-scroll") : null;
  const table = document.getElementById("table");
  if (!wrapper || !scroller || !table) return;

  wrapper.style.setProperty("--table-zoom", "1");
  const naturalWidth = table.getBoundingClientRect().width;
  const availableWidth = scroller.clientWidth;
  const fittedZoom = naturalWidth > 0 ? availableWidth / naturalWidth : tableZoom;
  setTableZoom(Math.min(1, fittedZoom));
  scroller.scrollLeft = 0;
}

function updateTableFullscreenState(isFullscreen) {
  const wrapper = document.getElementById("tableWrapper");
  const button = document.getElementById("tableFullscreenBtn");
  if (!wrapper) return;

  wrapper.classList.toggle("table-fullscreen", isFullscreen);
  wrapper.classList.toggle("landscape-fallback", false);
  document.body.classList.toggle("table-lock-scroll", isFullscreen);

  if (!isFullscreen && screen.orientation && screen.orientation.unlock) {
    try {
      screen.orientation.unlock();
    } catch (_) {
    }
  }

  if (button) {
    button.setAttribute("aria-label", isFullscreen ? "Exit timetable fullscreen" : "Open timetable fullscreen");
  }

  if (isFullscreen && window.matchMedia("(max-width: 700px)").matches) {
    fitTableToView();
  }
}

async function lockLandscapeIfPossible(wrapper) {
  if (screen.orientation && screen.orientation.lock) {
    try {
      await screen.orientation.lock("landscape");
      return true;
    } catch (_) {
    }
  }

  if (window.matchMedia("(max-width: 700px) and (orientation: portrait)").matches) {
    wrapper.classList.add("landscape-fallback");
  }
  return false;
}

async function toggleTableFullscreen() {
  const wrapper = document.getElementById("tableWrapper");
  if (!wrapper) return;

  const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
  if (fullscreenElement === wrapper || wrapper.classList.contains("table-fullscreen")) {
    if (document.exitFullscreen) {
      await document.exitFullscreen().catch(() => {});
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    } else {
      updateTableFullscreenState(false);
    }
    if (fullscreenElement !== wrapper) updateTableFullscreenState(false);
    return;
  }

  updateTableFullscreenState(true);

  if (wrapper.requestFullscreen) {
    await wrapper.requestFullscreen().catch(() => {});
  } else if (wrapper.webkitRequestFullscreen) {
    wrapper.webkitRequestFullscreen();
  }

  await lockLandscapeIfPossible(wrapper);
}

async function saveTableEditsAndExit(btn) {
  commitEditing();
  saveTimetable();

  if (btn) btn.disabled = true;
  try {
    if (fb.user && fb.db) {
      await savePersonalTimetable();
    } else {
      setSyncHint("Saved locally. Login to sync.");
    }
    setEditMode(false, { silentHint: true });
  } catch (_) {
    setEditMode(false, { silentHint: true });
  } finally {
    if (btn) btn.disabled = false;
  }
}

function initHomeView() {
  const tableActions = document.querySelector(".table-actions");
  const tableToolsBtn = document.getElementById("tableToolsBtn");
  if (tableToolsBtn && tableActions) {
    tableToolsBtn.addEventListener("click", () => {
      const isOpen = !tableActions.classList.contains("is-open");
      tableActions.classList.toggle("is-open", isOpen);
      tableToolsBtn.innerHTML = isOpen ? tableCloseIcon : tableMenuIcon;
      tableToolsBtn.setAttribute("aria-expanded", String(isOpen));
      tableToolsBtn.setAttribute("aria-label", isOpen ? "Hide timetable controls" : "Show timetable controls");
    });
  }

  const tableEditBtns = Array.from(document.querySelectorAll(".table-edit-btn"));
  if (tableEditBtns.length) {
    tableEditBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        if (settings.edit) {
          saveTableEditsAndExit(btn);
        } else {
          setEditMode(true);
          updateHomeEmptyHint();
        }
      });
    });
  }

  const fullscreenBtn = document.getElementById("tableFullscreenBtn");
  if (fullscreenBtn) {
    fullscreenBtn.addEventListener("click", () => {
      toggleTableFullscreen();
    });
  }

  const zoomOutBtn = document.getElementById("tableZoomOutBtn");
  if (zoomOutBtn) {
    zoomOutBtn.addEventListener("click", () => {
      setTableZoom(tableZoom - tableZoomStep);
    });
  }

  const zoomFitBtn = document.getElementById("tableZoomFitBtn");
  if (zoomFitBtn) {
    zoomFitBtn.addEventListener("click", () => {
      fitTableToView();
    });
  }

  const zoomInBtn = document.getElementById("tableZoomInBtn");
  if (zoomInBtn) {
    zoomInBtn.addEventListener("click", () => {
      setTableZoom(tableZoom + tableZoomStep);
    });
  }

  document.addEventListener("fullscreenchange", () => {
    const wrapper = document.getElementById("tableWrapper");
    updateTableFullscreenState(document.fullscreenElement === wrapper);
  });

  document.addEventListener("webkitfullscreenchange", () => {
    const wrapper = document.getElementById("tableWrapper");
    updateTableFullscreenState(document.webkitFullscreenElement === wrapper);
  });

  const clearAllText = document.getElementById("clearAllText");
  if (clearAllText) {
    clearAllText.addEventListener("click", () => {
      if (!confirm("Clear all subjects from the timetable?")) return;
      commitEditing();
      applyBlankTimetable();
      saveTimetable();
      buildTable();
      updateUI();
      updateHomeEmptyHint();
    });
  }

  const homeEmptyHint = document.getElementById("homeEmptyHint");
  if (homeEmptyHint) {
    homeEmptyHint.addEventListener("click", () => {
      if (!timetableHasAnySubject()) focusFirstEditableCell();
    });
  }

  updateEditControls();
  updateHomeEmptyHint();
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
    updateHomeEmptyHint();
    return;
  }

  settings.edit = next;
  saveSettings();
  if (!next) commitEditing();
  updateEditControls();
  updateHomeEmptyHint();
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
    btn.innerHTML = settings.edit ? tableSaveIcon : tableEditIcon;
    btn.setAttribute("aria-label", settings.edit ? "Save timetable changes" : "Enable editing");
    btn.title = settings.edit ? "Save changes" : "Enable editing";
  });

  document.body.classList.toggle("editing-active", settings.edit);
}

function enforceLoggedOutDefaults() {
  if (fb.user) return;

  activeClassKey = null;

  clearLocalTimetables();
  applyBlankTimetable();
  buildTable();
  updateUI();

  setEditMode(false, { silentHint: true, force: true });
  setSyncHint("Logged out • Edit mode enabled — tap a cell to start (login to sync)");
  updateHomeEmptyHint();
  setSyncHint("Logged out - tap the edit button to change timetable (login to sync)");
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

let appInitialized = false;

function init() {
  if (appInitialized) return;
  appInitialized = true;

  loadTemplateFromLocal();
  loadSettings();
  settings.edit = false;
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
  updateHomeEmptyHint();
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
      const decoded = Array.isArray(data.timetable)
        ? data.timetable
        : decodeTimetableFromFirestore(data);

      if (!decoded || !Array.isArray(decoded)) return;

      const metaParts = parseClassKey(doc.id);
      const templateId = String(data.templateId || "").trim().toLowerCase();
      items.push({
        id: doc.id,
        dept: metaParts.dept,
        year: metaParts.year,
        sem: metaParts.sem,
        templateId: templates[templateId] ? templateId : "default",
        timetable: decoded,
        updatedAt: data.updatedAt || null
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
        if (it.templateId && templates[it.templateId]) {
          setActiveTemplate(it.templateId, { resetTimetable: true });
        }
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
        edit: false
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
    setEditMode(!settings.edit);
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

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
