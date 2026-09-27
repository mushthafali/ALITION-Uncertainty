# Alition Pro - Application Architecture & Logic Flow

Dokumen ini memetakan secara komprehensif alur kerja (logic flow), arsitektur, input/output, serta pengerucutan fitur yang terdapat di dalam aplikasi kalibrasi industri **Alition Pro**.

---

## 1. Visualisasi Alur Kerja (Flowchart)

```mermaid
flowchart TD
    %% Styling
    classDef startEnd fill:#1e293b,stroke:#cbd5e1,stroke-width:2px,color:#f8fafc;
    classDef process fill:#3b82f6,stroke:#bfdbfe,stroke-width:1px,color:#ffffff;
    classDef condition fill:#f59e0b,stroke:#fde68a,stroke-width:1px,color:#ffffff;
    classDef hw fill:#10b981,stroke:#a7f3d0,stroke-width:1px,color:#ffffff;
    classDef report fill:#8b5cf6,stroke:#ddd6fe,stroke-width:1px,color:#ffffff;

    Start([Buka Aplikasi Alition Pro]):::startEnd --> AksiAwal{Pilih Aksi Awal}:::condition
    
    %% --- CABANG 1: HARDWARE PROVISIONING ---
    AksiAwal -->|Hardware Setup| HW1[Buka Provisioning Dialog]:::hw
    HW1 --> HW2[PC Konek ke ESP32 AP Mode 'alition1.0']:::hw
    HW2 --> HW3[Kirim Config WiFi Pabrik & Broker MQTT]:::hw
    HW3 --> HW4[ESP32 Reboot -> STA Mode & Konek Internet]:::hw
    HW4 --> HW5[Frontend Subscribe Data Sensor Real-time]:::hw
    HW5 -.-> AksiAwal
    
    %% --- CABANG 2: HISTORY & COMPARE ---
    AksiAwal -->|History| Hist1[Buka Tabel Riwayat JSON]:::process
    Hist1 --> HistAct{Tindakan?}:::condition
    HistAct -->|Load Data| HistLoad[Restore JSON ke Workspace (Reverse Map)]:::process
    HistAct -->|Compare 2 Data| HistCmp[Cek Syarat: Sequence Identik]:::process
    HistCmp --> HistHydrate[Translate Payload DKD ke Format Visual]:::process
    HistHydrate --> HistVis[Tampilkan Tab Overview, Charts, Points]:::process
    
    %% --- CABANG 3: SESI KALIBRASI BARU ---
    AksiAwal -->|Start Session| Meta[Isi Metadata: Operator, Model, Tanggal]:::process
    Meta --> Std{Pilih Kalibrasi}:::condition
    
    %% --- CABANG 3A: DEFAULT ---
    Std -->|Default| Def1[Buka Workspace Default]:::process
    Def1 --> Def2[Input LRV, URV, Unit, Jumlah Titik]:::process
    Def2 --> Def3[Pengambilan Data Tekanan Aktual]:::process
    Def3 --> Def4[Kalkulasi Deviasi & Linearitas Error]:::process
    Def4 --> Finish[Kesimpulan Kelulusan PASS/FAIL]:::process
    
    %% --- CABANG 3B: DKD-R 6-1 ---
    Std -->|DKD-R 6-1| DKD1[Buka Workspace DKD-R 6-1]:::process
    DKD1 --> DKD2[Pilih Setup: Tipe Kalibrator, Parameter Fluida/Densitas]:::process
    DKD2 --> DKD3[Baca Input Data Sensor Lingkungan Suhu & Tekanan Udara]:::hw
    DKD3 --> DKD4[Validasi Resolusi & Hitung U_standard]:::process
    DKD4 --> DKD5[Validasi Sequence Minimum A/B/C berdasar Ketidakpastian]:::process
    DKD5 --> DKD6[Kunci Parameter / Start Pre-loading]:::process
    DKD6 --> DKD7[Input Hasil Siklus Naik-Turun / Staircase]:::process
    DKD7 --> DKD8[Evaluasi Matematika: Histeresis, Repeatabilitas, U_expanded]:::process
    DKD8 --> Finish
    
    %% --- OUTPUT & PENYIMPANAN ---
    Finish --> SaveJSON[Simpan Objek JSON Sesi ke Local OS]:::report
    SaveJSON --> Output{Export Laporan}:::condition
    Output -->|Sertifikat Resmi| PDF[ReportLab Generate PDF]:::report
    Output -->|Data Mentah| Excel[OpenPyXL Generate Excel]:::report
    
    PDF --> Selesai([Selesai / Reset App]):::startEnd
    Excel --> Selesai
```

---

## 2. Pembedahan Arsitektur Sistem (High-Level)
Sistem ini menggunakan arsitektur modular yang memisahkan antara proses visual, manajemen memori, dan akses *hardware*.

### A. Python Backend (Core Engine)
Beroperasi tanpa *Command Prompt* terlihat (GUI mode via PyWebview).
*   **Peran:** Bertindak sebagai jembatan antara OS Windows dan antarmuka web.
*   **Komponen:**
    *   `api.py`: Menangani semua panggilan *asynchronous* dari JavaScript (seperti membuka file, menyimpan data, mereset hardware).
    *   `storage.py`: Mengelola hierarki folder penyimpanan di `%APPDATA%/AlitionPro/history`. Melakukan parsing dan validasi skema JSON, serta menangani fitur *Import/Export*.
    *   `reporting.py`: Pustaka khusus yang menggunakan `ReportLab` untuk menggambar tabel vektor PDF yang *pixel-perfect* dan `OpenPyXL` untuk mengubah JSON menjadi tabel *spreadsheet* siap cetak.

### B. JavaScript Frontend (Visual & Logic Engine)
Berada di dalam `app.js`. Sistem tidak menggunakan *framework* (Vanilla JS) namun menggunakan manipulasi DOM tingkat tinggi dengan State Management.
*   **Peran:** Menangani 100% responsivitas UI dan kalkulasi matematika kompleks (seperti matriks regresi linear dan kalkulasi deviasi CIPM).
*   **Komponen:**
    *   **DKD State Manager**: Objek global `dkdWizardState` yang menyimpan sementara seluruh input pengguna, mencegah kehilangan data saat berpindah panel.
    *   **MQTT Paho Client**: Konektor *WebSocket* bawaan yang merespons secara reaktif setiap pesan dari broker (HiveMQ) dan memperbarui elemen DOM.

### C. ESP32 Hardware (Edge Computing)
Node IoT yang berdiri sendiri.
*   **Peran:** Mengambil data fisis dan merutekannya ke jaringan internet tanpa campur tangan PC.
*   **Komponen (C++ Arduino):**
    *   **WiFi Manager (AP Mode)**: Modul Captive Portal yang memancarkan sinyal `alition1.0` untuk konfigurasi awal.
    *   **AsyncWebServer**: Menerima request HTTP POST berisikan rahasia jaringan (SSID, Password, Token).
    *   **PubSubClient**: Mengirimkan telemetri sensor ke cloud (topik `alition/env/#`) ketika sudah dalam mode STA.

---

## 3. Rincian Fitur Utama & Interaksi I/O

### Fitur 1: Provisioning & Telemetry (AP / STA Mode)
*   **Kondisi Awal**: Alat belum mengenali jaringan internet pabrik (Berada dalam AP Mode).
*   **Proses**: Pengguna menggunakan modal *Hardware Setup* di aplikasi. Frontend mengirimkan permintaan AJAX (HTTP POST) langsung ke IP `192.168.4.1`.
*   **Input**: `ssid`, `password`, `mqtt_host`, `mqtt_port`, `device_id`.
*   **Output**: Alat mereset memori EEPROM-nya, *reboot*, dan beralih ke mode STA (Station) untuk bergabung dengan WiFi pabrik. Frontend kini memutus koneksi AJAX lokal dan beralih menggunakan koneksi WebSocket jarak jauh ke Broker MQTT.

### Fitur 2: Kalibrasi Standar (Default Mode)
*   **Proses**: Fitur sederhana untuk *pressure gauge* komersial tanpa menuntut akurasi tinggi.
*   **Input**: Rentang ukur (LRV - URV), jumlah titik, toleransi umum, dan nilai yang diamati oleh operator di setiap titik.
*   **Output**: Grafik regresi linear (Best-Fit Line), grafik persentase deviasi, titik residual, serta kesimpulan PASS/FAIL berbasis *Error* maksimum murni.

### Fitur 3: DKD-R 6-1 Engine (Advanced Mode)
*   **Proses**: Implementasi pedoman kalibrasi Jerman. Menekankan ketidakpastian pengukuran (bukan sekadar toleransi error).
*   **Step-by-Step Logic**:
    1.  **Validasi Lingkungan & Densitas**: Memerlukan data densitas medium fluida ($\rho_m$) dan menggunakan sensor suhu untuk mendapatkan densitas udara ($\rho_{air}$). Ini memengaruhi gaya apung (*buoyancy*) pada mekanik kalibrator tipe DWT.
    2.  **Validasi Sequence**: Menguji Resolusi Alat ($r$). Jika ketidakpastian standar melebihi ambang batas, aplikasi akan melarang Sequence A dan memaksa pengguna memilih Sequence B atau C (yang membutuhkan siklus Naik-Turun yang lebih banyak).
    3.  **Pengambilan Data**: Memandu pengguna menaiki dan menuruni titik kalibrasi *(Staircase)* sesuai jumlah siklus (contoh: Naik-Turun-Naik-Turun untuk Seq B).
    4.  **Kalkulasi**: Menghitung $b'$ (Repeatability), $h$ (Hysteresis), $v$ (Efek Resolusi), $u_c$ (Combined Uncertainty), dan akhirnya $U_{expanded}$.
*   **Output**: Kurva Karakteristik (yang jauh lebih kompleks dibanding kurva regresi biasa) dan status Lulus/Gagal berdasarkan evaluasi MPE vs U.

### Fitur 4: Memory & Reverse Mapping (History Viewer)
*   **Proses**: File kalibrasi yang selesai tidak hanya pasif. Mereka dapat dimuat kembali ke antarmuka aplikasi.
*   **Logika Reverse Mapping**: Saat pengguna memuat file `.json`, aplikasi melempar semua data dari tabel (misalnya, Toleransi, Unit, dan tipe Kalibrator) kembali ke dalam elemen formulir di sisi kiri (DOM Inputs). Hal ini memungkinkan pengguna melakukan *What-If Analysis* (misal: "Bagaimana jika instrumen tua ini dievaluasi dengan toleransi MPE yang lebih ketat?").

### Fitur 5: Comparison Engine
*   **Proses**: Penganalisis *Head-to-head* untuk melacak degradasi performa instrumen.
*   **Logika Validasi**: Sebelum membandingkan, Backend mengecek apakah kedua file memiliki *Instrument Model* yang sama, dan *Standar Kalibrasi* (serta urutan siklus DKD) yang identik. Jika Sequence DKD berbeda (misal Seq A vs Seq B), sistem menolak membandingkan karena rasio sampelnya tidak relevan.
*   **Logika Hydration**: Karena struktur *array* memori Default dan DKD sangat berbeda, Frontend menggunakan fungsi *Hydrator* (`hydrateDkd()`) yang mengkonversi data *staircase* (Deviasi, Histeresis rata-rata, dll) menjadi bentuk seragam standar (Titik Set, Rata-rata Pembacaan, *Error* %).
*   **Output**: Kesimpulan degradasi (Mana sesi yang memiliki *error* lebih kecil), Grafik tumpang-tindih (Session A vs Session B), serta opsi untuk mengekspor perbedaan ini langsung ke PDF resmi.

---

## 4. Rincian Kalkulasi Matematis & Persamaan (Formulas)

Sistem Alition Pro membedakan pendekatan kalkulasi antara mode kalibrasi **Default (Komersial)** dan mode **DKD-R 6-1 (Presisi Tinggi)**. Berikut adalah penjabaran rumus dan ekuasi matematika yang digunakan oleh *Core Engine* (JavaScript/Python) di balik layar.

### A. Kalkulasi Kalibrasi Default (Basic Linearity)
Mode ini menggunakan matematika linearitas dasar untuk menghitung deviasi instrumen komersial tanpa memperhitungkan faktor ketidakpastian lingkungan.

1.  **Rentang Ukur (Span / FS):**
    $Span = URV - LRV$

2.  **Deviasi Aktual / Error (Absolut):**
    $Error_{abs} = \bar{x}_{reading} - p_{set\_point}$
    *(Selisih antara rata-rata nilai pembacaan alat terhadap nilai set point dari kalibrator).*

3.  **Persentase Error terhadap Skala Penuh (%FS):**
    $Error_{\%FS} = \left( \frac{Error_{abs}}{Span} \right) \times 100\%$

4.  **Toleransi Maksimum (MPE):**
    $MPE_{Limit} = Span \times \left(\frac{\text{Tolerance } \%}{100}\right)$
    *(Syarat Kelulusan PASS: $|Error_{abs}| \le MPE_{Limit}$ di seluruh titik ukur).*

### B. Kalkulasi Kalibrasi DKD-R 6-1 (Advanced Uncertainty Analysis)
Prosedur ini sesuai dengan standar kalibrasi internasional (CIPM & EURAMET), di mana setiap sumber keraguan matematis dihitung dan diakumulasikan menjadi Ketidakpastian Bentangan ($U_{expanded}$).

#### B.1. Percabangan Koreksi Lingkungan (Berdasarkan Tipe Kalibrator)
Sistem memisahkan kalkulasi tekanan referensi nyata (*True Pressure* / $P_{true}$) berdasarkan jenis alat kalibrator yang dipilih oleh teknisi pada awal formulir Setup.

**JIKA (IF): Tipe Kalibrator = Digital Calibrator**
Sebagian besar kalibrator elektronik presisi sudah menggunakan kompensasi internal (*internal transducer algorithm*), sehingga gaya apung udara (buoyancy) diabaikan. Namun, koreksi tinggi kolom cairan (*Hydrostatic Head*) mutlak tetap berlaku jika terdapat selisih elevasi/ketinggian antara kalibrator dan instrumen yang sedang diuji.
1.  **Koreksi Tinggi Cairan:** $\Delta p_{head} = (\rho_{fl} - \rho_{air\_std}) \cdot g_l \cdot \Delta h$
2.  **Tekanan Referensi Sejati:**
    $P_{true} = P_{digital\_reading} + \Delta p_{head}$
    *(Tekanan yang dibaca di layar kalibrator digital dijumlahkan langsung dengan koreksi tinggi cairan).*

**SEBALIKNYA JIKA (ELSE IF): Tipe Kalibrator = Dead-Weight Tester (DWT)**
DWT adalah instrumen mekanis murni bertenaga gravitasi. Massa alat ukur ini terpapar secara absolut oleh fluktuasi cuaca lokal sehingga wajib memperhitungkan Daya Apung Udara (*Air Buoyancy*).
1.  **Densitas Udara Aktual ($\rho_{air}$):**
    Diekstrak dengan memasukkan parameter dari sensor IoT ESP32 (Suhu Aktual $t$, Tekanan Udara $p_{atm}$, Kelembaban $RH$) ke dalam formula konstanta gas CIPM.
2.  **Koreksi Tinggi Cairan:** $\Delta p_{head} = (\rho_{fl} - \rho_{air}) \cdot g_l \cdot \Delta h$
3.  **Tekanan Referensi Sejati (Full DWT Equation):**
    $P_{true} = \left[ \frac{\sum m \cdot g_l}{A_{eff}} \cdot \left(1 - \frac{\rho_{air}}{\rho_m}\right) \right] + \Delta p_{head}$
    *   $\sum m$ = Massa total anak timbangan (termasuk *bell* dan piston).
    *   $A_{eff}$ = Luas penampang efektif silinder piston DWT.
    *   *Suku $(1 - \frac{\rho_{air}}{\rho_m})$ secara matematis memotong/mengkoreksi efek hilangnya massa akibat gaya apung udara ke atas.*

#### B.2. Evaluasi Komponen Ketidakpastian Baku ($u_i$)
Setiap properti fisis instrumen diubah menjadi distribusi varians probabilitas (biasanya distribusi rectangular / dibagi $\sqrt{3}$).

1.  **Ketidakpastian Standar Referensi ($u_{standard}$):**
    Berasal dari spesifikasi pabrikan kalibrator.
    $u_{standard} = \frac{\text{Akurasi Kalibrator} \times \text{Full Scale}}{2}$ *(Distribusi Normal k=2)*

2.  **Ketidakpastian karena Resolusi Alat ($u_{resolution}$):**
    Efek keterbatasan jumlah digit di layar (*digital step*). Jika resolusi layar instrumen adalah $r$, maka:
    $u_{res} = \frac{r}{2 \sqrt{3}}$

3.  **Ketidakpastian Repeatabilitas ($u_b$):**
    Varian pembacaan pada nilai titik set point yang sama (naik ke-1 vs naik ke-2). 
    $b' = \max(|x_{up\_cycle\_1} - x_{up\_cycle\_2}|)$
    $u_b = \frac{b'}{2 \sqrt{3}}$

4.  **Ketidakpastian Histeresis / Reversibilitas ($u_h$):**
    Efek mekanik pegas/sensor yang menyimpang ketika diberi tekanan naik vs tekanan turun.
    $h = |x_{up\_average} - x_{down\_average}|$
    $u_h = \frac{h}{2 \sqrt{3}}$

#### B.3. Akumulasi dan Penentuan Toleransi (U_expanded)
Keseluruhan ketidakpastian baku disatukan menggunakan Hukum Propagasi Varians.

1.  **Ketidakpastian Baku Gabungan ($u_c$ - Combined Standard Uncertainty):**
    Metode akar jumlah kuadrat (Root Sum Square).
    $u_c = \sqrt{u_{standard}^2 + u_{res}^2 + u_b^2 + u_h^2}$

2.  **Ketidakpastian Bentangan Akhir ($U_{expanded}$):**
    Menggunakan faktor cakupan $k=2$ (tingkat kepercayaan statistik 95%). Nilai ini adalah output akhir yang muncul di sertifikat.
    $U_{expanded} = k \cdot u_c$

3.  **Kesimpulan Akhir (PASS/FAIL Evaluator):**
    Dalam kalibrasi tinggi, instrumen dinyatakan **PASS** jika deviasi rata-rata absolut ($|\bar{e}|$) ditambah dengan Ketidakpastiannya tidak melebihi Batas Kesalahan Maksimal (MPE).
    $|\bar{x} - p_{true}| + U_{expanded} \le MPE_{Limit}$

### C. Alur Kronologis Perhitungan DKD-R 6-1 (Pipeline Logika)

Untuk memahami bagaimana variabel awal bergerak dan bertransformasi hingga menjadi status kelulusan alat, berikut adalah *pipeline* logikanya:

**Tahap 1: Pembentukan Titik Uji (Staircase Generation)**
- **Input:** Parameter Instrumen (`LRV`, `URV`, `MPE %` atau Toleransi Alat)
- **Proses:** 
  - $Span = URV - LRV$
  - Mencari titik persentase standar DKD (umumnya di titik 0%, 20%, 40%, 60%, 80%, 100%).
  - Tekanan Set Point (Ideal) dicari dengan formula: $p_{ideal} = LRV + (Span \times \% \text{titik})$
  - Nilai Batas Kesalahan (Limit Error): $MPE_{val} = Span \times MPE\%$
- **Output Sementara:** Membentuk Tabel *Staircase* yang berisi target-target tekanan yang harus dicapai oleh kalibrator.

**Tahap 2: Percabangan Koreksi Lingkungan (Environmental Injection)**
- **Input:** Data dari ESP32 (Suhu `T`, Kelembaban `RH`, Tekanan Udara `p_{atm}`), Properti Cairan Kalibrator (`\rho_{fl}`), Tinggi Pipa (`\Delta h`), dan pilihan **Tipe Kalibrator**.
- **Proses:**
  - **IF Digital Calibrator:** Parameter `T`, `RH`, dan `p_{atm}` tidak dipakai untuk gaya apung. Sistem hanya melakukan perkalian percepatan gravitasi terhadap selisih ketinggian cairan ($\Delta h$) untuk mencari $\Delta p_{head}$.
  - **ELSE IF DWT:** Sistem merebus `T`, `RH`, dan `p_{atm}` ke dalam persamaan gas CIPM untuk mencari **Densitas Udara Aktif ($\rho_{air}$)**. Nilai $\rho_{air}$ tersebut langsung disuntikkan secara matematis untuk mengurangi massa anak timbangan (koreksi *Buoyancy*). Lalu sistem menambahkan tekanan $\Delta p_{head}$.
- **Output Sementara:** Modifikasi tekanan. Tekanan ideal $p_{ideal}$ (dari Tahap 1) berubah wujud menjadi Tekanan Referensi Nyata ($P_{true}$) sesuai dengan hukum fisika dari jenis kalibrator yang dipilih.

**Tahap 3: Pengambilan Pengukuran (Data Acquisition)**
- **Input:** `Reading` (Nilai yang diketik teknisi dengan melihat jarum/layar instrumen saat pengujian).
- **Proses:** 
  - Mencari penyimpangan/Deviasi Tunggal: $e = \text{Reading} - P_{true}$
  - Karena DKD mensyaratkan pengukuran Naik dan Turun berulang kali, aplikasi mencari Rata-rata Pembacaan Naik ($\bar{x}_{up}$) dan Rata-rata Pembacaan Turun ($\bar{x}_{down}$).
- **Output Sementara:** Kumpulan matriks Rata-Rata Pengukuran ($\bar{x}_{mean}$) dan Deviasi/Error instrumen ($\bar{e}$).

**Tahap 4: Ekstraksi Ketidakpastian (Uncertainty Extraction)**
- **Input:** Matriks pembacaan ($\bar{x}_{up}$, $\bar{x}_{down}$), Resolusi Layar Alat ($r$), Spesifikasi Keakuratan Kalibrator.
- **Proses:**
  - **Efek Mekanis Instrumen:** Selisih antara jalur naik dan jalur turun diekstrak menjadi nilai Histeresis ($h$). Selisih hasil antara siklus 1 dan siklus 2 diekstrak menjadi Repeatabilitas ($b'$).
  - **Pembagian Distribusi:** Masing-masing $h$, $b'$, resolusi $r$, dan akurasi kalibrator dilemahkan menjadi probabilitas statistik dengan membaginya terhadap konstanta distribusi varians (seperti $2 \sqrt{3}$).
- **Output Sementara:** Kumpulan komponen ketidakpastian baku murni ($u_h, u_b, u_{res}, u_{standard}$).

**Tahap 5: Peleburan & Kesimpulan Final (Conclusion)**
- **Input:** Kumpulan $u_i$ dari Tahap 4, Deviasi Akhir $|\bar{e}|$ dari Tahap 3, Nilai MPE Limit dari Tahap 1.
- **Proses:**
  - Seluruh komponen ketidakpastian disatukan kembali menggunakan metode Teorema Pythagoras / RSS (*Root Sum of Squares*) menjadi satu Ketidakpastian Gabungan ($u_c = \sqrt{\sum u_i^2}$).
  - Dikali 2 untuk mencakup tingkat kepercayaan statistik 95% dunia industri ($U_{expanded} = u_c \times 2$).
  - Ujian Final: Deviasi mutlak instrumen ditambah jangkauan ketidakpastiannya diuji melawan Toleransi MPE. ($|\bar{e}| + U_{expanded} \le MPE$).
- **Output Final:** Jika perhitungan aman, alat dicap **PASS**. Jika melanggar batas, alat dicap **FAIL**. Hasil ini yang dicetak ke dalam Sertifikat PDF.
