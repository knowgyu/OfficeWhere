# Content Fingerprint Roadmap

## Current release decision

Implement **file-level content fingerprints only**.

The app already stores extracted search chunks in `file_chunks`. Phase 4 adds a compact `document_fingerprints` table that stores hashes and counts derived from those chunks. It does **not** store a second copy of the document body.

Expected additional DB size for 10,000 documents is roughly **5-20 MB** including the hash index, depending on SQLite page overhead and metadata sizes.

## Why file-level first

Pros:
- Cheap to store and index.
- Good enough to distinguish “same filename and same extracted content” from “same filename but changed content”.
- Works for Word, PowerPoint, and Excel through the existing extraction/indexing pipeline.
- Avoids turning every paragraph, cell, or slide into another persistent index row.

Cons:
- Cannot directly explain which paragraph/cell/slide changed.
- Reordered or partially changed content still requires the existing compare action to inspect details.
- It is a confidence/evidence layer, not a full version-control system.

## Deferred enhancement: paragraph/cell/slide-level fingerprints

A future version may add chunk-level fingerprints such as:

```sql
CREATE TABLE document_chunk_fingerprints (
  file_id INTEGER NOT NULL,
  sequence INTEGER NOT NULL,
  location TEXT NOT NULL,
  normalized_hash TEXT NOT NULL,
  content_chars INTEGER NOT NULL,
  PRIMARY KEY (file_id, sequence)
);

CREATE INDEX idx_chunk_fingerprints_hash
ON document_chunk_fingerprints(normalized_hash);
```

### Benefits
- Can identify which paragraphs, table rows, cells, or slides are unchanged/moved/changed.
- Can build richer history views without opening every source document again.
- Can support future “changed sections only” summaries.

### Costs and risks
- Row count grows with extracted chunks, not file count.
- Example: 10,000 files × 200 chunks/file = about 2,000,000 rows.
- Additional DB size may reach hundreds of MB, and Excel-heavy libraries can exceed 1 GB.
- More indexes mean slower writes/reindexing and more migration complexity.
- The UI must avoid overwhelming non-developer users with low-level diff noise.

## Adoption criteria for later

Only add chunk-level fingerprints if real usage shows that file-level evidence plus on-demand compare is insufficient, and if the product needs one of these:

- changed-section summaries before running a full compare;
- reusable long-term version timelines;
- high-volume duplicate cleanup workflows;
- manual merge/split of document families.
