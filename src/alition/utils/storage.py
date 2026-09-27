from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from ..models import CalibrationInput, CalibrationResult


def _model_dump(model: Any) -> Dict[str, Any]:
    """Serialize a Pydantic model to dict — works with both v1 and v2."""
    if hasattr(model, "model_dump"):        # Pydantic v2
        return model.model_dump()
    return model.dict()                     # Pydantic v1 (fallback)


def _get_history_dir() -> str:
    """
    Selalu kembalikan path history di %APPDATA%/AlitionPro/history.
    Ini memastikan:
    - Data tersimpan permanen walau app di-close / reopen.
    - Data TIDAK ikut serta saat file .exe dibagikan ke PC lain.
    - Tidak terpengaruh oleh temp folder PyInstaller (_MEIPASS).
    """
    app_data = os.environ.get("APPDATA", os.path.expanduser("~"))
    history_dir = os.path.join(app_data, "AlitionPro", "history")
    return history_dir


class StorageManager:
    @staticmethod
    def _ensure_dir():
        history_dir = _get_history_dir()
        if not os.path.exists(history_dir):
            os.makedirs(history_dir)

    @staticmethod
    def save_session(input_data: CalibrationInput, result_data: CalibrationResult, target_filepath: Optional[str] = None, session_trend_log: Optional[List] = None) -> str:
        StorageManager._ensure_dir()
        history_dir = _get_history_dir()

        if target_filepath and os.path.isabs(target_filepath):
            filepath = target_filepath
        else:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            model_name = "Unknown"
            if input_data.metadata and input_data.metadata.instrument_model:
                model_name = input_data.metadata.instrument_model.replace(" ", "_")

            # Clean string for filename
            keepcharacters = ('_', '.')
            model_name = "".join(c for c in model_name if c.isalnum() or c in keepcharacters).rstrip()

            filename = f"cal_{timestamp}_{model_name}.json"
            filepath = os.path.join(history_dir, filename)

        data = {
            "version": "2.0.0",
            "timestamp": datetime.now().isoformat(),
            "input": _model_dump(input_data),
            "result": _model_dump(result_data),
            "session_trend_log": session_trend_log or []
        }

        # Pertahankan metadata import jika file aslinya adalah file hasil import
        if target_filepath and os.path.exists(target_filepath):
            try:
                with open(target_filepath, 'r', encoding='utf-8') as f:
                    old_data = json.load(f)
                    if old_data.get("is_imported"):
                        data["is_imported"] = old_data.get("is_imported", False)
                        data["imported_at"] = old_data.get("imported_at")
                        data["imported_by"] = old_data.get("imported_by", "Unknown")
            except Exception:
                pass

        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=4)

        return filepath

    @staticmethod
    def save_dkd_session(dkd_payload: dict, target_filepath: Optional[str] = None) -> str:
        """
        Simpan sesi DKD-R 6-1 ke folder history.
        Format file berisi key 'dkd_data' (payload lengkap) + shim 'input'/'result'
        agar get_history_list() bisa membacanya tanpa perubahan.
        """
        StorageManager._ensure_dir()
        history_dir = _get_history_dir()

        meta = dkd_payload.get('meta') or {}
        model_name = meta.get('instrument_model', 'Unknown').replace(' ', '_')
        keepcharacters = ('_', '.')
        model_name = ''.join(c for c in model_name if c.isalnum() or c in keepcharacters).rstrip()

        if target_filepath and os.path.isabs(target_filepath):
            filepath = target_filepath
        else:
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            filename = f'dkd_{timestamp}_{model_name}.json'
            filepath = os.path.join(history_dir, filename)

        # Determine overall status from rowResults
        row_results = dkd_payload.get('rowResults') or []
        overall_status = 'PASS' if row_results and all(r.get('pass', False) for r in row_results) else 'FAIL'

        # Shim 'input' and 'result' for history list compatibility
        shim_input = {
            'metadata': {
                'operator_name':       meta.get('operator_name', ''),
                'instrument_model':    meta.get('instrument_model', ''),
                'serial_number':       meta.get('serial_number', ''),
                'tag_number':          meta.get('tag_number', ''),
                'date':                meta.get('date', ''),
                'location':            meta.get('location', ''),
                'calibration_standard': 'DKD-R 6-1',
            },
            'lrv':           (dkd_payload.get('setup') or {}).get('lrv', 0),
            'urv':           (dkd_payload.get('setup') or {}).get('urv', 100),
            'tolerance_pct': (dkd_payload.get('setup') or {}).get('mpe_percent', 0),
            'points':        [],
        }
        shim_result = {'overall_status': overall_status}

        data = {
            'version':   '2.0.0',
            'timestamp': datetime.now().isoformat(),
            'input':     shim_input,
            'result':    shim_result,
            'dkd_data':  dkd_payload,   # full DKD payload for reload
            'session_trend_log': dkd_payload.get('session_trend_log') or [],
        }

        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=4, ensure_ascii=False)

        return filepath

    @staticmethod
    def get_history_list() -> List[Dict]:
        StorageManager._ensure_dir()
        history_dir = _get_history_dir()
        histories = []
        for filename in os.listdir(history_dir):
            if filename.endswith(".json"):
                filepath = os.path.join(history_dir, filename)
                try:
                    with open(filepath, 'r', encoding='utf-8') as f:
                        data = json.load(f)

                    inp  = data.get("input", {})
                    res  = data.get("result", {})
                    meta = inp.get("metadata", {}) or {}
                    if "dkd_data" in data:
                        dkd_meta = data["dkd_data"].get("meta", {}) or {}
                        if not meta.get("serial_number"):
                            meta["serial_number"] = dkd_meta.get("serial_number", "")
                        if not meta.get("tag_number"):
                            meta["tag_number"] = dkd_meta.get("tag_number", "")

                    is_dkd = "dkd_data" in data

                    histories.append({
                        "filename":             filename,
                        "filepath":             filepath,
                        "date":                 meta.get("date", data.get("timestamp", "N/A")[:10]),
                        "operator":             meta.get("operator_name", "Unknown"),
                        "model":                meta.get("instrument_model", "Unknown"),
                        "serial_number":        meta.get("serial_number", ""),
                        "tag_number":           meta.get("tag_number", ""),
                        "location":             meta.get("location", ""),
                        "calibration_standard": meta.get("calibration_standard", "Default"),
                        "status":               res.get("overall_status", "UNKNOWN"),
                        "raw_timestamp":        data.get("timestamp", ""),
                        "is_imported":          data.get("is_imported", False),
                        "imported_at":          data.get("imported_at", ""),
                        "imported_by":          data.get("imported_by", ""),
                        "set_points":           [p.get("set_point") for p in inp.get("points", [])],
                        "is_dkd":               is_dkd,
                        "dkd_sequence":         data["dkd_data"].get("sequence", "A") if is_dkd else None,
                        "dkd_setpoints":        data["dkd_data"].get("setpoints", []) if is_dkd else []
                    })
                except Exception:
                    continue

        histories.sort(key=lambda x: x["raw_timestamp"], reverse=True)
        return histories

    @staticmethod
    def generate_certificate_number(date_str: Optional[str] = None) -> str:
        """
        Generate auto certificate number: ALT/CAL/YYYY/MM/NNNN (Format A)
        Counts existing saved calibration sessions for this YYYY/MM.
        """
        now = datetime.now()
        if date_str:
            try:
                dt = datetime.strptime(date_str[:10], "%Y-%m-%d")
            except Exception:
                dt = now
        else:
            dt = now

        year_str = dt.strftime("%Y")
        month_str = dt.strftime("%m")
        prefix = f"ALT/CAL/{year_str}/{month_str}/"

        histories = StorageManager.get_history_list()
        count = 0
        for h in histories:
            h_date = str(h.get("date", ""))
            if h_date.startswith(f"{year_str}-{month_str}"):
                count += 1

        next_seq = count + 1
        return f"{prefix}{next_seq:04d}"

    @staticmethod
    def load_session(filepath: str) -> Optional[Tuple[CalibrationInput, CalibrationResult]]:
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                data = json.load(f)

            cal_input = CalibrationInput(**data["input"])
            cal_result = CalibrationResult(**data["result"])
            return cal_input, cal_result
        except Exception:
            return None

    @staticmethod
    def delete_session(filepath: str) -> bool:
        try:
            if os.path.exists(filepath):
                os.remove(filepath)
                return True
            return False
        except Exception:
            return False

    @staticmethod
    def load_raw_session(filepath: str) -> Optional[Dict]:
        try:
            if not os.path.exists(filepath):
                return None
            with open(filepath, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return None

    @staticmethod
    def get_instruments_summary() -> List[Dict]:
        """
        Group all calibration history sessions by serial_number.
        Returns a list of unique instruments with lifecycle metrics.
        """
        histories = StorageManager.get_history_list()
        instruments_map: Dict[str, List[Dict]] = {}

        for h in histories:
            sn = (h.get("serial_number") or "").strip()
            if not sn:
                sn = f"UNKNOWN-{(h.get('model') or 'Instrument').replace(' ', '_')}"
            if sn not in instruments_map:
                instruments_map[sn] = []
            instruments_map[sn].append(h)

        result = []
        for sn, sessions in instruments_map.items():
            sessions.sort(key=lambda s: s.get("raw_timestamp", ""), reverse=False)

            first_s = sessions[0]
            last_s = sessions[-1]

            last_loaded = StorageManager.load_raw_session(last_s["filepath"])
            specs = {"lrv": 0.0, "urv": 100.0, "unit": "bar", "mpe_percent": 0.5, "resolution": 0.01}
            standard_name = last_s.get("calibration_standard", "Default")

            if last_loaded:
                if "dkd_data" in last_loaded and isinstance(last_loaded["dkd_data"], dict):
                    su = last_loaded["dkd_data"].get("setup", {}) or {}
                    specs["lrv"] = float(su.get("lrv", 0.0))
                    specs["urv"] = float(su.get("urv", 100.0))
                    specs["unit"] = str(su.get("input_unit", "bar"))
                    specs["mpe_percent"] = float(su.get("mpe_percent", 0.5))
                    specs["resolution"] = float(su.get("resolution", 0.01))
                    specs["sequence"] = str(last_loaded["dkd_data"].get("sequence", "A"))
                    specs["setpoints"] = last_loaded["dkd_data"].get("setpoints", [])
                    standard_name = "DKD-R 6-1"
                elif "input" in last_loaded and isinstance(last_loaded["input"], dict):
                    inp = last_loaded["input"]
                    specs["lrv"] = float(inp.get("lrv", 0.0))
                    specs["urv"] = float(inp.get("urv", 100.0))
                    specs["unit"] = "bar"
                    specs["mpe_percent"] = float(inp.get("tolerance_pct", 0.5))
                    specs["resolution"] = 0.01

            result.append({
                "serial_number": sn,
                "display_serial": "" if sn.startswith("UNKNOWN-") else sn,
                "model": last_s.get("model", "Unknown"),
                "tag_number": last_s.get("tag_number", ""),
                "calibration_count": len(sessions),
                "first_date": first_s.get("date", ""),
                "last_date": last_s.get("date", ""),
                "last_status": last_s.get("status", "UNKNOWN"),
                "last_operator": last_s.get("operator", "Unknown"),
                "last_location": last_s.get("location", ""),
                "last_standard": standard_name,
                "last_filepath": last_s.get("filepath", ""),
                "last_sequence": specs.get("sequence") or last_s.get("dkd_sequence") or "A",
                "specs": specs,
                "sessions_brief": [
                    {
                        "filename": s["filename"],
                        "filepath": s["filepath"],
                        "date": s["date"],
                        "raw_timestamp": s["raw_timestamp"],
                        "operator": s["operator"],
                        "location": s["location"],
                        "status": s["status"],
                        "standard": s.get("calibration_standard", "Default"),
                        "sequence": s.get("dkd_sequence") or "A",
                        "is_imported": s.get("is_imported", False),
                        "imported_by": s.get("imported_by", "")
                    }
                    for s in sessions
                ]
            })

        result.sort(key=lambda x: x["last_date"], reverse=True)
        return result

    @staticmethod
    def get_instrument_history_details(serial_number: str) -> Dict[str, Any]:
        """
        Extract multi-session drift metrics and point results for an instrument.
        """
        histories = StorageManager.get_history_list()
        matching_sessions = []
        for h in histories:
            sn = (h.get("serial_number") or "").strip()
            if not sn and serial_number.startswith("UNKNOWN-"):
                if f"UNKNOWN-{(h.get('model') or 'Instrument').replace(' ', '_')}" == serial_number:
                    matching_sessions.append(h)
            elif sn == serial_number:
                matching_sessions.append(h)

        matching_sessions.sort(key=lambda s: s.get("raw_timestamp", ""), reverse=False)

        parsed_sessions = []
        all_setpoints = set()

        for s in matching_sessions:
            raw = StorageManager.load_raw_session(s["filepath"])
            if not raw:
                continue

            session_date = s.get("date", "")
            session_entry = {
                "filename": s["filename"],
                "filepath": s["filepath"],
                "date": session_date,
                "raw_timestamp": s["raw_timestamp"],
                "operator": s["operator"],
                "location": s["location"],
                "status": s["status"],
                "standard": s.get("calibration_standard", "Default"),
                "sequence": s.get("dkd_sequence") or "A",
                "is_imported": s.get("is_imported", False),
                "imported_by": s.get("imported_by", ""),
                "points": [],
                "raw_rows": [],
                "setup": {},
                "zero_error": 0.0,
                "max_error": 0.0,
                "max_U": 0.0,
                "hysteresis_max": 0.0
            }

            if "dkd_data" in raw and isinstance(raw["dkd_data"], dict):
                dkd = raw["dkd_data"]
                row_res = dkd.get("rowResults", []) or []
                setup = dkd.get("setup", {}) or {}
                span = abs((setup.get("urv", 100) - setup.get("lrv", 0))) or 1.0
                mpe_pct = float(setup.get("mpe_percent", 0.5))
                mpe_val = (mpe_pct / 100.0) * span
                seq_val = dkd.get("sequence", s.get("dkd_sequence") or "A")

                session_entry["sequence"] = seq_val
                session_entry["certificate_number"] = dkd.get("cert_number", "")
                session_entry["setup"] = {
                    "lrv": setup.get("lrv", 0.0),
                    "urv": setup.get("urv", 100.0),
                    "unit": setup.get("input_unit", "bar"),
                    "mpe_percent": mpe_pct,
                    "mpe_val": mpe_val,
                    "resolution": setup.get("resolution", 0.01),
                    "sequence": seq_val
                }
                session_entry["raw_rows"] = row_res

                for r in row_res:
                    pct = float(r.get("pct", 0))
                    all_setpoints.add(pct)
                    dev = float(r.get("dev", 0))
                    u_val = float(r.get("U", 0))
                    h_val = float(r.get("h", r.get("u_h", 0)))
                    p_std_val = float(r.get("p_std", r.get("nom_ideal", 0)))

                    # Extract any individual series readings if present
                    series_readings = []
                    for k in ["m1", "m2", "m3", "m4", "m5", "m6"]:
                        if k in r and r[k] is not None:
                            try:
                                series_readings.append(float(r[k]))
                            except (ValueError, TypeError):
                                pass

                    session_entry["points"].append({
                        "setpoint_pct": pct,
                        "nominal": float(r.get("nom_ideal", 0)),
                        "p_std": p_std_val,
                        "reading": float(r.get("mean", 0)),
                        "readings": series_readings,
                        "error": dev,
                        "error_pct_span": (dev / span) * 100,
                        "U": u_val,
                        "h": h_val,
                        "std_dev": float(r.get("s_dev", 0.0)),
                        "mpe_val": mpe_val,
                        "pass": bool(r.get("pass", True))
                    })
                    if pct == 0:
                        session_entry["zero_error"] = dev

                if session_entry["points"]:
                    session_entry["max_error"] = max(abs(p["error"]) for p in session_entry["points"])
                    session_entry["max_U"] = max(p["U"] for p in session_entry["points"])
                    session_entry["hysteresis_max"] = max((float(r.get("h", r.get("u_h", 0))) for r in row_res), default=0.0)

            elif "input" in raw and "result" in raw:
                inp = raw["input"]
                res = raw["result"]
                lrv = float(inp.get("lrv", 0))
                urv = float(inp.get("urv", 100))
                span = abs(urv - lrv) or 1.0
                mpe_pct = float(inp.get("tolerance_pct", 0.5))
                mpe_val = (mpe_pct / 100.0) * span
                pt_res = res.get("point_results", []) or []
                seq_val = inp.get("metadata", {}).get("sequence") or "A"

                session_entry["sequence"] = seq_val
                session_entry["certificate_number"] = raw.get("certificate_number", "")
                session_entry["setup"] = {
                    "lrv": lrv,
                    "urv": urv,
                    "unit": "bar",
                    "mpe_percent": mpe_pct,
                    "mpe_val": mpe_val,
                    "resolution": 0.01,
                    "sequence": seq_val
                }
                session_entry["raw_rows"] = pt_res

                for p in pt_res:
                    sp = float(p.get("set_point", 0))
                    pct = round(((sp - lrv) / span) * 100, 1)
                    all_setpoints.add(pct)
                    err = float(p.get("error", 0))
                    raw_reads = [float(x) for x in p.get("readings", []) if isinstance(x, (int, float))]
                    session_entry["points"].append({
                        "setpoint_pct": pct,
                        "nominal": sp,
                        "p_std": sp,
                        "reading": float(p.get("avg_reading", 0)),
                        "readings": raw_reads,
                        "error": err,
                        "error_pct_span": float(p.get("error_pct_span", (err / span) * 100)),
                        "U": 0.0,
                        "h": 0.0,
                        "std_dev": float(p.get("std_dev", 0.0)),
                        "mpe_val": mpe_val,
                        "pass": p.get("status") == "PASS"
                    })
                    if pct == 0:
                        session_entry["zero_error"] = err

                if session_entry["points"]:
                    session_entry["max_error"] = max(abs(p["error"]) for p in session_entry["points"])

            parsed_sessions.append(session_entry)

        sorted_setpoints = sorted(list(all_setpoints))
        dates_labels = [s["date"] for s in parsed_sessions]

        drift_by_setpoint: Dict[str, List[Optional[float]]] = {str(sp): [] for sp in sorted_setpoints}
        for s in parsed_sessions:
            sp_map = {p["setpoint_pct"]: p["error"] for p in s["points"]}
            for sp in sorted_setpoints:
                val = sp_map.get(sp, None)
                drift_by_setpoint[str(sp)].append(round(val, 5) if val is not None else None)

        zero_drift = [round(s["zero_error"], 5) for s in parsed_sessions]
        max_errors = [round(s["max_error"], 5) for s in parsed_sessions]
        max_uncertainties = [round(s["max_U"], 5) for s in parsed_sessions]
        hysteresis_trend = [round(s["hysteresis_max"], 5) for s in parsed_sessions]

        stability_status = "Stabil"
        if len(parsed_sessions) >= 2:
            zero_diff = abs(zero_drift[-1] - zero_drift[0])
            err_diff = abs(max_errors[-1] - max_errors[0])
            if zero_diff > 0.5 or err_diff > 0.5:
                stability_status = "Pergeseran Signifikan (Perlu Kalibrasi/Adjustment)"
            elif zero_diff > 0.1 or err_diff > 0.1:
                stability_status = "Pergeseran Moderat"
            else:
                stability_status = "Sangat Stabil"

        return {
            "serial_number": serial_number,
            "session_count": len(parsed_sessions),
            "dates": dates_labels,
            "sessions": parsed_sessions,
            "setpoints": sorted_setpoints,
            "drift_by_setpoint": drift_by_setpoint,
            "zero_drift": zero_drift,
            "max_errors": max_errors,
            "max_uncertainties": max_uncertainties,
            "hysteresis_trend": hysteresis_trend,
            "stability_status": stability_status
        }

    @staticmethod
    def export_instrument_bundle(serial_number: str, target_filepath: str) -> bool:
        """
        Export all calibration sessions for this serial_number into a single JSON bundle.
        """
        try:
            histories = StorageManager.get_history_list()
            sessions_data = []
            instrument_model = "Unknown"

            for h in histories:
                sn = (h.get("serial_number") or "").strip()
                match = (sn == serial_number) if serial_number and not serial_number.startswith("UNKNOWN-") else (
                    f"UNKNOWN-{(h.get('model') or 'Instrument').replace(' ', '_')}" == serial_number
                )
                if match:
                    raw = StorageManager.load_raw_session(h["filepath"])
                    if raw:
                        sessions_data.append(raw)
                        instrument_model = h.get("model", instrument_model)

            bundle = {
                "bundle_type": "alition_instrument_history",
                "bundle_version": "1.0",
                "exported_at": datetime.now().isoformat(),
                "serial_number": serial_number,
                "model": instrument_model,
                "session_count": len(sessions_data),
                "sessions": sessions_data
            }

            with open(target_filepath, "w", encoding="utf-8") as f:
                json.dump(bundle, f, indent=4, ensure_ascii=False)
            return True
        except Exception:
            return False

    @staticmethod
    def smart_import(source_filepath: str, imported_by: str = "Unknown") -> Dict[str, Any]:
        """
        Smart import supporting both single session JSON and full instrument packages.
        Executes the 3 conditional scenarios:
        1. New session: auto-merge into instrument timeline with imported_by tags.
        2. Exact duplicate session: skipped.
        3. Specification mismatch warning: recorded in conflicts.
        """
        try:
            with open(source_filepath, 'r', encoding='utf-8') as f:
                payload = json.load(f)

            if isinstance(payload, dict) and payload.get("bundle_type") == "alition_instrument_history":
                sessions_to_import = payload.get("sessions", [])
            elif isinstance(payload, dict) and (('input' in payload and 'result' in payload) or 'dkd_data' in payload):
                sessions_to_import = [payload]
            else:
                return {
                    "success": False,
                    "message": "Format file tidak valid atau bukan berkas riwayat Alition.",
                    "imported_count": 0,
                    "skipped_count": 0,
                    "conflicts": []
                }

            StorageManager._ensure_dir()
            history_dir = _get_history_dir()
            existing_histories = StorageManager.get_history_list()

            imported_count = 0
            skipped_count = 0
            conflicts = []

            for s_data in sessions_to_import:
                inp = s_data.get("input", {})
                meta = inp.get("metadata", {}) or {}
                if "dkd_data" in s_data and isinstance(s_data["dkd_data"], dict):
                    dkd_meta = s_data["dkd_data"].get("meta", {}) or {}
                    if not meta.get("serial_number"):
                        meta["serial_number"] = dkd_meta.get("serial_number", "")
                    if not meta.get("instrument_model"):
                        meta["instrument_model"] = dkd_meta.get("instrument_model", "")

                cur_sn = (meta.get("serial_number") or "").strip()
                cur_date = meta.get("date") or s_data.get("timestamp", "")[:10]
                cur_ts = s_data.get("timestamp", "")

                # Skenario 2: Deteksi Duplikat Identik (Skip)
                is_duplicate = False
                for ex in existing_histories:
                    ex_sn = (ex.get("serial_number") or "").strip()
                    if cur_sn and ex_sn == cur_sn:
                        if ex.get("raw_timestamp") and cur_ts and ex["raw_timestamp"] == cur_ts:
                            is_duplicate = True
                            break
                        if ex.get("date") and cur_date and ex["date"] == cur_date and ex.get("operator") == meta.get("operator_name"):
                            is_duplicate = True
                            break

                if is_duplicate:
                    skipped_count += 1
                    continue

                # Skenario 3: Peringatan Benturan Spesifikasi
                for ex in existing_histories:
                    ex_sn = (ex.get("serial_number") or "").strip()
                    if cur_sn and ex_sn == cur_sn:
                        ex_model = ex.get("model", "")
                        cur_model = meta.get("instrument_model", "")
                        if ex_model and cur_model and ex_model.lower() != cur_model.lower():
                            conflicts.append(f"Serial {cur_sn}: Model berbeda ({cur_model} vs {ex_model})")

                # Skenario 1: Simpan Sesi Baru dan Tandai Tag Import
                s_data["is_imported"] = True
                s_data["imported_at"] = datetime.now().isoformat()
                s_data["imported_by"] = imported_by

                ts_clean = datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:19]
                model_name = (meta.get("instrument_model") or "Instrument").replace(" ", "_")
                keepcharacters = ('_', '.')
                model_name = ''.join(c for c in model_name if c.isalnum() or c in keepcharacters).rstrip()
                prefix = "dkd" if "dkd_data" in s_data else "cal"
                dest_filename = f"imported_{prefix}_{ts_clean}_{model_name}.json"
                dest_path = os.path.join(history_dir, dest_filename)

                with open(dest_path, 'w', encoding='utf-8') as f:
                    json.dump(s_data, f, indent=4, ensure_ascii=False)

                imported_count += 1

            msg_parts = []
            if imported_count > 0:
                msg_parts.append(f"{imported_count} sesi berhasil digabungkan")
            if skipped_count > 0:
                msg_parts.append(f"{skipped_count} sesi duplikat dilewati")
            if conflicts:
                msg_parts.append(f"{len(conflicts)} catatan spesifikasi")

            return {
                "success": (imported_count > 0 or skipped_count > 0),
                "message": ", ".join(msg_parts) if msg_parts else "Tidak ada berkas yang diimpor.",
                "imported_count": imported_count,
                "skipped_count": skipped_count,
                "conflicts": conflicts
            }
        except Exception as e:
            return {"success": False, "message": str(e), "imported_count": 0, "skipped_count": 0, "conflicts": []}

    @staticmethod
    def import_session(source_filepath: str, imported_by: str = "Unknown") -> Optional[str]:
        res = StorageManager.smart_import(source_filepath, imported_by)
        if res.get("success"):
            return "imported_success"
        return None

    @staticmethod
    def generate_certificate_number(date_str: Optional[str] = None) -> str:
        """
        Generate auto certificate number using Format A:
        ALT/CAL/[YYYY]/[MM]/[NNNN]
        Contoh: ALT/CAL/2026/09/0001
        Menghitung nomor urut dari riwayat kalibrasi pada tahun dan bulan tersebut.
        """
        StorageManager._ensure_dir()
        history_dir = _get_history_dir()

        target_dt = datetime.now()
        if date_str:
            try:
                target_dt = datetime.strptime(str(date_str)[:10], "%Y-%m-%d")
            except Exception:
                pass

        year_str = target_dt.strftime("%Y")
        month_str = target_dt.strftime("%m")
        prefix = f"ALT/CAL/{year_str}/{month_str}/"

        max_seq = 0
        if os.path.exists(history_dir):
            for fname in os.listdir(history_dir):
                if fname.endswith(".json"):
                    try:
                        fpath = os.path.join(history_dir, fname)
                        with open(fpath, "r", encoding="utf-8") as f:
                            data = json.load(f)
                            # Cek field certificate_number langsung
                            cert_no = data.get("certificate_number") or ""
                            if not cert_no and "dkd_data" in data and isinstance(data["dkd_data"], dict):
                                cert_no = data["dkd_data"].get("cert_number") or ""
                            if cert_no.startswith(prefix):
                                seq_part = cert_no[len(prefix):]
                                if seq_part.isdigit():
                                    max_seq = max(max_seq, int(seq_part))
                                    continue
                            # Hitung berdasarkan timestamp file sesi di bulan yang sama
                            ts = data.get("timestamp", "")
                            if ts.startswith(f"{year_str}-{month_str}"):
                                max_seq += 1
                    except Exception:
                        pass

        next_seq = max_seq + 1
        return f"{prefix}{next_seq:04d}"

