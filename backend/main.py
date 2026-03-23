from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import ast
import random
import string
from datetime import datetime, timedelta

app = FastAPI(title="Code to Visualizer Pro API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Pydantic Models ──────────────────────────────────────────────
class RegisterRequest(BaseModel):
    name: str
    email: str
    password: str

class LoginRequest(BaseModel):
    email: str
    password: str

class OTPVerifyRequest(BaseModel):
    email: str
    otp: str

class ResendOTPRequest(BaseModel):
    email: str

class LogoutRequest(BaseModel):
    token: str

class CodeRequest(BaseModel):
    code: str

# ── In-Memory Database ───────────────────────────────────────────
users_db = {}     # email -> { name, password, verified, created_at }
otp_db = {}       # email -> { otp, expires_at }
sessions_db = {}  # token -> email

# ── Helpers ──────────────────────────────────────────────────────
def generate_otp():
    return "".join(random.choices(string.digits, k=6))

def generate_token(email):
    token = "".join(random.choices(string.ascii_letters + string.digits, k=32))
    sessions_db[token] = email
    return token

# ── Health ───────────────────────────────────────────────────────
@app.get("/")
def root():
    return {"status": "running", "app": "Code to Visualizer Pro", "version": "1.0.0"}

@app.get("/health")
def health():
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}

# ── Auth Routes ──────────────────────────────────────────────────
@app.post("/auth/register")
def register(data: RegisterRequest):
    if data.email in users_db:
        raise HTTPException(status_code=400, detail="Email already registered")
    if len(data.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    users_db[data.email] = {
        "name": data.name,
        "email": data.email,
        "password": data.password,
        "verified": False,
        "created_at": datetime.utcnow().isoformat()
    }

    otp = generate_otp()
    otp_db[data.email] = {
        "otp": otp,
        "expires_at": datetime.utcnow() + timedelta(minutes=5)
    }
    print(f"[OTP] {data.email} => {otp}")

    return {
        "message": "Registration successful. OTP sent to your email.",
        "email": data.email,
        "otp": otp,
        "expires_in": 300
    }

@app.post("/auth/verify-otp")
def verify_otp(data: OTPVerifyRequest):
    record = otp_db.get(data.email)
    if not record:
        raise HTTPException(status_code=400, detail="No OTP found. Please register again.")
    if datetime.utcnow() > record["expires_at"]:
        del otp_db[data.email]
        raise HTTPException(status_code=400, detail="OTP expired. Request a new one.")
    if record["otp"] != data.otp:
        raise HTTPException(status_code=400, detail="Incorrect OTP.")

    users_db[data.email]["verified"] = True
    del otp_db[data.email]
    token = generate_token(data.email)
    user = users_db[data.email]

    return {
        "message": "Email verified successfully.",
        "token": token,
        "user": {"name": user["name"], "email": user["email"]}
    }

@app.post("/auth/resend-otp")
def resend_otp(data: ResendOTPRequest):
    if data.email not in users_db:
        raise HTTPException(status_code=404, detail="Email not found. Please register first.")
    if users_db[data.email]["verified"]:
        raise HTTPException(status_code=400, detail="Account already verified. Please login.")

    otp = generate_otp()
    otp_db[data.email] = {
        "otp": otp,
        "expires_at": datetime.utcnow() + timedelta(minutes=5)
    }
    print(f"[OTP RESEND] {data.email} => {otp}")

    return {"message": "New OTP sent.", "otp": otp, "expires_in": 300}

@app.post("/auth/login")
def login(data: LoginRequest):
    user = users_db.get(data.email)
    if not user:
        raise HTTPException(status_code=401, detail="Email not registered")
    if user["password"] != data.password:
        raise HTTPException(status_code=401, detail="Incorrect password")
    if not user["verified"]:
        raise HTTPException(status_code=403, detail="Account not verified. Please verify OTP first.")

    token = generate_token(data.email)
    return {
        "message": "Login successful",
        "token": token,
        "user": {"name": user["name"], "email": user["email"]}
    }

@app.post("/auth/logout")
def logout(data: LogoutRequest):
    sessions_db.pop(data.token, None)
    return {"message": "Logged out successfully"}

@app.get("/auth/me")
def get_me(token: str):
    email = sessions_db.get(token)
    if not email:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = users_db[email]
    return {"name": user["name"], "email": user["email"], "verified": user["verified"]}

# ── AST Node Colors ──────────────────────────────────────────────
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
        "background": c["bg"],
        "color": "#fff",
        "border": f"2px solid {c['border']}",
        "borderRadius": "8px",
        "padding": "10px 16px",
        "fontSize": "12px",
        "fontFamily": "'Fira Code', monospace",
        "minWidth": "180px",
        "maxWidth": "280px",
        "boxShadow": f"0 0 14px {c['border']}44",
        "wordBreak": "break-word",
        "whiteSpace": "pre-wrap",
        "textAlign": "left",
    }

def make_edge(src, tgt, label="", color="#94a3b8", dashed=False):
    return {
        "id": f"e{src}-{tgt}",
        "source": src,
        "target": tgt,
        "label": label,
        "animated": True,
        "style": {
            "stroke": color,
            "strokeWidth": 2,
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
            ck = "func"
            body = stmt.body

        elif isinstance(stmt, ast.ClassDef):
            bases = ", ".join(safe_unparse(b) for b in stmt.bases)
            label = f"class {stmt.name}({bases})" if bases else f"class {stmt.name}"
            ck = "class"
            body = stmt.body

        elif isinstance(stmt, ast.If):
            label = f"if {safe_unparse(stmt.test)}"
            ck = "if"
            body = stmt.body
            orelse = stmt.orelse

        elif isinstance(stmt, ast.For):
            label = f"for {safe_unparse(stmt.target)}\nin {safe_unparse(stmt.iter)}"
            ck = "for"
            body = stmt.body

        elif isinstance(stmt, ast.While):
            label = f"while {safe_unparse(stmt.test)}"
            ck = "while"
            body = stmt.body

        elif isinstance(stmt, ast.Return):
            val = safe_unparse(stmt.value) if stmt.value else "None"
            label = f"return {val}"
            ck = "return"

        elif isinstance(stmt, ast.Assign):
            tgts = ", ".join(safe_unparse(t) for t in stmt.targets)
            label = f"{tgts} = {safe_unparse(stmt.value)}"
            ck = "assign"

        elif isinstance(stmt, ast.AugAssign):
            ops_map = {ast.Add:"+=",ast.Sub:"-=",ast.Mult:"*=",
                       ast.Div:"/=",ast.Mod:"%=",ast.Pow:"**=",ast.FloorDiv:"//="}
            op = ops_map.get(type(stmt.op), "op=")
            label = f"{safe_unparse(stmt.target)} {op} {safe_unparse(stmt.value)}"
            ck = "assign"

        elif isinstance(stmt, ast.AnnAssign):
            label = f"{safe_unparse(stmt.target)}: {safe_unparse(stmt.annotation)}"
            if stmt.value:
                label += f" = {safe_unparse(stmt.value)}"
            ck = "assign"

        elif isinstance(stmt, ast.Import):
            names = ", ".join((a.asname or a.name) for a in stmt.names)
            label = f"import {names}"
            ck = "import"

        elif isinstance(stmt, ast.ImportFrom):
            mod = stmt.module or ""
            names = ", ".join((a.asname or a.name) for a in stmt.names)
            label = f"from {mod}\nimport {names}"
            ck = "import"

        elif isinstance(stmt, ast.Try):
            label = "try"
            ck = "try"
            body = stmt.body
            handlers = stmt.handlers
            finalbody = getattr(stmt, "finalbody", [])

        elif isinstance(stmt, ast.ExceptHandler):
            exc_type = safe_unparse(stmt.type) if stmt.type else "Exception"
            label = f"except {exc_type}"
            if stmt.name:
                label += f" as {stmt.name}"
            ck = "except"
            body = stmt.body

        elif isinstance(stmt, ast.Raise):
            label = f"raise {safe_unparse(stmt.exc)}" if stmt.exc else "raise"
            ck = "raise"

        elif isinstance(stmt, ast.With):
            items = ", ".join(safe_unparse(it.context_expr) for it in stmt.items)
            label = f"with {items}"
            ck = "with"
            body = stmt.body

        elif isinstance(stmt, ast.Delete):
            label = "del " + ", ".join(safe_unparse(t) for t in stmt.targets)

        elif isinstance(stmt, ast.Pass):
            label = "pass"

        elif isinstance(stmt, ast.Break):
            label = "⟵ break"
            ck = "for"

        elif isinstance(stmt, ast.Continue):
            label = "↺ continue"
            ck = "for"

        elif isinstance(stmt, ast.Global):
            label = "global " + ", ".join(stmt.names)

        elif isinstance(stmt, ast.Nonlocal):
            label = "nonlocal " + ", ".join(stmt.names)

        elif isinstance(stmt, ast.Assert):
            label = f"assert {safe_unparse(stmt.test)}"
            ck = "try"

        elif isinstance(stmt, ast.Expr):
            if isinstance(stmt.value, ast.Call):
                func = stmt.value.func
                fname = func.id if isinstance(func, ast.Name) else (
                    func.attr if isinstance(func, ast.Attribute) else "")
                args = ", ".join(safe_unparse(a) for a in stmt.value.args)
                if fname == "print":
                    label = f"print({args})"
                    ck = "print"
                else:
                    label = safe_unparse(stmt.value)
                    ck = "call"
            else:
                label = safe_unparse(stmt)
                ck = "call"
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

# ── /visualize endpoint ──────────────────────────────────────────
@app.post("/visualize")
async def visualize_code(request: CodeRequest):
    _ctr[0] = 0
    nodes = []
    edges = []

    code = request.code.strip()
    if not code:
        raise HTTPException(status_code=400, detail="Code cannot be empty")

    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        raise HTTPException(status_code=400,
            detail=f"SyntaxError at line {e.lineno}: {e.msg}")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    start_id = nid()
    start_style = {
        **make_style("start"),
        "borderRadius": "50px",
        "textAlign": "center",
        "fontWeight": "bold",
        "fontSize": "14px",
        "padding": "12px 28px",
        "boxShadow": "0 0 24px #38bdf888",
    }
    nodes.append({
        "id": start_id,
        "type": "input",
        "data": {"label": "▶  START"},
        "position": {"x": 300, "y": 0},
        "style": start_style,
    })

    if tree.body:
        last_id = parse_statements(tree.body, nodes, edges, start_id, 300, 130, depth=0)
    else:
        last_id = start_id

    end_y = max(n["position"]["y"] for n in nodes) + 150
    end_id = nid()
    end_style = {
        **make_style("end"),
        "borderRadius": "50px",
        "textAlign": "center",
        "fontWeight": "bold",
        "fontSize": "14px",
        "padding": "12px 28px",
        "boxShadow": "0 0 24px #f43f5e88",
    }
    nodes.append({
        "id": end_id,
        "type": "output",
        "data": {"label": "■  END"},
        "position": {"x": 300, "y": end_y},
        "style": end_style,
    })
    edges.append(make_edge(last_id, end_id, color="#f43f5e"))

    return {
        "nodes": nodes,
        "edges": edges,
        "stats": {
            "node_count": len(nodes),
            "edge_count": len(edges),
            "lines_parsed": len(code.splitlines()),
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
