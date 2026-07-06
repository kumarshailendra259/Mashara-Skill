"""Offer-letter generation service.

Given a DOCX template with Jinja-style placeholders (``{{staff_name}}`` etc.),
render it against a staff+company context, convert to PDF using headless
LibreOffice, and email as an attachment via Resend.

Placeholders supported in the template
--------------------------------------
Staff:       staff_name, designation, joining_date, monthly_salary,
             monthly_salary_words, per_day_rate, email, mobile, address,
             gender, date_of_birth, pan
Login:       login_email, login_password
Company:     company_name, company_address, company_city, company_state,
             company_email, company_mobile, company_gst, company_pan
Meta:        today, generated_at, center_name

Placeholders not present in the DOCX are silently ignored — safe to add fields
to the template without touching this code.
"""
import asyncio
import base64
import logging
import os
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from typing import Optional

from docxtpl import DocxTemplate

logger = logging.getLogger(__name__)

def _find_soffice() -> Optional[str]:
    """Locate the LibreOffice binary. Called on every conversion attempt so a
    later apt install becomes visible without restarting the app."""
    return (shutil.which("soffice") or shutil.which("libreoffice")
            or shutil.which("/usr/bin/soffice") or None)


_SOFFICE = _find_soffice()


def _inr(v) -> str:
    try:
        n = float(v or 0)
    except (TypeError, ValueError):
        return "0"
    # Simple Indian grouping (12,34,567 style) — good enough for offer letters
    s = f"{n:,.2f}"
    return f"₹ {s}"


def _num_to_words_inr(n) -> str:
    """Very small subset of number-to-words for salary lines (up to 99,99,99,999)."""
    try:
        num = int(round(float(n or 0)))
    except (TypeError, ValueError):
        return ""
    if num == 0:
        return "Zero"
    ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
            "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
            "Seventeen", "Eighteen", "Nineteen"]
    tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]

    def under_hundred(x: int) -> str:
        if x < 20:
            return ones[x]
        return (tens[x // 10] + ("" if x % 10 == 0 else " " + ones[x % 10])).strip()

    def under_thousand(x: int) -> str:
        if x < 100:
            return under_hundred(x)
        return (ones[x // 100] + " Hundred" + ("" if x % 100 == 0 else " " + under_hundred(x % 100))).strip()

    parts = []
    crore = num // 10000000
    num %= 10000000
    lakh = num // 100000
    num %= 100000
    thousand = num // 1000
    num %= 1000
    hundred = num
    if crore:
        parts.append(under_thousand(crore) + " Crore")
    if lakh:
        parts.append(under_thousand(lakh) + " Lakh")
    if thousand:
        parts.append(under_thousand(thousand) + " Thousand")
    if hundred:
        parts.append(under_thousand(hundred))
    return " ".join(parts).strip() + " Only"


def _build_context(staff: dict, company: dict, center: Optional[dict],
                   login_email: str, login_password: Optional[str]) -> dict:
    salary = staff.get("monthly_salary") or 0
    return {
        # Staff
        "staff_name": staff.get("name") or "",
        "designation": staff.get("designation") or "",
        "joining_date": staff.get("joining_date") or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "monthly_salary": _inr(salary),
        "monthly_salary_number": f"{float(salary or 0):,.2f}",
        "monthly_salary_words": _num_to_words_inr(salary) + " Rupees" if salary else "",
        "per_day_rate": _inr(staff.get("per_day_rate") or 0),
        "email": staff.get("email") or "",
        "mobile": staff.get("mobile") or "",
        "address": staff.get("address") or "",
        "gender": (staff.get("gender") or "").title(),
        "date_of_birth": staff.get("date_of_birth") or "",
        "pan": staff.get("pan") or "",
        # Login
        "login_email": login_email or (staff.get("email") or ""),
        "login_password": login_password or "(existing account — password unchanged)",
        # Company
        "company_name": (company or {}).get("name") or "",
        "company_address": (company or {}).get("address") or "",
        "company_city": (company or {}).get("city") or "",
        "company_state": (company or {}).get("state") or "",
        "company_email": (company or {}).get("email") or "",
        "company_mobile": (company or {}).get("mobile") or "",
        "company_gst": (company or {}).get("gst_number") or "",
        "company_pan": (company or {}).get("pan_number") or "",
        # Meta
        "today": datetime.now(timezone.utc).strftime("%d %B %Y"),
        "generated_at": datetime.now(timezone.utc).strftime("%d %B %Y, %I:%M %p"),
        "center_name": (center or {}).get("name") or "",
    }


def _docx_to_pdf(docx_path: str, out_dir: str) -> Optional[str]:
    """Convert a DOCX file to PDF using headless LibreOffice.

    Returns the PDF path on success, or ``None`` when LibreOffice is unavailable
    or conversion fails. Callers should fall back to shipping the DOCX itself.
    """
    soffice = _SOFFICE or _find_soffice()
    if not soffice:
        logger.warning("LibreOffice (soffice) not installed — offer letter will be delivered as .docx")
        return None
    try:
        proc = subprocess.run(
            [soffice, "--headless", "--convert-to", "pdf", "--outdir", out_dir, docx_path],
            capture_output=True, text=True, timeout=90,
        )
    except subprocess.TimeoutExpired:
        logger.error("LibreOffice PDF conversion timed out — falling back to DOCX")
        return None
    if proc.returncode != 0:
        logger.error("LibreOffice conversion failed: %s", (proc.stderr or proc.stdout).strip()[:400])
        return None
    base = os.path.splitext(os.path.basename(docx_path))[0]
    pdf_path = os.path.join(out_dir, base + ".pdf")
    if not os.path.exists(pdf_path):
        logger.error("LibreOffice produced no PDF at %s", pdf_path)
        return None
    return pdf_path


def render_offer_letter(template_bytes: bytes, staff: dict, company: dict,
                        center: Optional[dict], login_email: str,
                        login_password: Optional[str]) -> tuple[bytes, str, str]:
    """Return `(binary, mime_type, extension)` for the rendered offer letter.

    - Prefer PDF (via LibreOffice) — letterhead, images, fonts stay pixel-perfect.
    - Fallback to DOCX when LibreOffice is unavailable (production runtimes without
      the ``libreoffice-writer`` package). The DOCX still carries the fully-rendered
      placeholders + letterhead the admin uploaded — recipients can open in Word,
      Google Docs, or any DOCX viewer.
    """
    ctx = _build_context(staff, company, center, login_email, login_password)
    with tempfile.TemporaryDirectory() as tmpd:
        src = os.path.join(tmpd, "template.docx")
        with open(src, "wb") as f:
            f.write(template_bytes)
        tpl = DocxTemplate(src)
        tpl.render(ctx)
        rendered = os.path.join(tmpd, "offer_letter.docx")
        tpl.save(rendered)
        pdf_path = _docx_to_pdf(rendered, tmpd)
        if pdf_path:
            with open(pdf_path, "rb") as f:
                return f.read(), "application/pdf", "pdf"
        # DOCX fallback
        with open(rendered, "rb") as f:
            return (
                f.read(),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "docx",
            )


async def send_offer_letter_email(to_email: str, name: str, letter_bytes: bytes,
                                  filename: str, company_name: str,
                                  content_type: str = "application/pdf") -> dict:
    """Deliver the offer letter (PDF or DOCX fallback) as attachment via Resend.
    Never raises — always returns ``{sent, id?, reason?}``.
    """
    key = os.environ.get("RESEND_API_KEY", "").strip()
    if not key:
        return {"sent": False, "reason": "resend_not_configured"}
    import resend
    resend.api_key = key
    sender = os.environ.get("SENDER_EMAIL", "onboarding@resend.dev").strip() or "onboarding@resend.dev"
    html = f"""\
<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f3f5fb;font-family:Arial,Helvetica,sans-serif;color:#111;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f3f5fb;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="background:#ffffff;border:1px solid #e2e6ec;">
        <tr><td style="background:#0a3bc5;color:#ffffff;padding:22px 24px;">
          <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;opacity:0.85;">{company_name}</div>
          <div style="font-size:22px;font-weight:900;margin-top:4px;">Your Offer Letter</div>
        </td></tr>
        <tr><td style="padding:24px;font-size:14px;line-height:1.55;">
          <p style="margin:0 0 12px;">Namaste <strong>{name}</strong>,</p>
          <p style="margin:0 0 12px;">Congratulations! Please find your official offer letter attached to this email as a PDF.</p>
          <p style="margin:0 0 12px;">The letter also contains your temporary login credentials for the portal. Kindly change your password after first login.</p>
          <p style="margin:16px 0 0;color:#5b6573;font-size:12px;">This is a system-generated message. If you have any questions, please reply to this email.</p>
        </td></tr>
        <tr><td style="background:#0a3bc5;color:#ffffff;padding:12px 24px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;text-align:center;">
          {company_name}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>
"""
    params = {
        "from": sender,
        "to": [to_email],
        "subject": f"Offer Letter — {company_name}",
        "html": html,
        "attachments": [{
            "filename": filename,
            "content": base64.b64encode(letter_bytes).decode("ascii"),
            "content_type": content_type,
        }],
    }
    try:
        res = await asyncio.to_thread(resend.Emails.send, params)
        return {"sent": True, "id": res.get("id") if isinstance(res, dict) else None}
    except Exception as e:
        logger.error("Offer letter email failed for %s: %s", to_email, e)
        return {"sent": False, "reason": str(e)[:250]}
