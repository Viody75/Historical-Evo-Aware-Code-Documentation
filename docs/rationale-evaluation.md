# Evaluasi Kuantitatif Rationale

Dokumen ini mendefinisikan evaluasi otomatis rationale hasil generasi terhadap
referensi berbasis evidence GitHub. Unit evaluasi utama adalah satu pull
request.

## 1. Silver ground truth

Halaman snapshot membentuk `raw-github-evidence-proxy` secara deterministik
dari:

1. deskripsi PR;
2. komentar issue dan review manusia;
3. commit message; dan
4. patch yang relevan.

Untuk setiap PR, artefak ini menyediakan:

- `referenceRationale`: gabungan evidence yang menjadi reference BERTScore;
- `claims`: pecahan evidence atomik; dan
- `evidenceRefs`: referensi GitHub asal setiap klaim.

Referensi tersebut adalah **silver ground truth**, bukan ground truth manusia
final. Editor tetap disediakan untuk memperbaiki evidence yang salah atau
menormalisasi input eksperimen lintas-tools. Setiap perubahan manual perlu
dicatat agar eksperimen dapat direplikasi.

## 2. Metrik

### BERTScore

Candidate adalah gabungan `issues[].generatedClaims[].text` dari generated
comparison. Reference adalah `referenceRationale` pada silver ground truth.
Evaluator melaporkan precision, recall, dan F1 per PR, kemudian macro average
untuk seluruh PR.

BERTScore mengukur kemiripan semantik terhadap reference. Nilai ini tidak
sendirinya membuktikan factual correctness.

### Discussion utilization

Sebagai diagnostik tambahan, evaluator melaporkan:

- jumlah `discussionNarratives`;
- distribusi `evidenceSource` pada `whatChanged`; dan
- proporsi rationale dengan evidence source `discussion`.

Pipeline ini tidak menghitung accuracy, factual correctness, rationale
completeness, maupun claim-alignment proxy.

## 3. Menjalankan evaluator

### Melalui halaman snapshot

Section **Quantitative Testing** tersedia tepat sebelum Raw JSON. Alurnya:

1. aplikasi memuat atau membentuk silver ground truth dari GitHub evidence;
2. aplikasi membentuk generated comparison dari rationale hasil generasi;
3. developer dapat meninjau atau menormalisasi kedua JSON;
4. tombol **Run Quantitative Testing** menyimpan kedua input, menjalankan
   evaluator terhadap `issues[].generatedClaims[].text`, dan menyimpan metrics;
   dan
5. UI menampilkan BERTScore precision, recall, F1, dan raw JSON hasil.

Artefak disimpan per snapshot di `history/evaluation/`:

- `ground-truth.json`;
- `generated-comparison.json`;
- `metrics.json`; dan
- `quantitative-testing.json` sebagai gabungan state UI terakhir.

Endpoint `GET /api/history-snapshots/:id/evaluation` membaca draft atau hasil
terakhir. Endpoint `POST` menerima `groundTruth` dan `generatedComparison`, lalu
menjalankan pipeline. ID generated claim harus unik untuk menjaga traceability.

Jika package `bert-score` belum tersedia, pipeline UI memakai exact
token-overlap fallback agar alur tetap dapat diuji. Hasil tersebut diberi label
`token-overlap-fallback` dan **tidak boleh dilaporkan sebagai BERTScore**.

Disarankan memakai Python 3.11–3.13 pada virtual environment terpisah:

```bash
python3 -m venv .venv-evaluation
source .venv-evaluation/bin/activate
python3 -m pip install -r requirements-evaluation.txt
```

Jika executable virtual environment tidak ditemukan otomatis, isi
`EVALUATION_PYTHON=.venv-evaluation/bin/python`.

Evaluator CLI dapat membaca generated comparison yang sudah dinormalisasi:

```bash
npm run eval:rationale -- \
  --generated-comparison storage/history-snapshots/<snapshot-id>/history/evaluation/generated-comparison.json \
  --ground-truth storage/history-snapshots/<snapshot-id>/history/evaluation/ground-truth.json \
  --output evaluation/results/<snapshot-id>.json
```

Untuk kompatibilitas, `--summary-index` dapat dipakai sebagai pengganti
`--generated-comparison`. Gunakan model BERTScore, bahasa, opsi rescaling,
snapshot, dan versi input yang sama untuk seluruh eksperimen.

Opsi tambahan:

```text
--language en
--model-type <hugging-face-model>
--rescale-with-baseline
```

## 4. Aturan eksperimen lintas-tools

- Ground truth hanya dipakai oleh evaluator, bukan diberikan kepada tools saat
  generasi.
- Semua tools menerima snapshot evidence, bahasa, prompt, dan batas keluaran
  yang setara untuk controlled comparison.
- Hindari memperbaiki substansi generated rationale melalui editor. Gunakan
  editor untuk normalisasi format dan simpan output asli sebagai audit trail.
- Simpan versi prompt/schema, model generasi, model BERTScore, snapshot ID,
  generated comparison, dan silver ground truth yang digunakan.

Prompt terkontrol untuk menghasilkan comparison JSON melalui GitHub Copilot
tersedia di `evaluation/github-copilot-generated-comparison-prompt.md`.
