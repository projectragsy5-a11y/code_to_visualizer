USE code_architecture_visualizer;

-- Check what's stored for admin
SELECT username, password, is_admin FROM USERS WHERE username = 'admin';

-- This sets password to exactly "admin"
UPDATE USERS 
SET password = '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918'
WHERE username = 'admin';


SELECT username, password, is_admin FROM USERS WHERE username = 'admin';

