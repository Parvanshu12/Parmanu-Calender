// ==========================================================================
// DateSync - Room Dashboard Interactive Controller
// Real-time AJAX painting, heatmaps, tooltips, and consensus generation.
// ==========================================================================

document.addEventListener('DOMContentLoaded', function () {
    const roomContainer = document.querySelector('.room-container');
    if (!roomContainer) return; // Exit if not on the room dashboard

    const roomCode = roomContainer.getAttribute('data-room-code');
    const currentAttendeeId = roomContainer.getAttribute('data-current-attendee-id');
    const currentAttendeeName = roomContainer.getAttribute('data-current-attendee-name');

    // UI Elements
    const calendarGrid = document.getElementById('calendarGrid');
    const peopleCountBadge = document.getElementById('peopleCount');
    const participantListContainer = document.getElementById('participantList');
    const generateResultsBtn = document.getElementById('generateResultsBtn');
    const resultsDrawer = document.getElementById('resultsDrawer');
    const closeDrawerBtn = document.getElementById('closeDrawerBtn');
    const perfectDatesList = document.getElementById('perfectDatesList');
    const partialDatesList = document.getElementById('partialDatesList');
    
    // Chat Elements
    const chatMessagesContainer = document.getElementById('chatMessages');
    const chatInput = document.getElementById('chatInput');
    const sendChatBtn = document.getElementById('sendChatBtn');

    // Paint State Management
    let activePaintMode = 'available'; // 'available', 'unavailable', or 'none'
    let roomData = null;

    // --- Paint Tool Selection ---
    const paintModeBtns = document.querySelectorAll('.paint-mode-btn');
    const paintNoteWrapper = document.getElementById('paintNoteWrapper');
    
    // Set initial visibility of paint note wrapper
    if (paintNoteWrapper) {
        paintNoteWrapper.style.display = activePaintMode === 'none' ? 'none' : 'block';
    }

    paintModeBtns.forEach(btn => {
        btn.addEventListener('click', function () {
            paintModeBtns.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            activePaintMode = this.getAttribute('data-mode');
            
            if (paintNoteWrapper) {
                paintNoteWrapper.style.display = activePaintMode === 'none' ? 'none' : 'block';
            }
            
            showToast(`Paint tool switched to: ${activePaintMode === 'none' ? 'Clear/Eraser' : activePaintMode}`, 'info');
        });
    });

    // Enable special visual hover effect if user is logged in as attendee editor
    if (currentAttendeeId) {
        calendarGrid.classList.add('editor-active');
    }

    // --- Fetch Room Data and Render Heatmaps ---
    function fetchAndRenderData(isInitial = false) {
        fetch(`/room/${roomCode}/data`)
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    roomData = data;
                    renderParticipantSidebar(data.attendees, data.availabilities);
                    renderCalendarHeatmap(data.availabilities);
                    renderChatMessages(data.messages);
                    
                    if (isInitial && isDrawerOpen()) {
                        calculateAndDisplayConsensus();
                    } else if (isDrawerOpen()) {
                        // Refresh drawer content if it's currently open
                        calculateAndDisplayConsensus(false);
                    }
                    
                    updateLockedStateUI();
                } else {
                    showToast(data.error || "Failed to sync calendar details.", "error");
                }
            })
            .catch(err => {
                console.error("Sync error:", err);
                showToast("Network error syncing calendar.", "error");
            });
    }

    // --- Render Sidebar Participant Stats ---
    function renderParticipantSidebar(attendees, availabilities) {
        peopleCountBadge.textContent = attendees.length;
        
        if (attendees.length === 0) {
            participantListContainer.innerHTML = `
                <div class="empty-state text-center text-muted py-sm">
                    <i class="fa-solid fa-users-slash text-muted d-block mb-xs"></i>
                    <span>No participants registered yet.</span>
                </div>`;
            return;
        }

        // Count how many days each attendee has marked available vs unavailable
        const attendeeStats = {};
        attendees.forEach(a => {
            attendeeStats[a.name] = { available: 0, unavailable: 0 };
        });

        Object.keys(availabilities).forEach(dateStr => {
            const dayData = availabilities[dateStr];
            dayData.available.forEach(name => {
                if (attendeeStats[name] !== undefined) attendeeStats[name].available++;
            });
            dayData.unavailable.forEach(name => {
                if (attendeeStats[name] !== undefined) attendeeStats[name].unavailable++;
            });
        });

        // Populate attendees list
        participantListContainer.innerHTML = '';
        attendees.forEach((a, index) => {
            const isCurrent = (currentAttendeeName && currentAttendeeName.toLowerCase() === a.name.toLowerCase());
            const stats = attendeeStats[a.name] || { available: 0, unavailable: 0 };
            
            const item = document.createElement('div');
            item.className = 'part-item';
            if (isCurrent) {
                item.style.borderColor = 'var(--violet)';
                item.style.backgroundColor = 'rgba(138, 75, 255, 0.05)';
            }

            item.innerHTML = `
                <div class="part-info">
                    <div class="avatar bg-avatar-${index % 5}" style="width: 24px; height: 24px; font-size: 0.75rem;">
                        ${a.name[0].toUpperCase()}
                    </div>
                    <span class="part-name">${a.name} ${isCurrent ? '<span class="text-xs text-muted">(you)</span>' : ''}</span>
                </div>
                <div class="d-flex align-center gap-xs">
                    ${a.reset_requested ? '<span class="status-badge status-warning text-xs py-0 px-xs"><i class="fa-solid fa-triangle-exclamation"></i> Reset</span>' : ''}
                    <span class="part-count-badge" style="background-color: rgba(56, 239, 125, 0.1); color: #5cf58d; border: 1px solid rgba(56, 239, 125, 0.2);">${stats.available} <i class="fa-solid fa-check"></i></span>
                    <span class="part-count-badge" style="background-color: rgba(239, 45, 86, 0.1); color: #ff6e87; border: 1px solid rgba(239, 45, 86, 0.2);">${stats.unavailable} <i class="fa-solid fa-xmark"></i></span>
                </div>
            `;
            participantListContainer.appendChild(item);
        });
    }

    // --- Render Calendar Grid Heatmaps & Tooltips ---
    function renderCalendarHeatmap(availabilities) {
        const totalAttendees = roomData.attendees.length;

        // Iterate through each calendar day element
        const dayCells = document.querySelectorAll('.day-cell');
        dayCells.forEach(cell => {
            const dateStr = cell.getAttribute('data-date-str');
            const dayData = availabilities[dateStr] || { available: [], unavailable: [] };

            const numAvailable = dayData.available.length;
            const numUnavailable = dayData.unavailable.length;

            // Reset classes
            cell.classList.remove(
                'cell-score-perfect', 
                'cell-score-high', 
                'cell-score-medium', 
                'cell-score-low', 
                'cell-blocked',
                'day-marked-available',
                'day-marked-unavailable'
            );

            // 1. Outline logged in user's choices
            if (currentAttendeeName) {
                if (dayData.available.includes(currentAttendeeName)) {
                    cell.classList.add('day-marked-available');
                } else if (dayData.unavailable.includes(currentAttendeeName)) {
                    cell.classList.add('day-marked-unavailable');
                }
            }

            // 2. Set Heatmap colors based on consensus
            if (totalAttendees > 0) {
                if (numUnavailable > 0) {
                    // Blocked cell: At least one person cannot attend
                    cell.classList.add('cell-blocked');
                } else if (numAvailable > 0) {
                    const ratio = numAvailable / totalAttendees;
                    if (ratio === 1.0) {
                        cell.classList.add('cell-score-perfect');
                    } else if (ratio >= 0.6) {
                        cell.classList.add('cell-score-high');
                    } else if (ratio >= 0.3) {
                        cell.classList.add('cell-score-medium');
                    } else {
                        cell.classList.add('cell-score-low');
                    }
                }
            }

            // 3. Update day count markers
            cell.querySelector('.marker-available .count').textContent = numAvailable;
            cell.querySelector('.marker-unavailable .count').textContent = numUnavailable;

            // 4. Directly render green available names and red unavailable names inside cell tile
            const nameContainer = cell.querySelector('.day-names-container');
            if (nameContainer) {
                nameContainer.innerHTML = '';
                
                // Add available names in green
                dayData.available.forEach(name => {
                    const badge = document.createElement('span');
                    badge.className = 'day-name-badge badge-available';
                    badge.textContent = name;
                    nameContainer.appendChild(badge);
                });

                // Add unavailable names in red
                dayData.unavailable.forEach(name => {
                    const badge = document.createElement('span');
                    badge.className = 'day-name-badge badge-unavailable';
                    badge.textContent = name;
                    nameContainer.appendChild(badge);
                });
            }

            // 5. Populate tooltip structures
            const availNamesList = dayData.available.map(name => {
                const note = dayData.notes && dayData.notes[name];
                return note ? `${name} (${note})` : name;
            });
            const unavailNamesList = dayData.unavailable.map(name => {
                const note = dayData.notes && dayData.notes[name];
                return note ? `${name} (${note})` : name;
            });

            const availNames = availNamesList.length > 0 ? availNamesList.join(', ') : '-';
            const unavailNames = unavailNamesList.length > 0 ? unavailNamesList.join(', ') : '-';

            const sectAvail = cell.querySelector('.section-available');
            sectAvail.querySelector('.section-title').innerHTML = `<i class="fa-solid fa-circle-check text-emerald"></i> Available (${numAvailable}):`;
            sectAvail.querySelector('.names').textContent = availNames;

            const sectUnavail = cell.querySelector('.section-unavailable');
            sectUnavail.querySelector('.section-title').innerHTML = `<i class="fa-solid fa-circle-xmark text-rose"></i> Unavailable (${numUnavailable}):`;
            sectUnavail.querySelector('.names').textContent = unavailNames;
        });
    }

    // --- Render Sidebar Chat Messages Board ---
    function renderChatMessages(messages) {
        if (!chatMessagesContainer) return;

        if (!messages || messages.length === 0) {
            chatMessagesContainer.innerHTML = `
                <div class="empty-state text-center text-muted py-sm">
                    <i class="fa-solid fa-comments-slash d-block mb-xs text-muted"></i>
                    <span style="font-size: 0.8rem;">No chat comments yet. Start the conversation!</span>
                </div>`;
            return;
        }

        chatMessagesContainer.innerHTML = '';
        messages.forEach(m => {
            const isMe = currentAttendeeName && m.name.toLowerCase() === currentAttendeeName.toLowerCase();
            
            const msgWrapper = document.createElement('div');
            msgWrapper.className = `chat-bubble-wrapper ${isMe ? 'chat-me' : 'chat-other'}`;
            
            msgWrapper.innerHTML = `
                <div class="chat-sender-name">${m.name} <span class="chat-time">${m.time}</span></div>
                <div class="chat-bubble">${m.text}</div>
            `;
            chatMessagesContainer.appendChild(msgWrapper);
        });

        // Automatically scroll comments thread to bottom
        chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
    }

    // --- Send Chat Message Handler ---
    if (currentAttendeeId && sendChatBtn && chatInput) {
        function sendChatMessage() {
            if (roomData && roomData.locked) {
                showToast("Chat board is locked by creator.", "error");
                return;
            }
            const text = chatInput.value.trim();
            if (!text) return;

            fetch(`/room/${roomCode}/message`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ text: text })
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    chatInput.value = '';
                    fetchAndRenderData(); // refresh to get new message and updates
                } else {
                    showToast(data.error || "Failed to send message.", "error");
                }
            })
            .catch(err => {
                console.error("Chat error:", err);
                showToast("Connection error sending message.", "error");
            });
        }

        sendChatBtn.addEventListener('click', sendChatMessage);
        chatInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                sendChatMessage();
            }
        });
    }

    // --- Interactive Paint Click Listener ---
    if (currentAttendeeId) {
        calendarGrid.addEventListener('click', function (e) {
            const dayCell = e.target.closest('.clickable-day');
            if (!dayCell) return;

            if (roomData && roomData.locked) {
                showToast("Calendar is locked. Editing availability is disabled.", "error");
                return;
            }

            const day = dayCell.getAttribute('data-day');
            const dateStr = dayCell.getAttribute('data-date-str');
            
            const paintNoteInput = document.getElementById('paintNote');
            const noteText = paintNoteInput ? paintNoteInput.value.trim() : '';

            // Visual optimistic UI update before server responds to feel snappingly fast
            dayCell.classList.remove('day-marked-available', 'day-marked-unavailable');
            if (activePaintMode === 'available') {
                dayCell.classList.add('day-marked-available');
            } else if (activePaintMode === 'unavailable') {
                dayCell.classList.add('day-marked-unavailable');
            }

            // Push availability via AJAX
            fetch(`/room/${roomCode}/availability`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    day: day,
                    date_str: dateStr, // Send exact date string for robust multi-month schedules
                    status: activePaintMode,
                    note: noteText
                })
            })
            .then(res => res.json())
            .then(resData => {
                if (resData.success) {
                    fetchAndRenderData();
                } else {
                    showToast(resData.error || "Failed to save selection.", "error");
                    fetchAndRenderData();
                }
            })
            .catch(err => {
                console.error("AJAX Error:", err);
                showToast("Connection error. Could not save date selection.", "error");
                fetchAndRenderData();
            });
        });
    } else {
        // Logged out tooltip guide on calendar clicks
        calendarGrid.addEventListener('click', function (e) {
            if (e.target.closest('.clickable-day')) {
                showToast("Please enter your name and password in the sidebar to paint dates!", "info");
            }
        });
    }

    // --- Calculate and Generate Available Dates Results ---
    function calculateAndDisplayConsensus(scrollToDrawer = true) {
        if (!roomData || roomData.attendees.length === 0) {
            showToast("No participants in this calendar room yet to calculate consensus.", "info");
            return;
        }

        const availabilities = roomData.availabilities;
        const totalPeople = roomData.attendees.length;
        const votesData = roomData.votes || {};

        const perfectList = [];
        const partialList = [];

        // Determine max vote count to figure out the current leader
        let maxVotes = 0;
        Object.keys(votesData).forEach(dStr => {
            const count = votesData[dStr].length;
            if (count > maxVotes) {
                maxVotes = count;
            }
        });

        Object.keys(availabilities).forEach(dateStr => {
            const dayData = availabilities[dateStr];
            const numAvailable = dayData.available.length;
            const numUnavailable = dayData.unavailable.length;
            
            // Format nice display dates (e.g. "July 12" or "2026-07-12")
            const parts = dateStr.split('-');
            const yearNum = parts[0];
            const monthNum = parseInt(parts[1]);
            const dayNum = parseInt(parts[2]);
            const formattedDate = `${getMonthName(monthNum)} ${dayNum}, ${yearNum}`;

            if (numUnavailable === 0 && numAvailable > 0) {
                perfectList.push({
                    dateStr: dateStr,
                    date: formattedDate,
                    count: numAvailable
                });
            } else if (numAvailable > 0) {
                // Has some availability but also some conflicts
                partialList.push({
                    dateStr: dateStr,
                    date: formattedDate,
                    available: numAvailable,
                    unavailable: numUnavailable,
                    ratio: numAvailable / totalPeople
                });
            }
        });

        // Let's sort candidate list by net agreement and votes:
        // Perfect matches order by votes descending, then chronologically
        perfectList.sort((a, b) => {
            const vA = (votesData[a.dateStr] || []).length;
            const vB = (votesData[b.dateStr] || []).length;
            if (vA !== vB) return vB - vA;
            return a.dateStr.localeCompare(b.dateStr);
        });

        // Partial matches sorted by votes descending, then ratio of availability descending
        partialList.sort((a, b) => {
            const vA = (votesData[a.dateStr] || []).length;
            const vB = (votesData[b.dateStr] || []).length;
            if (vA !== vB) return vB - vA;
            if (b.ratio !== a.ratio) {
                return b.ratio - a.ratio;
            }
            return a.unavailable - b.unavailable;
        });

        // Render Perfect Matches
        if (perfectList.length === 0) {
            perfectDatesList.innerHTML = `
                <div class="empty-state py-xs text-center text-muted">
                    <i class="fa-solid fa-face-frown text-muted d-block mb-xs"></i>
                    <span>No dates with 100% agreement. Try removing conflicts.</span>
                </div>`;
        } else {
            perfectDatesList.innerHTML = '';
            perfectList.forEach(item => {
                const list = votesData[item.dateStr] || [];
                const voteCount = list.length;
                const hasVoted = currentAttendeeName && list.includes(currentAttendeeName);
                const isWinner = maxVotes > 0 && voteCount === maxVotes;

                const row = document.createElement('div');
                row.className = 'result-item';
                row.style.borderLeft = '4px solid var(--emerald)';
                if (isWinner) {
                    row.style.borderColor = 'var(--amber)';
                    row.style.boxShadow = '0 0 12px rgba(245, 175, 25, 0.3)';
                }
                
                row.innerHTML = `
                    <div class="d-flex align-center gap-xs">
                        <span class="result-date"><i class="fa-solid fa-calendar-check text-emerald"></i> ${item.date}</span>
                        ${isWinner ? '<span class="badge bg-amber animate-pulse"><i class="fa-solid fa-trophy"></i> Winner</span>' : ''}
                    </div>
                    <div class="d-flex align-center gap-sm">
                        <span class="result-meta badge bg-emerald">${item.count}/${totalPeople} Available</span>
                        <div class="d-flex align-center gap-xs">
                            <button class="btn btn-sm btn-secondary btn-ics" data-date-str="${item.dateStr}" title="Download ICS Calendar Invite" style="padding: 6px 10px; font-size: 0.8rem;">
                                <i class="fa-solid fa-download text-emerald"></i> ICS
                            </button>
                            <button class="btn btn-sm btn-secondary btn-gcal" data-date-str="${item.dateStr}" title="Add to Google Calendar" style="padding: 6px 10px; font-size: 0.8rem;">
                                <i class="fa-solid fa-calendar-plus text-violet"></i> Google
                            </button>
                            <button class="btn btn-sm btn-secondary btn-vote ${hasVoted ? 'voted' : ''}" data-date-str="${item.dateStr}" style="padding: 6px 12px; font-size: 0.8rem; ${hasVoted ? 'background-color: var(--violet); color: #fff; border-color: var(--violet);' : ''}">
                                <i class="fa-solid fa-thumbs-up"></i> Vote <span class="vote-count" style="margin-left: 4px; font-weight: 800;">${voteCount}</span>
                            </button>
                        </div>
                    </div>
                `;
                perfectDatesList.appendChild(row);
            });
        }

        // Render Partial Matches
        if (partialList.length === 0) {
            partialDatesList.innerHTML = `
                <div class="empty-state py-xs text-center text-muted">
                    <i class="fa-solid fa-calendar-minus text-muted d-block mb-xs"></i>
                    <span>No active dates marked yet.</span>
                </div>`;
        } else {
            partialDatesList.innerHTML = '';
            partialList.forEach(item => {
                const list = votesData[item.dateStr] || [];
                const voteCount = list.length;
                const hasVoted = currentAttendeeName && list.includes(currentAttendeeName);
                const isWinner = maxVotes > 0 && voteCount === maxVotes;

                const row = document.createElement('div');
                row.className = 'result-item';
                
                let accentColor = 'var(--text-muted)';
                let percentage = Math.round(item.ratio * 100);
                if (isWinner) {
                    accentColor = 'var(--amber)';
                    row.style.boxShadow = '0 0 12px rgba(245, 175, 25, 0.3)';
                } else if (item.ratio >= 0.6) {
                    accentColor = 'var(--violet)';
                } else if (item.ratio >= 0.3) {
                    accentColor = 'var(--amber)';
                }

                row.style.borderLeft = `4px solid ${accentColor}`;

                row.innerHTML = `
                    <div class="d-flex align-center gap-xs">
                        <span class="result-date" style="font-size: 0.85rem;">${item.date}</span>
                        ${isWinner ? '<span class="badge bg-amber animate-pulse"><i class="fa-solid fa-trophy"></i> Winner</span>' : ''}
                    </div>
                    <div class="d-flex align-center gap-sm">
                        <span class="result-meta d-flex align-center gap-xs">
                            <span class="badge" style="background-color: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);">${percentage}% Free</span>
                            <span class="text-xs text-secondary">(${item.available} <i class="fa-solid fa-check text-emerald"></i>, ${item.unavailable} <i class="fa-solid fa-xmark text-rose"></i>)</span>
                        </span>
                        <div class="d-flex align-center gap-xs">
                            <button class="btn btn-sm btn-secondary btn-ics" data-date-str="${item.dateStr}" title="Download ICS Calendar Invite" style="padding: 6px 10px; font-size: 0.8rem;">
                                <i class="fa-solid fa-download text-emerald"></i> ICS
                            </button>
                            <button class="btn btn-sm btn-secondary btn-gcal" data-date-str="${item.dateStr}" title="Add to Google Calendar" style="padding: 6px 10px; font-size: 0.8rem;">
                                <i class="fa-solid fa-calendar-plus text-violet"></i> Google
                            </button>
                            <button class="btn btn-sm btn-secondary btn-vote ${hasVoted ? 'voted' : ''}" data-date-str="${item.dateStr}" style="padding: 6px 12px; font-size: 0.8rem; ${hasVoted ? 'background-color: var(--violet); color: #fff; border-color: var(--violet);' : ''}">
                                <i class="fa-solid fa-thumbs-up"></i> Vote <span class="vote-count" style="margin-left: 4px; font-weight: 800;">${voteCount}</span>
                            </button>
                        </div>
                    </div>
                `;
                partialDatesList.appendChild(row);
            });
        }

        // Expand Drawer
        resultsDrawer.classList.remove('hide-drawer');
        if (scrollToDrawer) {
            resultsDrawer.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    }

    // --- Interactive Vote Toggle AJAX Handler ---
    function handleVoteToggle(e) {
        const voteBtn = e.target.closest('.btn-vote');
        if (!voteBtn) return;

        if (roomData && roomData.locked) {
            showToast("Calendar is locked. Voting is disabled.", "error");
            return;
        }

        const dateStr = voteBtn.getAttribute('data-date-str');

        if (!currentAttendeeId) {
            showToast("Please log in in the sidebar to vote for dates!", "info");
            return;
        }

        fetch(`/room/${roomCode}/vote`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                date_str: dateStr
            })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                showToast(data.status === 'added' ? "Vote registered!" : "Vote removed!", "success");
                fetchAndRenderData();
            } else {
                showToast(data.error || "Failed to submit vote.", "error");
            }
        })
        .catch(err => {
            console.error("Voting AJAX error:", err);
            showToast("Network error submitting vote.", "error");
        });
    }

    // --- Calendar Export & Event Generation Functions ---
    function downloadICS(dateStr, roomName) {
        const dateParts = dateStr.split('-');
        const year = dateParts[0];
        const month = dateParts[1];
        const day = dateParts[2];
        
        const startDateFormatted = `${year}${month}${day}`;
        
        // Calculate next day
        const dateObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        dateObj.setDate(dateObj.getDate() + 1);
        const nextYear = dateObj.getFullYear();
        const nextMonth = String(dateObj.getMonth() + 1).padStart(2, '0');
        const nextDay = String(dateObj.getDate()).padStart(2, '0');
        const endDateFormatted = `${nextYear}${nextMonth}${nextDay}`;
        
        const uid = `uid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}@datesync`;
        const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
        
        const icsContent = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//DateSync//Coordinator//EN',
            'BEGIN:VEVENT',
            `UID:${uid}`,
            `DTSTAMP:${timestamp}`,
            `DTSTART;VALUE=DATE:${startDateFormatted}`,
            `DTEND;VALUE=DATE:${endDateFormatted}`,
            `SUMMARY:DateSync Event: ${roomName}`,
            'DESCRIPTION:Coordinated schedule event from DateSync.',
            'STATUS:CONFIRMED',
            'TRANSP:TRANSPARENT',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\r\n');
        
        const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `datesync_event_${dateStr}.ics`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast("ICS calendar file downloaded!", "success");
    }

    function openGoogleCalendar(dateStr, roomName) {
        const dateParts = dateStr.split('-');
        const year = dateParts[0];
        const month = dateParts[1];
        const day = dateParts[2];
        
        const startDateFormatted = `${year}${month}${day}`;
        
        // Calculate next day
        const dateObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        dateObj.setDate(dateObj.getDate() + 1);
        const nextYear = dateObj.getFullYear();
        const nextMonth = String(dateObj.getMonth() + 1).padStart(2, '0');
        const nextDay = String(dateObj.getDate()).padStart(2, '0');
        const endDateFormatted = `${nextYear}${nextMonth}${nextDay}`;
        
        const title = encodeURIComponent(`DateSync: ${roomName}`);
        const dates = `${startDateFormatted}/${endDateFormatted}`;
        const details = encodeURIComponent(`Coordinated via DateSync calendar coordinator.`);
        
        const gcalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${dates}&details=${details}`;
        window.open(gcalUrl, '_blank');
    }

    function handleCalendarExportClick(e) {
        const icsBtn = e.target.closest('.btn-ics');
        const gcalBtn = e.target.closest('.btn-gcal');
        
        if (icsBtn) {
            const dateStr = icsBtn.getAttribute('data-date-str');
            downloadICS(dateStr, roomData ? roomData.room_name : 'DateSync Event');
        } else if (gcalBtn) {
            const dateStr = gcalBtn.getAttribute('data-date-str');
            openGoogleCalendar(dateStr, roomData ? roomData.room_name : 'DateSync Event');
        }
    }

    // --- Update Locked State UI ---
    function updateLockedStateUI() {
        const isLocked = roomData && roomData.locked;
        
        // Toggle Banner
        const lockedBanner = document.getElementById('lockedRoomBanner');
        if (lockedBanner) {
            if (isLocked) {
                lockedBanner.classList.remove('d-none');
            } else {
                lockedBanner.classList.add('d-none');
            }
        }
        
        // Calendar locking class
        if (calendarGrid) {
            if (isLocked) {
                calendarGrid.classList.add('calendar-locked');
            } else {
                calendarGrid.classList.remove('calendar-locked');
            }
        }
        
        // Disable chat inputs
        if (chatInput) chatInput.disabled = isLocked;
        if (sendChatBtn) sendChatBtn.disabled = isLocked;
        
        // Disable bulk actions
        const bulkPaintAllBtn = document.getElementById('bulkPaintAllBtn');
        const bulkResetBtn = document.getElementById('bulkResetBtn');
        if (bulkPaintAllBtn) bulkPaintAllBtn.disabled = isLocked;
        if (bulkResetBtn) bulkResetBtn.disabled = isLocked;
        
        // Disable paint mode selectors
        const paintModeBtns = document.querySelectorAll('.paint-mode-btn');
        paintModeBtns.forEach(btn => {
            if (isLocked) {
                btn.classList.add('disabled-locked');
                btn.style.pointerEvents = 'none';
                btn.style.opacity = '0.5';
            } else {
                btn.classList.remove('disabled-locked');
                btn.style.pointerEvents = '';
                btn.style.opacity = '';
            }
        });

        // Disable text input note fields
        const paintNoteInput = document.getElementById('paintNote');
        if (paintNoteInput) paintNoteInput.disabled = isLocked;

        // Disable/Dim vote buttons
        const voteBtns = document.querySelectorAll('.btn-vote');
        voteBtns.forEach(btn => {
            if (isLocked) {
                btn.style.opacity = '0.6';
                btn.style.cursor = 'not-allowed';
            } else {
                btn.style.opacity = '';
                btn.style.cursor = '';
            }
        });
    }

    // --- Bulk Paint Actions ---
    const bulkPaintAllBtn = document.getElementById('bulkPaintAllBtn');
    const bulkResetBtn = document.getElementById('bulkResetBtn');
    if (bulkPaintAllBtn) {
        bulkPaintAllBtn.addEventListener('click', function () {
            if (roomData && roomData.locked) {
                showToast("Calendar is locked by creator.", "error");
                return;
            }
            fetch(`/room/${roomCode}/paint-bulk`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ status: 'available' })
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    showToast("All days marked as available!", "success");
                    fetchAndRenderData();
                } else {
                    showToast(data.error || "Failed to mark all days.", "error");
                }
            })
            .catch(err => {
                console.error("Bulk paint error:", err);
                showToast("Network error during bulk paint.", "error");
            });
        });
    }

    if (bulkResetBtn) {
        bulkResetBtn.addEventListener('click', function () {
            if (roomData && roomData.locked) {
                showToast("Calendar is locked by creator.", "error");
                return;
            }
            fetch(`/room/${roomCode}/paint-bulk`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ status: 'none' })
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    showToast("All markings cleared!", "success");
                    fetchAndRenderData();
                } else {
                    showToast(data.error || "Failed to reset markings.", "error");
                }
            })
            .catch(err => {
                console.error("Bulk reset error:", err);
                showToast("Network error during bulk reset.", "error");
            });
        });
    }

    // Delegate click listeners to the results lists
    perfectDatesList.addEventListener('click', handleVoteToggle);
    partialDatesList.addEventListener('click', handleVoteToggle);
    perfectDatesList.addEventListener('click', handleCalendarExportClick);
    partialDatesList.addEventListener('click', handleCalendarExportClick);

    function isDrawerOpen() {
        return !resultsDrawer.classList.contains('hide-drawer');
    }

    // Trigger optimal dates calculation
    generateResultsBtn.addEventListener('click', () => calculateAndDisplayConsensus(true));
    closeDrawerBtn.addEventListener('click', () => {
        resultsDrawer.classList.add('hide-drawer');
    });

    // Helper month lookup
    function getMonthName(monthNum) {
        const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        return months[parseInt(monthNum) - 1] || "";
    }

    // --- Toast Notifications System ---
    function showToast(message, type = 'success') {
        let container = document.getElementById('toastContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toastContainer';
            container.className = 'toast-container';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        let icon = 'fa-circle-check';
        if (type === 'error') icon = 'fa-triangle-exclamation';
        else if (type === 'info') icon = 'fa-circle-info';

        toast.innerHTML = `
            <i class="fa-solid ${icon}"></i>
            <span>${message}</span>
        `;
        
        container.appendChild(toast);
        
        // Trigger show animation
        setTimeout(() => toast.classList.add('show'), 50);

        // Remove toast
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 400);
        }, 3000);
    }

    // Initial Fetch on load
    fetchAndRenderData(true);

    // Global hook for Toast
    window.showToast = showToast;
});

// --- Clipboard Copy share link helper ---
function copyShareLink() {
    const copyText = document.getElementById("shareUrl");
    const copyBtn = document.getElementById("copyBtn");
    
    copyText.select();
    copyText.setSelectionRange(0, 99999);
    navigator.clipboard.writeText(copyText.value)
        .then(() => {
            // Update button label temporarily
            const originalHTML = copyBtn.innerHTML;
            copyBtn.innerHTML = `<i class="fa-solid fa-check text-emerald"></i> <span>Copied!</span>`;
            copyBtn.style.backgroundColor = 'rgba(56, 239, 125, 0.15)';
            copyBtn.style.borderColor = 'var(--emerald)';
            
            if (window.showToast) {
                window.showToast("Room URL copied to clipboard! Share it with friends.", "success");
            }

            setTimeout(() => {
                copyBtn.innerHTML = originalHTML;
                copyBtn.style.backgroundColor = '';
                copyBtn.style.borderColor = '';
            }, 2500);
        })
        .catch(err => {
            console.error("Clipboard err:", err);
            if (window.showToast) {
                window.showToast("Failed to copy link automatically.", "error");
            }
        });
}
