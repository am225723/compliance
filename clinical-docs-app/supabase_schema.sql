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

  -- Generation source
  source            text        NOT NULL DEFAULT 'manual',  -- 'manual' | 'autopilot'

  -- Calendar Notes linkage
  calendar_id                 text,          -- Google Calendar ID the appointment came from
  calendar_event_id           text,          -- Google Calendar event ID
  calendar_occurrence_start   timestamptz,    -- start time of this specific occurrence (distinguishes recurring instances)

  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

-- Columns added after the initial CREATE TABLE shipped (clinical_docs_templates_and_doc_source
-- and calendar_notes_dedup_columns migrations) — explicit so re-running this script against an
-- existing deployment actually adds them, since CREATE TABLE IF NOT EXISTS above is a no-op there.
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS calendar_id text;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS calendar_event_id text;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS calendar_occurrence_start timestamptz;

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
CREATE INDEX IF NOT EXISTS idx_documents_source     ON public.documents(source);
CREATE INDEX IF NOT EXISTS idx_reports_user_id      ON public.reports(user_id);
CREATE INDEX IF NOT EXISTS idx_reports_date         ON public.reports(date_of_service DESC);
CREATE INDEX IF NOT EXISTS idx_reports_patient      ON public.reports(patient_name);

-- Prevent generating a duplicate note for the same calendar appointment
-- occurrence + document type, scoped per user (calendar_occurrence_start
-- distinguishes individual instances of a recurring event; document_type is
-- included so e.g. a Treatment Plan and a DARP note can both be generated
-- for the same appointment without tripping the dedup check).
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_calendar_occurrence_unique
  ON public.documents (user_id, calendar_id, calendar_event_id, calendar_occurrence_start, document_type)
  WHERE calendar_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_documents_calendar_event
  ON public.documents (calendar_event_id)
  WHERE calendar_event_id IS NOT NULL;

-- Serves the bounded fetchExistingCalendarNotes lookup (calendar_id + occurrence range).
CREATE INDEX IF NOT EXISTS idx_documents_calendar_id_occurrence
  ON public.documents (calendar_id, calendar_occurrence_start);

-- --------------------------------------------------------
-- 6.  templates  — clinic-wide editable overrides for the 4 built-in
--     clinical document templates. A missing row means "use the static
--     default shipped in public/templates/*.html".
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.templates (
  key         text        PRIMARY KEY,   -- 'treatment_plan' | 'session_note' | 'pre_intake' | 'follow_up'
  label       text,
  html        text        NOT NULL,
  updated_at  timestamptz DEFAULT now()
);

ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view templates" ON public.templates;
CREATE POLICY "Authenticated users can view templates"
  ON public.templates FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can insert templates" ON public.templates;
CREATE POLICY "Authenticated users can insert templates"
  ON public.templates FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can update templates" ON public.templates;
CREATE POLICY "Authenticated users can update templates"
  ON public.templates FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can delete templates" ON public.templates;
CREATE POLICY "Authenticated users can delete templates"
  ON public.templates FOR DELETE
  USING (auth.role() = 'authenticated');

DROP TRIGGER IF EXISTS templates_updated_at ON public.templates;
CREATE TRIGGER templates_updated_at
  BEFORE UPDATE ON public.templates
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- --------------------------------------------------------
-- 7.  Extended document metadata — for regeneration, cost tracking, review workflows
-- --------------------------------------------------------
-- Cost tracking: tokens used + cost estimation
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS
  prompt_tokens integer;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS
  completion_tokens integer;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS
  total_tokens integer;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS
  estimated_cost_cents integer;  -- cost in cents for easy integer storage

-- Document versioning: regeneration metadata
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS
  version_number integer DEFAULT 1;  -- incremented on regeneration
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS
  previous_version_id uuid REFERENCES public.documents(id) ON DELETE SET NULL;  -- link to prior version
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS
  generation_metadata jsonb;  -- { selectedFileIds, sourceFiles, settingsSnapshot: {...} }

-- Review workflow
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS
  review_status text DEFAULT 'generated';  -- 'generated' | 'approved' | 'rejected'
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS
  reviewed_at timestamptz;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS
  review_notes text;

-- --------------------------------------------------------
-- 8.  generation_logs  — audit trail for batch runs + error recovery
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.generation_logs (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Batch metadata
  batch_id            text        NOT NULL,  -- unique identifier for this batch run
  batch_name          text,                  -- user-friendly name (optional)
  document_type       text        NOT NULL,  -- which template was used
  started_at          timestamptz DEFAULT now(),
  completed_at        timestamptz,
  status              text        NOT NULL DEFAULT 'in_progress',  -- 'in_progress' | 'completed' | 'failed' | 'partial'

  -- Summary stats
  total_patients      integer     NOT NULL DEFAULT 0,
  successful_count    integer     NOT NULL DEFAULT 0,
  failed_count        integer     NOT NULL DEFAULT 0,
  skipped_count       integer     NOT NULL DEFAULT 0,

  -- Settings snapshot for reproducibility
  settings_snapshot   jsonb,  -- { aiProvider, aiModel, detailLevel, sourceFileRules }

  created_at          timestamptz DEFAULT now()
);

-- --------------------------------------------------------
-- 9.  generation_errors  — per-patient error details for audit + recovery
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.generation_errors (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  generation_log_id uuid        REFERENCES public.generation_logs(id) ON DELETE CASCADE,

  patient_name      text        NOT NULL,
  error_message     text        NOT NULL,
  error_type        text,  -- 'missing_files' | 'api_error' | 'validation_error' | 'unknown'
  error_detail      jsonb,  -- full error object for debugging

  document_type     text,
  attempted_at      timestamptz DEFAULT now(),
  retry_eligible    boolean     DEFAULT true,  -- can this error be retried?

  created_at        timestamptz DEFAULT now()
);

-- --------------------------------------------------------
-- 10. generation_presets  — saved configuration templates for batch generation
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.generation_presets (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Preset metadata
  name              text        NOT NULL,  -- e.g. "Treatment Plan - Standard"
  description       text,
  document_type     text        NOT NULL,  -- 'treatment_plan' | 'session_note' | 'pre_intake' | 'follow_up'
  is_default        boolean     DEFAULT false,

  -- Saved settings
  ai_provider       text        NOT NULL,
  ai_model          text,
  detail_level      text        NOT NULL,  -- 'Standard' | 'Highly Detailed' | 'Bulleted Summary'
  output_format     text        NOT NULL,  -- 'HTML' | 'PDF' | 'Both'
  source_file_rules jsonb,               -- per-doc-type rules (same structure as settings.sourceFiles)

  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

-- --------------------------------------------------------
-- Enable RLS and create policies for new tables
-- --------------------------------------------------------
ALTER TABLE public.generation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generation_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generation_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own generation logs"
  ON public.generation_logs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own generation logs"
  ON public.generation_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own generation logs"
  ON public.generation_logs FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view own generation errors"
  ON public.generation_errors FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own generation errors"
  ON public.generation_errors FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own generation presets"
  ON public.generation_presets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own generation presets"
  ON public.generation_presets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own generation presets"
  ON public.generation_presets FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own generation presets"
  ON public.generation_presets FOR DELETE
  USING (auth.uid() = user_id);

-- --------------------------------------------------------
-- Create triggers for updated_at
-- --------------------------------------------------------
CREATE TRIGGER generation_presets_updated_at
  BEFORE UPDATE ON public.generation_presets
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- --------------------------------------------------------
-- Indexes for performance
-- --------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_generation_logs_user_id
  ON public.generation_logs(user_id);

CREATE INDEX IF NOT EXISTS idx_generation_logs_batch_id
  ON public.generation_logs(batch_id);

CREATE INDEX IF NOT EXISTS idx_generation_logs_created_at
  ON public.generation_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_generation_errors_user_id
  ON public.generation_errors(user_id);

CREATE INDEX IF NOT EXISTS idx_generation_errors_log_id
  ON public.generation_errors(generation_log_id);

CREATE INDEX IF NOT EXISTS idx_generation_errors_patient
  ON public.generation_errors(patient_name);

CREATE INDEX IF NOT EXISTS idx_generation_presets_user_id
  ON public.generation_presets(user_id);

CREATE INDEX IF NOT EXISTS idx_generation_presets_doc_type
  ON public.generation_presets(document_type);

CREATE INDEX IF NOT EXISTS idx_documents_review_status
  ON public.documents(review_status);

CREATE INDEX IF NOT EXISTS idx_documents_version_number
  ON public.documents(version_number);

-- --------------------------------------------------------
-- Done! Tables created/extended:
--   public.documents  — AI-generated clinical documents (extended with versioning, cost, review)
--   public.reports    — Billing/clinical report rows
--   public.templates  — Clinic-wide template overrides
--   public.generation_logs  — Batch run audit trail
--   public.generation_errors  — Per-patient error details
--   public.generation_presets  — Saved configuration presets
-- --------------------------------------------------------
