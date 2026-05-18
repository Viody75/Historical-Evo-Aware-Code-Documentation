# Repository History Analyzer - Architecture and Methodology

## Overview

Dokumen ini menjelaskan arsitektur terbaru dari `Repository History Analyzer` setelah penambahan:

- standardisasi summary PR berbasis OpenAI
- penyimpanan summary markdown per issue di snapshot
- pembentukan `ast-with-rationale.json`
- penghubungan rationale ke commit dan file change
- penyimpanan `evidenceRefs` untuk traceability sumber rationale
- perhitungan metrik issue secara deterministik dari payload dan patch
- inferensi lokal untuk aspek `changeContrast` memakai heuristic / AST-friendly rules
- pembatasan peran LLM agar hanya mengisi narasi `before`, `after`, dan `rationale` untuk aspek yang sudah ditentukan lokal
- tabel `Change Contrast` dan tabel `Impact` pada summary markdown
- konsumsi rationale di Tree-Mapping dan Repository Viewer
- optimasi lazy rendering untuk mencegah browser crash saat membuka detail besar

Secara konseptual, sistem ini bukan hanya mengambil histori GitHub, tetapi mengubah histori tersebut menjadi artefak analitis yang bisa dipakai ulang: `history.json`, metrik issue, seed aspek perubahan, kumpulan summary markdown, AST dengan rationale, dan clone repository snapshot yang bisa diinspeksi.

## Architecture and Data Engineering Flow

```mermaid
flowchart TD
    A[User Input<br/>GitHub Repository URL<br/>Automation Parameters] --> B[Client Application<br/>Next.js History Viewer]

    B --> C[GitHub Proxy API<br/>/api/github]
    C --> D[GitHub REST API]

    D --> D1[Issues / Pull Requests]
    D --> D2[Issue Comments]
    D --> D3[Review Comments]
    D --> D4[Pull Request Commits]
    D --> D5[Commit Diff / Patch]
    D --> D6[Compare / Branch Metadata]

    D1 --> E[Extraction Layer]
    D2 --> E
    D3 --> E
    D4 --> E
    D5 --> E
    D6 --> E

    E --> F[Filtering Layer]
    F --> F1[Keep PR-oriented items]
    F --> F2[Apply ordering and pagination]
    F --> F3[Optional merged-only filter]
    F --> F4[Optional date-range filter]

    F --> G[Hydration Layer]
    G --> G1[Load PR details]
    G --> G2[Load discussions]
    G --> G3[Load commits]
    G --> G4[Load changed files and patch]

    G --> H[Trimming and Normalization]
    H --> H1[Trim raw GitHub payload]
    H --> H2[Normalize to historical-evolution schema]
    H --> H3[Keep fields needed for historical reasoning]
    H --> H4[Persist export-ready history JSON]

    H --> I[Historical Evolution JSON<br/>history.json]
    I --> I1[repo, fetchedAt, description]
    I --> I2[issues]
    I2 --> I21[issue summary/body]
    I2 --> I22[discussion timeline]
    I2 --> I23[commits]
    I23 --> I231[codeChanges per commit]

    I --> J[Snapshot Persistence Layer]
    J --> J1[Write history.json]
    J --> J2[Clone repository snapshot]
    J --> J3[Write metadata.json]

    J --> K[Deterministic Issue Analysis Layer]
    K --> K1[Compute issue metrics]
    K --> K2[Infer local changeContrast seeds]
    K --> K3[Classify change size]
    K --> K4[Fix aspect, evidence refs, commit refs]

    K --> L[LLM Narrative Layer]
    L --> L1[Summarize issue body + all non-bot human discussion]
    L --> L2[Summarize commit messages + patch excerpt]
    L --> L3[Fill before / after / rationale for fixed seeds]
    L --> L4[Return structured JSON narrative]

    L --> M1[Summary Rendering and Merge Layer]
    M1 --> M11[Merge LLM narrative with local seeds]
    M1 --> M12[Render markdown from template]
    M1 --> M13[Persist summary index]

    M1 --> R1[Rationale Mapping Layer]
    R1 --> R11[Resolve related commit IDs]
    R1 --> R12[Attach rationale to commit nodes]
    R1 --> R13[Build AST with rationale]

    J1 --> M["storage/history-snapshots/{snapshot-id}/history/history.json"]
    J2 --> N["storage/history-snapshots/{snapshot-id}/repo/"]
    J3 --> O["storage/history-snapshots/{snapshot-id}/metadata.json"]
    M12 --> P["storage/history-snapshots/{snapshot-id}/history/summary/issue-<n>.md"]
    M13 --> Q["storage/history-snapshots/{snapshot-id}/history/summary/index.json"]
    R13 --> R["storage/history-snapshots/{snapshot-id}/history/ast-with-rationale.json"]

    M --> S[Snapshot Detail Workspace]
    N --> S
    O --> S
    Q --> S
    R --> S

    S --> S1[D3 Collapsible Tree]
    S --> S2[Repo Viewer]
    S --> S3[Node Inspector]
    S --> S4[Patch-focused Diff Viewer]
    S --> S5[Saved Markdown Summary Viewer]

    S1 --> T[Search and Navigation]
    T --> T1[Search node by issue / commit / filename / rationale]
    T --> T2[Map node target to repo viewer]
    T --> T3[Focus code section related to patch hunk]

    S2 --> U[Repository File Reading API]
    U --> U1["GET /api/history-snapshots/{id}/repo"]
    U --> U2["GET /api/history-snapshots/{id}/repo/file"]

    S --> V[Snapshot Summary API]
    V --> V1["GET /api/history-snapshots/{id}/summary"]
    V --> V2["POST /api/history-snapshots/{id}/summary"]
```

## Methodology Detail

```mermaid
flowchart LR
    A[1. Extraction] --> B[2. Filtering]
    B --> C[3. Hydration]
    C --> D[4. Trimming]
    D --> E[5. Snapshotting]
    E --> F[6. Deterministic Issue Analysis]
    F --> G[7. LLM Narrative Summarization]
    G --> H[8. Rationale Mapping]
    H --> I[9. Visualization and Consumption]

    A --- A1[Collect repository URL]
    A --- A2[Call authenticated GitHub API]
    A --- A3[Extract PRs, comments, review comments, commits, patches]

    B --- B1[Sort latest-first or merged-date-first]
    B --- B2[Restrict to PR-oriented items]
    B --- B3[Optional merged-only filter]
    B --- B4[Optional date range filter]
    B --- B5[Optional pagination limit]

    C --- C1[Load PR detail on demand]
    C --- C2[Load commits and changed files]
    C --- C3[Load commit patch data]

    D --- D1[Remove redundant GitHub fields]
    D --- D2[Keep only historical context fields]
    D --- D3[Reshape data into historical-evolution schema]
    D --- D4[Reduce payload for onboarding / analysis use case]

    E --- E1[Persist history JSON]
    E --- E2[Clone repository snapshot]
    E --- E3[Persist metadata for repeatable analysis]

    F --- F1[Calculate discussion / commit / file metrics]
    F --- F2[Count additions, deletions, patch hunks]
    F --- F3[Infer changeContrast seeds locally]
    F --- F4[Classify change size locally]

    G --- G1[Compress issue body, non-bot discussion, commit messages, patch excerpts]
    G --- G2[Send fixed local seeds to OpenAI]
    G --- G3[LLM fills before / after / rationale only]
    G --- G4[Render markdown from template.txt]
    G --- G5[Persist markdown and summary index]

    H --- H1[Resolve related commit IDs]
    H --- H2[Attach rationale to commit-level AST nodes]
    H --- H3[Persist ast-with-rationale.json]
    H --- H4[Expose evidence source: discussion, commit_message, patch_excerpt, inferred]

    I --- I1[Consume via D3 tree]
    I --- I2[Consume via repo viewer]
    I --- I3[Consume via patch-focused inspection]
    I --- I4[Consume via saved markdown summaries]
    I --- I5[Use lazy-render for heavy detail panels]
```

## Data Model and Artifacts

### 1. Historical export payload

Artefak dasar sistem adalah `history.json`. Struktur ini berisi:

- `repo`
- `fetchedAt`
- `exportType`
- `description`
- `issues[]`

Setiap issue menyimpan:

- `issueNumber`
- `title`
- `url`
- `createdAt`
- `summary`
- `discussion[]`
- `commits[]`

Setiap commit menyimpan:

- `sha`
- `message`
- `author`
- `committedAt`
- `codeChanges[]`

Setiap code change menyimpan:

- `filename`
- `patch`

Payload ini menjadi sumber utama untuk semua tahap berikutnya: snapshotting, summary generation, tree building, dan repository inspection.

### 2. Snapshot storage artifacts

Setelah export selesai, sistem menyimpan beberapa artefak ke `storage/history-snapshots/{snapshot-id}`:

- `history/history.json`
- `metadata.json`
- `repo/` hasil clone repository
- `history/summary/index.json`
- `history/summary/issue-<n>.md`
- `history/ast-with-rationale.json`

Dengan pola ini, snapshot menjadi unit analisis yang reproducible. Artinya, setelah artefak terbentuk, workspace bisa dibuka ulang tanpa harus memanggil GitHub API atau OpenAI API lagi.

### 3. Summary artifacts

`index.json` menyimpan hasil summary terstruktur untuk semua issue yang sudah digenerate. Setiap issue summary memuat:

- informasi issue dasar
- `background`
- `whatChanged[]`
- `changeContrast[]`
- `changeSize`
- `metrics`
- `impact`
- `testingVerification`
- `notes`
- `markdown`
- `markdownFile`
- `generatedAt`
- `model`

Bagian `whatChanged[]` menjadi penghubung penting ke AST karena memuat:

- `change`
- `rationale`
- `relatedCommitIds[]`
- `evidenceRefs[]`
- `evidenceSource`

Bagian `changeContrast[]` menangkap kontras perubahan dalam bentuk tabel:

- `aspect`
- `before`
- `after`
- `rationale`
- `relatedCommitIds[]`
- `evidenceRefs[]`
- `evidenceSource`

Pada versi terbaru, `aspect` tidak dipilih oleh LLM. Sistem menentukan `aspect` secara lokal dari heuristic / AST-friendly rules terhadap patch. LLM hanya mengisi narasi `before`, `after`, dan `rationale` berdasarkan seed yang sudah ditetapkan.

Bagian `metrics` dihitung deterministik dari payload dan patch, bukan dari LLM:

- `discussionCount`
- `commitCount`
- `fileChangedCount`
- `codeChangeCount`
- `additions`
- `deletions`
- `hunkCount`

Bagian `changeSize` juga dihitung lokal dari metrik tersebut. Klasifikasi yang dipakai adalah:

- `kecil`
- `sedang`
- `besar`

Bagian `impact` tetap disimpan sebagai struktur `user`, `system`, dan `developer`, tetapi markdown summary merendernya sebagai tabel agar lebih mudah dipindai.

### 4. AST with rationale

`ast-with-rationale.json` adalah representasi tree hasil pengayaan dari `history.json` dengan informasi summary. Node ini dipakai oleh Tree-Mapping viewer dan menambahkan node `rationale` di bawah commit yang relevan.

Node rationale minimal membawa:

- label perubahan
- rationale
- sumber evidensi
- referensi evidensi konkret
- commit terkait

## Engineering Process

### 1. Extraction engineering

Sistem mengambil data dari GitHub REST API lewat proxy internal. Proxy ini menyederhanakan pengelolaan token, rate-limit visibility, dan pemanggilan API dari client.

Tahap ini mengumpulkan:

- daftar PR atau issues
- detail PR
- issue comments
- review comments
- daftar commit dalam PR
- diff commit
- changed files PR
- metadata compare dan branch

Data discussion yang masuk ke pipeline historis mencakup dua tipe utama:

- `issue_comment`
- `review_comment`

### 2. Filtering engineering

Filtering dilakukan sebelum hydration penuh supaya request tidak boros. Strategi yang dipakai:

- membatasi ke item PR-oriented
- memfilter merged-only jika diminta
- memfilter date range
- membatasi page load

Pada versi terbaru, filter merged-only plus date range tidak lagi hanya mengandalkan `created_at`, tetapi juga memanfaatkan search merged-date supaya kasus PR yang dibuat lebih awal tapi merge pada tanggal target tetap ikut terbaca.

### 3. Hydration engineering

Hydration hanya mengambil data yang dibutuhkan untuk membangun narasi perubahan:

- semua diskusi non-bot
- commit yang terkait
- file yang berubah
- patch yang dipakai untuk line matching

Pendekatan ini menjaga payload tetap cukup kaya untuk analisis, tapi tidak seluas payload mentah GitHub.

### 4. Trimming and normalization engineering

Payload GitHub mentah mengandung banyak field yang tidak relevan untuk use case historis. Karena itu dilakukan:

- trimming field berlebih
- normalisasi nama field
- pembentukan skema yang konsisten untuk issue, discussion, commit, dan file change

Hasilnya adalah `history.json` yang lebih kecil, lebih stabil, dan lebih mudah dipakai ulang oleh viewer dan proses LLM.

### 5. Snapshotting engineering

Snapshotting dilakukan agar analisis historis tidak bergantung pada kondisi repository saat runtime. Proses ini menyimpan:

- history JSON yang sudah dinormalisasi
- clone repository pada branch target atau fallback default branch
- metadata snapshot

Manfaat utamanya adalah reproducibility: file yang diperiksa di viewer selalu berasal dari snapshot yang sama.

### 6. Deterministic issue analysis engineering

Sebelum memanggil LLM, sistem menjalankan analisis lokal di `issueAnalysis.ts`. Tujuannya adalah mengurangi ketergantungan pada model untuk hal-hal yang bisa dihitung atau diklasifikasikan secara engineering.

Analisis lokal menghitung:

- jumlah diskusi per issue
- jumlah commit per issue
- jumlah file unik yang berubah
- jumlah code change entry
- jumlah line additions dan deletions dari patch
- jumlah patch hunk

Metrik ini juga dijumlahkan di level dataset sehingga halaman snapshot bisa menampilkan total untuk semua issue di dalam `history.json`.

Selain metrik, sistem membentuk `changeContrastSeeds[]`. Seed ini menjadi kontrak lokal yang mengunci:

- `aspect`
- alasan heuristic internal
- `relatedCommitIds[]`
- `evidenceRefs[]`
- `evidenceSource`

Pemilihan `aspect` memakai aturan lokal berbasis patch:

- `logic`: perubahan conditional, branching, guard, return, atau validasi
- `algorithm`: perubahan iterasi, selection strategy, sorting, reducer, distance calculation, atau pencarian nilai terdekat
- `struktur kode`: perubahan import, export, type, interface, class, atau dependency antar modul
- `behavior`: perubahan render, pointer, hover, focus, highlight, visibility, atau interaksi
- `functions`: perubahan deklarasi fungsi, signature, helper, atau batas tanggung jawab fungsi

Pendekatan ini bersifat AST-friendly: aturan dibuat agar bisa dinaikkan menjadi parser AST formal per bahasa di kemudian hari. Implementasi saat ini masih membaca patch line dan pola sintaks, sehingga belum menjadi AST parser bahasa pemrograman penuh.

`changeSize` juga diputuskan secara lokal. Sistem menghitung skor dari jumlah file, commit, hunk, additions, dan deletions. Dari sana perubahan diklasifikasikan sebagai `kecil`, `sedang`, atau `besar`.

### 7. LLM narrative summarization engineering

Setelah snapshot tersedia, user bisa menggenerate summary standar per issue. Proses ini dilakukan dari snapshot, bukan dari data live GitHub.

Konteks yang dikirim ke OpenAI diperkecil dengan strategi hemat token:

- issue summary/body dibersihkan dari markdown berlebihan
- semua komentar bot dibuang
- semua discussion non-bot tetap dikirim, baik `issue_comment` maupun `review_comment`
- body setiap discussion entry dipotong setelah dibersihkan, sekitar 500 karakter per entry
- commit message dipakai dalam bentuk ringkas
- patch hanya dikirim sebagai excerpt kecil per file
- metrik lokal ikut dikirim sebagai konteks pendukung
- `changeContrastSeeds[]` ikut dikirim sebagai daftar aspek yang sudah fixed
- output diminta dalam JSON schema ketat, bukan markdown langsung

Pada tahap ini, LLM tidak lagi menentukan `aspect` untuk `changeContrast`. Schema output untuk `changeContrast` hanya meminta:

- `before`
- `after`
- `rationale`

Urutan output LLM harus mengikuti urutan seed lokal. Setelah response diterima, server menggabungkan narasi tersebut dengan seed lokal. Dengan desain ini, `aspect`, `evidenceRefs`, `relatedCommitIds`, dan `evidenceSource` tetap berasal dari deterministic analysis.

Rationale juga diarahkan memakai pola sebab, akibat, dan solusi. Format yang dituju adalah:

```text
Karena ... sehingga/maka/jadi ... Solusi: ...
```

Bahasa tidak wajib Indonesia; yang penting struktur alasannya tetap memuat sebab, akibat, dan solusi.

Untuk menjaga traceability, konteks yang dikirim ke model juga menyertakan reference ID eksplisit:

- discussion ref: `issue_comment:<id>` atau `review_comment:<id>`
- commit ref: `commit:<sha>`
- patch ref: `patch:<sha>:<filename>`

Markdown lalu dirender lokal dari `template.txt`, sehingga token output model tetap rendah dan format summary tetap konsisten.

Summary markdown terbaru merender:

- `What Changed` sebagai tabel
- `Change Contrast` sebagai tabel `Aspek | Sebelum | Sesudah | Rationale | Evidence`
- `Change Size` sebagai label klasifikasi dan rationale
- `Impact` sebagai tabel `Area | Impact`

### 8. Rationale mapping engineering

Setelah summary JSON didapat, sistem memetakan `relatedCommitIds` ke SHA commit aktual di issue. Hasilnya dipakai untuk:

- menempelkan rationale ke node commit
- membangun AST pengayaan
- menampilkan rationale di viewer level file dan patch

Bagian `evidenceSource` dipakai untuk menjaga traceability. Dengan begitu rationale tidak hanya tampil sebagai opini model, tetapi juga menunjukkan dasar pembentukannya:

- `discussion`
- `commit_message`
- `patch_excerpt`
- `inferred`

Selain itu, `evidenceRefs` dipakai untuk menunjuk bukti konkret yang mendasari rationale. Ini memungkinkan developer memverifikasi ulang sumber alasan secara manual dari snapshot atau dari GitHub asal.

## Matching Logic

```mermaid
flowchart TD
    A[Historical Commit Patch] --> B[Parse patch into diff rows]
    B --> C[Split patch into hunks]
    C --> D[Take non-delete lines from each hunk]
    D --> E[Search matching text in current snapshot file]
    E --> F[Build highlight ranges per hunk]
    F --> G[Merge nearby ranges]
    G --> H[Generate focused snippet rows]
    H --> I[Highlight current file viewer]
    H --> J[Render patch-focused comparison]
    J --> K[Attach linked rationale when available]
```

Metode ini bukan AST parsing bahasa pemrograman formal, melainkan matching berbasis patch-to-current-file. Tujuannya adalah menghubungkan perubahan historis ke line yang paling relevan di snapshot repository saat ini.

Perlu dibedakan dari deterministic issue analysis: matching logic dipakai untuk highlight file viewer, sedangkan `changeContrastSeeds[]` dipakai untuk menentukan aspek perubahan. Keduanya sama-sama memanfaatkan patch, tetapi hasil akhirnya berbeda.

## Visualization and Consumption

### 1. D3 Tree-Mapping

Tree dipakai untuk menjelajahi histori dari level repository ke issue, discussion, commit, file change, dan rationale. Node bisa dicari dan dinavigasikan ke repo viewer. Pada node rationale, detail kini juga memuat `evidenceRefs` agar jejak alasan perubahan tetap dapat diaudit.

### 2. Repository Viewer

Repository viewer membaca file dari clone snapshot dan memperlihatkan:

- full file
- patch-focused snippet
- histori commit pada file
- rationale yang terhubung ke commit terkait

Ini membuat inspeksi bisa dilakukan sampai level line of code sambil tetap membawa konteks “mengapa perubahan ini dilakukan”.

### 3. Saved Markdown Summary Viewer

Summary yang sudah tergenerate ditampilkan ulang dari file markdown yang tersimpan di snapshot. Karena summary dibaca dari artefak snapshot, user tidak perlu regenerate saat membuka halaman lagi.

Summary terbaru menampilkan:

- tabel `What Changed`
- tabel `Change Contrast`
- klasifikasi `Change Size`
- tabel `Impact`
- daftar testing / verification
- notes

Halaman snapshot juga menghitung ulang metrik dari `history.json` saat render, sehingga total discussion, commit, files changed, dan code changes tetap bisa tampil walaupun summary lama belum diregenerate.

### 4. Lazy rendering strategy

Detail berat seperti:

- raw history JSON
- raw AST JSON
- markdown summary issue

dirender secara lazy hanya saat panel dibuka. Ini merupakan perubahan penting untuk mencegah browser freeze atau crash saat snapshot memuat artefak besar.

## What Changed From the Previous Architecture

Perubahan utama dibanding versi awal adalah:

1. Sistem tidak lagi berhenti di `history.json` dan clone repository.
   Sekarang snapshot juga menyimpan summary markdown, metrik issue, change contrast, dan AST dengan rationale.

2. Pipeline baru menambahkan tahap `Deterministic Issue Analysis`, `LLM Narrative Summarization`, dan `Rationale Mapping`.
   Ini mengubah sistem dari sekadar historical extractor menjadi historical interpretation workspace.

3. Aspek pada `changeContrast` kini ditentukan lokal dari heuristic / AST-friendly rules.
   LLM hanya mengisi `before`, `after`, dan `rationale`.

4. Tree-Mapping kini bukan hanya menampilkan issue, commit, dan patch, tetapi juga node rationale yang diturunkan dari summary.

5. Repository viewer kini bisa menampilkan alasan perubahan di level file dan patch, bukan hanya “apa yang berubah”.

6. Summary generation dibuat cache-first.
   Setelah artefak tersimpan, halaman snapshot memakai hasil yang ada tanpa perlu generate ulang.

7. Rendering detail besar sekarang memakai lazy strategy untuk menjaga stabilitas browser.

## Methodological Positioning

Secara metodologis, sistem ini menggabungkan beberapa pendekatan:

- repository mining
- snapshot-based reproducibility
- payload normalization
- deterministic issue metrics
- local aspect inference dengan heuristic / AST-friendly rules
- patch-to-file traceability
- LLM-assisted narrative generation dengan schema ketat
- rationale-linked historical inspection

Dengan kombinasi ini, sistem bukan hanya alat crawling GitHub, tetapi alat perekayasaan pengetahuan historis repository: mengambil data evolusi kode, menormalkannya, menghitung sinyal deterministik, memakai LLM hanya untuk narasi yang membutuhkan bahasa, lalu membuat hasilnya bisa dipakai ulang untuk onboarding, analisis, dan inspeksi teknis mendalam.

## Suggested Talking Points

```mermaid
mindmap
  root((Repository History Analyzer))
    Problem
      Historical context is fragmented
      GitHub data is rich but noisy
      Code diffs alone do not explain intent
    Method
      Repository mining
      Snapshot persistence
      Deterministic issue analysis
      Local aspect inference
      Structured LLM narrative generation
      Rationale-to-commit mapping
      Patch-to-code matching
      Lazy-render visualization
    Output
      Trimmed historical JSON
      Reproducible repository snapshot
      Issue metrics
      Change contrast tables
      Saved markdown summaries
      AST with rationale
      Searchable D3 tree
      Repo viewer with historical context
    Benefit
      Onboarding support
      Historical reasoning support
      Explainability of code changes
      Lower repeat analysis cost
      Reusable analysis artifacts
```
