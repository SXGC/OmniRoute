-- fork-001_call_logs_upstream_response_model.sql (fork migration namespace)
-- Adds upstream_response_model to call_logs: the model the upstream declared in
-- its own Responses API payload when it differs from the routed model (model
-- column). NULL = not a Responses upstream, upstream did not declare a model,
-- or the declaration matched the routed model. Mirrors sub2api's
-- upstream_response_model observation (terminal response.completed wins).
-- Log-only: billing is unchanged.
ALTER TABLE call_logs ADD COLUMN upstream_response_model TEXT DEFAULT NULL;
