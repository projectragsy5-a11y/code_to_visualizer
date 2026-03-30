from fastapi import FastAPI, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import ast
import random
import string
from datetime import datetime, timedelta

app = FastAPI(title="Ragsy — Code to Architecture API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Pydantic Models  (matching DB: username + mobile_no + password) ──
class RegisterRequest(BaseModel):
    username: str
    mobile_no: str
    password: str

class OTPVerifyRequest(BaseModel):
    mobile_no: str
    otp_code: str

class ResendOTPRequest(BaseModel):
    mobile_no: str

class LoginRequest(BaseModel):
    username: str
    password: str

class LogoutRequest(BaseModel):
    token: str

class CodeRequest(BaseModel):
    code: str
    language: str = "python"

# ── In-Memory Store  (mirrors your 7 DB tables) ─────────────────
# USERS          : mobile_no -> { user_id, username, password, created_at }
# OTP_VERIFICATION: mobile_no -> { otp_code, expiry_time, status }
# SESSIONS       : token     -> mobile_no
# CODE_SUBMISSIONS: code_id  -> { user_id, source_code, language, upload_time }
# FLOWCHARTS     : code_id   -> { diagram_path(nodes+edges), generated_time }
# EXPLANATIONS   : code_id   -> { file_path(text), download_count }
# USER_ACTIONS_LOG: list of  { log_id, user_id, action_time }
# REPORTS        : list of   { report_id, user_id, action_type, action_time }

users_db       = {}   # mobile_no -> user dict
otp_db         = {}   # mobile_no -> { otp_code, expiry_time, status }
sessions_db    = {}   # token     -> mobile_no
submissions_db = {}   # code_id   -> submission dict
flowcharts_db  = {}   # code_id   -> flowchart dict
explanations_db= {}   # code_id   -> explanation dict
actions_log    = []   # USER_ACTIONS_LOG rows
reports_db     = []   # REPORTS rows

_uid_ctr = [0]
_cid_ctr = [0]

def new_user_id():
    _uid_ctr[0] += 1
    return _uid_ctr[0]

def new_code_id():
    _cid_ctr[0] += 1
    return _cid_ctr[0]

def generate_otp():
    return "".join(random.choices(string.digits, k=6))

def generate_token(mobile_no: str):
    token = "".join(random.choices(string.ascii_letters + string.digits, k=32))
    sessions_db[token] = mobile_no
    return token

def log_action(user_id, action_type):
    now = datetime.utcnow().isoformat()
    actions_log.append({"log_id": len(actions_log)+1, "user_id": user_id, "action_time": now})
    reports_db.append({"report_id": len(reports_db)+1, "user_id": user_id,
                        "action_type": action_type, "action_time": now})

def get_user_by_token(token: str):
    mobile = sessions_db.get(token)
    if not mobile:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return users_db[mobile]

# ── Health ────────────────────────────────────────────────────────
@app.get("/")
def root():
    return {"status": "running", "app": "Ragsy", "version": "1.0.0"}

@app.get("/health")
def health():
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}

# ── AUTH: Register  POST /auth/register ──────────────────────────
@app.post("/auth/register")
def register(data: RegisterRequest):
    if data.mobile_no in users_db:
        raise HTTPException(status_code=400, detail="Mobile number already registered")
    # check username uniqueness
    for u in users_db.values():
        if u["username"] == data.username:
            raise HTTPException(status_code=400, detail="Username already taken")
    if len(data.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    uid = new_user_id()
    users_db[data.mobile_no] = {
        "user_id":    uid,
        "username":   data.username,
        "mobile_no":  data.mobile_no,
        "password":   data.password,          # hash in production
        "created_at": datetime.utcnow().isoformat(),
    }

    otp = generate_otp()
    otp_db[data.mobile_no] = {
        "otp_code":   otp,
        "expiry_time": datetime.utcnow() + timedelta(minutes=5),
        "status":     "pending",              # OTP_VERIFICATION.status
    }
    print(f"[OTP] {data.mobile_no} => {otp}")   # In prod: send via SMS

    log_action(uid, "register")
    return {
        "message":    "Registered successfully. OTP sent to your mobile.",
        "mobile_no":  data.mobile_no,
        "otp_code":   otp,          # remove in prod — here for dev/demo
        "expires_in": 300,
    }

# ── AUTH: Verify OTP  POST /auth/verify-otp ──────────────────────
@app.post("/auth/verify-otp")
def verify_otp(data: OTPVerifyRequest):
    record = otp_db.get(data.mobile_no)
    if not record:
        raise HTTPException(status_code=400, detail="No OTP found. Please register again.")
    if record["status"] == "verified":
        raise HTTPException(status_code=400, detail="OTP already used.")
    if datetime.utcnow() > record["expiry_time"]:
        otp_db[data.mobile_no]["status"] = "expired"
        raise HTTPException(status_code=400, detail="OTP expired. Request a new one.")
    if record["otp_code"] != data.otp_code:
        raise HTTPException(status_code=400, detail="Incorrect OTP.")

    otp_db[data.mobile_no]["status"] = "verified"
    token  = generate_token(data.mobile_no)
    user   = users_db[data.mobile_no]
    log_action(user["user_id"], "otp_verify")
    return {
        "message": "Mobile verified successfully.",
        "token":   token,
        "user":    {"username": user["username"], "mobile_no": user["mobile_no"]},
    }

# ── AUTH: Resend OTP  POST /auth/resend-otp ──────────────────────
@app.post("/auth/resend-otp")
def resend_otp(data: ResendOTPRequest):
    if data.mobile_no not in users_db:
        raise HTTPException(status_code=404, detail="Mobile not found. Please register first.")
    otp = generate_otp()
    otp_db[data.mobile_no] = {
        "otp_code":    otp,
        "expiry_time": datetime.utcnow() + timedelta(minutes=5),
        "status":      "pending",
    }
    print(f"[OTP RESEND] {data.mobile_no} => {otp}")
    return {"message": "New OTP sent.", "otp_code": otp, "expires_in": 300}

# ── AUTH: Login  POST /auth/login ─────────────────────────────────
@app.post("/auth/login")
def login(data: LoginRequest):
    # find user by username
    user = next((u for u in users_db.values() if u["username"] == data.username), None)
    if not user:
        raise HTTPException(status_code=401, detail="Username not found")
    if user["password"] != data.password:
        raise HTTPException(status_code=401, detail="Incorrect password")

    # check OTP verified
    otp_rec = otp_db.get(user["mobile_no"])
    if not otp_rec or otp_rec["status"] != "verified":
        raise HTTPException(status_code=403,
            detail="Account not verified. Please verify your mobile OTP first.")

    token = generate_token(user["mobile_no"])
    log_action(user["user_id"], "login")
    return {
        "message": "Login successful",
        "token":   token,
        "user":    {"username": user["username"], "mobile_no": user["mobile_no"]},
    }

# ── AUTH: Logout  POST /auth/logout ──────────────────────────────
@app.post("/auth/logout")
def logout(data: LogoutRequest):
    mobile = sessions_db.pop(data.token, None)
    if mobile:
        user = users_db.get(mobile)
        if user:
            log_action(user["user_id"], "logout")
    return {"message": "Logged out successfully"}

# ── AUTH: Me  GET /auth/me?token=xxx ─────────────────────────────
@app.get("/auth/me")
def get_me(token: str):
    user = get_user_by_token(token)
    return {
        "user_id":   user["user_id"],
        "username":  user["username"],
        "mobile_no": user["mobile_no"],
        "created_at":user["created_at"],
    }

# ── NODE COLORS (for React Flow) ─────────────────────────────────
NODE_COLORS = {
    "start":   {"bg": "#0f172a", "border": "#38bdf8"},
    "end":     {"bg": "#0f172a", "border": "#f43f5e"},
    "func":    {"bg": "#4c1d95", "border": "#a78bfa"},
    "class":   {"bg": "#78350f", "border": "#fbbf24"},
    "if":      {"bg": "#7f1d1d", "border": "#fca5a5"},
    "elif":    {"bg": "#7f1d1d", "border": "#f87171"},
    "else":    {"bg": "#1e3a5f", "border": "#93c5fd"},
    "for":     {"bg": "#064e3b", "border": "#34d399"},
    "while":   {"bg": "#064e3b", "border": "#6ee7b7"},
    "return":  {"bg": "#7c2d12", "border": "#fb923c"},
    "assign":  {"bg": "#0c4a6e", "border": "#38bdf8"},
    "import":  {"bg": "#3b0764", "border": "#c4b5fd"},
    "try":     {"bg": "#450a0a", "border": "#f87171"},
    "except":  {"bg": "#450a0a", "border": "#fca5a5"},
    "raise":   {"bg": "#450a0a", "border": "#ef4444"},
    "with":    {"bg": "#0c4a6e", "border": "#7dd3fc"},
    "print":   {"bg": "#1e3a5f", "border": "#60a5fa"},
    "call":    {"bg": "#1e293b", "border": "#64748b"},
    "default": {"bg": "#1e293b", "border": "#64748b"},
}

def make_style(key):
    c = NODE_COLORS.get(key, NODE_COLORS["default"])
    return {
        "background":  c["bg"],
        "color":       "#fff",
        "border":      f"2px solid {c['border']}",
        "borderRadius":"8px",
        "padding":     "10px 16px",
        "fontSize":    "12px",
        "fontFamily":  "'Fira Code', monospace",
        "minWidth":    "180px",
        "maxWidth":    "280px",
        "boxShadow":   f"0 0 14px {c['border']}44",
        "wordBreak":   "break-word",
        "whiteSpace":  "pre-wrap",
        "textAlign":   "left",
    }

def make_edge(src, tgt, label="", color="#94a3b8", dashed=False):
    return {
        "id":       f"e{src}-{tgt}",
        "source":   src,
        "target":   tgt,
        "label":    label,
        "animated": True,
        "style":    {
            "stroke":          color,
            "strokeWidth":     2,
            "strokeDasharray": "6,3" if dashed else "0",
        },
        "labelStyle": {"fill": "#94a3b8", "fontSize": "11px"},
    }

def safe_unparse(node):
    try:
        txt = ast.unparse(node)
        return (txt[:55] + "...") if len(txt) > 55 else txt
    except Exception:
        return "???"

_ctr = [0]
def nid():
    _ctr[0] += 1
    return str(_ctr[0])

def parse_statements(stmts, nodes, edges, parent_id, x, y, depth=0):
    prev_id = parent_id
    dx = depth * 40
    for i, stmt in enumerate(stmts):
        node_id = nid()
        label = ""
        ck = "default"
        body = []
        orelse = []
        handlers = []
        finalbody = []

        if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
            prefix = "async def" if isinstance(stmt, ast.AsyncFunctionDef) else "def"
            args = ", ".join(a.arg for a in stmt.args.args)
            decos = ""
            if stmt.decorator_list:
                decos = "@" + safe_unparse(stmt.decorator_list[0]) + "\n"
            label = f"{decos}{prefix} {stmt.name}({args})"
            ck = "func"; body = stmt.body
        elif isinstance(stmt, ast.ClassDef):
            bases = ", ".join(safe_unparse(b) for b in stmt.bases)
            label = f"class {stmt.name}({bases})" if bases else f"class {stmt.name}"
            ck = "class"; body = stmt.body
        elif isinstance(stmt, ast.If):
            label = f"if {safe_unparse(stmt.test)}"
            ck = "if"; body = stmt.body; orelse = stmt.orelse
        elif isinstance(stmt, ast.For):
            label = f"for {safe_unparse(stmt.target)}\nin {safe_unparse(stmt.iter)}"
            ck = "for"; body = stmt.body
        elif isinstance(stmt, ast.While):
            label = f"while {safe_unparse(stmt.test)}"
            ck = "while"; body = stmt.body
        elif isinstance(stmt, ast.Return):
            val = safe_unparse(stmt.value) if stmt.value else "None"
            label = f"return {val}"; ck = "return"
        elif isinstance(stmt, ast.Assign):
            tgts = ", ".join(safe_unparse(t) for t in stmt.targets)
            label = f"{tgts} = {safe_unparse(stmt.value)}"; ck = "assign"
        elif isinstance(stmt, ast.AugAssign):
            ops_map = {ast.Add:"+=",ast.Sub:"-=",ast.Mult:"*=",
                       ast.Div:"/=",ast.Mod:"%=",ast.Pow:"**=",ast.FloorDiv:"//="}
            op = ops_map.get(type(stmt.op), "op=")
            label = f"{safe_unparse(stmt.target)} {op} {safe_unparse(stmt.value)}"; ck = "assign"
        elif isinstance(stmt, ast.AnnAssign):
            label = f"{safe_unparse(stmt.target)}: {safe_unparse(stmt.annotation)}"
            if stmt.value: label += f" = {safe_unparse(stmt.value)}"
            ck = "assign"
        elif isinstance(stmt, ast.Import):
            names = ", ".join((a.asname or a.name) for a in stmt.names)
            label = f"import {names}"; ck = "import"
        elif isinstance(stmt, ast.ImportFrom):
            mod = stmt.module or ""
            names = ", ".join((a.asname or a.name) for a in stmt.names)
            label = f"from {mod}\nimport {names}"; ck = "import"
        elif isinstance(stmt, ast.Try):
            label = "try"; ck = "try"
            body = stmt.body; handlers = stmt.handlers
            finalbody = getattr(stmt, "finalbody", [])
        elif isinstance(stmt, ast.ExceptHandler):
            exc_type = safe_unparse(stmt.type) if stmt.type else "Exception"
            label = f"except {exc_type}"
            if stmt.name: label += f" as {stmt.name}"
            ck = "except"; body = stmt.body
        elif isinstance(stmt, ast.Raise):
            label = f"raise {safe_unparse(stmt.exc)}" if stmt.exc else "raise"; ck = "raise"
        elif isinstance(stmt, ast.With):
            items = ", ".join(safe_unparse(it.context_expr) for it in stmt.items)
            label = f"with {items}"; ck = "with"; body = stmt.body
        elif isinstance(stmt, ast.Delete):
            label = "del " + ", ".join(safe_unparse(t) for t in stmt.targets)
        elif isinstance(stmt, ast.Pass):
            label = "pass"
        elif isinstance(stmt, ast.Break):
            label = "⟵ break"; ck = "for"
        elif isinstance(stmt, ast.Continue):
            label = "↺ continue"; ck = "for"
        elif isinstance(stmt, ast.Global):
            label = "global " + ", ".join(stmt.names)
        elif isinstance(stmt, ast.Nonlocal):
            label = "nonlocal " + ", ".join(stmt.names)
        elif isinstance(stmt, ast.Assert):
            label = f"assert {safe_unparse(stmt.test)}"; ck = "try"
        elif isinstance(stmt, ast.Expr):
            if isinstance(stmt.value, ast.Call):
                func = stmt.value.func
                fname = func.id if isinstance(func, ast.Name) else (
                    func.attr if isinstance(func, ast.Attribute) else "")
                args = ", ".join(safe_unparse(a) for a in stmt.value.args)
                if fname == "print":
                    label = f"print({args})"; ck = "print"
                else:
                    label = safe_unparse(stmt.value); ck = "call"
            else:
                label = safe_unparse(stmt); ck = "call"
        else:
            label = type(stmt).__name__

        nodes.append({
            "id": node_id,
            "data": {"label": label},
            "position": {"x": x + dx, "y": y + i * 130},
            "style": make_style(ck),
        })
        border_color = NODE_COLORS.get(ck, NODE_COLORS["default"])["border"]
        edges.append(make_edge(prev_id, node_id, color=border_color))
        prev_id = node_id
        cy = y + i * 130 + 130

        if body:
            last = parse_statements(body, nodes, edges, node_id, x + 60, cy, depth + 1)
            prev_id = last or node_id
        if orelse:
            if len(orelse) == 1 and isinstance(orelse[0], ast.If):
                elif_id = nid()
                es = orelse[0]
                nodes.append({
                    "id": elif_id,
                    "data": {"label": f"elif {safe_unparse(es.test)}"},
                    "position": {"x": x + dx + 200, "y": y + i * 130},
                    "style": make_style("elif"),
                })
                edges.append(make_edge(node_id, elif_id, label="elif",
                    color=NODE_COLORS["elif"]["border"], dashed=True))
                if es.body:
                    parse_statements(es.body, nodes, edges, elif_id, x + 260, cy, depth + 2)
            else:
                else_id = nid()
                nodes.append({
                    "id": else_id,
                    "data": {"label": "else"},
                    "position": {"x": x + dx + 200, "y": y + i * 130},
                    "style": make_style("else"),
                })
                edges.append(make_edge(node_id, else_id, label="else",
                    color=NODE_COLORS["else"]["border"], dashed=True))
                parse_statements(orelse, nodes, edges, else_id, x + 260, cy, depth + 2)

        for handler in handlers:
            parse_statements([handler], nodes, edges, node_id, x + 60, cy, depth + 1)

        if finalbody:
            fin_id = nid()
            fin_y = cy + 130
            nodes.append({
                "id": fin_id,
                "data": {"label": "finally"},
                "position": {"x": x + dx, "y": fin_y},
                "style": make_style("try"),
            })
            edges.append(make_edge(node_id, fin_id, color=NODE_COLORS["try"]["border"]))
            parse_statements(finalbody, nodes, edges, fin_id, x + 60, fin_y + 130, depth + 1)
            prev_id = fin_id

    return prev_id

# ── POST /visualize ───────────────────────────────────────────────
# Accepts: { code, language }  +  token query param for auth
# Saves to CODE_SUBMISSIONS + FLOWCHARTS + EXPLANATIONS (in-memory)
@app.post("/visualize")
async def visualize_code(request: CodeRequest, token: str = ""):
    _ctr[0] = 0
    nodes = []
    edges = []
    code = request.code.strip()

    if not code:
        raise HTTPException(status_code=400, detail="Code cannot be empty")

    # ── resolve user from token (optional auth) ───────────────────
    user_id = None
    if token:
        mobile = sessions_db.get(token)
        if mobile and mobile in users_db:
            user_id = users_db[mobile]["user_id"]

    # ── save CODE_SUBMISSION ──────────────────────────────────────
    code_id = new_code_id()
    submissions_db[code_id] = {
        "code_id":     code_id,
        "user_id":     user_id,
        "source_code": code,
        "language":    request.language,
        "upload_time": datetime.utcnow().isoformat(),
    }

    # ── parse Python AST ──────────────────────────────────────────
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        raise HTTPException(status_code=400,
            detail=f"SyntaxError at line {e.lineno}: {e.msg}")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    # START node
    start_id = nid()
    nodes.append({
        "id":   start_id,
        "type": "input",
        "data": {"label": "▶  START"},
        "position": {"x": 300, "y": 0},
        "style": {
            **make_style("start"),
            "borderRadius": "50px",
            "textAlign":    "center",
            "fontWeight":   "bold",
            "fontSize":     "14px",
            "padding":      "12px 28px",
            "boxShadow":    "0 0 24px #38bdf888",
        },
    })

    last_id = parse_statements(tree.body, nodes, edges, start_id, 300, 130) if tree.body else start_id

    # END node
    end_y  = max(n["position"]["y"] for n in nodes) + 150
    end_id = nid()
    nodes.append({
        "id":   end_id,
        "type": "output",
        "data": {"label": "■  END"},
        "position": {"x": 300, "y": end_y},
        "style": {
            **make_style("end"),
            "borderRadius": "50px",
            "textAlign":    "center",
            "fontWeight":   "bold",
            "fontSize":     "14px",
            "padding":      "12px 28px",
            "boxShadow":    "0 0 24px #f43f5e88",
        },
    })
    edges.append(make_edge(last_id, end_id, color="#f43f5e"))

    # ── save FLOWCHART ────────────────────────────────────────────
    flowcharts_db[code_id] = {
        "flowchart_id":    code_id,
        "code_id":         code_id,
        "diagram_path":    {"nodes": nodes, "edges": edges},   # stored as JSON
        "generated_time":  datetime.utcnow().isoformat(),
    }

    # ── save EXPLANATION ──────────────────────────────────────────
    # Build a simple text explanation from the AST
    func_names  = [n.name for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
    class_names = [n.name for n in ast.walk(tree) if isinstance(n, ast.ClassDef)]
    imports     = [ast.unparse(n) for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom))]
    lines       = len(code.splitlines())
    explanation = (
        f"This code contains {lines} lines of Python.\n"
        + (f"Functions: {', '.join(func_names)}.\n" if func_names else "")
        + (f"Classes: {', '.join(class_names)}.\n"  if class_names else "")
        + (f"Imports: {'; '.join(imports[:5])}."    if imports else "")
    )
    explanations_db[code_id] = {
        "explanation_id": code_id,
        "code_id":        code_id,
        "file_path":      explanation,      # text content (file_path in DB)
        "download_count": 0,
    }

    if user_id:
        log_action(user_id, "visualize")

    return {
        "code_id": code_id,
        "nodes":   nodes,
        "edges":   edges,
        "explanation": explanation,
        "stats": {
            "node_count":   len(nodes),
            "edge_count":   len(edges),
            "lines_parsed": lines,
        },
    }

# ── GET /submissions?token=xxx ─────────────────────────────────
@app.get("/submissions")
def get_submissions(token: str):
    user = get_user_by_token(token)
    result = [s for s in submissions_db.values() if s["user_id"] == user["user_id"]]
    return {"submissions": result}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
