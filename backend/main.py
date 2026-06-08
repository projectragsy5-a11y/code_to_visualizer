"""Ragsy Backend v5 — PostgreSQL (Supabase), Full Deployment Ready"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
import ast, random, string, sys, io, traceback, re, hashlib, json
from datetime import datetime, timedelta
import os, requests as http_requests
import psycopg2
from psycopg2.extras import RealDictCursor
import subprocess, tempfile

try:
    from cryptography.fernet import Fernet
    _FERNET_AVAILABLE = True
except ImportError:
    _FERNET_AVAILABLE = False

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ══════════════════════════════════════════════════════════════════
# DATABASE — PostgreSQL via Supabase
# ══════════════════════════════════════════════════════════════════
DATABASE_URL = os.getenv("DATABASE_URL", "")

def get_db():
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)

def test_db_connection():
    try:
        conn = get_db()
        cur  = conn.cursor()
        cur.execute("SELECT version()")
        ver  = cur.fetchone()["version"].split(",")[0]
        conn.close()
        print(f"[DB OK ] Connected → {ver}")
        return True
    except Exception as e:
        print(f"[DB ERR] {e}")
        return False

def hash_pw(pw: str) -> str:
    return hashlib.sha256(pw.encode()).hexdigest()

ENCRYPTION_KEY = os.getenv("CODE_ENCRYPTION_KEY", "")

def get_fernet():
    if not _FERNET_AVAILABLE or not ENCRYPTION_KEY:
        return None
    try:
        return Fernet(ENCRYPTION_KEY.encode())
    except Exception:
        return None

def encrypt_code(code: str) -> str:
    f = get_fernet()
    return f.encrypt(code.encode()).decode() if f else code

def decrypt_code(encrypted: str) -> str:
    f = get_fernet()
    if not f: return encrypted
    try:
        return f.decrypt(encrypted.encode()).decode()
    except Exception:
        return encrypted

# ══════════════════════════════════════════════════════════════════
# DB HELPERS — pure PostgreSQL syntax (%s placeholders, RETURNING)
# ══════════════════════════════════════════════════════════════════

def db_user_create(username, mobile_no, pw_hash) -> int:
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO users (username, mobile_no, password, created_at) "
            "VALUES (%s,%s,%s,%s) RETURNING user_id",
            (username, mobile_no, pw_hash, datetime.utcnow())
        )
        uid = cur.fetchone()["user_id"]
        conn.commit()
        return uid
    finally:
        conn.close()

def db_user_by_mobile(mobile_no) -> dict | None:
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT user_id,username,mobile_no,password,created_at,is_admin "
            "FROM users WHERE mobile_no=%s", (mobile_no,))
        r = cur.fetchone()
        if not r: return None
        return dict(r)
    finally:
        conn.close()

def db_user_by_username(username) -> dict | None:
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT user_id,username,mobile_no,password,is_admin "
            "FROM users WHERE username=%s", (username,))
        r = cur.fetchone()
        if not r: return None
        return dict(r)
    finally:
        conn.close()

def db_user_by_id(uid) -> dict | None:
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT user_id,username,mobile_no,is_admin FROM users WHERE user_id=%s", (uid,))
        r = cur.fetchone()
        if not r: return None
        return dict(r)
    finally:
        conn.close()

def db_otp_upsert(user_id, otp_code, expiry_time):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM otp_verification WHERE user_id=%s", (user_id,))
        cur.execute(
            "INSERT INTO otp_verification (user_id,otp_code,expiry_time,status) VALUES (%s,%s,%s,'pending')",
            (user_id, otp_code, expiry_time)
        )
        conn.commit()
    finally:
        conn.close()

def db_otp_get(user_id) -> dict | None:
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT otp_id,user_id,otp_code,expiry_time,status FROM otp_verification WHERE user_id=%s",
            (user_id,))
        r = cur.fetchone()
        if not r: return None
        return dict(r)
    finally:
        conn.close()

def db_otp_set_status(user_id, status):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("UPDATE otp_verification SET status=%s WHERE user_id=%s", (status, user_id))
        conn.commit()
    finally:
        conn.close()

def db_submission_save(user_id, source_code, language) -> int:
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO code_submissions (user_id,source_code,language,upload_time) "
            "VALUES (%s,%s,%s,%s) RETURNING code_id",
            (user_id, encrypt_code(source_code), language, datetime.utcnow())
        )
        cid = cur.fetchone()["code_id"]
        conn.commit()
        return cid
    finally:
        conn.close()

def db_submissions_by_user(user_id) -> list:
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT code_id,source_code,language,upload_time FROM code_submissions "
            "WHERE user_id=%s ORDER BY upload_time DESC", (user_id,))
        rows = cur.fetchall()
        result = []
        for r in rows:
            full = decrypt_code(r["source_code"])
            result.append({
                "code_id": r["code_id"],
                "source_code_full": full,
                "source_code": full[:120] + ("..." if len(full) > 120 else ""),
                "language": r["language"],
                "upload_time": str(r["upload_time"])
            })
        return result
    finally:
        conn.close()

def db_flowchart_save(code_id, diagram_json: str):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO flowcharts (code_id,diagram_path,generated_time) VALUES (%s,%s,%s)",
            (code_id, diagram_json, datetime.utcnow())
        )
        conn.commit()
    finally:
        conn.close()

def db_explanation_save(code_id, explanation_text: str):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT explanation_id FROM explanations WHERE code_id=%s", (code_id,))
        if cur.fetchone():
            cur.execute("UPDATE explanations SET file_path=%s WHERE code_id=%s", (explanation_text, code_id))
        else:
            cur.execute(
                "INSERT INTO explanations (code_id,file_path,download_count) VALUES (%s,%s,0)",
                (code_id, explanation_text)
            )
        conn.commit()
    finally:
        conn.close()

def db_action_log(user_id):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("INSERT INTO user_actions_log (user_id,action_time) VALUES (%s,%s)", (user_id, datetime.utcnow()))
        conn.commit()
    finally:
        conn.close()

def db_report_save(user_id, action_type):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("INSERT INTO reports (user_id,action_type,action_time) VALUES (%s,%s,%s)",
                    (user_id, action_type, datetime.utcnow()))
        conn.commit()
    finally:
        conn.close()

def db_log(user_id, action_type):
    try:
        db_action_log(user_id)
        db_report_save(user_id, action_type)
    except Exception as e:
        print(f"[DB LOG WARNING] {e}")

# ── Session store ─────────────────────────────────────────────────
sessions_db = {}

def gen_token(user_id: int) -> str:
    t = "".join(random.choices(string.ascii_letters + string.digits, k=32))
    sessions_db[t] = {"user_id": user_id, "expires": datetime.utcnow() + timedelta(hours=24)}
    return t

def user_by_token(token: str) -> dict:
    rec = sessions_db.get(token)
    if not rec:
        raise HTTPException(401, detail="Invalid or expired session. Please log in again.")
    if datetime.utcnow() > rec["expires"]:
        del sessions_db[token]
        raise HTTPException(401, detail="Session expired. Please log in again.")
    user = db_user_by_id(rec["user_id"])
    if not user:
        raise HTTPException(401, detail="User not found")
    return user

# ══════════════════════════════════════════════════════════════════
# FastAPI app + CORS
# ══════════════════════════════════════════════════════════════════
FRONTEND_URL = os.getenv("FRONTEND_URL", "")

app = FastAPI(title="Ragsy API", version="5.0.0")
app.add_middleware(CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"])

# ── SMS ───────────────────────────────────────────────────────────
TWOFACTOR_KEY = os.getenv("TWOFACTOR_API_KEY", "")
FAST2SMS_KEY  = os.getenv("FAST2SMS_API_KEY",  "")
TWILIO_SID    = os.getenv("TWILIO_ACCOUNT_SID",  "")
TWILIO_TOKEN  = os.getenv("TWILIO_AUTH_TOKEN",   "")
TWILIO_FROM   = os.getenv("TWILIO_FROM_NUMBER",  "")

def send_sms(to_number: str, otp: str) -> dict:
    digits   = re.sub(r"[^0-9]", "", to_number)
    indian10 = digits[-10:] if len(digits) >= 10 else digits
    message  = f"Your Ragsy OTP is {otp}. Valid for 5 minutes. Do not share."
    if TWOFACTOR_KEY:
        try:
            r = http_requests.get(f"https://2factor.in/API/V1/{TWOFACTOR_KEY}/SMS/{indian10}/{otp}/Ragsy", timeout=10)
            d = r.json()
            if d.get("Status") == "Success":
                return {"sent": True, "provider": "2factor", "error": None}
        except Exception as e:
            print(f"[SMS ERR 2Factor] {e}")
    if FAST2SMS_KEY:
        try:
            r = http_requests.post("https://www.fast2sms.com/dev/bulkV2",
                headers={"authorization": FAST2SMS_KEY},
                json={"route":"otp","variables_values":otp,"flash":0,"numbers":indian10}, timeout=10)
            d = r.json()
            if d.get("return") == True:
                return {"sent": True, "provider": "fast2sms", "error": None}
        except Exception as e:
            print(f"[SMS ERR Fast2SMS] {e}")
    if TWILIO_SID and TWILIO_TOKEN and TWILIO_FROM:
        try:
            from twilio.rest import Client
            Client(TWILIO_SID, TWILIO_TOKEN).messages.create(body=message, from_=TWILIO_FROM, to=to_number)
            return {"sent": True, "provider": "twilio", "error": None}
        except Exception as e:
            return {"sent": False, "provider": "twilio", "error": str(e)}
    print(f"[DEV OTP] {to_number} => {otp}")
    return {"sent": False, "provider": "console", "error": "No SMS provider configured"}

# ── Models ────────────────────────────────────────────────────────
class RegisterRequest(BaseModel):
    username: str; mobile_no: str; password: str
class OTPVerifyRequest(BaseModel):
    mobile_no: str; otp_code: str
class ResendOTPRequest(BaseModel):
    mobile_no: str
class LoginRequest(BaseModel):
    username: str; password: str
class LogoutRequest(BaseModel):
    token: str
class CodeRequest(BaseModel):
    code: str; language: str = "python"
class RunRequest(BaseModel):
    code: str; language: str = "python"; user_inputs: List[str] = []
class ForgotPasswordRequest(BaseModel):
    mobile_no: str
class ResetPasswordRequest(BaseModel):
    mobile_no: str; otp_code: str; new_password: str

def gen_otp(): return "".join(random.choices(string.digits, k=6))

# ══════════════════════════════════════════════════════════════════
# AUTH ROUTES
# ══════════════════════════════════════════════════════════════════
@app.get("/")
def root(): return {"status":"running","app":"Ragsy","version":"5.0.0"}

@app.get("/health")
def health():
    db_ok = test_db_connection()
    return {"status":"healthy","db_connected":db_ok,"timestamp":datetime.utcnow().isoformat()}

@app.post("/auth/register")
def register(data: RegisterRequest):
    if db_user_by_mobile(data.mobile_no):
        raise HTTPException(400, detail="Mobile number already registered")
    if db_user_by_username(data.username):
        raise HTTPException(400, detail="Username already taken")
    if len(data.password) < 6:
        raise HTTPException(400, detail="Password must be at least 6 characters")
    uid = db_user_create(data.username, data.mobile_no, hash_pw(data.password))
    token = gen_token(uid)
    db_log(uid, "register")
    return {"message":"Welcome to Ragsy!","token":token,
            "user":{"username":data.username,"mobile_no":data.mobile_no}}

@app.post("/auth/verify-otp")
def verify_otp(data: OTPVerifyRequest):
    user = db_user_by_mobile(data.mobile_no)
    if not user: raise HTTPException(404, detail="Mobile not found. Please register first.")
    rec = db_otp_get(user["user_id"])
    if not rec: raise HTTPException(400, detail="No OTP found. Please register again.")
    if rec["status"] == "verified": raise HTTPException(400, detail="OTP already used.")
    if datetime.utcnow() > rec["expiry_time"]:
        db_otp_set_status(user["user_id"], "expired")
        raise HTTPException(400, detail="OTP expired. Request a new one.")
    if rec["otp_code"] != data.otp_code: raise HTTPException(400, detail="Incorrect OTP.")
    db_otp_set_status(user["user_id"], "verified")
    token = gen_token(user["user_id"])
    db_log(user["user_id"], "otp_verify")
    return {"message":"Mobile verified.","token":token,
            "user":{"username":user["username"],"mobile_no":user["mobile_no"]}}

@app.post("/auth/resend-otp")
def resend_otp(data: ResendOTPRequest):
    user = db_user_by_mobile(data.mobile_no)
    if not user: raise HTTPException(404, detail="Mobile not found.")
    otp    = gen_otp()
    expiry = datetime.utcnow() + timedelta(minutes=5)
    db_otp_upsert(user["user_id"], otp, expiry)
    sms = send_sms(data.mobile_no, otp)
    return {"message":"New OTP sent.","sms_sent":sms["sent"],"provider":sms["provider"],
            "otp_code":otp if not sms["sent"] else None,"expires_in":300}

@app.post("/auth/login")
def login(data: LoginRequest):
    user = db_user_by_username(data.username)
    if not user: raise HTTPException(401, detail="Username not found")
    if user["password"] != hash_pw(data.password): raise HTTPException(401, detail="Incorrect password")
    token = gen_token(user["user_id"])
    db_log(user["user_id"], "login")
    return {"message":"Login successful","token":token,
            "user":{"username":user["username"],"mobile_no":user["mobile_no"],
                    "is_admin":bool(user.get("is_admin", False))}}

@app.post("/auth/logout")
def logout(data: LogoutRequest):
    rec = sessions_db.pop(data.token, None)
    if rec: db_log(rec["user_id"], "logout")
    return {"message":"Logged out successfully"}

@app.get("/auth/me")
def get_me(token: str):
    user = user_by_token(token)
    return {"user_id":user["user_id"],"username":user["username"],
            "mobile_no":user["mobile_no"],"is_admin":bool(user.get("is_admin", False))}

@app.post("/auth/forgot-password")
def forgot_password(data: ForgotPasswordRequest):
    user = db_user_by_mobile(data.mobile_no)
    if not user: raise HTTPException(404, detail="No account found with this mobile number")
    otp    = gen_otp()
    expiry = datetime.utcnow() + timedelta(minutes=5)
    db_otp_upsert(user["user_id"], otp, expiry)
    sms = send_sms(data.mobile_no, otp)
    return {"message":"OTP sent","sms_sent":sms["sent"],"provider":sms["provider"],
            "otp_code":otp if not sms["sent"] else None,"expires_in":300}

@app.post("/auth/reset-password")
def reset_password(data: ResetPasswordRequest):
    user = db_user_by_mobile(data.mobile_no)
    if not user: raise HTTPException(404, detail="Mobile not found")
    if len(data.new_password) < 6: raise HTTPException(400, detail="Password must be at least 6 characters")
    rec = db_otp_get(user["user_id"])
    if not rec: raise HTTPException(400, detail="No OTP found.")
    if datetime.utcnow() > rec["expiry_time"]:
        db_otp_set_status(user["user_id"], "expired")
        raise HTTPException(400, detail="OTP expired.")
    if rec["otp_code"] != data.otp_code: raise HTTPException(400, detail="Incorrect OTP.")
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("UPDATE users SET password=%s WHERE user_id=%s",
                    (hash_pw(data.new_password), user["user_id"]))
        conn.commit()
    finally:
        conn.close()
    db_otp_set_status(user["user_id"], "verified")
    db_log(user["user_id"], "reset_password")
    return {"message":"Password updated successfully."}

# ── Admin ─────────────────────────────────────────────────────────
def require_admin(token: str) -> dict:
    rec = sessions_db.get(token)
    if not rec: raise HTTPException(401, detail="Invalid token")
    if datetime.utcnow() > rec["expires"]:
        del sessions_db[token]; raise HTTPException(401, detail="Session expired")
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT user_id,username,is_admin FROM users WHERE user_id=%s", (rec["user_id"],))
        r = cur.fetchone()
        if not r or not r["is_admin"]: raise HTTPException(403, detail="Admin access required")
        return {"user_id":r["user_id"],"username":r["username"]}
    finally:
        conn.close()

@app.get("/admin/stats")
def admin_stats(token: str):
    require_admin(token)
    conn = get_db()
    try:
        cur = conn.cursor()
        def count(q): cur.execute(q); return cur.fetchone()[0]
        return {
            "total_users":             count("SELECT COUNT(*) FROM users WHERE is_admin=false"),
            "total_submissions":       count("SELECT COUNT(*) FROM code_submissions"),
            "total_flowcharts":        count("SELECT COUNT(*) FROM flowcharts"),
            "total_explanations":      count("SELECT COUNT(*) FROM explanations"),
            "python_submissions":      count("SELECT COUNT(*) FROM code_submissions WHERE language='python'"),
            "javascript_submissions":  count("SELECT COUNT(*) FROM code_submissions WHERE language='javascript'"),
            "new_users_this_week":     count("SELECT COUNT(*) FROM users WHERE created_at >= NOW() - INTERVAL '7 days' AND is_admin=false"),
            "total_downloads":         count("SELECT COALESCE(SUM(download_count),0) FROM explanations"),
        }
    finally:
        conn.close()

@app.get("/admin/users")
def admin_get_users(token: str, page: int = 1, limit: int = 20):
    require_admin(token)
    offset = (page - 1) * limit
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT u.user_id, u.username, u.mobile_no, u.created_at,
                   COUNT(cs.code_id) AS submission_count
            FROM users u
            LEFT JOIN code_submissions cs ON cs.user_id = u.user_id
            WHERE u.is_admin = false
            GROUP BY u.user_id, u.username, u.mobile_no, u.created_at
            ORDER BY u.created_at DESC
            LIMIT %s OFFSET %s
        """, (limit, offset))
        rows = cur.fetchall()
        cur.execute("SELECT COUNT(*) FROM users WHERE is_admin=false")
        total = cur.fetchone()[0]
        return {"users":[{"user_id":r["user_id"],"username":r["username"],"mobile_no":r["mobile_no"],
                          "created_at":str(r["created_at"]),"submission_count":r["submission_count"]} for r in rows],
                "total":total,"page":page,"limit":limit}
    finally:
        conn.close()

@app.delete("/admin/users/{user_id}")
def admin_delete_user(user_id: int, token: str):
    require_admin(token)
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM users WHERE user_id=%s AND is_admin=false", (user_id,))
        conn.commit()
        return {"message":f"User {user_id} deleted"}
    finally:
        conn.close()

@app.get("/admin/submissions")
def admin_get_submissions(token: str, page: int = 1, limit: int = 20):
    require_admin(token)
    offset = (page - 1) * limit
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT cs.code_id, u.username, cs.language, cs.upload_time,
                   LENGTH(cs.source_code) AS code_length
            FROM code_submissions cs
            JOIN users u ON u.user_id = cs.user_id
            ORDER BY cs.upload_time DESC
            LIMIT %s OFFSET %s
        """, (limit, offset))
        rows = cur.fetchall()
        return {"submissions":[{"code_id":r["code_id"],"username":r["username"],"language":r["language"],
                                "upload_time":str(r["upload_time"]),"code_length":r["code_length"]} for r in rows]}
    finally:
        conn.close()

# ══════════════════════════════════════════════════════════════════
# FLOWCHART ENGINE
# ══════════════════════════════════════════════════════════════════
NODE_COLORS={
    "start":{"bg":"#0f172a","border":"#38bdf8"},"end":{"bg":"#0f172a","border":"#f43f5e"},
    "func":{"bg":"#4c1d95","border":"#a78bfa"},"class":{"bg":"#78350f","border":"#fbbf24"},
    "if":{"bg":"#7f1d1d","border":"#fca5a5"},"elif":{"bg":"#7f1d1d","border":"#f87171"},
    "else":{"bg":"#1e3a5f","border":"#93c5fd"},"for":{"bg":"#064e3b","border":"#34d399"},
    "while":{"bg":"#064e3b","border":"#6ee7b7"},"return":{"bg":"#7c2d12","border":"#fb923c"},
    "assign":{"bg":"#0c4a6e","border":"#38bdf8"},"import":{"bg":"#3b0764","border":"#c4b5fd"},
    "try":{"bg":"#450a0a","border":"#f87171"},"except":{"bg":"#450a0a","border":"#fca5a5"},
    "raise":{"bg":"#450a0a","border":"#ef4444"},"with":{"bg":"#0c4a6e","border":"#7dd3fc"},
    "print":{"bg":"#1e3a5f","border":"#60a5fa"},"call":{"bg":"#1e293b","border":"#64748b"},
    "default":{"bg":"#1e293b","border":"#64748b"},
}
SHAPE_MAP={"if":"diamond","elif":"diamond","for":"diamond","while":"diamond",
           "print":"parallelogram","start":"rounded","end":"rounded"}

def make_node(nid,label,ck,x,y,ntype=None):
    c=NODE_COLORS.get(ck,NODE_COLORS["default"]); sh=SHAPE_MAP.get(ck,"rect")
    if sh=="diamond":
        return {"id":nid,"type":"diamond","data":{"label":label,"color":c["border"],"bg":c["bg"]},"position":{"x":x,"y":y}}
    elif sh=="parallelogram":
        return {"id":nid,"type":"parallelogram","data":{"label":label,"color":c["border"],"bg":c["bg"]},"position":{"x":x,"y":y}}
    elif sh=="rounded":
        return {"id":nid,"type":ntype or "default","data":{"label":label},"position":{"x":x,"y":y},
                "style":{"background":c["bg"],"color":"#fff","border":f"2px solid {c['border']}",
                         "borderRadius":"50px","padding":"12px 28px","fontWeight":"bold","fontSize":"14px",
                         "textAlign":"center","minWidth":"140px","boxShadow":f"0 0 24px {c['border']}88",
                         "fontFamily":"'Fira Code',monospace"}}
    return {"id":nid,"type":"default","data":{"label":label},"position":{"x":x,"y":y},
            "style":{"background":c["bg"],"color":"#fff","border":f"2px solid {c['border']}",
                     "borderRadius":"8px","padding":"10px 16px","minWidth":"180px","maxWidth":"280px",
                     "fontSize":"12px","fontFamily":"'Fira Code',monospace","wordBreak":"break-word",
                     "whiteSpace":"pre-wrap","textAlign":"center","boxShadow":f"0 0 14px {c['border']}44"}}

def make_edge(s,t,label="",color="#94a3b8",dashed=False):
    return {"id":f"e{s}-{t}-{random.randint(0,99999)}","source":s,"target":t,"label":label,"animated":True,
            "style":{"stroke":color,"strokeWidth":2,"strokeDasharray":"6,3" if dashed else "0"},
            "labelStyle":{"fill":"#94a3b8","fontSize":"11px"},"labelBgStyle":{"fill":"#1e293b","fillOpacity":0.8}}

def safe_unparse(node):
    try:
        txt=ast.unparse(node); return (txt[:52]+"…") if len(txt)>52 else txt
    except: return "???"

_ctr=[0]
def nid(): _ctr[0]+=1; return str(_ctr[0])

def parse_statements(stmts,nodes,edges,parent_id,x,y,depth=0):
    prev=parent_id; dx=depth*40
    for i,stmt in enumerate(stmts):
        node_id=nid(); label=""; ck="default"; body=[]; orelse=[]; handlers=[]; finalbody=[]
        if isinstance(stmt,(ast.FunctionDef,ast.AsyncFunctionDef)):
            px="async def" if isinstance(stmt,ast.AsyncFunctionDef) else "def"
            args=", ".join(a.arg for a in stmt.args.args)
            deco="@"+safe_unparse(stmt.decorator_list[0])+"\n" if stmt.decorator_list else ""
            label=f"{deco}{px} {stmt.name}({args})"; ck="func"; body=stmt.body
        elif isinstance(stmt,ast.ClassDef):
            bases=", ".join(safe_unparse(b) for b in stmt.bases)
            label=f"class {stmt.name}({bases})" if bases else f"class {stmt.name}"; ck="class"; body=stmt.body
        elif isinstance(stmt,ast.If): label=f"if {safe_unparse(stmt.test)}"; ck="if"; body=stmt.body; orelse=stmt.orelse
        elif isinstance(stmt,ast.For): label=f"for {safe_unparse(stmt.target)} in {safe_unparse(stmt.iter)}"; ck="for"; body=stmt.body
        elif isinstance(stmt,ast.While): label=f"while {safe_unparse(stmt.test)}"; ck="while"; body=stmt.body
        elif isinstance(stmt,ast.Return): label=f"return {safe_unparse(stmt.value) if stmt.value else 'None'}"; ck="return"
        elif isinstance(stmt,ast.Assign):
            label=f"{', '.join(safe_unparse(t) for t in stmt.targets)} = {safe_unparse(stmt.value)}"; ck="assign"
        elif isinstance(stmt,ast.AugAssign):
            ops={ast.Add:"+=",ast.Sub:"-=",ast.Mult:"*=",ast.Div:"/=",ast.Mod:"%=",ast.Pow:"**=",ast.FloorDiv:"//="}
            label=f"{safe_unparse(stmt.target)} {ops.get(type(stmt.op),'op=')} {safe_unparse(stmt.value)}"; ck="assign"
        elif isinstance(stmt,ast.AnnAssign):
            label=f"{safe_unparse(stmt.target)}: {safe_unparse(stmt.annotation)}"
            if stmt.value: label+=f" = {safe_unparse(stmt.value)}"; ck="assign"
        elif isinstance(stmt,ast.Import): label=f"import {', '.join((a.asname or a.name) for a in stmt.names)}"; ck="import"
        elif isinstance(stmt,ast.ImportFrom): label=f"from {stmt.module or ''} import {', '.join((a.asname or a.name) for a in stmt.names)}"; ck="import"
        elif isinstance(stmt,ast.Try): label="try"; ck="try"; body=stmt.body; handlers=stmt.handlers; finalbody=getattr(stmt,"finalbody",[])
        elif isinstance(stmt,ast.ExceptHandler):
            exc=safe_unparse(stmt.type) if stmt.type else "Exception"
            label=f"except {exc}"+(f" as {stmt.name}" if stmt.name else ""); ck="except"; body=stmt.body
        elif isinstance(stmt,ast.With):
            items=", ".join(safe_unparse(w.context_expr)+(f" as {safe_unparse(w.optional_vars)}" if w.optional_vars else "") for w in stmt.items)
            label=f"with {items}"; ck="with"; body=stmt.body
        elif isinstance(stmt,ast.Raise):
            label=f"raise {safe_unparse(stmt.exc) if stmt.exc else ''}"; ck="raise"
        elif isinstance(stmt,ast.Delete): label=f"del {', '.join(safe_unparse(t) for t in stmt.targets)}"; ck="assign"
        elif isinstance(stmt,ast.Assert): label=f"assert {safe_unparse(stmt.test)}"; ck="default"
        elif isinstance(stmt,ast.Expr):
            v=stmt.value
            if isinstance(v,ast.Call):
                fname=""
                if isinstance(v.func,ast.Name): fname=v.func.id
                elif isinstance(v.func,ast.Attribute): fname=f"{safe_unparse(v.func.value)}.{v.func.attr}"
                args=", ".join(safe_unparse(a) for a in v.args[:3])
                if fname in("print","console.log"): label=f"print({args})"; ck="print"
                else: label=f"{fname}({args})"; ck="call"
            else: label=safe_unparse(v)
        else: label=type(stmt).__name__
        if not label: label=type(stmt).__name__
        n=make_node(node_id,label[:60],ck,300+dx,y+i*110)
        nodes.append(n)
        lbl="Yes" if (prev==parent_id and ck in("if","elif","for","while") and i==0) else ""
        edges.append(make_edge(prev,node_id,lbl,"#34d399" if lbl=="Yes" else "#4a90b8"))
        prev=node_id
        ny=y+(i+1)*110
        if body: prev=parse_statements(body,nodes,edges,node_id,x+60,ny,depth+1) or prev
        if orelse:
            else_id=nid(); en=make_node(else_id,"else","else",300+dx+200,y+i*110)
            nodes.append(en); edges.append(make_edge(node_id,else_id,"No","#f87171"))
            parse_statements(orelse,nodes,edges,else_id,x+260,ny,depth+1)
        if handlers:
            for h in handlers:
                if isinstance(h,ast.ExceptHandler):
                    exc=safe_unparse(h.type) if h.type else "Exception"
                    hlabel=f"except {exc}"+(f" as {h.name}" if h.name else "")
                    hid=nid(); hn=make_node(hid,hlabel,"except",300+dx+200,y+i*110)
                    nodes.append(hn); edges.append(make_edge(node_id,hid,"","#f87171",dashed=True))
                    if h.body: parse_statements(h.body,nodes,edges,hid,x+260,ny,depth+1)
    return prev

def build_graph_from_ast(code: str):
    _ctr[0]=0; nodes=[]; edges=[]
    tree=ast.parse(code)
    sid=nid()
    nodes.append({"id":sid,"type":"input","data":{"label":"▶  START"},"position":{"x":300,"y":0},
                  "style":{"background":"#0f172a","color":"#fff","border":"2px solid #38bdf8",
                           "borderRadius":"50px","padding":"12px 28px","fontWeight":"bold","fontSize":"14px",
                           "textAlign":"center","minWidth":"140px","boxShadow":"0 0 24px #38bdf888",
                           "fontFamily":"'Fira Code',monospace"}})
    last=parse_statements(tree.body,nodes,edges,sid,300,110)
    eid=nid()
    nodes.append({"id":eid,"type":"output","data":{"label":"■  END"},"position":{"x":300,"y":len(nodes)*110+110},
                  "style":{"background":"#0f172a","color":"#fff","border":"2px solid #f43f5e",
                           "borderRadius":"50px","padding":"12px 28px","fontWeight":"bold","fontSize":"14px",
                           "textAlign":"center","minWidth":"140px","boxShadow":"0 0 24px #f43f5e88",
                           "fontFamily":"'Fira Code',monospace"}})
    edges.append(make_edge(last,eid,"","#f43f5e"))
    return nodes,edges

def parse_js_to_graph(code: str):
    _ctr[0]=0; nodes=[]; edges=[]
    lines=code.splitlines()
    CX=400  # center x for all nodes — keeps flowchart in middle
    start_id=nid()
    start_style={"background":"#0f172a","color":"#fff","border":"2px solid #38bdf8",
                 "borderRadius":"50px","padding":"12px 36px","fontWeight":"bold","fontSize":"15px",
                 "textAlign":"center","minWidth":"160px","boxShadow":"0 0 28px #38bdf8aa",
                 "fontFamily":"'Fira Code',monospace"}
    nodes.append({"id":start_id,"type":"input","data":{"label":"▶  START"},
                  "position":{"x":CX,"y":0},"style":start_style})
    prev_id=start_id; y=150
    for line in lines:
        stripped=line.strip()
        # skip empty lines, comments, and closing braces
        if not stripped: continue
        if stripped.startswith("//"): continue
        if stripped in ["}","};","});","})",")"]: continue
        node_id=nid()
        # Truncate long labels cleanly
        label=stripped[:55]+("…" if len(stripped)>55 else "")
        color="#64748b"; bg="#1e293b"; shape="default"
        if re.match(r"^(if|else if)\s*\(",stripped):
            color="#fca5a5"; bg="#7f1d1d"; shape="diamond"
            label=re.sub(r"\s*\{.*","",stripped).strip()
        elif re.match(r"^else\s*\{?$",stripped.strip()):
            color="#93c5fd"; bg="#1e3a5f"; shape="diamond"; label="else"
        elif re.match(r"^for\s*\(",stripped):
            color="#34d399"; bg="#064e3b"; shape="diamond"
            label=re.sub(r"\s*\{.*","",stripped).strip()
        elif re.match(r"^while\s*\(",stripped):
            color="#34d399"; bg="#064e3b"; shape="diamond"
            label=re.sub(r"\s*\{.*","",stripped).strip()
        elif re.match(r"^(function\s+\w+|const\s+\w+\s*=\s*(async\s*)?\(|const\s+\w+\s*=\s*function|let\s+\w+\s*=\s*(async\s*)?function)",stripped):
            color="#a78bfa"; bg="#4c1d95"
            label=re.sub(r"\{.*","",stripped).strip()[:55]
        elif re.match(r"^return\s",stripped):
            color="#fb923c"; bg="#7c2d12"
        elif re.match(r"^(console\.log|console\.warn|console\.error|alert|document\.)\s*\(",stripped):
            color="#60a5fa"; bg="#1e3a5f"; shape="parallelogram"
        elif re.match(r"^(const|let|var)\s",stripped):
            color="#38bdf8"; bg="#0c4a6e"
        elif re.match(r"^(throw|try|catch)\s*",stripped):
            color="#f87171"; bg="#450a0a"
        node_style={"background":bg,"color":"#fff","border":f"2px solid {color}",
                    "borderRadius":"10px","padding":"12px 20px","fontSize":"13px",
                    "textAlign":"center","minWidth":"220px","maxWidth":"340px",
                    "fontFamily":"'Fira Code',monospace",
                    "boxShadow":f"0 0 16px {color}55","wordBreak":"break-word"}
        if shape=="diamond":
            nodes.append({"id":node_id,"type":"diamond",
                          "data":{"label":label,"color":color,"bg":bg},
                          "position":{"x":CX,"y":y}})
        elif shape=="parallelogram":
            nodes.append({"id":node_id,"type":"parallelogram",
                          "data":{"label":label,"color":color,"bg":bg},
                          "position":{"x":CX,"y":y}})
        else:
            nodes.append({"id":node_id,"data":{"label":label},
                          "position":{"x":CX,"y":y},"style":node_style})
        edges.append(make_edge(prev_id,node_id,color=color))
        prev_id=node_id; y+=150
    end_id=nid()
    end_style={"background":"#0f172a","color":"#fff","border":"2px solid #f43f5e",
               "borderRadius":"50px","padding":"12px 36px","fontWeight":"bold","fontSize":"15px",
               "textAlign":"center","minWidth":"160px","boxShadow":"0 0 28px #f43f5eaa",
               "fontFamily":"'Fira Code',monospace"}
    nodes.append({"id":end_id,"type":"output","data":{"label":"■  END"},
                  "position":{"x":CX,"y":y},"style":end_style})
    edges.append(make_edge(prev_id,end_id,"","#f43f5e"))
    return nodes,edges

def explain_code(code: str, language: str) -> list:
    parts=[]
    if language=="javascript":
        lines=[l.strip() for l in code.splitlines() if l.strip() and not l.strip().startswith("//")]
        funcs  = [l for l in lines if re.match(r"^(function|const\s+\w+\s*=.*=>|const\s+\w+\s*=\s*function)", l)]
        loops  = [l for l in lines if re.match(r"^(for|while)\s*\(", l)]
        conds  = [l for l in lines if re.match(r"^(if|else if)\s*\(", l)]
        vars_  = [l for l in lines if re.match(r"^(const|let|var)\s", l)]
        logs   = [l for l in lines if re.match(r"^console\.log\(", l)]
        rets   = [l for l in lines if re.match(r"^return\s", l)]
        summary_parts = []
        if vars_:   summary_parts.append(f"{len(vars_)} variable(s)")
        if funcs:   summary_parts.append(f"{len(funcs)} function(s)")
        if conds:   summary_parts.append(f"{len(conds)} condition(s)")
        if loops:   summary_parts.append(f"{len(loops)} loop(s)")
        if logs:    summary_parts.append(f"{len(logs)} console.log call(s)")
        summary = ", ".join(summary_parts) if summary_parts else "basic statements"
        parts.append({"title":"📝 What this code does","body":f"This JavaScript program contains {summary}."})
        steps = []; sn = 1
        for l in lines:
            if re.match(r"^(const|let|var)\s", l):
                parts_split = l.split("=", 1)
                vname = parts_split[0].replace("const","").replace("let","").replace("var","").strip()
                val = parts_split[1].strip().rstrip(";") if len(parts_split)>1 else ""
                steps.append(f"Step {sn}: Creates a variable \"{vname}\" with value {val}."); sn+=1
            elif re.match(r"^function\s", l):
                fname = re.sub(r"function\s+(\w+).*", r"\1", l)
                steps.append(f"Step {sn}: Defines a function called \"{fname}\"."); sn+=1
            elif re.match(r"^(if|else if)\s*\(", l):
                cond = re.sub(r"^(else )?if\s*\((.*)\).*", r"\2", l)
                steps.append(f"Step {sn}: Checks condition: {cond}."); sn+=1
            elif l.startswith("else"):
                steps.append(f"Step {sn}: Otherwise (else branch) executes."); sn+=1
            elif re.match(r"^for\s*\(", l):
                steps.append(f"Step {sn}: Loops through: {l[:50]}."); sn+=1
            elif re.match(r"^while\s*\(", l):
                steps.append(f"Step {sn}: Repeats while condition is true."); sn+=1
            elif re.match(r"^console\.log\(", l):
                val = re.sub(r"^console\.log\((.*)\).*", r"\1", l)
                steps.append(f"Step {sn}: Prints {val} to the console."); sn+=1
            elif re.match(r"^return\s", l):
                val = l.replace("return","").strip().rstrip(";")
                steps.append(f"Step {sn}: Returns {val}."); sn+=1
        if steps: parts.append({"title":"📋 How it works step by step","body":"\n".join(steps)})
        concepts = []
        if funcs:  concepts.append("Functions (reusable blocks of code)")
        if loops:  concepts.append("Loops (repeating tasks)")
        if conds:  concepts.append("Conditionals (if/else decisions)")
        if vars_:  concepts.append("Variables (storing data)")
        if rets:   concepts.append("Return values")
        if concepts: parts.append({"title":"💡 Key concepts used","body":"\n".join(f"• {c}" for c in concepts)})
        return parts
    try: tree=ast.parse(code)
    except: return [{"title":"⚠️ Parse Error","body":"Could not analyse this code."}]
    funcs=[n for n in ast.walk(tree) if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef))]
    classes=[n for n in ast.walk(tree) if isinstance(n,ast.ClassDef)]
    loops=[n for n in ast.walk(tree) if isinstance(n,(ast.For,ast.While))]
    conditions=[n for n in ast.walk(tree) if isinstance(n,ast.If)]
    imports=[n for n in ast.walk(tree) if isinstance(n,(ast.Import,ast.ImportFrom))]
    inames=[]
    for n in imports:
        if isinstance(n,ast.Import): inames+=[a.name for a in n.names]
        elif n.module: inames.append(n.module)
    summary=[]
    if funcs: summary.append(f"{len(funcs)} function(s)")
    if classes: summary.append(f"{len(classes)} class(es)")
    if loops: summary.append(f"{len(loops)} loop(s)")
    if conditions: summary.append(f"{len(conditions)} condition(s)")
    if inames: summary.append(f"uses: {', '.join(inames[:3])}")
    parts.append({"title":"📝 What this code does","body":"This Python program has "+(", ".join(summary) if summary else "basic statements")+"."})
    steps=[]; sn=1
    for node in ast.walk(tree):
        if isinstance(node,ast.FunctionDef):
            args=", ".join(a.arg for a in node.args.args)
            steps.append(f'Step {sn}: It defines a function called "{node.name}" that takes ({args}).'); sn+=1
        elif isinstance(node,ast.ClassDef):
            steps.append(f'Step {sn}: It creates a class called "{node.name}".'); sn+=1
        elif isinstance(node,ast.For):
            steps.append(f'Step {sn}: It loops through {safe_unparse(node.iter)}.'); sn+=1
        elif isinstance(node,ast.While):
            steps.append(f'Step {sn}: It keeps repeating while {safe_unparse(node.test)} is true.'); sn+=1
        elif isinstance(node,ast.If):
            steps.append(f'Step {sn}: It checks: {safe_unparse(node.test)}.'); sn+=1
        elif isinstance(node,ast.Expr) and isinstance(node.value,ast.Call):
            func=node.value.func
            fname=func.id if isinstance(func,ast.Name) else getattr(func,"attr","")
            args=", ".join(safe_unparse(a) for a in node.value.args[:2])
            if fname=="print": steps.append(f'Step {sn}: It shows "{args}" on screen.'); sn+=1
            elif fname=="input": steps.append(f'Step {sn}: It waits for user input.'); sn+=1
            else: steps.append(f'Step {sn}: It calls "{fname}".'); sn+=1
        elif isinstance(node,ast.Try):
            steps.append(f'Step {sn}: It tries something that might fail and handles errors.'); sn+=1
    if steps: parts.append({"title":"📋 How it works","body":"\n".join(steps)})
    concepts=[]
    if classes: concepts.append("Object-Oriented Programming")
    if loops: concepts.append("Loops")
    if conditions: concepts.append("Conditionals (if/else)")
    if any(isinstance(n,ast.Try) for n in ast.walk(tree)): concepts.append("Error Handling")
    if inames: concepts.append(f"Libraries: {', '.join(inames[:3])}")
    if concepts: parts.append({"title":"💡 Key concepts","body":"\n".join(f"• {c}" for c in concepts)})
    return parts

def scan_input_calls(code: str) -> list:
    try: tree=ast.parse(code)
    except: return []
    inputs=[]
    for node in ast.walk(tree):
        if isinstance(node,ast.Call):
            func=node.func
            fname=func.id if isinstance(func,ast.Name) else (func.attr if isinstance(func,ast.Attribute) else "")
            if fname=="input":
                prompt=""
                if node.args:
                    try: prompt=ast.literal_eval(node.args[0])
                    except: prompt=safe_unparse(node.args[0])
                inputs.append({"index":len(inputs),"prompt":str(prompt)})
    return inputs

def run_code_safe(code: str, user_inputs: list=[]) -> dict:
    import math as _math,random as _random,re as _re
    import datetime as _dt,json as _json
    import collections as _col,itertools as _it,functools as _ft,string as _str
    out=io.StringIO(); err=io.StringIO()
    old_out,old_err=sys.stdout,sys.stderr
    status="success"; error=None
    start=datetime.utcnow()
    queue=list(user_inputs); prompts_hit=[]
    def mock_input(prompt=""):
        prompts_hit.append(str(prompt))
        val=queue.pop(0) if queue else ""
        sys.stdout.write(f"{prompt}{val}\n")
        return str(val)
    safe_builtins={"print":print,"input":mock_input,"int":int,"float":float,"str":str,"bool":bool,
        "complex":complex,"bytes":bytes,"bytearray":bytearray,"list":list,"dict":dict,"tuple":tuple,
        "set":set,"frozenset":frozenset,"range":range,"len":len,"type":type,"enumerate":enumerate,
        "zip":zip,"map":map,"filter":filter,"reversed":reversed,"sorted":sorted,"iter":iter,"next":next,
        "sum":sum,"min":min,"max":max,"abs":abs,"round":round,"divmod":divmod,"pow":pow,"hash":hash,
        "repr":repr,"hex":hex,"oct":oct,"bin":bin,"chr":chr,"ord":ord,"format":format,"any":any,"all":all,
        "callable":callable,"id":id,"isinstance":isinstance,"issubclass":issubclass,"hasattr":hasattr,
        "getattr":getattr,"setattr":setattr,"delattr":delattr,"vars":vars,"dir":dir,
        "Exception":Exception,"ValueError":ValueError,"TypeError":TypeError,"KeyError":KeyError,
        "IndexError":IndexError,"AttributeError":AttributeError,"NameError":NameError,
        "ZeroDivisionError":ZeroDivisionError,"StopIteration":StopIteration,"RuntimeError":RuntimeError,
        "NotImplementedError":NotImplementedError,"OSError":OSError,"ArithmeticError":ArithmeticError,
        "OverflowError":OverflowError,"AssertionError":AssertionError,"RecursionError":RecursionError,
        "True":True,"False":False,"None":None,"__name__":"__main__","__build_class__":__build_class__}
    safe_globals={"__builtins__":safe_builtins,"math":_math,"random":_random,"re":_re,"datetime":_dt,
                  "json":_json,"collections":_col,"itertools":_it,"functools":_ft,"string":_str}
    try:
        sys.stdout=out; sys.stderr=err
        exec(compile(code,"<ragsy>","exec"),safe_globals)
    except SystemExit: status="exited"
    except RecursionError:
        status="error"; error="RecursionError: maximum recursion depth exceeded."; print(error,file=err)
    except MemoryError:
        status="error"; error="MemoryError: too much memory."; print(error,file=err)
    except Exception:
        status="error"; tb=traceback.format_exc()
        tb=re.sub(r'  File ".*?main\.py".*\n.*\n','',tb)
        tb=tb.replace('File "<ragsy>"','File "<your_code>"')
        error=tb; print(tb,file=err)
    finally:
        sys.stdout=old_out; sys.stderr=old_err
    elapsed=int((datetime.utcnow()-start).total_seconds()*1000)
    return {"status":status,"stdout":out.getvalue(),"stderr":err.getvalue(),
            "elapsed_ms":elapsed,"error":error,"prompts_hit":prompts_hit}

def run_js_safe(code: str, user_inputs: list=[]) -> dict:
    try:
        subprocess.run(["node","--version"],capture_output=True,timeout=3)
    except (FileNotFoundError,subprocess.TimeoutExpired):
        return {"status":"error","stdout":"","stderr":"Node.js not found.",
                "elapsed_ms":0,"error":"Node.js not installed","prompts_hit":[]}
    header=(
        "const __inputs="+json.dumps([str(x) for x in user_inputs])+";\n"
        "let __inputIdx=0;\n"
        "const prompt=(msg='')=>{const v=__inputs[__inputIdx++]??'';if(msg)process.stdout.write(String(msg));return String(v);};\n"
        "const input=(msg='')=>prompt(msg);\n"
    )
    full_code=header+"\n"+code
    with tempfile.NamedTemporaryFile(suffix=".js",delete=False,mode='w',encoding='utf-8') as f:
        f.write(full_code); fname=f.name
    start=datetime.utcnow()
    try:
        result=subprocess.run(["node",fname],capture_output=True,text=True,timeout=5,encoding='utf-8')
        elapsed=int((datetime.utcnow()-start).total_seconds()*1000)
        stderr=result.stderr.strip()
        if stderr:
            stderr=re.sub(r"at .+\n?","",stderr).strip()
            stderr=re.sub(r"[A-Za-z]?:?[/\\]tmp[/\\][^\s:]+:","line ",stderr)
            stderr=re.sub(r"[A-Za-z]:\\Users\\[^\\]+\\AppData\\Local\\Temp\\[^\s:]+:","line ",stderr)
            stderr=re.sub(r"\n{2,}","\n",stderr).strip()
        return {"status":"error" if result.returncode!=0 else "success","stdout":result.stdout,
                "stderr":stderr,"elapsed_ms":elapsed,"error":stderr if result.returncode!=0 else None,"prompts_hit":[]}
    except subprocess.TimeoutExpired:
        return {"status":"error","stdout":"","stderr":"Timeout: exceeded 5 seconds.",
                "elapsed_ms":5000,"error":"Timeout","prompts_hit":[]}
    finally:
        try: os.unlink(fname)
        except: pass

# ══════════════════════════════════════════════════════════════════
# CODE ROUTES
# ══════════════════════════════════════════════════════════════════
@app.post("/scan-inputs")
async def scan_inputs(request: RunRequest):
    code=request.code.strip()
    if not code: return {"inputs":[]}
    if request.language=="javascript": return {"inputs":[]}
    return {"inputs":scan_input_calls(code)}

@app.post("/run")
async def run_code(request: RunRequest, token: str=""):
    code=request.code.strip(); lang=request.language or "python"
    if not code: raise HTTPException(400,detail="Code cannot be empty")
    if lang=="javascript":
        result=run_js_safe(code,request.user_inputs or [])
    else:
        try: ast.parse(code)
        except SyntaxError as e:
            return {"status":"error","stdout":"","stderr":f"SyntaxError at line {e.lineno}: {e.msg}",
                    "elapsed_ms":0,"error":f"SyntaxError: {e.msg}","prompts_hit":[]}
        result=run_code_safe(code,request.user_inputs or [])
    rec=sessions_db.get(token)
    if rec: db_log(rec["user_id"],f"run_{lang}")
    return result

@app.post("/visualize")
async def visualize(request: CodeRequest, token: str=""):
    code=request.code.strip(); lang=request.language or "python"
    if not code: raise HTTPException(400,detail="Code cannot be empty")
    try:
        if lang=="javascript":
            nodes,edges=parse_js_to_graph(code)
        else:
            nodes,edges=build_graph_from_ast(code)
        explanation=explain_code(code,lang)
        rec=sessions_db.get(token)
        if rec:
            try:
                cid=db_submission_save(rec["user_id"],code,lang)
                db_flowchart_save(cid,json.dumps({"nodes":nodes,"edges":edges}))
                db_explanation_save(cid,json.dumps(explanation))
                db_log(rec["user_id"],"visualize")
            except Exception as e:
                print(f"[DB SAVE WARN] {e}")
        return {"nodes":nodes,"edges":edges,"explanation":explanation,
                "stats":{"node_count":len(nodes),"edge_count":len(edges),"language":lang}}
    except SyntaxError as e:
        raise HTTPException(422,detail=f"SyntaxError at line {e.lineno}: {e.msg}")
    except Exception as e:
        raise HTTPException(500,detail=f"Visualisation error: {e}")

@app.get("/activities")
def get_activities(token: str, limit: int=10):
    user=user_by_token(token); uid=user["user_id"]
    try:
        conn=get_db(); cur=conn.cursor()
        cur.execute("""
            SELECT cs.code_id, cs.source_code, cs.language, cs.upload_time,
                   f.generated_time, e.download_count, e.file_path
            FROM code_submissions cs
            LEFT JOIN flowcharts f    ON f.code_id=cs.code_id
            LEFT JOIN explanations e  ON e.code_id=cs.code_id
            WHERE cs.user_id=%s
            ORDER BY cs.upload_time DESC
            LIMIT %s
        """, (uid, limit))
        rows=cur.fetchall(); conn.close()
        activities=[]
        for r in rows:
            expl=[]
            try:
                if r["file_path"]: expl=json.loads(r["file_path"])
            except: pass
            full_code=decrypt_code(r["source_code"])
            activities.append({
                "code_id":       r["code_id"],
                "source_code":   full_code[:200]+("..." if len(full_code)>200 else ""),
                "source_code_full": full_code,
                "language":      r["language"],
                "upload_time":   str(r["upload_time"]),
                "flowchart_time":str(r["generated_time"]) if r["generated_time"] else None,
                "downloads":     r["download_count"] or 0,
                "explanation":   expl,
            })
        return {"activities":activities,"count":len(activities)}
    except Exception as e:
        raise HTTPException(500,detail=f"DB error: {e}")

@app.get("/submissions")
def get_submissions(token: str):
    user=user_by_token(token)
    return {"submissions":db_submissions_by_user(user["user_id"])}

@app.delete("/auth/account")
def delete_account(token: str):
    user=user_by_token(token); uid=user["user_id"]
    conn=get_db()
    try:
        cur=conn.cursor()
        cur.execute("DELETE FROM otp_verification WHERE user_id=%s",(uid,))
        cur.execute("DELETE FROM user_actions_log WHERE user_id=%s",(uid,))
        cur.execute("DELETE FROM reports WHERE user_id=%s",(uid,))
        cur.execute("""DELETE FROM explanations WHERE code_id IN
                       (SELECT code_id FROM code_submissions WHERE user_id=%s)""",(uid,))
        cur.execute("""DELETE FROM flowcharts WHERE code_id IN
                       (SELECT code_id FROM code_submissions WHERE user_id=%s)""",(uid,))
        cur.execute("DELETE FROM code_submissions WHERE user_id=%s",(uid,))
        cur.execute("DELETE FROM users WHERE user_id=%s",(uid,))
        conn.commit()
    finally:
        conn.close()
    sessions_db.pop(token,None)
    return {"message":"Account deleted."}

# ══════════════════════════════════════════════════════════════════
# TASKS
# ══════════════════════════════════════════════════════════════════
PYTHON_TASKS=[
    {"id":1,"title":"Print Hello World","description":"Write a program that prints 'Hello, World!' to the screen.","hint":"Use the print() function. Example: print('your text here')","expected_output":"Hello, World!","time_seconds":120,"difficulty":"Beginner","starter_code":"# Write your first Python program\n"},
    {"id":2,"title":"Add Two Numbers","description":"Create variables num1=10 and num2=20, add them and print the result.","hint":"Use the + operator. Store the result in a variable called 'result' and print it.","expected_output":"30","time_seconds":180,"difficulty":"Beginner","starter_code":"num1 = 10\nnum2 = 20\n# Add and print the result\n"},
    {"id":3,"title":"Even or Odd","description":"Write a program that checks if the number 7 is even or odd and prints 'Even' or 'Odd'.","hint":"Use the modulus operator %. If num % 2 == 0, it is even.","expected_output":"Odd","time_seconds":240,"difficulty":"Beginner","starter_code":"num = 7\n# Check if num is even or odd\n"},
    {"id":4,"title":"Count 1 to 5","description":"Use a for loop to print numbers from 1 to 5, each on a new line.","hint":"Use range(1, 6) inside a for loop.","expected_output":"1\n2\n3\n4\n5","time_seconds":240,"difficulty":"Beginner","starter_code":"# Use a for loop to count from 1 to 5\n"},
    {"id":5,"title":"Simple Calculator Function","description":"Write a function called add(a, b) that returns the sum. Call it with 4 and 6 and print the result.","hint":"Define using def add(a, b): and use return a + b. Then call print(add(4, 6)).","expected_output":"10","time_seconds":300,"difficulty":"Beginner","starter_code":"# Define your add function here\n\n# Call the function and print the result\n"},
    {"id":6,"title":"Find the Largest Number","description":"Given numbers = [3, 7, 1, 9, 4], print the largest without using max().","hint":"Use a loop and a variable to track the largest number.","expected_output":"9","time_seconds":360,"difficulty":"Intermediate","starter_code":"numbers = [3, 7, 1, 9, 4]\n# Find the largest using a loop\n"},
    {"id":7,"title":"Reverse a String","description":"Reverse the string 'Ragsy' and print it.","hint":"Use slicing: text[::-1] reverses any string.","expected_output":"ysgar","time_seconds":240,"difficulty":"Intermediate","starter_code":"text = 'Ragsy'\n# Reverse the string and print it\n"},
    {"id":8,"title":"FizzBuzz","description":"Print numbers 1 to 20. Multiples of 3 → 'Fizz', of 5 → 'Buzz', both → 'FizzBuzz'.","hint":"Check % 15 == 0 first for FizzBuzz.","expected_output":"1\n2\nFizz\n4\nBuzz","time_seconds":480,"difficulty":"Intermediate","starter_code":"for i in range(1, 21):\n    pass\n"},
    {"id":9,"title":"Count Vowels","description":"Write count_vowels(text) that returns the number of vowels. Test with 'Hello World'.","hint":"Loop through each character and check if it is in 'aeiouAEIOU'.","expected_output":"3","time_seconds":420,"difficulty":"Intermediate","starter_code":"def count_vowels(text):\n    pass\n\nprint(count_vowels('Hello World'))\n"},
    {"id":10,"title":"Fibonacci Sequence","description":"Print the first 8 Fibonacci numbers (0 1 1 2 3 5 8 13).","hint":"Start with a=0 and b=1. Each iteration update [a,b]=[b,a+b].","expected_output":"0\n1\n1\n2\n3\n5\n8\n13","time_seconds":480,"difficulty":"Advanced","starter_code":"a, b = 0, 1\n# Use a loop 8 times\n"},
]

JAVASCRIPT_TASKS=[
    {"id":1,"title":"Print Hello World","description":"Write a program that prints 'Hello, World!' to the console.","hint":"Use console.log('Hello, World!')","expected_output":"Hello, World!","time_seconds":120,"difficulty":"Beginner","starter_code":"// Write your first JavaScript program\n"},
    {"id":2,"title":"Add Two Numbers","description":"Create num1=10 and num2=20, add and print the result.","hint":"Use let, + operator and console.log().","expected_output":"30","time_seconds":180,"difficulty":"Beginner","starter_code":"let num1 = 10;\nlet num2 = 20;\n// Add and print\n"},
    {"id":3,"title":"Even or Odd","description":"Check if 7 is even or odd and print 'Even' or 'Odd'.","hint":"Use % operator. If num % 2 === 0 it is even.","expected_output":"Odd","time_seconds":240,"difficulty":"Beginner","starter_code":"let num = 7;\n// Check even or odd\n"},
    {"id":4,"title":"Count 1 to 5","description":"Use a for loop to print numbers 1 to 5.","hint":"for(let i=1; i<=5; i++) { console.log(i); }","expected_output":"1\n2\n3\n4\n5","time_seconds":240,"difficulty":"Beginner","starter_code":"// Use a for loop\n"},
    {"id":5,"title":"Simple Function","description":"Write add(a,b) returning the sum. Call with 4 and 6 and print.","hint":"function add(a,b){return a+b;} then console.log(add(4,6))","expected_output":"10","time_seconds":300,"difficulty":"Beginner","starter_code":"// Define add function\n\n// Call and print\n"},
    {"id":6,"title":"Find the Largest Number","description":"Given [3,7,1,9,4], print the largest without Math.max().","hint":"Use a for loop and 'largest' variable.","expected_output":"9","time_seconds":360,"difficulty":"Intermediate","starter_code":"let numbers=[3,7,1,9,4];\n// Find largest with a loop\n"},
    {"id":7,"title":"Reverse a String","description":"Reverse 'Ragsy' and print it.","hint":"split('').reverse().join('')","expected_output":"ysgar","time_seconds":240,"difficulty":"Intermediate","starter_code":"let text='Ragsy';\n// Reverse and print\n"},
    {"id":8,"title":"FizzBuzz","description":"Print 1-20, Fizz for 3, Buzz for 5, FizzBuzz for both.","hint":"Check % 15 === 0 first.","expected_output":"1\n2\nFizz\n4\nBuzz","time_seconds":480,"difficulty":"Intermediate","starter_code":"for(let i=1;i<=20;i++){\n    // your code\n}\n"},
    {"id":9,"title":"Count Vowels","description":"Write countVowels(text) returning vowel count. Test 'Hello World'.","hint":"Loop each char and use includes() with 'aeiouAEIOU'.","expected_output":"3","time_seconds":420,"difficulty":"Intermediate","starter_code":"function countVowels(text){\n}\nconsole.log(countVowels('Hello World'));\n"},
    {"id":10,"title":"Fibonacci Sequence","description":"Print first 8 Fibonacci numbers.","hint":"Start a=0,b=1. Each iteration: print a, [a,b]=[b,a+b].","expected_output":"0\n1\n1\n2\n3\n5\n8\n13","time_seconds":480,"difficulty":"Advanced","starter_code":"let a=0,b=1;\n// Loop 8 times\n"},
]

@app.get("/tasks")
def get_tasks(language: str="python"):
    if language.lower()=="javascript":
        return {"tasks":JAVASCRIPT_TASKS,"language":"javascript"}
    return {"tasks":PYTHON_TASKS,"language":"python"}

@app.post("/tasks/hint")
async def get_task_hint(request: dict):
    task_id=request.get("task_id"); language=request.get("language","python")
    tasks=JAVASCRIPT_TASKS if language=="javascript" else PYTHON_TASKS
    task=next((t for t in tasks if t["id"]==task_id),None)
    if not task: raise HTTPException(404,detail="Task not found")
    return {"hint":task["hint"],"starter_code":task["starter_code"]}

if __name__=="__main__":
    test_db_connection()
    import uvicorn
    uvicorn.run("main:app",host="0.0.0.0",port=int(os.getenv("PORT",8000)),reload=False)
