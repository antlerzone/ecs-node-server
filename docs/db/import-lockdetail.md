# LockDetail: clear, migration, CSV import

## Scripts

- Clear: `node scripts/truncate-lockdetail.js`
- Import: `node scripts/import-lockdetail.js [path]` (default `./LockDetail.csv`)

## Step-by-step upload

1. Export LockDetail to CSV, save in **Downloads** as **`LockDetail.csv`**.
2. **PowerShell (on your PC)**:
   ```powershell
   scp -i $HOME\.ssh\malaysia-ecs-key.pem "$env:USERPROFILE\Downloads\LockDetail.csv" ecs-user@47.250.141.3:/home/ecs-user/app/LockDetail.csv
   ```
3. **SSH to ECS** then:
   ```bash
   cd /home/ecs-user/app
   export $(grep -v '^#' .env | xargs)
   mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < src/db/migrations/0005_lockdetail_gateway_wixid.sql
   node scripts/truncate-lockdetail.js
   node scripts/import-lockdetail.js ./LockDetail.csv
   ```

## Files

- PC: `Downloads\LockDetail.csv`
- ECS: `/home/ecs-user/app/LockDetail.csv`

## Column mapping (CSV row 1 to table)

| CSV header | Table column | FK |
|------------|--------------|-----|
| ID | wix_id | - |
| gateway | gateway_wixid | gateway_id |
| Lockid | lockid | - |
| Lockname | lockname | - |
| Electricquantity | electricquantity | - |
| Type | type | - |
| Hasgateway | hasgateway | - |
| Lockalias | lockalias | - |
| client | client_wixid | client_id |
| active | active | - |
| Childmeter | childmeter (json) | - |

## Download (ECS to PC)

```powershell
scp -i $HOME\.ssh\malaysia-ecs-key.pem ecs-user@47.250.141.3:/home/ecs-user/app/LockDetail.csv "$env:USERPROFILE\Downloads\LockDetail.csv"
```
