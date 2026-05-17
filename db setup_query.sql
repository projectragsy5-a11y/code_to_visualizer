CREATE DATABASE code_architecture_visualizer;
GO

USE code_architecture_visualizer;
GO

-- ── 1. USERS TABLE ──────────────────────────────────────────────────
CREATE TABLE USERS (
    user_id    INT           PRIMARY KEY IDENTITY(1,1),
    username   NVARCHAR(50)  UNIQUE NOT NULL,
    mobile_no  NVARCHAR(20)  UNIQUE NOT NULL,
    password   NVARCHAR(64)  NOT NULL,          -- SHA-256 hash
    created_at DATETIME2     DEFAULT GETUTCDATE(),
    is_admin   BIT           NOT NULL DEFAULT 0
);

-- ── 2. OTP VERIFICATION TABLE ────────────────────────────────────────
CREATE TABLE OTP_VERIFICATION (
    otp_id      INT          PRIMARY KEY IDENTITY(1,1),
    user_id     INT          NOT NULL,
    otp_code    NVARCHAR(20) NOT NULL,
    expiry_time DATETIME2    NOT NULL,
    status      NVARCHAR(20) DEFAULT 'pending',  -- pending / verified / expired
    CONSTRAINT FK_OTP_USER FOREIGN KEY (user_id) REFERENCES USERS(user_id) ON DELETE CASCADE
);

-- ── 3. CODE SUBMISSIONS TABLE ────────────────────────────────────────
CREATE TABLE CODE_SUBMISSIONS (
    code_id     INT           PRIMARY KEY IDENTITY(1,1),
    user_id     INT           NOT NULL,
    source_code NVARCHAR(MAX) NOT NULL,          -- AES-256 Fernet encrypted
    language    NVARCHAR(20)  DEFAULT 'python',  -- python / javascript
    upload_time DATETIME2     DEFAULT GETUTCDATE(),
    CONSTRAINT FK_SUB_USER FOREIGN KEY (user_id) REFERENCES USERS(user_id) ON DELETE CASCADE
);

-- ── 4. FLOWCHARTS TABLE ──────────────────────────────────────────────
CREATE TABLE FLOWCHARTS (
    flowchart_id   INT           PRIMARY KEY IDENTITY(1,1),
    code_id        INT           NOT NULL,
    diagram_path   NVARCHAR(MAX) NULL,           -- JSON of nodes + edges
    generated_time DATETIME2     DEFAULT GETUTCDATE(),
    CONSTRAINT FK_FLOW_CODE FOREIGN KEY (code_id) REFERENCES CODE_SUBMISSIONS(code_id) ON DELETE CASCADE
);

-- ── 5. EXPLANATIONS TABLE ────────────────────────────────────────────
CREATE TABLE EXPLANATIONS (
    explanation_id INT           PRIMARY KEY IDENTITY(1,1),
    code_id        INT           NOT NULL,
    file_path      NVARCHAR(MAX) NULL,           -- JSON explanation content
    download_count INT           DEFAULT 0,
    CONSTRAINT FK_EXP_CODE FOREIGN KEY (code_id) REFERENCES CODE_SUBMISSIONS(code_id) ON DELETE CASCADE
);

-- ── 6. USER ACTIONS LOG TABLE ────────────────────────────────────────
CREATE TABLE USER_ACTIONS_LOG (
    log_id      INT          PRIMARY KEY IDENTITY(1,1),
    user_id     INT          NOT NULL,
    action      NVARCHAR(50) DEFAULT 'action',
    action_time DATETIME2    DEFAULT GETUTCDATE(),
    CONSTRAINT FK_LOG_USER FOREIGN KEY (user_id) REFERENCES USERS(user_id) ON DELETE CASCADE
);

-- ── 7. REPORTS TABLE ─────────────────────────────────────────────────
CREATE TABLE REPORTS (
    report_id   INT          PRIMARY KEY IDENTITY(1,1),
    user_id     INT          NOT NULL,
    action_type NVARCHAR(50) NULL,
    action_time DATETIME2    DEFAULT GETUTCDATE(),
    CONSTRAINT FK_REP_USER FOREIGN KEY (user_id) REFERENCES USERS(user_id) ON DELETE CASCADE
);

-- Speed up user lookups
CREATE INDEX IX_USERS_USERNAME   ON USERS(username);
CREATE INDEX IX_USERS_MOBILE     ON USERS(mobile_no);

-- Speed up submission queries by user
CREATE INDEX IX_SUBMISSIONS_USER ON CODE_SUBMISSIONS(user_id);
CREATE INDEX IX_SUBMISSIONS_TIME ON CODE_SUBMISSIONS(upload_time DESC);

-- Speed up flowchart lookups
CREATE INDEX IX_FLOWCHARTS_CODE  ON FLOWCHARTS(code_id);

-- Speed up OTP lookups
CREATE INDEX IX_OTP_USER         ON OTP_VERIFICATION(user_id);

-- Speed up activity log queries
CREATE INDEX IX_LOG_USER         ON USER_ACTIONS_LOG(user_id);
CREATE INDEX IX_LOG_TIME         ON USER_ACTIONS_LOG(action_time DESC);


-- Password = "admin" (SHA-256 hash)
-- CHANGE THIS PASSWORD AFTER FIRST LOGIN
INSERT INTO USERS (username, mobile_no, password, created_at, is_admin)
VALUES (
    'admin',
    '9999999999',
    '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918',
    GETUTCDATE(),
    1
);

-- Check all tables exist
SELECT 
    TABLE_NAME,
    TABLE_TYPE
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_CATALOG = 'code_architecture_visualizer'
ORDER BY TABLE_NAME;

-- Check all columns in USERS table
SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    CHARACTER_MAXIMUM_LENGTH,
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'USERS'
ORDER BY ORDINAL_POSITION;

-- Check admin user was created
SELECT user_id, username, mobile_no, created_at, is_admin
FROM USERS;


-- Add is_admin column if missing
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'USERS' AND COLUMN_NAME = 'is_admin'
)
ALTER TABLE USERS ADD is_admin BIT NOT NULL DEFAULT 0;

-- Make source_code support encrypted content (longer text)
ALTER TABLE CODE_SUBMISSIONS
    ALTER COLUMN source_code NVARCHAR(MAX) NOT NULL;

-- Add action column to USER_ACTIONS_LOG if missing
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'USER_ACTIONS_LOG' AND COLUMN_NAME = 'action'
)
ALTER TABLE USER_ACTIONS_LOG ADD action NVARCHAR(50) DEFAULT 'action';

-- Set existing user as admin (replace 'your_username')
UPDATE USERS SET is_admin = 1 WHERE username = 'admin';


-- View all users
SELECT 
    user_id,
    username,
    mobile_no,
    created_at,
    is_admin
FROM USERS
ORDER BY created_at DESC;

-- View all code submissions (metadata only, not encrypted content)
SELECT 
    cs.code_id,
    u.username,
    cs.language,
    LEN(cs.source_code) AS encrypted_size_chars,
    cs.upload_time
FROM CODE_SUBMISSIONS cs
JOIN USERS u ON u.user_id = cs.user_id
ORDER BY cs.upload_time DESC;

-- Count submissions per user
SELECT 
    u.username,
    COUNT(cs.code_id) AS total_submissions,
    MAX(cs.upload_time) AS last_active
FROM USERS u
LEFT JOIN CODE_SUBMISSIONS cs ON cs.user_id = u.user_id
WHERE u.is_admin = 0
GROUP BY u.username
ORDER BY total_submissions DESC;

-- View platform stats (same as Admin Dashboard)
SELECT
    (SELECT COUNT(*) FROM USERS WHERE is_admin = 0)                        AS total_users,
    (SELECT COUNT(*) FROM CODE_SUBMISSIONS)                                AS total_submissions,
    (SELECT COUNT(*) FROM FLOWCHARTS)                                      AS total_flowcharts,
    (SELECT COUNT(*) FROM USERS WHERE created_at >= DATEADD(DAY,-7,GETUTCDATE())) AS new_this_week;

-- View recent activity log
SELECT 
    u.username,
    l.action,
    l.action_time
FROM USER_ACTIONS_LOG l
JOIN USERS u ON u.user_id = l.user_id
ORDER BY l.action_time DESC;

-- View OTP records
SELECT 
    u.username,
    o.otp_code,
    o.expiry_time,
    o.status,
    CASE 
        WHEN GETUTCDATE() > o.expiry_time THEN 'EXPIRED'
        ELSE 'VALID'
    END AS current_state
FROM OTP_VERIFICATION o
JOIN USERS u ON u.user_id = o.user_id
ORDER BY o.otp_id DESC;

-- Delete expired OTPs (cleanup)
DELETE FROM OTP_VERIFICATION
WHERE expiry_time < GETUTCDATE()
AND status != 'verified';

-- Change admin password (replace NewPassword123 with your password)
-- First get the hash:
-- python -c "import hashlib; print(hashlib.sha256('NewPassword123'.encode()).hexdigest())"
-- Then paste the hash here:
UPDATE USERS
SET password = 'paste_sha256_hash_here'
WHERE username = 'admin';

-- Delete a user and all their data (CASCADE handles related records)
DELETE FROM USERS WHERE username = 'username_to_delete' AND is_admin = 0;

-- View flowchart generation stats per language
SELECT 
    cs.language,
    COUNT(*) AS submission_count
FROM CODE_SUBMISSIONS cs
GROUP BY cs.language;