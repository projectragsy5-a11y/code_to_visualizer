# Code to Visualizer Pro — Backend

## Setup & Run

```bash
# 1. Create virtual environment
python -m venv venv

# 2. Activate it
# Windows:
venv\Scripts\activate
# Mac/Linux:
source venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Run the server
python main.py
```

Server runs at: http://localhost:8000
API Docs at:    http://localhost:8000/docs

## API Endpoints

| Method | Route               | Description                        |
|--------|---------------------|------------------------------------|
| GET    | /                   | Health check                       |
| GET    | /health             | Detailed health                    |
| POST   | /auth/register      | Register new user (returns OTP)    |
| POST   | /auth/verify-otp    | Verify OTP, activate account       |
| POST   | /auth/resend-otp    | Resend OTP (30s cooldown on FE)    |
| POST   | /auth/login         | Login (returns token)              |
| POST   | /auth/logout        | Logout (invalidate token)          |
| GET    | /auth/me?token=...  | Get current user info              |
| POST   | /visualize          | Parse Python code → nodes + edges  |

## /visualize Request / Response

**Request:**
```json
{ "code": "x = 1\nif x > 0:\n    print(x)" }
```

**Response:**
```json
{
  "nodes": [ ... ],
  "edges": [ ... ],
  "stats": {
    "node_count": 5,
    "edge_count": 4,
    "lines_parsed": 3
  }
}
```

## Supported Python Constructs

- Variables / assignments (`=`, `+=`, `-=`, type annotations)
- Functions (`def`, `async def`, decorators)
- Classes (`class`)
- Conditionals (`if`, `elif`, `else`)
- Loops (`for`, `while`, `break`, `continue`)
- Returns
- Imports (`import`, `from ... import`)
- Try / Except / Finally
- `with` statements
- `raise`, `assert`, `del`, `pass`
- `print()` calls + general function calls
- `global`, `nonlocal`
