"""Ragsy Backend v3 + SQL Server DB — All Python programs execute, OTP via Fast2SMS/Twilio"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
import ast, random, string, sys, io, traceback, re, hashlib, json
from datetime import datetime, timedelta
import os, requests as http_requests
import pyodbc

# ══════════════════════════════════════════════════════════════════
# SQL SERVER CONNECTION
# Change DB_SERVER to your exact server name shown in SSMS login
# ══════════════════════════════════════════════════════════════════
DB_SERVER = os.getenv("DB_SERVER", r"RANJAN\RANJANBABU")   # <-- edit this
DB_NAME   = os.getenv("DB_NAME",   "code_architecture_visualizer")

def get_db():
    """
    Opens a pyodbc connection using Windows Authentication.
    No username/password needed — uses your Windows login.
    """
    conn_str = (
        f"DRIVER={{ODBC Driver 17 for SQL Server}};"
        f"SERVER={DB_SERVER};"
        f"DATABASE={DB_NAME};"
        f"Trusted_Connection=yes;"
    )
    return pyodbc.connect(conn_str)

def test_db_connection():
    """Runs at startup. Prints success or failure message."""
    try:
        conn = get_db()
        cur  = conn.cursor()
        cur.execute("SELECT @@VERSION")
        ver  = cur.fetchone()[0].split("\n")[0]
        conn.close()
        print(f"[DB OK ] Connected → {ver}")
        return True
    except Exception as e:
        print(f"[DB ERR] Connection FAILED: {e}")
        print(f"         Server : {DB_SERVER}")
        print(f"         DB     : {DB_NAME}")
        print(f"         Fix    : Check server name matches SSMS login window")
        return False

def hash_pw(pw: str) -> str:
    """SHA-256 — never store plain text passwords in DB."""
    return hashlib.sha256(pw.encode()).hexdigest()

# ══════════════════════════════════════════════════════════════════
# DB HELPER FUNCTIONS — one per table, matching your ERD schema
# ══════════════════════════════════════════════════════════════════

# ── USERS table ───────────────────────────────────────────────────
def db_user_create(username, mobile_no, pw_hash) -> int:
    """INSERT user. Returns new user_id from DB."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO USERS (username, mobile_no, password, created_at) "
            "OUTPUT INSERTED.user_id VALUES (?,?,?,?)",
            username, mobile_no, pw_hash, datetime.utcnow()
        )
        uid = cur.fetchone()[0]
        conn.commit()
        return uid
    finally:
        conn.close()

def db_user_by_mobile(mobile_no) -> dict | None:
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT user_id,username,mobile_no,password,created_at "
            "FROM USERS WHERE mobile_no=?", mobile_no)
        r = cur.fetchone()
        if not r: return None
        return {"user_id":r[0],"username":r[1],"mobile_no":r[2],
                "password":r[3],"created_at":str(r[4])}
    finally:
        conn.close()

def db_user_by_username(username) -> dict | None:
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT user_id,username,mobile_no,password "
            "FROM USERS WHERE username=?", username)
        r = cur.fetchone()
        if not r: return None
        return {"user_id":r[0],"username":r[1],"mobile_no":r[2],"password":r[3]}
    finally:
        conn.close()

def db_user_by_id(uid) -> dict | None:
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT user_id,username,mobile_no FROM USERS WHERE user_id=?", uid)
        r = cur.fetchone()
        if not r: return None
        return {"user_id":r[0],"username":r[1],"mobile_no":r[2]}
    finally:
        conn.close()

# ── OTP_VERIFICATION table ────────────────────────────────────────
def db_otp_upsert(user_id, otp_code, expiry_time):
    """Delete existing OTP for user, then insert fresh one."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM OTP_VERIFICATION WHERE user_id=?", user_id)
        cur.execute(
            "INSERT INTO OTP_VERIFICATION (user_id,otp_code,expiry_time,status) "
            "VALUES (?,?,?,'pending')",
            user_id, otp_code, expiry_time
        )
        conn.commit()
    finally:
        conn.close()

def db_otp_get(user_id) -> dict | None:
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT otp_id,user_id,otp_code,expiry_time,status "
            "FROM OTP_VERIFICATION WHERE user_id=?", user_id)
        r = cur.fetchone()
        if not r: return None
        return {"otp_id":r[0],"user_id":r[1],"otp_code":r[2],
                "expiry_time":r[3],"status":r[4]}
    finally:
        conn.close()

def db_otp_set_status(user_id, status):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("UPDATE OTP_VERIFICATION SET status=? WHERE user_id=?", status, user_id)
        conn.commit()
    finally:
        conn.close()

# ── CODE_SUBMISSIONS table ────────────────────────────────────────
def db_submission_save(user_id, source_code, language) -> int:
    """INSERT submission. Returns new code_id from DB."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO CODE_SUBMISSIONS (user_id,source_code,language,upload_time) "
            "OUTPUT INSERTED.code_id VALUES (?,?,?,?)",
            user_id, source_code, language, datetime.utcnow()
        )
        cid = cur.fetchone()[0]
        conn.commit()
        return cid
    finally:
        conn.close()

def db_submissions_by_user(user_id) -> list:
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT code_id,source_code,language,upload_time FROM CODE_SUBMISSIONS "
            "WHERE user_id=? ORDER BY upload_time DESC", user_id)
        rows = cur.fetchall()
        return [{"code_id":r[0],"source_code":r[1][:120]+"...","language":r[2],"upload_time":str(r[3])} for r in rows]
    finally:
        conn.close()

# ── FLOWCHARTS table ──────────────────────────────────────────────
def db_flowchart_save(code_id, diagram_json: str):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO FLOWCHARTS (code_id,diagram_path,generated_time) VALUES (?,?,?)",
            code_id, diagram_json, datetime.utcnow()
        )
        conn.commit()
    finally:
        conn.close()

# ── EXPLANATIONS table ────────────────────────────────────────────
def db_explanation_save(code_id, explanation_text: str):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO EXPLANATIONS (code_id,file_path,download_count) VALUES (?,?,0)",
            code_id, explanation_text
        )
        conn.commit()
    finally:
        conn.close()

# ── USER_ACTIONS_LOG table ────────────────────────────────────────
def db_action_log(user_id):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO USER_ACTIONS_LOG (user_id,action_time) VALUES (?,?)",
            user_id, datetime.utcnow()
        )
        conn.commit()
    finally:
        conn.close()

# ── REPORTS table ─────────────────────────────────────────────────
def db_report_save(user_id, action_type):
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO REPORTS (user_id,action_type,action_time) VALUES (?,?,?)",
            user_id, action_type, datetime.utcnow()
        )
        conn.commit()
    finally:
        conn.close()

def db_log(user_id, action_type):
    """Write to USER_ACTIONS_LOG + REPORTS. Never crashes the API."""
    try:
        db_action_log(user_id)
        db_report_save(user_id, action_type)
    except Exception as e:
        print(f"[DB LOG WARNING] {e}")

# ── Session store (in-memory — no sessions table in your schema) ──
sessions_db = {}   # token -> user_id

def gen_token(user_id: int) -> str:
    t = "".join(random.choices(string.ascii_letters + string.digits, k=32))
    sessions_db[t] = user_id
    return t

def user_by_token(token: str) -> dict:
    uid = sessions_db.get(token)
    if not uid:
        raise HTTPException(401, detail="Invalid or expired token")
    user = db_user_by_id(uid)
    if not user:
        raise HTTPException(401, detail="User not found")
    return user

# ══════════════════════════════════════════════════════════════════
# FastAPI app
# ══════════════════════════════════════════════════════════════════
app = FastAPI(title="Ragsy API", version="3.1.0")
app.add_middleware(CORSMiddleware,
    allow_origins=["http://localhost:3000","http://127.0.0.1:3000"],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# ── SMS ───────────────────────────────────────────────────────────
FAST2SMS_KEY = os.getenv("FAST2SMS_API_KEY", "")
TWILIO_SID   = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM  = os.getenv("TWILIO_FROM_NUMBER", "")

def send_sms(to_number: str, otp: str) -> dict:
    digits   = re.sub(r"[^0-9]", "", to_number)
    indian10 = digits[-10:] if len(digits) >= 10 else digits
    message  = f"Your Ragsy OTP is {otp}. Valid for 5 minutes. Do not share."
    if FAST2SMS_KEY:
        try:
            r = http_requests.post(
                "https://www.fast2sms.com/dev/bulkV2",
                headers={"authorization": FAST2SMS_KEY},
                json={"route":"otp","variables_values":otp,"flash":0,"numbers":indian10},
                timeout=10)
            d = r.json()
            if d.get("return") == True:
                print(f"[SMS OK Fast2SMS] -> {indian10}")
                return {"sent":True,"provider":"fast2sms","error":None}
            print(f"[SMS FAIL Fast2SMS] {d}")
            return {"sent":False,"provider":"fast2sms","error":str(d.get("message",d))}
        except Exception as e:
            print(f"[SMS ERR Fast2SMS] {e}")
    if TWILIO_SID and TWILIO_TOKEN and TWILIO_FROM:
        try:
            from twilio.rest import Client
            Client(TWILIO_SID, TWILIO_TOKEN).messages.create(
                body=message, from_=TWILIO_FROM, to=to_number)
            print(f"[SMS OK Twilio] -> {to_number}")
            return {"sent":True,"provider":"twilio","error":None}
        except Exception as e:
            print(f"[SMS ERR Twilio] {e}")
            return {"sent":False,"provider":"twilio","error":str(e)}
    print(f"[DEV OTP] {to_number} => {otp}")
    return {"sent":False,"provider":"console","error":"No SMS provider configured"}

# ── Pydantic Models ───────────────────────────────────────────────
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
    code: str
    user_inputs: List[str] = []

def gen_otp(): return "".join(random.choices(string.digits, k=6))

# ══════════════════════════════════════════════════════════════════
# AUTH ROUTES — reading/writing real SQL Server DB
# ══════════════════════════════════════════════════════════════════
@app.get("/")
def root(): return {"status":"running","app":"Ragsy","version":"3.1.0"}

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

    otp    = gen_otp()
    expiry = datetime.utcnow() + timedelta(minutes=5)
    db_otp_upsert(uid, otp, expiry)

    sms = send_sms(data.mobile_no, otp)
    db_log(uid, "register")

    return {
        "message":   "Registered. OTP sent to your mobile.",
        "mobile_no": data.mobile_no,
        "sms_sent":  sms["sent"],
        "provider":  sms["provider"],
        "otp_code":  otp if not sms["sent"] else None,
        "expires_in": 300,
    }

@app.post("/auth/verify-otp")
def verify_otp(data: OTPVerifyRequest):
    user = db_user_by_mobile(data.mobile_no)
    if not user:
        raise HTTPException(404, detail="Mobile not found. Please register first.")
    rec = db_otp_get(user["user_id"])
    if not rec:
        raise HTTPException(400, detail="No OTP found. Please register again.")
    if rec["status"] == "verified":
        raise HTTPException(400, detail="OTP already used.")
    if datetime.utcnow() > rec["expiry_time"]:
        db_otp_set_status(user["user_id"], "expired")
        raise HTTPException(400, detail="OTP expired. Request a new one.")
    if rec["otp_code"] != data.otp_code:
        raise HTTPException(400, detail="Incorrect OTP. Please try again.")

    db_otp_set_status(user["user_id"], "verified")
    token = gen_token(user["user_id"])
    db_log(user["user_id"], "otp_verify")
    return {
        "message": "Mobile verified successfully.",
        "token":   token,
        "user":    {"username": user["username"], "mobile_no": user["mobile_no"]},
    }

@app.post("/auth/resend-otp")
def resend_otp(data: ResendOTPRequest):
    user = db_user_by_mobile(data.mobile_no)
    if not user:
        raise HTTPException(404, detail="Mobile not found. Please register first.")
    otp    = gen_otp()
    expiry = datetime.utcnow() + timedelta(minutes=5)
    db_otp_upsert(user["user_id"], otp, expiry)
    sms = send_sms(data.mobile_no, otp)
    return {
        "message":  "New OTP sent.",
        "sms_sent": sms["sent"],
        "provider": sms["provider"],
        "otp_code": otp if not sms["sent"] else None,
        "expires_in": 300,
    }

@app.post("/auth/login")
def login(data: LoginRequest):
    user = db_user_by_username(data.username)
    if not user:
        raise HTTPException(401, detail="Username not found")
    if user["password"] != hash_pw(data.password):
        raise HTTPException(401, detail="Incorrect password")
    rec = db_otp_get(user["user_id"])
    if not rec or rec["status"] != "verified":
        raise HTTPException(403, detail="Account not verified. Please verify your mobile OTP first.")
    token = gen_token(user["user_id"])
    db_log(user["user_id"], "login")
    return {
        "message": "Login successful",
        "token":   token,
        "user":    {"username": user["username"], "mobile_no": user["mobile_no"]},
    }

@app.post("/auth/logout")
def logout(data: LogoutRequest):
    uid = sessions_db.pop(data.token, None)
    if uid:
        db_log(uid, "logout")
    return {"message": "Logged out successfully"}

@app.get("/auth/me")
def get_me(token: str):
    user = user_by_token(token)
    return {"user_id": user["user_id"], "username": user["username"], "mobile_no": user["mobile_no"]}

# ══════════════════════════════════════════════════════════════════
# FLOWCHART ENGINE (unchanged)
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
        elif isinstance(stmt,ast.Raise): label=f"raise {safe_unparse(stmt.exc)}" if stmt.exc else "raise"; ck="raise"
        elif isinstance(stmt,ast.With): label=f"with {', '.join(safe_unparse(it.context_expr) for it in stmt.items)}"; ck="with"; body=stmt.body
        elif isinstance(stmt,ast.Delete): label="del "+", ".join(safe_unparse(t) for t in stmt.targets)
        elif isinstance(stmt,ast.Pass): label="pass"
        elif isinstance(stmt,ast.Break): label="⟵ break"; ck="for"
        elif isinstance(stmt,ast.Continue): label="↺ continue"; ck="for"
        elif isinstance(stmt,ast.Global): label="global "+", ".join(stmt.names)
        elif isinstance(stmt,ast.Nonlocal): label="nonlocal "+", ".join(stmt.names)
        elif isinstance(stmt,ast.Assert): label=f"assert {safe_unparse(stmt.test)}"; ck="try"
        elif isinstance(stmt,ast.Expr):
            if isinstance(stmt.value,ast.Call):
                func=stmt.value.func
                fname=func.id if isinstance(func,ast.Name) else (func.attr if isinstance(func,ast.Attribute) else "")
                args=", ".join(safe_unparse(a) for a in stmt.value.args)
                label=f"{fname}({args})"; ck="print" if fname in("print","input") else "call"
            else: label=safe_unparse(stmt); ck="call"
        else: label=type(stmt).__name__
        nodes.append(make_node(node_id,label,ck,x+dx,y+i*130))
        edges.append(make_edge(prev,node_id,color=NODE_COLORS.get(ck,NODE_COLORS["default"])["border"]))
        prev=node_id; cy=y+i*130+130
        if body:
            last=parse_statements(body,nodes,edges,node_id,x+80,cy,depth+1)
            prev=last or node_id
        if orelse:
            if len(orelse)==1 and isinstance(orelse[0],ast.If):
                eid=nid(); es=orelse[0]
                nodes.append(make_node(eid,f"elif {safe_unparse(es.test)}","elif",x+dx+280,y+i*130))
                edges.append(make_edge(node_id,eid,label="elif",color=NODE_COLORS["elif"]["border"],dashed=True))
                if es.body: parse_statements(es.body,nodes,edges,eid,x+360,cy,depth+2)
            else:
                eid=nid(); nodes.append(make_node(eid,"else","else",x+dx+280,y+i*130))
                edges.append(make_edge(node_id,eid,label="else",color=NODE_COLORS["else"]["border"],dashed=True))
                parse_statements(orelse,nodes,edges,eid,x+360,cy,depth+2)
        for h in handlers: parse_statements([h],nodes,edges,node_id,x+80,cy,depth+1)
        if finalbody:
            fid=nid(); fy=cy+130
            nodes.append(make_node(fid,"finally","try",x+dx,fy))
            edges.append(make_edge(node_id,fid,color=NODE_COLORS["try"]["border"]))
            parse_statements(finalbody,nodes,edges,fid,x+80,fy+130,depth+1); prev=fid
    return prev

def plain_english_explanation(code,tree):
    functions=[n for n in ast.walk(tree) if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef))]
    classes=[n for n in ast.walk(tree) if isinstance(n,ast.ClassDef)]
    imports=[n for n in ast.walk(tree) if isinstance(n,(ast.Import,ast.ImportFrom))]
    loops=[n for n in ast.walk(tree) if isinstance(n,(ast.For,ast.While))]
    conditions=[n for n in ast.walk(tree) if isinstance(n,ast.If)]
    prints=[n for n in ast.walk(tree) if isinstance(n,ast.Expr) and isinstance(getattr(n,"value",None),ast.Call)
            and isinstance(getattr(n.value,"func",None),ast.Name) and n.value.func.id=="print"]
    inputs_=[n for n in ast.walk(tree) if isinstance(n,ast.Call)
             and isinstance(getattr(n,"func",None),ast.Name) and n.func.id=="input"]
    inames=[]
    for n in imports:
        if isinstance(n,ast.Import): inames+=[a.name for a in n.names]
        else: inames+=[n.module or ""]
    inames=[i for i in dict.fromkeys(inames) if i]
    parts=[]
    intro=["This program"]
    if inputs_: intro.append("asks the user to enter some information,")
    if classes: intro.append(f"defines {'a class' if len(classes)==1 else 'classes'} called {' and '.join(c.name for c in classes)},")
    if functions and not classes: intro.append(f"defines reusable tasks called {' and '.join(f.name for f in functions[:3])},")
    if loops:
        fl=[n for n in loops if isinstance(n,ast.For)]; wl=[n for n in loops if isinstance(n,ast.While)]
        ld=[]
        if fl: ld.append(f"repeats steps {len(fl)} time(s) using a for-loop")
        if wl: ld.append(f"keeps looping until a condition is false")
        intro.append(", ".join(ld)+",")
    if conditions: intro.append(f"makes {'a decision' if len(conditions)==1 else str(len(conditions))+' decisions'} based on conditions,")
    intro.append("and displays results on the screen." if prints else "and produces a result.")
    what=re.sub(r",\s+and"," and"," ".join(intro))
    parts.append({"title":"🔍 What it does","body":what})
    steps=[]; sn=1
    for node in tree.body:
        if isinstance(node,(ast.Import,ast.ImportFrom)) and sn==1:
            steps.append(f"Step {sn}: It loads tools it needs ({', '.join(inames[:4])}) to help with the work."); sn+=1; break
    for node in tree.body:
        if isinstance(node,ast.ClassDef):
            methods=[n.name for n in ast.walk(node) if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef))]
            attrs=[]
            for n in ast.walk(node):
                if isinstance(n,ast.Assign):
                    for t in n.targets:
                        if isinstance(t,ast.Attribute) and isinstance(t.value,ast.Name) and t.value.id=="self": attrs.append(t.attr)
            d=f'Step {sn}: It creates a blueprint called "{node.name}"'
            if attrs: d+=f", which stores: {', '.join(dict.fromkeys(attrs[:3]))}"
            rm=[m for m in methods if not m.startswith("_")]
            if rm: d+=f". Its abilities are: {', '.join(rm[:5])}"
            steps.append(d+"."); sn+=1
        elif isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef)):
            args=[a.arg for a in node.args.args if a.arg!="self"]
            fl2=[n for n in ast.walk(node) if isinstance(n,(ast.For,ast.While))]
            fi=[n for n in ast.walk(node) if isinstance(n,ast.If)]
            fr=[n for n in ast.walk(node) if isinstance(n,ast.Return)]
            d=f'Step {sn}: It defines a task called "{node.name}"'
            if args: d+=f" that works with {', '.join(args[:3])}"
            beh=[]
            if fl2: beh.append("goes through items one by one")
            if fi: beh.append("checks conditions and decides what to do")
            if fr: beh.append("gives back a result when done")
            if beh: d+=". It "+", and ".join(beh)
            steps.append(d+"."); sn+=1
        elif isinstance(node,ast.Assign):
            tgt=safe_unparse(node.targets[0]); val=safe_unparse(node.value)
            steps.append(f'Step {sn}: It stores "{val}" in a variable called "{tgt}".'); sn+=1
        elif isinstance(node,ast.If):
            steps.append(f'Step {sn}: It checks whether "{safe_unparse(node.test)}" is true'
                         +(" and does something if yes" if node.body else "")
                         +(", otherwise does something different" if node.orelse else "")+"."); sn+=1
        elif isinstance(node,ast.For):
            steps.append(f'Step {sn}: It goes through each item in "{safe_unparse(node.iter)}", calling each one "{safe_unparse(node.target)}", and does something for each.'); sn+=1
        elif isinstance(node,ast.While):
            steps.append(f'Step {sn}: It keeps doing something over and over as long as "{safe_unparse(node.test)}" is true.'); sn+=1
        elif isinstance(node,ast.Expr) and isinstance(getattr(node,"value",None),ast.Call):
            func=node.value.func
            fname=func.id if isinstance(func,ast.Name) else getattr(func,"attr","")
            args=", ".join(safe_unparse(a) for a in node.value.args[:2])
            if fname=="print": steps.append(f'Step {sn}: It shows "{args}" on the screen.')
            elif fname=="input": steps.append(f'Step {sn}: It waits for the user to type something in.')
            else: steps.append(f'Step {sn}: It runs the "{fname}" task.')
            sn+=1
        elif isinstance(node,ast.Try):
            steps.append(f'Step {sn}: It carefully tries something that might fail, and handles errors gracefully instead of crashing.'); sn+=1
    if steps: parts.append({"title":"📋 How it works","body":"\n".join(steps)})
    concepts=[]
    if classes: concepts.append("Object-Oriented Programming (classes and objects)")
    if loops: concepts.append("Loops (repeating steps automatically)")
    if conditions: concepts.append("Conditionals (making decisions with if/else)")
    if any(isinstance(n,ast.Try) for n in ast.walk(tree)): concepts.append("Error Handling (try/except)")
    if any(isinstance(n,ast.ListComp) for n in ast.walk(tree)): concepts.append("List Comprehensions")
    if inames: concepts.append(f"External Libraries ({', '.join(inames[:3])})")
    if concepts: parts.append({"title":"💡 Key concepts","body":"\n".join(f"• {c}" for c in concepts)})
    if prints:
        pargs=[", ".join(safe_unparse(a) for a in n.value.args) for n in prints[:3] if isinstance(n.value,ast.Call)]
        if pargs: parts.append({"title":"📤 What you will see","body":f"The program prints: {' | '.join(pargs)}"})
    elif inputs_:
        parts.append({"title":"📤 What happens","body":"The program waits for you to type something, then processes it and shows a result."})
    return parts

def scan_input_calls(code: str) -> list:
    try: tree = ast.parse(code)
    except: return []
    inputs = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            func = node.func
            fname = func.id if isinstance(func, ast.Name) else (func.attr if isinstance(func, ast.Attribute) else "")
            if fname == "input":
                prompt = ""
                if node.args:
                    try: prompt = ast.literal_eval(node.args[0])
                    except: prompt = safe_unparse(node.args[0])
                inputs.append({"index": len(inputs), "prompt": str(prompt)})
    return inputs

def run_code_safe(code: str, user_inputs: list = []) -> dict:
    import math as _math, random as _random, re as _re
    import datetime as _dt, json as _json
    import collections as _col, itertools as _it, functools as _ft, string as _str
    out = io.StringIO(); err = io.StringIO()
    old_out, old_err = sys.stdout, sys.stderr
    status = "success"; error = None
    start = datetime.utcnow()
    queue = list(user_inputs); prompts_hit = []
    def mock_input(prompt=""):
        prompts_hit.append(str(prompt))
        val = queue.pop(0) if queue else ""
        sys.stdout.write(f"{prompt}{val}\n")
        return str(val)
    safe_builtins = {
        "print":print,"input":mock_input,
        "int":int,"float":float,"str":str,"bool":bool,"complex":complex,
        "bytes":bytes,"bytearray":bytearray,
        "list":list,"dict":dict,"tuple":tuple,"set":set,"frozenset":frozenset,
        "range":range,"len":len,"type":type,"enumerate":enumerate,
        "zip":zip,"map":map,"filter":filter,"reversed":reversed,"sorted":sorted,
        "iter":iter,"next":next,"sum":sum,"min":min,"max":max,"abs":abs,"round":round,
        "divmod":divmod,"pow":pow,"hash":hash,"repr":repr,"hex":hex,"oct":oct,
        "bin":bin,"chr":chr,"ord":ord,"format":format,"any":any,"all":all,
        "callable":callable,"id":id,"isinstance":isinstance,"issubclass":issubclass,
        "hasattr":hasattr,"getattr":getattr,"setattr":setattr,"delattr":delattr,
        "vars":vars,"dir":dir,
        "Exception":Exception,"ValueError":ValueError,"TypeError":TypeError,
        "KeyError":KeyError,"IndexError":IndexError,"AttributeError":AttributeError,
        "NameError":NameError,"ZeroDivisionError":ZeroDivisionError,
        "StopIteration":StopIteration,"RuntimeError":RuntimeError,
        "NotImplementedError":NotImplementedError,"OSError":OSError,
        "ArithmeticError":ArithmeticError,"OverflowError":OverflowError,
        "AssertionError":AssertionError,"RecursionError":RecursionError,
        "True":True,"False":False,"None":None,
        "__name__":"__main__","__build_class__":__build_class__,
    }
    safe_globals = {
        "__builtins__": safe_builtins,
        "math":_math,"random":_random,"re":_re,"datetime":_dt,
        "json":_json,"collections":_col,"itertools":_it,"functools":_ft,"string":_str,
    }
    try:
        sys.stdout = out; sys.stderr = err
        exec(compile(code,"<ragsy>","exec"), safe_globals)
    except SystemExit: status="exited"
    except RecursionError:
        status="error"; error="RecursionError: maximum recursion depth exceeded."
        print(error,file=err)
    except MemoryError:
        status="error"; error="MemoryError: program used too much memory."
        print(error,file=err)
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

# ══════════════════════════════════════════════════════════════════
# CODE ROUTES — saving results to SQL Server DB
# ══════════════════════════════════════════════════════════════════
@app.post("/scan-inputs")
async def scan_inputs(request: RunRequest):
    code = request.code.strip()
    if not code: return {"inputs":[]}
    return {"inputs": scan_input_calls(code)}

@app.post("/run")
async def run_code(request: RunRequest, token: str = ""):
    code = request.code.strip()
    if not code: raise HTTPException(400, detail="Code cannot be empty")
    try: ast.parse(code)
    except SyntaxError as e:
        return {"status":"error","stdout":"","stderr":f"SyntaxError at line {e.lineno}: {e.msg}",
                "elapsed_ms":0,"error":f"SyntaxError: {e.msg}","prompts_hit":[]}
    result = run_code_safe(code, request.user_inputs or [])
    uid = sessions_db.get(token)
    if uid:
        db_log(uid, "run_code")
    return result

@app.post("/visualize")
async def visualize_code(request: CodeRequest, token: str = ""):
    _ctr[0]=0; nodes=[]; edges=[]; code=request.code.strip()
    if not code: raise HTTPException(400, detail="Code cannot be empty")

    uid = sessions_db.get(token)

    try: tree=ast.parse(code)
    except SyntaxError as e: raise HTTPException(400, detail=f"SyntaxError line {e.lineno}: {e.msg}")
    except Exception as e: raise HTTPException(400, detail=str(e))

    # Save CODE_SUBMISSION to DB
    code_id = None
    if uid:
        try:
            code_id = db_submission_save(uid, code, request.language)
        except Exception as e:
            print(f"[DB WARNING] submission save failed: {e}")

    start_id=nid()
    nodes.append({"id":start_id,"type":"input","data":{"label":"▶  START"},"position":{"x":300,"y":0},
        "style":{"background":"#0f172a","color":"#fff","border":"2px solid #38bdf8","borderRadius":"50px",
                 "padding":"12px 28px","fontWeight":"bold","fontSize":"14px","textAlign":"center",
                 "minWidth":"140px","boxShadow":"0 0 24px #38bdf888","fontFamily":"'Fira Code',monospace"}})
    last_id=parse_statements(tree.body,nodes,edges,start_id,300,130) if tree.body else start_id
    end_y=max(n["position"]["y"] for n in nodes)+150; end_id=nid()
    nodes.append({"id":end_id,"type":"output","data":{"label":"■  END"},"position":{"x":300,"y":end_y},
        "style":{"background":"#0f172a","color":"#fff","border":"2px solid #f43f5e","borderRadius":"50px",
                 "padding":"12px 28px","fontWeight":"bold","fontSize":"14px","textAlign":"center",
                 "minWidth":"140px","boxShadow":"0 0 24px #f43f5e88","fontFamily":"'Fira Code',monospace"}})
    edges.append(make_edge(last_id,end_id,color="#f43f5e"))

    explanation = plain_english_explanation(code, tree)

    # Save FLOWCHART + EXPLANATION to DB
    if uid and code_id:
        try:
            db_flowchart_save(code_id, json.dumps({"nodes":nodes,"edges":edges}))
            db_explanation_save(code_id, json.dumps(explanation))
            db_log(uid, "visualize")
        except Exception as e:
            print(f"[DB WARNING] flowchart/explanation save failed: {e}")

    lines=len(code.splitlines())
    return {"code_id":code_id,"nodes":nodes,"edges":edges,"explanation":explanation,
            "stats":{"node_count":len(nodes),"edge_count":len(edges),"lines_parsed":lines}}

@app.get("/submissions")
def get_submissions(token: str):
    user = user_by_token(token)
    try:
        return {"submissions": db_submissions_by_user(user["user_id"])}
    except Exception as e:
        raise HTTPException(500, detail=f"DB error: {e}")

if __name__=="__main__":
    test_db_connection()   # prints DB status on startup
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
