"""Mess Purchase Bill generation — GST invoice, multi-item, multi-page.

A payment's FINAL approval triggers `_generate_mess_bill` (server.py). It resolves
the active company / global DOCX template (if any) and renders it via docxtpl →
LibreOffice→PDF. If no template exists, a professional ReportLab default invoice
is produced. Both paths share one context (`build_mess_bill_context`) and one GST
engine (`compute_mess_tax`), so the figures are always identical.

Multi-page behaviour (repeating header row, row-not-split, "Page X of Y") is
baked into the DOCX sample via native Word settings (`build_sample_template_docx`);
ReportLab achieves the same with `repeatRows`, flowable row-integrity and a
NumberedCanvas.
"""
from __future__ import annotations

import logging
import os
import subprocess
import tempfile
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from io import BytesIO
from typing import Any, Dict, List, Optional, Tuple

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
)

from salary_slip import _amount_to_words  # type: ignore

logger = logging.getLogger(__name__)

_BRAND = colors.HexColor("#155EEF")
_BRAND_LIGHT = colors.HexColor("#EEF4FF")
_MUTED = colors.HexColor("#6B7280")
_BORDER = colors.HexColor("#D5DCE6")
_ACCENT = colors.HexColor("#0F172A")
_GREEN = colors.HexColor("#047857")

_MONTHS_SHORT = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                 "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

KNOWN_TOP_VARS = {
    "bill_no", "invoice_no", "invoice_date", "payment_date", "payment_mode",
    "paid_by_name", "today", "total_amount", "total_words",
    "company_name", "company_address", "company_gst", "company_pan", "company_state",
    "center_name", "supplier_name", "supplier_address", "supplier_gst",
    "supplier_state", "supplier_phone", "supplier_email", "supplier_pan",
    "hsn_sac", "taxable_amount", "cgst_rate", "cgst_amount", "sgst_rate",
    "sgst_amount", "igst_rate", "igst_amount", "total_tax", "round_off",
    "tax_amount_words", "tax_type", "total_qty",
    "bank_name", "bank_account", "bank_ifsc", "bank_branch",
    "lines", "approvals",
}


def _D(v: Any) -> Decimal:
    try:
        return Decimal(str(v or 0))
    except Exception:  # noqa: BLE001
        return Decimal("0")


def _money(d: Decimal) -> float:
    return float(Decimal(d).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _state_code(gstin: Optional[str]) -> Optional[str]:
    g = (gstin or "").strip()
    return g[:2] if len(g) >= 2 and g[:2].isdigit() else None


def _fmt_inr(amount: Any) -> str:
    try:
        n = float(amount)
    except (TypeError, ValueError):
        return "0.00"
    s = f"{abs(n):,.2f}"
    int_part, dec = s.split(".")
    int_part = int_part.replace(",", "")
    if len(int_part) > 3:
        last3 = int_part[-3:]
        rest = int_part[:-3]
        groups = []
        while len(rest) > 2:
            groups.insert(0, rest[-2:])
            rest = rest[:-2]
        if rest:
            groups.insert(0, rest)
        grouped = ",".join(groups) + "," + last3
    else:
        grouped = int_part
    return ("-" if n < 0 else "") + grouped + "." + dec


def _fmt_date(iso: Optional[str]) -> str:
    if not iso:
        return "—"
    try:
        d = iso[:10]
        y, m, day = d.split("-")
        return f"{int(day):02d}-{_MONTHS_SHORT[int(m)]}-{y}"
    except Exception:  # noqa: BLE001
        return iso[:10] if iso else "—"


def _core_words(n) -> str:
    w = _amount_to_words(int(n)).strip()
    if w.lower().endswith("only"):
        w = w[:-4].strip()
    parts = w.split(" ", 1)
    if parts and parts[0].lower() in ("rupees", "rupee", "inr"):
        w = parts[1] if len(parts) > 1 else ""
    return w.strip() or "Zero"


def _rupee_words(amount: float) -> str:
    return f"INR {_core_words(int(amount))} Only"


def _paise_words(amount: float) -> str:
    rupees = int(amount)
    paise = int(round((amount - rupees) * 100))
    if paise:
        return f"INR {_core_words(rupees)} and {_core_words(paise)} Paise Only"
    return f"INR {_core_words(rupees)} Only"


_STATE_BY_CODE = {
    "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
    "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
    "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur",
    "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
    "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
    "24": "Gujarat", "27": "Maharashtra", "29": "Karnataka", "30": "Goa", "32": "Kerala",
    "33": "Tamil Nadu", "36": "Telangana", "37": "Andhra Pradesh",
}


def _state_label(gstin: Optional[str]) -> str:
    sc = _state_code(gstin)
    if not sc:
        return ""
    name = _STATE_BY_CODE.get(sc)
    return f"{name} ({sc})" if name else sc


def compute_mess_tax(receipt: dict, company_gstin: Optional[str] = None,
                     supplier_gstin: Optional[str] = None) -> dict:
    """Derive the full GST breakdown from a receipt's accepted line values."""
    lines = receipt.get("lines") or []
    sc_company = _state_code(company_gstin)
    sc_supplier = _state_code(supplier_gstin)
    inter_state = bool(sc_company and sc_supplier and sc_company != sc_supplier)
    taxable = Decimal("0")
    cgst_total = Decimal("0")
    sgst_total = Decimal("0")
    igst_total = Decimal("0")
    total_qty = Decimal("0")
    out_lines: List[dict] = []
    for idx, ln in enumerate(lines, start=1):
        qty = _D(ln.get("qty"))
        acc = _D(ln.get("accepted_qty") if ln.get("accepted_qty") is not None else ln.get("qty"))
        rate = _D(ln.get("unit_price"))
        disc = _D(ln.get("discount"))
        acc_frac = (acc / qty) if qty > 0 else (Decimal("1") if acc else Decimal("0"))
        line_taxable = ((qty * rate - disc) * acc_frac).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        gst_rate = ln.get("gst_rate")
        if gst_rate not in (None, "", 0, 0.0):
            l_rate = _D(gst_rate)
            if inter_state:
                l_igst = (line_taxable * l_rate / Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                l_cgst = l_sgst = Decimal("0")
            else:
                half = (line_taxable * (l_rate / 2) / Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                l_cgst = l_sgst = half
                l_igst = Decimal("0")
        else:
            full_tax = _D(ln.get("tax")) * acc_frac
            l_rate = (full_tax / line_taxable * Decimal("100")) if line_taxable > 0 else Decimal("0")
            if inter_state:
                l_igst = full_tax.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                l_cgst = l_sgst = Decimal("0")
            else:
                l_cgst = (full_tax / 2).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                l_sgst = (full_tax - l_cgst).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                l_igst = Decimal("0")
        line_tax = (l_cgst + l_sgst + l_igst)
        taxable += line_taxable
        cgst_total += l_cgst
        sgst_total += l_sgst
        igst_total += l_igst
        total_qty += acc
        out_lines.append({
            "s_no": idx,
            "item_name": ln.get("item_name") or ln.get("item_id") or "",
            "hsn_sac": ln.get("hsn_sac") or "",
            "qty": _money(acc),
            "unit": ln.get("unit") or "",
            "unit_price": _money(rate),
            "accepted_qty": _money(acc),
            "tax_rate": _money(l_rate),
            "tax_amount": _money(line_tax),
            "taxable": _money(line_taxable),
            "amount": _money(line_taxable + line_tax),
        })

    total_tax = cgst_total + sgst_total + igst_total
    eff_rate = (total_tax / taxable * Decimal("100")) if taxable > 0 else Decimal("0")
    if inter_state:
        igst_amount, igst_rate = igst_total, eff_rate
        cgst_amount = sgst_amount = Decimal("0")
        cgst_rate = sgst_rate = Decimal("0")
        tax_type = "IGST"
    else:
        cgst_amount, sgst_amount = cgst_total, sgst_total
        cgst_rate = sgst_rate = (eff_rate / 2)
        igst_amount = Decimal("0")
        igst_rate = Decimal("0")
        tax_type = "CGST+SGST"

    subtotal = taxable + total_tax
    grand_total = subtotal.quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    round_off = grand_total - subtotal

    return {
        "lines": out_lines,
        "total_qty": _money(total_qty),
        "taxable_amount": _money(taxable),
        "cgst_rate": _money(cgst_rate), "cgst_amount": _money(cgst_amount),
        "sgst_rate": _money(sgst_rate), "sgst_amount": _money(sgst_amount),
        "igst_rate": _money(igst_rate), "igst_amount": _money(igst_amount),
        "total_tax": _money(total_tax), "round_off": _money(round_off),
        "grand_total": _money(grand_total), "tax_type": tax_type, "inter_state": inter_state,
        "hsn_sac": ", ".join(sorted({l["hsn_sac"] for l in out_lines if l["hsn_sac"]})) or "",
        "total_words": _rupee_words(float(grand_total)),
        "tax_amount_words": _paise_words(float(total_tax)),
    }


def build_mess_bill_context(receipt: dict, payment: Optional[dict], company: dict,
                            center: Optional[dict], bill_no: str,
                            supplier: Optional[dict] = None,
                            tax: Optional[dict] = None) -> dict:
    payment = payment or {}
    supplier = supplier or {}
    company = company or {}
    if tax is None:
        tax = compute_mess_tax(receipt, company.get("gst") or company.get("gstin"),
                               supplier.get("gst_number") or receipt.get("supplier_gst"))
    approvals = []
    for h in (payment.get("chain_history") or []):
        approvals.append({
            "level": h.get("level"), "by_user_name": h.get("by_user_name") or "",
            "action": (h.get("action") or "approve"), "at": (h.get("at") or "")[:10],
            "remarks": h.get("remarks") or "",
        })
    sup_gst = supplier.get("gst_number") or receipt.get("supplier_gst") or ""
    comp_gst = company.get("gst") or company.get("gstin") or ""
    return {
        "bill_no": bill_no,
        "invoice_no": receipt.get("invoice_no") or "",
        "invoice_date": _fmt_date(receipt.get("invoice_date")),
        "payment_date": _fmt_date(payment.get("payment_date") or payment.get("paid_at")),
        "payment_mode": (payment.get("payment_mode") or "").upper(),
        "paid_by_name": payment.get("paid_by_name") or "",
        "today": datetime.now(timezone.utc).strftime("%d-%b-%Y"),
        "company_name": company.get("name") or "",
        "company_address": company.get("address") or "",
        "company_gst": comp_gst, "company_pan": company.get("pan") or "",
        "company_state": _state_label(comp_gst),
        "center_name": (center or {}).get("name") or receipt.get("center_name") or "",
        "supplier_name": supplier.get("name") or receipt.get("supplier_name") or "",
        "supplier_address": supplier.get("address") or "",
        "supplier_gst": sup_gst, "supplier_state": _state_label(sup_gst),
        "supplier_phone": supplier.get("mobile") or "",
        "supplier_email": supplier.get("email") or "",
        "supplier_pan": supplier.get("pan_number") or "",
        "bank_name": supplier.get("bank_name") or "",
        "bank_account": supplier.get("bank_account_no") or "",
        "bank_ifsc": supplier.get("ifsc") or "",
        "bank_branch": supplier.get("bank_branch") or "",
        "hsn_sac": tax["hsn_sac"],
        "taxable_amount": tax["taxable_amount"],
        "cgst_rate": tax["cgst_rate"], "cgst_amount": tax["cgst_amount"],
        "sgst_rate": tax["sgst_rate"], "sgst_amount": tax["sgst_amount"],
        "igst_rate": tax["igst_rate"], "igst_amount": tax["igst_amount"],
        "total_tax": tax["total_tax"], "round_off": tax["round_off"],
        "tax_type": tax["tax_type"], "total_qty": tax["total_qty"],
        "tax_amount_words": tax["tax_amount_words"],
        "total_amount": tax["grand_total"], "total_words": tax["total_words"],
        "lines": tax["lines"], "approvals": approvals,
    }


class _NumberedCanvas(canvas.Canvas):
    """Repeating header band + 'Page X of Y' footer on every page."""

    def __init__(self, *args, **kwargs):
        self._hdr = kwargs.pop("header", {}) or {}
        super().__init__(*args, **kwargs)
        self._saved = []

    def showPage(self):  # noqa: N802
        self._saved.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._saved)
        for i, state in enumerate(self._saved, start=1):
            self.__dict__.update(state)
            self._draw(i, total)
            super().showPage()
        super().save()

    def _draw(self, page_no: int, total_pages: int):
        w, h = A4
        self.saveState()
        self.setStrokeColor(_BRAND)
        self.setLineWidth(0.5)
        self.setFont("Helvetica-Bold", 8)
        self.setFillColor(_BRAND)
        self.drawString(18 * mm, h - 10 * mm, (self._hdr.get("company") or "")[:60])
        self.setFont("Helvetica", 7)
        self.setFillColor(_MUTED)
        ident = f"Bill {self._hdr.get('bill_no', '')}  ·  Inv {self._hdr.get('invoice_no', '')}  ·  {self._hdr.get('supplier', '')}"
        self.drawRightString(w - 18 * mm, h - 10 * mm, ident[:80])
        self.line(18 * mm, h - 11.5 * mm, w - 18 * mm, h - 11.5 * mm)
        self.setFont("Helvetica", 7)
        self.setFillColor(_MUTED)
        self.drawCentredString(w / 2, 10 * mm, f"Page {page_no} of {total_pages}")
        self.drawString(18 * mm, 10 * mm, "System-generated purchase bill")
        self.drawRightString(w - 18 * mm, 10 * mm, self._hdr.get("generated", ""))
        self.restoreState()


def _styles() -> Dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("t", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=15, alignment=TA_CENTER, textColor=_BRAND, spaceAfter=2),
        "sub": ParagraphStyle("s", parent=base["Normal"], fontName="Helvetica", fontSize=8, alignment=TA_CENTER, textColor=_MUTED, spaceAfter=6),
        "small": ParagraphStyle("sm", parent=base["Normal"], fontName="Helvetica", fontSize=7.5, textColor=_MUTED, leading=10),
        "val": ParagraphStyle("v", parent=base["Normal"], fontName="Helvetica", fontSize=8, textColor=_ACCENT, leading=11),
        "valb": ParagraphStyle("vb", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=8, textColor=_ACCENT, leading=11),
        "sec": ParagraphStyle("se", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=8, textColor=_BRAND, spaceBefore=4, spaceAfter=2),
        "cell": ParagraphStyle("c", parent=base["Normal"], fontName="Helvetica", fontSize=7.5, textColor=_ACCENT, leading=9.5),
        "cellb": ParagraphStyle("cb", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=7.5, textColor=_ACCENT, leading=9.5),
        "words": ParagraphStyle("w", parent=base["Normal"], fontName="Helvetica-Oblique", fontSize=8, textColor=_ACCENT, leading=11),
        "amt": ParagraphStyle("a", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=13, alignment=TA_RIGHT, textColor=_GREEN),
    }


def build_mess_bill_pdf(receipt: dict, payment: Optional[dict], company: Optional[dict],
                        center: Optional[dict], bill_no: str,
                        approval_chain: Optional[list] = None,
                        supplier: Optional[dict] = None, tax: Optional[dict] = None) -> bytes:
    payment = payment or {}
    company = company or {}
    supplier = supplier or {}
    if tax is None:
        tax = compute_mess_tax(receipt, company.get("gst") or company.get("gstin"),
                               supplier.get("gst_number") or receipt.get("supplier_gst"))
    st = _styles()
    buf = BytesIO()
    hdr = {
        "company": company.get("name") or "Mashara Enterprises",
        "bill_no": bill_no, "invoice_no": receipt.get("invoice_no") or "",
        "supplier": supplier.get("name") or receipt.get("supplier_name") or "",
        "generated": datetime.now(timezone.utc).strftime("%d-%b-%Y"),
    }
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm,
                            topMargin=16 * mm, bottomMargin=16 * mm, title=f"Mess Purchase Bill {bill_no}")
    story: list = [Spacer(1, 2 * mm), Paragraph("MESS PURCHASE BILL / TAX INVOICE", st["title"]),
                   Paragraph("System-generated on final payment approval", st["sub"])]

    def _party(title, name, addr, gst, extra):
        rows = [[Paragraph(title, st["sec"])], [Paragraph(f"<b>{name or '—'}</b>", st["valb"])]]
        if addr:
            rows.append([Paragraph(addr, st["small"])])
        meta = [f"GSTIN: {gst}"] if gst else []
        meta += [e for e in extra if e]
        if meta:
            rows.append([Paragraph("<br/>".join(meta), st["small"])])
        t = Table(rows, colWidths=[85 * mm])
        t.setStyle(TableStyle([("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 1), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
        return t

    seller = _party("SUPPLIER (FROM)", supplier.get("name") or receipt.get("supplier_name"), supplier.get("address"),
                    supplier.get("gst_number"),
                    [f"PAN: {supplier.get('pan_number')}" if supplier.get("pan_number") else "",
                     f"State: {_state_label(supplier.get('gst_number'))}" if _state_label(supplier.get('gst_number')) else "",
                     f"Phone: {supplier.get('mobile')}" if supplier.get("mobile") else "",
                     f"Email: {supplier.get('email')}" if supplier.get("email") else ""])
    buyer = _party("BUYER (BILL TO)", company.get("name"), company.get("address"),
                   company.get("gst") or company.get("gstin"),
                   [f"PAN: {company.get('pan')}" if company.get("pan") else "",
                    f"State: {_state_label(company.get('gst') or company.get('gstin'))}" if _state_label(company.get('gst') or company.get('gstin')) else "",
                    f"Center: {(center or {}).get('name')}" if (center or {}).get("name") else ""])
    pt = Table([[seller, buyer]], colWidths=[87 * mm, 87 * mm])
    pt.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    story.append(pt)
    story.append(Spacer(1, 3 * mm))

    meta = [[Paragraph("Bill No.", st["small"]), Paragraph(f"<b>{bill_no}</b>", st["valb"]),
             Paragraph("Invoice No.", st["small"]), Paragraph(f"<b>{receipt.get('invoice_no') or '—'}</b>", st["valb"]),
             Paragraph("Invoice Date", st["small"]), Paragraph(_fmt_date(receipt.get("invoice_date")), st["valb"])],
            [Paragraph("Payment Date", st["small"]), Paragraph(_fmt_date(payment.get("payment_date") or payment.get("paid_at")), st["valb"]),
             Paragraph("Payment Mode", st["small"]), Paragraph((payment.get("payment_mode") or "—").upper(), st["valb"]),
             Paragraph("Supply Type", st["small"]), Paragraph(tax["tax_type"], st["valb"])]]
    mt = Table(meta, colWidths=[22 * mm, 36 * mm, 22 * mm, 36 * mm, 22 * mm, 36 * mm])
    mt.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.4, _BORDER), ("INNERGRID", (0, 0), (-1, -1), 0.3, _BORDER),
                            ("BACKGROUND", (0, 0), (-1, -1), _BRAND_LIGHT),
                            ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    story.append(mt)
    story.append(Spacer(1, 3 * mm))

    head = ["S.No", "Item Description", "HSN/SAC", "Qty", "Unit", "Rate", "Taxable", "GST%", "Tax Amt", "Amount"]
    hstyle = ParagraphStyle("hh", fontName="Helvetica-Bold", fontSize=7, textColor=colors.white, alignment=TA_CENTER)
    hstyle_l = ParagraphStyle("hl", fontName="Helvetica-Bold", fontSize=7, textColor=colors.white, alignment=TA_LEFT)
    rows = [[Paragraph(h, hstyle_l if h == "Item Description" else hstyle) for h in head]]
    for ln in tax["lines"]:
        rows.append([
            Paragraph(str(ln["s_no"]), st["cell"]), Paragraph(str(ln["item_name"]), st["cell"]),
            Paragraph(str(ln["hsn_sac"] or "—"), st["cell"]), Paragraph(_fmt_inr(ln["accepted_qty"]), st["cell"]),
            Paragraph(str(ln["unit"]), st["cell"]), Paragraph(_fmt_inr(ln["unit_price"]), st["cell"]),
            Paragraph(_fmt_inr(ln["taxable"]), st["cell"]), Paragraph(_fmt_inr(ln["tax_rate"]), st["cell"]),
            Paragraph(_fmt_inr(ln["tax_amount"]), st["cell"]), Paragraph(_fmt_inr(ln["amount"]), st["cellb"]),
        ])
    col_w = [10 * mm, 44 * mm, 18 * mm, 13 * mm, 12 * mm, 17 * mm, 19 * mm, 11 * mm, 17 * mm, 19 * mm]
    items = Table(rows, colWidths=col_w, repeatRows=1)
    items.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), _BRAND), ("GRID", (0, 0), (-1, -1), 0.3, _BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("ALIGN", (0, 1), (0, -1), "CENTER"),
        ("ALIGN", (3, 1), (-1, -1), "RIGHT"), ("ALIGN", (4, 1), (4, -1), "CENTER"), ("ALIGN", (2, 1), (2, -1), "CENTER"),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F7F9FC")]),
    ]))
    story.append(items)

    def trow(label, val):
        return [Paragraph(label, st["val"]), Paragraph(f"₹ {_fmt_inr(val)}", st["val"])]

    tot_rows = [trow("Total Taxable Value", tax["taxable_amount"])]
    if tax["tax_type"] == "IGST":
        tot_rows.append(trow(f"IGST @ {_fmt_inr(tax['igst_rate'])}%", tax["igst_amount"]))
    else:
        tot_rows.append(trow(f"CGST @ {_fmt_inr(tax['cgst_rate'])}%", tax["cgst_amount"]))
        tot_rows.append(trow(f"SGST @ {_fmt_inr(tax['sgst_rate'])}%", tax["sgst_amount"]))
    tot_rows.append([Paragraph("Total Tax", st["valb"]), Paragraph(f"₹ {_fmt_inr(tax['total_tax'])}", st["valb"])])
    if abs(tax["round_off"]) >= 0.005:
        tot_rows.append(trow("Round Off", tax["round_off"]))
    tot_rows.append([Paragraph("GRAND TOTAL", st["valb"]), Paragraph(f"₹ {_fmt_inr(tax['grand_total'])}", st["amt"])])
    totals = Table(tot_rows, colWidths=[55 * mm, 40 * mm])
    totals.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.4, _BORDER), ("INNERGRID", (0, 0), (-1, -1), 0.3, _BORDER),
                                ("BACKGROUND", (0, -1), (-1, -1), _BRAND_LIGHT), ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                                ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))
    words_block = Table([[Paragraph("Total Qty", st["small"])], [Paragraph(f"<b>{_fmt_inr(tax['total_qty'])}</b>", st["valb"])],
                         [Paragraph("Amount in Words", st["small"])], [Paragraph(tax["total_words"], st["words"])],
                         [Paragraph("Tax in Words", st["small"])], [Paragraph(tax["tax_amount_words"], st["words"])]],
                        colWidths=[79 * mm])
    words_block.setStyle(TableStyle([("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 1), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    summary = Table([[words_block, totals]], colWidths=[79 * mm, 95 * mm])
    summary.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    story.append(Spacer(1, 3 * mm))
    story.append(KeepTogether(summary))

    extras = []
    if supplier.get("bank_account_no"):
        extras.append(Paragraph("SUPPLIER BANK (PAYEE)", st["sec"]))
        extras.append(Paragraph(f"{supplier.get('bank_name') or ''}  ·  A/C {supplier.get('bank_account_no')}  ·  IFSC {supplier.get('ifsc') or ''}", st["val"]))
    if approval_chain:
        extras.append(Spacer(1, 2 * mm))
        extras.append(Paragraph("APPROVAL TRAIL", st["sec"]))
        arows = [[Paragraph(h, st["cellb"]) for h in ["Level", "Approver", "Action", "Date"]]]
        for h in approval_chain:
            arows.append([Paragraph(str(h.get("level") or "—"), st["cell"]), Paragraph(str(h.get("by_user_name") or "—"), st["cell"]),
                          Paragraph((h.get("action") or "approve").replace("_", " ").title(), st["cell"]), Paragraph(_fmt_date(h.get("at")), st["cell"])])
        at = Table(arows, colWidths=[16 * mm, 80 * mm, 40 * mm, 38 * mm])
        at.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.3, _BORDER), ("BACKGROUND", (0, 0), (-1, 0), _BRAND_LIGHT),
                                ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
        extras.append(at)
    if payment.get("paid_by_name"):
        extras.append(Spacer(1, 2 * mm))
        extras.append(Paragraph(f"<font color='#6B7280'>Paid By:</font> <b>{payment['paid_by_name']}</b>", st["val"]))
    if extras:
        story.append(Spacer(1, 3 * mm))
        story.append(KeepTogether(extras))

    sig = Table([["____________________", "____________________", "____________________"],
                 [Paragraph("Prepared By", st["cellb"]), Paragraph("Approved By", st["cellb"]), Paragraph("Received By (Supplier)", st["cellb"])]],
                colWidths=[58 * mm, 58 * mm, 58 * mm])
    sig.setStyle(TableStyle([("ALIGN", (0, 0), (-1, -1), "CENTER"), ("TOPPADDING", (0, 1), (-1, 1), 2)]))
    story.append(Spacer(1, 10 * mm))
    story.append(KeepTogether(sig))

    doc.build(story, canvasmaker=lambda *a, **k: _NumberedCanvas(*a, header=hdr, **k))
    return buf.getvalue()


def _docx_to_pdf(docx_path: str, out_dir: str) -> Optional[str]:
    try:
        subprocess.run(["libreoffice", "--headless", "--convert-to", "pdf", "--outdir", out_dir, docx_path],
                       check=True, capture_output=True, timeout=60)
        for f in os.listdir(out_dir):
            if f.endswith(".pdf"):
                return os.path.join(out_dir, f)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError) as e:
        logger.warning("LibreOffice PDF conversion failed: %s", e)
    return None


def render_mess_bill(template_bytes: bytes, context: dict) -> Tuple[bytes, str, str]:
    from docxtpl import DocxTemplate
    with tempfile.TemporaryDirectory() as tmpd:
        src = os.path.join(tmpd, "tpl.docx")
        with open(src, "wb") as f:
            f.write(template_bytes)
        tpl = DocxTemplate(src)
        tpl.render(context, autoescape=True)
        rendered = os.path.join(tmpd, "bill.docx")
        tpl.save(rendered)
        pdf = _docx_to_pdf(rendered, tmpd)
        if pdf:
            with open(pdf, "rb") as f:
                return f.read(), "application/pdf", "pdf"
        with open(rendered, "rb") as f:
            return (f.read(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx")


def _oxml(tag):
    from docx.oxml import OxmlElement
    return OxmlElement(tag)


def _set_repeat_header(row):
    from docx.oxml.ns import qn
    trPr = row._tr.get_or_add_trPr()
    el = _oxml("w:tblHeader"); el.set(qn("w:val"), "true"); trPr.append(el)


def _set_cant_split(row):
    from docx.oxml.ns import qn
    trPr = row._tr.get_or_add_trPr()
    el = _oxml("w:cantSplit"); el.set(qn("w:val"), "true"); trPr.append(el)


def _page_field(paragraph):
    from docx.oxml.ns import qn
    for code in ("PAGE", None, "NUMPAGES"):
        if code is None:
            paragraph.add_run(" of ")
            continue
        run = paragraph.add_run()
        b = _oxml("w:fldChar"); b.set(qn("w:fldCharType"), "begin")
        instr = _oxml("w:instrText"); instr.set(qn("xml:space"), "preserve"); instr.text = f" {code} "
        e = _oxml("w:fldChar"); e.set(qn("w:fldCharType"), "end")
        run._r.append(b); run._r.append(instr); run._r.append(e)


def build_sample_template_docx() -> bytes:
    """Ready-to-edit sample .docx: repeating table header, row integrity, section
    header with bill identity + Page X of Y, {%tr%} loop with continuous numbering."""
    from docx import Document
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.shared import Pt, RGBColor

    d = Document()
    for s in d.sections:
        s.top_margin = s.bottom_margin = Pt(36)
        s.left_margin = s.right_margin = Pt(42)
        hp = s.header.paragraphs[0]
        hp.text = ""
        r = hp.add_run("{{ company_name }}")
        r.bold = True; r.font.size = Pt(10); r.font.color.rgb = RGBColor(0x15, 0x5E, 0xEF)
        hp.add_run("\nBill {{ bill_no }}  ·  Invoice {{ invoice_no }}  ·  {{ supplier_name }}").font.size = Pt(7)
        fp = s.footer.paragraphs[0]
        fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        fp.add_run("Page ").font.size = Pt(8)
        _page_field(fp)

    t = d.add_paragraph()
    t.alignment = WD_ALIGN_PARAGRAPH.CENTER
    tr = t.add_run("MESS PURCHASE BILL / TAX INVOICE")
    tr.bold = True; tr.font.size = Pt(15); tr.font.color.rgb = RGBColor(0x15, 0x5E, 0xEF)

    info = d.add_table(rows=1, cols=2)
    info.style = "Table Grid"
    info.cell(0, 0).text = ("SUPPLIER (FROM)\n{{ supplier_name }}\n{{ supplier_address }}\n"
                            "GSTIN: {{ supplier_gst }}   PAN: {{ supplier_pan }}\n"
                            "State: {{ supplier_state }}   Ph: {{ supplier_phone }}")
    info.cell(0, 1).text = ("BUYER (BILL TO)\n{{ company_name }}\n{{ company_address }}\n"
                            "GSTIN: {{ company_gst }}   PAN: {{ company_pan }}\n"
                            "State: {{ company_state }}   Center: {{ center_name }}")

    meta = d.add_paragraph()
    meta.add_run("Bill No: {{ bill_no }}    Invoice No: {{ invoice_no }}    Invoice Date: {{ invoice_date }}    "
                 "Payment Date: {{ payment_date }}    Mode: {{ payment_mode }}    Supply: {{ tax_type }}").font.size = Pt(8)

    table = d.add_table(rows=1, cols=7)
    table.style = "Table Grid"
    table.autofit = True
    for i, htxt in enumerate(["S.No", "Item Description", "HSN/SAC", "Qty", "Rate", "Tax", "Amount"]):
        table.rows[0].cells[i].text = ""
        run = table.rows[0].cells[i].paragraphs[0].add_run(htxt)
        run.bold = True; run.font.size = Pt(8)
    _set_repeat_header(table.rows[0])

    # docxtpl row-loop needs the {%tr for%} and {%tr endfor%} in their OWN rows;
    # those rows are consumed, the DATA row between them repeats per item.
    forrow = table.add_row()
    forrow.cells[0].paragraphs[0].add_run("{%tr for ln in lines %}")
    data = table.add_row()
    _set_cant_split(data)  # a single item row never splits across a page break
    c = data.cells
    c[0].paragraphs[0].add_run("{{ loop.index }}").font.size = Pt(8)
    c[1].paragraphs[0].add_run("{{ ln.item_name }}").font.size = Pt(8)
    c[2].paragraphs[0].add_run("{{ ln.hsn_sac }}").font.size = Pt(8)
    c[3].paragraphs[0].add_run("{{ ln.accepted_qty }} {{ ln.unit }}").font.size = Pt(8)
    c[4].paragraphs[0].add_run("{{ ln.unit_price }}").font.size = Pt(8)
    c[5].paragraphs[0].add_run("{{ ln.tax_amount }} ({{ ln.tax_rate }}%)").font.size = Pt(8)
    c[6].paragraphs[0].add_run("{{ ln.amount }}").font.size = Pt(8)
    endrow = table.add_row()
    endrow.cells[0].paragraphs[0].add_run("{%tr endfor %}")

    d.add_paragraph()
    tt = d.add_table(rows=0, cols=2)
    tt.style = "Table Grid"
    for label, val in [("Total Taxable Value", "{{ taxable_amount }}"), ("CGST {{ cgst_rate }}%", "{{ cgst_amount }}"),
                       ("SGST {{ sgst_rate }}%", "{{ sgst_amount }}"), ("IGST {{ igst_rate }}%", "{{ igst_amount }}"),
                       ("Total Tax", "{{ total_tax }}"), ("Round Off", "{{ round_off }}"), ("GRAND TOTAL", "{{ total_amount }}")]:
        row = tt.add_row().cells
        row[0].paragraphs[0].add_run(label).font.size = Pt(8)
        rr = row[1].paragraphs[0].add_run("₹ " + val); rr.font.size = Pt(8); rr.bold = True

    d.add_paragraph("Amount in Words: {{ total_words }}").runs[0].italic = True
    d.add_paragraph("Tax in Words: {{ tax_amount_words }}").runs[0].italic = True
    d.add_paragraph()
    d.add_paragraph("Supplier Bank: {{ bank_name }} · A/C {{ bank_account }} · IFSC {{ bank_ifsc }} · {{ bank_branch }}").runs[0].font.size = Pt(8)
    d.add_paragraph("Approval Trail:").runs[0].bold = True
    d.add_paragraph("{% for a in approvals %}L{{ a.level }} · {{ a.by_user_name }} · {{ a.action }} · {{ a.at }}\n{% endfor %}")

    out = BytesIO()
    d.save(out)
    return out.getvalue()


def sample_invoice_objects() -> tuple:
    receipt = {
        "id": "SAMPLE-RECEIPT", "invoice_no": "2025-26/2237", "invoice_date": "2025-10-11",
        "supplier_name": "XPERT COMPUTER SOLUTION - (2024-25)", "supplier_gst": "20AMZPA5673L1ZN",
        "center_name": "Ranchi Center",
        "lines": [{"item_id": "x", "item_name": "SECUREYE BIOMETRICS S-B8CB (SC-S-B8CB)",
                   "hsn_sac": "91069000", "qty": 2, "accepted_qty": 2, "unit": "PCS",
                   "unit_price": 2711.86, "discount": 0, "gst_rate": 18, "tax": 976.26}],
        "total_amount": 6400.00,
    }
    payment = {"payment_mode": "bank", "payment_date": "2025-10-12", "paid_by_name": "Accounts Dept",
               "chain_history": [{"level": 1, "by_user_name": "Senior Manager", "action": "approve", "at": "2025-10-11"},
                                 {"level": 2, "by_user_name": "Admin", "action": "approve", "at": "2025-10-12"},
                                 {"level": 3, "by_user_name": "Accounts Team", "action": "approve", "at": "2025-10-12"}]}
    company = {"name": "Mashara Enterprises", "address": "LIG 21, Harmu Housing Colony Road, Saket Vihar, Ranchi",
               "gst": "20FUTPK0747N1Z5", "pan": "FUTPK0747N"}
    center = {"name": "Ranchi Center"}
    supplier = {"name": "XPERT COMPUTER SOLUTION - (2024-25)", "address": "M9 Roshpa Tower, Main Road, Ranchi",
                "gst_number": "20AMZPA5673L1ZN", "pan_number": "AMZPA5673L", "mobile": "9000000000",
                "email": "sales@xpert.example", "bank_name": "HDFC Bank", "bank_account_no": "501000123456", "ifsc": "HDFC0000123"}
    return receipt, payment, company, center, supplier


def sample_invoice_large(n_items: int = 28) -> tuple:
    receipt, payment, company, center, supplier = sample_invoice_objects()
    base = receipt["lines"][0]
    lines = []
    for i in range(1, n_items + 1):
        lines.append({**base, "item_name": f"Test Item {i} — long description to verify text wrapping within the bordered cell across pages",
                      "hsn_sac": f"9106{i:04d}"[:8], "qty": i, "accepted_qty": i, "unit_price": 100 + i,
                      "gst_rate": 18, "tax": round((100 + i) * i * 0.18, 2)})
    return {**receipt, "lines": lines}, payment, company, center, supplier


def sample_context(large: bool = False, n_items: int = 28) -> dict:
    receipt, payment, company, center, supplier = (sample_invoice_large(n_items) if large else sample_invoice_objects())
    return build_mess_bill_context(receipt, payment, company, center, "MB-SAMPLE-0001", supplier=supplier)


def validate_template_bytes(template_bytes: bytes) -> dict:
    from docxtpl import DocxTemplate
    import jinja2
    errors: List[str] = []
    warnings: List[str] = []
    variables: List[str] = []
    with tempfile.TemporaryDirectory() as tmpd:
        p = os.path.join(tmpd, "t.docx")
        with open(p, "wb") as f:
            f.write(template_bytes)
        try:
            tpl = DocxTemplate(p)
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "errors": [f"Not a valid .docx file: {str(e)[:160]}"], "warnings": [], "variables": []}
        try:
            variables = sorted(tpl.get_undeclared_template_variables(jinja2.Environment()))
        except Exception:  # noqa: BLE001
            variables = []  # variable introspection is best-effort; render is authoritative
        for v in variables:
            top = v.split(".")[0].split("[")[0]
            if top not in KNOWN_TOP_VARS:
                warnings.append(f"Unknown placeholder '{{{{ {v} }}}}' — not a supported field; will render empty.")
        try:
            DocxTemplate(p).render(sample_context(), autoescape=True)
        except Exception as e:  # noqa: BLE001
            errors.append(f"Template failed to render with sample data: {str(e)[:200]}")
    return {"ok": not errors, "errors": errors, "warnings": warnings, "variables": variables}
