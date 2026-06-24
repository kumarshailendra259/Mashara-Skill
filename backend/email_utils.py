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
