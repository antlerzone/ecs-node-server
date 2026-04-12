# Enquiry tab (SaaS Admin) – required migrations

For the **SaaS Admin → Enquiry** tab to work fully:

1. **0113_client_profile_enquiry_extra.sql**  
   Adds `enquiry_remark`, `enquiry_units`, `enquiry_plan_of_interest` to `client_profile`.  
   - Needed so that submissions from **portal.colivingjb.com/enquiry** (Number of units, Plan of interest, Message) are stored and shown in **SAAS Enquiry – Detail**.

2. **0114_enquiry_acknowledged.sql**  
   Adds `enquiry_acknowledged_at` to `client_profile` and `acknowledged_at` to `owner_enquiry`.  
   - Needed so that **Acknowledge** is persisted: after refresh the button stays disabled and the **Enquiry N** tab count decreases (e.g. Enquiry 2 → Enquiry 1).  
   - If 0114 is not run, the UI still disables the button and updates the count in the current session (optimistic state), but after a full reload the server has no acknowledged state.

**Run on your DB:**

```bash
node scripts/run-migration.js src/db/migrations/0113_client_profile_enquiry_extra.sql
node scripts/run-migration.js src/db/migrations/0114_enquiry_acknowledged.sql
```

Then restart the Node app: `pm2 restart app`.
