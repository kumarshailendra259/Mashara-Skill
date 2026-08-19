"""Email helpers (Resend). Gracefully no-ops when RESEND_API_KEY is empty."""
import asyncio
import logging
import os
import secrets
import string
from typing import Optional

import resend

logger = logging.getLogger(__name__)

_PWD_ALPHABET = string.ascii_letters + string.digits + "!@#$%&*-_=+?"


def generate_password(length: int = 12) -> str:
    """Cryptographically-secure random password (default 12 chars)."""
    # Ensure at least one of each class for typical password policies
    pwd = [
        secrets.choice(string.ascii_uppercase),
        secrets.choice(string.ascii_lowercase),
        secrets.choice(string.digits),
        secrets.choice("!@#$%&*-_=+?"),
    ]
    pwd += [secrets.choice(_PWD_ALPHABET) for _ in range(max(4, length - 4))]
    secrets.SystemRandom().shuffle(pwd)
    return "".join(pwd)


def _client_ready() -> bool:
    key = os.environ.get("RESEND_API_KEY", "").strip()
    if not key:
        return False
    resend.api_key = key
    return True


async def send_credentials_email(
    to_email: str,
    name: str,
    password: str,
    check_in_url: str,
    portal_url: Optional[str] = None,
) -> dict:
    """Send the staff-credentials email. Returns {sent: bool, id?: str, reason?: str}.

    Never raises — failures are logged and reported in the dict so the caller can
    still complete the rest of the workflow (staff creation, etc.).
    """
    if not _client_ready():
        logger.warning("Resend not configured (RESEND_API_KEY empty) — email skipped for %s", to_email)
        return {"sent": False, "reason": "resend_not_configured"}

    sender = os.environ.get("SENDER_EMAIL", "onboarding@resend.dev").strip() or "onboarding@resend.dev"
    portal_url = portal_url or check_in_url.rstrip("/").rsplit("/", 1)[0] or check_in_url

    html = f"""\
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f3f5fb;font-family:Arial,Helvetica,sans-serif;color:#111;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f3f5fb;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="background:#ffffff;border:1px solid #e2e6ec;">
        <tr>
          <td style="background:#0a3bc5;color:#ffffff;padding:24px;">
            <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;opacity:0.85;">Mashara Skills and Creative Learning Pvt Ltd</div>
            <div style="font-size:22px;font-weight:900;margin-top:4px;">Welcome to Mashara Finance</div>
          </td>
        </tr>
        <tr><td style="padding:24px 24px 0;font-size:14px;line-height:1.55;">
          <p style="margin:0 0 12px;">Namaste <strong>{name}</strong>,</p>
          <p style="margin:0 0 12px;">Your staff login has been created. Use the credentials below to sign in to the portal and mark your daily attendance.</p>
        </td></tr>
        <tr><td style="padding:8px 24px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f7f8fb;border:1px solid #e2e6ec;">
            <tr><td style="padding:14px 16px;font-size:13px;">
              <div style="color:#5b6573;letter-spacing:0.1em;font-size:10px;text-transform:uppercase;">Login email</div>
              <div style="font-weight:700;font-size:15px;margin-top:2px;">{to_email}</div>
              <div style="color:#5b6573;letter-spacing:0.1em;font-size:10px;text-transform:uppercase;margin-top:10px;">Temporary password</div>
              <div style="font-family:'Courier New',monospace;font-weight:700;font-size:16px;margin-top:2px;letter-spacing:0.03em;">{password}</div>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:0 24px 16px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="background:#0a3bc5;padding:0;">
                <a href="{check_in_url}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;">📱 Mark Attendance (Mobile)</a>
              </td>
              <td width="12"></td>
              <td style="background:#ffffff;border:1px solid #0a3bc5;padding:0;">
                <a href="{portal_url}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:700;color:#0a3bc5;text-decoration:none;">Open Portal</a>
              </td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding:0 24px 24px;font-size:13px;line-height:1.55;">
          <p style="margin:0 0 8px;color:#b51d2a;"><strong>Important:</strong> Please change your password after first login — go to Profile → Change Password.</p>
          <p style="margin:0 0 8px;">Quick check-in steps on your phone:</p>
          <ol style="margin:0 0 8px 18px;padding:0;">
            <li>Open <a href="{check_in_url}" style="color:#0a3bc5;">{check_in_url}</a></li>
            <li>Sign in with the email + temporary password above</li>
            <li>Allow Location and Camera permission</li>
            <li>Tap <em>Get Location → Take Selfie → Check In</em></li>
          </ol>
          <p style="margin:12px 0 0;color:#5b6573;font-size:12px;">If you didn&rsquo;t expect this email, please ignore it.</p>
        </td></tr>
        <tr><td style="background:#0a3bc5;color:#ffffff;padding:14px 24px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;text-align:center;">
          Mashara Skills and Creative Learning Pvt Ltd
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
"""
    params = {
        "from": sender,
        "to": [to_email],
        "subject": "Your Mashara Finance login credentials",
        "html": html,
    }
    try:
        res = await asyncio.to_thread(resend.Emails.send, params)
        return {"sent": True, "id": res.get("id") if isinstance(res, dict) else None}
    except Exception as e:  # noqa: BLE001 — non-fatal
        logger.error("Resend send failed for %s: %s", to_email, e)
        return {"sent": False, "reason": str(e)}


async def send_otp_email(to_email: str, otp: str, validity_minutes: int = 15) -> dict:
    """Send a password-reset OTP. Never raises."""
    if not _client_ready():
        logger.warning("Resend not configured — OTP email skipped for %s", to_email)
        return {"sent": False, "reason": "resend_not_configured"}

    sender = os.environ.get("SENDER_EMAIL", "onboarding@resend.dev").strip() or "onboarding@resend.dev"
    html = f"""\
<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f3f5fb;font-family:Arial,Helvetica,sans-serif;color:#111;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f3f5fb;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="background:#ffffff;border:1px solid #e2e6ec;">
        <tr><td style="background:#0a3bc5;color:#ffffff;padding:22px 24px;">
          <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;opacity:0.85;">Mashara Skills and Creative Learning Pvt Ltd</div>
          <div style="font-size:20px;font-weight:900;margin-top:4px;">Password Reset OTP</div>
        </td></tr>
        <tr><td style="padding:24px;font-size:14px;line-height:1.55;">
          <p style="margin:0 0 14px;">Namaste,</p>
          <p style="margin:0 0 14px;">We received a request to reset the password for <strong>{to_email}</strong>. Use the OTP below to continue:</p>
          <div style="background:#f7f8fb;border:1px solid #e2e6ec;padding:18px;text-align:center;margin:8px 0 18px;">
            <div style="font-family:'Courier New',monospace;font-weight:900;font-size:34px;letter-spacing:0.4em;color:#0a3bc5;">{otp}</div>
          </div>
          <p style="margin:0 0 8px;color:#5b6573;">This OTP is valid for <strong>{validity_minutes} minutes</strong> and can be used only once.</p>
          <p style="margin:10px 0 0;color:#b51d2a;font-size:12px;">If you did not request this reset, you can safely ignore this email — your password will remain unchanged.</p>
        </td></tr>
        <tr><td style="background:#0a3bc5;color:#ffffff;padding:12px 24px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;text-align:center;">
          Mashara Finance — Secure Password Reset
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>
"""
    params = {
        "from": sender,
        "to": [to_email],
        "subject": "Your Mashara Finance password reset OTP",
        "html": html,
    }
    try:
        res = await asyncio.to_thread(resend.Emails.send, params)
        return {"sent": True, "id": res.get("id") if isinstance(res, dict) else None}
    except Exception as e:  # noqa: BLE001
        logger.error("Resend OTP send failed for %s: %s", to_email, e)
        return {"sent": False, "reason": str(e)}



async def send_email_with_attachment(
    to: str,
    subject: str,
    html: str,
    attachment_bytes: bytes,
    attachment_filename: str,
    content_type: str = "application/pdf",
    cc: Optional[list] = None,
) -> dict:
    """Generic attachment-carrying email via Resend. Never raises — returns dict."""
    import base64
    if not _client_ready():
        return {"sent": False, "reason": "resend_not_configured"}
    sender = os.environ.get("SENDER_EMAIL", "onboarding@resend.dev").strip() or "onboarding@resend.dev"
    params = {
        "from": sender,
        "to": [to],
        "subject": subject,
        "html": html,
        "attachments": [{
            "filename": attachment_filename,
            "content": base64.b64encode(attachment_bytes).decode("ascii"),
            "content_type": content_type,
        }],
    }
    if cc:
        params["cc"] = cc
    try:
        res = await asyncio.to_thread(resend.Emails.send, params)
        return {"sent": True, "id": res.get("id") if isinstance(res, dict) else None}
    except Exception as e:  # noqa: BLE001
        logger.error("Attachment email failed for %s: %s", to, e)
        return {"sent": False, "reason": str(e)[:250]}



async def send_bg_expiry_alert(
    to_emails: list,
    bgs: list,
    days_left_by_bg: dict,
    portal_url: str,
) -> dict:
    """Send a red-bold-styled expiry alert to `to_emails` for the given BGs."""
    if not _client_ready():
        return {"sent": False, "reason": "resend_not_configured"}
    if not to_emails or not bgs:
        return {"sent": False, "reason": "no_recipients_or_bgs"}
    sender = os.environ.get("SENDER_EMAIL", "onboarding@resend.dev").strip() or "onboarding@resend.dev"
    rows_html = ""
    any_expired = False
    for bg in bgs:
        d = days_left_by_bg.get(bg["id"])
        label = f"{d} day(s) left" if d is not None and d >= 0 else "EXPIRED"
        if d is not None and d < 0: any_expired = True
        rows_html += f"""
<tr>
  <td style="padding:8px;border:1px solid #f5c2c7;font-family:monospace;font-weight:700;color:#842029;">{bg.get('bg_number','')}</td>
  <td style="padding:8px;border:1px solid #f5c2c7;color:#842029;">{bg.get('issued_by','—')}</td>
  <td style="padding:8px;border:1px solid #f5c2c7;color:#842029;">{bg.get('in_favour_of') or '—'}</td>
  <td style="padding:8px;border:1px solid #f5c2c7;color:#842029;font-weight:700;">{bg.get('bg_claim_expiry_date','')}</td>
  <td style="padding:8px;border:1px solid #f5c2c7;color:#a11313;font-weight:900;text-transform:uppercase;">{label}</td>
</tr>"""
    header = "⚠️ BANK GUARANTEE EXPIRED" if any_expired else "⏳ BANK GUARANTEE EXPIRY REMINDER"
    html = f"""\
<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#fff5f5;font-family:Arial,Helvetica,sans-serif;color:#111;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="640" cellspacing="0" cellpadding="0" border="0" style="background:#ffffff;border:2px solid #c81e1e;">
        <tr><td style="background:#c81e1e;color:#ffffff;padding:16px 24px;font-weight:900;font-size:18px;letter-spacing:0.03em;">{header}</td></tr>
        <tr><td style="padding:20px 24px 8px;font-size:14px;line-height:1.55;color:#842029;">
          <p style="margin:0 0 8px;font-weight:700;">Action required: renew the Bank Guarantee(s) below before expiry.</p>
          <p style="margin:0 0 4px;">This automated alert will keep sending on <b>Day-30, Day-15, Day-7 and Day-0</b> until each BG is marked as renewed.</p>
        </td></tr>
        <tr><td style="padding:12px 24px 8px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;font-size:13px;">
            <thead><tr style="background:#f8d7da;color:#842029;">
              <th style="padding:8px;border:1px solid #f5c2c7;text-align:left;">BG Number</th>
              <th style="padding:8px;border:1px solid #f5c2c7;text-align:left;">Issued By</th>
              <th style="padding:8px;border:1px solid #f5c2c7;text-align:left;">In Favour Of</th>
              <th style="padding:8px;border:1px solid #f5c2c7;text-align:left;">Claim Expiry</th>
              <th style="padding:8px;border:1px solid #f5c2c7;text-align:left;">Status</th>
            </tr></thead>
            <tbody>{rows_html}</tbody>
          </table>
        </td></tr>
        <tr><td style="padding:16px 24px 24px;">
          <a href="{portal_url}/bank-guarantees" style="display:inline-block;background:#c81e1e;color:#fff;padding:10px 18px;font-weight:700;text-decoration:none;">Open Bank Guarantee Tracking →</a>
        </td></tr>
      </table>
      <div style="margin:10px 0;color:#8b6f6f;font-size:11px;">Mashara Finance · Automated BG Alert</div>
    </td></tr></table></body></html>"""
    params = {
        "from": sender,
        "to": list(dict.fromkeys(to_emails)),
        "subject": f"[{header.replace('⚠️ ','').replace('⏳ ','')}] {len(bgs)} Bank Guarantee(s) need attention",
        "html": html,
    }
    try:
        res = await asyncio.to_thread(resend.Emails.send, params)
        return {"sent": True, "id": res.get("id") if isinstance(res, dict) else None}
    except Exception as e:  # noqa: BLE001
        logger.error("BG expiry email failed: %s", e)
        return {"sent": False, "reason": str(e)[:250]}



async def send_mis_weekly_digest(to_emails: list, digest: dict, portal_url: str) -> dict:
    """Send a formatted MIS weekly digest with alerts + rollups. Silently returns
    on missing Resend config so the scheduler stays healthy on dev environments."""
    if not _client_ready():
        return {"sent": False, "reason": "resend_not_configured"}
    if not to_emails:
        return {"sent": False, "reason": "no_recipients"}
    sender = os.environ.get("SENDER_EMAIL", "onboarding@resend.dev").strip() or "onboarding@resend.dev"

    alerts = digest.get("alerts", [])
    mob = digest.get("mobilization_week", {})
    bg_top = digest.get("bg_top_upcoming", [])
    week_range = digest.get("week_range", "")

    alerts_rows = "".join(
        f'<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;">{a["label"]}</td>'
        f'<td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;">'
        f'<b style="color:{"#b91c1c" if a["severity"]=="red" else "#b45309" if a["severity"]=="amber" else "#1d4ed8"};">'
        f'{a["count"]}</b></td></tr>'
        for a in alerts if a.get("count", 0) > 0
    ) or '<tr><td colspan="2" style="padding:10px;text-align:center;color:#166534;">All clear — no open exceptions.</td></tr>'

    bg_rows = "".join(
        f'<tr><td style="padding:5px 10px;border-bottom:1px solid #eee;">{b.get("bg_number","")}</td>'
        f'<td style="padding:5px 10px;border-bottom:1px solid #eee;">{b.get("issued_by","")}</td>'
        f'<td style="padding:5px 10px;border-bottom:1px solid #eee;color:#b91c1c;"><b>{b.get("bg_claim_expiry_date","")}</b></td></tr>'
        for b in bg_top
    ) or '<tr><td colspan="3" style="padding:10px;text-align:center;color:#666;">No BG expiries in the next 30 days.</td></tr>'

    html = f"""<html><body style="font-family:Arial,Helvetica,sans-serif;background:#f8fafc;padding:20px;">
      <table width="720" style="margin:auto;background:#fff;border:1px solid #e5e7eb;border-collapse:collapse;">
        <tr><td style="background:#1E4EAB;color:#fff;padding:18px 22px;">
          <div style="font-size:11px;letter-spacing:2px;">MIS · JHARKHAND SKILLS</div>
          <div style="font-size:22px;font-weight:800;margin-top:4px;">Weekly Digest</div>
          <div style="font-size:12px;opacity:0.85;margin-top:2px;">{week_range}</div>
        </td></tr>
        <tr><td style="padding:22px;">
          <h3 style="margin:0 0 10px 0;color:#111;">Open Exceptions</h3>
          <table width="100%" style="border-collapse:collapse;border:1px solid #eee;font-size:13px;">
            <thead><tr style="background:#f3f4f6;">
              <th style="padding:8px 10px;text-align:left;">Category</th>
              <th style="padding:8px 10px;text-align:right;">Open</th>
            </tr></thead>
            <tbody>{alerts_rows}</tbody>
          </table>

          <h3 style="margin:22px 0 10px 0;color:#111;">This Week&rsquo;s Mobilisation</h3>
          <table width="100%" style="border-collapse:collapse;font-size:13px;">
            <tr>
              <td style="padding:8px 10px;background:#ecfdf5;">Total Mobilisation: <b>{mob.get("mob", 0):,}</b></td>
              <td style="padding:8px 10px;background:#ecfdf5;">Total Distance: <b>{mob.get("km", 0)} km</b></td>
              <td style="padding:8px 10px;background:#ecfdf5;">Reports: <b>{mob.get("reports", 0)}</b></td>
            </tr>
          </table>

          <h3 style="margin:22px 0 10px 0;color:#111;">Upcoming BG Expiries (30 days)</h3>
          <table width="100%" style="border-collapse:collapse;border:1px solid #eee;font-size:12px;">
            <thead><tr style="background:#f3f4f6;">
              <th style="padding:8px 10px;text-align:left;">BG Number</th>
              <th style="padding:8px 10px;text-align:left;">Issued By</th>
              <th style="padding:8px 10px;text-align:left;">Expiry</th>
            </tr></thead>
            <tbody>{bg_rows}</tbody>
          </table>

          <div style="margin-top:24px;text-align:center;">
            <a href="{portal_url}/mis" style="display:inline-block;background:#1E4EAB;color:#fff;padding:10px 20px;text-decoration:none;font-weight:600;font-size:13px;">Open MIS Dashboard →</a>
          </div>

          <div style="margin-top:22px;color:#94a3b8;font-size:11px;text-align:center;">Mashara Finance · Automated Weekly Digest · Every Monday 08:00 IST</div>
        </td></tr>
      </table>
    </body></html>"""

    params = {"from": sender, "to": list(dict.fromkeys(to_emails)),
              "subject": f"MIS Weekly Digest · {week_range}", "html": html}
    try:
        res = await asyncio.to_thread(resend.Emails.send, params)
        return {"sent": True, "id": res.get("id") if isinstance(res, dict) else None}
    except Exception as e:  # noqa: BLE001
        logger.error("MIS weekly digest email failed: %s", e)
        return {"sent": False, "reason": str(e)[:250]}
