from __future__ import annotations

import sys
import os
import json

import webview  # type: ignore

from .core import CalibrationEngine
from .models import CalibrationInput, CalibrationPoint, CalibrationMetadata, CalibrationResult
from typing import Optional
from .utils import ReportingModule, StorageManager
from .utils.storage import _model_dump
import threading
import time

try:
    import paho.mqtt.client as mqtt
    MQTT_AVAILABLE = True
except ImportError:
    MQTT_AVAILABLE = False

try:
    import requests as _requests  # type: ignore[import-untyped]
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False

# ── Hardware Constants ────────────────────────────────────────────────────────
# IP default ESP32 saat berjalan dalam mode Access Point (AP).
# Override konstanta ini jika menggunakan fake_hardware.py di localhost.
ESP32_AP_IP = "http://192.168.4.1"


class AlitionAPI:
    def __init__(self):
        self.current_input: Optional[CalibrationInput] = None
        self.current_result: Optional[CalibrationResult] = None
        self.mqtt_client = None
        self.mqtt_thread = None
        self.mqtt_connected: bool = False
        self.latest_sensor_data: dict = {}
        self.mqtt_last_error: str = ""   # Pesan error terakhir MQTT
        self.mqtt_last_rc: int = -1       # rc code terakhir dari on_connect (-1 = belum)
        
        # Ensure logo asset is synchronized to web assets directory
        try:
            base_dir = getattr(sys, '_MEIPASS', os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))
            src_logo = os.path.join(base_dir, 'img', 'logo.png')
            web_img_dir = os.path.join(os.path.dirname(__file__), 'web', 'img')
            dst_logo = os.path.join(web_img_dir, 'logo.png')
            if os.path.exists(src_logo):
                os.makedirs(web_img_dir, exist_ok=True)
                import shutil
                if not os.path.exists(dst_logo) or os.path.getmtime(src_logo) > os.path.getmtime(dst_logo):
                    shutil.copy2(src_logo, dst_logo)
        except Exception:
            pass

    # ── Window Controls ────────────────────────────────────────────────────────
    def minimize_window(self):
        try:
            webview.windows[0].minimize()
        except Exception:
            pass

    def maximize_window(self):
        try:
            webview.windows[0].toggle_fullscreen()
        except Exception:
            pass

    def close_window(self):
        try:
            webview.windows[0].destroy()
        except Exception:
            pass

    def drag_window(self):
        try:
            import ctypes
            from webview.platforms.winforms import BrowserView
            window = webview.windows[0]
            browser = BrowserView.instances.get(window.uid) or getattr(window, 'gui', None)
            if browser:
                hwnd = browser.Handle.ToInt32()
                ctypes.windll.user32.ReleaseCapture()
                ctypes.windll.user32.SendMessageW(hwnd, 0x0112, 0xF012, 0)
        except Exception:
            pass

    def run_analysis(self, payload_str):
        try:
            data = json.loads(payload_str)
            lrv = float(data['lrv'])
            urv = float(data['urv'])
            tol = float(data['tolerance'])
            meta_dict = data.get('metadata', {})
            metadata = CalibrationMetadata(
                operator_name=meta_dict.get('operator_name', ''),
                instrument_model=meta_dict.get('instrument_model', ''),
                serial_number=meta_dict.get('serial_number', ''),
                tag_number=meta_dict.get('tag_number', ''),
                date=meta_dict.get('date', ''),
                location=meta_dict.get('location', '')
            )
            points = []
            for p in data['points']:
                sp = float(p['sp'])
                rd_up = [float(x.strip()) for x in p['rd'].split(';') if x.strip()]
                if rd_up:
                    points.append(CalibrationPoint(set_point=sp, readings_up=rd_up))
            if not points:
                return {"success": False, "message": "No valid calibration points entered."}
            cal_input = CalibrationInput(lrv=lrv, urv=urv, tolerance_pct=tol, points=points, metadata=metadata)
            engine = CalibrationEngine(cal_input)
            result = engine.run_analysis()
            self.current_input = cal_input
            self.current_result = result
            return {
                "success": True,
                "input": _model_dump(cal_input),
                "result": _model_dump(result),
            }
        except Exception as e:
            return {"success": False, "message": str(e)}

    def save_history(self, target_filepath=None, session_trend_log_str=None):
        if not self.current_input or not self.current_result:
            return {"success": False, "message": "No data to save."}
        try:
            # Update the metadata date to today upon saving
            from datetime import datetime
            today_str = datetime.now().strftime("%Y-%m-%d")
            if self.current_input.metadata:
                self.current_input.metadata.date = today_str

            trend_log = []
            if session_trend_log_str:
                try:
                    trend_log = json.loads(session_trend_log_str)
                except Exception:
                    trend_log = []

            filepath = StorageManager.save_session(self.current_input, self.current_result, target_filepath, session_trend_log=trend_log)
            return {"success": True, "filepath": filepath, "new_date": today_str}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def get_history_list(self):
        return StorageManager.get_history_list()

    def get_instruments_list(self):
        """Get summary of instruments grouped by serial_number."""
        return StorageManager.get_instruments_summary()

    def get_instrument_drift_details(self, serial_number):
        """Get multi-session drift metrics and points for serial_number."""
        return StorageManager.get_instrument_history_details(serial_number)

    def export_instrument_bundle(self, serial_number):
        """Export all sessions of an instrument into a single JSON package."""
        try:
            window = webview.windows[0]
            clean_sn = str(serial_number).replace("UNKNOWN-", "").replace(" ", "_")
            save_name = f"alition_instrument_{clean_sn}.json"
            result = window.create_file_dialog(
                webview.FileDialog.SAVE,
                save_filename=save_name,
                file_types=('Alition Instrument Package (*.json)', 'JSON files (*.json)')
            )
            if not result:
                return {"success": False, "message": "Export cancelled."}
            filename = result if isinstance(result, str) else result[0]
            if not filename.endswith(".json"):
                filename += ".json"

            ok = StorageManager.export_instrument_bundle(serial_number, filename)
            if ok:
                return {"success": True, "filepath": filename}
            return {"success": False, "message": "Gagal membuat paket instrumen."}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def export_single_session_history(self, filepath):
        """Export a specific saved session file to a user chosen destination."""
        try:
            if not os.path.exists(filepath):
                return {"success": False, "message": "Berkas sumber tidak ditemukan."}
            window = webview.windows[0]
            base_name = os.path.basename(filepath)
            result = window.create_file_dialog(
                webview.FileDialog.SAVE,
                save_filename=base_name,
                file_types=('Alition History File (*.json)', 'JSON files (*.json)')
            )
            if not result:
                return {"success": False, "message": "Export cancelled."}
            filename = result if isinstance(result, str) else result[0]
            if not filename.endswith(".json"):
                filename += ".json"

            import shutil
            shutil.copy2(filepath, filename)
            return {"success": True, "filepath": filename}
        except Exception as e:
            return {"success": False, "message": str(e)}


    def load_history(self, filepath):
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                data = json.load(f)

            # DKD session: has 'dkd_data' key — return it raw to the frontend
            if 'dkd_data' in data:
                return {
                    'success': True,
                    'is_dkd': True,
                    'dkd_data': data['dkd_data'],
                    'input': data.get('input', {}),
                    'result': data.get('result', {}),
                    'session_trend_log': data.get('session_trend_log') or (data.get('dkd_data', {}).get('session_trend_log', [])),
                    'filepath': filepath,
                }

            # Default calibration session
            loaded = StorageManager.load_session(filepath)
            if loaded:
                inp, res = loaded
                self.current_input = inp
                self.current_result = res
                return {
                    'success': True,
                    'is_dkd': False,
                    'input': _model_dump(inp),
                    'result': _model_dump(res),
                    'session_trend_log': data.get('session_trend_log', []),
                    'filepath': filepath
                }
            return {'success': False, 'message': 'Failed to load history file.'}
        except Exception as e:
            return {'success': False, 'message': str(e)}


    def delete_history(self, filepath):
        success = StorageManager.delete_session(filepath)
        if success:
            return {"success": True}
        return {"success": False, "message": "Failed to delete file."}

    def evaluate_dkd_setup(self, payload_str):
        try:
            from .models.dkd_models import DKDCalibrationSetup
            data = json.loads(payload_str)
            setup = DKDCalibrationSetup(**data)
            return {
                "success": True,
                "u_standard_pa": setup.u_standard_pa,
                "locked_sequence": setup.locked_sequence.value,
                "mpe_value_pa": setup.mpe_value_pa
            }
        except Exception as e:
            return {"success": False, "message": str(e)}

    def load_history_for_compare(self, filepath):
        """Load a history file for comparison without altering current session."""
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                data = json.load(f)
            return {
                "success": True,
                "input": data.get("input", {}),
                "result": data.get("result", {}),
                "is_dkd": "dkd_data" in data,
                "dkd_data": data.get("dkd_data", None)
            }
        except Exception as e:
            return {"success": False, "message": str(e)}

    def import_history(self, imported_by="Unknown"):
        """
        Buka dialog file untuk memilih file JSON history kalibrasi atau bundle instrumen,
        lalu impor dengan logika 3 skenario kondisional cerdas.
        """
        try:
            window = webview.windows[0]
            result = window.create_file_dialog(
                webview.FileDialog.OPEN,
                allow_multiple=True,
                file_types=('Alition History & Packages (*.json)', 'All files (*.*)')
            )
            if not result:
                return {"success": False, "message": "Import cancelled."}

            total_imported = 0
            total_skipped = 0
            all_conflicts = []

            for source_path in result:
                res = StorageManager.smart_import(source_path, imported_by)
                total_imported += res.get("imported_count", 0)
                total_skipped += res.get("skipped_count", 0)
                all_conflicts.extend(res.get("conflicts", []))

            if total_imported > 0 or total_skipped > 0:
                parts = []
                if total_imported > 0:
                    parts.append(f"{total_imported} sesi berhasil digabungkan")
                if total_skipped > 0:
                    parts.append(f"{total_skipped} sesi duplikat dilewati")
                if all_conflicts:
                    parts.append(f"{len(all_conflicts)} catatan spesifikasi")
                msg = ", ".join(parts) + "."
                return {
                    "success": True,
                    "message": msg,
                    "count": total_imported,
                    "skipped": total_skipped,
                    "conflicts": all_conflicts
                }
            else:
                return {"success": False, "message": "Tidak ada data riwayat valid yang dapat diimpor."}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def export_session(self):
        """Export the current session explicitly to a JSON file."""
        if not self.current_input or not self.current_result:
            return {"success": False, "message": "No data to export."}
        try:
            window = webview.windows[0]
            result = window.create_file_dialog(
                webview.FileDialog.SAVE,
                save_filename="calibration_session.json",
                file_types=('JSON files (*.json)',)
            )
            if not result:
                return {"success": False, "message": "Export cancelled."}
            filename = result if isinstance(result, str) else result[0]
            if not filename.endswith(".json"):
                filename += ".json"
            
            rep = ReportingModule(self.current_input, self.current_result)
            rep.export_json(filename)
            return {"success": True, "filepath": filename}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def export_report(self, format_type, cert_number=''):
        if not self.current_input or not self.current_result:
            return {"success": False, "message": "No data to export."}
        try:
            window = webview.windows[0]
            ext = ".xlsx" if format_type == "excel" else ".pdf"
            # create_file_dialog untuk SAVE
            result = window.create_file_dialog(
                webview.FileDialog.SAVE,
                save_filename=f"calibration_report{ext}",
                file_types=(
                    ('Excel files (*.xlsx)',) if format_type == "excel"
                    else ('PDF files (*.pdf)',)
                )
            )
            if not result:
                return {"success": False, "message": "Export cancelled."}

            filename = result if isinstance(result, str) else result[0]

            # Pastikan ekstensi benar
            if not filename.endswith(ext):
                filename += ext

            rep = ReportingModule(self.current_input, self.current_result)
            if format_type == "pdf":
                rep.export_pdf(filename, cert_number=cert_number)
            elif format_type == "excel":
                rep.export_excel(filename)

            return {"success": True, "filepath": filename}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def export_compare_report(self, payload_str, cert_number=''):
        try:
            window = webview.windows[0]
            data   = json.loads(payload_str)
            res_a  = data.get('resA', {})
            res_b  = data.get('resB', {})
            meta_a = (res_a.get('input') or {}).get('metadata') or {}
            meta_b = (res_b.get('input') or {}).get('metadata') or {}
            label_a = meta_a.get('instrument_model', 'SessionA')
            label_b = meta_b.get('instrument_model', 'SessionB')

            result = window.create_file_dialog(
                webview.FileDialog.SAVE,
                save_filename=f'comparison_{label_a}_vs_{label_b}.pdf',
                file_types=('PDF files (*.pdf)',)
            )
            if not result:
                return {'success': False, 'message': 'Export cancelled.'}

            filename = result if isinstance(result, str) else result[0]
            if not filename.endswith('.pdf'):
                filename += '.pdf'

            assert self.current_input is not None and self.current_result is not None
            rep = ReportingModule(self.current_input, self.current_result)
            rep.export_compare_pdf(filename, data, cert_number=cert_number)
            return {'success': True, 'filepath': filename}
        except Exception as e:
            return {'success': False, 'message': str(e)}

    # ─── DKD-R 6-1 Certificate Export ────────────────────────────────────────────
    def export_dkd_certificate(self, payload_str: str, format_type: str = 'pdf', cert_number: str = '') -> dict:
        """
        Ekspor sertifikat kalibrasi DKD-R 6-1 ke PDF atau Excel.
        Dipanggil dari JS exportDkdReport().
        """
        try:
            data = json.loads(payload_str)
            meta = data.get('meta', {})
            instrument = meta.get('instrument_model', 'DKD_Certificate')
            safe_name  = instrument.replace(' ', '_')

            ext    = '.xlsx' if format_type == 'excel' else '.pdf'
            f_type = ('Excel files (*.xlsx)',) if format_type == 'excel' else ('PDF files (*.pdf)',)

            window = webview.windows[0]
            result = window.create_file_dialog(
                webview.FileDialog.SAVE,
                save_filename=f'DKD_{safe_name}{ext}',
                file_types=f_type
            )
            if not result:
                return {'success': False, 'message': 'Export cancelled.'}

            filename = result if isinstance(result, str) else result[0]
            if not filename.endswith(ext):
                filename += ext

            from .utils.dkd_reporting import DkdReportingModule
            rep = DkdReportingModule(data)
            if format_type == 'excel':
                rep.export_excel(filename)
            else:
                if not cert_number:
                    cert_number = StorageManager.generate_certificate_number(meta.get('date'))
                rep.export_pdf(filename, cert_number=cert_number)

            return {'success': True, 'filepath': filename}
        except Exception as e:
            return {'success': False, 'message': str(e)}

    def get_auto_certificate_number(self, date_str: str = '') -> str:
        """Return auto-generated certificate number: ALT/CAL/YYYY/MM/NNNN"""
        return StorageManager.generate_certificate_number(date_str)

    def generate_dkd_certificate_preview(self, payload_str: str = '', cert_number: str = '') -> dict:
        """
        Generate PDF in memory and return base64 data URI for instant in-app preview.
        Supports both DKD mode and standard calibration mode.
        """
        import base64
        import tempfile
        try:
            if payload_str and payload_str.strip():
                data = json.loads(payload_str)
                meta = data.get('meta', {})
                if not cert_number:
                    cert_number = StorageManager.generate_certificate_number(meta.get('date'))

                from .utils.dkd_reporting import DkdReportingModule
                rep = DkdReportingModule(data)
            else:
                if not self.current_input or not self.current_result:
                    return {'success': False, 'message': 'No calibration result to preview.'}
                meta_date = self.current_input.metadata.date if self.current_input.metadata else None
                if not cert_number:
                    cert_number = StorageManager.generate_certificate_number(meta_date)
                from .utils.reporting import ReportingModule
                rep = ReportingModule(self.current_input, self.current_result)

            with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
                tmp_path = tmp.name

            try:
                rep.export_pdf(tmp_path, cert_number=cert_number)
                with open(tmp_path, 'rb') as f:
                    pdf_bytes = f.read()
            finally:
                if os.path.exists(tmp_path):
                    try:
                        os.remove(tmp_path)
                    except Exception:
                        pass

            b64_pdf = base64.b64encode(pdf_bytes).decode('utf-8')
            return {
                'success': True,
                'data_uri': f'data:application/pdf;base64,{b64_pdf}',
                'cert_number': cert_number
            }
        except Exception as e:
            return {'success': False, 'message': str(e)}

    # ─── DKD Session Save / Export ────────────────────────────────────────────────
    def save_dkd_session(self, payload_str: str, target_filepath: str | None = None) -> dict:
        """
        Save DKD session to the app history folder (same as Save Data / Save as New).
        target_filepath: existing history file path to overwrite (Save Data),
                         or None to create a new file (Save as New).
        """
        try:
            data = json.loads(payload_str)
            from datetime import datetime
            # Stamp date with today's date in meta
            if data.get('meta'):
                data['meta']['date'] = datetime.now().strftime('%Y-%m-%d')

            filepath = StorageManager.save_dkd_session(data, target_filepath)
            return {'success': True, 'filepath': filepath,
                    'new_date': datetime.now().strftime('%Y-%m-%d')}
        except Exception as e:
            return {'success': False, 'message': str(e)}

    def export_dkd_session(self, payload_str: str) -> dict:
        """
        Export the full DKD session as a portable JSON file via save dialog.
        The file is written in the SAME format as a history-saved DKD file:
          { version, timestamp, input (shim), result (shim), dkd_data (full payload) }
        This makes it fully re-importable into the history system.
        """
        from datetime import datetime
        try:
            data = json.loads(payload_str)

            # Build history-compatible wrapper (same logic as StorageManager.save_dkd_session)
            meta = data.get('meta') or {}
            row_results   = data.get('rowResults') or []
            overall_status = ('PASS' if row_results and all(r.get('pass', False) for r in row_results)
                              else 'FAIL')

            export_obj = {
                'version':   '2.0.0',
                'timestamp': datetime.now().isoformat(),
                '_exported_at': datetime.now().isoformat(timespec='seconds'),
                'input': {
                    'metadata': {
                        'operator_name':        meta.get('operator_name', ''),
                        'instrument_model':     meta.get('instrument_model', ''),
                        'date':                 meta.get('date', ''),
                        'location':             meta.get('location', ''),
                        'calibration_standard': 'DKD-R 6-1',
                    },
                    'lrv':           (data.get('setup') or {}).get('lrv', 0),
                    'urv':           (data.get('setup') or {}).get('urv', 100),
                    'tolerance_pct': (data.get('setup') or {}).get('mpe_percent', 0),
                    'points':        [],
                },
                'result':   {'overall_status': overall_status},
                'dkd_data': data,   # full payload — used by load_history
                'session_trend_log': data.get('session_trend_log') or [],
            }

            instrument = meta.get('instrument_model', 'DKD_Session').replace(' ', '_')

            window = webview.windows[0]
            result = window.create_file_dialog(
                webview.FileDialog.SAVE,
                save_filename=f'DKD_{instrument}_export.json',
                file_types=('JSON files (*.json)',)
            )
            if not result:
                return {'success': False, 'message': 'Export cancelled.'}
            filename = result if isinstance(result, str) else result[0]
            if not filename.endswith('.json'):
                filename += '.json'

            with open(filename, 'w', encoding='utf-8') as f:
                json.dump(export_obj, f, indent=2, ensure_ascii=False)

            return {'success': True, 'filepath': filename}
        except Exception as e:
            return {'success': False, 'message': str(e)}


    # ─── MQTT Integration ────────────────────────────────────────────────────────
    def connect_mqtt(self, host: str, port: int, device_id: str, username: str = "", password: str = ""):
        if not MQTT_AVAILABLE:
            return {'success': False, 'type': 'missing_lib',
                    'message': 'Library paho-mqtt tidak ditemukan. Jalankan: pip install paho-mqtt'}

        try:
            self.disconnect_mqtt()
            self.mqtt_last_rc    = -1
            self.mqtt_last_error = ""

            topic = f"alition/telemetri/{device_id}"

            # Peta rc code MQTT ke pesan yang actionable
            _RC_MSG = {
                1: ("mqtt_host",  "Broker menolak: versi protokol tidak sesuai."),
                2: ("device_id", "Broker menolak: Client ID tidak valid. Coba ganti Device ID."),
                3: ("mqtt_host",  "Broker tidak dapat dijangkau. Periksa alamat dan port MQTT Broker."),
                4: ("mqtt_user", "Broker menolak: username/password salah."),
                5: ("mqtt_user", "Broker menolak: tidak diotorisasi."),
            }

            def on_connect(client, userdata, flags, rc):
                print(f"[MQTT Debug] on_connect called with rc={rc}")
                if rc == 0:
                    self.mqtt_connected = True
                    self.mqtt_last_rc    = 0
                    self.mqtt_last_error = ""
                    client.subscribe(topic)
                    print(f"[MQTT Debug] Subscribed to topic: {topic}")
                    try:
                        webview.windows[0].evaluate_js('setSensorStatus(true)')
                    except Exception:
                        pass
                else:
                    self.mqtt_connected = False
                    self.mqtt_last_rc = rc
                    field, msg = _RC_MSG.get(rc, ("mqtt_host", f"Koneksi ditolak broker (rc={rc})."))
                    self.mqtt_last_error = msg
                    err_payload = json.dumps({'rc': rc, 'field': field, 'message': msg})
                    try:
                        webview.windows[0].evaluate_js(f'onMqttConnectError({err_payload})')
                    except Exception:
                        pass

            def on_disconnect(client, userdata, rc):
                print(f"[MQTT Debug] on_disconnect called with rc={rc}")
                self.mqtt_connected = False
                try:
                    webview.windows[0].evaluate_js('setSensorStatus(false)')
                except Exception:
                    pass

            def on_message(client, userdata, msg):
                # print(f"[MQTT Debug] on_message received")
                try:
                    payload = json.loads(msg.payload.decode())
                    temp  = payload.get('temp')
                    hum   = payload.get('hum')
                    press = payload.get('pres')

                    # Simpan ke cache — JS polling akan membaca ini
                    self.latest_sensor_data = {
                        'temp': temp, 'hum': hum, 'press': press, 'ts': time.time()
                    }

                    # Juga coba evaluate_js langsung (mungkin gagal di Windows)
                    t_json = json.dumps(temp)
                    h_json = json.dumps(hum)
                    p_json = json.dumps(press)
                    try:
                        webview.windows[0].evaluate_js(
                            f"updateSensorData({t_json}, {h_json}, {p_json})"
                        )
                    except Exception:
                        pass  # JS polling fallback akan mengambil data dari cache
                except Exception as e:
                    print("Error parsing MQTT message:", e)

            try:
                # VERSION1 is for compatibility with the old callback signature used here
                self.mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION1)
            except AttributeError:
                self.mqtt_client = mqtt.Client()
                
            self.mqtt_client.on_connect = on_connect
            self.mqtt_client.on_disconnect = on_disconnect
            self.mqtt_client.on_message = on_message
            
            if username and password:
                self.mqtt_client.username_pw_set(username, password)
            if port == 8883:
                self.mqtt_client.tls_set()
            
            self.mqtt_client.connect_async(host, port, 60)
            self.mqtt_client.loop_start()
            
            return {'success': True, 'message': f'Connecting to {host}...'}
        except Exception as e:
            return {'success': False, 'message': f'Failed to connect: {str(e)}'}

    def disconnect_mqtt(self):
        if self.mqtt_client:
            self.mqtt_client.loop_stop()
            self.mqtt_client.disconnect()
            self.mqtt_client = None
            self.mqtt_connected = False
            return {'success': True}
        return {'success': False}

    def get_mqtt_status(self) -> dict:
        """
        Kembalikan status koneksi MQTT + informasi error terakhir.
        Dipanggil oleh JS setiap detik sebagai polling fallback.
        """
        st = {
            "connected": self.mqtt_connected,
            "rc":        self.mqtt_last_rc,
            "error":     self.mqtt_last_error,
            "field":     self._mqtt_error_field(),
        }
        # print(f"[MQTT Debug] get_mqtt_status called, returning: {st}")
        return st

    def _mqtt_error_field(self) -> str:
        """Kembalikan nama field HTML yang perlu disorot berdasarkan rc terakhir."""
        field_map = {1: "mqtt_host", 2: "device_id", 3: "mqtt_host", 4: "mqtt_user", 5: "mqtt_user"}
        return field_map.get(self.mqtt_last_rc, "mqtt_host")

    def check_esp_wifi_result(self) -> dict:
        """
        Tanya firmware ESP32 apakah WiFi yang terakhir dikonfigurasi berhasil.
        Firmware merespons GET /status dengan {"status": "wifi_failed"|"ok"|"first_boot", "ssid": ...}
        Dipanggil di State 1 wizard setelah device terdeteksi kembali (setelah reboot).
        Returns: {"status": str}  — "wifi_failed" jika koneksi WiFi gagal
        """
        if not REQUESTS_AVAILABLE:
            return {"status": "unknown"}
        try:
            resp = _requests.get(f"{ESP32_AP_IP}/status", timeout=2)
            if resp.status_code == 200:
                return resp.json()
            return {"status": "unknown"}
        except Exception:
            return {"status": "unknown"}

    def get_sensor_data(self) -> dict:
        """
        Kembalikan pembacaan sensor terbaru yang tersimpan di cache.
        Dipanggil oleh JS setiap 2 detik sebagai polling fallback.
        Jika lebih dari 10 detik tidak ada data masuk, kembalikan status timeout.
        Returns: {"temp": float|null, "hum": float|null, "press": float|null, "timeout": bool}
        """
        if 'ts' in self.latest_sensor_data:
            if time.time() - self.latest_sensor_data['ts'] > 10.0:
                self.latest_sensor_data = {}  # Bersihkan cache
                return {"timeout": True}
        return self.latest_sensor_data

    # ─── Hardware Provisioning ────────────────────────────────────────────────────
    def check_esp_connection(self) -> dict:
        """
        Ping ESP32 Access Point untuk memverifikasi apakah PC sudah
        terhubung ke WiFi alat (Alat_Kalibrasi_XXX).
        Dipanggil oleh JS setiap 2 detik saat Wizard berada di State 1.
        Returns: {"connected": bool}
        """
        if not REQUESTS_AVAILABLE:
            return {
                "connected": False,
                "error": "Library 'requests' tidak ditemukan. Jalankan: pip install requests",
            }
        try:
            resp = _requests.get(
                f"{ESP32_AP_IP}/ping",
                timeout=2,
            )
            return {"connected": resp.status_code == 200}
        except Exception:
            # Timeout, ConnectionError, dll — berarti belum terhubung
            return {"connected": False}

    def push_config_to_device(self, payload_str: str) -> dict:
        """
        Kirim konfigurasi WiFi pabrik + MQTT + Device ID ke ESP32
        melalui HTTP POST ke endpoint /set_config.
        ESP32 akan menyimpan konfigurasi ke EEPROM/SPIFFS dan merestart.

        payload_str (JSON string): {
            "ssid"      : str,   # SSID WiFi pabrik
            "pass"      : str,   # Password WiFi pabrik (boleh kosong)
            "mqtt_host" : str,   # Alamat MQTT Broker
            "mqtt_port" : int,   # Port MQTT (default 1883)
            "device_id" : str    # Token / ID unik alat
        }
        Returns: {"success": bool, "message": str (opsional saat gagal)}
        """
        if not REQUESTS_AVAILABLE:
            return {
                "success": False,
                "message": "Library 'requests' tidak ditemukan. Jalankan: pip install requests",
            }
        try:
            data = json.loads(payload_str)
            resp = _requests.post(
                f"{ESP32_AP_IP}/set_config",
                json=data,
                timeout=5,
            )
            if resp.status_code == 200:
                return {"success": True}
            return {
                "success": False,
                "message": f"Alat merespons dengan HTTP {resp.status_code}. "
                           f"Coba ulangi atau periksa koneksi WiFi ke alat.",
            }
        except _requests.exceptions.ConnectionError:
            return {
                "success": False,
                "message": "Tidak dapat menjangkau alat di 192.168.4.1. "
                           "Pastikan WiFi PC sudah tersambung ke WiFi alat.",
            }
        except _requests.exceptions.Timeout:
            return {
                "success": False,
                "message": "Request timeout. Alat tidak merespons dalam 5 detik. "
                           "Coba lagi atau periksa kondisi alat.",
            }
        except json.JSONDecodeError as exc:
            return {"success": False, "message": f"Format data tidak valid: {exc}"}
        except Exception as exc:
            return {"success": False, "message": str(exc)}
