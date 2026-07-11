# Norðurljós Laundry

Production laundry order-management app. Static HTML/JS front end (`index.html`), Supabase (Postgres + Auth + RLS + Edge Functions) backend, Resend for bilingual transactional email.

See `docs/engineering-plan.md` for the locked schema, RLS policies, RPCs, triggers, and implementation task list (T1-T10). See `docs/design.md` for the product design doc.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
