# Friction log (Alexa+ track)

Written while building Hearth, 2026-10-22. Each entry follows the fields the hackathon asks for. Severity: **Blocker** (could not do it at all), **High** (cost hours or forced a redesign), **Medium** (cost under an hour), **Low** (confusing, no real cost).

## 1. Testing on Alexa+ itself

- **Task:** run Hearth as an Alexa+ add-on and test it in the Alexa+ client.
- **Steps:** read the Alexa+ MCP toolkit overview and the add-on development stages; looked for a way to deploy and open the Web Simulator.
- **Expected:** a way for registered hackathon entrants to deploy an add-on and talk to it, even in a sandbox.
- **Actual:** the add-on tooling and simulator need a Private Preview approval, which there was no way to get before the deadline.
- **Severity:** Blocker (for testing on Alexa+; the track allows a simulated experience).
- **Workaround:** built Hearth as a standard MCP server and wrote a simulated host (voice in/out, speaker picker, MCP App bridge, JSON-RPC inspector) to show the experience end to end.
- **Suggestion:** give registered entrants a time-limited sandbox or simulator account for the length of the hackathon.

## 2. Matching versions: MCP spec, SDK and MCP Apps

- **Task:** serve MCP spec 2025-11-25 (what Alexa+ supports) with an MCP App view.
- **Steps:** installed the latest `@modelcontextprotocol/ext-apps` (2.x) next to `@modelcontextprotocol/sdk` 1.x.
- **Expected:** the latest MCP Apps package works with an SDK that speaks 2025-11-25.
- **Actual:** ext-apps 2.x targets the v2 SDK (`@modelcontextprotocol/server`), while the newest spec (2026-07-28) is not the one Alexa+ accepts. The two latest packages do not fit the required spec together.
- **Severity:** Medium (about an hour).
- **Workaround:** pinned `@modelcontextprotocol/sdk@1.32.1` (its `LATEST_PROTOCOL_VERSION` is `2025-11-25`) with `@modelcontextprotocol/ext-apps@1.7.5`.
- **Suggestion:** publish a compatibility table in the Alexa+ docs: Alexa+ ↔ MCP spec ↔ SDK ↔ ext-apps versions.

## 3. Who is speaking is not part of the request

- **Task:** apply household rules (a nine-year-old cannot buy candy) on a device that several people share.
- **Steps:** looked for a standard field in the MCP tool call, or in the Alexa+ client lifecycle docs, that carries the recognised person.
- **Expected:** an opaque id and role for the recognised speaker on each request, set by the device, not by the model.
- **Actual:** none found. Hearth takes `speaker` as a tool argument. In the simulated host the host overwrites it on every call, so the model cannot change it, but the server itself still has to trust whoever calls `/mcp`. The MCP spec also says servers must not rely on client-provided user identification.
- **Severity:** High (it decides whether a spending rule can be trusted at all).
- **Workaround:** host-bound `speaker`; anything held can only be released out of band (entry 4); limits stated in the README.
- **Suggestion:** a signed, per-request speaker context (opaque person id, household role) passed by Alexa+ to add-ons.

## 4. Approval on another device

- **Task:** a child's purchase needs a parent's approval that cannot come through the same voice channel.
- **Steps:** tried MCP elicitation. Form mode asks the current speaker, which is the child. URL mode (new in 2025-11-25) is the right out-of-band shape, but the spec requires that the user who completes it is the user who started it.
- **Expected:** a documented way for an add-on to ask a different household member, on their own device.
- **Actual:** no pattern for "ask someone else to approve".
- **Severity:** High (shaped the core design).
- **Workaround:** the list is held and frozen; the parent's phone shows exactly what was held, with a secret approve/decline link. Nothing said to the device, by anyone, releases it.
- **Suggestion:** an Alexa+ "approve on a household member's device" primitive, or guidance on using URL elicitation for a different person.

## 5. Stateless Streamable HTTP on serverless

- **Task:** host the MCP server on serverless functions.
- **Steps:** ran the transport stateless (`sessionIdGenerator: undefined`) with state in Redis; connected an inspector.
- **Expected:** a clean connection.
- **Actual:** clients also open a GET for server-sent events, which a stateless server answers with 405. This is allowed by the spec but shows up as an error in inspectors.
- **Severity:** Low.
- **Workaround:** the inspector in the simulated host skips requests without a body.
- **Suggestion:** a short "stateless deployment" note in the Alexa+ docs saying the 405 is expected.

## 6. The 500 ms tool budget

- **Task:** design tools that answer within the Alexa+ add-on latency budget (500 ms, per the "create an MCP add-on" docs).
- **Steps:** kept all reasoning in the host model; tools only read and write household data.
- **Expected:** to learn the budget from the track description.
- **Actual:** it is only in the add-on docs, so it is easy to design a tool that calls a model and finds out late.
- **Severity:** Low.
- **Workaround:** no model calls inside tools; deterministic meal ranking and spending checks. Server-side tool time is a few milliseconds.
- **Suggestion:** state the budget in the track description.

## Feature requests

| Request | Why it matters to Hearth | Priority |
|---|---|---|
| Signed speaker context on each add-on request | The spending rule is only as strong as the speaker id behind it | Critical |
| "Approve on another household member's device" primitive | Every household add-on that spends money needs it | Important |
| Hackathon sandbox for the Alexa+ simulator | Test the real client instead of a simulation | Important |
