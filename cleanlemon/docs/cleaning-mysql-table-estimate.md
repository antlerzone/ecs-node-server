# Cleaning SaaS MySQL Table Estimate (Plan Draft)

## Estimate summary

Based on the current multi-domain plan and the provided Wix legacy scope, a practical first rollout for Cleaning SaaS likely needs:

- **Core MVP:** about **8 to 10 new tables**
- **With payroll + agreement + audit depth:** about **12 to 16 new tables**

This estimate assumes we reuse existing shared auth/access/accounting infrastructure where possible.

## Suggested table groups

### A. Core operations (MVP)

1. `cln_job`
2. `cln_job_assignment`
3. `cln_job_status_log`
4. `cln_property`
5. `cln_property_unit`
6. `cln_staff_profile`
7. `cln_client_profile`
8. `cln_damage_report`

### B. Attendance and field evidence

9. `cln_attendance`
10. `cln_job_media`

### C. Billing and finance

11. `cln_invoice`
12. `cln_invoice_payment`

### D. HR and agreement (if phase-2 included)

13. `cln_payslip`
14. `cln_offer_letter`
15. `cln_kpi_event`
16. `cln_feedback`

## Recommendation by phase

- **Phase 1 (go-live fast):** A + B (10 tables max)
- **Phase 2 (finance complete):** add C (+2)
- **Phase 3 (HR workflow):** add D (+4)

## Notes

- Exact schema should be finalized after confirming which legacy Wix fields remain mandatory.
- Keep all Cleanlemon tables under dedicated module/service boundary to avoid Coliving coupling.
