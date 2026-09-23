-- Short drafts (#4) — the draft phase of a Preset Short (ADR 0001).
--
-- One row per voiced Script: the Brief it came from, the diacritized Script, the
-- Voice that spoke it, the key of the stored audio, the duration MEASURED from that audio,
-- and ElevenLabs' character-level alignment. The render phase (#5) references a
-- draft by id and ships exactly this audio, Script and alignment — it never
-- re-voices. Re-voicing an edited Script inserts a NEW row (parent_draft_id
-- points at the one it came from); rows are never edited.
--
-- Only api-v2 (service role) writes: a draft is only valid if its audio was
-- really produced and measured, so users get SELECT on their own rows and
-- nothing else. The only permitted UPDATEs are stamping rendered_at once and the
-- ON DELETE SET NULL of parent_draft_id; a rendered row cannot be deleted.
--
-- The audio is a PRIVATE object: only its key is stored. Clients get a
-- short-lived signed URL minted per read by api-v2; the render phase reads the
-- object by key. No public URL is ever persisted.

CREATE TABLE IF NOT EXISTS public.short_drafts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL,
  preset           text NOT NULL CHECK (preset IN ('product_hero')),
  -- Gulf is accepted by the schema so #8 can enable it without a migration.
  dialect          text NOT NULL CHECK (dialect IN ('levantine','gulf')),
  brief            text,
  script           text NOT NULL,
  script_source    text NOT NULL CHECK (script_source IN ('generated','edited')),
  script_model     text,
  parent_draft_id  uuid REFERENCES public.short_drafts(id) ON DELETE SET NULL,
  voice_provider   text NOT NULL CHECK (voice_provider IN ('elevenlabs')),
  voice_id         text NOT NULL,
  tts_model        text NOT NULL,
  audio_key        text NOT NULL,
  audio_mime       text NOT NULL,
  -- The duration contract: only 5–15 s of speech is a renderable draft.
  duration_ms      integer NOT NULL CHECK (duration_ms BETWEEN 5000 AND 15000),
  alignment        jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  rendered_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_short_drafts_user
  ON public.short_drafts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_short_drafts_parent
  ON public.short_drafts (parent_draft_id) WHERE parent_draft_id IS NOT NULL;

-- Immutability: a draft's content never changes. Exactly two UPDATEs pass:
--   (a) rendered_at NULL → timestamp, once, with nothing else changing (the
--       render phase stamping the draft it used);
--   (b) parent_draft_id → NULL, with nothing else changing, issued by the
--       foreign key's ON DELETE SET NULL action (pg_trigger_depth() > 1: it runs
--       inside the RI trigger, never as a direct statement).
-- (b) is checked BEFORE the rendered-row rule: otherwise deleting an
-- unrendered parent fails whenever one of its children has been rendered.
-- A rendered draft can be neither changed nor deleted, so a finished Short
-- always points at the exact audio it shipped.
CREATE OR REPLACE FUNCTION public.short_drafts_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.rendered_at IS NOT NULL THEN
      RAISE EXCEPTION 'short_drafts: draft % was rendered and cannot be deleted', OLD.id;
    END IF;
    RETURN OLD;
  END IF;

  -- (b) The parent was deleted: the FK nulls parent_draft_id, even on a rendered row.
  IF pg_trigger_depth() > 1
     AND OLD.parent_draft_id IS NOT NULL AND NEW.parent_draft_id IS NULL
     AND (to_jsonb(NEW) - 'parent_draft_id') = (to_jsonb(OLD) - 'parent_draft_id') THEN
    RETURN NEW;
  END IF;

  IF OLD.rendered_at IS NOT NULL THEN
    RAISE EXCEPTION 'short_drafts: draft % was rendered and is immutable', OLD.id;
  END IF;

  -- (a) Stamping rendered_at, once.
  IF NEW.rendered_at IS NOT NULL
     AND (to_jsonb(NEW) - 'rendered_at') = (to_jsonb(OLD) - 'rendered_at') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'short_drafts: drafts are immutable; re-voice to create a new draft';
END;
$$;

DROP TRIGGER IF EXISTS trg_short_drafts_guard ON public.short_drafts;
CREATE TRIGGER trg_short_drafts_guard
  BEFORE UPDATE OR DELETE ON public.short_drafts
  FOR EACH ROW EXECUTE FUNCTION public.short_drafts_guard();

-- RLS: owners read their own drafts; only the service role writes.
ALTER TABLE public.short_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS short_drafts_owner_select ON public.short_drafts;
DROP POLICY IF EXISTS short_drafts_service_all  ON public.short_drafts;
CREATE POLICY short_drafts_owner_select ON public.short_drafts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY short_drafts_service_all  ON public.short_drafts FOR ALL TO service_role USING (true) WITH CHECK (true);
