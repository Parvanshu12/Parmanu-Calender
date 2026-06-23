# 📅 DateSync - Collaborative Date Blocker

A premium, visually stunning, and highly collaborative monthly date blocker web application. **DateSync** lets groups coordinate schedules, paint availabilities, chat inside shared rooms, and dynamically vote on candidate dates to find the perfect scheduling consensus out of the box—with zero cookie cache dependencies or signups required.

---

## ✨ Key Premium Features

* **🔒 Dual-Tier security**:
  * **Viewer passcode**: Protects room access. Only people with the passcode can view the calendar.
  * **Attendee credentials**: Attendees register with a name and private password on first visit. They can log back in from any browser to edit their dates.
* **🎨 Live Availability Painter & Heatmaps**:
  * Paint dates in **Available (Green)**, **Unavailable (Red)**, or **Clear (Eraser)**.
  * Live availability consensus color indicators: dates where everyone is available glow deep emerald HSL green.
  * Day cells show the names of who is free and blocked directly on the grid, with custom hover tooltips showing details.
* **📝 Availability Notes**:
  * Attach an optional note (e.g., "Busy until 3 PM", "Remote") when painting your calendar availability. Notes display in tooltips on day hover.
* **⚡ Bulk Paint Actions**:
  * Quickly paint the entire calendar as "Available" or reset all your markings with one click using the new **Paint All** and **Reset** buttons.
* **📅 Month vs Custom Date Ranges**:
  * Create calendars for a single Month/Year, or specify a custom start-to-end date range (validated up to a maximum of 2 months / 62 days).
  * Automatically renders consecutive months stacked vertically with out-of-range dates disabled.
* **🗳️ Consensus Candidate Voting**:
  * One-click "Generate Best Dates" calculates perfect matches and sorted partial matches.
  * Attendees vote on candidate dates. The highest-voted date gets highlighted with a golden **"🏆 Winner"** crown badge.
* **📅 Calendar Exports (ICS & Google Calendar)**:
  * Export candidate dates with one click: download a standard `.ics` invitation file or add it directly to your Google Calendar.
* **💬 Sidebar Glassmorphic Chat Board**:
  * Real-time text discussion thread embedded in the room sidebar.
  * Bubble alignments: messages from "you" align right in glowing violet; others align left in translucent dark gray.
* **🛡️ Creator Admin Dashboard & Room Lock**:
  * Creator enters room Creator Password to view participant directories and approve reset requests.
  * Administrative **Kick Powers** to permanently remove problematic participant entries.
  * **Room Access Lock**: Lock/unlock room editing from `/admin` to freeze all markings, votes, and chat boards when scheduling is finalized.
* **📱 Optimized Mobile-First Layout**:
  * Highly responsive layout that repositions elements dynamically: paint tools and profile at the top, the calendar grid in the middle (internally scrollable/safely contained), and the room chat board conveniently located at the bottom.

---

## 🛠️ Technology Stack

* **Back-End**: Python (Flask)
* **Database**: SQLite & Flask-SQLAlchemy (relational mapping, secure cascading deletes)
* **Security**: Cryptographic password hashing (`werkzeug.security`)
* **Front-End Styling**: Vanilla CSS (High-fidelity glassmorphism, responsive flex layouts, custom HSL color variables, micro-animations)
* **Client-Side Scripting**: Vanilla JavaScript (AJAX Fetch API, dynamic heatmap painting, tooltips, toast managers)

---

## 📂 Project Structure

```
Calendar date blocker/
├── app.py                  # Core Flask server, SQLite models, routing & APIs
├── requirements.txt        # Backend dependencies list
├── .gitignore              # Ignores local databases & python caches
├── README.md               # Repository documentation
├── static/
│   ├── css/
│   │   └── styles.css      # Premium glassmorphism dark-theme style sheet
│   └── js/
│       └── room.js         # Real-time AJAX calendar painting & chat script
└── templates/
    ├── base.html           # Ambient page scaffolding and alert blocks
    ├── index.html          # Double-card landing page (Create/Join rooms)
    ├── room_auth.html      # Viewer passcode entry screen
    ├── room.html           # Calendar grid, Sidebar chat & painter dashboard
    └── admin.html          # Creator dashboard (resets, stats, kicking)
```

---

## 🚀 Quick Start Guide

### Prerequisites
* Python 3.8 or higher installed on your machine.

### 1. Clone the repository
```bash
git clone https://github.com/Parvanshu12/Parmanu-Calender.git
cd Parmanu-Calender
```

### 2. Install dependencies
Install Flask and SQLAlchemy using pip:
```bash
pip install -r requirements.txt
```

### 3. Run the application
Launch the local development server:
```bash
python app.py
```
Open your browser and navigate to:
[http://127.0.0.1:5000/](http://127.0.0.1:5000/)

---

## 🔒 Security Best Practices
* A **`.gitignore`** is pre-configured to ensure your local database file (`calendar.db`) containing test passwords and user schedules is never accidentally committed or exposed publicly to GitHub.

---

## 📄 License
This project is open-source and available under the [MIT License](LICENSE).
