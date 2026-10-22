-- Guard triggers that are not SECURITY DEFINER (legal_policy_guard, file_guard)
-- call app.raise_invalid_transition as the invoking role, which needs EXECUTE;
-- without it an invalid transition surfaced as "permission denied" instead of
-- INVALID_TRANSITION. Found by the constraint suite.
GRANT EXECUTE ON FUNCTION app.raise_invalid_transition(text, text, text) TO app_user, worker_user, admin_user;
