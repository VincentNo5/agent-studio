# Agent Studio — HUD direction study

## Brief

Agent Studio is a read-only command center for Orca-supervised AI work: 49 roster roles in ten rooms, floor-scoped dispatches, tasks, audit events and quotas. The previous redesign made the state truthful and much more legible, but the HUD still reads as a generic dark sci-fi dashboard.

The question for this study is not "make it prettier". It is: **what should an operations surface for this specific system feel like, and which structure makes working / completed / failed / pending unmistakable at a glance?**

## Audience and distance

- One operator (Vincent) at a Mac, roughly 1 m from a 1440×900 desktop viewport.
- The studio is left open while work runs; it is glanced at, not read linearly.
- The 3D building is the subject. The HUD is the instrument around it.

## Core information, in order

1. Which agents are **working** now, and on what.
2. Which agents **completed**, and which **failed / are blocked**.
3. Which run / dispatch / task is live, and the task board totals.
4. Selected-agent evidence: task, model, stage, liveness, recent events.
5. Environment: connection, time, performance, controls.

## Tone

Premium and calm. Cinematic where the scene carries it, precise where the HUD carries it. No neon-outline inventory, no glass for glass's sake, no glow that competes with status colour. Status is always an icon + word + colour.

## Format

- Three standalone 1440×900 HTML directions, same 3D backdrop, same sample state.
- The backdrop is a real screenshot of the current Three.js headquarters with the HUD hidden.
- Sample state is labelled `SAMPLE` in every direction; it exists only to exercise working/completed/failed/pending. The production implementation will read `/state` and keep the existing truthful `agentStatuses` derivation.

## Sample state

- Working 1: `ai-programmer`, task "Telemetry HUD", dispatch `ctx_work`, running.
- Completed 2: `qa-tester` (worker succeeded) and `sound-designer` (audit completion).
- Pending 1: `engine-programmer`, render plan.
- Failed 1: `devops-engineer`, deploy pipeline.
- Idle 44.
- Tasks: 6 total, 2 completed, 1 running, 1 pending, 1 failed, 1 ready.
- Live dispatches: 4.

## Readability floor

Body ≥14px, labels ≥12px, body contrast ≥4.5:1, no fabricated data, no decorative arrow suffixes, no all-caps eyebrow above every title.
