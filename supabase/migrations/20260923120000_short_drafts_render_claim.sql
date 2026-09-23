-- Product Hero render claim (#5 follow-up) — a draft is blocked from a new
-- render only while a render of it is in flight or after one succeeded.
--
-- Before: short_drafts.rendered_at was stamped set-once when a render was
-- dispatched, so a render that failed (and was refunded) left the draft spent
-- forever. Spec #2 user stories 17 and 27: the Short speaks exactly the approved
-- audio, and a failed render refunds and the user can retry — the same draft.
--
-- Now:
--   render_run_id      the skill_runs row currently holding the draft's render
--                      claim; NULL = free. Taken conditionally on the current
--                      value (NULL, or a failed run's id), so two concurrent
--                      renders cannot both start.
--   render_started_at  (was rendered_at) stamped by the trigger on the FIRST
--                      claim and never changed: from then on the draft cannot
--                      be deleted, so a Short always points at the exact audio
--                      it was rendered from.
-- A draft's content never changes at all (rows are never edited; re-voicing
-- inserts a new row), so only the two claim columns may move, and only as:
--   claim    render_run_id NULL → run, where the run is a submitted/running
--            skill run of the draft's owner;
--   release  run → NULL, only once that run failed or was canceled (both are
--            refunded); api-v2 releases on a failed dispatch, the worker after
--            a render's refunds, the cancel route after a cancel;
--   re-claim failed/canceled run → new run, in one step (a retry that finds a
--            claim nobody released).
-- A claim held by a succeeded run can never be released: that draft is rendered.
--
-- skill_runs also gets the Idempotency-Key column the composed skills lacked
-- (ARCHITECTURE.md, Credits & spend safety #4): a replayed make_product_hero
-- run returns the original run instead of being refused as in flight.
--
-- render_run_id has no foreign key: skill_runs cascade-delete with their user,
-- and a draft row must not block that. The guard trigger checks the run instead.

-- ── skill_runs: Idempotency-Key ─────────────────────────────────────────────
ALTER TABLE public.skill_runs ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_skill_runs_idempotency
  ON public.skill_runs (user_id, skill_slug, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ── short_drafts: the render claim ──────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'short_drafts' AND column_name = 'rendered_at'
  ) THEN
    -- DDL: the row guard trigger does not fire.
    ALTER TABLE public.short_drafts RENAME COLUMN rendered_at TO render_started_at;
  END IF;
END;
$$;

ALTER TABLE public.short_drafts ADD COLUMN IF NOT EXISTS render_started_at timestamptz;
ALTER TABLE public.short_drafts ADD COLUMN IF NOT EXISTS render_run_id uuid;

ALTER TABLE public.short_drafts DROP CONSTRAINT IF EXISTS short_drafts_claim_started;
ALTER TABLE public.short_drafts
  ADD CONSTRAINT short_drafts_claim_started CHECK (render_run_id IS NULL OR render_started_at IS NOT NULL);

-- One render run renders one draft.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_short_drafts_render_run
  ON public.short_drafts (render_run_id) WHERE render_run_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.short_drafts_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  held_status text;
  claim_user  uuid;
  claim_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.render_started_at IS NOT NULL THEN
      RAISE EXCEPTION 'short_drafts: draft % has been rendered from and cannot be deleted', OLD.id;
    END IF;
    RETURN OLD;
  END IF;

  -- The parent was deleted: the FK's ON DELETE SET NULL nulls parent_draft_id
  -- (it runs inside the RI trigger, never as a direct statement).
  IF pg_trigger_depth() > 1
     AND OLD.parent_draft_id IS NOT NULL AND NEW.parent_draft_id IS NULL
     AND (to_jsonb(NEW) - 'parent_draft_id') = (to_jsonb(OLD) - 'parent_draft_id') THEN
    RETURN NEW;
  END IF;

  -- Content is immutable: only the claim may change.
  IF (to_jsonb(NEW) - 'render_run_id' - 'render_started_at')
     IS DISTINCT FROM (to_jsonb(OLD) - 'render_run_id' - 'render_started_at') THEN
    RAISE EXCEPTION 'short_drafts: drafts are immutable; re-voice to create a new draft';
  END IF;

  -- render_started_at is written only here, by the first claim.
  IF NEW.render_started_at IS DISTINCT FROM OLD.render_started_at THEN
    RAISE EXCEPTION 'short_drafts: render_started_at is stamped by the first render claim and never changes';
  END IF;

  IF NEW.render_run_id IS NOT DISTINCT FROM OLD.render_run_id THEN
    RETURN NEW;
  END IF;

  -- Giving up the current claim (release, or re-claim): only after its run
  -- failed or was canceled.
  IF OLD.render_run_id IS NOT NULL THEN
    SELECT status INTO held_status FROM public.skill_runs WHERE id = OLD.render_run_id;
    IF held_status IS NULL OR held_status NOT IN ('failed', 'canceled') THEN
      RAISE EXCEPTION 'short_drafts: draft % is held by render run % (%); its claim is released only after that run fails',
        OLD.id, OLD.render_run_id, COALESCE(held_status, 'missing');
    END IF;
  END IF;

  -- Taking a claim: a live skill run of the draft's owner.
  IF NEW.render_run_id IS NOT NULL THEN
    SELECT user_id, status INTO claim_user, claim_status FROM public.skill_runs WHERE id = NEW.render_run_id;
    IF claim_user IS DISTINCT FROM NEW.user_id OR claim_status IS NULL OR claim_status NOT IN ('submitted', 'running') THEN
      RAISE EXCEPTION 'short_drafts: a render claim must name a submitted or running skill run of the draft''s owner';
    END IF;
    IF OLD.render_started_at IS NULL THEN
      NEW.render_started_at := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- The trigger itself is unchanged (BEFORE UPDATE OR DELETE, per row); recreate
-- it so this migration also stands on a database where it was dropped.
DROP TRIGGER IF EXISTS trg_short_drafts_guard ON public.short_drafts;
CREATE TRIGGER trg_short_drafts_guard
  BEFORE UPDATE OR DELETE ON public.short_drafts
  FOR EACH ROW EXECUTE FUNCTION public.short_drafts_guard();
