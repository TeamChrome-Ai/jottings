-- data/ministry.db: the ministry library and its verse index, built by tools/ministry_index.ts, read (read-only) by
-- rs/src/ministry.rs. Plain SQLite, separate from the user database, replaced whole on a data rebuild.
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- the registry of shared/ministry.ts as built; the server answers only for enabled rows
CREATE TABLE authors (id TEXT PRIMARY KEY, ord INTEGER NOT NULL UNIQUE, name TEXT NOT NULL, short TEXT NOT NULL, born INTEGER NOT NULL,
  died INTEGER NOT NULL, enabled INTEGER NOT NULL, licence TEXT NOT NULL, source TEXT NOT NULL);
CREATE TABLE collections (author TEXT NOT NULL, id TEXT NOT NULL, ord INTEGER NOT NULL, title TEXT NOT NULL, PRIMARY KEY (author, id)) WITHOUT ROWID;
-- `contents`: the sections' metadata as JSON ([{ title, subtitle?, part?, passages, date?, to? }]), the work's contents endpoint as is
CREATE TABLE works (author TEXT NOT NULL, id TEXT NOT NULL, collection TEXT NOT NULL, ord INTEGER NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL,
  count INTEGER NOT NULL, contents TEXT NOT NULL, PRIMARY KEY (author, id)) WITHOUT ROWID;
-- one row per section: `meta` its entry of the work's contents, `notes` its footnotes (JSON array or NULL), `figures` the
-- tables its page prints beside the text (JSON array of shared/figures.ts Figure, or NULL); the text is in paras
CREATE TABLE sections (author TEXT NOT NULL, work TEXT NOT NULL, n INTEGER NOT NULL, meta TEXT NOT NULL, notes TEXT, figures TEXT, PRIMARY KEY (author, work, n)) WITHOUT ROWID;
-- a section's paragraphs in order (`i` from 0; the text is the paragraphs joined by a blank line); `id` runs in reading
-- order across the library (author, collection, work, section, paragraph), which is the index's last tie-break
CREATE TABLE paras (id INTEGER PRIMARY KEY, author TEXT NOT NULL, work TEXT NOT NULL, n INTEGER NOT NULL, i INTEGER NOT NULL, text TEXT NOT NULL);
CREATE UNIQUE INDEX paras_section ON paras (author, work, n, i);
-- the rows of a section's figures that are index units (shared/figures.ts figureRows): `slot` its address in the
-- section, after the paragraphs, `text` the row as it reads; ids come from paras' counter, so reading order holds
CREATE TABLE figrows (id INTEGER PRIMARY KEY, author TEXT NOT NULL, work TEXT NOT NULL, n INTEGER NOT NULL, slot INTEGER NOT NULL, text TEXT NOT NULL);
-- the index: a verse (book * 1e6 + chapter * 1e3 + verse), the author's `ord`, the paragraph's rank for the verse
-- (shared/ministryIndex.ts rankOf: lower first), the paragraph, the footnote (0: the paragraph's own text; -1: `para`
-- is a figure row's id in figrows) and where the reference stands in its plain text (UTF-16 units)
CREATE TABLE refs (verse INTEGER NOT NULL, a INTEGER NOT NULL, rank INTEGER NOT NULL, para INTEGER NOT NULL, note INTEGER NOT NULL,
  start INTEGER NOT NULL, end INTEGER NOT NULL, PRIMARY KEY (verse, a, rank, para, note)) WITHOUT ROWID;
-- verses per chapter (Darby's text), to tell a verse the Bible does not have from one nobody wrote on
CREATE TABLE chapters (book INTEGER NOT NULL, chapter INTEGER NOT NULL, verses INTEGER NOT NULL, PRIMARY KEY (book, chapter)) WITHOUT ROWID;
