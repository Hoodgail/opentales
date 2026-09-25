# Agentic writing

Describe the writing goal in AI Agent. The agent uses ordinary project tools to read existing work, choose a useful next step, and create or edit documents and manuscript content.

Plans are editable project docs, not a required sequence of phases. Use docs for outlines, canon notes, research, decisions, progress, and open questions. The agent can revise the plan as new writing or author feedback changes what matters next. Specialized craft skills remain available when relevant.

For example: “Read my notes, make a chapter plan, then draft the opening.” The agent lists project files, reads the relevant docs and manuscript, writes the plan with `createProjectDoc` or `updateProjectDoc`, and drafts using chapter and scene tools. Existing content is read before bounded edits. Tool receipts confirm what was persisted.

Manual mode requires approval for proposed mutations. Admin-only Auto mode executes permitted mutations immediately. Project permissions and version checks apply in both modes. Focused tasks may be delegated to subagent sessions.

Messages, tool calls, writing versions, and docs persist. A backend restart interrupts a running model invocation; it does not automatically resume a background novel workflow. Resume by asking the agent to read the current plan and continue.

The former build worker, build routes, workflow skill, and Build workspace have been removed. Existing database records and historical export/revision provenance are retained; this change does not delete saved manuscripts or historical build data. The SDK no longer exposes build workflow methods.
