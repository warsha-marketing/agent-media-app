# Person shots render on Seedance via BytePlus ModelArk, not EvoLink

Shots that show a person are rendered with Seedance 2.0 Mini on BytePlus ModelArk (ByteDance's official API). Product-only shots may stay on EvoLink.

We tested this on 2026-09-24 with the same scene (a Gulf woman in hijab spraying perfume on her wrist) and the model's own audio off:

- **EvoLink's Seedance** refused **every** video showing a hijab-wearing woman: 0 of 6, whether she came from a reference face, a character sheet, a text-only description or a start frame. Women without hijab passed 2 of 2. This is EvoLink's output moderation, not the model.
- **ModelArk and fal** reject any photoreal face as an input image ("may contain real person"), but **ModelArk accepted text-described hijab women** on Seedance 2.0 and 2.0 Mini.
- **Kling O3 Pro and Veo 3.1** accepted hijab women, but the owner rejected their realism.
- **Seedance 2.0 Mini on ModelArk** gave the most real-looking result. That used the original app's realism rules (raw iPhone look, flat everyday light, sharp background, matte skin with pores) and an In-use Reference of the product.

## Consequences

- **Consistent characters** can't use photoreal reference faces on ModelArk. They must come from ModelArk's documented routes: a persona generated with Seedream on the same account (trusted model output), or later the Virtual Portrait Library, which needs BytePlus organization verification. See `docs/research/seedance-real-person-routes.md`.
- **Kling O3 Pro and Veo 3.1 (#25)** remain only as fallbacks, pending the Critic's results.
- **Cinematic lighting** (golden hour, warm lamps, shallow depth of field) makes Seedance skin look waxy. Person-shot prompts must follow the realism rules.
