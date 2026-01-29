# Timetable Vibe (Firebase Auth + Firestore)

This is a single-file (no build tools) web app that shows a timetable, highlights the current period, and supports:

- Login / Signup (Firebase Authentication)
- Profile (Dept / Year / Sem / Role)
- Shared class timetable (teachers publish for a class)
- Personal timetable (each user can override)
- Edit mode (only when logged in)

---

## 1) Prerequisites

- A Firebase project
- A web server (required for Firebase Auth / modules to behave correctly)
  - VS Code: **Live Server** extension
  - Or any local server (e.g. `python -m http.server`)

---

## 2) Create Firebase Project

1. Go to Firebase Console
2. **Add project**
3. In the project:
   - Build → **Authentication** → Get started
   - Build → **Firestore Database** → Create database (start in **test mode** for quick setup, then apply the rules below)

---

## 3) Enable Authentication (Email/Password)

Firebase Console:

- Build → **Authentication** → **Sign-in method**
- Enable **Email/Password**

---

## 4) Create a Web App and get Firebase config

Firebase Console:

1. Project settings (gear icon) → **Project settings**
2. Scroll to **Your apps** → Add app → **Web** (`</>`)
3. Register app
4. Copy the config values

You will paste them into `script.js`.

---

## 5) Add your Firebase config in `script.js`

Open `script.js` and find:

```js
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

Replace each placeholder with your Firebase project values.

---

## 6) Firestore Data Model

### Collections

#### `users/{uid}`
User profile document:

```json
{
  "email": "student@example.com",
  "dept": "CSE",
  "year": "III",
  "sem": "V",
  "role": "student" | "teacher",
  "updatedAt": "serverTimestamp"
}
```

#### `personalTimetables/{uid}`
Each user’s personal timetable override:

```json
{
  "timetable": [["..."], ...],
  "updatedAt": "serverTimestamp"
}
```

#### `classTimetables/{classKey}`
Teacher-published timetable for a class:

- `classKey` is built as: `DEPT_YEAR_SEM`
  - Example: `CSE_III_V`

```json
{
  "timetable": [["..."], ...],
  "updatedAt": "serverTimestamp",
  "updatedBy": "uid"
}
```

### Loading logic

- After login + profile saved:
  - app tries to load `classTimetables/{DEPT_YEAR_SEM}`
  - then tries to load `personalTimetables/{uid}`
  - personal overrides apply last (so it wins)

---

## 7) Firestore Security Rules (recommended)

### Apply rules in Firebase Console (step-by-step)

1. Firebase Console → your project
2. Build → **Firestore Database**
3. Open the **Rules** tab
4. Select all existing rules in the editor (test/locked/default) and delete them
5. Paste the rules below
6. Click **Publish** (top-right). Until you publish, the new rules are not active.

### Rules

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() {
      return request.auth != null;
    }

    function isOwner(uid) {
      return signedIn() && request.auth.uid == uid;
    }

    function me() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data;
    }

    function isTeacher() {
      return signedIn() && me().role == "teacher";
    }

    // User profiles
    match /users/{uid} {
      // Owner can read/write their profile
      allow read, write: if isOwner(uid);

      // Teachers can read student profiles in their own classKey (for the student list screen)
      allow read: if isTeacher()
        && resource.data.role == "student"
        && resource.data.classKey == me().classKey;
    }

    // Username uniqueness map
    // Each username doc is: usernames/{usernameLowercase} => { uid, email, updatedAt }
    match /usernames/{name} {
      allow read: if signedIn();

      // Allow creating/updating a username doc only for yourself.
      // Prevent taking over someone else's username.
      allow create: if signedIn()
        && request.resource.data.uid == request.auth.uid
        && !exists(/databases/$(database)/documents/usernames/$(name));

      allow update: if signedIn()
        && resource.data.uid == request.auth.uid
        && request.resource.data.uid == request.auth.uid;

      allow delete: if false;
    }

    // Personal timetables
    match /personalTimetables/{uid} {
      allow read, write: if isOwner(uid);
    }

    // Class timetables
    // Read: any signed-in user
    // Write: teachers only (based on users/{uid}.role)
    match /classTimetables/{classKey} {
      allow read: if signedIn();

      allow write: if signedIn()
        && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == "teacher";
    }
  }
}
```

Notes:
- In production, you may want to also restrict **read** access for `classTimetables` to only users in the same class.

---

## 8) Run locally

Because Firebase Auth needs an origin, open using a local server:

### Option A: VS Code Live Server
- Install extension "Live Server"
- Right click `index.html` → Open with Live Server

### Option B: Python
From the project folder:

```bash
python -m http.server 5500
```
Open:

- `http://localhost:5500/index.html`

---

## 9) App Usage

### Student flow
1. Open settings (gear)
2. Sign up / login
3. Fill **Dept / Year / Sem** and keep role as **Student**
4. Save profile
5. App loads class timetable (if teacher published) + your personal timetable (if exists)
6. Turn on **Edit periods** to rename cells locally
7. Press **Save personal** to store your personal timetable

### Teacher flow
1. Login
2. Set role to **Teacher** and save profile
3. Edit timetable
4. Press **Publish to class** to publish the timetable for your classKey

---

## 10) Troubleshooting

- **“Firebase config missing/invalid”**
  - Ensure `firebaseConfig` in `script.js` is filled correctly.

- **Notifications don’t work**
  - Many browsers require HTTPS for notifications.
  - Localhost usually works, file:// won’t.

- **Vibration doesn’t work**
  - Only supported on some mobile browsers.

- **Firestore permission denied**
  - Verify Firestore rules and that your user profile role is set.

---

## Files

- `index.html` – UI, settings drawer, Firebase SDK scripts
- `styles.css` – premium UI styling
- `script.js` – timetable logic + editing + settings + Firebase Auth/Firestore sync
