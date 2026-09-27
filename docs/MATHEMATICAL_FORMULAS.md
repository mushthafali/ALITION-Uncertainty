# Dokumentasi Matematis & Metrologis Alition

Dokumentasi ini menyajikan seluruh formulasi matematis, koreksi fisik, evaluasi ketidakpastian metrologi, serta aturan keputusan (decision rule) yang diimplementasikan pada aplikasi Alition. 

Standar acuan internasional yang digunakan mencakup:
* **DKD-R 6-1**: *Calibration of Pressure Gauges* (Deutscher Kalibrierdienst / PTB).
* **CIPM-2007 / ISO 1217 (Annex C)**: *Formulation for the Density of Moist Air*.
* **JCGM 100:2008 (GUM)**: *Guide to the Expression of Uncertainty in Measurement*.
* **ILAC-G8:09/2019**: *Guidelines on Decision Rules and Statements of Conformity*.

---

## 1. Tata Nama dan Simbol (Nomenclature)

| Simbol | Besaran Fisik | Satuan SI | Keterangan |
| :--- | :--- | :--- | :--- |
| $T$ | Temperatur ambien | $^{\circ}\text{C}$ | Suhu ruang kalibrasi |
| $T_{\text{K}}$ | Temperatur absolut | $\text{K}$ | $T + 273{,}15$ |
| $RH$ | Kelembaban relatif (*Relative Humidity*) | $\%$ | Kelembaban udara ambien |
| $P_{\text{atm}}$ | Tekanan barometrik ambien | $\text{hPa}$ atau $\text{Pa}$ | Tekanan atmosfer ruang kalibrasi |
| $p_{\text{sat}}$ | Tekanan uap air jenuh (*Saturation Vapor Pressure*) | $\text{Pa}$ | Dihitung via formula Magnus-Tetens |
| $p_v$ | Tekanan parsial uap air | $\text{Pa}$ | Tekanan akibat uap air pada udara basah |
| $p_d$ | Tekanan udara kering (*Dry Air Pressure*) | $\text{Pa}$ | Tekanan atmosfer setelah dikurangi $p_v$ |
| $R_d$ | Konstanta gas spesifik udara kering | $\text{J}/(\text{kg}\cdot\text{K})$ | $287{,}058$ |
| $R_v$ | Konstanta gas spesifik uap air | $\text{J}/(\text{kg}\cdot\text{K})$ | $461{,}495$ |
| $\rho_a$ | Densitas udara ambien basah | $\text{kg}/\text{m}^3$ | Densitas udara riil saat kalibrasi |
| $\rho_f$ | Densitas fluida medium kalibrasi | $\text{kg}/\text{m}^3$ | Oli, air, atau gas ($1{,}2 \text{ kg}/\text{m}^3$ untuk udara) |
| $g$ | Percepatan gravitasi lokal | $\text{m}/\text{s}^2$ | Nilai standar $9{,}80665 \text{ m}/\text{s}^2$ |
| $\Delta h$ | Beda tinggi referensi ke UUT | $\text{m}$ | Ketinggian vertikal UUT terhadap standar |
| $\Delta p_{\text{head}}$ | Koreksi tekanan hidrostatis (*Head Correction*) | $\text{Pa}$ / Satuan Rekayasa | Pengaruh kolom fluida |
| $P_{\text{std}}$ | Tekanan standar terkoreksi | Satuan Rekayasa | Tekanan acuan sebenarnya pada level UUT |
| $Y_i$ | Nilai pembacaan instrumen UUT | Satuan Rekayasa | Indikasi alat yang diuji |
| $\bar{Y}$ | Rata-rata pembacaan UUT | Satuan Rekayasa | Nilai tengah indikasi UUT |
| $E$ | Deviasi atau galat (*Measurement Error*) | Satuan Rekayasa | $\bar{Y} - P_{\text{std}}$ |
| $h_f$ | Histeresis (*Hysteresis*) | Satuan Rekayasa | Beda pembacaan siklus turun dan naik |
| $b'$ | Keterulangan (*Repeatability*) | Satuan Rekayasa | Variabilitas arah yang sama dalam satu instalasi |
| $b$ | Kereprodusibilitasan (*Reproducibility*) | Satuan Rekayasa | Variabilitas setelah pelepasan & pemasangan ulang |
| $u_i$ | Komponen ketidakpastian baku | Satuan Rekayasa | Simpangan baku dari masing-masing kontributor |
| $u_c$ | Ketidakpastian baku gabungan (*Combined Uncertainty*) | Satuan Rekayasa | Penggabungan secara kuadratik (*Root Sum of Squares*) |
| $U$ | Ketidakpastian diperluas (*Expanded Uncertainty*) | Satuan Rekayasa | $k \cdot u_c$ (dengan $k = 2$ untuk interval kepercayaan $\approx 95\%$) |
| $\text{MPE}$ | Kesalahan Maksimum yang Diizinkan (*Max Permissible Error*) | Satuan Rekayasa | Batas toleransi instrumen sesuai kelas akurasi |

---

## 2. Koreksi Kondisi Lingkungan & Tekanan Hidrostatis (Head Correction)

Perbedaan ketinggian posisi pasang antara instrumen standar (*calibrator*) dan instrumen yang diuji (*Unit Under Test - UUT*) menimbulkan kolom fluida yang memberikan tekanan tambahan akibat gaya berat. Selain itu, gaya apung udara (*air buoyancy*) juga berpengaruh, sehingga densitas udara basah harus dihitung dengan presisi.

### 2.1. Tekanan Uap Air Jenuh ($p_{\text{sat}}$)
Dihitung menggunakan persamaan eksponensial Magnus-Tetens (sesuai standar ISO 1217 Annex C dan pedoman meteorologi WMO):

$$p_{\text{sat}} = 611{,}2 \cdot \exp\left(\frac{17{,}502 \cdot T}{240{,}97 + T}\right) \quad [\text{Pa}]$$

*Catatan: Parameter $T$ dimasukkan dalam derajat Celsius ($^{\circ}\text{C}$). Istilah $p_{\text{sat}}$ menggantikan notasi lama $p_{ws}$ agar selaras dengan nomenklatur termodinamika standar.*

### 2.2. Tekanan Parsial Uap Air ($p_v$)
Tekanan uap air ditentukan oleh kelembaban relatif ($RH$):

$$p_v = \left(\frac{RH}{100}\right) \cdot p_{\text{sat}} \quad [\text{Pa}]$$

### 2.3. Tekanan Parsial Udara Kering ($p_d$)
Tekanan atmosfer total dikurangi dengan tekanan uap air:

$$p_d = (P_{\text{atm}} \cdot 100) - p_v \quad [\text{Pa}]$$

*Di mana $P_{\text{atm}}$ dikonversi dari $\text{hPa}$ ke $\text{Pa}$ dengan pengali 100.*

### 2.4. Densitas Udara Basah ($\rho_a$)
Sesuai formulasi CIPM-2007 yang disederhanakan untuk kondisi laboratorium:

$$\rho_a = \frac{p_d}{R_d \cdot T_{\text{K}}} + \frac{p_v}{R_v \cdot T_{\text{K}}} \quad [\text{kg}/\text{m}^3]$$

Dengan:
* $T_{\text{K}} = T + 273{,}15 \text{ K}$
* $R_d = 287{,}058 \text{ J}/(\text{kg}\cdot\text{K})$
* $R_v = 461{,}495 \text{ J}/(\text{kg}\cdot\text{K})$

### 2.5. Koreksi Tekanan Kolom Fluida ($\Delta p_{\text{head}}$)
Koreksi ketinggian hidrostatis dihitung dengan memperhitungkan gaya apung fluida terhadap udara ambien:

$$\Delta p_{\text{head}} = \frac{(\rho_f - \rho_a) \cdot g \cdot \Delta h}{\text{UCF}}$$

Di mana $\text{UCF}$ (*Unit Conversion Factor*) adalah faktor pengonversi dari satuan Pascal ($\text{Pa}$) ke satuan rekayasa yang dipilih:
* $\text{bar}$: $100\,000$
* $\text{psi}$: $6\,894{,}757$
* $\text{kPa}$: $1\,000$
* $\text{MPa}$: $1\,000\,000$
* $\text{Pa}$: $1$

### 2.6. Nilai Tekanan Standar Efektif ($P_{\text{std}}$)
Tekanan acuan sebenarnya yang diterima oleh sensor UUT setelah dikoreksi efek hidrostatis:

$$P_{\text{std}} = \bar{P}_{\text{master}} - \Delta p_{\text{head}}$$

---

## 3. Sekuens Kalibrasi DKD-R 6-1 & Parameter Metrologi

DKD-R 6-1 mendefinisikan 3 sekuens pembebanan sesuai kelas akurasi instrumen:
* **Sekuens A**: Untuk instrumen presisi tinggi (6 seri: $M_1, M_2, M_3, M_4, M_5, M_6$). Melibatkan pembongkaran dan pemasangan kembali untuk mengevaluasi kereprodusibilitasan ($b$).
* **Sekuens B**: Untuk instrumen kelas industri standar (3 seri: $M_1$ naik, $M_2$ turun, $M_3$ naik).
* **Sekuens C**: Untuk pengujian cepat atau verifikasi rutin (2 seri: $M_1$ naik, $M_2$ turun).

### 3.1. Nilai Rata-rata Pembacaan UUT ($\bar{Y}$)

* **Sekuens C (2 seri)**:
  $$\bar{Y} = \frac{M_1 + M_2}{2}$$

* **Sekuens B (3 seri)**:
  $$\bar{Y} = \frac{\frac{M_1 + M_3}{2} + M_2}{2}$$

* **Sekuens A (6 seri)**:
  $$\bar{Y} = \frac{M_1 + M_2 + M_3 + M_4 + M_5 + M_6}{6}$$

### 3.2. Deviasi / Galat Pengukuran ($E$)
Selisih rata-rata indikasi UUT terhadap tekanan standar yang telah dikoreksi:

$$E = \bar{Y} - P_{\text{std}}$$

### 3.3. Histeresis ($h_f$)
Pengaruh perbedaan respon sensor saat siklus tekanan naik (*increasing*) dan tekanan turun (*decreasing*):

* **Sekuens B dan C**:
  $$h_f = |M_2 - M_1|$$

* **Sekuens A**:
  $$h_f = \frac{|M_2 - M_1| + |M_4 - M_3| + |M_6 - M_5|}{3}$$

### 3.4. Keterulangan (*Repeatability* - $b'$)
Variabilitas pembacaan pada titik dan arah yang sama:

* **Sekuens C**: Tidak dievaluasi secara terpisah (diakomodasi dalam komponen lain).
* **Sekuens B**:
  $$b' = |M_3 - M_1|$$
* **Sekuens A**:
  $$b' = \max\left( |M_3 - M_1|, |M_4 - M_2| \right)$$

### 3.5. Kereprodusibilitasan (*Reproducibility* - $b$)
Pengaruh variasi akibat pembongkaran dan perakitan fitting mekanis (*hanya pada Sekuens A*):

$$b = \left| \frac{M_1 + M_2 + M_3 + M_4}{4} - \frac{M_5 + M_6}{2} \right|$$

---

## 4. Evaluasi Ketidakpastian Pengukuran (Uncertainty Budget)

Sesuai DKD-R 6-1 dan EA-4/02, evaluasi ketidakpastian memperhitungkan seluruh sumber variabilitas yang relevan.

### 4.1. Komponen Ketidakpastian Baku

#### A. Ketidakpastian Standar Acuan ($u_{\text{std}}$)
* **Digital Calibrator** (Distribusi Persegi Panjang / Rectangular):
  $$u_{\text{std}} = \frac{(\text{Akurasi}_{\%} / 100) \cdot \text{Full Scale}}{\sqrt{3}}$$
* **Dead-Weight Tester (DWT)** (Distribusi Normal, $k = 2$):
  $$u_{\text{std}} = \frac{U_{\text{sertifikat}}}{2}$$

#### B. Resolusi Pembacaan UUT ($u_{\text{res}}$)
Batas resolusi $\delta Y$ terdistribusi persegi panjang dengan setengah rentang $\delta Y / 2$:

$$u_{\text{res}} = \frac{\delta Y / 2}{\sqrt{3}} = \frac{\delta Y}{2\sqrt{3}}$$

#### C. Penyimpangan Titik Nol ($u_{f0}$)
Dievaluasi dari penyimpangan pembacaan pada titik nol sebelum dan sesudah pembebanan:
* **Sekuens C**: $u_{f0} = \frac{|M_2(0) - M_1(0)| / 2}{\sqrt{3}}$ (bernilai 0 jika di-tare / auto-zero).
* **Sekuens B**: $u_{f0} = \frac{\max(|M_2(0)|, |M_3(0)|) / 2}{\sqrt{3}}$
* **Sekuens A**: $u_{f0} = \frac{\max\left(|M_2(0)-M_1(0)|, |M_4(0)-M_3(0)|, |M_6(0)-M_5(0)|\right) / 2}{\sqrt{3}}$

#### D. Kontribusi Histeresis ($u_h$)
Distribusi persegi panjang dengan batas $\pm h_f / 2$:

$$u_h = \frac{h_f / 2}{\sqrt{3}} = \frac{h_f}{2\sqrt{3}}$$

#### E. Kontribusi Keterulangan ($u_{b'}$)
*Hanya berlaku untuk Sekuens A dan B*:

$$u_{b'} = \frac{b' / 2}{\sqrt{3}} = \frac{b'}{2\sqrt{3}}$$

#### F. Kontribusi Kereprodusibilitasan ($u_b$)
*Hanya berlaku untuk Sekuens A*:

$$u_b = \frac{b / 2}{\sqrt{3}} = \frac{b}{2\sqrt{3}}$$

---

### 4.2. Ketidakpastian Baku Gabungan ($u_c$)

Penggabungan seluruh komponen ketidakpastian yang saling bebas menggunakan prinsip perambatan ketidakpastian (*Root Sum of Squares*):

* **Sekuens C**:
  $$u_c = \sqrt{u_{\text{std}}^2 + u_{\text{res}}^2 + u_{f0}^2 + u_h^2}$$

* **Sekuens B**:
  $$u_c = \sqrt{u_{\text{std}}^2 + u_{\text{res}}^2 + u_{f0}^2 + u_h^2 + u_{b'}^2}$$

* **Sekuens A**:
  $$u_c = \sqrt{u_{\text{std}}^2 + u_{\text{res}}^2 + u_{f0}^2 + u_h^2 + u_{b'}^2 + u_b^2}$$

---

### 4.3. Ketidakpastian Diperluas ($U$)

Untuk memberikan tingkat kepercayaan sekitar 95%, ketidakpastian baku gabungan dikalikan dengan faktor cakupan $k = 2$:

$$U = k \cdot u_c = 2 \cdot u_c$$

---

## 5. Pernyataan Kesesuaian & Aturan Keputusan (Conformity & Decision Rule)

Sesuai standar ISO/IEC 17025:2017 klausul 7.8.6 dan panduan DKD-R 6-1, pernyataan kesesuaian terhadap batas kesalahan yang diizinkan (*Maximum Permissible Error - MPE*) menggunakan aturan penerimaan ketat (*binary acceptance with guard band*):

### 5.1. Batas Kesalahan yang Diizinkan ($\text{MPE}$)
Dihitung dari kelas akurasi instrumen UUT terhadap rentang ukur (*Span*):

$$\text{MPE} = \left(\frac{\text{Akurasi}_{\%}}{100}\right) \cdot (\text{URV} - \text{LRV})$$

### 5.2. Kriteria Keputusan (*Conformity Assessment*)

$$|E| + U \le \text{MPE}$$

* **PASS (Lolos)**: Apabila nilai mutlak galat $|E|$ ditambah nilai ketidakpastian diperluas $U$ tidak melebihi batas $\text{MPE}$. Hal ini menjamin bahwa dengan tingkat kepercayaan 95%, instrumen berada dalam spesifikasi toleransi pabrikan.
* **FAIL (Tidak Lolos)**: Apabila $|E| + U > \text{MPE}$.

---

## 6. Contoh Perhitungan Numerik Lengkap

Berikut contoh verifikasi numerik pada satu setpoint spesifik:

### Kondisi Input:
* Unit: $\text{bar}$
* Rentang ukur: $0$ s.d. $10 \text{ bar}$ ($\text{Span} = 10 \text{ bar}$, Akurasi UUT = $0{,}5\% \to \text{MPE} = 0{,}0500 \text{ bar}$)
* Standar: Digital Calibrator, Full Scale $= 10 \text{ bar}$, Akurasi $= 0{,}05\%$
* Resolusi UUT: $0{,}01 \text{ bar}$
* Sekuens: B ($M_1$ naik, $M_2$ turun, $M_3$ naik)
* Lingkungan: $T = 22{,}50 \,^{\circ}\text{C}$, $RH = 55{,}0\%$, $P_{\text{atm}} = 1012{,}0 \text{ hPa}$
* Koreksi ketinggian: $\rho_f = 1{,}2 \text{ kg}/\text{m}^3$ (udara), $\Delta h = 0{,}5 \text{ m}$
* Setpoint: $50\%$ ($5{,}0000 \text{ bar}$)
* Pembacaan UUT: $M_1 = 5{,}02$, $M_2 = 5{,}03$, $M_3 = 5{,}02 \text{ bar}$
* Pembacaan Master: $M_1 = 5{,}0005$, $M_2 = 5{,}0008$, $M_3 = 5{,}0006 \text{ bar}$

### Langkah 1: Koreksi Lingkungan
1. $p_{\text{sat}} = 611{,}2 \cdot \exp\left(\frac{17{,}502 \cdot 22{,}50}{240{,}97 + 22{,}50}\right) = 2724{,}95 \text{ Pa}$
2. $p_v = (55{,}0 / 100) \cdot 2724{,}95 = 1498{,}72 \text{ Pa}$
3. $p_d = (1012{,}0 \cdot 100) - 1498{,}72 = 99701{,}28 \text{ Pa}$
4. $T_{\text{K}} = 22{,}50 + 273{,}15 = 295{,}65 \text{ K}$
5. $\rho_a = \frac{99701{,}28}{287{,}058 \cdot 295{,}65} + \frac{1498{,}72}{461{,}495 \cdot 295{,}65} = 1{,}1748 + 0{,}0110 = 1{,}1858 \text{ kg}/\text{m}^3$
6. $\Delta p_{\text{head}} = \frac{(1{,}2 - 1{,}1858) \cdot 9{,}80665 \cdot 0{,}5}{100\,000} = 6{,}96 \times 10^{-7} \text{ bar}$ (sangat kecil untuk medium gas)
7. $P_{\text{std}} = \text{rata-rata}(5{,}0005; 5{,}0008; 5{,}0006) - 6{,}96 \times 10^{-7} \approx 5{,}0006 \text{ bar}$

### Langkah 2: Parameter Pengukuran
1. $\bar{Y} = \frac{\frac{5{,}02 + 5{,}02}{2} + 5{,}03}{2} = 5{,}0250 \text{ bar}$
2. $E = 5{,}0250 - 5{,}0006 = +0{,}0244 \text{ bar}$
3. $h_f = |5{,}03 - 5{,}02| = 0{,}0100 \text{ bar}$
4. $b' = |5{,}02 - 5{,}02| = 0{,}0000 \text{ bar}$

### Langkah 3: Anggaran Ketidakpastian
1. $u_{\text{std}} = \frac{(0{,}05 / 100) \cdot 10}{\sqrt{3}} = \frac{0{,}0050}{1{,}73205} = 0{,}00289 \text{ bar}$
2. $u_{\text{res}} = \frac{0{,}01 / 2}{\sqrt{3}} = 0{,}00289 \text{ bar}$
3. $u_{f0} = 0{,}00000 \text{ bar}$ (setelah koreksi titik nol)
4. $u_h = \frac{0{,}0100 / 2}{\sqrt{3}} = 0{,}00289 \text{ bar}$
5. $u_{b'} = 0{,}00000 \text{ bar}$
6. $u_c = \sqrt{0{,}00289^2 + 0{,}00289^2 + 0^2 + 0{,}00289^2 + 0^2} = \sqrt{3 \cdot (0{,}00289)^2} = 0{,}00500 \text{ bar}$
7. $U = 2 \cdot u_c = 0{,}01000 \text{ bar}$

### Langkah 4: Evaluasi Kesesuaian
1. $|E| + U = 0{,}0244 + 0{,}0100 = 0{,}0344 \text{ bar}$
2. Batas $\text{MPE} = 0{,}0500 \text{ bar}$
3. Karena $0{,}0344 \le 0{,}0500$, maka status pengujian adalah **PASS (Lolos)**.
