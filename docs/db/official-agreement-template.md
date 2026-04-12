# Official agreement templates (credit purchase)

## Migration

Run:

```bash
mysql ... < src/db/migrations/0124_official_agreement_template.sql
```

## Catalog (`official_agreement_template`)

| Column         | Description                                      |
|----------------|--------------------------------------------------|
| `id`           | UUID (e.g. `UUID()` in MySQL 8+)                 |
| `agreementname`| Display name                                     |
| `url`          | Google Docs link (`https://docs.google.com/document/d/DOC_ID/edit`) |
| `credit`       | Price in credits (integer)                       |
| `sort_order`   | Lower first                                      |
| `active`       | `1` = shown in portal                            |

### Example insert

```sql
INSERT INTO official_agreement_template (id, agreementname, url, credit, sort_order, active)
VALUES (
  UUID(),
  'Tenancy Agreement Template',
  'https://docs.google.com/document/d/15Iyrd3I0sFFq4ssnNEe00IKdMclHG5sU_VKZxeA-oy0/edit?usp=sharing',
  50,
  0,
  1
);
```

## Download (.docx)

The backend exports the Google Doc as **Word** via **Google Drive API** using the same service account as agreement PDF (`GOOGLE_SERVICE_ACCOUNT_JSON` or `GOOGLE_APPLICATION_CREDENTIALS`).

**You must share each catalog Doc with that service account’s email** (Viewer is enough), or export will fail.

## Portal behavior

- **Finance / Billing** (or Admin): **Official Template** button opens the catalog; can select unpurchased rows and **Purchase** (deducts credits, records `client_official_template_purchase`).
- **Anyone** with Agreement Setting access: if the client has purchased templates, they appear under **Official templates (your organization)** with **Download .docx** (file download, not opening the Doc in the browser).

## Tables

- `official_agreement_template` — platform-managed catalog.
- `client_official_template_purchase` — `(client_id, template_id)` permanent ownership after purchase.
