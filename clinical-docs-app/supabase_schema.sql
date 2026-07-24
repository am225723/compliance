-- ============================================================
--  Integrative Psychiatry — Clinical AI Docs
--  Run these SQL statements in your Supabase SQL Editor
--  (Dashboard → SQL Editor → New Query → Paste → Run)
-- ============================================================

-- --------------------------------------------------------
-- 1.  documents  — stores every AI-generated document
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.documents (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Patient info
  patient_name      text        NOT NULL,
  patient_last_name text        GENERATED ALWAYS AS (
                                  split_part(patient_name, ' ', 2)
                                ) STORED,

  -- Document metadata
  document_type     text        NOT NULL,  -- 'treatment_plan' | 'darp' | 'pre_intake' | 'follow_up'
  template_id       text,                  -- e.g. 'treatment_plan', 'session_note'

  -- Content
  content_html      text,
  content_text      text,

  -- AI engine info
  ai_provider       text,                  -- 'openai' | 'gemini' | 'claude' | 'ollama' | 'ollama_cloud'
  ai_model          text,

  -- Output
  output_format     text        DEFAULT 'Both',
  drive_file_url    text,                  -- Google Drive URL if saved there

  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

-- --------------------------------------------------------
-- 2.  reports  — clinical billing info per document/visit
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reports (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id           uuid        REFERENCES public.documents(id) ON DELETE SET NULL,

  -- Billing fields (as specified)
  patient_name          text        NOT NULL,
  icd10_codes           text[],             -- array e.g. {'F32.1','F41.1'}
  type_of_service       text,               -- e.g. 'Psychiatric Evaluation', 'Psychotherapy'
  cpt_codes             text[],             -- array e.g. {'90837','90785'}
  psychotherapy_minutes integer,            -- e.g. 60
  date_of_service       date        NOT NULL DEFAULT CURRENT_DATE,

  -- Optional extra info
  notes                 text,

  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

-- --------------------------------------------------------
-- 3.  Row Level Security (RLS) — each user sees only their own data
-- --------------------------------------------------------
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports   ENABLE ROW LEVEL SECURITY;

-- Documents policies
CREATE POLICY "Users can view own documents"
  ON public.documents FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own documents"
  ON public.documents FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own documents"
  ON public.documents FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own documents"
  ON public.documents FOR DELETE
  USING (auth.uid() = user_id);

-- Reports policies
CREATE POLICY "Users can view own reports"
  ON public.reports FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own reports"
  ON public.reports FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own reports"
  ON public.reports FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own reports"
  ON public.reports FOR DELETE
  USING (auth.uid() = user_id);

-- --------------------------------------------------------
-- 4.  Auto-update updated_at timestamps
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER documents_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER reports_updated_at
  BEFORE UPDATE ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- --------------------------------------------------------
-- 5.  Indexes for performance
-- --------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_documents_user_id    ON public.documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON public.documents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_type       ON public.documents(document_type);
CREATE INDEX IF NOT EXISTS idx_reports_user_id      ON public.reports(user_id);
CREATE INDEX IF NOT EXISTS idx_reports_date         ON public.reports(date_of_service DESC);
CREATE INDEX IF NOT EXISTS idx_reports_patient      ON public.reports(patient_name);

-- --------------------------------------------------------
-- Done! Tables created:
--   public.documents  — AI-generated clinical documents
--   public.reports    — Billing/clinical report rows
-- --------------------------------------------------------
