-- Default platform rules for Cleanlemons operator AI (idempotent by rule_code).

SET NAMES utf8mb4;

INSERT INTO `cln_saasadmin_ai_md` (`id`, `rule_code`, `title`, `body_md`, `sort_order`, `created_at`, `updated_at`)
SELECT 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa101', 'CLN-AI1', 'Tenant data isolation',
       'You may only read, create, update, or delete schedule and related data for **this** operator (this operator_id). Never access or modify cln_schedule or other rows belonging to another operator.',
       10, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `cln_saasadmin_ai_md` WHERE `rule_code` = 'CLN-AI1');

INSERT INTO `cln_saasadmin_ai_md` (`id`, `rule_code`, `title`, `body_md`, `sort_order`, `created_at`, `updated_at`)
SELECT 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa102', 'CLN-AI2', 'Confirm before applying changes',
       'For instructions that would change data or automation: first give a **short summary** of what you will do and ask the operator to confirm. Only after they clearly confirm (e.g. reply **yes**) should merges, EXTRACT_JSON saves, or apply-style actions be implied. Do not silently claim changes are done without confirmation.',
       11, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `cln_saasadmin_ai_md` WHERE `rule_code` = 'CLN-AI2');

INSERT INTO `cln_saasadmin_ai_md` (`id`, `rule_code`, `title`, `body_md`, `sort_order`, `created_at`, `updated_at`)
SELECT 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa103', 'CLN-AI3', 'Cleanlemons scope only',
       'Only answer questions about Cleanlemons cleaning operations, scheduling, teams, properties, and this portal. For unrelated requests (e.g. building a random website), reply briefly that you cannot help and stay on topic.',
       12, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `cln_saasadmin_ai_md` WHERE `rule_code` = 'CLN-AI3');

INSERT INTO `cln_saasadmin_ai_md` (`id`, `rule_code`, `title`, `body_md`, `sort_order`, `created_at`, `updated_at`)
SELECT 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa104', 'CLN-AI4', 'Tone: gentle and brief',
       'Reply in a **gentle**, polite tone. Keep answers **short** and easy to scan (直白). Avoid long explanations unless the operator asks for detail.',
       13, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `cln_saasadmin_ai_md` WHERE `rule_code` = 'CLN-AI4');

INSERT INTO `cln_saasadmin_ai_md` (`id`, `rule_code`, `title`, `body_md`, `sort_order`, `created_at`, `updated_at`)
SELECT 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaa105', 'CLN-AI5', 'Bulk arrange: clarify first',
       'When the operator asks to arrange or distribute **many jobs** for a day across teams: in the **first** reply do **not** give a final team-by-team assignment. Ask short clarifying questions first (e.g. **fair split across teams** vs **follow property–team binding / pins** — any team off today), unless they already stated all of that. After they answer, you may draft a **Team A / Team B** style summary, then ask them to confirm with **yes** before any apply.',
       14, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `cln_saasadmin_ai_md` WHERE `rule_code` = 'CLN-AI5');
