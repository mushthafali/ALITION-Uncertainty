"""
DKD-R 6-1 Certificate Reporting Module
Generates professional PDF and Excel calibration certificates
from dkdWizardState payload serialized by the JS frontend.
"""
from __future__ import annotations

import io
import os
import sys
import datetime
from typing import Any, Dict, List, Optional

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

import openpyxl  # type: ignore[import-untyped, import-not-found]
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side  # type: ignore[import-untyped]
from openpyxl.utils import get_column_letter  # type: ignore[import-untyped]

from reportlab.lib import colors  # type: ignore[import-untyped]
from reportlab.lib.colors import Color, HexColor  # type: ignore[import-untyped]
from reportlab.lib.pagesizes import A4  # type: ignore[import-untyped]
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle  # type: ignore[import-untyped]
from reportlab.lib.units import mm  # type: ignore[import-untyped]
from reportlab.pdfgen import canvas  # type: ignore[import-untyped]
from reportlab.platypus import (  # type: ignore[import-untyped]
    Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle, HRFlowable, PageBreak, Flowable
)


# ── Dynamic Two-Pass Page Numbering Canvas ────────────────────────────────────

class NumberedCanvas(canvas.Canvas):
    """
    Two-pass canvas that dynamically calculates the total page count and prints
    consistent running page numbers and certificate tracking on every page.
    """
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_footer(num_pages)
            canvas.Canvas.showPage(self)
        canvas.Canvas.save(self)

    def draw_footer(self, page_count):
        self.saveState()
        self.setFont("Helvetica", 8)
        self.setFillColor(HexColor("#64748b"))
        self.setStrokeColor(HexColor("#e2e8f0"))
        self.setLineWidth(0.6)
        
        # Subtle separator rule above running footer
        self.line(16*mm, 12*mm, (210-16)*mm, 12*mm)
        
        cert_no_str = getattr(self, '_cert_number', '')
        left_text = f"Sertifikat / Certificate: {cert_no_str}" if cert_no_str else "Alition Calibration System (DKD-R 6-1)"
        self.drawString(16*mm, 7.5*mm, left_text)
        
        page_text = f"Halaman {self._pageNumber} dari {page_count}  |  Page {self._pageNumber} of {page_count}"
        self.drawRightString((210-16)*mm, 7.5*mm, page_text)
        self.restoreState()


def _get_logo_path() -> Optional[str]:
    candidates = [
        os.path.join(getattr(sys, '_MEIPASS', ''), 'img', 'logo_polos.png'),
        os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'img', 'logo_polos.png')),
        os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'img', 'logo_polos.png')),
        os.path.join(os.getcwd(), 'img', 'logo_polos.png'),
    ]
    for p in candidates:
        if p and os.path.exists(p):
            return p
    return None


def make_numbered_canvas(cert_number: str):
    class DocNumberedCanvas(NumberedCanvas):
        _cert_number = cert_number
    return DocNumberedCanvas


# ── Rounded Table Container (Modern Antislop Card with Clipping) ──────────────

class RoundedCard(Flowable):
    """
    Container with softly rounded corners and subtle border,
    clipping its content so tables fit 100% cleanly without awkward margins.
    """
    def __init__(self, content: Any, width: Optional[float] = 504, radius: float = 6,
                 bg_color: Optional[Color] = HexColor('#ffffff'),
                 border_color: Optional[Color] = HexColor('#cbd5e1')):
        super().__init__()
        self.content = content
        self.target_width = width
        self.radius = radius
        self.bg_color = bg_color
        self.border_color = border_color
        self.width = width or 504
        self.height = 0

    def wrap(self, availWidth: float, availHeight: float) -> tuple[float, float]:
        w = self.target_width if self.target_width is not None else availWidth
        c_w, c_h = self.content.wrap(w, availHeight)
        self.width = w
        self.height = c_h
        return self.width, self.height

    def draw(self) -> None:
        self.canv.saveState()
        p = self.canv.beginPath()
        p.roundRect(0, 0, self.width, self.height, self.radius)
        self.canv.clipPath(p, stroke=0)
        if self.bg_color:
            self.canv.setFillColor(self.bg_color)
            self.canv.rect(0, 0, self.width, self.height, fill=1, stroke=0)
        self.content.drawOn(self.canv, 0, 0)
        self.canv.restoreState()
        if self.border_color:
            self.canv.saveState()
            self.canv.setStrokeColor(self.border_color)
            self.canv.setLineWidth(0.75)
            self.canv.roundRect(0, 0, self.width, self.height, self.radius, fill=0, stroke=1)
            self.canv.restoreState()


# ── Helpers ────────────────────────────────────────────────────────────────────

def _format_id_date(dt_str: str) -> str:
    """Format ISO date string to Indonesian format (e.g. 07 Juli 2026) safely."""
    import datetime
    try:
        dt = datetime.datetime.strptime(dt_str[:10], "%Y-%m-%d")
    except Exception:
        dt = datetime.datetime.now()
    months = [
        "Januari", "Februari", "Maret", "April", "Mei", "Juni",
        "Juli", "Agustus", "September", "Oktober", "November", "Desember"
    ]
    return f"{dt.day:02d} {months[dt.month - 1]} {dt.year}"

def _fmtv(v: Any, d: int = 4) -> str:
    """Format a numeric value to d decimal places, or '—' if None/NaN."""
    try:
        return f"{float(v):.{d}f}" if v is not None else "—"
    except (TypeError, ValueError):
        return "—"


def _pass_fail(passed: bool) -> str:
    return "PASS" if passed else "FAIL"


# ── Main Class ─────────────────────────────────────────────────────────────────

class DkdReportingModule:
    """
    Accepts the full JSON payload from JS exportDkdReport() and generates
    professional DKD-R 6-1 calibration certificates in PDF or Excel format.
    """

    def __init__(self, data: dict):
        self.data         = data
        self.meta         = data.get('meta', {})
        self.setup        = data.get('setup', {})
        self.sequence     = data.get('sequence', 'A')
        self.setpoints    = data.get('setpoints', [])
        self.m_series     = data.get('mSeries', [])
        self.row_results  = data.get('rowResults', [])
        self.u_std        = data.get('u_std', 0)
        self.u_res        = data.get('u_res', 0)
        self.u_f0         = data.get('u_f0', 0)
        self.mpe_val      = data.get('mpe_val', 0)
        self.raw_unit     = data.get('raw_unit', '')
        self.avg_env      = data.get('avg_env', {})
        self.preload_data = data.get('preloadData', [])

    # ── PDF ───────────────────────────────────────────────────────────────────

    def export_pdf(self, filename: str, cert_number: str = '') -> None:
        import io
        import os
        from .storage import StorageManager

        if not cert_number:
            cert_number = StorageManager.generate_certificate_number(self.meta.get('date'))

        buffer = io.BytesIO()
        doc = SimpleDocTemplate(
            buffer, pagesize=A4,
            leftMargin=16*mm, rightMargin=16*mm,
            topMargin=14*mm, bottomMargin=14*mm
        )
        styles = getSampleStyleSheet()

        DARK  = HexColor('#1e293b')
        BLUE  = HexColor('#3b82f6')
        GREEN = HexColor('#16a34a')
        RED   = HexColor('#dc2626')
        GREY  = HexColor('#64748b')
        LIGHT = HexColor('#f8fafc')

        title_style = ParagraphStyle('DKDTitle', parent=styles['Title'],
            fontSize=18, textColor=DARK, spaceAfter=4, fontName='Helvetica-Bold')
        sub_style   = ParagraphStyle('DKDSub', parent=styles['Normal'],
            fontSize=9, textColor=GREY, spaceAfter=2)
        h2_style    = ParagraphStyle('DKDH2', parent=styles['Heading2'],
            fontSize=11, textColor=DARK, spaceBefore=14, spaceAfter=6,
            fontName='Helvetica-Bold')

        unit = self.raw_unit
        instrument = self.meta.get('instrument_model', '—')
        tag_no     = self.meta.get('tag_number', '—')
        serial_no  = self.meta.get('serial_number', '—')
        operator   = self.meta.get('operator_name', '—')
        date_val   = self.meta.get('date', '—')
        export_date = str(self.meta.get('date') or datetime.datetime.now().strftime('%Y-%m-%d'))
        location   = self.meta.get('location', '—')

        max_U   = max((r.get('U', 0) for r in self.row_results), default=0)
        max_err = max((abs(r.get('dev', 0)) for r in self.row_results), default=0)
        overall_pass = all(r.get('pass', False) for r in self.row_results)
        overall_label = "PASS" if overall_pass else "FAIL"
        overall_badge = f"{overall_label} {'✓' if overall_pass else '✗'}"
        verdict_color = GREEN if overall_pass else RED

        elems: list = []

        # ── Plain White Header with Alition Identity ──────────────────────────
        h_brand_title = Paragraph("<b>ALITION</b>", ParagraphStyle('HBrandTitle', fontName='Helvetica-Bold', fontSize=16, leading=19, textColor=HexColor('#0f172a')))
        h_brand_sub = Paragraph("AUTOMATIC CALIBRATION CALCULATIONS SYSTEM", ParagraphStyle('HBrandSub', fontName='Helvetica', fontSize=7, leading=9, textColor=HexColor('#64748b')))

        logo_path = _get_logo_path()
        if logo_path and os.path.exists(logo_path):
            logo_flowable = Image(logo_path, width=34, height=34)
            header_table = Table([
                [logo_flowable, [h_brand_title, h_brand_sub]]
            ], colWidths=[42, 462])
            header_table.setStyle(TableStyle([
                ('VALIGN',        (0, 0), (-1, -1), 'MIDDLE'),
                ('LEFTPADDING',   (0, 0), (0, 0), 0),
                ('RIGHTPADDING',  (0, 0), (0, 0), 0),
                ('LEFTPADDING',   (1, 0), (1, 0), 6),
                ('RIGHTPADDING',  (1, 0), (1, 0), 0),
                ('TOPPADDING',    (0, 0), (-1, -1), 0),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
                ('LINEBELOW',     (0, 0), (-1, -1), 1.2, HexColor('#2563eb')),
            ]))
        else:
            header_table = Table([
                [[h_brand_title, h_brand_sub]]
            ], colWidths=[504])
            header_table.setStyle(TableStyle([
                ('VALIGN',        (0, 0), (-1, -1), 'MIDDLE'),
                ('LEFTPADDING',   (0, 0), (-1, -1), 0),
                ('RIGHTPADDING',  (0, 0), (-1, -1), 0),
                ('TOPPADDING',    (0, 0), (-1, -1), 0),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
                ('LINEBELOW',     (0, 0), (-1, -1), 1.2, HexColor('#2563eb')),
            ]))
        elems.append(header_table)
        elems.append(Spacer(1, 12))

        # ── Prominent Main Title (Highlight Utama - Formal Authoritative Serif) ─
        title_main = Paragraph("SERTIFIKAT KALIBRASI", ParagraphStyle(
            'MainTitle', fontName='Times-Bold', fontSize=19, leading=23, textColor=HexColor('#0f172a'), alignment=1, spaceAfter=2
        ))
        title_sub = Paragraph("CALIBRATION CERTIFICATE", ParagraphStyle(
            'MainSub', fontName='Times-Italic', fontSize=9.5, leading=12, textColor=HexColor('#64748b'), alignment=1, spaceAfter=4
        ))
        # Monospaced tabular font for the official registry certificate number
        title_cert_no = Paragraph(f"<font name='Helvetica' size=8.5 color='#64748b'>Nomor Sertifikat / Certificate No : </font><font name='Courier-Bold' size=10.5 color='#1d4ed8'>{cert_number}</font>", ParagraphStyle(
            'MainCertNo', alignment=1
        ))

        title_block = Table([[title_main], [title_sub], [title_cert_no]], colWidths=[504])
        title_block.setStyle(TableStyle([
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
            ('TOPPADDING', (0, 0), (-1, -1), 2),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ]))
        elems.append(title_block)
        elems.append(Spacer(1, 14))

        # ── Purposeful Typographic Hierarchy (Antislop UI) ─────────────────────
        DARK       = HexColor('#0f172a')  # Slate 900
        BODY_DARK  = HexColor('#1e293b')  # Slate 800
        GREY       = HexColor('#64748b')  # Slate 500
        LABEL_CLR  = HexColor('#334155')  # Slate 700

        # Section Headings
        s1_section = ParagraphStyle('S1Section', parent=styles['Normal'],
            fontName='Helvetica-Bold', fontSize=10, leading=13,
            textColor=DARK, spaceBefore=0, spaceAfter=1)
        s1_sub = ParagraphStyle('S1Sub', parent=styles['Normal'],
            fontName='Times-Italic', fontSize=8, leading=10,
            textColor=GREY, spaceAfter=4)

        # Labels & Colons
        s1_label = ParagraphStyle('S1Label', parent=styles['Normal'],
            fontName='Helvetica-Bold', fontSize=8, leading=9.5,
            textColor=LABEL_CLR)
        s1_colon = ParagraphStyle('S1Colon', parent=styles['Normal'],
            fontName='Helvetica', fontSize=8, leading=9.5,
            textColor=GREY)

        # Values categorized by functional role
        s1_val_text = ParagraphStyle('S1ValTxt', parent=styles['Normal'],
            fontName='Helvetica', fontSize=8, leading=9.5,
            textColor=BODY_DARK)
        s1_val_code = ParagraphStyle('S1ValCode', parent=styles['Normal'],
            fontName='Courier-Bold', fontSize=8, leading=9.5,
            textColor=BODY_DARK)
        s1_val_num  = ParagraphStyle('S1ValNum', parent=styles['Normal'],
            fontName='Helvetica-Bold', fontSize=8, leading=9.5,
            textColor=BODY_DARK)

        # Helper for bilingual labels (Bahasa Indonesia on top, English in italics below)
        def _lbl(id_text: str, en_text: str) -> Paragraph:
            return Paragraph(f"{id_text}<br/><font name='Times-Italic' size=6.8 color='#64748b'>{en_text}</font>", s1_label)

        # Formal Approval Sign-off (Legal authority serif)
        export_dt_formatted = _format_id_date(export_date)
        sig_title = Paragraph("<b>Disetujui oleh :</b><br/><font name='Times-Italic' size=8 color='#64748b'>Approved by :</font>", ParagraphStyle('SigTitle', fontName='Times-Bold', fontSize=9.5, leading=12, textColor=DARK))
        sig_loc_date = Paragraph(f"Jakarta, {export_dt_formatted}", ParagraphStyle('SigLocDate', fontName='Times-Roman', fontSize=9.5, leading=13, textColor=BODY_DARK))

        # ── Helper: thin horizontal rule ──
        def _hr():
            return HRFlowable(width='100%', thickness=0.5, color=HexColor('#cbd5e1'),
                              spaceBefore=2, spaceAfter=4)

        # ── Data Preparation ───────────────────────────────────────────────────
        lrv_urv = f"{_fmtv(self.setup.get('lrv'), 2)} ~ {_fmtv(self.setup.get('urv'), 2)} {unit}"
        res_val = f"{_fmtv(self.setup.get('resolution'), 2)} {unit}"
        mpe_val = f"±{_fmtv(self.setup.get('mpe_percent'), 2)} %FS"

        # ── Table style (reused for all detail tables) ──
        detail_ts = TableStyle([
            ('VALIGN',        (0, 0), (-1, -1), 'TOP'),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
            ('TOPPADDING',    (0, 0), (-1, -1), 1),
            ('LEFTPADDING',   (0, 0), (-1, -1), 0),
            ('RIGHTPADDING',  (0, 0), (-1, -1), 0),
        ])
        L_COL = [105, 8, 131]
        R_COL = [105, 8, 131]

        # ═══════════════════════════════════════════════════════════════════════
        #  COLUMN 1 (LEFT): Identitas Alat & Data Kalibrasi
        # ═══════════════════════════════════════════════════════════════════════
        left: List[Any] = []

        # ── 1. Identitas Alat (tag number tidak diikutsertakan) ──
        left.append(Paragraph("Identitas Alat", s1_section))
        left.append(Paragraph("Instrument Details", s1_sub))
        rows_alat = [
            [_lbl("Tipe Alat", "Instrument Type"),                     Paragraph(":", s1_colon), Paragraph("Pressure Gauge",              s1_val_text)],
            [_lbl("Model", "Model"),                                   Paragraph(":", s1_colon), Paragraph(instrument,                    s1_val_text)],
            [_lbl("Nomor Seri", "Serial Number"),                     Paragraph(":", s1_colon), Paragraph(serial_no,                     s1_val_code)],
            [_lbl("Rentang Ukur", "Measuring Range"),                 Paragraph(":", s1_colon), Paragraph(lrv_urv,                       s1_val_num)],
            [_lbl("Toleransi / Resolusi", "Tolerance / Resolution"),  Paragraph(":", s1_colon), Paragraph(f"{mpe_val} / {res_val}",      s1_val_num)],
            [_lbl("Lokasi", "Location"),                               Paragraph(":", s1_colon), Paragraph(location,                      s1_val_text)],
        ]
        t = Table(rows_alat, colWidths=L_COL)
        t.setStyle(detail_ts)
        left.append(t)
        left.append(_hr())

        # ── 2. Data Kalibrasi ──
        left.append(Paragraph("Data Kalibrasi", s1_section))
        left.append(Paragraph("Calibration Data", s1_sub))
        rows_cal = [
            [_lbl("Tanggal Kalibrasi", "Calibration Date"),           Paragraph(":", s1_colon), Paragraph(date_val,                              s1_val_num)],
            [_lbl("Sekuens Kalibrasi", "Calibration Sequence"),       Paragraph(":", s1_colon), Paragraph(f"Seq {self.sequence}",                 s1_val_code)],
            [_lbl("Kalibrator Standar", "Standard Calibrator"),       Paragraph(":", s1_colon), Paragraph(self.setup.get('calibrator_type', '—'), s1_val_text)],
            [_lbl("Batas Kesalahan Izin (MPE)", "Max Permissible Error"), Paragraph(":", s1_colon), Paragraph(mpe_val,                               s1_val_num)],
        ]
        t = Table(rows_cal, colWidths=L_COL)
        t.setStyle(detail_ts)
        left.append(t)

        # ═══════════════════════════════════════════════════════════════════════
        #  COLUMN 2 (RIGHT): Kondisi Lingkungan, Hasil Kalibrasi, & Pelaksana
        # ═══════════════════════════════════════════════════════════════════════
        right: List[Any] = []

        # ── 1. Kondisi Lingkungan ──
        right.append(Paragraph("Kondisi Lingkungan", s1_section))
        right.append(Paragraph("Environmental Conditions", s1_sub))
        rows_env = [
            [_lbl("Suhu Ruang", "Ambient Temperature"),               Paragraph(":", s1_colon), Paragraph(f"{_fmtv(self.avg_env.get('temperature'), 2)} °C",  s1_val_num)],
            [_lbl("Kelembaban Udara", "Relative Humidity"),           Paragraph(":", s1_colon), Paragraph(f"{_fmtv(self.avg_env.get('humidity'), 2)} %RH",  s1_val_num)],
            [_lbl("Tekanan Udara", "Atmospheric Pressure"),           Paragraph(":", s1_colon), Paragraph(f"{_fmtv(self.avg_env.get('pressure_atm'), 2)} hPa", s1_val_num)],
        ]
        t_env = Table(rows_env, colWidths=R_COL)
        t_env.setStyle(detail_ts)
        right.append(t_env)
        right.append(_hr())

        # ── 2. Hasil Kalibrasi (summary verdict) ──
        right.append(Paragraph("Hasil Kalibrasi", s1_section))
        right.append(Paragraph("Calibration Results", s1_sub))

        verdict_style = ParagraphStyle('Verdict', parent=styles['Normal'],
            fontName='Helvetica-Bold', fontSize=8.5, leading=11,
            textColor=verdict_color)
        rows_res = [
            [_lbl("Ketidakpastian (U)", "Uncertainty (U)"),           Paragraph(":", s1_colon), Paragraph(f"{_fmtv(max_U, 4)} {unit}",  s1_val_num)],
            [_lbl("Deviasi Maksimum", "Maximum Deviation"),           Paragraph(":", s1_colon), Paragraph(f"{_fmtv(max_err, 4)} {unit}", s1_val_num)],
            [_lbl("Keputusan", "Overall Decision"),                   Paragraph(":", s1_colon), Paragraph(overall_badge,                 verdict_style)],
        ]
        t_res = Table(rows_res, colWidths=R_COL)
        t_res.setStyle(detail_ts)
        right.append(t_res)
        right.append(_hr())

        # ── 3. Pelaksana & Dokumen ──
        right.append(Paragraph("Pelaksana & Dokumen", s1_section))
        right.append(Paragraph("Personnel & Documentation", s1_sub))
        rows_doc = [
            [_lbl("Nama Operator", "Operator Name"),                   Paragraph(":", s1_colon), Paragraph(operator,              s1_val_text)],
            [_lbl("Halaman", "Page Number"),                          Paragraph(":", s1_colon), Paragraph("1 dari 2",            s1_val_num)],
        ]
        t_doc = Table(rows_doc, colWidths=R_COL)
        t_doc.setStyle(detail_ts)
        right.append(t_doc)

        # ═══════════════════════════════════════════════════════════════════════
        #  MASTER TABLE  (two-column balanced layout)
        # ═══════════════════════════════════════════════════════════════════════
        t_master = Table([[left, right]], colWidths=[244, 244])
        t_master.setStyle(TableStyle([
            ('VALIGN',        (0, 0), (-1, -1), 'TOP'),
            ('LEFTPADDING',   (0, 0), (0, 0), 0),
            ('RIGHTPADDING',  (0, 0), (0, 0), 12),
            ('LEFTPADDING',   (1, 0), (1, 0), 12),
            ('RIGHTPADDING',  (1, 0), (1, 0), 0),
            ('TOPPADDING',    (0, 0), (-1, -1), 0),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
        ]))
        elems.append(t_master)

        # ── Spacer to lower Signature Block to the bottom ──
        elems.append(Spacer(1, 140))

        # ── Signature Block (aligned right at bottom) ──
        sig_line = Table([['']], colWidths=[180])
        sig_line.setStyle(TableStyle([
            ('LINEBELOW', (0, 0), (-1, -1), 0.75, HexColor('#334155')),
            ('TOPPADDING', (0, 0), (-1, -1), 0),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ]))

        sig_flowables = [
            sig_title,
            Spacer(1, 3),
            sig_loc_date,
            Spacer(1, 55),
            sig_line,
        ]

        sig_block_table = Table([[sig_flowables]], colWidths=[180])
        sig_block_table.setStyle(TableStyle([
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
            ('TOPPADDING', (0, 0), (-1, -1), 0),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
        ]))

        sig_wrapper = Table([['', sig_block_table]], colWidths=[312, 180])
        sig_wrapper.setStyle(TableStyle([
            ('ALIGN', (0, 0), (-1, -1), 'RIGHT'),
            ('VALIGN', (0, 0), (-1, -1), 'BOTTOM'),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
            ('TOPPADDING', (0, 0), (-1, -1), 0),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
        ]))
        elems.append(sig_wrapper)
        elems.append(PageBreak())

        # ── Table 1: Calibration Certificate ─────────────────────────────────
        elems.append(Paragraph(f"Tabel 1. Hasil Pengukuran Kalibrasi ({unit})", s1_section))
        elems.append(Paragraph(f"Table 1. Calibration Measurement Results ({unit})", s1_sub))

        cert_hdr = [
            "Titik Ukur\nSetpoint (%)",
            f"Nilai Nominal\nNominal ({unit})",
            f"Standar\nP_std ({unit})",
            f"Rerata UUT\nMean UUT ({unit})",
            f"Kesalahan\nError ({unit})",
            f"Ketidakpastian\nU (k=2) ({unit})",
            "Keputusan\nStatus"
        ]
        cert_data = [cert_hdr]
        for r in self.row_results:
            pf = r.get('pass', False)
            cert_data.append([
                f"{r.get('pct', '—')}%",
                _fmtv(r.get('nom_ideal'), 4),
                _fmtv(r.get('p_std'),     4),
                _fmtv(r.get('mean'),      4),
                _fmtv(r.get('dev'),       5),
                _fmtv(r.get('U'),         5),
                _pass_fail(pf),
            ])

        # Exact 504 pt column widths to fill the rounded card completely without empty space
        t_cert = Table(cert_data, colWidths=[54, 75, 75, 75, 75, 85, 65])
        cert_style = [
            ('BACKGROUND',    (0, 0), (-1, 0), HexColor('#f1f5f9')),
            ('TEXTCOLOR',     (0, 0), (-1, 0), HexColor('#0f172a')),
            ('FONTNAME',      (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE',      (0, 0), (-1, -1), 8),
            ('ALIGN',         (0, 0), (-1, -1), 'CENTER'),
            ('VALIGN',        (0, 0), (-1, -1), 'MIDDLE'),
            ('LINEBELOW',     (0, 0), (-1, 0), 1.0, HexColor('#cbd5e1')),
            ('LINEBELOW',     (0, 1), (-1, -1), 0.4, HexColor('#e2e8f0')),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4.5),
            ('TOPPADDING',    (0, 0), (-1, -1), 4.5),
            ('ROWBACKGROUNDS',(0, 1), (-1, -1), [HexColor('#ffffff'), HexColor('#f8fafc')]),
        ]
        # Color FAIL rows red
        for i, r in enumerate(self.row_results, start=1):
            if not r.get('pass', True):
                cert_style.append(('TEXTCOLOR', (6, i), (6, i), RED))
                cert_style.append(('FONTNAME',  (6, i), (6, i), 'Helvetica-Bold'))
            else:
                cert_style.append(('TEXTCOLOR', (6, i), (6, i), GREEN))
                cert_style.append(('FONTNAME',  (6, i), (6, i), 'Helvetica-Bold'))
        t_cert.setStyle(TableStyle(cert_style))
        elems.append(RoundedCard(t_cert, width=504, radius=6, border_color=HexColor('#cbd5e1')))
        elems.append(Spacer(1, 10))

        # ── Table 2: Uncertainty Budget ───────────────────────────────────────
        elems.append(Paragraph(f"Tabel 2. Anggaran Ketidakpastian Pengukuran ({unit})", s1_section))
        elems.append(Paragraph(f"Table 2. Measurement Uncertainty Budget ({unit})", s1_sub))
        unc_hdr = [
            "Titik Ukur\nSetpoint (%)",
            "Standar\nu_std",
            "Resolusi\nu_res",
            "Nol\nu_f0",
            "Histeresis\nu_h",
            "Repetibilitas\nu_b'",
            "Reproduktibilitas\nu_b",
            "Ketidakpastian\nU (k=2)"
        ]
        unc_data = [unc_hdr]
        for r in self.row_results:
            unc_data.append([
                f"{r.get('pct', '—')}%",
                _fmtv(self.u_std, 5),
                _fmtv(self.u_res, 5),
                _fmtv(self.u_f0,  5),
                _fmtv(r.get('u_h'),        5),
                _fmtv(r.get('u_b_prime'),  5),
                _fmtv(r.get('u_b'),        5),
                _fmtv(r.get('U'),          5),
            ])
        # Exact 504 pt column widths to fill the rounded card completely without empty space
        t_unc = Table(unc_data, colWidths=[56, 60, 60, 60, 60, 60, 60, 88])
        t_unc.setStyle(TableStyle([
            ('BACKGROUND',    (0, 0), (-1, 0), HexColor('#f1f5f9')),
            ('TEXTCOLOR',     (0, 0), (-1, 0), HexColor('#0f172a')),
            ('FONTNAME',      (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE',      (0, 0), (-1, -1), 8),
            ('ALIGN',         (0, 0), (-1, -1), 'CENTER'),
            ('VALIGN',        (0, 0), (-1, -1), 'MIDDLE'),
            ('LINEBELOW',     (0, 0), (-1, 0), 1.0, HexColor('#cbd5e1')),
            ('LINEBELOW',     (0, 1), (-1, -1), 0.4, HexColor('#e2e8f0')),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4.5),
            ('TOPPADDING',    (0, 0), (-1, -1), 4.5),
            ('ROWBACKGROUNDS',(0, 1), (-1, -1), [HexColor('#ffffff'), HexColor('#f8fafc')]),
        ]))
        elems.append(RoundedCard(t_unc, width=504, radius=6, border_color=HexColor('#cbd5e1')))
        elems.append(Spacer(1, 12))

        # ── Ladder Chart ──────────────────────────────────────────────────────
        try:
            elems.append(Paragraph("Diagram Tangga Metrologi (DKD-R 6-1)", s1_section))
            elems.append(Paragraph("Metrological Staircase Diagram", s1_sub))
            chart_img = self._build_ladder_chart()
            elems.append(chart_img)
            elems.append(Spacer(1, 12))
        except Exception:
            pass  # Chart failure should not abort PDF

        # ── Verdict Banner ────────────────────────────────────────────────────
        elems.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor('#e2e8f0'), spaceBefore=6))
        verdict_style = ParagraphStyle('Verdict', parent=styles['Normal'],
            fontSize=15, textColor=verdict_color, fontName='Helvetica-Bold',
            alignment=1, spaceBefore=8, spaceAfter=2)
        summary_style = ParagraphStyle('Summary', parent=styles['Normal'],
            fontSize=8.5, textColor=GREY, alignment=1, leading=12)

        status_id = "MEMENUHI" if overall_label == "PASS" else "TIDAK MEMENUHI"
        status_sym = "✓" if overall_label == "PASS" else "✗"
        elems.append(Paragraph(f"KEPUTUSAN AKHIR: {status_id} ({overall_label}) {status_sym}", verdict_style))
        elems.append(Paragraph(
            f"Overall Calibration Result: {overall_label} {status_sym}",
            ParagraphStyle('VerdictSub', parent=styles['Normal'], fontName='Times-Italic', fontSize=9, textColor=verdict_color, alignment=1, spaceAfter=4)
        ))
        elems.append(Paragraph(
            f"Kesalahan Maks / Max Error: {_fmtv(max_err, 5)} {unit} &nbsp;|&nbsp; "
            f"Ketidakpastian Maks / Max U (k=2): {_fmtv(max_U, 5)} {unit} &nbsp;|&nbsp; "
            f"Batas Toleransi / MPE: ±{_fmtv(self.mpe_val, 5)} {unit}",
            summary_style
        ))
        elems.append(Spacer(1, 4))
        elems.append(Paragraph(
            "Sertifikat ini diterbitkan secara otomatis oleh Alition (Sistem Kalibrasi DKD-R 6-1).<br/>"
            "<font name='Times-Italic' size=8 color='#64748b'>This certificate was generated automatically by Alition (DKD-R 6-1 Calibration System).</font>",
            summary_style
        ))

        doc.build(elems, canvasmaker=make_numbered_canvas(cert_number))

        buffer.seek(0)
        with open(filename, 'wb') as f:
            f.write(buffer.read())

    def _build_ladder_chart(self) -> Image:
        """
        Reconstruct the metrological staircase diagram that matches the app's
        renderLadderChart() — Preloading (cyan) + M-series steps (blue/orange) +
        optional Zero Setting point.
        """
        lrv  = float(self.setup.get('lrv', 0))
        urv  = float(self.setup.get('urv', 100))
        unit = self.raw_unit
        seq  = self.sequence
        mdata = self.data.get('measurementData', {})
        preload_data = self.preload_data or []

        labels: list     = []
        values: list     = []
        colors_pt: list  = []

        CYAN   = '#22d3ee'
        BLUE   = '#3b6ef8'
        ORANGE = '#f59e0b'
        PURPLE = '#a78bfa'

        # ── Preloading (Round 1) ─────────────────────────────────────────────
        p1 = [r for r in preload_data if r.get('round') == 1]
        if p1:
            for rec in p1:
                c = rec.get('cycle', 1)
                labels.append(f'Preload {c} Max');  values.append(urv); colors_pt.append(CYAN)
                labels.append(f'Preload {c} Zero'); values.append(lrv); colors_pt.append(CYAN)
        else:
            n_cyc = 3 if seq == 'A' else 2 if seq == 'B' else 1
            for c in range(1, n_cyc + 1):
                labels.append(f'Preload {c} Max');  values.append(urv); colors_pt.append(CYAN)
                labels.append(f'Preload {c} Zero'); values.append(lrv); colors_pt.append(CYAN)

        # ── M-Series measurements (ascending = blue, descending = orange) ────
        m_series = self.m_series
        for m_idx, m in enumerate(m_series):
            ascending = (m_idx % 2 == 0)          # M1, M3, M5 ascend; M2, M4, M6 descend
            color = BLUE if ascending else ORANGE
            records = sorted(mdata.get(m, []),
                             key=lambda r: r.get('setpoint_pct', 0),
                             reverse=not ascending)
            for rec in records:
                pct = rec.get('setpoint_pct', 0)
                val = lrv + (pct / 100) * (urv - lrv)
                labels.append(f'{m} {pct}%')
                values.append(val)
                colors_pt.append(color)

            # Sequence A: insert Preload 4 (2nd clamping) after M4
            if seq == 'A' and m == 'M4':
                labels.append('Preload 4 Max');  values.append(urv); colors_pt.append(CYAN)
                labels.append('Preload 4 Zero'); values.append(lrv); colors_pt.append(CYAN)

        # ── Zero Setting ─────────────────────────────────────────────────────
        zs = self.data.get('zeroSettingData')
        if zs and zs.get('reading') is not None:
            labels.append('Zero Setting')
            values.append(float(zs['reading']))
            colors_pt.append(PURPLE)

        # ── Build figure ─────────────────────────────────────────────────────
        fig, ax = plt.subplots(figsize=(8, 3.8))
        ax.set_facecolor('#f8fafc')
        fig.patch.set_facecolor('#ffffff')

        xs = list(range(len(values)))
        # Stepped line (post = step after each point, matching 'before' stepped in Chart.js)
        ax.step(xs, values, where='post', linewidth=1.8, color=BLUE, alpha=0.7)
        ax.scatter(xs, values, c=colors_pt, s=28, zorder=5)

        # Reference lines
        ax.axhline(y=urv, color='#94a3b8', linestyle='--', linewidth=0.8, alpha=0.5)
        ax.axhline(y=lrv, color='#94a3b8', linestyle='--', linewidth=0.8, alpha=0.5)

        ax.set_ylabel(f'Pressure ({unit})', fontsize=9)
        ax.set_xlabel('Measurement Step', fontsize=9)
        ax.set_title('Metrological Staircase Diagram', fontsize=11, fontweight='bold', pad=10)
        ax.set_xlim(-0.5, len(xs) - 0.5)
        ax.set_xticks([])   # hide x-tick numbers; labels are too dense
        ax.grid(True, axis='y', linestyle='--', linewidth=0.4, color='#e2e8f0')
        ax.spines['top'].set_visible(False)
        ax.spines['right'].set_visible(False)

        # Legend
        from matplotlib.lines import Line2D
        legend_elements = [
            Line2D([0], [0], marker='o', color='w', markerfacecolor=CYAN,   markersize=8, label='Preloading'),
            Line2D([0], [0], marker='o', color='w', markerfacecolor=BLUE,   markersize=8, label='Ascending (M1/M3/M5)'),
            Line2D([0], [0], marker='o', color='w', markerfacecolor=ORANGE, markersize=8, label='Descending (M2/M4/M6)'),
        ]
        if zs and zs.get('reading') is not None:
            legend_elements.append(Line2D([0], [0], marker='o', color='w', markerfacecolor=PURPLE, markersize=8, label='Zero Setting'))
        ax.legend(handles=legend_elements, fontsize=7, framealpha=0.8, loc='upper right')

        fig.tight_layout()
        buf = io.BytesIO()
        fig.savefig(buf, format='png', dpi=150, bbox_inches='tight')
        buf.seek(0)
        plt.close(fig)
        return Image(buf, width=175*mm, height=85*mm)

    # ── Excel ─────────────────────────────────────────────────────────────────

    def export_excel(self, filename: str) -> None:
        wb = openpyxl.Workbook()

        # ── Color Palette: Warm Corporate Taupe (No harsh electric blue) ──────
        TAUPE_TITLE    = "383330"   # Deep espresso taupe for main title banner
        TAUPE_SECTION  = "4D4642"   # Warm earth taupe for table section banners
        TAUPE_HDR      = "5C5550"   # Muted rich taupe for table column headers
        TAUPE_HDR_LGT  = "F3EFEA"   # Soft warm stone for setup labels
        TAUPE_ROW_ALT  = "FAF8F5"   # Subtle warm alabaster zebra striping
        TAUPE_BORDER   = "D8D2CD"   # Soft warm grey border
        TEXT_DARK      = "2A2523"   # Primary text (deep warm charcoal)
        TEXT_MUTED     = "78706A"   # Secondary caption text
        PASS_BG        = "EAF4EC"   # Sage green background for PASS badge
        PASS_FG        = "1E5631"   # Deep forest green text for PASS badge
        FAIL_BG        = "FDF0ED"   # Muted terracotta background for FAIL badge
        FAIL_FG        = "942626"   # Deep wine red text for FAIL badge

        fill_title    = PatternFill("solid", fgColor=TAUPE_TITLE)
        fill_section  = PatternFill("solid", fgColor=TAUPE_SECTION)
        fill_hdr      = PatternFill("solid", fgColor=TAUPE_HDR)
        fill_lbl      = PatternFill("solid", fgColor=TAUPE_HDR_LGT)
        fill_alt      = PatternFill("solid", fgColor=TAUPE_ROW_ALT)
        fill_white    = PatternFill("solid", fgColor="FFFFFF")
        fill_pass     = PatternFill("solid", fgColor=PASS_BG)
        fill_fail     = PatternFill("solid", fgColor=FAIL_BG)

        font_title    = Font(bold=True, color="FFFFFF", name="Calibri", size=11)
        font_section  = Font(bold=True, color="FFFFFF", name="Calibri", size=10)
        font_hdr      = Font(bold=True, color="FFFFFF", name="Calibri", size=9.5)
        font_lbl      = Font(bold=True, color=TEXT_DARK, name="Calibri", size=9)
        font_data     = Font(name="Calibri", size=9.5, color=TEXT_DARK)
        font_bold     = Font(bold=True, name="Calibri", size=9.5, color=TEXT_DARK)
        font_pass     = Font(bold=True, color=PASS_FG, name="Calibri", size=9.5)
        font_fail     = Font(bold=True, color=FAIL_FG, name="Calibri", size=9.5)

        brd_thin      = Side(style='thin', color=TAUPE_BORDER)
        brd_med       = Side(style='medium', color=TAUPE_SECTION)
        box_border    = Border(left=brd_thin, right=brd_thin, top=brd_thin, bottom=brd_thin)
        hdr_border    = Border(left=brd_thin, right=brd_thin, top=brd_thin, bottom=brd_med)

        align_center = Alignment(horizontal="center", vertical="center", wrap_text=True)
        align_right  = Alignment(horizontal="right", vertical="center")
        align_left   = Alignment(horizontal="left", vertical="center")

        def H_title(ws, row, col, text):
            c = ws.cell(row=row, column=col, value=text)
            c.font = font_title; c.fill = fill_title
            c.alignment = Alignment(horizontal="left", vertical="center", indent=1)
            c.border = box_border
            return c

        def H_sec(ws, row, col, text):
            c = ws.cell(row=row, column=col, value=text)
            c.font = font_section; c.fill = fill_section
            c.alignment = Alignment(horizontal="left", vertical="center", indent=1)
            c.border = box_border
            return c

        def HC(ws, row, col, text):
            c = ws.cell(row=row, column=col, value=text)
            c.font = font_hdr; c.fill = fill_hdr
            c.alignment = align_center; c.border = hdr_border
            return c

        def S(ws, row, col, text):
            c = ws.cell(row=row, column=col, value=text)
            c.font = font_lbl; c.fill = fill_lbl
            c.alignment = align_left; c.border = box_border
            return c

        def V(ws, row, col, value, fmt=None, bold=False, align="center", is_alt=False, is_badge=None):
            c = ws.cell(row=row, column=col, value=value)
            c.border = box_border
            if is_badge == "PASS":
                c.font = font_pass; c.fill = fill_pass; c.alignment = align_center
            elif is_badge == "FAIL":
                c.font = font_fail; c.fill = fill_fail; c.alignment = align_center
            else:
                c.font = font_bold if bold else font_data
                c.fill = fill_alt if is_alt else fill_white
                c.alignment = align_right if align == "right" else (align_left if align == "left" else align_center)
            if fmt:
                c.number_format = fmt
            return c

        def F(ws, row, col, formula, fmt="0.000000", bold=False, align="right", is_alt=False, is_badge=None):
            c = ws.cell(row=row, column=col, value=formula)
            c.border = box_border
            if is_badge:
                c.font = font_bold; c.alignment = align_center
                c.fill = fill_alt if is_alt else fill_white
            else:
                c.font = font_bold if bold else font_data
                c.fill = fill_alt if is_alt else fill_white
                c.alignment = align_right if align == "right" else (align_left if align == "left" else align_center)
            c.number_format = fmt
            return c

        unit  = self.raw_unit
        seq   = self.sequence
        mpe   = self.mpe_val
        mdata = self.data.get('measurementData', {})

        T_avg  = self.avg_env.get('temperature', 20)
        H_avg  = self.avg_env.get('humidity', 50)
        P_atm  = self.avg_env.get('pressure_atm', 1013.25)
        rho_f  = self.setup.get('medium_density', 860)
        h_diff = self.setup.get('height_diff', 0)
        lrv    = self.setup.get('lrv', 0)
        urv    = self.setup.get('urv', 100)

        import math
        p_sat_pa = 611.2 * math.exp(17.502 * T_avg / (240.97 + T_avg))
        p_v_pa   = (H_avg / 100) * p_sat_pa
        p_d_pa   = (P_atm * 100) - p_v_pa
        T_K      = 273.15 + T_avg
        rho_a    = p_d_pa / (287.058 * T_K) + p_v_pa / (461.495 * T_K)
        UCF_MAP  = {'bar': 1e5, 'psi': 6894.757, 'kPa': 1e3, 'MPa': 1e6, 'Pa': 1, 'mbar': 100.0, 'hPa': 100.0}
        UCF      = UCF_MAP.get(unit, 1e5)
        delta_p  = ((rho_f - rho_a) * 9.80665 * h_diff) / UCF

        # ── Sheet 1: Setup ───────────────────────────────────────────────────
        _default = wb.active
        if _default is not None:
            wb.remove(_default)
        ws_setup = wb.create_sheet("Setup")
        ws_setup.title = "Setup"
        ws_setup.views.sheetView[0].showGridLines = True
        ws_setup.row_dimensions[1].height = 28
        H_title(ws_setup, 1, 1, "ALITION — DKD-R 6-1 Calibration Certificate Setup")
        c_title_b = ws_setup.cell(row=1, column=2)
        c_title_b.fill = fill_title
        c_title_b.border = box_border
        ws_setup.merge_cells("A1:B1")

        cal_type  = self.setup.get('calibrator_type', 'DIGITAL')
        std_fs    = self.setup.get('std_full_scale') or urv or 100
        std_acc   = self.setup.get('std_accuracy_percent') if self.setup.get('std_accuracy_percent') is not None else 0.025
        u_std_dwt = self.setup.get('u_standard_dwt') if self.setup.get('u_standard_dwt') is not None else (self.u_std * 2)
        res_val   = self.setup.get('resolution') if self.setup.get('resolution') is not None else round(self.u_res * 2 * math.sqrt(3), 8)
        f0_val    = round(self.u_f0 * 2 * math.sqrt(3), 8)

        # Build Section 3 (Standar Acuan & Setup Lab) conditionally
        sec3_items = [
            ("Calibrator Type", cal_type),
        ]
        if cal_type == 'DWT':
            sec3_items.append(("u_std Certificate (DWT)", u_std_dwt))
            alpha_beta = self.setup.get('alpha_beta', 0)
            rho_m = self.setup.get('rho_m', 8000)
            lambda_val = self.setup.get('lambda_val', 0)
            if alpha_beta:
                sec3_items.append(("Thermal Coeff alpha+beta (1/K)", alpha_beta))
            if rho_m and rho_m != 8000:
                sec3_items.append(("Mass Density rho_m (kg/m3)", rho_m))
            if lambda_val:
                sec3_items.append(("Deformation Coeff lambda (1/Pa)", lambda_val))
        else:
            sec3_items.append(("Std Full Scale",   std_fs))
            sec3_items.append(("Std Accuracy (%)", std_acc))

        sec3_items.extend([
            ("Zero Deviation f0",            f0_val),
            ("Height Diff h (m)",            h_diff),
            ("Medium Density rho_f (kg/m3)", rho_f),
        ])

        setup_sections = [
            ("1. INFORMASI INSTRUMEN & SESI KALIBRASI", [
                ("Instrument / UUT",            self.meta.get('instrument_model', '-')),
                ("Tag Number",                  self.meta.get('tag_number', '-')),
                ("Serial Number",               self.meta.get('serial_number', '-')),
                ("Operator",                    self.meta.get('operator_name', '-')),
                ("Date",                        self.meta.get('date', '-')),
                ("Location",                    self.meta.get('location', '-')),
                ("Calibration Standard",        "DKD-R 6-1"),
                ("Sequence",                    f"Seq {seq}"),
            ]),
            ("2. SPESIFIKASI ALAT UJI (UUT)", [
                ("LRV",                         lrv),
                ("URV",                         urv),
                ("Input Unit",                  unit),
                ("Resolution",                  res_val),
                ("MPE (%FS)",                   self.setup.get('mpe_percent')),
            ]),
            ("3. STANDAR ACUAN & SETUP LABORATORIUM", sec3_items),
            ("4. KONDISI LINGKUNGAN & DENSITAS UDARA (ISO 1217)", [
                ("Avg Temp T (C)",              T_avg),
                ("Avg Humidity RH (%)",         H_avg),
                ("Avg Atm. Press P_atm (hPa)",   P_atm),
                ("p_sat (Pa)",                  round(p_sat_pa, 4)),
                ("p_v  (Pa)",                   round(p_v_pa,  4)),
                ("p_d  (Pa)",                   round(p_d_pa,  4)),
                ("T_K  (K)",                    round(T_K, 3)),
                ("rho_a - Air Density (kg/m3)", round(rho_a, 6)),
                ("UCF - Unit Conv Factor",      UCF),
                (f"delta_p_head ({unit})",      round(delta_p, 8)),
            ]),
        ]

        setup_cell_map = {}
        curr_row = 3  # row 1 is Title, row 2 is blank spacer
        ws_setup.row_dimensions[2].height = 12

        for sec_idx, (sec_title, items) in enumerate(setup_sections):
            if sec_idx > 0:
                # Add blank spacer between tables
                ws_setup.row_dimensions[curr_row].height = 12
                curr_row += 1

            # Sub-table header banner
            ws_setup.row_dimensions[curr_row].height = 24
            H_sec(ws_setup, curr_row, 1, sec_title)
            c_sec2 = ws_setup.cell(row=curr_row, column=2)
            c_sec2.fill = fill_section
            c_sec2.border = box_border
            ws_setup.merge_cells(start_row=curr_row, start_column=1, end_row=curr_row, end_column=2)
            curr_row += 1

            # Items in sub-table
            for item_idx, (label, val) in enumerate(items):
                ws_setup.row_dimensions[curr_row].height = 22
                S(ws_setup, curr_row, 1, label)
                is_alt = (item_idx % 2 == 1)
                # User values in Column B are aligned center
                V(ws_setup, curr_row, 2, val, align="center", is_alt=is_alt)
                setup_cell_map[label] = f"Setup!$B${curr_row}"
                curr_row += 1

        ws_setup.column_dimensions["A"].width = 38
        ws_setup.column_dimensions["B"].width = 28

        # ── Sheet 2: Calculation Sheet ───────────────────────────────────────
        ws_calc = wb.create_sheet("Calculation Sheet")
        ws_calc.views.sheetView[0].showGridLines = True
        ws_calc.row_dimensions[1].height = 28
        H_title(ws_calc, 1, 1, "CALCULATION SHEET — DKD-R 6-1 Full Formula Chain (ISO 1217 + DKD-R 6-1)")
        ws_calc.merge_cells("A1:Z1")

        ws_calc.row_dimensions[2].height = 20
        c_sub = ws_calc.cell(row=2, column=1,
            value=(f"Constants: T={T_avg}°C | RH={H_avg}% | P_atm={P_atm} hPa | "
                   f"rho_f={rho_f} kg/m³ | h={h_diff} m | UCF={UCF} Pa/{unit} | "
                   f"delta_p_head={round(delta_p,8)} {unit} | MPE={round(mpe,6)} {unit}"))
        c_sub.font = Font(italic=True, size=8.5, color=TEXT_MUTED, name="Calibri")
        c_sub.alignment = Alignment(horizontal="left", vertical="center", indent=1)
        ws_calc.merge_cells("A2:Z2")

        # Column index constants - Table 1
        COL_PCT  = 1;  COL_NOM  = 2;  COL_T    = 3;  COL_RH   = 4;  COL_PATM = 5
        COL_PSAT = 6;  COL_PV   = 7;  COL_PD   = 8;  COL_TK   = 9;  COL_RHOA = 10
        COL_DPH  = 11
        BASE_M   = 12

        n_series  = len(self.m_series)
        COL_PSTD  = BASE_M + 2 * n_series
        COL_MEAN  = COL_PSTD + 1;  COL_ERR  = COL_MEAN + 1;  COL_HF   = COL_ERR  + 1

        # Column index constants - Table 2
        T2_COL_PCT  = 1
        T2_COL_NOM  = 2
        T2_COL_USTD = 3
        T2_COL_URES = 4
        T2_COL_UF0  = 5
        T2_COL_UH   = 6
        T2_COL_UBP  = 7
        T2_COL_UB   = 8
        T2_COL_UC   = 9
        T2_COL_U    = 10
        T2_COL_PASS = 11

        # Row 3: Section Banner for Table 1
        ws_calc.row_dimensions[3].height = 24
        H_sec(ws_calc, 3, 1, "TABEL 1: DATA PENGUKURAN, KOREKSI FISIK & DEVIASI KALIBRASI (DKD-R 6-1)")
        ws_calc.merge_cells(f"A3:{get_column_letter(COL_HF)}3")

        # Row 4: Clean, uncluttered column headers for Table 1
        ws_calc.row_dimensions[4].height = 32
        HC(ws_calc, 4, COL_PCT,  "Setpoint\n(%)")
        HC(ws_calc, 4, COL_NOM,  f"Nominal\n({unit})")
        HC(ws_calc, 4, COL_T,    "T_avg\n(°C)")
        HC(ws_calc, 4, COL_RH,   "RH_avg\n(%)")
        HC(ws_calc, 4, COL_PATM, "P_atm\n(hPa)")
        HC(ws_calc, 4, COL_PSAT, "p_sat\n(Pa)")
        HC(ws_calc, 4, COL_PV,   "p_v\n(Pa)")
        HC(ws_calc, 4, COL_PD,   "p_d\n(Pa)")
        HC(ws_calc, 4, COL_TK,   "T_amb\n(K)")
        HC(ws_calc, 4, COL_RHOA, "ρ_air\n(kg/m³)")
        HC(ws_calc, 4, COL_DPH,  f"Δp_head\n({unit})")
        for i, m in enumerate(self.m_series):
            HC(ws_calc, 4, BASE_M + i,            f"Master {m}\n({unit})")
            HC(ws_calc, 4, BASE_M + n_series + i, f"UUT {m}\n({unit})")
        HC(ws_calc, 4, COL_PSTD, f"P_std\n({unit})")
        HC(ws_calc, 4, COL_MEAN, f"Mean UUT\n({unit})")
        HC(ws_calc, 4, COL_ERR,  f"Error\n({unit})")
        HC(ws_calc, 4, COL_HF,   f"h_f (Hyst)\n({unit})")

        # Build lookup: pct -> {m -> rec}
        mdata_by_pct: dict = {}
        for m in self.m_series:
            for rec in mdata.get(m, []):
                sp = rec.get('setpoint_pct')
                if sp not in mdata_by_pct:
                    mdata_by_pct[sp] = {}
                mdata_by_pct[sp][m] = rec

        data_start_row = 5
        t1_rows: dict = {}

        for idx_row, rr in enumerate(self.row_results):
            ri = data_start_row + idx_row
            pct = rr.get('pct')
            nom = rr.get('nom_ideal', 0)
            t1_rows[pct] = ri
            ws_calc.row_dimensions[ri].height = 22
            is_alt = (idx_row % 2 == 1)

            def r(col_idx):
                return f"{get_column_letter(col_idx)}{ri}"

            V(ws_calc, ri, COL_PCT,  f"{pct}%", fmt="@", align="center", is_alt=is_alt)
            V(ws_calc, ri, COL_NOM,  nom,       fmt="0.0000", align="right", is_alt=is_alt)
            V(ws_calc, ri, COL_T,    T_avg,     fmt="0.00", align="right", is_alt=is_alt)
            V(ws_calc, ri, COL_RH,   H_avg,     fmt="0.00", align="right", is_alt=is_alt)
            V(ws_calc, ri, COL_PATM, P_atm,     fmt="0.00", align="right", is_alt=is_alt)

            # Formulas Table 1
            F(ws_calc, ri, COL_PSAT, f"=611.2*EXP(17.502*{r(COL_T)}/(240.97+{r(COL_T)}))", fmt="0.0000", align="right", is_alt=is_alt)
            F(ws_calc, ri, COL_PV,   f"=({r(COL_RH)}/100)*{r(COL_PSAT)}", fmt="0.0000", align="right", is_alt=is_alt)
            F(ws_calc, ri, COL_PD,   f"=({r(COL_PATM)}*100)-{r(COL_PV)}", fmt="0.0000", align="right", is_alt=is_alt)
            F(ws_calc, ri, COL_TK,   f"={r(COL_T)}+273.15", fmt="0.00", align="right", is_alt=is_alt)
            F(ws_calc, ri, COL_RHOA, f"={r(COL_PD)}/(287.058*{r(COL_TK)})+{r(COL_PV)}/(461.495*{r(COL_TK)})", fmt="0.000000", align="right", is_alt=is_alt)
            F(ws_calc, ri, COL_DPH,  f"=({rho_f}-{r(COL_RHOA)})*9.80665*{h_diff}/{UCF}", fmt="0.00000000", align="right", is_alt=is_alt)

            # Raw readings
            sp_recs = mdata_by_pct.get(pct, {})
            master_refs: List[str] = []
            uut_refs:    List[str] = []
            for i, m in enumerate(self.m_series):
                rec = sp_recs.get(m, {})
                mc = BASE_M + i
                uc = BASE_M + n_series + i
                V(ws_calc, ri, mc, rec.get('reading_master'), fmt="0.0000", align="right", is_alt=is_alt)
                V(ws_calc, ri, uc, rec.get('reading_uut'),    fmt="0.0000", align="right", is_alt=is_alt)
                master_refs.append(f"{get_column_letter(mc)}{ri}")
                uut_refs.append(f"{get_column_letter(uc)}{ri}")

            # P_std formula
            if master_refs:
                calibrator_type = self.setup.get('calibrator_type')
                if calibrator_type == 'DWT':
                    alpha_beta = self.setup.get('alpha_beta', 0)
                    rho_m = self.setup.get('rho_m', 8000)
                    lambda_val = self.setup.get('lambda_val', 0)
                    avg_master_formula = f"AVERAGE({','.join(master_refs)})"
                    buoyancy_term = f"(1-{r(COL_RHOA)}/{rho_m})/(1-1.2/{rho_m})"
                    temp_term = f"(1+{alpha_beta}*({r(COL_T)}-20))"
                    def_term = f"(1+{lambda_val}*({avg_master_formula}*{UCF}))"
                    p_actual_dwt_formula = f"({avg_master_formula}*{buoyancy_term})/({temp_term}*{def_term})"
                    F(ws_calc, ri, COL_PSTD, f"={p_actual_dwt_formula}-{r(COL_DPH)}", fmt="0.000000", align="right", is_alt=is_alt)
                else:
                    F(ws_calc, ri, COL_PSTD, f"=AVERAGE({','.join(master_refs)})-{r(COL_DPH)}", fmt="0.000000", align="right", is_alt=is_alt)

            # Mean UUT
            if uut_refs:
                if seq == 'C':
                    mean_f = f"=AVERAGE({','.join(uut_refs)})"
                elif seq == 'B' and len(uut_refs) >= 3:
                    mean_f = f"=(({uut_refs[0]}+{uut_refs[2]})/2+{uut_refs[1]})/2"
                elif seq == 'A' and len(uut_refs) >= 6:
                    mean_f = (f"=(({uut_refs[0]}+{uut_refs[2]}+{uut_refs[4]})/3"
                              f"+({uut_refs[1]}+{uut_refs[3]}+{uut_refs[5]})/3)/2")
                else:
                    mean_f = f"=AVERAGE({','.join(uut_refs)})"
                F(ws_calc, ri, COL_MEAN, mean_f, fmt="0.000000", align="right", is_alt=is_alt)

            # Error
            F(ws_calc, ri, COL_ERR, f"={r(COL_MEAN)}-{r(COL_PSTD)}", fmt="0.000000", align="right", is_alt=is_alt)

            # h_f = |M_descending - M_ascending|
            if len(uut_refs) >= 2:
                F(ws_calc, ri, COL_HF, f"=ABS({uut_refs[1]}-{uut_refs[0]})", fmt="0.000000", align="right", is_alt=is_alt)
            else:
                V(ws_calc, ri, COL_HF, 0, fmt="0.000000", align="right", is_alt=is_alt)

        # ── Table 2: Uncertainty Budget (DKD-R 6-1) ───────────────────────────
        t1_last_row = data_start_row + len(self.row_results) - 1
        t2_banner_row = t1_last_row + 3  # 2 blank rows separation
        ws_calc.row_dimensions[t2_banner_row - 1].height = 18
        ws_calc.row_dimensions[t2_banner_row].height = 24

        H_sec(ws_calc, t2_banner_row, 1, "TABEL 2: ANGGARAN KETIDAKPASTIAN PENGUKURAN (UNCERTAINTY BUDGET - DKD-R 6-1)")
        ws_calc.merge_cells(f"A{t2_banner_row}:{get_column_letter(T2_COL_PASS)}{t2_banner_row}")

        t2_hdr_row = t2_banner_row + 1
        ws_calc.row_dimensions[t2_hdr_row].height = 32

        # Clean, modern Table 2 headers (readable, no messy clutter)
        HC(ws_calc, t2_hdr_row, T2_COL_PCT,  "Setpoint\n(%)")
        HC(ws_calc, t2_hdr_row, T2_COL_NOM,  f"Nominal\n({unit})")
        HC(ws_calc, t2_hdr_row, T2_COL_USTD, f"u_std\n({unit})")
        HC(ws_calc, t2_hdr_row, T2_COL_URES, f"u_res\n({unit})")
        HC(ws_calc, t2_hdr_row, T2_COL_UF0,  f"u_f0\n({unit})")
        HC(ws_calc, t2_hdr_row, T2_COL_UH,   f"u_h\n({unit})")
        HC(ws_calc, t2_hdr_row, T2_COL_UBP,  f"u_b' (Repeat)\n({unit})")
        HC(ws_calc, t2_hdr_row, T2_COL_UB,   f"u_b (Reprod)\n({unit})")
        HC(ws_calc, t2_hdr_row, T2_COL_UC,   f"u_c (Comb)\n({unit})")
        HC(ws_calc, t2_hdr_row, T2_COL_U,    f"U (k=2)\n({unit})")
        HC(ws_calc, t2_hdr_row, T2_COL_PASS, "Compliance\nStatus")

        t2_rows: dict = {}
        for idx, rr in enumerate(self.row_results):
            ri2 = t2_hdr_row + 1 + idx
            pct = rr.get('pct')
            t2_rows[pct] = ri2
            r1 = t1_rows.get(pct, ri2)
            ws_calc.row_dimensions[ri2].height = 22
            is_alt = (idx % 2 == 1)

            V(ws_calc, ri2, T2_COL_PCT,  f"{pct}%", fmt="@", align="center", is_alt=is_alt)
            F(ws_calc, ri2, T2_COL_NOM,  f"={get_column_letter(COL_NOM)}{r1}", fmt="0.0000", align="right", is_alt=is_alt)

            # Dynamic u_std formula referencing Setup sheet
            if cal_type == 'DWT':
                f_ustd = f"={setup_cell_map.get('u_std Certificate (DWT)', 'Setup!$B$22')}/2"
            else:
                c_acc = setup_cell_map.get('Std Accuracy (%)', 'Setup!$B$23')
                c_fs  = setup_cell_map.get('Std Full Scale', 'Setup!$B$22')
                f_ustd = f"=(({c_acc}/100)*{c_fs})/SQRT(3)"
            F(ws_calc, ri2, T2_COL_USTD, f_ustd, fmt="0.000000", align="right", is_alt=is_alt)

            # Dynamic u_res formula referencing Setup sheet
            c_res = setup_cell_map.get('Resolution', 'Setup!$B$17')
            F(ws_calc, ri2, T2_COL_URES, f"={c_res}/(2*SQRT(3))", fmt="0.000000", align="right", is_alt=is_alt)

            # Dynamic u_f0 formula referencing Setup sheet
            c_f0 = setup_cell_map.get('Zero Deviation f0', 'Setup!$B$24')
            F(ws_calc, ri2, T2_COL_UF0,  f"={c_f0}/(2*SQRT(3))", fmt="0.000000", align="right", is_alt=is_alt)

            # Dynamic u_h formula referencing Table 1 h_f
            F(ws_calc, ri2, T2_COL_UH,
              f"={get_column_letter(COL_HF)}{r1}/(2*SQRT(3))",
              fmt="0.000000", align="right", is_alt=is_alt)

            # Dynamic u_b' (Repeatability)
            if seq == 'B' and len(self.m_series) >= 3:
                c_m1 = f"{get_column_letter(BASE_M + n_series + 0)}{r1}"
                c_m3 = f"{get_column_letter(BASE_M + n_series + 2)}{r1}"
                F(ws_calc, ri2, T2_COL_UBP, f"=ABS({c_m3}-{c_m1})/(2*SQRT(3))", fmt="0.000000", align="right", is_alt=is_alt)
            elif seq == 'C':
                F(ws_calc, ri2, T2_COL_UBP, "=0", fmt="0.000000", align="right", is_alt=is_alt)
            else:
                ubp_val = rr.get('u_b_prime', 0) or 0
                if ubp_val == 0:
                    F(ws_calc, ri2, T2_COL_UBP, "=0", fmt="0.000000", align="right", is_alt=is_alt)
                else:
                    V(ws_calc, ri2, T2_COL_UBP, ubp_val, fmt="0.000000", align="right", is_alt=is_alt)

            # Dynamic u_b (Reproducibility)
            if seq in ('B', 'C'):
                F(ws_calc, ri2, T2_COL_UB, "=0", fmt="0.000000", align="right", is_alt=is_alt)
            else:
                ub_val = rr.get('u_b', 0) or 0
                if ub_val == 0:
                    F(ws_calc, ri2, T2_COL_UB, "=0", fmt="0.000000", align="right", is_alt=is_alt)
                else:
                    V(ws_calc, ri2, T2_COL_UB, ub_val, fmt="0.000000", align="right", is_alt=is_alt)

            c_ustd = f"{get_column_letter(T2_COL_USTD)}{ri2}"
            c_ures = f"{get_column_letter(T2_COL_URES)}{ri2}"
            c_uf0  = f"{get_column_letter(T2_COL_UF0)}{ri2}"
            c_uh   = f"{get_column_letter(T2_COL_UH)}{ri2}"
            c_ubp  = f"{get_column_letter(T2_COL_UBP)}{ri2}"
            c_ub   = f"{get_column_letter(T2_COL_UB)}{ri2}"
            F(ws_calc, ri2, T2_COL_UC,
              f"=SQRT({c_ustd}^2+{c_ures}^2+{c_uf0}^2+{c_uh}^2+{c_ubp}^2+{c_ub}^2)",
              fmt="0.000000", align="right", is_alt=is_alt)

            c_uc = f"{get_column_letter(T2_COL_UC)}{ri2}"
            F(ws_calc, ri2, T2_COL_U,
              f"=2*{c_uc}",
              fmt="0.000000", align="right", is_alt=is_alt)

            c_err = f"{get_column_letter(COL_ERR)}{r1}"
            c_u   = f"{get_column_letter(T2_COL_U)}{ri2}"
            pf    = rr.get('pass', False)
            F(ws_calc, ri2, T2_COL_PASS,
              f'=IF(ABS({c_err})+{c_u}<={mpe},"PASS","FAIL")',
              fmt="@", bold=True, is_badge=("PASS" if pf else "FAIL"))

        # Column widths for Sheet 2
        base_widths = {
            COL_PCT: 13, COL_NOM: 15, COL_T: 12, COL_RH: 12, COL_PATM: 14,
            COL_PSAT: 16, COL_PV: 14, COL_PD: 14, COL_TK: 12, COL_RHOA: 16,
            COL_DPH: 16, COL_PSTD: 16, COL_MEAN: 16, COL_ERR: 16, COL_HF: 15,
        }
        for ci in range(BASE_M, BASE_M + 2 * n_series):
            base_widths[ci] = 15
        for ci, w in base_widths.items():
            ws_calc.column_dimensions[get_column_letter(ci)].width = w

        # Freeze panes on Calculation Sheet
        ws_calc.freeze_panes = "C5"

        # ── Sheet 3: Certificate (Table 1) — cross-ref Calculation Sheet ────
        ws_cert = wb.create_sheet("Certificate (Table 1)")
        ws_cert.views.sheetView[0].showGridLines = True
        ws_cert.row_dimensions[1].height = 32
        cs = "'Calculation Sheet'"
        cert_headers = [
            "Setpoint (%)", f"Nominal ({unit})", f"P_std ({unit})",
            f"Mean UUT ({unit})", f"Error ({unit})", f"U (k=2) ({unit})", "Status"
        ]
        for ci, h in enumerate(cert_headers, 1):
            HC(ws_cert, 1, ci, h)
        for idx, rr in enumerate(self.row_results):
            ri     = 2 + idx
            pct    = rr.get('pct')
            cr_t1  = t1_rows.get(pct)
            cr_t2  = t2_rows.get(pct)
            pf     = rr.get('pass', False)
            is_alt = (idx % 2 == 1)
            ws_cert.row_dimensions[ri].height = 22

            V(ws_cert, ri, 1, f"{pct}%", align="center", is_alt=is_alt)
            if cr_t1 and cr_t2:
                F(ws_cert, ri, 2, f"={cs}!{get_column_letter(COL_NOM)}{cr_t1}",  fmt="0.0000", align="right", is_alt=is_alt)
                F(ws_cert, ri, 3, f"={cs}!{get_column_letter(COL_PSTD)}{cr_t1}", fmt="0.000000", align="right", is_alt=is_alt)
                F(ws_cert, ri, 4, f"={cs}!{get_column_letter(COL_MEAN)}{cr_t1}", fmt="0.000000", align="right", is_alt=is_alt)
                F(ws_cert, ri, 5, f"={cs}!{get_column_letter(COL_ERR)}{cr_t1}",  fmt="0.000000", align="right", is_alt=is_alt)
                F(ws_cert, ri, 6, f"={cs}!{get_column_letter(T2_COL_U)}{cr_t2}",    fmt="0.000000", align="right", is_alt=is_alt)
                F(ws_cert, ri, 7, f"={cs}!{get_column_letter(T2_COL_PASS)}{cr_t2}", fmt="@",
                  bold=True, is_badge=("PASS" if pf else "FAIL"))
            else:
                V(ws_cert, ri, 2, rr.get('nom_ideal'), '0.0000', align="right", is_alt=is_alt)
                V(ws_cert, ri, 3, rr.get('p_std'),     '0.0000', align="right", is_alt=is_alt)
                V(ws_cert, ri, 4, rr.get('mean'),       '0.0000', align="right", is_alt=is_alt)
                V(ws_cert, ri, 5, rr.get('dev'),        '0.00000', align="right", is_alt=is_alt)
                V(ws_cert, ri, 6, rr.get('U'),          '0.00000', align="right", is_alt=is_alt)
                V(ws_cert, ri, 7, "PASS" if pf else "FAIL", bold=True, is_badge=("PASS" if pf else "FAIL"))
        for ci, w in enumerate([14, 18, 18, 18, 18, 18, 14], 1):
            ws_cert.column_dimensions[get_column_letter(ci)].width = w

        # ── Sheet 4: Uncertainty Budget (Table 2) — cross-ref Calculation Sheet
        ws_unc = wb.create_sheet("Uncertainty Budget (Table 2)")
        ws_unc.views.sheetView[0].showGridLines = True
        ws_unc.row_dimensions[1].height = 32
        unc_headers = [
            "Setpoint (%)", f"u_std ({unit})", f"u_res ({unit})",
            f"u_f0 ({unit})", f"u_h ({unit})", f"u_b' ({unit})",
            f"u_b ({unit})", f"u_c ({unit})", f"U (k=2) ({unit})"
        ]
        for ci, h in enumerate(unc_headers, 1):
            HC(ws_unc, 1, ci, h)
        for idx, rr in enumerate(self.row_results):
            ri    = 2 + idx
            pct   = rr.get('pct')
            cr_t2 = t2_rows.get(pct)
            is_alt = (idx % 2 == 1)
            ws_unc.row_dimensions[ri].height = 22

            V(ws_unc, ri, 1, f"{pct}%", align="center", is_alt=is_alt)
            if cr_t2:
                F(ws_unc, ri, 2, f"={cs}!{get_column_letter(T2_COL_USTD)}{cr_t2}", fmt="0.000000", align="right", is_alt=is_alt)
                F(ws_unc, ri, 3, f"={cs}!{get_column_letter(T2_COL_URES)}{cr_t2}", fmt="0.000000", align="right", is_alt=is_alt)
                F(ws_unc, ri, 4, f"={cs}!{get_column_letter(T2_COL_UF0)}{cr_t2}",  fmt="0.000000", align="right", is_alt=is_alt)
                F(ws_unc, ri, 5, f"={cs}!{get_column_letter(T2_COL_UH)}{cr_t2}",   fmt="0.000000", align="right", is_alt=is_alt)
                F(ws_unc, ri, 6, f"={cs}!{get_column_letter(T2_COL_UBP)}{cr_t2}",  fmt="0.000000", align="right", is_alt=is_alt)
                F(ws_unc, ri, 7, f"={cs}!{get_column_letter(T2_COL_UB)}{cr_t2}",   fmt="0.000000", align="right", is_alt=is_alt)
                F(ws_unc, ri, 8, f"={cs}!{get_column_letter(T2_COL_UC)}{cr_t2}",   fmt="0.000000", align="right", is_alt=is_alt)
                F(ws_unc, ri, 9, f"={cs}!{get_column_letter(T2_COL_U)}{cr_t2}",    fmt="0.000000", align="right", is_alt=is_alt)
            else:
                V(ws_unc, ri, 2, self.u_std,          '0.00000', align="right", is_alt=is_alt)
                V(ws_unc, ri, 3, self.u_res,          '0.00000', align="right", is_alt=is_alt)
                V(ws_unc, ri, 4, self.u_f0,           '0.00000', align="right", is_alt=is_alt)
                V(ws_unc, ri, 5, rr.get('u_h'),       '0.00000', align="right", is_alt=is_alt)
                V(ws_unc, ri, 6, rr.get('u_b_prime'), '0.00000', align="right", is_alt=is_alt)
                V(ws_unc, ri, 7, rr.get('u_b'),       '0.00000', align="right", is_alt=is_alt)
                V(ws_unc, ri, 8, 0,                   '0.00000', align="right", is_alt=is_alt)
                V(ws_unc, ri, 9, rr.get('U'),         '0.00000', align="right", is_alt=is_alt)
        for ci in range(1, 10):
            ws_unc.column_dimensions[get_column_letter(ci)].width = 17

        # ── Sheet 5: Raw Measurements ────────────────────────────────────────
        ws_raw = wb.create_sheet("Raw Measurements")
        ws_raw.views.sheetView[0].showGridLines = True
        ws_raw.row_dimensions[1].height = 30
        HC(ws_raw, 1, 1, "M-Series");  HC(ws_raw, 1, 2, "Setpoint (%)")
        HC(ws_raw, 1, 3, f"UUT Reading ({unit})");  HC(ws_raw, 1, 4, f"Master Reading ({unit})")
        HC(ws_raw, 1, 5, "Temp (°C)");  HC(ws_raw, 1, 6, "Humidity (%RH)");  HC(ws_raw, 1, 7, "Pressure (hPa)")
        row_idx = 2
        for m in self.m_series:
            for rec in mdata.get(m, []):
                env = rec.get('env') or {}
                is_alt = (row_idx % 2 == 1)
                ws_raw.row_dimensions[row_idx].height = 20
                V(ws_raw, row_idx, 1, m, align="center", is_alt=is_alt)
                V(ws_raw, row_idx, 2, rec.get('setpoint_pct'), align="center", is_alt=is_alt)
                V(ws_raw, row_idx, 3, rec.get('reading_uut'),    '0.0000', align="right", is_alt=is_alt)
                V(ws_raw, row_idx, 4, rec.get('reading_master'), '0.0000', align="right", is_alt=is_alt)
                V(ws_raw, row_idx, 5, env.get('temperature'),    '0.00', align="right", is_alt=is_alt)
                V(ws_raw, row_idx, 6, env.get('humidity'),       '0.00', align="right", is_alt=is_alt)
                V(ws_raw, row_idx, 7, env.get('pressure_atm'),   '0.00', align="right", is_alt=is_alt)
                row_idx += 1
        for ci, w in enumerate([14, 14, 20, 20, 14, 16, 16], 1):
            ws_raw.column_dimensions[get_column_letter(ci)].width = w

        # ── Sheet 6: Summary KPI ─────────────────────────────────────────────
        ws_kpi = wb.create_sheet("Summary")
        ws_kpi.views.sheetView[0].showGridLines = True
        ws_kpi.row_dimensions[1].height = 28
        overall_pass = all(r.get('pass', False) for r in self.row_results)
        max_U   = max((r.get('U', 0) for r in self.row_results), default=0)
        max_err = max((abs(r.get('dev', 0)) for r in self.row_results), default=0)

        H_title(ws_kpi, 1, 1, "ALITION — DKD-R 6-1 Calibration Summary & KPI")
        c_kpi_t2 = ws_kpi.cell(row=1, column=2)
        c_kpi_t2.fill = fill_title
        c_kpi_t2.border = box_border
        ws_kpi.merge_cells("A1:B1")

        mpe_pct = self.setup.get('mpe_percent')
        mpe_pct_str = f"{mpe_pct}%" if mpe_pct is not None else "-"
        range_str = f"{lrv} .. {urv} {unit}" if unit else f"{lrv} .. {urv}"

        kpi_sections = [
            ("1. INFORMASI INSTRUMEN & SESI KALIBRASI", [
                ("Instrument / UUT",            self.meta.get('instrument_model', '-'), None),
                ("Tag Number",                  self.meta.get('tag_number', '-'), None),
                ("Serial Number",               self.meta.get('serial_number', '-'), None),
                ("Operator",                    self.meta.get('operator_name', '-'), None),
                ("Date",                        self.meta.get('date', '-'), None),
                ("Location",                    self.meta.get('location', '-'), None),
                ("Calibration Standard",        "DKD-R 6-1", None),
                ("Sequence",                    f"Seq {seq}", None),
            ]),
            ("2. SPESIFIKASI & BATAS TOLERANSI (MPE)", [
                ("Pressure Unit",               unit if unit else "-", None),
                ("Range / Span",                range_str, None),
                ("MPE (%FS)",                   mpe_pct_str, None),
                (f"MPE Value ({unit})" if unit else "MPE Value", round(mpe, 6) if mpe else 0, "0.0000"),
            ]),
            ("3. INDIKATOR KINERJA UTAMA (KPI) & KEPUTUSAN", [
                (f"Max Deviation / Error ({unit})" if unit else "Max Deviation / Error", round(max_err, 6), "0.0000"),
                (f"Max Uncertainty U (k=2) ({unit})" if unit else "Max Uncertainty U (k=2)", round(max_U, 6), "0.00000"),
                ("Evaluation Criterion",        "|Error| + U <= MPE", None),
                ("Overall Result",              "PASS" if overall_pass else "FAIL", None),
            ]),
        ]

        curr_kpi_row = 3  # row 1 is Title, row 2 is blank spacer
        ws_kpi.row_dimensions[2].height = 12

        for sec_idx, (sec_title, items) in enumerate(kpi_sections):
            if sec_idx > 0:
                ws_kpi.row_dimensions[curr_kpi_row].height = 12
                curr_kpi_row += 1

            # Sub-table header banner
            ws_kpi.row_dimensions[curr_kpi_row].height = 24
            H_sec(ws_kpi, curr_kpi_row, 1, sec_title)
            c_sec2 = ws_kpi.cell(row=curr_kpi_row, column=2)
            c_sec2.fill = fill_section
            c_sec2.border = box_border
            ws_kpi.merge_cells(start_row=curr_kpi_row, start_column=1, end_row=curr_kpi_row, end_column=2)
            curr_kpi_row += 1

            for item_idx, (label, val, num_fmt) in enumerate(items):
                is_result = (label == "Overall Result")
                ws_kpi.row_dimensions[curr_kpi_row].height = 26 if is_result else 22
                S(ws_kpi, curr_kpi_row, 1, label)
                is_alt = (item_idx % 2 == 1)

                if is_result:
                    V(ws_kpi, curr_kpi_row, 2, val, align="center", is_badge=("PASS" if overall_pass else "FAIL"))
                else:
                    V(ws_kpi, curr_kpi_row, 2, val, fmt=num_fmt, align="center", is_alt=is_alt)
                curr_kpi_row += 1

        ws_kpi.column_dimensions["A"].width = 38
        ws_kpi.column_dimensions["B"].width = 28

        wb.save(filename)

