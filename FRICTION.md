# Friction log (Alexa+ track)

Written while building Hearth, 2026-10-22. Each entry: what we tried, what got in the way, what we did.

1. **Alexa+ add-on tooling is behind a Private Preview.** The Alexa+ MCP toolkit docs describe `alexa-ai deploy` and a Web Simulator, but both need a Private Preview approval. With about 40 hours to the deadline there was no way to test on Alexa+ itself, so Hearth is a standards-compliant MCP server plus a simulated host. A short-lived sandbox or simulator access for registered hackathon entrants would let builders test against the real client.

2. **Spec version lag.** The track requires MCP spec 2025-11-25 (the version Alexa+ supports). The current MCP spec is newer (2026-07-28, not backward compatible). The newest `@modelcontextprotocol/ext-apps` (2.x) targets the v2 SDK (`@modelcontextprotocol/server`), so it does not pair with the 1.x SDK that speaks 2025-11-25. We pinned `@modelcontextprotocol/sdk@1.32.1` (LATEST_PROTOCOL_VERSION = 2025-11-25) with `ext-apps@1.7.5`. A compatibility table (Alexa+ ↔ MCP spec ↔ SDK ↔ ext-apps versions) would have saved an hour.

3. **Who is speaking is not part of the MCP request.** A shared device's most important context, the recognised speaker, has no standard field in an MCP tool call. Hearth takes `speaker` as a tool argument and the host binds it from voice recognition (the model cannot change it). A standard per-request context field for the recognised person (opaque id, role) would let add-ons enforce household rules without trusting the model.

4. **No documented pattern for out-of-band approval.** Purchases by children need a parent's approval that cannot come through the same voice channel. MCP elicitation asks the current speaker, which is the wrong person. Hearth holds the cart and notifies the parent's phone with a signed link. A documented "approve on another device" pattern for add-ons would make this consistent across skills.

5. **Stateless Streamable HTTP and serverless.** On serverless hosts each request may land on a new instance, so we run the transport stateless (`sessionIdGenerator: undefined`) and keep all state in Redis. Clients still open a GET for server-sent events, which a stateless server answers with 405; that looks like an error in inspectors although it is expected. Guidance for stateless deployments would help.

6. **500 ms tool budget.** Alexa+ add-on calls must answer fast, so no model calls happen inside Hearth's tools; all reasoning stays in the host. This shaped the design (deterministic ranking of meals, rule-based spending checks) and is worth stating up front in the track description.
