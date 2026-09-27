import json
import os
import sys
import math
from datetime import datetime

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from src.alition.utils.storage import _get_history_dir

# Target directories: both APPDATA and local workspace data/history
appdata_dir = _get_history_dir()
os.makedirs(appdata_dir, exist_ok=True)

local_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data", "history"))
os.makedirs(local_dir, exist_ok=True)

target_dirs = [appdata_dir, local_dir]

def generate_dkd_session(
    model, serial_number, tag_number, operator, location, date_str, cert_no,
    lrv, urv, unit, mpe_pct, sequence='B', drift_offset=0.0, zero_drift=0.0
):
    span = urv - lrv
    mpe_val = (mpe_pct / 100.0) * span
    res = 0.01 if span <= 100 else 0.05
    
    if sequence == 'B':
        setpoints = [0.0, 12.5, 25.0, 37.5, 50.0, 62.5, 75.0, 87.5, 100.0]
        m_series = ['M1', 'M2', 'M3']
    elif sequence == 'A':
        setpoints = [0.0, 12.5, 25.0, 37.5, 50.0, 62.5, 75.0, 87.5, 100.0]
        m_series = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6']
    else:
        setpoints = [0.0, 25.0, 50.0, 75.0, 100.0]
        m_series = ['M1', 'M2']
        
    u_std = 0.0025 * span / math.sqrt(3)
    u_res = (res / 2.0) / math.sqrt(3)
    u_f0 = abs(zero_drift * 0.4) / math.sqrt(3) if zero_drift else 0.001
    
    row_results = []
    measurement_data = {m: [] for m in m_series}
    
    for pct in setpoints:
        nom = lrv + (pct / 100.0) * span
        nonlin = 0.0008 * span * math.sin(math.pi * pct / 100.0)
        true_err = zero_drift + drift_offset * (pct / 100.0) + nonlin
        h_val = 0.0006 * span * math.sin(math.pi * pct / 100.0) if pct not in (0, 100) else 0.0
        
        m_vals = {}
        master_vals = {}
        for idx, m in enumerate(m_series):
            is_up = (idx % 2 == 0)
            dir_effect = -h_val / 2.0 if is_up else h_val / 2.0
            noise = 0.0002 * span * ((idx - 1) * 0.5)
            uut_rd = round(nom + true_err + dir_effect + noise, 3)
            std_rd = round(nom, 3)
            m_vals[m] = uut_rd
            master_vals[m] = std_rd
            measurement_data[m].append({
                "setpoint_pct": pct,
                "nominal_ideal": nom,
                "reading_master": std_rd,
                "reading_uut": uut_rd,
                "env": {"temp": "23.2 °C", "humidity": "50 %RH", "pressure": "1013.2 hPa"},
                "timestamp": f"{date_str}T10:{int(pct):02d}:00"
            })
            
        p_std = sum(master_vals.values()) / len(master_vals)
        mean_uut = sum(m_vals.values()) / len(m_vals)
        dev = mean_uut - p_std
        
        if sequence == 'B':
            h_f = abs(m_vals['M2'] - m_vals['M1'])
            b_prime = abs(m_vals['M3'] - m_vals['M1'])
            u_h = (h_f / 2.0) / 1.732
            u_bp = (b_prime / 2.0) / 1.732
            u_c = math.sqrt(u_std**2 + u_res**2 + u_f0**2 + u_bp**2 + u_h**2)
            b_f = None
        elif sequence == 'A':
            h_f = (abs(m_vals['M2'] - m_vals['M1']) + abs(m_vals['M4'] - m_vals['M3']) + abs(m_vals['M6'] - m_vals['M5'])) / 3.0
            b_prime = max(abs(m_vals['M3'] - m_vals['M1']), abs(m_vals['M4'] - m_vals['M2']))
            b_f = abs(((m_vals['M1'] + m_vals['M2'] + m_vals['M3'] + m_vals['M4']) / 4.0) - ((m_vals['M5'] + m_vals['M6']) / 2.0))
            u_h = (h_f / 2.0) / 1.732
            u_bp = (b_prime / 2.0) / 1.732
            u_bv = (b_f / 2.0) / 1.732
            u_c = math.sqrt(u_std**2 + u_res**2 + u_f0**2 + u_bp**2 + u_bv**2 + u_h**2)
        else:
            h_f = abs(m_vals['M2'] - m_vals['M1'])
            b_prime = None
            b_f = None
            u_h = (h_f / 2.0) / 1.732
            u_bp = 0.0
            u_c = math.sqrt(u_std**2 + u_res**2 + u_f0**2 + u_h**2)
            
        U = 2.0 * u_c
        row_pass = (U + abs(dev)) <= mpe_val
        
        row_results.append({
            "pct": pct,
            "nom_ideal": nom,
            "p_std": round(p_std, 4),
            "mean": round(mean_uut, 4),
            "dev": round(dev, 4),
            "h_f": round(h_f, 4),
            "b_prime_f": round(b_prime, 4) if b_prime is not None else None,
            "b_f": round(b_f, 4) if b_f is not None else None,
            "u_h": round(u_h, 5),
            "u_b_prime": round(u_bp, 5) if b_prime is not None else 0.0,
            "u_b": round(u_bv, 5) if sequence == 'A' else 0.0,
            "u_c": round(u_c, 5),
            "U": round(U, 4),
            "pass": row_pass,
            "m_vals": m_vals,
            "master_vals": master_vals,
            "m1": m_vals.get('M1'),
            "m2": m_vals.get('M2'),
            "m3": m_vals.get('M3'),
            "m4": m_vals.get('M4'),
            "m5": m_vals.get('M5'),
            "m6": m_vals.get('M6')
        })
        
    overall_status = "PASS" if all(r["pass"] for r in row_results) else "FAIL"
    
    setup = {
        "input_unit": unit,
        "lrv": lrv,
        "urv": urv,
        "resolution": res,
        "mpe_percent": mpe_pct,
        "calibrator_type": "DIGITAL",
        "height_diff": 0.0,
        "medium_density": 1.2,
        "std_full_scale": urv,
        "std_accuracy_percent": 0.025,
        "u_standard_dwt": 0.0,
        "alpha_beta": 0.0,
        "rho_m": 8000.0,
        "lambda_val": 0.0
    }
    
    meta = {
        "operator_name": operator,
        "instrument_model": model,
        "serial_number": serial_number,
        "tag_number": tag_number,
        "date": date_str,
        "location": location,
        "calibration_standard": "DKD-R 6-1"
    }
    
    dkd_data = {
        "sequence": sequence,
        "setup": setup,
        "meta": meta,
        "cert_number": cert_no,
        "setpoints": setpoints,
        "mSeries": m_series,
        "measurementData": measurement_data,
        "rowResults": row_results,
        "lastRowResults": row_results,
        "preloadData": [
            {"cycle": 1, "round": 1, "reading_max": urv, "reading_zero": lrv},
            {"cycle": 2, "round": 1, "reading_max": urv, "reading_zero": lrv}
        ]
    }
    
    shim_input = {
        "metadata": meta,
        "lrv": lrv,
        "urv": urv,
        "tolerance_pct": mpe_pct,
        "points": [
            {
                "set_point": r["nom_ideal"],
                "readings_up": [r["m1"]] if "m1" in r else [],
                "readings_down": [r["m2"]] if "m2" in r else []
            }
            for r in row_results
        ]
    }
    
    shim_result = {
        "overall_status": overall_status,
        "span": span,
        "max_error_pct_span": max(abs(r["dev"]) / span * 100 for r in row_results),
        "actual_accuracy_pct": max(abs(r["dev"]) / span * 100 for r in row_results),
        "mean_error": sum(r["dev"] for r in row_results) / len(row_results),
        "std_dev": 0.002 * span,
        "rmse": math.sqrt(sum(r["dev"]**2 for r in row_results) / len(row_results)),
        "linearity_error_pct": 0.015,
        "zero_error": row_results[0]["dev"],
        "span_error": row_results[-1]["dev"],
        "max_hysteresis": max(r["h_f"] for r in row_results),
        "point_results": [
            {
                "set_point": r["nom_ideal"],
                "avg_reading": r["mean"],
                "error": r["dev"],
                "error_pct_span": (r["dev"] / span) * 100,
                "std_dev": 0.001 * span,
                "repeatability_error": r.get("b_prime_f") or 0.0,
                "repeatability_pct_span": ((r.get("b_prime_f") or 0.0) / span) * 100,
                "status": "PASS" if r["pass"] else "FAIL"
            }
            for r in row_results
        ]
    }
    
    # Generate realistic ambient trend log for the session
    session_trend_log = []
    base_temp = 22.8 + (abs(hash(serial_number + date_str)) % 20) / 10.0
    base_hum = 48.0 + (abs(hash(serial_number + date_str)) % 15)
    base_press = 1012.0 + (abs(hash(serial_number + date_str)) % 8)
    for step_idx in range(12):
        mins = step_idx * 2
        session_trend_log.append({
            "ts": 1700000000000 + step_idx * 120000,
            "timeStr": f"{mins:02d}:00",
            "temp": round(base_temp + 0.15 * math.sin(step_idx * 0.5), 1),
            "hum": round(base_hum + 0.4 * math.cos(step_idx * 0.4), 1),
            "press": round(base_press + 0.2 * math.sin(step_idx * 0.3), 1)
        })
    dkd_data["session_trend_log"] = session_trend_log

    dt_iso = f"{date_str}T09:30:00.000000"
    file_content = {
        "version": "2.0.0",
        "timestamp": dt_iso,
        "input": shim_input,
        "result": shim_result,
        "dkd_data": dkd_data,
        "session_trend_log": session_trend_log
    }
    
    clean_model = ''.join(c for c in model if c.isalnum() or c in ('_', '.')).rstrip()
    ts_compact = date_str.replace('-', '') + "_093000"
    filename = f"dkd_{ts_compact}_{clean_model}_{serial_number}.json"
    
    for d in target_dirs:
        filepath = os.path.join(d, filename)
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(file_content, f, indent=4, ensure_ascii=False)
    print(f"Generated DKD session: {filename}")


def generate_standard_session(
    model, serial_number, tag_number, operator, location, date_str,
    lrv, urv, tol_pct
):
    span = urv - lrv
    pts = [0.0, 2.5, 5.0, 7.5, 10.0] if span == 10.0 else [0.0, 25.0, 50.0, 75.0, 100.0]
    
    point_results = []
    points = []
    for sp in pts:
        dev = 0.002 * (sp - lrv) + 0.005
        avg_r = sp + dev
        point_results.append({
            "set_point": sp,
            "avg_reading": round(avg_r, 4),
            "readings": [round(avg_r - 0.002, 4), round(avg_r, 4), round(avg_r + 0.002, 4)],
            "error": round(dev, 4),
            "error_pct_span": round((dev / span) * 100, 4),
            "std_dev": 0.002,
            "repeatability_error": 0.004,
            "repeatability_pct_span": 0.04,
            "status": "PASS"
        })
        points.append({
            "set_point": sp,
            "readings_up": [round(avg_r - 0.002, 4), round(avg_r, 4)],
            "readings_down": [round(avg_r + 0.002, 4)]
        })
        
    meta = {
        "operator_name": operator,
        "instrument_model": model,
        "serial_number": serial_number,
        "tag_number": tag_number,
        "date": date_str,
        "location": location,
        "calibration_standard": "Default"
    }
    
    file_content = {
        "version": "2.0.0",
        "timestamp": f"{date_str}T11:15:00.000000",
        "input": {
            "lrv": lrv,
            "urv": urv,
            "tolerance_pct": tol_pct,
            "points": points,
            "ref_uncertainty": 0.01,
            "resolution": 0.01,
            "metadata": meta
        },
        "result": {
            "span": span,
            "max_error_pct_span": 0.25,
            "actual_accuracy_pct": 0.25,
            "mean_error": 0.012,
            "std_dev": 0.002,
            "rmse": 0.014,
            "linearity_error_pct": 0.02,
            "zero_error": 0.005,
            "span_error": 0.025,
            "max_hysteresis": 0.004,
            "overall_status": "PASS",
            "point_results": point_results
        }
    }
    
    session_trend_log = []
    base_temp = 23.0 + (abs(hash(serial_number + date_str)) % 15) / 10.0
    base_hum = 50.0 + (abs(hash(serial_number + date_str)) % 12)
    base_press = 1013.0 + (abs(hash(serial_number + date_str)) % 6)
    for step_idx in range(8):
        mins = step_idx * 2
        session_trend_log.append({
            "ts": 1700000000000 + step_idx * 120000,
            "timeStr": f"{mins:02d}:00",
            "temp": round(base_temp + 0.1 * math.sin(step_idx * 0.6), 1),
            "hum": round(base_hum + 0.3 * math.cos(step_idx * 0.5), 1),
            "press": round(base_press + 0.15 * math.sin(step_idx * 0.4), 1)
        })
    file_content["session_trend_log"] = session_trend_log
    
    clean_model = ''.join(c for c in model if c.isalnum() or c in ('_', '.')).rstrip()
    ts_compact = date_str.replace('-', '') + "_111500"
    filename = f"cal_{ts_compact}_{clean_model}_{serial_number}.json"
    
    for d in target_dirs:
        filepath = os.path.join(d, filename)
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(file_content, f, indent=4, ensure_ascii=False)
    print(f"Generated Standard session: {filename}")


if __name__ == "__main__":
    print(f"Writing history files to:\n  1. {appdata_dir}\n  2. {local_dir}\n")
    
    # Instrument 1: Yokogawa EJA530E (3 Sessions - shows drift trendline & lifecycle)
    generate_dkd_session(
        model="Yokogawa EJA530E", serial_number="SN-YKG-2024-001", tag_number="PT-101A",
        operator="Ahmad Pratama", location="Central Cal Lab", date_str="2025-09-10",
        cert_no="ALT/CAL/2025/09/0001", lrv=0.0, urv=100.0, unit="bar", mpe_pct=0.25,
        sequence='B', drift_offset=0.02, zero_drift=0.010
    )
    generate_dkd_session(
        model="Yokogawa EJA530E", serial_number="SN-YKG-2024-001", tag_number="PT-101A",
        operator="Budi Santoso", location="Plant Area 2", date_str="2026-03-15",
        cert_no="ALT/CAL/2026/03/0004", lrv=0.0, urv=100.0, unit="bar", mpe_pct=0.25,
        sequence='B', drift_offset=0.04, zero_drift=0.024
    )
    generate_dkd_session(
        model="Yokogawa EJA530E", serial_number="SN-YKG-2024-001", tag_number="PT-101A",
        operator="Chandra Wijaya", location="Central Cal Lab", date_str="2026-09-20",
        cert_no="ALT/CAL/2026/09/0012", lrv=0.0, urv=100.0, unit="bar", mpe_pct=0.25,
        sequence='B', drift_offset=0.065, zero_drift=0.038
    )

    # Instrument 2: WIKA CPG1500 (2 Sessions - perfect for compare)
    generate_dkd_session(
        model="WIKA CPG1500", serial_number="SN-WIK-8842-X", tag_number="PI-204B",
        operator="Budi Santoso", location="Metrology Unit", date_str="2026-02-10",
        cert_no="ALT/CAL/2026/02/0003", lrv=0.0, urv=50.0, unit="bar", mpe_pct=0.1,
        sequence='B', drift_offset=0.008, zero_drift=0.005
    )
    generate_dkd_session(
        model="WIKA CPG1500", serial_number="SN-WIK-8842-X", tag_number="PI-204B",
        operator="Ahmad Pratama", location="Metrology Unit", date_str="2026-08-15",
        cert_no="ALT/CAL/2026/08/0009", lrv=0.0, urv=50.0, unit="bar", mpe_pct=0.1,
        sequence='B', drift_offset=0.015, zero_drift=0.009
    )

    # Instrument 3: Rosemount 3051S (2 Sessions - Sequence A)
    generate_dkd_session(
        model="Rosemount 3051S", serial_number="SN-RSM-9021-K", tag_number="PT-301C",
        operator="Eko Prasetyo", location="High Pressure Lab", date_str="2025-11-20",
        cert_no="ALT/CAL/2025/11/0002", lrv=0.0, urv=200.0, unit="bar", mpe_pct=0.075,
        sequence='A', drift_offset=0.018, zero_drift=0.012
    )
    generate_dkd_session(
        model="Rosemount 3051S", serial_number="SN-RSM-9021-K", tag_number="PT-301C",
        operator="Eko Prasetyo", location="High Pressure Lab", date_str="2026-05-18",
        cert_no="ALT/CAL/2026/05/0007", lrv=0.0, urv=200.0, unit="bar", mpe_pct=0.075,
        sequence='A', drift_offset=0.032, zero_drift=0.021
    )

    # Instrument 4: Ashcroft 1009 (2 Sessions - Default standard)
    generate_standard_session(
        model="Ashcroft 1009", serial_number="SN-ASH-4011-G", tag_number="PG-105",
        operator="Dian Permata", location="Utility Plant", date_str="2026-01-25",
        lrv=0.0, urv=10.0, tol_pct=1.0
    )
    generate_standard_session(
        model="Ashcroft 1009", serial_number="SN-ASH-4011-G", tag_number="PG-105",
        operator="Dian Permata", location="Utility Plant", date_str="2026-07-10",
        lrv=0.0, urv=10.0, tol_pct=1.0
    )
    print("\nAll mock history sessions generated in both storage locations successfully!")
