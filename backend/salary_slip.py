"""Salary slip generation service (Phase B of the SalaryBox-style HRMS).

Given a DOCX template with Jinja-style placeholders (``{{staff_name}}``,
``{{net_salary}}``, etc.), render it against a staff + payroll + company
context and return the resulting PDF bytes (with a DOCX fallback if
LibreOffice is not available at runtime).

Placeholders supported in the template
--------------------------------------
Staff          : staff_name, employee_code, designation, joining_date,
                 monthly_salary, per_day_rate, email, mobile, address,
                 pan, bank_name, bank_account_no, ifsc, account_holder_name
Payroll (core) : month, month_name, year, month_year, days_present,
                 working_days, base_salary
Earnings       : basic, hra, da, conveyance, bonus, incentive,
                 overtime_pay, other_earnings, reimbursements_paid, gross
Deductions     : pf_deduction, esi_deduction, late_deduction, early_fine,
                 advance, loan_deduction, other_deductions_total, total_deductions
Totals         : net, net_words
Company        : company_name, company_address, company_city, company_state,
                 company_email, company_mobile, company_gst, company_pan
Center         : center_name
Meta           : today, generated_at

Silent-ignore is used for missing placeholders — you can freely add new
fields to a template without touching this module.
"""
from __future__ import annotations

import logging
import os
import subprocess
import tempfile
from datetime import datetime, timezone
from typing import Optional

from docxtpl import DocxTemplate

logger = logging.getLogger(__name__)

_INDIAN_UNITS = [
    "", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
    "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
    "seventeen", "eighteen", "nineteen",
]
_INDIAN_TENS = [
    "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
]


def _below_hundred(n: int) -> str:
    if n < 20:
        return _INDIAN_UNITS[n]
    return (_INDIAN_TENS[n // 10] + (" " + _INDIAN_UNITS[n % 10] if n % 10 else "")).strip()


def _amount_to_words(amount: float) -> str:
    """Convert amount to Indian-English words (best-effort). Returns empty on non-numeric."""
    try:
        n = int(round(float(amount)))
    except (TypeError, ValueError):
        return ""
    if n == 0:
        return "Zero Rupees Only"
    if n < 0:
        return "Minus " + _amount_to_words(-n)
    crore = n // 10000000
    n %= 10000000
    lakh = n // 100000
    n %= 100000
    thousand = n // 1000
    n %= 1000
    hundred = n // 100
    below = n % 100
    parts = []
    if crore:
        parts.append(_below_hundred(crore) + " crore")
    if lakh:
        parts.append(_below_hundred(lakh) + " lakh")
    if thousand:
        parts.append(_below_hundred(thousand) + " thousand")
    if hundred:
        parts.append(_INDIAN_UNITS[hundred] + " hundred")
    if below:
        parts.append(_below_hundred(below))
    return "Rupees " + " ".join(parts).strip().title() + " Only"


_MONTHS = [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


def _build_context(staff: dict, payroll: dict, company: dict,
                   center: Optional[dict]) -> dict:
    now_iso = datetime.now(timezone.utc).isoformat()
    m = int(payroll.get("month") or 0)
    month_name = _MONTHS[m] if 1 <= m <= 12 else ""
    other_ded_total = sum((li.get("amount", 0) or 0) for li in (payroll.get("other_deductions") or []))
    net = payroll.get("net", 0) or 0
    ctx = {
        # Staff
        "staff_name": staff.get("name") or "",
        "employee_code": staff.get("employee_code") or "",
        "designation": staff.get("designation") or "",
        "joining_date": staff.get("joining_date") or "",
        "monthly_salary": staff.get("monthly_salary") or 0,
        "per_day_rate": staff.get("per_day_rate") or 0,
        "email": staff.get("email") or "",
        "mobile": staff.get("mobile") or "",
        "address": staff.get("address") or "",
        "pan": staff.get("pan") or "",
        "bank_name": staff.get("bank_name") or "",
        "bank_account_no": staff.get("bank_account_no") or "",
        "ifsc": staff.get("ifsc") or "",
        "account_holder_name": staff.get("account_holder_name") or staff.get("name") or "",
        # Payroll core
        "month": m,
        "month_name": month_name,
        "year": payroll.get("year") or "",
        "month_year": f"{month_name} {payroll.get('year')}" if month_name else str(payroll.get("year") or ""),
        "days_present": payroll.get("days_present") or 0,
        "working_days": payroll.get("working_days") or 0,
        "base_salary": payroll.get("base_salary") or 0,
        # Earnings
        "basic": payroll.get("basic") or 0,
        "hra": payroll.get("hra") or 0,
        "da": payroll.get("da") or 0,
        "conveyance": payroll.get("conveyance") or 0,
        "bonus": payroll.get("bonus") or 0,
        "incentive": payroll.get("incentive") or 0,
        "overtime_pay": payroll.get("overtime_pay") or 0,
        "other_earnings": payroll.get("other_earnings") or 0,
        "reimbursements_paid": payroll.get("reimbursements_paid") or 0,
        "gross": payroll.get("gross") or 0,
        # Deductions
        "pf_deduction": payroll.get("pf_deduction") or 0,
        "esi_deduction": payroll.get("esi_deduction") or 0,
        "late_deduction": payroll.get("late_deduction") or 0,
        "early_fine": payroll.get("early_fine") or 0,
        "advance": payroll.get("advance") or 0,
        "loan_deduction": payroll.get("loan_deduction") or 0,
        "other_deductions_total": other_ded_total,
        "total_deductions": payroll.get("deductions") or 0,
        # Totals
        "net": net,
        "net_words": _amount_to_words(net),
        # Company
        "company_name": (company or {}).get("name") or "",
        "company_address": (company or {}).get("address") or "",
        "company_city": (company or {}).get("city") or "",
        "company_state": (company or {}).get("state") or "",
        "company_email": (company or {}).get("email") or "",
        "company_mobile": (company or {}).get("mobile") or "",
        "company_gst": (company or {}).get("gst") or "",
        "company_pan": (company or {}).get("pan") or "",
        # Center
        "center_name": (center or {}).get("name") or "",
        # Meta
        "today": datetime.now(timezone.utc).strftime("%d %b %Y"),
        "generated_at": now_iso,
    }
    return ctx


def _docx_to_pdf(docx_path: str, out_dir: str) -> Optional[str]:
    """Convert a rendered DOCX to PDF via headless LibreOffice.
    Returns the pdf path on success, None otherwise (fallback path).
    """
    try:
        subprocess.run(
            ["libreoffice", "--headless", "--convert-to", "pdf", "--outdir", out_dir, docx_path],
            check=True, capture_output=True, timeout=45,
        )
        for f in os.listdir(out_dir):
            if f.endswith(".pdf"):
                return os.path.join(out_dir, f)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError) as e:
        logger.warning("LibreOffice PDF conversion failed: %s", e)
    return None


def render_salary_slip(template_bytes: bytes, staff: dict, payroll: dict,
                       company: dict, center: Optional[dict]) -> tuple[bytes, str, str]:
    """Return `(binary, mime_type, extension)` for the rendered salary slip.
    Prefers PDF via LibreOffice, falls back to DOCX when LibreOffice is
    unavailable at runtime.
    """
    ctx = _build_context(staff, payroll, company, center)
    with tempfile.TemporaryDirectory() as tmpd:
        src = os.path.join(tmpd, "slip_tpl.docx")
        with open(src, "wb") as f:
            f.write(template_bytes)
        tpl = DocxTemplate(src)
        tpl.render(ctx)
        rendered = os.path.join(tmpd, "salary_slip.docx")
        tpl.save(rendered)
        pdf_path = _docx_to_pdf(rendered, tmpd)
        if pdf_path:
            with open(pdf_path, "rb") as f:
                return f.read(), "application/pdf", "pdf"
        with open(rendered, "rb") as f:
            return (
                f.read(),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "docx",
            )
