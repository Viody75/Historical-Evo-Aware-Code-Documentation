# Repository History Analyzer - Architecture and Methodology

## Overview

Dokumen ini menjelaskan arsitektur terbaru dari `Repository History Analyzer` setelah penambahan:

- standardisasi summary PR berbasis OpenAI
- penyimpanan summary markdown per issue di snapshot
- pembentukan `ast-with-rationale.json`
- penghubungan rationale ke commit dan file change
- penyimpanan `evidenceRefs` untuk traceability sumber rationale
- konsumsi rationale di Tree-Mapping dan Repository Viewer
- optimasi lazy rendering untuk mencegah browser crash saat membuka detail besar

Secara konseptual, sistem ini bukan hanya mengambil histori GitHub, tetapi mengubah histori tersebut menjadi artefak analitis yang bisa dipakai ulang: `history.json`, kumpulan summary markdown, AST dengan rationale, dan clone repository snapshot yang bisa diinspeksi.

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

    J --> K[LLM Summary Layer]
    K --> K1[Summarize issue body + all non-bot human discussion]
    K --> K2[Summarize commit messages + patch excerpt]
    K --> K3[Return structured JSON summary]
    K --> K4[Render markdown from template]

    K --> L[Rationale Mapping Layer]
    L --> L1[Resolve related commit IDs]
    L --> L2[Attach rationale to commit nodes]
    L --> L3[Build AST with rationale]

    J1 --> M["storage/history-snapshots/{snapshot-id}/history/history.json"]
    J2 --> N["storage/history-snapshots/{snapshot-id}/repo/"]
    J3 --> O["storage/history-snapshots/{snapshot-id}/metadata.json"]
    K4 --> P["storage/history-snapshots/{snapshot-id}/history/summary/issue-<n>.md"]
    K4 --> Q["storage/history-snapshots/{snapshot-id}/history/summary/index.json"]
    L3 --> R["storage/history-snapshots/{snapshot-id}/history/ast-with-rationale.json"]

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
    E --> F[6. LLM Summarization]
    F --> G[7. Rationale Mapping]
    G --> H[8. Visualization and Consumption]

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

    F --- F1[Compress issue body, all non-bot discussion, commit messages, patch excerpts]
    F --- F2[Call OpenAI Responses API with structured JSON schema]
    F --- F3[Render markdown from template.txt]
    F --- F4[Persist markdown and summary index]

    G --- G1[Resolve related commit IDs]
    G --- G2[Attach rationale to commit-level AST nodes]
    G --- G3[Persist ast-with-rationale.json]
    G --- G4[Expose evidence source: discussion, commit_message, patch_excerpt, inferred]

    H --- H1[Consume via D3 tree]
    H --- H2[Consume via repo viewer]
    H --- H3[Consume via patch-focused inspection]
    H --- H4[Consume via saved markdown summaries]
    H --- H5[Use lazy-render for heavy detail panels]
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

### 6. LLM summarization engineering

Setelah snapshot tersedia, user bisa menggenerate summary standar per issue. Proses ini dilakukan dari snapshot, bukan dari data live GitHub.

Konteks yang dikirim ke OpenAI diperkecil dengan strategi hemat token:

- issue summary/body dibersihkan dari markdown berlebihan
- semua komentar bot dibuang
- semua discussion non-bot tetap dikirim, baik `issue_comment` maupun `review_comment`
- body setiap discussion entry dipotong setelah dibersihkan, sekitar 500 karakter per entry
- commit message dipakai dalam bentuk ringkas
- patch hanya dikirim sebagai excerpt kecil per file
- output diminta dalam JSON schema ketat, bukan markdown langsung

Untuk menjaga traceability, konteks yang dikirim ke model juga menyertakan reference ID eksplisit:

- discussion ref: `issue_comment:<id>` atau `review_comment:<id>`
- commit ref: `commit:<sha>`
- patch ref: `patch:<sha>:<filename>`

Markdown lalu dirender lokal dari `template.txt`, sehingga token output model tetap rendah dan format summary tetap konsisten.

### 7. Rationale mapping engineering

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

### 4. Lazy rendering strategy

Detail berat seperti:

- raw history JSON
- raw AST JSON
- markdown summary issue

dirender secara lazy hanya saat panel dibuka. Ini merupakan perubahan penting untuk mencegah browser freeze atau crash saat snapshot memuat artefak besar.

## What Changed From the Previous Architecture

Perubahan utama dibanding versi awal adalah:

1. Sistem tidak lagi berhenti di `history.json` dan clone repository.
   Sekarang snapshot juga menyimpan summary markdown dan AST dengan rationale.

2. Pipeline baru menambahkan tahap `LLM Summarization` dan `Rationale Mapping`.
   Ini mengubah sistem dari sekadar historical extractor menjadi historical interpretation workspace.

3. Tree-Mapping kini bukan hanya menampilkan issue, commit, dan patch, tetapi juga node rationale yang diturunkan dari summary.

4. Repository viewer kini bisa menampilkan alasan perubahan di level file dan patch, bukan hanya “apa yang berubah”.

5. Summary generation dibuat cache-first.
   Setelah artefak tersimpan, halaman snapshot memakai hasil yang ada tanpa perlu generate ulang.

6. Rendering detail besar sekarang memakai lazy strategy untuk menjaga stabilitas browser.

## Methodological Positioning

Secara metodologis, sistem ini menggabungkan beberapa pendekatan:

- repository mining
- snapshot-based reproducibility
- payload normalization
- patch-to-file traceability
- LLM-assisted summarization dengan schema ketat
- rationale-linked historical inspection

Dengan kombinasi ini, sistem bukan hanya alat crawling GitHub, tetapi alat perekayasaan pengetahuan historis repository: mengambil data evolusi kode, menormalkannya, merangkum konteksnya, lalu membuatnya bisa dipakai ulang untuk onboarding, analisis, dan inspeksi teknis mendalam.

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
      Structured LLM summarization
      Rationale-to-commit mapping
      Patch-to-code matching
      Lazy-render visualization
    Output
      Trimmed historical JSON
      Reproducible repository snapshot
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
