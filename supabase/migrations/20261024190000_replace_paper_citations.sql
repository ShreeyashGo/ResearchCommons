-- Atomic rewrite of a paper's extracted references + citation contexts.
-- Replaces the delete-then-insert pair in the processing pipeline so a failed
-- insert can never leave the paper with wiped or partially written citations.
--
-- p_refs rows:    { ordinal, label, raw_text, parsed_title, parsed_authors,
--                   parsed_year, external_work_id, match_status, match_score,
--                   match_method }
-- p_contexts rows:{ ref_ordinal, page_index, marker_text, sentence, paragraph,
--                   rects, detection_method }
--
-- Runs as SECURITY DEFINER and is only granted to service_role: the pipeline
-- calls it via the admin client after user-client authorization.

create or replace function public.replace_paper_citations(
  p_paper_id uuid,
  p_refs jsonb,
  p_contexts jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref record;
  v_ref_id uuid;
begin
  delete from citation_contexts where paper_id = p_paper_id;
  delete from paper_references where paper_id = p_paper_id;

  for v_ref in
    select * from jsonb_to_recordset(p_refs) as x(
      ordinal int,
      label text,
      raw_text text,
      parsed_title text,
      parsed_authors text[],
      parsed_year int,
      external_work_id uuid,
      match_status public.match_status,
      match_score real,
      match_method text
    )
  loop
    insert into paper_references (
      paper_id, ordinal, label, raw_text, parsed_title, parsed_authors,
      parsed_year, external_work_id, match_status, match_score, match_method
    )
    values (
      p_paper_id, v_ref.ordinal, v_ref.label, v_ref.raw_text, v_ref.parsed_title,
      v_ref.parsed_authors, v_ref.parsed_year, v_ref.external_work_id,
      v_ref.match_status, v_ref.match_score, v_ref.match_method
    )
    returning id into v_ref_id;

    insert into citation_contexts (
      paper_id, reference_id, page_index, marker_text, sentence, paragraph,
      rects, detection_method
    )
    select
      p_paper_id,
      v_ref_id,
      (c->>'page_index')::int,
      c->>'marker_text',
      c->>'sentence',
      c->>'paragraph',
      coalesce(c->'rects', '[]'::jsonb),
      c->>'detection_method'
    from jsonb_array_elements(p_contexts) c
    where (c->>'ref_ordinal')::int = v_ref.ordinal;
  end loop;
end;
$$;

revoke all on function public.replace_paper_citations(uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_paper_citations(uuid, jsonb, jsonb)
  to service_role;
