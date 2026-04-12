# Operator Portal API/MySQL Mapping

This document maps each `portal.cleanlemons.com/operator` page to backend APIs and MySQL tables.

## Page Mapping

| Page | Frontend Route | API(s) | MySQL Table(s) |
|---|---|---|---|
| Dashboard | `/operator` | `GET /api/cleanlemon/operator/dashboard`, `GET /api/cleanlemon/operator/notifications` | `cln_schedule`, `cln_property`, `cln_operator_notification` |
| Profile | `/operator/profile` | `GET/PUT /api/cleanlemon/employee/profile`, `GET /api/cleanlemon/banks`, `POST /api/cleanlemon/upload` | `cln_employee_profile`, `bank`, OSS URL fields |
| Company | `/operator/company` | `GET/PUT /api/cleanlemon/operator/settings`, `GET /api/cleanlemon/operator/invoices` | `cln_operator_settings`, `cln_client_invoice`, `cln_client_payment` |
| Contact | `/operator/contact` | `GET/POST/PUT/DELETE /api/cleanlemon/operator/contacts` | `cln_operator_contact` |
| Team | `/operator/team` | `GET/POST/PUT/DELETE /api/cleanlemon/operator/teams`, `GET /api/cleanlemon/operator/contacts`, `GET /api/cleanlemon/operator/properties` | `cln_operator_team`, `cln_operator_contact`, `cln_property` |
| Property | `/operator/property` | `GET/POST/PUT/DELETE /api/cleanlemon/operator/properties`, `GET/PUT /api/cleanlemon/pricing-config` | `cln_property`, `cln_operator_pricing_config` |
| Schedule | `/operator/schedule` | `GET/POST/PUT /api/cleanlemon/operator/schedule-jobs`, `GET /api/cleanlemon/operator/teams`, `GET /api/cleanlemon/operator/contacts`, `GET /api/cleanlemon/operator/properties` | `cln_schedule`, `cln_operator_team`, `cln_operator_contact`, `cln_property` |
| Agreement | `/operator/agreement` | `GET/POST /api/cleanlemon/operator/agreements`, `PUT /api/cleanlemon/operator/agreements/:id/sign`, `GET/POST /api/cleanlemon/operator/agreement-templates` | `cln_operator_agreement`, `cln_operator_agreement_template` |
| Invoices | `/operator/invoices` | `GET/POST/PUT/DELETE /api/cleanlemon/operator/invoices*`, `PUT /api/cleanlemon/operator/invoices/:id/status`, `GET /api/cleanlemon/operator/invoice-form-options` | `cln_client_invoice`, `cln_client_payment`, `cln_operator`, `cln_property` |
| Pricing | `/operator/pricing` | `GET/PUT /api/cleanlemon/pricing-config` | `cln_operator_pricing_config` |
| Calendar | `/operator/calender` | `GET/POST/PUT/DELETE /api/cleanlemon/operator/calendar-adjustments` | `cln_operator_calendar_adjustment` |
| Salary | `/operator/salary` | `GET /api/cleanlemon/operator/salaries` | `cln_kpi_deduction` |
| Accounting | `/operator/accounting` | `GET/PUT /api/cleanlemon/operator/accounting-mappings`, `POST /api/cleanlemon/operator/accounting-mappings/sync` | `cln_account`, `cln_account_client` |
| KPI | `/operator/kpi` | `GET /api/cleanlemon/operator/schedule-jobs`, `GET/PUT /api/cleanlemon/pricing-config`, `GET /api/cleanlemon/operator/kpi` | `cln_schedule`, `cln_operator_pricing_config`, `cln_kpi_deduction` |
| KPI Settings | `/operator/kpi-settings` | `GET/PUT /api/cleanlemon/pricing-config` | `cln_operator_pricing_config` |

## Notes

- Foreign-key convention follows `_id` fields where relational references exist.
- Most operator pages use `/api/cleanlemon/operator/*` to isolate portal-facing contracts.
- `operatorId` is currently sourced from auth context with fallback `op_demo_001`.

## Page -> API -> Table -> Key Fields

Use this as the per-page integration checklist.

| Page | API | Main Table | Key Read/Write Fields |
|---|---|---|---|
| Profile | `GET/PUT /api/cleanlemon/employee/profile` | `cln_employee_profile` | `email`, `full_name`, `legal_name`, `nickname`, `phone`, `address`, `entity_type`, `id_type`, `id_number`, `tax_id_no`, `bank_id`, `bank_account_no`, `bank_account_holder`, `avatar_url`, `nric_front_url`, `nric_back_url` |
| Pricing | `GET/PUT /api/cleanlemon/pricing-config` | `cln_operator_pricing_config` | `operator_id`, `config_json` (contains `selectedServices`, `serviceConfigs`, `employeeCleanerKpi`) |
| KPI Settings | `GET/PUT /api/cleanlemon/pricing-config` | `cln_operator_pricing_config` | `config_json.employeeCleanerKpi.servicePointRules`, `deductionPoints`, `goalsByPeriod` |
| KPI | `GET /api/cleanlemon/operator/kpi` + pricing-config | `cln_kpi_deduction`, `cln_operator_pricing_config` | KPI aggregates from `staff_email`, `point`; settings from `config_json` |
| Company | `GET/PUT /api/cleanlemon/operator/settings` | `cln_operator_settings` | `operator_id`, `settings_json` (integration flags, automation config, product options) |
| Salary | `GET /api/cleanlemon/operator/salaries` | `cln_kpi_deduction` | read-only aggregates from `staff_email`, `point`, task counts |
| Contact | `GET/POST/PUT/DELETE /api/cleanlemon/operator/contacts` | `cln_operator_contact` | `name`, `email`, `phone`, `permissions_json`, `status`, `joined_at`, `employment_status`, `salary_basic`, `team`, `bank_name`, `bank_account_no`, `trainings_json`, `remark_history_json` |
| Team | `GET/POST/PUT/DELETE /api/cleanlemon/operator/teams` | `cln_operator_team` | `name`, `member_ids_json`, `authorize_mode`, `selected_property_ids_json`, `rest_days_json`, `created_at` |
| Dashboard | `GET /api/cleanlemon/operator/dashboard` | `cln_schedule`, `cln_property` | stats from counts and today task list (`status`, `working_day`, `property_id`) |
| Schedule | `GET/POST/PUT /api/cleanlemon/operator/schedule-jobs` | `cln_schedule` | create: `property_id`, `working_day`, `status`, `cleaning_type`, `team`; update: `team`, `status`, `start_time`, `end_time`, `finalphoto_json`, `submit_by` |
| Agreement | `GET/POST /api/cleanlemon/operator/agreements`, `PUT .../sign` | `cln_operator_agreement`, `cln_operator_agreement_template` | agreement: `recipient_name`, `recipient_email`, `recipient_type`, `template_name`, `salary`, `start_date`, `status`, `signed_meta_json`; template: `name`, `mode`, `template_url`, `folder_url`, `description` |
| Invoices | `GET/POST/PUT/DELETE /api/cleanlemon/operator/invoices*` | `cln_client_invoice`, `cln_client_payment` | `invoice_number`, `client_id`, `description`, `amount`, `payment_received`; paid/void state by `payment_received` + payment rows |
| Property | `GET/POST/PUT/DELETE /api/cleanlemon/operator/properties` | `cln_property` | `property_name`, `address`, `unit_name`, `client_label`, `team` |
| Accounting | `GET/PUT /api/cleanlemon/operator/accounting-mappings` | `cln_account` (templates), `cln_account_client` (`operator_id`, `account_id`, `external_account`, `external_product`, `system`, `mapped`) | API `id` = template `cln_account.id`; per-operator mapping in `cln_account_client` |
| Calendar | `GET/POST/PUT/DELETE /api/cleanlemon/operator/calendar-adjustments` | `cln_operator_calendar_adjustment` | `name`, `remark`, `start_date`, `end_date`, `adjustment_type`, `value_type`, `value`, `products_json`, `properties_json`, `clients_json` |

## Per-Page Execution Steps (Copy/Paste)

1. Verify page loads with non-empty API response.
2. Verify at least one create/update action writes to MySQL table.
3. Refresh page and confirm persisted values are returned from API.
4. Verify failed request shows user-facing error (toast/dialog/state).
5. Verify filters/search are API-backed or consistent with latest server response.
