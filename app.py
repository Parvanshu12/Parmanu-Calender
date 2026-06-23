import os
import secrets
import string
from datetime import datetime, timedelta
import calendar
from flask import Flask, render_template, request, redirect, url_for, session, jsonify, flash
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
app.secret_key = os.environ.get('FLASK_SECRET_KEY', secrets.token_hex(32))

# Database setup
# Automatically detect if a DATABASE_URL environment variable is provided (like Render's PostgreSQL connection string)
db_url = os.environ.get('DATABASE_URL')
if db_url:
    # Render PostgreSQL URIs sometimes start with "postgres://" but SQLAlchemy 1.4+/2.0 requires "postgresql://"
    if db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql://", 1)
    app.config['SQLALCHEMY_DATABASE_URI'] = db_url
else:
    # Local fallback: saves data forever as calendar.db in your project folder
    db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'calendar.db')
    app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{db_path}'

app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

# --- Database Models ---

class Room(db.Model):
    __tablename__ = 'rooms'
    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(8), unique=True, nullable=False, index=True)
    name = db.Column(db.String(100), nullable=False)
    type = db.Column(db.String(20), default='month')  # 'month' or 'range'
    month = db.Column(db.Integer, nullable=True)     # 1-12 (for type='month')
    year = db.Column(db.Integer, nullable=True)      # (for type='month')
    start_date = db.Column(db.String(10), nullable=True)  # YYYY-MM-DD (for type='range')
    end_date = db.Column(db.String(10), nullable=True)    # YYYY-MM-DD (for type='range')
    viewer_password_hash = db.Column(db.String(255), nullable=False)
    creator_password_hash = db.Column(db.String(255), nullable=False)
    locked = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    attendees = db.relationship('Attendee', backref='room', lazy=True, cascade="all, delete-orphan")
    messages = db.relationship('Message', backref='room', lazy=True, cascade="all, delete-orphan")

class Attendee(db.Model):
    __tablename__ = 'attendees'
    id = db.Column(db.Integer, primary_key=True)
    room_id = db.Column(db.Integer, db.ForeignKey('rooms.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    password_hash = db.Column(db.String(255), nullable=True) # None means reset/clear
    reset_requested = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    availabilities = db.relationship('Availability', backref='attendee', lazy=True, cascade="all, delete-orphan")
    votes = db.relationship('Vote', backref='attendee', lazy=True, cascade="all, delete-orphan")

class Availability(db.Model):
    __tablename__ = 'availabilities'
    id = db.Column(db.Integer, primary_key=True)
    attendee_id = db.Column(db.Integer, db.ForeignKey('attendees.id'), nullable=False)
    date_str = db.Column(db.String(10), nullable=False)  # YYYY-MM-DD
    status = db.Column(db.String(20), nullable=False)    # 'available' or 'unavailable'
    note = db.Column(db.String(200), nullable=True)

class Vote(db.Model):
    __tablename__ = 'votes'
    id = db.Column(db.Integer, primary_key=True)
    attendee_id = db.Column(db.Integer, db.ForeignKey('attendees.id'), nullable=False)
    date_str = db.Column(db.String(10), nullable=False)  # YYYY-MM-DD
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class Message(db.Model):
    __tablename__ = 'messages'
    id = db.Column(db.Integer, primary_key=True)
    room_id = db.Column(db.Integer, db.ForeignKey('rooms.id'), nullable=False)
    attendee_name = db.Column(db.String(100), nullable=False)
    text = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

# Helper to generate unique 8-character room codes
def generate_room_code():
    alphabet = string.ascii_uppercase + string.digits
    while True:
        code = ''.join(secrets.choice(alphabet) for _ in range(8))
        if not Room.query.filter_by(code=code).first():
            return code

# --- Calendar Structure Generator ---
def generate_calendar_structure(room):
    months_data = []

    if room.type == 'month':
        year = room.year
        month = room.month
        
        start_weekday, num_days = calendar.monthrange(year, month)
        start_offset = (start_weekday + 1) % 7 # Sunday start

        days = []
        for day in range(1, num_days + 1):
            date_str = f"{year}-{month:02d}-{day:02d}"
            days.append({
                "num": day,
                "date_str": date_str,
                "disabled": False
            })
            
        months_data.append({
            "name": calendar.month_name[month],
            "year": year,
            "start_offset": start_offset,
            "days": days
        })
    else:
        start_date = datetime.strptime(room.start_date, "%Y-%m-%d")
        end_date = datetime.strptime(room.end_date, "%Y-%m-%d")

        current_date = start_date
        months_list = []
        while current_date <= end_date:
            pair = (current_date.year, current_date.month)
            if pair not in months_list:
                months_list.append(pair)
            current_date += timedelta(days=1)

        for year, month in months_list:
            start_weekday, num_days = calendar.monthrange(year, month)
            start_offset = (start_weekday + 1) % 7 # Sunday start

            days = []
            for day in range(1, num_days + 1):
                date_str = f"{year}-{month:02d}-{day:02d}"
                day_date = datetime.strptime(date_str, "%Y-%m-%d")
                
                is_disabled = (day_date < start_date) or (day_date > end_date)

                days.append({
                    "num": day,
                    "date_str": date_str,
                    "disabled": is_disabled
                })

            months_data.append({
                "name": calendar.month_name[month],
                "year": year,
                "start_offset": start_offset,
                "days": days
            })

    return months_data

# --- Context Processors ---
@app.template_filter('month_name')
def get_month_name(month_num):
    return calendar.month_name[int(month_num)]

# --- Routes ---

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/create-room', methods=['POST'])
def create_room():
    name = request.form.get('room_name', '').strip()
    room_type = request.form.get('room_type', 'month')
    viewer_pass = request.form.get('viewer_password', '')
    creator_pass = request.form.get('creator_password', '')

    if not name or not viewer_pass or not creator_pass:
        flash("Calendar title and password fields are required.", "error")
        return redirect(url_for('index'))

    new_room = None
    code = generate_room_code()

    if room_type == 'month':
        month_str = request.form.get('month', '')
        year_str = request.form.get('year', '')
        if not month_str or not year_str:
            flash("Please select month and year.", "error")
            return redirect(url_for('index'))
        try:
            month = int(month_str)
            year = int(year_str)
        except ValueError:
            flash("Invalid month or year values.", "error")
            return redirect(url_for('index'))

        new_room = Room(
            code=code,
            name=name,
            type='month',
            month=month,
            year=year,
            viewer_password_hash=generate_password_hash(viewer_pass),
            creator_password_hash=generate_password_hash(creator_pass)
        )
    else:
        # Custom date range type
        start_str = request.form.get('start_date', '')
        end_str = request.form.get('end_date', '')
        if not start_str or not end_str:
            flash("Please enter both start date and end date.", "error")
            return redirect(url_for('index'))

        try:
            start = datetime.strptime(start_str, "%Y-%m-%d")
            end = datetime.strptime(end_str, "%Y-%m-%d")
        except ValueError:
            flash("Dates must be in YYYY-MM-DD format.", "error")
            return redirect(url_for('index'))

        delta = end - start
        if delta.days < 0:
            flash("Start date must be before or equal to the End date.", "error")
            return redirect(url_for('index'))
        
        if delta.days > 62: # Max 2 months (roughly 62 days)
            flash("Selected date range cannot span longer than 2 months (62 days).", "error")
            return redirect(url_for('index'))

        new_room = Room(
            code=code,
            name=name,
            type='range',
            start_date=start_str,
            end_date=end_str,
            viewer_password_hash=generate_password_hash(viewer_pass),
            creator_password_hash=generate_password_hash(creator_pass)
        )

    db.session.add(new_room)
    db.session.commit()

    # Pre-authorize creator's browser session for viewing the room
    session[f'room_auth_{code}'] = True
    flash("Calendar successfully created!", "success")
    return redirect(url_for('room_dashboard', code=code))

@app.route('/join-room', methods=['POST'])
def join_room():
    code = request.form.get('room_code', '').strip().upper()
    if not code:
        flash("Please enter a room code.", "error")
        return redirect(url_for('index'))

    room = Room.query.filter_by(code=code).first()
    if not room:
        flash(f"Room '{code}' not found.", "error")
        return redirect(url_for('index'))

    return redirect(url_for('room_dashboard', code=code))

@app.route('/room/<code>')
def room_dashboard(code):
    code = code.upper()
    room = Room.query.filter_by(code=code).first_or_404()
    
    # Check room viewer authorization
    if not session.get(f'room_auth_{code}'):
        return render_template('room_auth.html', room=room)

    # Get attendee name if logged in
    attendee_id = session.get(f'attendee_id_{code}')
    current_attendee = None
    if attendee_id:
        current_attendee = Attendee.query.get(attendee_id)
        if not current_attendee:
            # Clean up stale session
            session.pop(f'attendee_id_{code}', None)

    # Compute custom dynamic calendar structures
    months_structure = generate_calendar_structure(room)
    
    # Find all attendees in this room
    attendees = Attendee.query.filter_by(room_id=room.id).order_by(Attendee.name).all()

    return render_template('room.html', room=room, months_structure=months_structure, attendees=attendees, current_attendee=current_attendee)

@app.route('/room/<code>/auth', methods=['POST'])
def room_auth(code):
    code = code.upper()
    room = Room.query.filter_by(code=code).first_or_404()
    password = request.form.get('password', '')

    if check_password_hash(room.viewer_password_hash, password):
        session[f'room_auth_{code}'] = True
        return redirect(url_for('room_dashboard', code=code))
    
    flash("Invalid room password.", "error")
    return render_template('room_auth.html', room=room)

@app.route('/room/<code>/attendee/login', methods=['POST'])
def attendee_login(code):
    code = code.upper()
    room = Room.query.filter_by(code=code).first_or_404()
    name = request.form.get('name', '').strip()
    password = request.form.get('password', '')

    if not name or not password:
        flash("Name and password are required.", "error")
        return redirect(url_for('room_dashboard', code=code))

    attendee = Attendee.query.filter(
        Attendee.room_id == room.id,
        db.func.lower(Attendee.name) == name.lower()
    ).first()

    if attendee:
        if attendee.password_hash is None:
            attendee.password_hash = generate_password_hash(password)
            attendee.reset_requested = False
            db.session.commit()
            session[f'attendee_id_{code}'] = attendee.id
            flash(f"Welcome back, {attendee.name}! Your password has been successfully updated.", "success")
        elif check_password_hash(attendee.password_hash, password):
            session[f'attendee_id_{code}'] = attendee.id
            flash(f"Welcome back, {attendee.name}!", "success")
        else:
            flash(f"Incorrect password for attendee '{name}'. If you forgot your password, you can request a reset.", "error")
            session['failed_attendee_name'] = name
    else:
        new_attendee = Attendee(
            room_id=room.id,
            name=name,
            password_hash=generate_password_hash(password)
        )
        db.session.add(new_attendee)
        db.session.commit()
        session[f'attendee_id_{code}'] = new_attendee.id
        flash(f"Profile created! Welcome to the room, {name}.", "success")

    return redirect(url_for('room_dashboard', code=code))

@app.route('/room/<code>/attendee/request-reset', methods=['POST'])
def attendee_request_reset(code):
    code = code.upper()
    room = Room.query.filter_by(code=code).first_or_404()
    name = request.form.get('name', '').strip()

    attendee = Attendee.query.filter(
        Attendee.room_id == room.id,
        db.func.lower(Attendee.name) == name.lower()
    ).first()

    if attendee:
        attendee.reset_requested = True
        db.session.commit()
        flash(f"Reset request sent to the creator. Please contact the room creator to approve your request.", "info")
    else:
        flash("Attendee name not found.", "error")

    session.pop('failed_attendee_name', None)
    return redirect(url_for('room_dashboard', code=code))

@app.route('/room/<code>/attendee/logout')
def attendee_logout(code):
    code = code.upper()
    session.pop(f'attendee_id_{code}', None)
    flash("Logged out of editor session.", "info")
    return redirect(url_for('room_dashboard', code=code))

# --- Creator Admin Endpoints ---

@app.route('/room/<code>/admin', methods=['GET', 'POST'])
def room_admin(code):
    code = code.upper()
    room = Room.query.filter_by(code=code).first_or_404()

    if request.method == 'POST':
        admin_password = request.form.get('password', '')
        if check_password_hash(room.creator_password_hash, admin_password):
            session[f'creator_auth_{code}'] = True
            return redirect(url_for('room_admin', code=code))
        else:
            flash("Incorrect Creator Admin password.", "error")
            return render_template('admin.html', room=room, authenticated=False)

    authenticated = session.get(f'creator_auth_{code}', False)
    
    if authenticated:
        attendees = Attendee.query.filter_by(room_id=room.id).order_by(Attendee.name).all()
        return render_template('admin.html', room=room, authenticated=True, attendees=attendees)
    
    return render_template('admin.html', room=room, authenticated=False)

@app.route('/room/<code>/admin/approve-reset/<int:attendee_id>', methods=['POST'])
def approve_reset(code, attendee_id):
    code = code.upper()
    room = Room.query.filter_by(code=code).first_or_404()

    if not session.get(f'creator_auth_{code}'):
        return jsonify({"success": False, "error": "Unauthorized"}), 403

    attendee = Attendee.query.filter_by(id=attendee_id, room_id=room.id).first_or_404()
    
    attendee.password_hash = None
    attendee.reset_requested = False
    db.session.commit()

    flash(f"Successfully reset password for {attendee.name}.", "success")
    return redirect(url_for('room_admin', code=code))

@app.route('/room/<code>/admin/kick/<int:attendee_id>', methods=['POST'])
def kick_attendee(code, attendee_id):
    code = code.upper()
    room = Room.query.filter_by(code=code).first_or_404()

    if not session.get(f'creator_auth_{code}'):
        return jsonify({"success": False, "error": "Unauthorized"}), 403

    attendee = Attendee.query.filter_by(id=attendee_id, room_id=room.id).first_or_404()
    name = attendee.name
    
    db.session.delete(attendee)
    db.session.commit()

    flash(f"Participant '{name}' and all their dates/votes have been successfully removed from this room.", "success")
    return redirect(url_for('room_admin', code=code))

@app.route('/room/<code>/admin/logout')
def admin_logout(code):
    code = code.upper()
    session.pop(f'creator_auth_{code}', None)
    flash("Logged out of Creator Admin session.", "info")
    return redirect(url_for('room_dashboard', code=code))

@app.route('/room/<code>/admin/lock', methods=['POST'])
def toggle_room_lock(code):
    code = code.upper()
    room = Room.query.filter_by(code=code).first_or_404()

    if not session.get(f'creator_auth_{code}'):
        flash("Unauthorized Creator session expired.", "error")
        return redirect(url_for('room_admin', code=code))

    locked_val = request.form.get('locked') == 'true'
    room.locked = locked_val
    db.session.commit()
    
    status_str = "locked" if locked_val else "unlocked"
    flash(f"Room calendar has been successfully {status_str}.", "success")
    return redirect(url_for('room_admin', code=code))

# --- AJAX APIs ---

@app.route('/room/<code>/availability', methods=['POST'])
def update_availability(code):
    code = code.upper()
    room = Room.query.filter_by(code=code).first_or_404()

    if not session.get(f'room_auth_{code}'):
        return jsonify({"success": False, "error": "Unauthorized room access"}), 403

    if room.locked:
        return jsonify({"success": False, "error": "Calendar is locked by creator."}), 403

    attendee_id = session.get(f'attendee_id_{code}')
    if not attendee_id:
        return jsonify({"success": False, "error": "Attendee editor session expired. Please log in again."}), 401

    data = request.get_json() or {}
    day = data.get('day')
    status = data.get('status') 
    note = data.get('note', '').strip()
    if len(note) > 200:
        note = note[:200]

    if not day or status not in ['available', 'unavailable', 'none']:
        return jsonify({"success": False, "error": "Invalid parameters"}), 400

    # Extract date string
    # Day is passed as cell date_str under target
    # Wait, in the calendar, dayCell clickable-day has data-date-str as "YYYY-MM-DD"
    # To support multi-month ranges, we should toggle based on date_str itself!
    # Let's read date_str from payload:
    # We will update room.js to send date_str directly, which is extremely robust!
    date_str = data.get('date_str')
    if not date_str:
        try:
            day_val = int(day)
            date_str = f"{room.year}-{room.month:02d}-{day_val:02d}"
        except (ValueError, TypeError):
            return jsonify({"success": False, "error": "Missing date_str param"}), 400

    availability = Availability.query.filter_by(attendee_id=attendee_id, date_str=date_str).first()

    if status == 'none':
        if availability:
            db.session.delete(availability)
            db.session.commit()
    else:
        if availability:
            availability.status = status
            availability.note = note
        else:
            availability = Availability(attendee_id=attendee_id, date_str=date_str, status=status, note=note)
            db.session.add(availability)
        db.session.commit()

    return jsonify({"success": True})

@app.route('/room/<code>/paint-bulk', methods=['POST'])
def paint_bulk(code):
    code = code.upper()
    room = Room.query.filter_by(code=code).first_or_404()

    if not session.get(f'room_auth_{code}'):
        return jsonify({"success": False, "error": "Unauthorized room access"}), 403

    if room.locked:
        return jsonify({"success": False, "error": "Calendar is locked by creator."}), 403

    attendee_id = session.get(f'attendee_id_{code}')
    if not attendee_id:
        return jsonify({"success": False, "error": "Attendee editor session expired. Please log in again."}), 401

    data = request.get_json() or {}
    status = data.get('status') # 'available' or 'none'

    if status not in ['available', 'none']:
        return jsonify({"success": False, "error": "Invalid parameters"}), 400

    # Fetch all dates in range/month
    months_structure = generate_calendar_structure(room)
    all_date_strs = []
    for month_obj in months_structure:
        for d in month_obj["days"]:
            if not d["disabled"]:
                all_date_strs.append(d["date_str"])

    # Clear existing availabilities for this attendee
    Availability.query.filter_by(attendee_id=attendee_id).delete()

    if status == 'available':
        for date_str in all_date_strs:
            new_avail = Availability(
                attendee_id=attendee_id,
                date_str=date_str,
                status='available',
                note=''
            )
            db.session.add(new_avail)

    db.session.commit()
    return jsonify({"success": True})

@app.route('/room/<code>/vote', methods=['POST'])
def toggle_vote(code):
    code = code.upper()
    room = Room.query.filter_by(code=code).first_or_404()

    if not session.get(f'room_auth_{code}'):
        return jsonify({"success": False, "error": "Unauthorized room access"}), 403

    if room.locked:
        return jsonify({"success": False, "error": "Calendar is locked by creator."}), 403

    attendee_id = session.get(f'attendee_id_{code}')
    if not attendee_id:
        return jsonify({"success": False, "error": "Attendee editor session expired. Please log in again."}), 401

    data = request.get_json() or {}
    date_str = data.get('date_str')

    if not date_str:
        return jsonify({"success": False, "error": "Missing date_str parameter"}), 400

    vote = Vote.query.filter_by(attendee_id=attendee_id, date_str=date_str).first()
    
    if vote:
        db.session.delete(vote)
        status = 'removed'
    else:
        vote = Vote(attendee_id=attendee_id, date_str=date_str)
        db.session.add(vote)
        status = 'added'

    db.session.commit()
    return jsonify({"success": True, "status": status})

@app.route('/room/<code>/message', methods=['POST'])
def send_chat(code):
    code = code.upper()
    room = Room.query.filter_by(code=code).first_or_404()

    if not session.get(f'room_auth_{code}'):
        return jsonify({"success": False, "error": "Unauthorized"}), 403

    if room.locked:
        return jsonify({"success": False, "error": "Room chat is locked by creator."}), 403

    # Check if attendee is logged in
    attendee_id = session.get(f'attendee_id_{code}')
    if not attendee_id:
        return jsonify({"success": False, "error": "Please log in to chat."}), 401

    attendee = Attendee.query.get(attendee_id)
    if not attendee:
        return jsonify({"success": False, "error": "Stale session"}), 401

    data = request.get_json() or {}
    text = data.get('text', '').strip()

    if not text:
        return jsonify({"success": False, "error": "Empty message text"}), 400

    new_msg = Message(
        room_id=room.id,
        attendee_name=attendee.name,
        text=text
    )
    db.session.add(new_msg)
    db.session.commit()

    return jsonify({"success": True})

@app.route('/room/<code>/data')
def get_room_data(code):
    code = code.upper()
    room = Room.query.filter_by(code=code).first_or_404()

    if not session.get(f'room_auth_{code}'):
        return jsonify({"success": False, "error": "Unauthorized"}), 403

    attendees = Attendee.query.filter_by(room_id=room.id).all()
    attendee_list = [{"id": a.id, "name": a.name, "reset_requested": a.reset_requested} for a in attendees]

    # Generate complete list of days spanning the calendar view
    months_structure = generate_calendar_structure(room)
    
    avail_dict = {}
    votes_dict = {}

    for month_obj in months_structure:
        for d in month_obj["days"]:
            if not d["disabled"]:
                avail_dict[d["date_str"]] = {"available": [], "unavailable": [], "notes": {}}
                votes_dict[d["date_str"]] = []

    # Query all availabilities for this room
    availabilities = db.session.query(Availability, Attendee.name).join(
        Attendee, Availability.attendee_id == Attendee.id
    ).filter(Attendee.room_id == room.id).all()

    for avail, attendee_name in availabilities:
        if avail.date_str in avail_dict:
            if avail.status == 'available':
                avail_dict[avail.date_str]["available"].append(attendee_name)
            elif avail.status == 'unavailable':
                avail_dict[avail.date_str]["unavailable"].append(attendee_name)
            
            if avail.note:
                avail_dict[avail.date_str]["notes"][attendee_name] = avail.note

    # Query all votes for this room
    votes = db.session.query(Vote, Attendee.name).join(
        Attendee, Vote.attendee_id == Attendee.id
    ).filter(Attendee.room_id == room.id).all()

    for vote, attendee_name in votes:
        if vote.date_str in votes_dict:
            votes_dict[vote.date_str].append(attendee_name)

    # Query chat board messages
    messages = Message.query.filter_by(room_id=room.id).order_by(Message.created_at.asc()).all()
    msg_list = [{
        "name": m.attendee_name,
        "text": m.text,
        "time": m.created_at.strftime("%I:%M %p")
    } for m in messages]

    return jsonify({
        "success": True,
        "room_name": room.name,
        "type": room.type,
        "month": room.month,
        "year": room.year,
        "start_date": room.start_date,
        "end_date": room.end_date,
        "locked": room.locked,
        "attendees": attendee_list,
        "availabilities": avail_dict,
        "votes": votes_dict,
        "messages": msg_list
    })

# --- Database Initialization & Migration Safety Checks ---
def verify_database_schema():
    engine = db.engine
    inspector = db.inspect(engine)
    
    # Check if 'rooms' table has 'locked' column
    rooms_columns = [col['name'] for col in inspector.get_columns('rooms')]
    if 'locked' not in rooms_columns:
        with db.engine.begin() as conn:
            conn.execute(db.text("ALTER TABLE rooms ADD COLUMN locked BOOLEAN DEFAULT FALSE"))
        print("Migration: Added 'locked' column to 'rooms' table.")
        
    # Check if 'availabilities' table has 'note' column
    avail_columns = [col['name'] for col in inspector.get_columns('availabilities')]
    if 'note' not in avail_columns:
        with db.engine.begin() as conn:
            conn.execute(db.text("ALTER TABLE availabilities ADD COLUMN note VARCHAR(200)"))
        print("Migration: Added 'note' column to 'availabilities' table.")

with app.app_context():
    db.create_all()
    verify_database_schema()

if __name__ == '__main__':
    app.run(debug=True, host='127.0.0.1', port=5000)
