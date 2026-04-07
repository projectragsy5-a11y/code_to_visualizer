"""
Ragsy Backend — FastAPI
Fixes:
  1. run_code_safe: input() calls auto-replaced with mock values instead of crashing
  2. POST /run — separate endpoint just for code execution (Run button)
  3. generate_explanation — plain English explanation (no stats, no jargon)
  4. OTP via Twilio SMS (real mobile number)
  5. POST /visualize — diagram + explanation only (no auto-run)
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import ast, random, string, sys, io, traceback, re, textwrap
from datetime import datetime, timedelta

# ── Twilio (optional — set env vars to enable real SMS) ──────────
import os
TWILIO_SID   = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM  = os.getenv("TWILIO_FROM_NUMBER", "")   # e.g. +12345678900

def send_sms(to_number: str, body: str) -> bool:
    """Returns True if SMS sent via Twilio, False if falling back to console."""
    if TWILIO_SID and TWILIO_TOKEN and TWILIO_FROM:
        try:
            from twilio.rest import Client
            client = Client(TWILIO_SID, TWILIO_TOKEN)
            client.messages.create(body=body, from_=TWILIO_FROM, to=to_number)
            return True
        except Exception as e:
            print(f"[TWILIO ERROR] {e}")
    # fallback — print to console for dev
    print(f"[OTP SMS] To: {to_number} | Message: {body}")
    return False

# ── App ───────────────────────────────────────────────────────────
app = FastAPI(title="Ragsy API", version="2.0.0")
app.add_middleware(CORSMiddleware,
    allow_origins=["http://localhost:3000","http://127.0.0.1:3000"],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# ── Models ────────────────────────────────────────────────────────
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

class RunRequest(BaseModel):
    code: str

# ── In-memory DB ──────────────────────────────────────────────────
users_db={}; otp_db={}; sessions_db={}
submissions_db={}; flowcharts_db={}; explanations_db={}
actions_log=[]; reports_db=[]
_uid=[0]; _cid=[0]

def new_uid(): _uid[0]+=1; return _uid[0]
def new_cid(): _cid[0]+=1; return _cid[0]
def gen_otp(): return "".join(random.choices(string.digits, k=6))
def gen_token(mobile):
    t="".join(random.choices(string.ascii_letters+string.digits, k=32))
    sessions_db[t]=mobile; return t
def log_action(uid, action):
    now=datetime.utcnow().isoformat()
    actions_log.append({"log_id":len(actions_log)+1,"user_id":uid,"action_time":now})
    reports_db.append({"report_id":len(reports_db)+1,"user_id":uid,"action_type":action,"action_time":now})
def user_by_token(token):
    m=sessions_db.get(token)
    if not m: raise HTTPException(401, detail="Invalid or expired token")
    return users_db[m]

# ── Health ────────────────────────────────────────────────────────
@app.get("/")
def root(): return {"status":"running","app":"Ragsy","version":"2.0.0"}
@app.get("/health")
def health(): return {"status":"healthy","timestamp":datetime.utcnow().isoformat()}

# ══════════════════════════════════════════════════════════════════
# AUTH ROUTES
# ══════════════════════════════════════════════════════════════════

@app.post("/auth/register")
def register(data: RegisterRequest):
    if data.mobile_no in users_db:
        raise HTTPException(400, detail="Mobile number already registered")
    for u in users_db.values():
        if u["username"]==data.username:
            raise HTTPException(400, detail="Username already taken")
    if len(data.password)<6:
        raise HTTPException(400, detail="Password must be at least 6 characters")

    uid = new_uid()
    users_db[data.mobile_no] = {
        "user_id": uid, "username": data.username,
        "mobile_no": data.mobile_no, "password": data.password,
        "created_at": datetime.utcnow().isoformat(),
    }
    otp = gen_otp()
    otp_db[data.mobile_no] = {
        "otp_code": otp,
        "expiry_time": datetime.utcnow() + timedelta(minutes=5),
        "status": "pending",
    }

    # Send real SMS via Twilio
    sms_sent = send_sms(
        data.mobile_no,
        f"Your Ragsy verification code is: {otp}. Valid for 5 minutes."
    )
    log_action(uid, "register")

    return {
        "message": "Registered. OTP sent to your mobile number.",
        "mobile_no": data.mobile_no,
        "sms_sent": sms_sent,
        # Only expose OTP in response when Twilio is NOT configured (dev mode)
        "otp_code": otp if not sms_sent else None,
        "expires_in": 300,
    }

@app.post("/auth/verify-otp")
def verify_otp(data: OTPVerifyRequest):
    rec = otp_db.get(data.mobile_no)
    if not rec: raise HTTPException(400, detail="No OTP found. Please register again.")
    if rec["status"]=="verified": raise HTTPException(400, detail="OTP already used.")
    if datetime.utcnow()>rec["expiry_time"]:
        otp_db[data.mobile_no]["status"]="expired"
        raise HTTPException(400, detail="OTP expired. Request a new one.")
    if rec["otp_code"]!=data.otp_code:
        raise HTTPException(400, detail="Incorrect OTP. Please try again.")
    otp_db[data.mobile_no]["status"]="verified"
    token = gen_token(data.mobile_no)
    user  = users_db[data.mobile_no]
    log_action(user["user_id"], "otp_verify")
    return {
        "message": "Mobile verified successfully.",
        "token": token,
        "user": {"username": user["username"], "mobile_no": user["mobile_no"]},
    }

@app.post("/auth/resend-otp")
def resend_otp(data: ResendOTPRequest):
    if data.mobile_no not in users_db:
        raise HTTPException(404, detail="Mobile not found. Please register first.")
    otp = gen_otp()
    otp_db[data.mobile_no] = {
        "otp_code": otp,
        "expiry_time": datetime.utcnow() + timedelta(minutes=5),
        "status": "pending",
    }
    sms_sent = send_sms(
        data.mobile_no,
        f"Your new Ragsy OTP is: {otp}. Valid for 5 minutes."
    )
    return {
        "message": "New OTP sent.",
        "sms_sent": sms_sent,
        "otp_code": otp if not sms_sent else None,
        "expires_in": 300,
    }

@app.post("/auth/login")
def login(data: LoginRequest):
    user = next((u for u in users_db.values() if u["username"]==data.username), None)
    if not user: raise HTTPException(401, detail="Username not found")
    if user["password"]!=data.password: raise HTTPException(401, detail="Incorrect password")
    rec = otp_db.get(user["mobile_no"])
    if not rec or rec["status"]!="verified":
        raise HTTPException(403, detail="Account not verified. Please verify your mobile OTP first.")
    token = gen_token(user["mobile_no"])
    log_action(user["user_id"], "login")
    return {
        "message": "Login successful",
        "token": token,
        "user": {"username": user["username"], "mobile_no": user["mobile_no"]},
    }

@app.post("/auth/logout")
def logout(data: LogoutRequest):
    mobile = sessions_db.pop(data.token, None)
    if mobile:
        user = users_db.get(mobile)
        if user: log_action(user["user_id"], "logout")
    return {"message": "Logged out successfully"}

@app.get("/auth/me")
def get_me(token: str):
    user = user_by_token(token)
    return {"user_id":user["user_id"],"username":user["username"],"mobile_no":user["mobile_no"]}

# ══════════════════════════════════════════════════════════════════
# FLOWCHART ENGINE
# ══════════════════════════════════════════════════════════════════
NODE_COLORS = {
    "start":  {"bg":"#0f172a","border":"#38bdf8"},
    "end":    {"bg":"#0f172a","border":"#f43f5e"},
    "func":   {"bg":"#4c1d95","border":"#a78bfa"},
    "class":  {"bg":"#78350f","border":"#fbbf24"},
    "if":     {"bg":"#7f1d1d","border":"#fca5a5"},
    "elif":   {"bg":"#7f1d1d","border":"#f87171"},
    "else":   {"bg":"#1e3a5f","border":"#93c5fd"},
    "for":    {"bg":"#064e3b","border":"#34d399"},
    "while":  {"bg":"#064e3b","border":"#6ee7b7"},
    "return": {"bg":"#7c2d12","border":"#fb923c"},
    "assign": {"bg":"#0c4a6e","border":"#38bdf8"},
    "import": {"bg":"#3b0764","border":"#c4b5fd"},
    "try":    {"bg":"#450a0a","border":"#f87171"},
    "except": {"bg":"#450a0a","border":"#fca5a5"},
    "raise":  {"bg":"#450a0a","border":"#ef4444"},
    "with":   {"bg":"#0c4a6e","border":"#7dd3fc"},
    "print":  {"bg":"#1e3a5f","border":"#60a5fa"},
    "call":   {"bg":"#1e293b","border":"#64748b"},
    "default":{"bg":"#1e293b","border":"#64748b"},
}
SHAPE_MAP = {
    "if":"diamond","elif":"diamond","for":"diamond","while":"diamond",
    "print":"parallelogram",
    "start":"rounded","end":"rounded",
}

def make_node(node_id, label, ck, x, y, ntype=None):
    c = NODE_COLORS.get(ck, NODE_COLORS["default"])
    shape = SHAPE_MAP.get(ck, "rect")
    if shape=="diamond":
        return {"id":node_id,"type":"diamond",
                "data":{"label":label,"color":c["border"],"bg":c["bg"]},
                "position":{"x":x,"y":y}}
    elif shape=="parallelogram":
        return {"id":node_id,"type":"parallelogram",
                "data":{"label":label,"color":c["border"],"bg":c["bg"]},
                "position":{"x":x,"y":y}}
    elif shape=="rounded":
        return {"id":node_id,"type":ntype or "default","data":{"label":label},
                "position":{"x":x,"y":y},
                "style":{"background":c["bg"],"color":"#fff","border":f"2px solid {c['border']}",
                         "borderRadius":"50px","padding":"12px 28px","fontWeight":"bold",
                         "fontSize":"14px","textAlign":"center","minWidth":"140px",
                         "boxShadow":f"0 0 24px {c['border']}88","fontFamily":"'Fira Code',monospace"}}
    else:
        return {"id":node_id,"type":"default","data":{"label":label},
                "position":{"x":x,"y":y},
                "style":{"background":c["bg"],"color":"#fff","border":f"2px solid {c['border']}",
                         "borderRadius":"8px","padding":"10px 16px","minWidth":"180px","maxWidth":"280px",
                         "fontSize":"12px","fontFamily":"'Fira Code',monospace","wordBreak":"break-word",
                         "whiteSpace":"pre-wrap","textAlign":"center","boxShadow":f"0 0 14px {c['border']}44"}}

def make_edge(src, tgt, label="", color="#94a3b8", dashed=False):
    return {"id":f"e{src}-{tgt}-{random.randint(0,99999)}","source":src,"target":tgt,
            "label":label,"animated":True,
            "style":{"stroke":color,"strokeWidth":2,"strokeDasharray":"6,3" if dashed else "0"},
            "labelStyle":{"fill":"#94a3b8","fontSize":"11px"},
            "labelBgStyle":{"fill":"#1e293b","fillOpacity":0.8}}

def safe_unparse(node):
    try:
        txt = ast.unparse(node)
        return (txt[:52]+"…") if len(txt)>52 else txt
    except: return "???"

_ctr=[0]
def nid(): _ctr[0]+=1; return str(_ctr[0])

def parse_statements(stmts, nodes, edges, parent_id, x, y, depth=0):
    prev_id = parent_id
    dx = depth * 40
    for i, stmt in enumerate(stmts):
        node_id=nid(); label=""; ck="default"
        body=[]; orelse=[]; handlers=[]; finalbody=[]

        if isinstance(stmt,(ast.FunctionDef,ast.AsyncFunctionDef)):
            prefix="async def" if isinstance(stmt,ast.AsyncFunctionDef) else "def"
            args=", ".join(a.arg for a in stmt.args.args)
            deco="@"+safe_unparse(stmt.decorator_list[0])+"\n" if stmt.decorator_list else ""
            label=f"{deco}{prefix} {stmt.name}({args})"; ck="func"; body=stmt.body
        elif isinstance(stmt,ast.ClassDef):
            bases=", ".join(safe_unparse(b) for b in stmt.bases)
            label=f"class {stmt.name}({bases})" if bases else f"class {stmt.name}"; ck="class"; body=stmt.body
        elif isinstance(stmt,ast.If):
            label=f"if {safe_unparse(stmt.test)}"; ck="if"; body=stmt.body; orelse=stmt.orelse
        elif isinstance(stmt,ast.For):
            label=f"for {safe_unparse(stmt.target)} in {safe_unparse(stmt.iter)}"; ck="for"; body=stmt.body
        elif isinstance(stmt,ast.While):
            label=f"while {safe_unparse(stmt.test)}"; ck="while"; body=stmt.body
        elif isinstance(stmt,ast.Return):
            label=f"return {safe_unparse(stmt.value) if stmt.value else 'None'}"; ck="return"
        elif isinstance(stmt,ast.Assign):
            tgts=", ".join(safe_unparse(t) for t in stmt.targets)
            label=f"{tgts} = {safe_unparse(stmt.value)}"; ck="assign"
        elif isinstance(stmt,ast.AugAssign):
            ops={ast.Add:"+=",ast.Sub:"-=",ast.Mult:"*=",ast.Div:"/=",ast.Mod:"%=",ast.Pow:"**=",ast.FloorDiv:"//="}
            label=f"{safe_unparse(stmt.target)} {ops.get(type(stmt.op),'op=')} {safe_unparse(stmt.value)}"; ck="assign"
        elif isinstance(stmt,ast.AnnAssign):
            label=f"{safe_unparse(stmt.target)}: {safe_unparse(stmt.annotation)}"
            if stmt.value: label+=f" = {safe_unparse(stmt.value)}"
            ck="assign"
        elif isinstance(stmt,ast.Import):
            label=f"import {', '.join((a.asname or a.name) for a in stmt.names)}"; ck="import"
        elif isinstance(stmt,ast.ImportFrom):
            label=f"from {stmt.module or ''} import {', '.join((a.asname or a.name) for a in stmt.names)}"; ck="import"
        elif isinstance(stmt,ast.Try):
            label="try"; ck="try"; body=stmt.body
            handlers=stmt.handlers; finalbody=getattr(stmt,"finalbody",[])
        elif isinstance(stmt,ast.ExceptHandler):
            exc=safe_unparse(stmt.type) if stmt.type else "Exception"
            label=f"except {exc}"+( f" as {stmt.name}" if stmt.name else ""); ck="except"; body=stmt.body
        elif isinstance(stmt,ast.Raise):
            label=f"raise {safe_unparse(stmt.exc)}" if stmt.exc else "raise"; ck="raise"
        elif isinstance(stmt,ast.With):
            items=", ".join(safe_unparse(it.context_expr) for it in stmt.items)
            label=f"with {items}"; ck="with"; body=stmt.body
        elif isinstance(stmt,ast.Delete):
            label="del "+", ".join(safe_unparse(t) for t in stmt.targets)
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

        nodes.append(make_node(node_id, label, ck, x+dx, y+i*130))
        edges.append(make_edge(prev_id, node_id, color=NODE_COLORS.get(ck,NODE_COLORS["default"])["border"]))
        prev_id=node_id; cy=y+i*130+130

        if body:
            last=parse_statements(body,nodes,edges,node_id,x+80,cy,depth+1)
            prev_id=last or node_id
        if orelse:
            if len(orelse)==1 and isinstance(orelse[0],ast.If):
                eid=nid(); es=orelse[0]
                nodes.append(make_node(eid,f"elif {safe_unparse(es.test)}","elif",x+dx+280,y+i*130))
                edges.append(make_edge(node_id,eid,label="elif",color=NODE_COLORS["elif"]["border"],dashed=True))
                if es.body: parse_statements(es.body,nodes,edges,eid,x+360,cy,depth+2)
            else:
                eid=nid()
                nodes.append(make_node(eid,"else","else",x+dx+280,y+i*130))
                edges.append(make_edge(node_id,eid,label="else",color=NODE_COLORS["else"]["border"],dashed=True))
                parse_statements(orelse,nodes,edges,eid,x+360,cy,depth+2)
        for h in handlers:
            parse_statements([h],nodes,edges,node_id,x+80,cy,depth+1)
        if finalbody:
            fid=nid(); fy=cy+130
            nodes.append(make_node(fid,"finally","try",x+dx,fy))
            edges.append(make_edge(node_id,fid,color=NODE_COLORS["try"]["border"]))
            parse_statements(finalbody,nodes,edges,fid,x+80,fy+130,depth+1)
            prev_id=fid
    return prev_id

# ══════════════════════════════════════════════════════════════════
# PLAIN-ENGLISH EXPLANATION  (no jargon, no code stats)
# ══════════════════════════════════════════════════════════════════
def plain_english_explanation(code: str, tree: ast.AST) -> str:
    """
    Generates a friendly, plain-English explanation of what the code DOES —
    not how it is structured. Reads like a paragraph a teacher would write.
    """
    parts = []

    # ── What does this program do overall ────────────────────────
    functions  = [n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
    classes    = [n for n in ast.walk(tree) if isinstance(n, ast.ClassDef)]
    imports    = [n for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom))]
    loops      = [n for n in ast.walk(tree) if isinstance(n, (ast.For, ast.While))]
    conditions = [n for n in ast.walk(tree) if isinstance(n, ast.If)]
    prints     = [n for n in ast.walk(tree) if isinstance(n, ast.Expr)
                  and isinstance(getattr(n, 'value', None), ast.Call)
                  and isinstance(getattr(n.value, 'func', None), ast.Name)
                  and n.value.func.id == 'print']
    inputs_    = [n for n in ast.walk(tree) if isinstance(n, ast.Call)
                  and isinstance(getattr(n, 'func', None), ast.Name)
                  and n.func.id == 'input']

    import_names = []
    for n in imports:
        if isinstance(n, ast.Import): import_names += [a.name for a in n.names]
        else: import_names += [n.module or ""]
    import_names = [i for i in dict.fromkeys(import_names) if i]

    # ── WHAT IT DOES ─────────────────────────────────────────────
    intro_parts = ["This program"]
    if inputs_:
        intro_parts.append("asks the user to enter some information,")
    if classes:
        cnames = " and ".join(f'"{c.name}"' for c in classes)
        intro_parts.append(f"defines a class called {cnames} (a blueprint for creating objects),")
    if functions and not classes:
        fnames = " and ".join(f'"{f.name}"' for f in functions[:3])
        intro_parts.append(f"defines reusable steps called {fnames},")
    if loops:
        fl = [n for n in loops if isinstance(n,ast.For)]
        wl = [n for n in loops if isinstance(n,ast.While)]
        loop_desc = []
        if fl:  loop_desc.append(f"repeats steps {len(fl)} time(s) using a for-loop")
        if wl:  loop_desc.append(f"keeps looping {len(wl)} time(s) until a condition is false")
        intro_parts.append(", ".join(loop_desc) + ",")
    if conditions:
        intro_parts.append(f"makes {'a decision' if len(conditions)==1 else str(len(conditions))+' decisions'} based on conditions,")
    if prints:
        intro_parts.append("and displays results on the screen.")
    else:
        intro_parts.append("and produces a result.")

    what_it_does = " ".join(intro_parts)
    what_it_does = re.sub(r',\s+and', " and", what_it_does)
    parts.append(("🔍 What it does", what_it_does))

    # ── HOW IT WORKS — walk each top-level item ───────────────────
    steps = []
    step_num = 1
    for node in tree.body:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            names = import_names[:3]
            steps.append(f"Step {step_num}: It loads tools it needs ({', '.join(names)}) to help with the work.")
            step_num += 1; break  # merge all imports into one step

    for node in tree.body:
        if isinstance(node, ast.ClassDef):
            methods = [n.name for n in ast.walk(node) if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef))]
            attrs = []
            for n in ast.walk(node):
                if isinstance(n,ast.Assign):
                    for t in n.targets:
                        if isinstance(t,ast.Attribute) and isinstance(t.value,ast.Name) and t.value.id=="self":
                            attrs.append(t.attr)
            desc = f'Step {step_num}: It creates a blueprint called "{node.name}"'
            if attrs: desc += f', which stores information about {" and ".join(attrs[:3])}'
            if methods:
                readable_methods = [m for m in methods if not m.startswith("_")]
                if readable_methods: desc += f'. It can {", ".join(readable_methods[:4])}'
            desc += "."
            steps.append(desc); step_num += 1

        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            args = [a.arg for a in node.args.args if a.arg != "self"]
            fn_ifs = [n for n in ast.walk(node) if isinstance(n,ast.If)]
            fn_loops = [n for n in ast.walk(node) if isinstance(n,(ast.For,ast.While))]
            fn_rets = [n for n in ast.walk(node) if isinstance(n,ast.Return)]
            desc = f'Step {step_num}: It defines a task called "{node.name}"'
            if args: desc += f' that works with {" and ".join(args[:3])}'
            behavior = []
            if fn_loops: behavior.append(f"goes through items one by one")
            if fn_ifs: behavior.append(f"checks conditions and decides what to do")
            if fn_rets: behavior.append(f"gives back a result when done")
            if behavior: desc += ". It " + ", and ".join(behavior)
            desc += "."
            steps.append(desc); step_num += 1

        elif isinstance(node, ast.Assign):
            tgt = safe_unparse(node.targets[0])
            val = safe_unparse(node.value)
            steps.append(f'Step {step_num}: It stores the value "{val}" into a variable called "{tgt}".')
            step_num += 1

        elif isinstance(node, ast.If):
            test = safe_unparse(node.test)
            desc = f'Step {step_num}: It checks whether "{test}" is true'
            if node.body: desc += " and does something if yes"
            if node.orelse: desc += ", otherwise does something different"
            desc += "."
            steps.append(desc); step_num += 1

        elif isinstance(node, ast.For):
            target = safe_unparse(node.target); iterable = safe_unparse(node.iter)
            steps.append(f'Step {step_num}: It goes through each item in "{iterable}", calling each one "{target}", and does something for each.')
            step_num += 1

        elif isinstance(node, ast.While):
            test = safe_unparse(node.test)
            steps.append(f'Step {step_num}: It keeps doing something over and over as long as "{test}" is true.')
            step_num += 1

        elif isinstance(node, ast.Expr) and isinstance(getattr(node,'value',None), ast.Call):
            func = node.value.func
            fname = func.id if isinstance(func,ast.Name) else getattr(func,'attr','')
            args  = ", ".join(safe_unparse(a) for a in node.value.args[:2])
            if fname=="print":
                steps.append(f'Step {step_num}: It shows "{args}" on the screen.')
            elif fname=="input":
                steps.append(f'Step {step_num}: It waits for the user to type something in.')
            else:
                steps.append(f'Step {step_num}: It runs the "{fname}" task.')
            step_num += 1

        elif isinstance(node, ast.Try):
            steps.append(f'Step {step_num}: It carefully tries something that might go wrong, and handles any errors gracefully instead of crashing.')
            step_num += 1

    if steps:
        parts.append(("📋 How it works", "\n".join(steps)))

    # ── KEY CONCEPTS used ─────────────────────────────────────────
    concepts = []
    if classes:          concepts.append("Object-Oriented Programming (using classes and objects)")
    if loops:            concepts.append("Loops (repeating steps automatically)")
    if conditions:       concepts.append("Conditionals (making decisions with if/else)")
    if any(isinstance(n,ast.Try) for n in ast.walk(tree)):
        concepts.append("Error Handling (catching mistakes so the program doesn't crash)")
    if any(isinstance(n,ast.ListComp) for n in ast.walk(tree)):
        concepts.append("List Comprehensions (building lists in a shortcut way)")
    if any(isinstance(n,ast.Lambda) for n in ast.walk(tree)):
        concepts.append("Lambda Functions (tiny one-line functions)")
    if import_names:     concepts.append(f"External Libraries ({', '.join(import_names[:3])})")
    if concepts:
        parts.append(("💡 Key concepts used", "\n".join(f"• {c}" for c in concepts)))

    # ── Output / result ───────────────────────────────────────────
    if prints:
        print_args = []
        for n in prints[:3]:
            if isinstance(n.value, ast.Call):
                args = ", ".join(safe_unparse(a) for a in n.value.args)
                if args: print_args.append(f'"{args}"')
        if print_args:
            parts.append(("📤 What you'll see", f"The program prints {' and '.join(print_args)} to the screen."))
        else:
            parts.append(("📤 What you'll see", "The program prints output to the screen."))
    elif inputs_:
        parts.append(("📤 What happens", "The program waits for you to type something, then processes it and shows a result."))

    # Format as JSON-friendly list of {title, body}
    return [{"title": t, "body": b} for t, b in parts]


# ══════════════════════════════════════════════════════════════════
# CODE EXECUTION ENGINE
# — input() calls are auto-replaced with a mock that returns ""
# — so code with input() runs without crashing
# ══════════════════════════════════════════════════════════════════
def make_input_mock():
    """Returns a mock input() that returns empty string and logs the prompt."""
    collected = []
    def mock_input(prompt=""):
        collected.append(f"[INPUT PROMPT] {prompt}")
        return ""   # return empty string — won't crash int() wrapping
    return mock_input, collected

def run_code_safe(code: str) -> dict:
    out = io.StringIO()
    err = io.StringIO()
    old_out, old_err = sys.stdout, sys.stderr
    status = "success"; error = None
    start  = datetime.utcnow()
    input_mock, input_log = make_input_mock()

    try:
        sys.stdout = out
        sys.stderr = err

        safe_globals = {"__builtins__": {
            # ── I/O ──
            "print":  print,
            "input":  input_mock,   # ← fixed: no longer blocked
            # ── Type conversions ──
            "int":int,"float":float,"str":str,"bool":bool,
            "complex":complex,
            # ── Collections ──
            "list":list,"dict":dict,"tuple":tuple,"set":set,"frozenset":frozenset,
            # ── Itertools builtins ──
            "range":range,"len":len,"type":type,
            "sorted":sorted,"reversed":reversed,"enumerate":enumerate,
            "zip":zip,"map":map,"filter":filter,
            # ── Math ──
            "sum":sum,"min":min,"max":max,"abs":abs,"round":round,
            "divmod":divmod,"pow":pow,"hash":hash,
            # ── Inspection ──
            "isinstance":isinstance,"issubclass":issubclass,
            "hasattr":hasattr,"getattr":getattr,"setattr":setattr,"delattr":delattr,
            "callable":callable,"id":id,
            # ── String / bytes ──
            "repr":repr,"hex":hex,"oct":oct,"bin":bin,"chr":chr,"ord":ord,"format":format,
            "bytes":bytes,"bytearray":bytearray,"memoryview":memoryview,
            # ── Logic ──
            "any":any,"all":all,"not":None,
            # ── Functional ──
            "vars":vars,"dir":dir,"iter":iter,"next":next,
            "open":None,  # blocked for safety
            # ── Exceptions ──
            "Exception":Exception,"ValueError":ValueError,"TypeError":TypeError,
            "KeyError":KeyError,"IndexError":IndexError,"AttributeError":AttributeError,
            "NameError":NameError,"ZeroDivisionError":ZeroDivisionError,
            "StopIteration":StopIteration,"RuntimeError":RuntimeError,
            "NotImplementedError":NotImplementedError,"OSError":OSError,
            "ArithmeticError":ArithmeticError,"OverflowError":OverflowError,
            "FileNotFoundError":FileNotFoundError,
            # ── Builtins ──
            "True":True,"False":False,"None":None,
            "__name__":"__main__","__build_class__":__build_class__,
            # ── math module inline ──
            "__import__": None,   # blocked
        }}

        # Allow math module inside exec
        import math as _math
        safe_globals["math"] = _math

        exec(compile(code, "<ragsy>", "exec"), safe_globals)

        # Log any input() prompts that were hit
        if input_log:
            print("\n[Note: input() was called. Values returned as empty string during execution.]", file=out)
            for il in input_log:
                print(f"  {il}", file=out)

    except SystemExit:
        status = "exited"
    except Exception as e:
        status = "error"
        tb = traceback.format_exc()
        # Clean up internal path from traceback
        tb = re.sub(r'File ".*?ragsy.*?",', 'File "<your_code>",', tb)
        error = tb
        print(tb, file=err)
    finally:
        sys.stdout = old_out
        sys.stderr = old_err

    elapsed = int((datetime.utcnow()-start).total_seconds()*1000)
    return {
        "status":     status,
        "stdout":     out.getvalue(),
        "stderr":     err.getvalue(),
        "elapsed_ms": elapsed,
        "error":      error,
    }


# ══════════════════════════════════════════════════════════════════
# POST /run  — dedicated Run button endpoint (execution only)
# ══════════════════════════════════════════════════════════════════
@app.post("/run")
async def run_code(request: RunRequest, token: str = ""):
    code = request.code.strip()
    if not code:
        raise HTTPException(400, detail="Code cannot be empty")

    # Validate syntax first
    try:
        ast.parse(code)
    except SyntaxError as e:
        return {
            "status": "error",
            "stdout": "",
            "stderr": f"SyntaxError at line {e.lineno}: {e.msg}",
            "elapsed_ms": 0,
            "error": f"SyntaxError: {e.msg}",
        }

    result = run_code_safe(code)

    # Log action if authenticated
    if token:
        mobile = sessions_db.get(token)
        if mobile and mobile in users_db:
            log_action(users_db[mobile]["user_id"], "run_code")

    return result


# ══════════════════════════════════════════════════════════════════
# POST /visualize  — diagram + plain-English explanation
#                    (no longer auto-runs code)
# ══════════════════════════════════════════════════════════════════
@app.post("/visualize")
async def visualize_code(request: CodeRequest, token: str = ""):
    _ctr[0]=0; nodes=[]; edges=[]; code=request.code.strip()
    if not code: raise HTTPException(400, detail="Code cannot be empty")

    user_id=None
    if token:
        mobile=sessions_db.get(token)
        if mobile and mobile in users_db: user_id=users_db[mobile]["user_id"]

    code_id=new_cid()
    submissions_db[code_id]={
        "code_id":code_id,"user_id":user_id,"source_code":code,
        "language":request.language,"upload_time":datetime.utcnow().isoformat()
    }

    try: tree=ast.parse(code)
    except SyntaxError as e: raise HTTPException(400, detail=f"SyntaxError line {e.lineno}: {e.msg}")
    except Exception as e:   raise HTTPException(400, detail=str(e))

    # START node
    start_id=nid()
    nodes.append({"id":start_id,"type":"input","data":{"label":"▶  START"},
        "position":{"x":300,"y":0},
        "style":{"background":"#0f172a","color":"#fff","border":"2px solid #38bdf8",
                 "borderRadius":"50px","padding":"12px 28px","fontWeight":"bold",
                 "fontSize":"14px","textAlign":"center","minWidth":"140px",
                 "boxShadow":"0 0 24px #38bdf888","fontFamily":"'Fira Code',monospace"}})

    last_id=parse_statements(tree.body,nodes,edges,start_id,300,130) if tree.body else start_id

    # END node
    end_y=max(n["position"]["y"] for n in nodes)+150; end_id=nid()
    nodes.append({"id":end_id,"type":"output","data":{"label":"■  END"},
        "position":{"x":300,"y":end_y},
        "style":{"background":"#0f172a","color":"#fff","border":"2px solid #f43f5e",
                 "borderRadius":"50px","padding":"12px 28px","fontWeight":"bold",
                 "fontSize":"14px","textAlign":"center","minWidth":"140px",
                 "boxShadow":"0 0 24px #f43f5e88","fontFamily":"'Fira Code',monospace"}})
    edges.append(make_edge(last_id,end_id,color="#f43f5e"))

    explanation=plain_english_explanation(code, tree)
    explanations_db[code_id]={"explanation_id":code_id,"code_id":code_id,
                               "file_path":str(explanation),"download_count":0}
    flowcharts_db[code_id]={"flowchart_id":code_id,"code_id":code_id,
                             "diagram_path":{"nodes":nodes,"edges":edges},
                             "generated_time":datetime.utcnow().isoformat()}
    if user_id: log_action(user_id,"visualize")

    lines=len(code.splitlines())
    return {
        "code_id":     code_id,
        "nodes":       nodes,
        "edges":       edges,
        "explanation": explanation,   # list of {title, body}
        "stats":       {"node_count":len(nodes),"edge_count":len(edges),"lines_parsed":lines},
    }

@app.get("/submissions")
def get_submissions(token: str):
    user=user_by_token(token)
    return {"submissions":[s for s in submissions_db.values() if s["user_id"]==user["user_id"]]}

if __name__=="__main__":
    import uvicorn
    uvicorn.run("main:app",host="0.0.0.0",port=8000,reload=True)
