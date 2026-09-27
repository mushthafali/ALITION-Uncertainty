# Final Blueprint: Model Kalkulasi Kalibrasi DKD-R 6-1 (Alition Pro)

> **Dokumen ini adalah cetak biru (blueprint) final** untuk implementasi kode backend Python. Disusun berdasarkan standar DKD-R 6-1 dengan penambahan Arsitektur "Base Unit" untuk mencegah kesalahan konversi antar satuan ukur.

---

## 🏛️ ARSITEKTUR UTAMA: "BASE UNIT" (PASCAL)
Agar sistem kebal terhadap *error* satuan ukur, seluruh data tekanan (Pressure) yang masuk ke dalam mesin hitung **akan otomatis dikonversi ke Pascal (Pa)**. Rumus fisika murni berjalan dalam Pascal. Saat cetak laporan (PDF), hasil akhir akan dikonversi kembali ke satuan yang diminta user.

---

## 1️⃣ FASE 1: SETUP & INISIALISASI
*(Berjalan 1x di awal sesi untuk mengatur parameter alat)*

### A. INPUT MANUAL & UNIT (UI)
*   `Input_Unit`: Satuan ukur yang dipilih user di UI (contoh: bar, psi, kPa, MPa).
*   `LRV`, `URV`, `Resolution`, `MPE_Percent`: Parameter UUT.
*   `Tipe Kalibrator`: Memilih "DIGITAL" atau "DWT".
*   `Height_Diff`: Beda tinggi UUT dengan Kalibrator (meter). *Positif (+) jika UUT lebih tinggi.*
*   `Medium_Density`: Massa jenis fluida tekanan (kg/m³).

### B. KONVERSI KE BASE UNIT (SYSTEM)
Sistem menetapkan `Faktor_Masuk` berdasarkan `Input_Unit` (bar=100000, psi=6894.757, dst).
```python
LRV_Pa = LRV * Faktor_Masuk
URV_Pa = URV * Faktor_Masuk
Resolution_Pa = Resolution * Faktor_Masuk
MPE_Value_Pa = (MPE_Percent / 100) * (URV_Pa - LRV_Pa)
```

### C. ALAT REFERENSI & u_standard
**JIKA "DIGITAL":**
```python
Std_FS_Pa = Std_Full_Scale * Faktor_Masuk
u_standard_Pa = ((Std_Accuracy_Percent / 100) * Std_FS_Pa) / math.sqrt(3)
```
**JIKA "DWT" (Mekanik):**
```python
u_standard_Pa = u_standard_DWT_Input * Faktor_Masuk
# Ditambah parameter dari UI: Area_0, Alpha_Beta, Rho_m, Lambda
```

### D. LOGIKA PENGUNCI SEQUENCE
*   **Sequence A** (9 titik, 3x preload, kolom M1-M6): `MPE_Percent < 0.1` ATAU `URV_Pa > 250000000` (2500 bar)
*   **Sequence B** (9 titik, 2x preload, kolom M1-M4): `0.1 <= MPE_Percent <= 0.6`
*   **Sequence C** (5 titik, 1x preload, kolom M1-M2): `MPE_Percent > 0.6`

---

## 2️⃣ FASE 2: AKUISISI DATA REAL-TIME
*(Berjalan asinkronus per titik saat user menekan ENTER di tabel matriks)*

### A. UI INTERAKTIF (STAIRCASE DIAGRAM)
*   Begitu Sequence terkunci, UI tidak menampilkan tabel kaku, melainkan **Gambar Grafik Tangga (Staircase)** yang persis seperti ilustrasi di dokumen DKD-R 6-1.
*   Terdapat lekukan tangga untuk *Preloading* dan titik pengukuran utama.
*   Setiap sudut "tangga" memiliki kotak input (`<input type="number">`) tempat user mengetikkan nilai pembacaan tekanan (`P_ind`).

### B. KONVERSI INSTAN (SAAT ENTER)
```python
P_ind_Pa = P_ind_Input * Faktor_Masuk
P_nominal_Pa = P_nominal_Input * Faktor_Masuk
```

### B. TARIK DATA IoT & HITUNG RHO_A
Ambil `t_ambien`, `RH`, `P_atm` (hPa).
```python
T_kelvin = t_ambien + 273.15
P_sat = 6.1078 * (10 ** ((7.5 * t_ambien) / (t_ambien + 237.3)))
P_v = (RH / 100) * P_sat
Rho_a = (P_atm * 100) / (287.058 * T_kelvin) - (P_v * 100) / (461.495 * T_kelvin)
```

### C. HEAD CORRECTION & P_STANDARD
```python
Delta_p_head_Pa = (Medium_Density - Rho_a) * 9.80665 * Height_Diff

if Tipe_Kalibrator == "DIGITAL":
    P_standard_Pa = P_nominal_Pa - Delta_p_head_Pa
elif Tipe_Kalibrator == "DWT":
    # Substitusi P_nominal sebagai representasi massa beban
    P_DWT_Gen = (P_nominal_Pa * (1 - (Rho_a / Rho_m))) / ((1 + Lambda * P_nominal_Pa) * (1 + Alpha_Beta * (t_ambien - 20)))
    P_standard_Pa = P_DWT_Gen - Delta_p_head_Pa
```

### D. DEVIASI & DATABASE
```python
Deviasi_Point_Pa = P_ind_Pa - P_standard_Pa
# Simpan P_ind_Pa, P_standard_Pa, Deviasi_Point_Pa ke tabel Database.
```

---

## 3️⃣ FASE 3: PEMROSESAN STATISTIK
*(Berjalan otomatis setelah tabel terisi penuh, evaluasi Array Pascal)*

### A. CARI NILAI MAKSIMUM
Temukan `Repeatability_Pa (b')`, `Hysteresis_Pa (h)`, dan `Zero_Deviation_Pa (f0)` terbesar dari kumpulan data.

### B. KETIDAKPASTIAN BAKU (DIST. RECTANGULAR)
```python
u_res_Pa = (Resolution_Pa / 2) / math.sqrt(3)
u_b_Pa = (Repeatability_Pa / 2) / math.sqrt(3)
u_h_Pa = (Hysteresis_Pa / 2) / math.sqrt(3)
u_f0_Pa = (Zero_Deviation_Pa / 2) / math.sqrt(3)  # Full-width interval correction
```

---

## 4️⃣ FASE 4: PELAPORAN & KEPUTUSAN (VERDICT)
*(Kalkulasi akhir kelulusan dan persiapan eksport)*

### A. KETIDAKPASTIAN DIPERLUAS (U)
```python
U_Pa = 2 * math.sqrt(u_standard_Pa**2 + u_res_Pa**2 + u_f0_Pa**2 + u_b_Pa**2 + u_h_Pa**2)
```

### B. ERROR SPAN & KELULUSAN
```python
Deviasi_RataRata_Pa = mean(P_ind_Pa_Array) - mean(P_standard_Pa_Array)
Error_Span_Pa = U_Pa + abs(Deviasi_RataRata_Pa)

if Error_Span_Pa <= MPE_Value_Pa:
    Status = "PASS"
else:
    Status = "FAIL"
```

### C. DYNAMIC PDF EXPORT
1.  User klik "Export PDF".
2.  Pilih `Export_Unit` (misal: psi).
3.  Sistem menetapkan `Faktor_Keluar` (misal: 6894.757).
4.  Render: `Nilai_Cetak = Nilai_Database_Pa / Faktor_Keluar`.
5.  Sertifikat tercetak dengan satuan yang diinginkan, tanpa kehilangan akurasi desimal fisika.
